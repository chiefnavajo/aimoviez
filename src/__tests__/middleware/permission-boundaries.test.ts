/**
 * @jest-environment node
 */

// =============================================================================
// PERMISSION BOUNDARY TESTS
// Tests that authorization boundaries are enforced across API routes
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

// Mock next-auth/jwt (used by middleware)
const mockGetToken = jest.fn();
jest.mock('next-auth/jwt', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

// Mock next-auth getServerSession (used by route handlers)
const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

// Mock Supabase (prevent real DB calls)
const mockSupabaseFrom = jest.fn().mockReturnValue({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: null, error: { message: 'mocked' } }),
  maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockSupabaseFrom,
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

// Mock rate-limit to not interfere with permission checks
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn().mockResolvedValue(null),
  checkRateLimit: jest.fn().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60000, headers: {} }),
  getIdentifier: jest.fn().mockReturnValue('test-identifier'),
  RATE_LIMITS: {
    vote: { requests: 30, window: '1m' },
    read: { requests: 120, window: '1m' },
    api: { requests: 60, window: '1m' },
    admin: { requests: 30, window: '1m' },
    admin_read: { requests: 30, window: '1m' },
    admin_write: { requests: 15, window: '1m' },
    admin_sensitive: { requests: 5, window: '1m' },
  },
}));

// Mock CSRF to pass by default (we test CSRF separately below)
jest.mock('@/lib/csrf', () => ({
  requireCsrf: jest.fn().mockResolvedValue(null),
  validateCsrfRequest: jest.fn().mockReturnValue({ valid: true }),
  generateCsrfToken: jest.fn().mockReturnValue('test-csrf-token'),
  csrfErrorResponse: jest.fn().mockReturnValue(
    NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
  ),
  csrf: {
    require: jest.fn().mockResolvedValue(null),
    validate: jest.fn().mockReturnValue({ valid: true }),
    generate: jest.fn().mockReturnValue('test-csrf-token'),
  },
  default: {
    require: jest.fn().mockResolvedValue(null),
  },
}));

// Mock auth-options
jest.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

// Mock various lib dependencies to prevent side effects
jest.mock('@/lib/counter-sync', () => ({ forceSyncCounters: jest.fn() }));
jest.mock('@/lib/crdt-vote-counter', () => ({
  clearClips: jest.fn(),
  incrementVote: jest.fn(),
  decrementVote: jest.fn(),
  getCountAndScore: jest.fn(),
}));
jest.mock('@/lib/vote-validation-redis', () => ({
  setSlotState: jest.fn(),
  setVotingFrozen: jest.fn(),
  clearVotingFrozen: jest.fn(),
  validateVoteRedis: jest.fn(),
  recordVote: jest.fn(),
  removeVoteRecord: jest.fn(),
  isVotingFrozen: jest.fn().mockResolvedValue(false),
  seedDailyVoteCount: jest.fn(),
}));
jest.mock('@/lib/device-fingerprint', () => ({
  generateDeviceKey: jest.fn().mockReturnValue('dev_test_key'),
  extractDeviceSignals: jest.fn().mockReturnValue({}),
  assessDeviceRisk: jest.fn().mockReturnValue({ score: 0, reasons: [] }),
  shouldFlagVote: jest.fn().mockReturnValue(false),
}));
jest.mock('@/lib/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn((fn: () => Promise<unknown>) => fn()),
  })),
}));
jest.mock('@/lib/realtime-broadcast', () => ({
  broadcastVoteUpdate: jest.fn(),
}));
jest.mock('@/lib/vote-count-cache', () => ({
  getCachedVoteCounts: jest.fn().mockResolvedValue(new Map()),
  setCachedVoteCounts: jest.fn(),
  updateCachedVoteCount: jest.fn(),
  invalidateVoteCount: jest.fn(),
}));
jest.mock('@/lib/leaderboard-redis', () => ({
  updateClipScore: jest.fn(),
  updateVoterScore: jest.fn(),
  clearSlotLeaderboard: jest.fn(),
}));
jest.mock('@/lib/captcha', () => ({
  verifyCaptcha: jest.fn().mockResolvedValue({ success: true }),
  getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));
jest.mock('@/lib/logger', () => ({
  createRequestLogger: jest.fn().mockReturnValue({}),
  logAudit: jest.fn(),
}));
jest.mock('@/lib/audit-log', () => ({
  logAdminAction: jest.fn(),
}));
jest.mock('@/lib/genres', () => ({
  isValidGenre: jest.fn().mockReturnValue(true),
}));
jest.mock('@/lib/notifications', () => ({
  createNotification: jest.fn(),
}));

// Import middleware
import { middleware } from '@/middleware';

// =============================================================================
// HELPERS
// =============================================================================

function buildRequest(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    cookies?: Record<string, string>;
  } = {}
): NextRequest {
  const { method = 'GET', headers = {}, body, cookies = {} } = options;
  const url = new URL(path, 'http://localhost:3000');

  const reqInit: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'jest-test-agent',
      'x-forwarded-for': '127.0.0.1',
      ...headers,
    },
  };

  if (body && method !== 'GET') {
    reqInit.body = JSON.stringify(body);
  }

  const req = new NextRequest(url, reqInit);

  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }

  return req;
}

// =============================================================================
// 1. ADMIN ROUTE PROTECTION VIA MIDDLEWARE
// =============================================================================

