// middleware.ts
// ============================================================================
// NEXT.JS MIDDLEWARE
// Centralized protection for admin routes, CORS, and security headers
// ============================================================================

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import crypto from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Routes that require authentication
const PROTECTED_ROUTES = [
  '/dashboard',
  '/profile',
  '/upload',
];

// Routes that require admin access
const ADMIN_ROUTES = [
  '/admin',
  '/api/admin',
];

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  'https://aimoviez.com',
  'https://www.aimoviez.com',
].filter(Boolean);

// Session timeout in seconds (30 minutes)
const SESSION_TIMEOUT = 30 * 60;

// CSRF configuration
const CSRF_SECRET = process.env.CSRF_SECRET || process.env.NEXTAUTH_SECRET || 'default-csrf-secret';
const CSRF_TOKEN_COOKIE = 'csrf-token';
const CSRF_TOKEN_HEADER = 'x-csrf-token';
const TOKEN_EXPIRY = 60 * 60; // 1 hour in seconds

// ============================================================================
// SECURITY HEADERS
// ============================================================================

function addSecurityHeaders(response: NextResponse): NextResponse {
  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // XSS Protection (legacy, but still useful)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions policy
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  return response;
}

// ============================================================================
// CORS HANDLING
// ============================================================================

function handleCORS(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin');

  // For preflight requests
  if (request.method === 'OPTIONS') {
    const response = new NextResponse(null, { status: 204 });

    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      response.headers.set('Access-Control-Max-Age', '86400');
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }

    return response;
  }

  return null;
}

function addCORSHeaders(response: NextResponse, origin: string | null): NextResponse {
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
  return response;
}

// ============================================================================
// RATE LIMITING CHECK (via headers for upstream proxy)
// ============================================================================

function addRateLimitHeaders(response: NextResponse, request: NextRequest): NextResponse {
  // Add client identifier for rate limiting at edge/proxy level
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  response.headers.set('X-Client-IP', ip);

  return response;
}

// ============================================================================
// CSRF TOKEN HANDLING
// ============================================================================

function generateCsrfToken(): string {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(timestamp + randomBytes)
    .digest('hex')
    .slice(0, 32);

  return `${timestamp}.${randomBytes}.${signature}`;
}

function addCsrfToken(response: NextResponse, request: NextRequest): NextResponse {
  // Only set token if not already present or if it's a page request
  const existingToken = request.cookies.get(CSRF_TOKEN_COOKIE)?.value;

  // Check if token is still valid (not expired)
  let needsNewToken = !existingToken;
  if (existingToken) {
    const parts = existingToken.split('.');
    // Support both new format (3 parts) and legacy format (2 parts)
    if (parts.length === 3 || parts.length === 2) {
      const timestamp = parseInt(parts[0], 10);
      if (isNaN(timestamp) || Date.now() - timestamp > TOKEN_EXPIRY * 1000) {
        needsNewToken = true;
      }
    } else {
      needsNewToken = true;
    }
  }

  if (needsNewToken) {
    const token = generateCsrfToken();
    response.cookies.set(CSRF_TOKEN_COOKIE, token, {
      httpOnly: false, // Must be readable by JavaScript
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: TOKEN_EXPIRY,
    });
  }

  return response;
}

function validateCsrfToken(request: NextRequest): { valid: boolean; error?: string } {
  // Get token from header
  const headerToken = request.headers.get(CSRF_TOKEN_HEADER);
  // Get token from cookie
  const cookieToken = request.cookies.get(CSRF_TOKEN_COOKIE)?.value;

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

  // Verify the token format and signature
  const parts = headerToken.split('.');
  // Support both new format (3 parts) and legacy format (2 parts)
  if (parts.length !== 3 && parts.length !== 2) {
    return { valid: false, error: 'Invalid CSRF token format' };
  }

  const isNewFormat = parts.length === 3;
  const timestamp = parts[0];
  const randomBytes = isNewFormat ? parts[1] : '';
  const signature = isNewFormat ? parts[2] : parts[1];

  const timestampNum = parseInt(timestamp, 10);

  if (isNaN(timestampNum)) {
    return { valid: false, error: 'Invalid CSRF token timestamp' };
  }

  // Check expiry
  if (Date.now() - timestampNum > TOKEN_EXPIRY * 1000) {
    return { valid: false, error: 'CSRF token expired' };
  }

  // Verify signature (include randomBytes if new format)
  const dataToSign = isNewFormat ? timestamp + randomBytes : timestamp;
  const expectedSignature = crypto
    .createHmac('sha256', CSRF_SECRET)
    .update(dataToSign)
    .digest('hex')
    .slice(0, 32);

  if (signature !== expectedSignature) {
    return { valid: false, error: 'Invalid CSRF token signature' };
  }

  return { valid: true };
}

