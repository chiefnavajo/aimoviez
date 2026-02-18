/**
 * @jest-environment node
 *
 * SEASON LIFECYCLE FLOW TEST
 * Tests the full season lifecycle:
 *   Admin creates season -> Slots advance -> Voting rounds -> Winner selected -> Season finishes
 *
 * Imports route handlers and calls them in sequence with shared mocked state.
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
const mockGetGenreCodes = jest.fn().mockReturnValue(['comedy', 'action']);
const mockClearSlotLeaderboard = jest.fn().mockResolvedValue(undefined);
const mockClearVotingFrozen = jest.fn().mockResolvedValue(undefined);
const mockSetSlotState = jest.fn().mockResolvedValue(undefined);
const mockClearClips = jest.fn().mockResolvedValue(undefined);
const mockForceSyncCounters = jest.fn().mockResolvedValue({ synced: 0 });

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/admin-auth', () => ({ requireAdmin: mockRequireAdmin, checkAdminAuth: mockCheckAdminAuth }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/audit-log', () => ({ logAdminAction: mockLogAdminAction }));
jest.mock('@/lib/genres', () => ({ isValidGenre: mockIsValidGenre, getGenreCodes: mockGetGenreCodes }));
jest.mock('@/lib/leaderboard-redis', () => ({ clearSlotLeaderboard: mockClearSlotLeaderboard }));
jest.mock('@/lib/vote-validation-redis', () => ({
  clearVotingFrozen: mockClearVotingFrozen,
  setSlotState: mockSetSlotState,
}));
jest.mock('@/lib/crdt-vote-counter', () => ({ clearClips: mockClearClips }));
jest.mock('@/lib/counter-sync', () => ({ forceSyncCounters: mockForceSyncCounters }));
jest.mock('@/lib/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

// ============================================================================
// IMPORTS
// ============================================================================

import {
  createMockRequest,
  createSupabaseChain,
  parseResponse,
  TEST_ADMIN,
} from '../helpers/api-test-utils';

// ============================================================================
// SHARED STATE
// ============================================================================

const SEASON_ID = 'season-lifecycle-001';
const SLOT_1_ID = 'slot-lc-001';
const SLOT_2_ID = 'slot-lc-002';
const WINNER_CLIP_ID = 'clip-winner-001';

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

function setupAdminAuth() {
  mockRequireAdmin.mockResolvedValue(null);
  mockCheckAdminAuth.mockResolvedValue({
    isAdmin: true,
    userId: TEST_ADMIN.userId,
    email: TEST_ADMIN.email,
  });
}

// ============================================================================
// TESTS
// ============================================================================

describe('Season Lifecycle Flow: Create -> Advance -> Winner -> Finish', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.CRON_SECRET = 'cron-secret';
    setupAdminAuth();
  });

  // --------------------------------------------------------------------------
  // STEP 1: Admin creates a new season
  // --------------------------------------------------------------------------
  test('Step 1: Admin creates a season with auto_activate', async () => {
    const deactivateChain = createSupabaseChain({ data: null, error: null });
    const insertSeasonChain = createSupabaseChain({
      data: { id: SEASON_ID, label: 'Test Season', status: 'active', total_slots: 3 },
      error: null,
    });
    const insertSlotsChain = createSupabaseChain({ data: null, error: null });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return deactivateChain;  // deactivate existing
      if (fromCallCount === 2) return insertSeasonChain; // insert new season
      return insertSlotsChain;                            // insert slots
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/admin/seasons/route');
    const req = createMockRequest('/api/admin/seasons', {
      method: 'POST',
      body: { label: 'Test Season', total_slots: 3, auto_activate: true },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.season.id).toBe(SEASON_ID);
  });

  // --------------------------------------------------------------------------
  // STEP 2: Admin lists seasons
  // --------------------------------------------------------------------------
  test('Step 2: Admin lists seasons with stats', async () => {
    const seasonsChain = createSupabaseChain({
      data: [{ id: SEASON_ID, label: 'Test Season', status: 'active', total_slots: 3, created_at: new Date().toISOString(), description: '', genre: null }],
      error: null,
    });
    const slotsChain = createSupabaseChain({
      data: [
        { season_id: SEASON_ID, status: 'voting' },
        { season_id: SEASON_ID, status: 'upcoming' },
        { season_id: SEASON_ID, status: 'upcoming' },
      ],
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return seasonsChain;
      return slotsChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { GET } = await import('@/app/api/admin/seasons/route');
    const req = createMockRequest('/api/admin/seasons');

    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.seasons).toHaveLength(1);
    expect(body.seasons[0].stats.voting_slots).toBe(1);
  });

  // --------------------------------------------------------------------------
  // STEP 3: Admin advances slot (winner selected, next slot opens)
  // --------------------------------------------------------------------------
  test('Step 3: Admin advances slot - winner selected, next slot opens', async () => {
    // Locks, season, slot, winner, etc.
    const cronLockDeleteChain = createSupabaseChain({ data: null, error: null });
    const cronLockInsertChain = createSupabaseChain({ data: null, error: null });
    const featureFlagChain = createSupabaseChain({ data: { enabled: false }, error: null });
    const seasonChain = createSupabaseChain({
      data: { id: SEASON_ID, status: 'active', label: 'Test Season', total_slots: 3, genre: null },
      error: null,
    });
    const votingSlotChain = createSupabaseChain({
      data: { id: SLOT_1_ID, season_id: SEASON_ID, slot_position: 1, status: 'voting', genre: null, winner_tournament_clip_id: null, voting_duration_hours: 24 },
      error: null,
    });
    const slotClipsChain = createSupabaseChain({
      data: [{ id: WINNER_CLIP_ID }],
      error: null,
    });
    const winnerChain = createSupabaseChain({
      data: { id: WINNER_CLIP_ID, slot_position: 1, vote_count: 10, weighted_score: 10 },
      error: null,
    });
    const lockSlotChain = createSupabaseChain({ data: { id: SLOT_1_ID }, error: null });
    const lockWinnerClipChain = createSupabaseChain({ data: null, error: null });
    const verifyWinnerChain = createSupabaseChain({ data: { status: 'locked' }, error: null });
    const eliminateChain = createSupabaseChain({ data: [], error: null });
    const nextSlotClipCountChain = createSupabaseChain({ data: null, error: null, count: 2 });
    const nextSlotChain = createSupabaseChain({
      data: { id: SLOT_2_ID, season_id: SEASON_ID, slot_position: 2, status: 'voting' },
      error: null,
    });
    const lockReleaseChain = createSupabaseChain({ data: null, error: null });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return cronLockDeleteChain;   // delete expired locks
      if (fromCallCount === 2) return cronLockInsertChain;   // insert lock
      // Note: first feature_flags check (targetGenre guard) is SKIPPED because body is {}
      if (fromCallCount === 3) return featureFlagChain;      // multi_genre_enabled check
      if (fromCallCount === 4) return seasonChain;           // seasons query
      if (fromCallCount === 5) return votingSlotChain;       // active slot
      if (fromCallCount === 6) return slotClipsChain;        // clips for sync
      if (fromCallCount === 7) return winnerChain;           // winner
      if (fromCallCount === 8) return lockSlotChain;         // lock slot
      if (fromCallCount === 9) return lockWinnerClipChain;   // lock winner clip
      if (fromCallCount === 10) return verifyWinnerChain;    // verify winner
      if (fromCallCount === 11) return eliminateChain;       // eliminate losers
      if (fromCallCount === 12) return nextSlotClipCountChain; // next slot clips count
      if (fromCallCount === 13) return nextSlotChain;        // update next slot
      return lockReleaseChain;                                // release lock (finally)
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    // Mock global fetch for frame extraction fire-and-forget
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    try {
      const { POST } = await import('@/app/api/admin/advance-slot/route');
      const req = createMockRequest('/api/admin/advance-slot', { method: 'POST', body: {} });

      const res = await POST(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.winnerClipId).toBe(WINNER_CLIP_ID);
      expect(body.nextSlotPosition).toBe(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // --------------------------------------------------------------------------
  // STEP 4: Admin assigns winner manually
  // --------------------------------------------------------------------------
  test('Step 4: Admin manually assigns a winner', async () => {
    const clipCheckChain = createSupabaseChain({
      data: { id: WINNER_CLIP_ID, season_id: SEASON_ID, slot_position: 1, status: 'active' },
      error: null,
    });
    const seasonChain = createSupabaseChain({
      data: { id: SEASON_ID, status: 'active', total_slots: 3 },
      error: null,
    });
    const activeSlotChain = createSupabaseChain({
      data: { id: SLOT_1_ID, slot_position: 1, voting_duration_hours: 24 },
      error: null,
    });
    const clipChain = createSupabaseChain({
      data: { id: WINNER_CLIP_ID, title: 'Winning Clip', username: 'winner_user', slot_position: 1, status: 'active', vote_count: 15 },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return clipCheckChain;
      if (fromCallCount === 2) return seasonChain;
      if (fromCallCount === 3) return activeSlotChain;
      if (fromCallCount === 4) return clipChain;
      // All subsequent calls return success chains
      return createSupabaseChain({ data: null, error: null });
    });

    const rpcResult = [{
      success: true,
      clips_moved: 2,
      season_finished: false,
      next_slot_position: 2,
    }];
    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({ data: rpcResult, error: null }));

    const channelMock = {
      subscribe: jest.fn((cb: (status: string) => void) => { cb('SUBSCRIBED'); return channelMock; }),
      send: jest.fn().mockResolvedValue('ok'),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
    };
    mockCreateClient.mockReturnValue({
      ...buildSupabaseMock({ from: fromMock, rpc: rpcMock }),
      channel: jest.fn().mockReturnValue(channelMock),
    });

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    try {
      const { POST } = await import('@/app/api/admin/assign-winner/route');
      const req = createMockRequest('/api/admin/assign-winner', {
        method: 'POST',
        body: { clipId: WINNER_CLIP_ID, advanceSlot: true },
      });

      const res = await POST(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.winnerClipId).toBe(WINNER_CLIP_ID);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // --------------------------------------------------------------------------
  // STEP 5: Non-admin cannot create seasons
  // --------------------------------------------------------------------------
  test('Step 5: Non-admin is rejected from admin endpoints', async () => {
    const { NextResponse } = require('next/server');
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const { POST } = await import('@/app/api/admin/seasons/route');
    const req = createMockRequest('/api/admin/seasons', {
      method: 'POST',
      body: { label: 'Hacker Season' },
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  // --------------------------------------------------------------------------
  // STEP 6: Season label is required when creating
  // --------------------------------------------------------------------------
  test('Step 6: Season creation requires a label', async () => {
    setupAdminAuth();
    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: jest.fn() }));

    const { POST } = await import('@/app/api/admin/seasons/route');
    const req = createMockRequest('/api/admin/seasons', {
      method: 'POST',
      body: { total_slots: 10 },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('label');
  });
});