describe('Permission: admin routes reject non-admin users', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetServerSession.mockReset();
  });

  it('unauthenticated request to /admin page is redirected to /', async () => {
    mockGetToken.mockResolvedValue(null);

    const req = buildRequest('/admin');
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('admin')).toBe('required');
  });

  it('regular user accessing /admin/slots page is redirected away', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'user-regular',
      email: 'user@example.com',
      isAdmin: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const req = buildRequest('/admin/slots');
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/');
  });

  it('admin user can access /admin page', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'admin-1',
      email: 'admin@aimoviez.app',
      isAdmin: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const req = buildRequest('/admin');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// 2. UNAUTHENTICATED REQUESTS TO PROTECTED ROUTES
// =============================================================================

describe('Permission: unauthenticated users cannot access protected routes', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  it('/profile redirects to / for unauthenticated users', async () => {
    const req = buildRequest('/profile');
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/');
  });

  it('/movie/abc redirects to / for unauthenticated users', async () => {
    const req = buildRequest('/movie/abc');
    const res = await middleware(req);
    expect(res.status).toBe(307);
  });

  it('/settings redirects to / for unauthenticated users', async () => {
    const req = buildRequest('/settings');
    const res = await middleware(req);
    expect(res.status).toBe(307);
  });

  it('/team redirects to / for unauthenticated users', async () => {
    const req = buildRequest('/team');
    const res = await middleware(req);
    expect(res.status).toBe(307);
  });
});

// =============================================================================
// 3. CSRF TOKEN REQUIRED ON STATE-CHANGING MUTATIONS
// =============================================================================

describe('Permission: CSRF token enforcement in middleware', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  it('POST /api/vote without CSRF header returns 403', async () => {
    const req = buildRequest('/api/vote', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('CSRF');
  });

  it('DELETE /api/vote without CSRF header returns 403', async () => {
    const req = buildRequest('/api/vote', { method: 'DELETE' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });

  it('PUT /api/teams/some-id without CSRF header returns 403', async () => {
    const req = buildRequest('/api/teams/some-id', { method: 'PUT' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });
});

// =============================================================================
// 4. CRON ROUTES REQUIRE CRON_SECRET
// =============================================================================

describe('Permission: cron routes require CRON_SECRET', () => {
  // verifyCronAuth checks process.env.CRON_SECRET
  // We need to import the actual cron-auth to test it properly
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('verifyCronAuth rejects request without authorization header in production', () => {
    // Import the actual function
    jest.isolateModules(() => {
      process.env.CRON_SECRET = 'test-cron-secret-123';
      process.env.NODE_ENV = 'production';

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { verifyCronAuth } = require('@/lib/cron-auth');
      const result = verifyCronAuth(null);

      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });
  });

  it('verifyCronAuth rejects request with wrong secret', () => {
    jest.isolateModules(() => {
      process.env.CRON_SECRET = 'correct-secret';

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { verifyCronAuth } = require('@/lib/cron-auth');
      const result = verifyCronAuth('Bearer wrong-secret');

      expect(result).not.toBeNull();
      expect(result.status).toBe(401);
    });
  });

  it('verifyCronAuth accepts request with correct secret', () => {
    jest.isolateModules(() => {
      process.env.CRON_SECRET = 'correct-secret';

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { verifyCronAuth } = require('@/lib/cron-auth');
      const result = verifyCronAuth('Bearer correct-secret');

      expect(result).toBeNull(); // null = success
    });
  });
});

// =============================================================================
// 5. ADMIN AUTH CHECK (requireAdmin / requireAdminWithAuth)
// =============================================================================

describe('Permission: admin auth guard patterns', () => {
  // Testing admin auth boundary behavior via the middleware token check.
  // The middleware checks token.isAdmin for admin page routes (/admin/*).
  // For API admin routes (/api/admin/*), the route handler calls requireAdmin()
  // which checks the DB. Here we test the middleware-level early rejection.

  beforeEach(() => {
    mockGetToken.mockReset();
  });

  it('middleware rejects unauthenticated request to /api/admin/* (redirect)', async () => {
    mockGetToken.mockResolvedValue(null);

    const req = buildRequest('/api/admin/advance-slot', { method: 'GET' });
    const res = await middleware(req);

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('admin')).toBe('required');
  });

  it('middleware allows authenticated (non-admin) user to /api/admin/* (handler does check)', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      isAdmin: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const req = buildRequest('/api/admin/advance-slot', { method: 'GET' });
    const res = await middleware(req);

    // Middleware lets authenticated users through to API admin routes;
    // the route handler does the full admin DB check
    expect(res.status).toBe(200);
  });

  it('middleware blocks non-admin from /admin page route (not /api/admin)', async () => {
    mockGetToken.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      isAdmin: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const req = buildRequest('/admin/dashboard');
    const res = await middleware(req);

    // Page admin routes are early-rejected at middleware level
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/');
  });
});

// =============================================================================
// 6. CSRF VALIDATION LIBRARY (route-handler level)
// =============================================================================

describe('Permission: CSRF double-submit cookie pattern validation', () => {
  // The CSRF module is mocked at module level for the other tests.
  // Here we test the middleware's CSRF validation behavior which is NOT mocked
  // (the middleware has its own inline CSRF validation, separate from lib/csrf).

  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockResolvedValue(null);
  });

  it('middleware allows GET to API routes without CSRF (safe method)', async () => {
    const req = buildRequest('/api/vote', { method: 'GET' });
    const res = await middleware(req);
    // GET is safe -- should pass through
    expect(res.status).not.toBe(403);
  });

  it('middleware rejects POST to non-exempt API route without CSRF header', async () => {
    const req = buildRequest('/api/vote', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('CSRF');
  });

  it('middleware rejects CSRF when header and cookie tokens do not match', async () => {
    const req = buildRequest('/api/vote', {
      method: 'POST',
      headers: { 'x-csrf-token': 'token-from-header' },
      cookies: { 'csrf-token': 'different-token-in-cookie' },
    });
    const res = await middleware(req);
    expect(res.status).toBe(403);
  });
});
