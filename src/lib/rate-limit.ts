// lib/rate-limit.ts
// Rate limiting with Upstash Redis
// Falls back to in-memory rate limiting if Redis is not configured

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Rate limit configuration for different endpoints
 */
export const RATE_LIMITS = {
  // Voting endpoints - stricter limits to prevent abuse
  vote: { requests: 30, window: '1m' as const },

  // Upload endpoints - very strict
  upload: { requests: 5, window: '1m' as const },

  // Comment endpoints
  comment: { requests: 15, window: '1m' as const },

  // General API endpoints
  api: { requests: 60, window: '1m' as const },

  // Admin endpoints - split by operation type for security
  admin: { requests: 30, window: '1m' as const },        // General admin (legacy)
  admin_read: { requests: 30, window: '1m' as const },   // Listing users/clips
  admin_write: { requests: 15, window: '1m' as const },  // Moderation actions
  admin_sensitive: { requests: 5, window: '1m' as const }, // Ban/role changes

  // Leaderboard/read-heavy endpoints - cached, more lenient
  read: { requests: 120, window: '1m' as const },

  // Auth endpoints - strict to prevent brute force
  auth: { requests: 5, window: '1m' as const },

  // Contact/report endpoints - strict to prevent spam
  contact: { requests: 3, window: '1m' as const },
} as const;

export type RateLimitType = keyof typeof RATE_LIMITS;

/**
 * Critical rate limit types that must fail-closed when Redis is unavailable.
 * These endpoints are abuse-sensitive and must REJECT requests rather than
 * fall back to in-memory limiting (which is per-instance and easily bypassed).
 */
const CRITICAL_RATE_LIMIT_TYPES: ReadonlySet<RateLimitType> = new Set([
  'vote',
  'comment',
  'upload',
]);

// ============================================================================
// REDIS CLIENT
// ============================================================================

let redis: Redis | null = null;
const rateLimiters: Map<RateLimitType, Ratelimit> = new Map();

/**
 * Get or create Redis client
 */
function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  try {
    redis = new Redis({ url, token });
    return redis;
  } catch (error) {
    console.error('[RateLimit] Failed to create Redis client:', error);
    return null;
  }
}

/**
 * Get or create rate limiter for a specific type
 */
function getRateLimiter(type: RateLimitType): Ratelimit | null {
  const redisClient = getRedis();
  if (!redisClient) return null;

  if (!rateLimiters.has(type)) {
    const config = RATE_LIMITS[type];
    const limiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(config.requests, config.window),
      analytics: true,
      prefix: `aimoviez:ratelimit:${type}`,
    });
    rateLimiters.set(type, limiter);
  }

  return rateLimiters.get(type)!;
}

// ============================================================================
// IN-MEMORY FALLBACK
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const inMemoryLimits = new Map<string, RateLimitEntry>();

/**
 * Clean up expired entries periodically
 */
function cleanupInMemoryLimits() {
  const now = Date.now();
  for (const [key, entry] of inMemoryLimits.entries()) {
    if (entry.resetAt < now) {
      inMemoryLimits.delete(key);
    }
  }
}

// Track if cleanup has been initialized to prevent multiple intervals on serverless platforms
let cleanupInitialized = false;

/**
 * Initialize the cleanup interval - only runs once per server instance
 * This prevents multiple setInterval instances on serverless platforms like Vercel
 */
function initializeCleanup() {
  if (!cleanupInitialized && typeof setInterval !== 'undefined') {
    setInterval(cleanupInMemoryLimits, 5 * 60 * 1000);
    cleanupInitialized = true;
  }
}

// Initialize cleanup on module load (safe: only runs once due to flag)
initializeCleanup();

/**
 * In-memory rate limiting fallback
 */
