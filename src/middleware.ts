// middleware.ts
// Next.js middleware for rate limiting and authentication

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Configuration
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== 'false';
const RATE_LIMIT_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60');

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map<string, number[]>();

/**
 * Get client IP address
 */
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]?.trim() : req.headers.get('x-real-ip') || 'unknown';
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

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const ip = getClientIp(request);
  
  // Exclude NextAuth routes from rate limiting
  // NextAuth makes many requests during auth flow (session checks, CSRF tokens, etc.)
  const isNextAuthRoute = path.startsWith('/api/auth');
  const isSessionRoute = path.includes('/session') || path.includes('/csrf');
  
  // Apply rate limiting only to API routes (except NextAuth)
  if (path.startsWith('/api') && !isNextAuthRoute && !isSessionRoute) {
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
  
  // Continue with the request
  return NextResponse.next();
}

// Configure which routes to run middleware on
export const config = {
  matcher: [
    // Match all API routes
    '/api/:path*',
  ],
};

