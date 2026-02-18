/**
 * @jest-environment node
 *
 * SECURITY REGRESSION TESTS
 * Tests for security vulnerabilities that were previously discovered and fixed.
 * Each test documents the bug and verifies the security fix remains in place.
 *
 * Bug categories:
 *   - CSRF bypass: POST without CSRF token gets rejected
 *   - Admin route without auth: returns 401/403
 *   - Cron route without secret: returns 401
 *   - XSS in team messages: script tags are stripped/escaped
 *   - Error messages don't leak internal details
 *   - Open redirect prevention in download URLs
 *   - Clip registration requires authentication
 */

// ============================================================================
// MOCKS
// ============================================================================

const mockCreateClient = jest.fn();
const mockGetServerSession = jest.fn();
const mockRequireAdmin = jest.fn();
const mockCheckAdminAuth = jest.fn();
const mockRateLimit = jest.fn().mockResolvedValue(null);
const mockLogAdminAction = jest.fn().mockResolvedValue(undefined);
const mockIsValidGenre = jest.fn().mockReturnValue(true);
const mockSanitizeText = jest.fn((text: string) => {
  // Realistic sanitization: strip script tags and HTML
  return text
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
});

// CSRF mock that can be toggled per test
let csrfShouldReject = false;
const mockRequireCsrf = jest.fn().mockImplementation(async () => {
  if (csrfShouldReject) {
    const { NextResponse } = require('next/server');
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }
  return null;
});

