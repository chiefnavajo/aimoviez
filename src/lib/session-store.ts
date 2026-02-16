// lib/session-store.ts
// ============================================================================
// REDIS SESSION STORE
// Fast session lookups via Redis. Eliminates per-request DB queries for user
// data in API routes. Falls back to getServerSession() + Supabase on Redis
// miss or failure.
// ============================================================================

import { Redis } from '@upstash/redis';
import { getToken } from 'next-auth/jwt';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Session TTL: 30 minutes (matches middleware idle timeout) */
const SESSION_TTL = 30 * 60;

/** Email-to-userId mapping TTL: 24 hours */
const EMAIL_MAP_TTL = 24 * 60 * 60;

// ============================================================================
// TYPES
// ============================================================================

export interface SessionData {
  userId: string;
  email: string;
  username: string | null;
  hasProfile: boolean;
  isAdmin: boolean;
  avatarUrl: string | null;
  cachedAt: number;
}

// ============================================================================
// REDIS CLIENT
// ============================================================================

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  redis = new Redis({ url, token });
  return redis;
}

// ============================================================================
// KEY GENERATORS
// ============================================================================

const KEYS = {
  session: (userId: string) => `session:${userId}`,
  emailMap: (email: string) =>
    `session:email:${crypto.createHash('sha256').update(email).digest('hex')}`,
} as const;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Fast session lookup: JWT → Redis → fallback to getServerSession + Supabase.
 * Returns null if no session exists (user not authenticated).
 *
 * When `redis_session_store` flag is disabled, falls through to the
 * getServerSession() + Supabase lookup path directly.
 */
export async function getSessionFast(
  req: NextRequest,
  featureEnabled: boolean = false
): Promise<SessionData | null> {
  // --- Fast path: read JWT claims via getToken (no DB query) ---
  let token;
  try {
    token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  } catch {
    return null;
  }

  if (!token?.email) return null;

  const userId = token.userId as string | null;

  // --- Redis path (when enabled and userId is available) ---
  if (featureEnabled && userId) {
    const r = getRedis();
    if (r) {
      try {
        const cached = await r.get<SessionData>(KEYS.session(userId));
        if (cached) {
          return cached;
        }
      } catch (err) {
        console.warn('[SessionStore] Redis read error, falling back:', err);
      }
    }
  }

  // --- Fallback: getServerSession + Supabase lookup ---
  return resolveSessionFromDb(req, token, featureEnabled);
}

/**
 * Populate or update the Redis session cache.
 * Called from auth-options.ts JWT callback on profile refresh.
 * Fire-and-forget — never throws.
 */
export async function refreshSession(
  userId: string,
  data: SessionData
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    const pipeline = r.pipeline();
    pipeline.set(KEYS.session(userId), data, { ex: SESSION_TTL });

    if (data.email) {
      pipeline.set(KEYS.emailMap(data.email), userId, { ex: EMAIL_MAP_TTL });
    }

    await pipeline.exec();
  } catch (err) {
    console.warn('[SessionStore] Redis write error:', err);
  }
}

/**
 * Invalidate a session in Redis.
 * Call on logout or role changes.
 */
export async function invalidateSession(userId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.del(KEYS.session(userId));
  } catch (err) {
    console.warn('[SessionStore] Redis delete error:', err);
  }
}

// ============================================================================
// INTERNAL
// ============================================================================

async function resolveSessionFromDb(
  req: NextRequest,
  token: Record<string, unknown>,
  featureEnabled: boolean
): Promise<SessionData | null> {
  // If we already have userId and username in the JWT, we can skip the DB query
  if (token.userId && token.username !== undefined) {
    const sessionData: SessionData = {
      userId: String(token.userId),
      email: String(token.email),
      username: token.username ? String(token.username) : null,
      hasProfile: !!token.hasProfile,
      isAdmin: token.isAdmin === true, // Use isAdmin from JWT if available
      avatarUrl: null,
      cachedAt: Date.now(),
    };

    // Populate Redis for next request (fire-and-forget)
    if (featureEnabled) {
      refreshSession(sessionData.userId, sessionData).catch(() => {});
    }

    return sessionData;
  }

  // Full fallback: getServerSession + Supabase query
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return null;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) return null;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: user } = await supabase
      .from('users')
      .select('id, username, avatar_url, is_admin')
      .eq('email', session.user.email)
      .single();

    if (!user) return null;

    const sessionData: SessionData = {
      userId: user.id,
      email: session.user.email,
      username: user.username || null,
      hasProfile: true,
      isAdmin: user.is_admin || false,
      avatarUrl: user.avatar_url || null,
      cachedAt: Date.now(),
    };

    // Populate Redis for next request (fire-and-forget)
    if (featureEnabled) {
      refreshSession(sessionData.userId, sessionData).catch(() => {});
    }

    return sessionData;
  } catch (err) {
    console.error('[SessionStore] DB fallback error:', err);
    return null;
  }
}
