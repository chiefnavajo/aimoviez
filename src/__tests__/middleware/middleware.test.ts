/**
 * @jest-environment node
 */

// =============================================================================
// MIDDLEWARE TESTS
// Tests the main Next.js middleware (src/middleware.ts)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Mock next-auth/jwt
// ---------------------------------------------------------------------------
const mockGetToken = jest.fn();
jest.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

// Import the middleware under test AFTER mocks are in place
import { middleware, config } from '@/middleware';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Build a NextRequest for the given path, method, and optional headers/cookies.
 */
function buildRequest(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    origin?: string;
  } = {}
): NextRequest {
  const { method = 'GET', headers = {}, cookies = {}, origin } = options;
  const url = new URL(path, 'http://localhost:3000');

  const allHeaders: Record<string, string> = {
    'user-agent': 'jest-test-agent',
    ...headers,
  };
  if (origin) {
    allHeaders['origin'] = origin;
  }

  const req = new NextRequest(url, {
    method,
    headers: allHeaders,
  });

  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }

  return req;
}

// =============================================================================
// 1. ROUTE MATCHER CONFIG
// =============================================================================

describe('Middleware route matcher config', () => {
  // The config.matcher pattern is a Next.js path-to-regexp pattern, not a raw JS RegExp.
  // Next.js applies it via path-to-regexp which strips the leading "/" before matching.
  // We convert it to a proper anchored regex that simulates Next.js's behavior.
  const rawPattern = config.matcher[0];

  // Next.js anchors the negative-lookahead matcher to the path after '/'
  // We build a full-string anchored regex for testing
  const anchoredRegex = new RegExp(`^${rawPattern}$`);

  /**
   * Simulate Next.js matcher: test the full request path against the
   * anchored pattern. This is an approximation that works for the
   * negative-lookahead pattern used in this project.
   */
  function matches(path: string): boolean {
    return anchoredRegex.test(path);
  }

  it('matches the root path /', () => {
    expect(matches('/')).toBe(true);
  });

  it('matches /dashboard', () => {
    expect(matches('/dashboard')).toBe(true);
  });

  it('matches /api/vote', () => {
    expect(matches('/api/vote')).toBe(true);
  });

  it('matches /admin/slots', () => {
    expect(matches('/admin/slots')).toBe(true);
  });

  it('does NOT match /_next/static/chunk.js', () => {
    expect(matches('/_next/static/chunk.js')).toBe(false);
  });

  it('does NOT match /favicon.ico', () => {
    expect(matches('/favicon.ico')).toBe(false);
  });

  it('does NOT match image files (.png)', () => {
    expect(matches('/images/logo.png')).toBe(false);
  });

  it('does NOT match .svg files', () => {
    expect(matches('/icons/play.svg')).toBe(false);
  });

  it('does NOT match .webp files', () => {
    expect(matches('/photos/hero.webp')).toBe(false);
  });

  it('the matcher array has exactly one pattern', () => {
    expect(config.matcher).toHaveLength(1);
  });
});

// =============================================================================
// 2. AUTH REDIRECTS FOR PROTECTED ROUTES
// =============================================================================

describe('Middleware auth redirects for protected routes', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
  });

  const protectedPaths = [
    '/dashboard',
    '/profile',
    '/upload',
    '/story',
    '/watch',
    '/leaderboard',
    '/create',
    '/team',
    '/movie',
    '/settings',
  ];

  it.each(protectedPaths)(
    'redirects unauthenticated user from %s to /',
    async (path) => {
      mockGetToken.mockResolvedValue(null);

      const req = buildRequest(path);
      const res = await middleware(req);

      expect(res.status).toBe(307);
      const location = new URL(res.headers.get('location')!);
      expect(location.pathname).toBe('/');
      expect(location.searchParams.get('callbackUrl')).toBe(path);
    }
  );

  it('allows authenticated user through to protected route', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const req = buildRequest('/profile');
    const res = await middleware(req);

    // NextResponse.next() returns a response without a redirect
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});

// =============================================================================
// 3. EXPIRED SESSION HANDLING
// =============================================================================

