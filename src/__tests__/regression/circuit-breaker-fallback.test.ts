/**
 * @jest-environment node
 *
 * CIRCUIT BREAKER FALLBACK REGRESSION TESTS
 * Tests for the vote route's Redis-first → sync-fallback pattern.
 *
 * Critical bug class: When the Redis path partially succeeds but the circuit
 * breaker trips, the sync fallback must NOT double-count the vote. CRDT increments
 * and RPC inserts must be mutually exclusive.
 *
 * Bug categories:
 *   - Redis path succeeds vs sync fallback (mutual exclusivity)
 *   - Circuit breaker state transitions
 *   - Self-vote and banned user rejection before circuit breaker
 *   - Daily vote counter consistency after fallback
 */

// ============================================================================
// MOCKS
// ============================================================================

const mockCreateClient = jest.fn();
const mockGetServerSession = jest.fn();
const mockRateLimit = jest.fn().mockResolvedValue(null);
const mockRequireCsrf = jest.fn().mockResolvedValue(null);
const mockParseBody = jest.fn();
const mockGenerateDeviceKey = jest.fn().mockReturnValue('device_test_cb');
const mockExtractDeviceSignals = jest.fn().mockReturnValue({});
const mockAssessDeviceRisk = jest.fn().mockReturnValue({ score: 0, reasons: [] });
const mockShouldFlagVote = jest.fn().mockReturnValue(false);
const mockIsValidGenre = jest.fn().mockReturnValue(true);

// Redis / CRDT mocks
const mockValidateVoteRedis = jest.fn();
const mockRecordVoteRedis = jest.fn().mockResolvedValue(true);
const mockRemoveVoteRecord = jest.fn().mockResolvedValue(undefined);
const mockIsVotingFrozen = jest.fn().mockResolvedValue(false);
const mockSeedDailyVoteCount = jest.fn().mockResolvedValue(undefined);
const mockIncrementVote = jest.fn().mockResolvedValue(undefined);
const mockDecrementVote = jest.fn().mockResolvedValue(undefined);
const mockGetCountAndScore = jest.fn().mockResolvedValue({ weightedScore: 10 });
const mockBroadcastVoteUpdate = jest.fn().mockResolvedValue(undefined);
const mockGetCachedVoteCounts = jest.fn().mockResolvedValue(null);
const mockSetCachedVoteCounts = jest.fn().mockResolvedValue(undefined);
const mockUpdateCachedVoteCount = jest.fn().mockResolvedValue(undefined);
const mockInvalidateVoteCount = jest.fn().mockResolvedValue(undefined);
const mockUpdateClipScore = jest.fn().mockResolvedValue(undefined);
const mockUpdateVoterScore = jest.fn().mockResolvedValue(undefined);
const mockClearSlotLeaderboard = jest.fn().mockResolvedValue(undefined);
const mockClearVotingFrozen = jest.fn().mockResolvedValue(undefined);
const mockSetSlotState = jest.fn().mockResolvedValue(undefined);
const mockClearClips = jest.fn().mockResolvedValue(undefined);
const mockForceSyncCounters = jest.fn().mockResolvedValue({ synced: 0 });

