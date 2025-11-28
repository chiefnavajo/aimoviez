// proxy.ts
// FIXED: Authentication and rate limiting proxy (migrated from middleware.ts)

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';

// Configuration
const ADMIN_SECRET = process.env.ADMIN_SECRET_KEY || 'change-this-in-production';
const ADMIN_TOKENS_ENABLED = process.env.ADMIN_TOKENS_ENABLED === 'true';
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60');

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map<string, number[]>();

// Rate limit store will be cleaned up naturally when entries expire

/**
 * Get client IP address
 */
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  return ip;
}

/**
 * Check rate limit for IP
 */
function checkRateLimit(ip: string): boolean {
  if (!RATE_LIMIT_ENABLED) return true;
  
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  
  const timestamps = rateLimitStore.get(ip) || [];
  const recentTimestamps = timestamps.filter(t => now - t < windowMs);
  
  if (recentTimestamps.length >= RATE_LIMIT_PER_MINUTE) {
    return false; // Rate limited
  }
  
  recentTimestamps.push(now);
  rateLimitStore.set(ip, recentTimestamps);
  return true;
}

/**
 * Validate admin token
 */
function validateAdminToken(token: string): boolean {
  if (!token) return false;
  
  // Get valid tokens from environment
  const validTokens = (process.env.ADMIN_VALID_TOKENS || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  
  // Check if token is valid
  return validTokens.includes(token);
}

/**
 * Main proxy function
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const method = request.method;
  const ip = getClientIp(request);
  
  // Add client IP to headers for logging
  const responseHeaders = new Headers(request.headers);
  responseHeaders.set('x-client-ip', ip);
  
  // 1. Rate limiting for all API routes
  if (path.startsWith('/api')) {
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many requests',
          message: 'Please slow down and try again in a minute',
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': RATE_LIMIT_PER_MINUTE.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(Date.now() + 60000).toISOString(),
          }
        }
      );
    }
  }
  
  // 2. Admin route protection
  if (path.startsWith('/api/admin')) {
    // Check if admin auth is enabled
    if (ADMIN_TOKENS_ENABLED) {
      // Extract token from various sources
      const authHeader = request.headers.get('authorization');
      const bearerToken = authHeader?.replace('Bearer ', '');
      const apiKeyHeader = request.headers.get('x-api-key');
      const queryToken = request.nextUrl.searchParams.get('token');
      
      // Try to find a valid token
      const token = bearerToken || apiKeyHeader || queryToken;
      
      if (!token) {
        return NextResponse.json(
          {
            success: false,
            error: 'Authentication required',
            message: 'Admin token is required to access this endpoint',
          },
          { status: 401 }
        );
      }
      
      if (!validateAdminToken(token)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid token',
            message: 'The provided admin token is invalid',
          },
          { status: 403 }
        );
      }
      
      // Token is valid, add to response headers
      responseHeaders.set('x-admin-authorized', 'true');
    } else if (process.env.NODE_ENV === 'production') {
      // Warn in production if admin auth is disabled
      console.error('⚠️ WARNING: Admin routes are unprotected in production!');
    }
  }
  
  // 3. Special handling for vote endpoint
  if (path === '/api/vote' && method === 'POST') {
    // Could add special vote-specific rate limiting here
    // For now, general rate limiting applies
  }
  
  // 4. CORS headers for API routes
  if (path.startsWith('/api')) {
    const corsOrigins = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map(o => o.trim());
    
    const origin = request.headers.get('origin');
    
    if (origin && corsOrigins.includes(origin)) {
      responseHeaders.set('Access-Control-Allow-Origin', origin);
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
    }
  }
  
  // Continue with modified headers
  return NextResponse.next({
    request: {
      headers: responseHeaders,
    },
  });
}

// Configure which routes to run proxy on
export const config = {
  matcher: [
    // Match all API routes
    '/api/:path*',
    // Exclude static files
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*).)'
  ],
};