function checkInMemoryLimit(
  identifier: string,
  type: RateLimitType
): { success: boolean; limit: number; remaining: number; reset: number } {
  const config = RATE_LIMITS[type];
  const key = `${type}:${identifier}`;
  const now = Date.now();

  // Parse window to milliseconds
  const windowMs = config.window === '1m' ? 60000 :
                   config.window === '1h' ? 3600000 : 60000;

  let entry = inMemoryLimits.get(key);

  // Reset if window expired
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + windowMs,
    };
  }

  entry.count++;
  inMemoryLimits.set(key, entry);

  const remaining = Math.max(0, config.requests - entry.count);
  const success = entry.count <= config.requests;

  return {
    success,
    limit: config.requests,
    remaining,
    reset: entry.resetAt,
  };
}

// ============================================================================
// IDENTIFIER EXTRACTION
// ============================================================================

/**
 * Get unique identifier for rate limiting from request
 */
export function getIdentifier(req: NextRequest): string {
  // Try to get IP from various headers
  const forwarded = req.headers.get('x-forwarded-for');
  const realIp = req.headers.get('x-real-ip');
  const cfConnectingIp = req.headers.get('cf-connecting-ip');

  const ip = cfConnectingIp ||
             (forwarded ? forwarded.split(',')[0].trim() : null) ||
             realIp ||
             'unknown';

  // Hash the IP for privacy
  return crypto.createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

/**
 * Get voter key (includes user agent for more unique identification)
 */
export function getVoterIdentifier(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

// ============================================================================
// RATE LIMIT CHECK
// ============================================================================

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  headers: Record<string, string>;
}

/**
 * Check rate limit for a request
 */
export async function checkRateLimit(
  identifier: string,
  type: RateLimitType = 'api'
): Promise<RateLimitResult> {
  const limiter = getRateLimiter(type);

  if (limiter) {
    // Use Redis-based rate limiting
    const { success, limit, remaining, reset } = await limiter.limit(identifier);

    return {
      success,
      limit,
      remaining,
      reset: reset,
      headers: {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(reset),
      },
    };
  }

  // Redis is unavailable.
  // For critical endpoints (vote, comment, upload), fail CLOSED:
  // reject the request rather than allowing unprotected access.
  if (CRITICAL_RATE_LIMIT_TYPES.has(type)) {
    console.warn(`[RateLimit] Redis unavailable for critical endpoint: ${type}`);
    return {
      success: false,
      limit: 0,
      remaining: 0,
      reset: Date.now() + 60000,
      headers: {
        'X-RateLimit-Limit': '0',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Date.now() + 60000),
      },
    };
  }

  // Non-critical endpoints: fall back to in-memory rate limiting
  const result = checkInMemoryLimit(identifier, type);

  return {
    ...result,
    headers: {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(result.reset),
    },
  };
}

// ============================================================================
// MIDDLEWARE HELPER
// ============================================================================

/**
 * Rate limit middleware for API routes
 * Returns null if request is allowed, or a 429 response if rate limited
 */
export async function rateLimit(
  req: NextRequest,
  type: RateLimitType = 'api'
): Promise<NextResponse | null> {
  const identifier = getIdentifier(req);
  const result = await checkRateLimit(identifier, type);

  if (!result.success) {
    const response = NextResponse.json(
      {
        error: 'Too many requests',
        message: `Rate limit exceeded. Please try again later.`,
        retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
      },
      { status: 429 }
    );

    // Add rate limit headers
    Object.entries(result.headers).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    response.headers.set('Retry-After', String(Math.ceil((result.reset - Date.now()) / 1000)));

    return response;
  }

  return null;
}

/**
 * Add rate limit headers to a response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult
): NextResponse {
  Object.entries(result.headers).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

// ============================================================================
// WRAPPER FUNCTION
// ============================================================================

/**
 * Wrap an API handler with rate limiting
 */
export function withRateLimit<T extends (...args: any[]) => Promise<NextResponse>>(
  handler: T,
  type: RateLimitType = 'api'
): T {
  return (async (req: NextRequest, ...args: any[]) => {
    const rateLimitResponse = await rateLimit(req, type);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    // Call the original handler
    const response = await handler(req, ...args);

    // Optionally add rate limit headers to successful responses too
    const identifier = getIdentifier(req);
    const result = await checkRateLimit(identifier, type);
    return addRateLimitHeaders(response, result);
  }) as T;
}