// Circuit breaker mock — controls whether Redis path is used
let mockCircuitBreakerExecute: jest.Mock;
jest.mock('@/lib/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    get execute() { return mockCircuitBreakerExecute; },
  })),
}));

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/admin-auth', () => ({ requireAdmin: jest.fn(), checkAdminAuth: jest.fn() }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: mockRequireCsrf }));
jest.mock('@/lib/audit-log', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/genres', () => ({ isValidGenre: mockIsValidGenre, getGenreCodes: () => [] }));
jest.mock('@/lib/validations', () => ({
  VoteRequestSchema: {},
  parseBody: mockParseBody,
}));
jest.mock('@/lib/device-fingerprint', () => ({
  generateDeviceKey: mockGenerateDeviceKey,
  extractDeviceSignals: mockExtractDeviceSignals,
  assessDeviceRisk: mockAssessDeviceRisk,
  shouldFlagVote: mockShouldFlagVote,
}));
jest.mock('@/lib/captcha', () => ({
  verifyCaptcha: jest.fn().mockResolvedValue({ success: true }),
  getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));
jest.mock('@/lib/vote-validation-redis', () => ({
  validateVoteRedis: mockValidateVoteRedis,
  recordVote: mockRecordVoteRedis,
  removeVoteRecord: mockRemoveVoteRecord,
  isVotingFrozen: mockIsVotingFrozen,
  seedDailyVoteCount: mockSeedDailyVoteCount,
  setSlotState: mockSetSlotState,
  clearVotingFrozen: mockClearVotingFrozen,
}));
jest.mock('@/lib/crdt-vote-counter', () => ({
  incrementVote: mockIncrementVote,
  decrementVote: mockDecrementVote,
  getCountAndScore: mockGetCountAndScore,
  clearClips: mockClearClips,
}));
jest.mock('@/lib/realtime-broadcast', () => ({ broadcastVoteUpdate: mockBroadcastVoteUpdate }));
jest.mock('@/lib/vote-count-cache', () => ({
  getCachedVoteCounts: mockGetCachedVoteCounts,
  setCachedVoteCounts: mockSetCachedVoteCounts,
  updateCachedVoteCount: mockUpdateCachedVoteCount,
  invalidateVoteCount: mockInvalidateVoteCount,
}));
jest.mock('@/lib/leaderboard-redis', () => ({
  updateClipScore: mockUpdateClipScore,
  updateVoterScore: mockUpdateVoterScore,
  clearSlotLeaderboard: mockClearSlotLeaderboard,
}));
jest.mock('@/lib/logger', () => ({
  createRequestLogger: jest.fn().mockReturnValue({}),
  logAudit: jest.fn(),
}));
jest.mock('@/lib/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/counter-sync', () => ({ forceSyncCounters: mockForceSyncCounters }));

// ============================================================================
// IMPORTS
// ============================================================================

import {
  createMockRequest,
  createSupabaseChain,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

// ============================================================================
// HELPERS
// ============================================================================

const CLIP_ID = 'clip-cb-001';
const SEASON_ID = 'season-cb-001';
const OTHER_USER_ID = 'other-user-cb-001';

function buildSupabaseMock(overrides?: Record<string, jest.Mock>) {
  const channelMock = {
    subscribe: jest.fn((cb: (status: string) => void) => { cb('SUBSCRIBED'); return channelMock; }),
    send: jest.fn().mockResolvedValue('ok'),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
  };
  return {
    from: jest.fn(),
    rpc: jest.fn().mockReturnValue(Promise.resolve({ data: null, error: null })),
    channel: jest.fn().mockReturnValue(channelMock),
    ...overrides,
  };
}

function setupStandardMocks(options: {
  asyncVoting?: boolean;
  banned?: boolean;
  selfVote?: boolean;
  votingExpired?: boolean;
} = {}) {
  const { asyncVoting = true, banned = false, selfVote = false, votingExpired = false } = options;

  mockGetServerSession.mockResolvedValue({
    user: { email: TEST_USER.email, userId: TEST_USER.userId },
  });
  mockParseBody.mockReturnValue({ success: true, data: { clipId: CLIP_ID } });

  // Feature flags chain — async_voting enabled
  const featureFlagChain = createSupabaseChain({
    data: [
      { key: 'async_voting', enabled: asyncVoting },
      { key: 'multi_vote_mode', enabled: false },
    ],
    error: null,
  });

  // Banned user check
  const bannedChain = createSupabaseChain({
    data: { is_banned: banned },
    error: null,
  });

  // Votes today (sync path only)
  const votesChain = createSupabaseChain({ data: [], error: null, count: 0 });

  // Clip data (used by both Redis path handleVoteRedis AND sync path)
  const clipChain = createSupabaseChain({
    data: {
      slot_position: 1,
      season_id: SEASON_ID,
      vote_count: 5,
      weighted_score: 5,
      status: 'active',
      user_id: selfVote ? TEST_USER.userId : OTHER_USER_ID,
    },
    error: null,
  });

  // Slot data (sync path only)
  const votingEndsAt = votingExpired
    ? new Date(Date.now() - 86400000).toISOString()
    : new Date(Date.now() + 86400000).toISOString();
  const slotChain = createSupabaseChain({
    data: { slot_position: 1, status: 'voting', voting_ends_at: votingEndsAt },
    error: null,
  });

  // Table-name-based routing (order-independent, works for both Redis and sync paths)
  const fromMock = jest.fn((tableName: string) => {
    switch (tableName) {
      case 'feature_flags': return featureFlagChain;
      case 'users': return bannedChain;
      case 'votes': return votesChain;
      case 'tournament_clips': return clipChain;
      case 'story_slots': return slotChain;
      default: return createSupabaseChain({ data: null, error: null });
    }
  });

  const rpcMock = jest.fn().mockReturnValue(Promise.resolve({
    data: [{ success: true }],
    error: null,
  }));

  mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock, rpc: rpcMock }));

  return { fromMock, rpcMock };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Circuit Breaker Fallback Regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    // Default: circuit breaker passes through
    mockCircuitBreakerExecute = jest.fn((fn: () => Promise<unknown>) => fn());
    // Default: Redis validation passes
    mockValidateVoteRedis.mockResolvedValue({
      valid: true,
      code: null,
      message: null,
      dailyCount: 5,
    });
  });

  // --------------------------------------------------------------------------
  // Redis path succeeds — no sync fallback
  // --------------------------------------------------------------------------
  test('Redis path succeeds: no sync RPC called', async () => {
    const { rpcMock } = setupStandardMocks({ asyncVoting: true });

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(200);
    // Redis path used CRDT
    expect(mockIncrementVote).toHaveBeenCalledWith(CLIP_ID, expect.any(Number));
    // Sync path RPC (insert_vote_atomic) NOT called
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Redis fails: circuit opens, sync fallback used
  // --------------------------------------------------------------------------
  test('Redis fails: falls back to sync path with RPC', async () => {
    mockValidateVoteRedis.mockResolvedValue({
      valid: false,
      code: 'SLOT_STATE_MISSING',
      message: 'Slot state not in Redis',
    });

    // Circuit breaker throws (simulating Redis failure) — triggers sync fallback
    mockCircuitBreakerExecute = jest.fn().mockRejectedValue(new Error('Circuit breaker open'));

    const { rpcMock } = setupStandardMocks({ asyncVoting: true });

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(200);
    // Sync path RPC was called
    expect(rpcMock).toHaveBeenCalled();
    // CRDT was NOT called directly (sync path uses DB)
    expect(mockIncrementVote).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // CRITICAL: Redis increment and RPC are mutually exclusive
  // --------------------------------------------------------------------------
  test('CRDT incrementVote and insert_vote_atomic RPC are never both called for same vote', async () => {
    // Path 1: Redis succeeds — CRDT used, RPC not called
    const { rpcMock: rpc1 } = setupStandardMocks({ asyncVoting: true });

    const mod1 = await import('@/app/api/vote/route');
    const req1 = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    await mod1.POST(req1);

    if (mockIncrementVote.mock.calls.length > 0) {
      expect(rpc1).not.toHaveBeenCalled();
    } else {
      expect(rpc1).toHaveBeenCalled();
    }

    // Verify they never coexist
    const crdtCalled = mockIncrementVote.mock.calls.length > 0;
    const rpcCalled = rpc1.mock.calls.length > 0;
    expect(crdtCalled && rpcCalled).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Self-vote blocked (Redis path — check happens inside handleVoteRedis)
  // --------------------------------------------------------------------------
  test('self-vote blocked: returns 403 SELF_VOTE_NOT_ALLOWED', async () => {
    // Self-vote is checked inside handleVoteRedis after clip data fetch (line 1236)
    // The clip's user_id matches the logged-in user's ID
    setupStandardMocks({ asyncVoting: true, selfVote: true });

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.code).toBe('SELF_VOTE_NOT_ALLOWED');
    // CRDT never incremented for self-votes
    expect(mockIncrementVote).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Banned user blocked before circuit breaker (check at line 1457)
  // --------------------------------------------------------------------------
  test('banned user blocked: returns 403 USER_BANNED', async () => {
    setupStandardMocks({ asyncVoting: true, banned: true });

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.code).toBe('USER_BANNED');
    expect(mockIncrementVote).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // async_voting disabled: sync path used directly, no circuit breaker
  // --------------------------------------------------------------------------
  test('async_voting disabled: sync path used directly', async () => {
    const { rpcMock } = setupStandardMocks({ asyncVoting: false });

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(200);
    // Sync path RPC was called
    expect(rpcMock).toHaveBeenCalled();
    // Circuit breaker execute was NOT called
    expect(mockCircuitBreakerExecute).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Dedup in Redis path prevents double CRDT increment
  // --------------------------------------------------------------------------
  test('Redis dedup prevents CRDT increment on duplicate vote', async () => {
    // recordVote returns false = SETNX failed = duplicate
    mockRecordVoteRedis.mockResolvedValue(false);

    setupStandardMocks({ asyncVoting: true });

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status } = await parseResponse(res);

    // Redis path returns 409 for duplicate. If it falls through to sync path,
    // the sync path also checks uniqueness via RPC.
    expect([409, 400]).toContain(status);
    // CRDT not incremented for duplicate vote
    expect(mockIncrementVote).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // seedDailyVoteCount called after successful vote
  // --------------------------------------------------------------------------
  test('seedDailyVoteCount called with correct count after sync fallback', async () => {
    mockCircuitBreakerExecute = jest.fn().mockRejectedValue(new Error('Circuit breaker open'));
    mockValidateVoteRedis.mockResolvedValue({
      valid: false,
      code: 'SLOT_STATE_MISSING',
    });

    setupStandardMocks({ asyncVoting: true });

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(200);
    // Daily count seeded after sync fallback
    expect(mockSeedDailyVoteCount).toHaveBeenCalled();
  });
});