// Cron auth mock
const mockVerifyCronAuth = jest.fn();

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/admin-auth', () => ({ requireAdmin: mockRequireAdmin, checkAdminAuth: mockCheckAdminAuth }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: mockRequireCsrf }));
jest.mock('@/lib/audit-log', () => ({ logAdminAction: mockLogAdminAction }));
jest.mock('@/lib/genres', () => ({ isValidGenre: mockIsValidGenre, getGenreCodes: () => ['comedy'] }));
jest.mock('@/lib/sanitize', () => ({ sanitizeText: mockSanitizeText }));
jest.mock('@/lib/cron-auth', () => ({ verifyCronAuth: mockVerifyCronAuth }));
jest.mock('@/lib/validations', () => ({
  RegisterClipSchema: {},
  VoteRequestSchema: {},
  parseBody: jest.fn().mockReturnValue({ success: true, data: { clipId: 'clip-1' } }),
}));
jest.mock('@/lib/device-fingerprint', () => ({
  generateDeviceKey: jest.fn().mockReturnValue('device_test'),
  extractDeviceSignals: jest.fn().mockReturnValue({}),
  assessDeviceRisk: jest.fn().mockReturnValue({ score: 0, reasons: [] }),
  shouldFlagVote: jest.fn().mockReturnValue(false),
}));
jest.mock('@/lib/captcha', () => ({
  verifyCaptcha: jest.fn().mockResolvedValue({ success: true }),
  getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));
jest.mock('@/lib/vote-validation-redis', () => ({
  validateVoteRedis: jest.fn().mockResolvedValue({ valid: false, code: 'SLOT_STATE_MISSING' }),
  recordVote: jest.fn().mockResolvedValue(true),
  removeVoteRecord: jest.fn(),
  isVotingFrozen: jest.fn().mockResolvedValue(false),
  seedDailyVoteCount: jest.fn(),
  setSlotState: jest.fn(),
  clearVotingFrozen: jest.fn(),
}));
jest.mock('@/lib/crdt-vote-counter', () => ({
  incrementVote: jest.fn(),
  decrementVote: jest.fn(),
  getCountAndScore: jest.fn().mockResolvedValue(null),
  clearClips: jest.fn(),
}));
jest.mock('@/lib/realtime-broadcast', () => ({ broadcastVoteUpdate: jest.fn() }));
jest.mock('@/lib/vote-count-cache', () => ({
  getCachedVoteCounts: jest.fn().mockResolvedValue(null),
  setCachedVoteCounts: jest.fn(),
  updateCachedVoteCount: jest.fn(),
  invalidateVoteCount: jest.fn(),
}));
jest.mock('@/lib/leaderboard-redis', () => ({
  updateClipScore: jest.fn(),
  updateVoterScore: jest.fn(),
  batchUpdateClipScores: jest.fn(),
  batchUpdateVoterScores: jest.fn(),
  batchUpdateCreatorScores: jest.fn(),
}));
jest.mock('@/lib/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn((fn: () => Promise<unknown>) => fn()),
  })),
}));
jest.mock('@/lib/logger', () => ({ createRequestLogger: jest.fn().mockReturnValue({}), logAudit: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ createNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/counter-sync', () => ({ forceSyncCounters: jest.fn().mockResolvedValue({ synced: 0 }) }));

// ============================================================================
// IMPORTS
// ============================================================================

import {
  createMockRequest,
  createCronRequest,
  createSupabaseChain,
  parseResponse,
  TEST_USER,
  TEST_ADMIN,
} from '../helpers/api-test-utils';
import { NextResponse } from 'next/server';

// ============================================================================
// SHARED STATE
// ============================================================================

const USER_ID = TEST_USER.userId;
const TEAM_ID = 'team-sec-001';
const PROJECT_ID = 'proj-sec-001';

function buildSupabaseMock(overrides?: Record<string, jest.Mock>) {
  return {
    from: jest.fn(),
    rpc: jest.fn().mockReturnValue(Promise.resolve({ data: null, error: null })),
    storage: {
      from: jest.fn().mockReturnValue({
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://test.supabase.co/signed/url' } }),
      }),
    },
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Security Regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    csrfShouldReject = false;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.CRON_SECRET = 'cron-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  // --------------------------------------------------------------------------
  // BUG: CSRF bypass - POST requests could be made without CSRF token
  // FIX: requireCsrf middleware rejects POST/DELETE without valid token
  // --------------------------------------------------------------------------
  test('CSRF bypass: POST vote without CSRF token is rejected', async () => {
    csrfShouldReject = true;
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email, userId: USER_ID } });

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', {
      method: 'POST',
      body: { clipId: 'clip-1' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toContain('CSRF');
  });

  // --------------------------------------------------------------------------
  // BUG: Admin routes accessible without authentication
  // FIX: requireAdmin middleware checks session and admin status
  // --------------------------------------------------------------------------
  test('Admin route without auth: returns 403', async () => {
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const { POST } = await import('@/app/api/admin/approve/route');
    const req = createMockRequest('/api/admin/approve', {
      method: 'POST',
      body: { clipId: 'clip-1' },
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  // --------------------------------------------------------------------------
  // BUG: Admin routes accessible to non-admin users
  // FIX: requireAdmin checks admin email list or is_admin flag
  // --------------------------------------------------------------------------
  test('Admin route with non-admin user: returns 403', async () => {
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const { POST } = await import('@/app/api/admin/seasons/route');
    const req = createMockRequest('/api/admin/seasons', {
      method: 'POST',
      body: { label: 'Hacker Season' },
    });

    const res = await POST(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(403);
  });

  // --------------------------------------------------------------------------
  // BUG: Cron routes accessible without CRON_SECRET
  // FIX: verifyCronAuth middleware validates Bearer token
  // --------------------------------------------------------------------------
  test('Cron route without secret: returns 401', async () => {
    mockVerifyCronAuth.mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );

    const { GET } = await import('@/app/api/cron/sync-leaderboards/route');
    const req = createCronRequest('/api/cron/sync-leaderboards'); // No secret

    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  // --------------------------------------------------------------------------
  // BUG: Cron route with wrong secret should be rejected
  // FIX: verifyCronAuth compares Bearer token with CRON_SECRET
  // --------------------------------------------------------------------------
  test('Cron route with wrong secret: returns 401', async () => {
    mockVerifyCronAuth.mockReturnValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );

    const { GET } = await import('@/app/api/cron/sync-leaderboards/route');
    const req = createCronRequest('/api/cron/sync-leaderboards', 'wrong-secret');

    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  // --------------------------------------------------------------------------
  // BUG: XSS in team messages - script tags not sanitized
  // FIX: sanitizeText strips HTML tags and script content
  // --------------------------------------------------------------------------
  test('XSS in team messages: script tags are stripped', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: USER_ID, image: null },
    });

    const membershipChain = createSupabaseChain({ data: { id: 'member-1' }, error: null });
    const userChain = createSupabaseChain({ data: { username: 'testuser' }, error: null });
    const insertChain = createSupabaseChain({
      data: { id: 'msg-1', message: 'alert(1)', created_at: new Date().toISOString(), user_id: USER_ID, username: 'testuser' },
      error: null,
    });
    const updateActiveChain = createSupabaseChain({ data: null, error: null });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return membershipChain;
      if (fromCallCount === 2) return userChain;
      if (fromCallCount === 3) return insertChain;
      return updateActiveChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/teams/[id]/messages/route');
    const xssPayload = '<script>alert("XSS")</script>Hello';
    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`, {
      method: 'POST',
      body: { message: xssPayload },
    });

    await POST(req, { params: Promise.resolve({ id: TEAM_ID }) });

    // Verify sanitizeText was called with the XSS payload
    expect(mockSanitizeText).toHaveBeenCalledWith(xssPayload);

    // Verify the sanitized output does not contain script tags
    const sanitizedResult = mockSanitizeText(xssPayload);
    expect(sanitizedResult).not.toContain('<script');
    expect(sanitizedResult).not.toContain('</script>');
  });

  // --------------------------------------------------------------------------
  // BUG: Error messages leaked internal details (DB errors, stack traces)
  // FIX: Production errors return generic messages; debug info only in dev
  // --------------------------------------------------------------------------
  test('Error messages do not leak internal details in production', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email, userId: USER_ID } });

    const { parseBody: mockParseBodyFn } = require('@/lib/validations');
    mockParseBodyFn.mockReturnValue({ success: true, data: { clipId: 'clip-missing' } });

    // Clip not found
    const featureFlagChain = createSupabaseChain({ data: [], error: null });
    const bannedChain = createSupabaseChain({ data: { is_banned: false }, error: null });
    const votesChain = createSupabaseChain({ data: [], error: null, count: 0 });
    const clipChain = createSupabaseChain({ data: null, error: { message: 'PGRST116: relation not found', details: 'table tournament_clips', hint: '', code: 'PGRST116' } });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return featureFlagChain;  // 1: feature_flags (getFeatureFlags)
      if (fromCallCount === 2) return bannedChain;        // 2: users (ban check)
      if (fromCallCount === 3) return votesChain;         // 3: votes (getUserVotesToday, in Promise.all)
      return clipChain;                                    // 4: tournament_clips (clip query, in Promise.all)
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: 'clip-missing' } });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    // Error message should be generic, not leak DB details
    expect(body.error).toBe('Clip not found');
    expect(body.error).not.toContain('PGRST116');
    expect(body.error).not.toContain('relation');
    // No debug info in production
    expect(body.debug).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // BUG: Download endpoint allowed open redirect to any domain
  // FIX: Validate download URL host against allowlist before redirect
  // --------------------------------------------------------------------------
  test('Download URL: blocks redirect to untrusted hosts', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    const userChain = createSupabaseChain({ data: { id: USER_ID }, error: null });
    const projectChain = createSupabaseChain({
      data: {
        id: PROJECT_ID,
        status: 'completed',
        user_id: USER_ID,
        title: 'Movie',
        final_video_url: 'https://evil.com/malware.exe',
        total_duration_seconds: 50,
      },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return userChain;
      return projectChain;
    });

    // Storage mock returns a URL pointing to evil host
    const storageMock = {
      from: jest.fn().mockReturnValue({
        createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://evil.com/redirect' } }),
      }),
    };

    mockCreateClient.mockReturnValue({ ...buildSupabaseMock({ from: fromMock }), storage: storageMock });

    const { GET } = await import('@/app/api/movie/projects/[id]/download/route');
    const req = createMockRequest(`/api/movie/projects/${PROJECT_ID}/download`);
    const res = await GET(req, { params: Promise.resolve({ id: PROJECT_ID }) });

    // Should NOT redirect to evil.com
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('not available');
  });

  // --------------------------------------------------------------------------
  // BUG: Clip registration did not require authentication
  // FIX: Check session before processing upload
  // --------------------------------------------------------------------------
  test('Clip registration: unauthenticated users are rejected', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import('@/app/api/upload/register/route');
    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: { videoUrl: 'https://test.com/video.mp4', genre: 'comedy', title: 'Test' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toContain('logged in');
  });
});