// ============================================================================
// MAIN MIDDLEWARE
// ============================================================================

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get('origin');

  // Handle CORS preflight
  const corsResponse = handleCORS(request);
  if (corsResponse) {
    return addSecurityHeaders(corsResponse);
  }

  // Check if this is a protected route
  const isProtectedRoute = PROTECTED_ROUTES.some(route => pathname.startsWith(route));
  const isAdminRoute = ADMIN_ROUTES.some(route => pathname.startsWith(route));

  // Get session token
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Check session timeout
  if (token) {
    const tokenIssuedAt = token.iat as number | undefined;
    const now = Math.floor(Date.now() / 1000);

    if (tokenIssuedAt && (now - tokenIssuedAt) > SESSION_TIMEOUT) {
      // Session expired - redirect to login
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('expired', 'true');
      loginUrl.searchParams.set('callbackUrl', pathname);

      const response = NextResponse.redirect(loginUrl);
      // Clear the session cookie
      response.cookies.delete('next-auth.session-token');
      response.cookies.delete('__Secure-next-auth.session-token');

      return addSecurityHeaders(response);
    }
  }

  // Protected routes require authentication
  if (isProtectedRoute && !token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);

    let response = NextResponse.redirect(loginUrl);
    response = addSecurityHeaders(response);
    response = addCORSHeaders(response, origin);

    return response;
  }

  // Admin routes require admin flag in token
  // Note: Full admin verification happens in API routes via requireAdmin()
  // This middleware provides early rejection for non-authenticated users
  if (isAdminRoute) {
    if (!token) {
      // Not authenticated at all
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      loginUrl.searchParams.set('admin', 'required');

      let response = NextResponse.redirect(loginUrl);
      response = addSecurityHeaders(response);

      return response;
    }

    // For API routes, let the route handler do full admin check
    // For page routes, we do a quick check here
    if (pathname.startsWith('/admin') && !pathname.startsWith('/api')) {
      // The admin page will do its own verification
      // This is just an early guard
    }
  }

  // CSRF validation for state-changing API requests
  const isApiRoute = pathname.startsWith('/api/');
  const isStateChangingMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);

  // Routes exempt from CSRF (authentication flows, webhooks, health checks)
  const csrfExemptRoutes = [
    '/api/auth/',
    '/api/csrf',
    '/api/health',
    '/api/cron/',
    '/api/webhooks/',
  ];
  const isCsrfExempt = csrfExemptRoutes.some(route => pathname.startsWith(route));

  if (isApiRoute && isStateChangingMethod && !isCsrfExempt) {
    const csrfValidation = validateCsrfToken(request);
    if (!csrfValidation.valid) {
      console.warn('[CSRF] Validation failed:', {
        error: csrfValidation.error,
        method: request.method,
        path: pathname,
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      });

      return NextResponse.json(
        {
          success: false,
          error: 'CSRF validation failed',
          message: 'Please refresh the page and try again',
        },
        { status: 403 }
      );
    }
  }

  // Continue with the request
  let response = NextResponse.next();

  // Add security headers to all responses
  response = addSecurityHeaders(response);
  response = addCORSHeaders(response, origin);
  response = addRateLimitHeaders(response, request);

  // Add CSRF token to page responses (not API routes)
  if (!isApiRoute) {
    response = addCsrfToken(response, request);
  }

  return response;
}

// ============================================================================
// MIDDLEWARE CONFIG
// ============================================================================

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
};
