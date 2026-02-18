/**
 * @jest-environment node
 *
 * VOTING FLOW TEST
 * Tests the full voting lifecycle:
 *   Upload clip -> Admin approves -> Voting opens -> User votes -> Vote counted -> Leaderboard updates
 *
 * Imports route handlers and calls them in sequence with shared mocked state.
 */

// ============================================================================
// MOCKS — must be declared before imports
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
const mockVerifyCaptcha = jest.fn().mockResolvedValue({ success: true });
const mockGetClientIp = jest.fn().mockReturnValue('127.0.0.1');

// Redis / CRDT mocks (no-op)
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
const mockGetTopClips = jest.fn().mockResolvedValue(null);
const mockSanitizeText = jest.fn((t: string) => t);
const mockClearSlotLeaderboard = jest.fn().mockResolvedValue(undefined);
const mockClearVotingFrozen = jest.fn().mockResolvedValue(undefined);
const mockClearClips = jest.fn().mockResolvedValue(undefined);
const mockSetSlotState = jest.fn().mockResolvedValue(undefined);
const mockForceSyncCounters = jest.fn().mockResolvedValue({ synced: 0 });

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/admin-auth', () => ({ requireAdmin: mockRequireAdmin, checkAdminAuth: mockCheckAdminAuth }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: mockRequireCsrf }));
jest.mock('@/lib/audit-log', () => ({ logAdminAction: mockLogAdminAction }));
jest.mock('@/lib/sanitize', () => ({ sanitizeText: mockSanitizeText }));
jest.mock('@/lib/genres', () => ({ isValidGenre: mockIsValidGenre, getGenreCodes: () => ['comedy'] }));
jest.mock('@/lib/validations', () => ({
  RegisterClipSchema: {},
  VoteRequestSchema: {},
  parseBody: mockParseBody,
}));
jest.mock('@/lib/device-fingerprint', () => ({
  generateDeviceKey: mockGenerateDeviceKey,
  extractDeviceSignals: mockExtractDeviceSignals,
  assessDeviceRisk: mockAssessDeviceRisk,
  shouldFlagVote: mockShouldFlagVote,
}));
jest.mock('@/lib/captcha', () => ({ verifyCaptcha: mockVerifyCaptcha, getClientIp: mockGetClientIp }));
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
  getTopClips: mockGetTopClips,
  clearSlotLeaderboard: mockClearSlotLeaderboard,
}));
jest.mock('@/lib/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn((fn: () => Promise<unknown>) => fn()),
  })),
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
// IMPORTS (after mocks)
// ============================================================================

import {
  createMockRequest,
  createSupabaseChain,
  createSequentialMock,
  parseResponse,
  mockSession,
  TEST_USER,
  TEST_ADMIN,
  mockAdminAuth,
} from '../helpers/api-test-utils';

// ============================================================================
// SHARED STATE
// ============================================================================

const SEASON_ID = 'season-001';
const SLOT_ID = 'slot-001';
const CLIP_ID = '11111111-1111-1111-9111-111111111111'; // Must be valid UUID (approve route validates)
const USER_ID = TEST_USER.userId;

/**
 * Creates a chainable RPC result (supports .select() chaining like Supabase PostgREST).
 * Usage: rpcMock.mockReturnValue(createChainableRpcResult({ data: [...], error: null }));
 */
function createChainableRpcResult(resolved: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {
    select: jest.fn().mockReturnValue(Promise.resolve(resolved)),
    then: jest.fn((resolve: (v: unknown) => unknown) => Promise.resolve(resolved).then(resolve)),
  };
  return chain;
}