describe('Middleware expired session handling', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
  });

  it('redirects to / with expired=true when session token has expired', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      exp: Math.floor(Date.now() / 1000) - 100, // expired 100 seconds ago
    });

    const req = buildRequest('/dashboard');
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('expired')).toBe('true');
    expect(location.searchParams.get('callbackUrl')).toBe('/dashboard');
  });

  it('clears session cookies on expiry', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) - 100,
    });

    const req = buildRequest('/profile');
    const res = await middleware(req);

    // The middleware calls response.cookies.delete() which sets the cookie
    // with an expiry in the past. Check set-cookie headers for the session token names.
    const setCookies = res.headers.getSetCookie();
    const sessionCookiePresent = setCookies.some(
      (c: string) => c.includes('next-auth.session-token')
    );
    const secureCookiePresent = setCookies.some(
      (c: string) => c.includes('__Secure-next-auth.session-token')
    );
    // At least one of the session cookies should be cleared
    expect(sessionCookiePresent || secureCookiePresent).toBe(true);
  });

  it('does NOT check token expiry on non-protected routes', async () => {
    // Even though token is expired, non-protected routes should still work
    mockGetToken.mockResolvedValue({
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) - 100,
    });

    const req = buildRequest('/');
    const res = await middleware(req);

    // Should not redirect
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// 4. CORS HEADERS
// =============================================================================

describe('Middleware CORS headers', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  it('returns 204 with CORS headers for OPTIONS preflight from allowed origin', async () => {
    const req = buildRequest('/api/vote', {
      method: 'OPTIONS',
      origin: 'https://aimoviez.app',
    });
    const res = await middleware(req);

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://aimoviez.app');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('does NOT set CORS Allow-Origin for disallowed origin on preflight', async () => {
    const req = buildRequest('/api/vote', {
      method: 'OPTIONS',
      origin: 'https://evil.com',
    });
    const res = await middleware(req);

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds CORS origin header for allowed origin on regular request', async () => {
    const req = buildRequest('/api/health/redis', {
      origin: 'https://www.aimoviez.app',
    });
    const res = await middleware(req);

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.aimoviez.app');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('does NOT set CORS origin for disallowed origin on regular request', async () => {
    const req = buildRequest('/api/health/redis', {
      origin: 'https://attacker.example',
    });
    const res = await middleware(req);

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

// =============================================================================
// 5. CSP AND SECURITY HEADERS
// =============================================================================

describe('Middleware security headers', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  it('sets X-Frame-Options to DENY', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets X-Content-Type-Options to nosniff', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets X-XSS-Protection', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);
    expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
  });

  it('sets Referrer-Policy', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy blocking camera/mic/geo', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);
    expect(res.headers.get('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=()'
    );
  });

  it('sets Content-Security-Policy with frame-ancestors none', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);
    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it('CSP includes self and unsafe-inline in script-src', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);
    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });

  it('CSP includes supabase and dicebear in img-src', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);
    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp).toContain('https://*.supabase.co');
    expect(csp).toContain('https://api.dicebear.com');
  });

  it('security headers are set on preflight responses too', async () => {
    const req = buildRequest('/api/vote', {
      method: 'OPTIONS',
      origin: 'https://aimoviez.app',
    });
    const res = await middleware(req);
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

// =============================================================================
// 6. ADMIN ROUTE PROTECTION
// =============================================================================

describe('Middleware admin route protection', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
  });

  it('redirects unauthenticated user from /admin to / with admin=required', async () => {
    mockGetToken.mockResolvedValue(null);

    const req = buildRequest('/admin');
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('admin')).toBe('required');
  });

  it('redirects non-admin user from /admin/slots to / (page route)', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'user-1',
      email: 'regular@example.com',
      isAdmin: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const req = buildRequest('/admin/slots');
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/');
  });

  it('allows admin user through to /admin page route', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin@aimoviez.app',
      isAdmin: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const req = buildRequest('/admin/slots');
    const res = await middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('lets /api/admin through for authenticated users (route handler does full check)', async () => {
    // The middleware only does an early rejection for page routes.
    // For API admin routes, it checks authentication but defers isAdmin check
    // to the route handler via requireAdmin().
    mockGetToken.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      isAdmin: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const req = buildRequest('/api/admin/advance-slot');
    const res = await middleware(req);

    // Should pass through (not redirect) -- the API handler does the admin check
    expect(res.status).toBe(200);
  });

  it('redirects unauthenticated user from /api/admin to /', async () => {
    mockGetToken.mockResolvedValue(null);

    const req = buildRequest('/api/admin/advance-slot');
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('admin')).toBe('required');
  });
});

// =============================================================================
// 7. API ROUTE HANDLING (PASSES THROUGH)
// =============================================================================

