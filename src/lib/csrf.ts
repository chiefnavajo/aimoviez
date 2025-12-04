// lib/csrf.ts
// ============================================================================
// CSRF PROTECTION
// Token-based CSRF protection for state-changing operations
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

// In production, CSRF_SECRET or NEXTAUTH_SECRET must be set - no fallback for security
const CSRF_SECRET = process.env.CSRF_SECRET || process.env.NEXTAUTH_SECRET || (
  process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('CSRF_SECRET or NEXTAUTH_SECRET must be set in production'); })()
    : 'dev-only-csrf-secret-not-for-production'
);
const CSRF_TOKEN_HEADER = 'x-csrf-token';
const CSRF_TOKEN_COOKIE = 'csrf-token';
const TOKEN_EXPIRY = 60 * 60 * 1000; // 1 hour in milliseconds

// ============================================================================
// TOKEN GENERATION
// ============================================================================

/**
 * Generate a CSRF token
 * Format: timestamp.randomBytes.signature
 * Includes cryptographic randomness to prevent prediction attacks
 */
export function generateCsrfToken(): string {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(timestamp + randomBytes)
    .digest('hex')
    .slice(0, 32);

  return `${timestamp}.${randomBytes}.${signature}`;
}

/**
 * Verify a CSRF token
 * Supports new format (timestamp.randomBytes.signature) and legacy format (timestamp.signature)
 */
export function verifyCsrfToken(token: string): { valid: boolean; error?: string } {
  if (!token) {
    return { valid: false, error: 'Missing CSRF token' };
  }

  const parts = token.split('.');

  // Support both new format (3 parts) and legacy format (2 parts) for backwards compatibility
  if (parts.length !== 3 && parts.length !== 2) {
    return { valid: false, error: 'Invalid CSRF token format' };
  }

  const isNewFormat = parts.length === 3;
  const timestamp = parts[0];
  const randomBytes = isNewFormat ? parts[1] : '';
  const signature = isNewFormat ? parts[2] : parts[1];

  const timestampNum = parseInt(timestamp, 10);

  // Check if timestamp is valid
  if (isNaN(timestampNum)) {
    return { valid: false, error: 'Invalid CSRF token timestamp' };
  }

  // Check if token has expired
  if (Date.now() - timestampNum > TOKEN_EXPIRY) {
    return { valid: false, error: 'CSRF token expired' };
  }

  // Verify signature (include randomBytes if new format)
  const dataToSign = isNewFormat ? timestamp + randomBytes : timestamp;
  const expectedSignature = crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(dataToSign)
    .digest('hex')
    .slice(0, 32);

  // Use timing-safe comparison
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, error: 'Invalid CSRF token signature' };
  }

  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, error: 'Invalid CSRF token signature' };
  }

  return { valid: true };
}

// ============================================================================
// MIDDLEWARE HELPERS
// ============================================================================

/**
 * Validate CSRF token from request
 * Checks both header and cookie
 */
export function validateCsrfRequest(request: NextRequest): { valid: boolean; error?: string } {
  // Get token from header
  const headerToken = request.headers.get(CSRF_TOKEN_HEADER);

  // Get token from cookie
  const cookieToken = request.cookies.get(CSRF_TOKEN_COOKIE)?.value;

  // Both must be present and match
  if (!headerToken) {
    return { valid: false, error: 'Missing CSRF token in header' };
  }

  if (!cookieToken) {
    return { valid: false, error: 'Missing CSRF token in cookie' };
  }

  // Tokens must match (double-submit cookie pattern)
  if (headerToken !== cookieToken) {
    return { valid: false, error: 'CSRF token mismatch' };
  }

  // Verify the token itself
  return verifyCsrfToken(headerToken);
}

/**
 * Create CSRF error response
 */
export function csrfErrorResponse(_error: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'CSRF validation failed',
      message: 'Please refresh the page and try again',
    },
    { status: 403 }
  );
}

/**
 * Add CSRF token to response (sets cookie)
 */
export function addCsrfTokenToResponse(response: NextResponse): NextResponse {
  const token = generateCsrfToken();

  response.cookies.set(CSRF_TOKEN_COOKIE, token, {
    httpOnly: false, // Must be readable by JavaScript
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: TOKEN_EXPIRY / 1000, // Convert to seconds
  });

  return response;
}

// ============================================================================
// REQUIRE CSRF MIDDLEWARE
// ============================================================================

/**
 * Middleware function to require CSRF validation
 * Use at the start of state-changing API routes
 */
export async function requireCsrf(request: NextRequest): Promise<NextResponse | null> {
  // Skip CSRF for safe methods
  const safeMethodsPattern = /^(GET|HEAD|OPTIONS)$/i;
  if (safeMethodsPattern.test(request.method)) {
    return null;
  }

  const validation = validateCsrfRequest(request);

  if (!validation.valid) {
    console.warn('[CSRF] Validation failed:', {
      error: validation.error,
      method: request.method,
      path: request.nextUrl.pathname,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    });

    return csrfErrorResponse(validation.error || 'CSRF validation failed');
  }

  return null;
}

// ============================================================================
// CLIENT-SIDE HELPER
// ============================================================================

/**
 * Get CSRF token from cookie (for client-side use)
 * Usage in fetch: headers: { 'x-csrf-token': getCsrfToken() }
 */
export function getCsrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_TOKEN_COOKIE) {
      return value;
    }
  }
  return null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const csrf = {
  generate: generateCsrfToken,
  verify: verifyCsrfToken,
  validate: validateCsrfRequest,
  require: requireCsrf,
  addToResponse: addCsrfTokenToResponse,
  getFromCookie: getCsrfTokenFromCookie,
  HEADER_NAME: CSRF_TOKEN_HEADER,
  COOKIE_NAME: CSRF_TOKEN_COOKIE,
};

export default csrf;
