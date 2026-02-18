/**
 * @jest-environment node
 *
 * RACE CONDITION REGRESSION TESTS
 * Tests for race conditions that were previously discovered and fixed.
 * Each test documents the bug and verifies the fix remains in place.
 *
 * Bug categories:
 *   - Vote dedup atomicity (concurrent votes for same clip)
 *   - Concurrent slot advance (double-advance prevention)
 *   - Double credit deduction (webhook idempotency)
 *   - Stale cache race conditions
 */

// ============================================================================
// MOCKS
// ============================================================================

const mockCreateClient = jest.fn();
const mockGetServerSession = jest.fn();
const mockRequireAdmin = jest.fn();
const mockCheckAdminAuth = jest.fn();
const mockRateLimit = jest.fn().mockResolvedValue(null);
const mockRequireCsrf = jest.fn().mockResolvedValue(null);
const mockLogAdminAction = jest.fn().mockResolvedValue(undefined);
const mockParseBody = jest.fn();
const mockGenerateDeviceKey = jest.fn().mockReturnValue('device_test123');
const mockExtractDeviceSignals = jest.fn().mockReturnValue({});
const mockAssessDeviceRisk = jest.fn().mockReturnValue({ score: 0, reasons: [] });
const mockShouldFlagVote = jest.fn().mockReturnValue(false);
const mockIsValidGenre = jest.fn().mockReturnValue(true);

// Redis / CRDT mocks
const mockValidateVoteRedis = jest.fn().mockResolvedValue({ valid: false, code: 'SLOT_STATE_MISSING' });
const mockRecordVoteRedis = jest.fn().mockResolvedValue(true);
const mockRemoveVoteRecord = jest.fn().mockResolvedValue(undefined);
const mockIsVotingFrozen = jest.fn().mockResolvedValue(false);
const mockSeedDailyVoteCount = jest.fn().mockResolvedValue(undefined);
const mockIncrementVote = jest.fn().mockResolvedValue(undefined);
const mockDecrementVote = jest.fn().mockResolvedValue(undefined);
const mockGetCountAndScore = jest.fn().mockResolvedValue(null);
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