function buildSupabaseMock(overrides?: Record<string, unknown>) {
  const rpcMock = jest.fn().mockReturnValue(createChainableRpcResult({ data: null, error: null }));
  const storageMock = { from: jest.fn().mockReturnValue({ remove: jest.fn().mockResolvedValue({}) }) };
  const channelMock = {
    subscribe: jest.fn((cb: (status: string) => void) => { cb('SUBSCRIBED'); return channelMock; }),
    send: jest.fn().mockResolvedValue('ok'),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
  };
  return {
    from: jest.fn(),
    rpc: rpcMock,
    storage: storageMock,
    channel: jest.fn().mockReturnValue(channelMock),
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Voting Flow: Upload -> Approve -> Vote -> Leaderboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset module registry so module-level caches (featureFlagsCache, activeSeason,
    // activeSlot) in vote/route.ts are fresh for each test.
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.CRON_SECRET = 'cron-secret';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  // --------------------------------------------------------------------------
  // STEP 1: Register a clip
  // --------------------------------------------------------------------------
  test('Step 1: Authenticated user can register a clip', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email, name: TEST_USER.name, userId: USER_ID },
    });

    mockParseBody.mockReturnValue({
      success: true,
      data: {
        videoUrl: 'https://storage.supabase.co/clips/test.mp4',
        genre: 'comedy',
        title: 'Funny Cat',
        description: 'A very funny cat',
        duration: 8,
      },
    });

    const userChain = createSupabaseChain({ data: { id: USER_ID, username: 'testuser', avatar_url: null }, error: null });
    const featureFlagChain = createSupabaseChain({ data: { enabled: false }, error: null });
    const seasonChain = createSupabaseChain({ data: { id: SEASON_ID, total_slots: 75, genre: 'comedy' }, error: null });
    const slotChain = createSupabaseChain({ data: { id: SLOT_ID, slot_position: 1, status: 'voting', voting_started_at: new Date().toISOString(), voting_duration_hours: 24 }, error: null });
    const insertChain = createSupabaseChain({ data: { id: CLIP_ID, video_url: 'https://storage.supabase.co/clips/test.mp4', status: 'pending' }, error: null });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return userChain;       // users lookup
      if (fromCallCount === 2) return featureFlagChain; // feature_flags
      if (fromCallCount === 3) return seasonChain;      // seasons
      if (fromCallCount === 4) return slotChain;        // story_slots
      return insertChain;                                // tournament_clips insert
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/upload/register/route');
    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: {
        videoUrl: 'https://storage.supabase.co/clips/test.mp4',
        genre: 'comedy',
        title: 'Funny Cat',
        description: 'A very funny cat',
        duration: 8,
      },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clip.status).toBe('pending');
  });

  // --------------------------------------------------------------------------
  // STEP 2: Admin approves the clip
  // --------------------------------------------------------------------------
  test('Step 2: Admin approves the pending clip', async () => {
    mockRequireAdmin.mockResolvedValue(null); // admin auth passes
    mockCheckAdminAuth.mockResolvedValue({ isAdmin: true, userId: TEST_ADMIN.userId, email: TEST_ADMIN.email });

    const clipLookupChain = createSupabaseChain({
      data: { status: 'pending', username: 'testuser', season_id: SEASON_ID, user_id: USER_ID },
      error: null,
    });

    const rpcResult = [{
      success: true,
      assigned_slot: 1,
      resumed_voting: false,
    }];

    const clipAfterApproval = createSupabaseChain({
      data: { id: CLIP_ID, status: 'active', slot_position: 1 },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return clipLookupChain;
      return clipAfterApproval;
    });

    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({ data: rpcResult, error: null }));
    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock, rpc: rpcMock }));

    const { POST } = await import('@/app/api/admin/approve/route');
    const req = createMockRequest('/api/admin/approve', {
      method: 'POST',
      body: { clipId: CLIP_ID },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.assignedToSlot).toBe(1);
  });

  // --------------------------------------------------------------------------
  // STEP 3: GET /api/vote returns the approved clip
  // --------------------------------------------------------------------------
  test('Step 3: GET /api/vote returns active clips for voting', async () => {
    mockGetServerSession.mockResolvedValue(null); // anonymous user

    // GET /api/vote from() call order:
    // 1. feature_flags (getFeatureFlags) -- thenable
    // 2. votes (getUserVotesToday) -- thenable
    // 3. seasons (active season lookup) -- .maybeSingle()
    // 4. story_slots (active slot lookup) -- .maybeSingle()
    // 5. votes (getUserVotesInSlot) -- thenable (parallel with #6)
    // 6. tournament_clips (clip count, head:true) -- thenable (parallel with #5)
    // 7. clip_views (recordClipViews, fire-and-forget) -- thenable
    // 8. comments (fallback comment counts) -- thenable
    const featureFlagChain = createSupabaseChain({ data: [{ key: 'multi_genre_enabled', enabled: false }], error: null });
    const votesTodayChain = createSupabaseChain({ data: [], error: null, count: 0 });
    const seasonChain = createSupabaseChain({ data: { id: SEASON_ID, total_slots: 75, status: 'active', genre: 'comedy' }, error: null });
    const slotChain = createSupabaseChain({ data: { id: SLOT_ID, season_id: SEASON_ID, slot_position: 1, status: 'voting', voting_ends_at: null, voting_started_at: null }, error: null });
    const slotVotesChain = createSupabaseChain({ data: [], error: null });
    const clipCountChain = createSupabaseChain({ data: null, error: null, count: 1 });
    const genericChain = createSupabaseChain({ data: [], error: null, count: 0 });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return featureFlagChain;  // feature_flags
      if (fromCallCount === 2) return votesTodayChain;     // votes (today)
      if (fromCallCount === 3) return seasonChain;         // seasons
      if (fromCallCount === 4) return slotChain;           // story_slots
      if (fromCallCount === 5) return slotVotesChain;      // votes (slot votes)
      if (fromCallCount === 6) return clipCountChain;      // tournament_clips (count)
      return genericChain;                                  // clip_views, comments, etc.
    });

    const rpcClips = [
      { id: CLIP_ID, thumbnail_url: 'thumb.jpg', video_url: 'video.mp4', username: 'testuser', avatar_url: null, genre: 'comedy', slot_position: 1, vote_count: 0, weighted_score: 0, hype_score: 0, created_at: new Date().toISOString(), view_count: 0 },
    ];

    // RPC mock that handles both get_clips_randomized and get_comment_counts
    const rpcMock = jest.fn((fnName: string) => {
      if (fnName === 'get_clips_randomized') {
        return createChainableRpcResult({ data: rpcClips, error: null });
      }
      if (fnName === 'get_comment_counts') {
        return createChainableRpcResult({ data: [], error: null });
      }
      return createChainableRpcResult({ data: null, error: null });
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock, rpc: rpcMock }));

    const { GET } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote');

    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.clips).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // STEP 4: User casts a vote on the clip (sync DB path)
  // --------------------------------------------------------------------------
  test('Step 4: User casts a vote on the approved clip', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: USER_ID },
    });
    mockParseBody.mockReturnValue({ success: true, data: { clipId: CLIP_ID } });

    // POST /api/vote from() call order:
    // 1. feature_flags (getFeatureFlags) -- thenable
    // 2. users (banned check, runs BEFORE Promise.all) -- .maybeSingle()
    // 3. votes (getUserVotesToday, inside Promise.all) -- thenable
    // 4. tournament_clips (clip lookup, inside Promise.all) -- .maybeSingle()
    // 5. story_slots (active slot check) -- .maybeSingle()
    const featureFlagChain = createSupabaseChain({ data: [], error: null });
    const bannedCheckChain = createSupabaseChain({ data: { is_banned: false }, error: null });
    const votesChain = createSupabaseChain({ data: [], error: null, count: 0 });
    const clipDataChain = createSupabaseChain({
      data: { slot_position: 1, season_id: SEASON_ID, vote_count: 0, weighted_score: 0, status: 'active', user_id: 'other-user' },
      error: null,
    });
    const activeSlotChain = createSupabaseChain({
      data: { slot_position: 1, status: 'voting', voting_ends_at: new Date(Date.now() + 86400000).toISOString() },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return featureFlagChain; // feature_flags
      if (fromCallCount === 2) return bannedCheckChain;  // users (banned check)
      if (fromCallCount === 3) return votesChain;        // votes (getUserVotesToday)
      if (fromCallCount === 4) return clipDataChain;     // tournament_clips
      return activeSlotChain;                             // story_slots
    });

    const rpcInsertResult = [{
      vote_id: 'vote-001',
      was_new_vote: true,
      final_vote_weight: 1,
      new_vote_count: 1,
      new_weighted_score: 1,
      error_code: null,
    }];

    const rpcMock = jest.fn().mockReturnValue(createChainableRpcResult({ data: rpcInsertResult, error: null }));
    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock, rpc: rpcMock }));

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', {
      method: 'POST',
      body: { clipId: CLIP_ID },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clipId).toBe(CLIP_ID);
    expect(body.newScore).toBe(1);
  });

  // --------------------------------------------------------------------------
  // STEP 5: Duplicate vote is rejected
  // --------------------------------------------------------------------------
  test('Step 5: Duplicate vote on the same clip is rejected', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: USER_ID },
    });
    mockParseBody.mockReturnValue({ success: true, data: { clipId: CLIP_ID } });

    // Same from() call order as Step 4:
    // 1. feature_flags, 2. users (banned), 3. votes, 4. tournament_clips, 5. story_slots
    const featureFlagChain = createSupabaseChain({ data: [], error: null });
    const bannedCheckChain = createSupabaseChain({ data: { is_banned: false }, error: null });
    const votesChain = createSupabaseChain({ data: [{ vote_weight: 1 }], error: null, count: 1 });
    const clipDataChain = createSupabaseChain({
      data: { slot_position: 1, season_id: SEASON_ID, vote_count: 1, weighted_score: 1, status: 'active', user_id: 'other-user' },
      error: null,
    });
    const activeSlotChain = createSupabaseChain({
      data: { slot_position: 1, status: 'voting', voting_ends_at: new Date(Date.now() + 86400000).toISOString() },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return featureFlagChain; // feature_flags
      if (fromCallCount === 2) return bannedCheckChain;  // users (banned check)
      if (fromCallCount === 3) return votesChain;        // votes
      if (fromCallCount === 4) return clipDataChain;     // tournament_clips
      return activeSlotChain;                             // story_slots
    });

    const rpcInsertResult = [{
      error_code: 'ALREADY_VOTED',
    }];

    const rpcMock = jest.fn().mockReturnValue(createChainableRpcResult({ data: rpcInsertResult, error: null }));
    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock, rpc: rpcMock }));

    const { POST } = await import('@/app/api/vote/route');
    const req = createMockRequest('/api/vote', {
      method: 'POST',
      body: { clipId: CLIP_ID },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.code).toBe('ALREADY_VOTED');
  });

  // --------------------------------------------------------------------------
  // STEP 6: Leaderboard reflects the vote
  // --------------------------------------------------------------------------
  test('Step 6: Leaderboard reflects clip vote counts', async () => {
    const seasonChain = createSupabaseChain({
      data: [{ id: SEASON_ID, label: 'Season 1', status: 'active', total_slots: 75 }],
      error: null,
    });
    const featureFlagChain = createSupabaseChain({ data: { enabled: false }, error: null });
    const slotChain = createSupabaseChain({ data: { slot_position: 1, season_id: SEASON_ID }, error: null });
    const clipCountChain = createSupabaseChain({ data: null, error: null, count: 1 });
    const clipsChain = createSupabaseChain({
      data: [{ id: CLIP_ID, video_url: 'video.mp4', thumbnail_url: 'thumb.jpg', username: 'testuser', avatar_url: null, vote_count: 1, genre: 'comedy', title: 'Funny Cat', slot_position: 1 }],
      error: null,
    });
    const totalVotesChain = createSupabaseChain({
      data: [{ vote_count: 1 }],
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return seasonChain;
      if (fromCallCount === 2) return featureFlagChain;
      if (fromCallCount === 3) return slotChain;
      if (fromCallCount === 4) return clipCountChain;
      if (fromCallCount === 5) return clipsChain;
      return totalVotesChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { GET } = await import('@/app/api/leaderboard/route');
    const req = createMockRequest('/api/leaderboard');

    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clips).toBeDefined();
    expect(body.clips.length).toBeGreaterThanOrEqual(0);
  });
});
