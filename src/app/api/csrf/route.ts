// app/api/csrf/route.ts
// ============================================================================
// CSRF TOKEN ENDPOINT
// Returns a fresh CSRF token for client-side use
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { generateCsrfToken } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';

const CSRF_TOKEN_COOKIE = 'csrf-token';
const TOKEN_EXPIRY = 60 * 60; // 1 hour in seconds

/**
 * GET /api/csrf
 * Get a fresh CSRF token
 */
export async function GET(request: NextRequest) {
  // Rate limit to prevent token enumeration/abuse
  const rateLimitResponse = await rateLimit(request, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  const token = generateCsrfToken();

  const response = NextResponse.json({
    success: true,
    token,
  });

  // Set the token in a cookie
  response.cookies.set(CSRF_TOKEN_COOKIE, token, {
    httpOnly: false, // Must be readable by JavaScript
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: TOKEN_EXPIRY,
  });

  return response;
}