// Stripe mock
const mockStripeWebhooksConstructEvent = jest.fn();
const mockStripeInstance = {
  webhooks: { constructEvent: mockStripeWebhooksConstructEvent },
};

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/admin-auth', () => ({ requireAdmin: mockRequireAdmin, checkAdminAuth: mockCheckAdminAuth }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: mockRequireCsrf }));
jest.mock('@/lib/audit-log', () => ({ logAdminAction: mockLogAdminAction }));
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
jest.mock('@/lib/captcha', () => ({ verifyCaptcha: jest.fn().mockResolvedValue({ success: true }), getClientIp: jest.fn().mockReturnValue('127.0.0.1') }));
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
jest.mock('@/lib/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn((fn: () => Promise<unknown>) => fn()),
  })),
}));
jest.mock('@/lib/logger', () => ({ createRequestLogger: jest.fn().mockReturnValue({}), logAudit: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ createNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/counter-sync', () => ({ forceSyncCounters: mockForceSyncCounters }));
jest.mock('stripe', () => jest.fn().mockImplementation(() => mockStripeInstance));

// ============================================================================
// IMPORTS
// ============================================================================

import {
  createMockRequest,
  createSupabaseChain,
  parseResponse,
  TEST_USER,
  TEST_ADMIN,
} from '../helpers/api-test-utils';
import { NextRequest } from 'next/server';

// ============================================================================
// SHARED
// ============================================================================

const USER_ID = TEST_USER.userId;
const CLIP_ID = 'clip-race-001';
const SEASON_ID = 'season-race-001';

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

// ============================================================================
// TESTS
// ============================================================================

describe('Race Condition Regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.CRON_SECRET = 'cron-secret';
  });

  // --------------------------------------------------------------------------
  // BUG: Concurrent votes on same clip could double-count
  // FIX: Atomic RPC insert_vote_atomic uses SELECT FOR UPDATE
  // --------------------------------------------------------------------------
  test('Vote dedup: RPC returns ALREADY_VOTED when same clip voted concurrently', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email, userId: USER_ID } });
    mockParseBody.mockReturnValue({ success: true, data: { clipId: CLIP_ID } });

    const featureFlagChain = createSupabaseChain({ data: [], error: null });
    const bannedChain = createSupabaseChain({ data: { is_banned: false }, error: null });
    const votesChain = createSupabaseChain({ data: [], error: null, count: 0 });
    const clipChain = createSupabaseChain({
      data: { slot_position: 1, season_id: SEASON_ID, vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' },
      error: null,
    });
    const slotChain = createSupabaseChain({
      data: { slot_position: 1, status: 'voting', voting_ends_at: new Date(Date.now() + 86400000).toISOString() },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      // First vote test in file: feature_flags cache is empty, so getFeatureFlags queries DB
      if (fromCallCount === 1) return featureFlagChain; // 1: feature_flags (getFeatureFlags)
      if (fromCallCount === 2) return bannedChain;      // 2: users (ban check)
      if (fromCallCount === 3) return votesChain;       // 3: votes (getUserVotesToday, in Promise.all)
      if (fromCallCount === 4) return clipChain;        // 4: tournament_clips (clip query, in Promise.all)
      return slotChain;                                  // 5: story_slots (slot query)
    });

    // Simulate the atomic RPC returning ALREADY_VOTED (concurrent vote won)
    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({
      data: [{ error_code: 'ALREADY_VOTED' }],
      error: null,
    }));

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock, rpc: rpcMock }));

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(409);
    expect(body.code).toBe('ALREADY_VOTED');
  });

  // --------------------------------------------------------------------------
  // BUG: Two concurrent advance-slot calls could skip a slot
  // FIX: Distributed lock via cron_locks table; .eq('status', 'voting') guard
  // --------------------------------------------------------------------------
  test('Concurrent slot advance: lock conflict returns 409', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    mockCheckAdminAuth.mockResolvedValue({ isAdmin: true, userId: TEST_ADMIN.userId, email: TEST_ADMIN.email });

    // First call: delete expired locks succeeds
    const lockDeleteChain = createSupabaseChain({ data: null, error: null });
    // Second call: insert lock FAILS (conflict - another process holds it)
    const lockInsertChain = createSupabaseChain({
      data: null,
      error: { message: 'duplicate key', code: '23505', details: '', hint: '' },
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return lockDeleteChain;
      return lockInsertChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/admin/advance-slot/route');
    const req = createMockRequest('/api/admin/advance-slot', { method: 'POST', body: {} });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(409);
    expect(body.error).toContain('in progress');
  });

  // --------------------------------------------------------------------------
  // BUG: Slot already advanced by another process but update succeeds
  // FIX: .eq('status', 'voting') guard on UPDATE returns no rows if already locked
  // --------------------------------------------------------------------------
  test('Double advance prevented: slot already locked returns 409', async () => {
    mockRequireAdmin.mockResolvedValue(null);
    mockCheckAdminAuth.mockResolvedValue({ isAdmin: true, userId: TEST_ADMIN.userId, email: TEST_ADMIN.email });

    const lockDeleteChain = createSupabaseChain({ data: null, error: null });
    const lockInsertChain = createSupabaseChain({ data: null, error: null });
    const featureFlagChain = createSupabaseChain({ data: { enabled: false }, error: null });
    const seasonChain = createSupabaseChain({
      data: { id: SEASON_ID, status: 'active', label: 'Test', total_slots: 10, genre: null },
      error: null,
    });
    const votingSlotChain = createSupabaseChain({
      data: { id: 'slot-001', season_id: SEASON_ID, slot_position: 1, status: 'voting', genre: null, voting_duration_hours: 24 },
      error: null,
    });
    const slotClipsChain = createSupabaseChain({ data: [{ id: CLIP_ID }], error: null });
    const winnerChain = createSupabaseChain({
      data: { id: CLIP_ID, slot_position: 1, vote_count: 5, weighted_score: 5 },
      error: null,
    });
    // UPDATE with .eq('status', 'voting') returns null (already advanced by another process)
    const lockSlotChain = createSupabaseChain({ data: null, error: null });
    const lockReleaseChain = createSupabaseChain({ data: null, error: null });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return lockDeleteChain;     // 1: cron_locks delete
      if (fromCallCount === 2) return lockInsertChain;     // 2: cron_locks insert
      if (fromCallCount === 3) return featureFlagChain;    // 3: feature_flags (multi_genre_enabled)
      if (fromCallCount === 4) return seasonChain;         // 4: seasons (active season)
      if (fromCallCount === 5) return votingSlotChain;     // 5: story_slots (voting slot)
      if (fromCallCount === 6) return slotClipsChain;      // 6: tournament_clips (slot clips for sync)
      if (fromCallCount === 7) return winnerChain;         // 7: tournament_clips (winner query)
      if (fromCallCount === 8) return lockSlotChain;       // 8: story_slots update (returns null => already advanced)
      return lockReleaseChain;                              // 9+: cron_locks delete (finally block)
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    try {
      const { POST } = await import('@/app/api/admin/advance-slot/route');
      const req = createMockRequest('/api/admin/advance-slot', { method: 'POST', body: {} });
      const res = await POST(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(409);
      expect(body.error).toContain('already advanced');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // --------------------------------------------------------------------------
  // BUG: Stripe webhook processed twice causes double credits
  // FIX: add_credits RPC has idempotency guard on stripe_payment_intent_id
  // --------------------------------------------------------------------------
  test('Double credit deduction: duplicate webhook returns idempotent response', async () => {
    const stripeEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_dup_test',
          payment_intent: 'pi_dup_test',
          metadata: { user_id: USER_ID, package_id: 'pkg-1', credits: '50' },
        },
      },
    };

    mockStripeWebhooksConstructEvent.mockReturnValue(stripeEvent);

    // RPC returns "already processed"
    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({
      data: { success: false, error: 'Payment already processed' },
      error: null,
    }));
    mockCreateClient.mockReturnValue(buildSupabaseMock({ rpc: rpcMock }));

    const { POST } = await import('@/app/api/credits/webhook/route');
    const url = new URL('/api/credits/webhook', 'http://localhost:3000');
    const req = new NextRequest(url.toString(), {
      method: 'POST',
      body: JSON.stringify(stripeEvent),
      headers: { 'content-type': 'application/json', 'stripe-signature': 'sig_test' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200); // 200 not 500 — idempotent
    expect(body.received).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // BUG: Self-voting allowed via sync path
  // FIX: clip user_id checked against loggedInUserId
  // --------------------------------------------------------------------------
  test('Self-voting is prevented on the sync path', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email, userId: USER_ID } });
    mockParseBody.mockReturnValue({ success: true, data: { clipId: CLIP_ID } });

    const bannedChain = createSupabaseChain({ data: { is_banned: false }, error: null });
    const votesChain = createSupabaseChain({ data: [], error: null, count: 0 });
    // Clip belongs to the same user who is voting
    const clipChain = createSupabaseChain({
      data: { slot_position: 1, season_id: SEASON_ID, vote_count: 0, weighted_score: 0, status: 'active', user_id: USER_ID },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      // feature_flags cache is populated from earlier test, so no feature_flags query
      if (fromCallCount === 1) return bannedChain;   // 1: users (ban check)
      if (fromCallCount === 2) return votesChain;    // 2: votes (getUserVotesToday, in Promise.all)
      return clipChain;                               // 3: tournament_clips (clip query, in Promise.all)
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.code).toBe('SELF_VOTE_NOT_ALLOWED');
  });

  // --------------------------------------------------------------------------
  // BUG: Banned user could still vote
  // FIX: is_banned check added before vote processing
  // --------------------------------------------------------------------------
  test('Banned user cannot cast votes', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email, userId: USER_ID } });
    mockParseBody.mockReturnValue({ success: true, data: { clipId: CLIP_ID } });

    const bannedChain = createSupabaseChain({ data: { is_banned: true }, error: null });
    const votesChain = createSupabaseChain({ data: [], error: null, count: 0 });
    const clipChain = createSupabaseChain({
      data: { slot_position: 1, season_id: SEASON_ID, vote_count: 0, weighted_score: 0, status: 'active', user_id: 'other' },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      // feature_flags cache is populated from earlier test, so no feature_flags query
      if (fromCallCount === 1) return bannedChain;   // 1: users (ban check)
      if (fromCallCount === 2) return votesChain;    // 2: votes (getUserVotesToday, in Promise.all)
      return clipChain;                               // 3: tournament_clips (clip query, in Promise.all)
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.code).toBe('USER_BANNED');
  });

  // --------------------------------------------------------------------------
  // BUG: Vote on inactive clip was allowed
  // FIX: clip status check returns INVALID_CLIP_STATUS
  // --------------------------------------------------------------------------
  test('Voting on an inactive clip is rejected', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email, userId: USER_ID } });
    mockParseBody.mockReturnValue({ success: true, data: { clipId: CLIP_ID } });

    const bannedChain = createSupabaseChain({ data: { is_banned: false }, error: null });
    const votesChain = createSupabaseChain({ data: [], error: null, count: 0 });
    // Clip is eliminated, not active
    const clipChain = createSupabaseChain({
      data: { slot_position: 1, season_id: SEASON_ID, vote_count: 10, weighted_score: 10, status: 'eliminated', user_id: 'other' },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      // feature_flags cache is populated from earlier test, so no feature_flags query
      if (fromCallCount === 1) return bannedChain;   // 1: users (ban check)
      if (fromCallCount === 2) return votesChain;    // 2: votes (getUserVotesToday, in Promise.all)
      return clipChain;                               // 3: tournament_clips (clip query, in Promise.all)
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_CLIP_STATUS');
  });

  // --------------------------------------------------------------------------
  // BUG: Voting after period expired (before cron advances)
  // FIX: Check voting_ends_at in POST handler
  // --------------------------------------------------------------------------
  test('Voting after period expired is rejected', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email, userId: USER_ID } });
    mockParseBody.mockReturnValue({ success: true, data: { clipId: CLIP_ID } });

    const bannedChain = createSupabaseChain({ data: { is_banned: false }, error: null });
    const votesChain = createSupabaseChain({ data: [], error: null, count: 0 });
    const clipChain = createSupabaseChain({
      data: { slot_position: 1, season_id: SEASON_ID, vote_count: 0, weighted_score: 0, status: 'active', user_id: 'other' },
      error: null,
    });
    // Slot voting period has already expired
    const slotChain = createSupabaseChain({
      data: { slot_position: 1, status: 'voting', voting_ends_at: new Date(Date.now() - 60000).toISOString() },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      // feature_flags cache is populated from earlier test, so no feature_flags query
      if (fromCallCount === 1) return bannedChain;   // 1: users (ban check)
      if (fromCallCount === 2) return votesChain;    // 2: votes (getUserVotesToday, in Promise.all)
      if (fromCallCount === 3) return clipChain;     // 3: tournament_clips (clip query, in Promise.all)
      return slotChain;                               // 4: story_slots (slot query)
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: CLIP_ID } });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.code).toBe('VOTING_EXPIRED');
  });
});
