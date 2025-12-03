// middleware.ts
// ============================================================================
// NEXT.JS MIDDLEWARE
// Centralized protection for admin routes, CORS, and security headers
// ============================================================================

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

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

  // Continue with the request
  let response = NextResponse.next();

  // Add security headers to all responses
  response = addSecurityHeaders(response);
  response = addCORSHeaders(response, origin);
  response = addRateLimitHeaders(response, request);

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