describe('Middleware API route pass-through', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  it('passes through GET /api/health/redis without auth', async () => {
    const req = buildRequest('/api/health/redis');
    const res = await middleware(req);

    // Non-protected API route should continue
    expect(res.status).toBe(200);
  });

  it('passes through GET /api/vote without auth (vote GET is public)', async () => {
    const req = buildRequest('/api/vote');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('does NOT set CSRF cookie on API route responses', async () => {
    const req = buildRequest('/api/vote');
    const res = await middleware(req);

    // addCsrfToken only runs for non-API routes
    const setCookies = res.headers.getSetCookie();
    const hasCsrfCookie = setCookies.some((c: string) => c.includes('csrf-token'));
    expect(hasCsrfCookie).toBe(false);
  });
});

// =============================================================================
// 8. CSRF TOKEN HANDLING
// =============================================================================

describe('Middleware CSRF token management', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  it('sets a csrf-token cookie on page requests (no existing cookie)', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);

    const setCookies = res.headers.getSetCookie();
    const csrfCookie = setCookies.find((c: string) => c.startsWith('csrf-token='));
    expect(csrfCookie).toBeDefined();
    // Should not be httpOnly (JS needs to read it)
    expect(csrfCookie).not.toContain('HttpOnly');
    // Next.js serializes SameSite in lowercase
    expect(csrfCookie!.toLowerCase()).toContain('samesite=strict');
    expect(csrfCookie).toContain('Path=/');
  });

  it('does NOT set a new csrf-token if a valid one already exists', async () => {
    // Build a valid token: timestamp.randomBytes.signature
    const now = Date.now().toString();
    const req = buildRequest('/', {
      cookies: {
        'csrf-token': `${now}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
      },
    });

    // We need to set the cookie on the actual request
    const res = await middleware(req);

    // The middleware checks the format: 3 parts, valid timestamp, not expired.
    // Since the signature won't match the HMAC, but the middleware's addCsrfToken
    // only checks format and expiry (not signature) for deciding whether to issue new.
    // Actually it just checks parts.length and timestamp expiry.
    const setCookies = res.headers.getSetCookie();
    const csrfCookie = setCookies.find((c: string) => c.startsWith('csrf-token='));
    // Should not set a new one because format is valid and not expired
    expect(csrfCookie).toBeUndefined();
  });

  it('sets a new csrf-token if the existing one is expired', async () => {
    const expiredTimestamp = (Date.now() - 2 * 60 * 60 * 1000).toString(); // 2 hours ago
    const req = buildRequest('/', {
      cookies: {
        'csrf-token': `${expiredTimestamp}.aaaa.bbbb`,
      },
    });

    const res = await middleware(req);

    const setCookies = res.headers.getSetCookie();
    const csrfCookie = setCookies.find((c: string) => c.startsWith('csrf-token='));
    expect(csrfCookie).toBeDefined();
  });
});

// =============================================================================
// 9. CSRF VALIDATION FOR STATE-CHANGING API REQUESTS
// =============================================================================

describe('Middleware CSRF validation on POST/PUT/DELETE API routes', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  it('rejects POST /api/vote without CSRF token (403)', async () => {
    const req = buildRequest('/api/vote', { method: 'POST' });
    const res = await middleware(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('CSRF validation failed');
  });

  it('rejects PUT /api/teams/abc without CSRF token', async () => {
    const req = buildRequest('/api/teams/abc', { method: 'PUT' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it('rejects DELETE /api/vote without CSRF token', async () => {
    const req = buildRequest('/api/vote', { method: 'DELETE' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it('rejects PATCH /api/some-route without CSRF token', async () => {
    const req = buildRequest('/api/some-route', { method: 'PATCH' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it('allows GET /api/vote without CSRF token (safe method)', async () => {
    const req = buildRequest('/api/vote', { method: 'GET' });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('exempts /api/auth/ routes from CSRF', async () => {
    const req = buildRequest('/api/auth/callback/google', { method: 'POST' });
    const res = await middleware(req);
    // Should NOT be 403 - auth routes are CSRF exempt
    expect(res.status).not.toBe(403);
  });

  it('exempts /api/cron/ routes from CSRF', async () => {
    const req = buildRequest('/api/cron/auto-advance', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).not.toBe(403);
  });

  it('exempts /api/health routes from CSRF', async () => {
    const req = buildRequest('/api/health', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).not.toBe(403);
  });

  it('exempts /api/webhooks/ routes from CSRF', async () => {
    const req = buildRequest('/api/webhooks/stripe', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).not.toBe(403);
  });

  it('exempts /api/notifications/subscribe from CSRF', async () => {
    const req = buildRequest('/api/notifications/subscribe', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).not.toBe(403);
  });
});

// =============================================================================
// 10. PUBLIC PAGES (NO AUTH REQUIRED)
// =============================================================================

describe('Middleware allows public pages', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  it('allows / without auth', async () => {
    const req = buildRequest('/');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows /about without auth', async () => {
    const req = buildRequest('/about');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('allows /login without auth', async () => {
    const req = buildRequest('/login');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});
