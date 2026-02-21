/**
 * @jest-environment node
 *
 * ADVANCE-SLOT CONSISTENCY REGRESSION TESTS
 * Tests for the admin advance-slot route's multi-step transaction.
 *
 * The advance-slot route performs 10+ sequential operations:
 *   1. Lock acquisition (cron_locks)
 *   2. Season query
 *   3. Slot query (status='voting')
 *   4. CRDT sync (forceSyncCounters)
 *   5. Winner selection
 *   6. Slot lock (status → 'locked', set winner)
 *   7. Winner clip lock (status → 'locked')
 *   8. Winner verification
 *   9. Loser elimination
 *   10. Next slot activation
 *   finally: lock release
 *
 * Bug categories:
 *   - Partial failure leaves inconsistent state
 *   - Lock not released after exceptions
 *   - Double-advance prevention
 *   - Data consistency after forceSyncCounters failure
 */

// ============================================================================
// MOCKS
// ============================================================================

const mockCreateClient = jest.fn();
const mockRequireAdmin = jest.fn().mockResolvedValue(null);
const mockCheckAdminAuth = jest.fn().mockReturnValue({ email: 'admin@test.com', userId: 'admin-001' });
const mockRateLimit = jest.fn().mockResolvedValue(null);
const mockLogAdminAction = jest.fn().mockResolvedValue(undefined);
const mockClearSlotLeaderboard = jest.fn().mockResolvedValue(undefined);
const mockSetSlotState = jest.fn().mockResolvedValue(undefined);
const mockClearVotingFrozen = jest.fn().mockResolvedValue(undefined);
const mockClearClips = jest.fn().mockResolvedValue(undefined);
const mockForceSyncCounters = jest.fn().mockResolvedValue({ synced: 3 });

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('@/lib/admin-auth', () => ({
  requireAdmin: mockRequireAdmin,
  checkAdminAuth: mockCheckAdminAuth,
}));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/audit-log', () => ({ logAdminAction: mockLogAdminAction }));
jest.mock('@/lib/leaderboard-redis', () => ({
  clearSlotLeaderboard: mockClearSlotLeaderboard,
}));
jest.mock('@/lib/vote-validation-redis', () => ({
  setSlotState: mockSetSlotState,
  clearVotingFrozen: mockClearVotingFrozen,
}));
jest.mock('@/lib/crdt-vote-counter', () => ({
  clearClips: mockClearClips,
}));
jest.mock('@/lib/counter-sync', () => ({
  forceSyncCounters: mockForceSyncCounters,
}));
jest.mock('@/lib/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

// ============================================================================
// IMPORTS
// ============================================================================

import { createSupabaseChain, parseResponse } from '../helpers/api-test-utils';
import { NextRequest } from 'next/server';

// ============================================================================
// HELPERS
// ============================================================================

const SEASON_ID = 'season-adv-001';
const SLOT_ID = 'slot-adv-001';
const WINNER_ID = 'clip-adv-winner';
const LOSER_ID = 'clip-adv-loser';

function createRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost:3000/api/admin/advance-slot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface AdvanceSlotMockConfig {
  lockError?: boolean;
  season?: Record<string, unknown> | null;
  slot?: Record<string, unknown> | null;
  syncClips?: Array<{ id: string }>;
  winner?: Record<string, unknown> | null;
  slotLockResult?: Record<string, unknown> | null;
  slotLockError?: boolean;
  winnerLockError?: boolean;
  winnerVerify?: Record<string, unknown> | null;
  eliminateError?: boolean;
  eliminatedClips?: Array<Record<string, unknown>>;
  nextSlot?: Record<string, unknown> | null;
  nextSlotUpdate?: Record<string, unknown> | null;
}

function setupAdvanceSlotMocks(config: AdvanceSlotMockConfig = {}) {
  const {
    lockError = false,
    season = { id: SEASON_ID, status: 'active', label: 'Test Season', total_slots: 5, genre: 'action' },
    slot = { id: SLOT_ID, season_id: SEASON_ID, slot_position: 2, status: 'voting', genre: 'action', winner_tournament_clip_id: null, voting_duration_hours: 24 },
    syncClips = [{ id: WINNER_ID }, { id: LOSER_ID }],
    winner = { id: WINNER_ID, slot_position: 2, vote_count: 10, weighted_score: 15 },
    slotLockResult = { id: SLOT_ID },
    slotLockError = false,
    winnerLockError = false,
    winnerVerify = { status: 'locked' },
    eliminateError = false,
    eliminatedClips = [{ id: LOSER_ID, user_id: 'user-loser', title: 'Loser Clip' }],
    nextSlot = { id: 'slot-adv-next', slot_position: 3, status: 'upcoming' },
    nextSlotUpdate = { id: 'slot-adv-next' },
  } = config;

  // Track calls per table to route correctly (same table called multiple times)
  const tableCallCounts: Record<string, number> = {};

  const fromMock = jest.fn((tableName: string) => {
    const callNum = (tableCallCounts[tableName] || 0) + 1;
    tableCallCounts[tableName] = callNum;

    switch (tableName) {
      case 'cron_locks': {
        if (callNum === 1) {
          // 1st: delete expired locks — chainable, resolves ok
          return createSupabaseChain({ data: null, error: null });
        }
        // 2nd: insert lock — needs .insert() method
        const insertChain = createSupabaseChain({ data: null, error: null });
        // Override insert to return the lock result directly
        insertChain.insert = jest.fn().mockReturnValue(
          Promise.resolve({
            error: lockError ? { code: '23505', message: 'Lock already held' } : null,
          })
        );
        return insertChain;
      }

      case 'feature_flags':
        // multi_genre_enabled check (always returns disabled for simplicity)
        return createSupabaseChain({ data: { enabled: false }, error: null });

      case 'seasons':
        return createSupabaseChain({ data: season, error: null });

      case 'story_slots': {
        if (callNum === 1) {
          // Get voting slot
          return createSupabaseChain({ data: slot, error: null });
        }
        if (callNum === 2) {
          // Lock slot (update status → 'locked')
          return createSupabaseChain({
            data: slotLockResult,
            error: slotLockError ? { message: 'Lock failed' } : null,
          });
        }
        if (callNum === 3) {
          // Get next slot
          return createSupabaseChain({ data: nextSlot, error: null });
        }
        // Activate next slot (update)
        return createSupabaseChain({ data: nextSlotUpdate, error: null });
      }

      case 'tournament_clips': {
        if (callNum === 1) {
          // Get clip IDs for sync
          return createSupabaseChain({ data: syncClips, error: null });
        }
        if (callNum === 2) {
          // Get winner
          return createSupabaseChain({ data: winner, error: null });
        }
        if (callNum === 3) {
          // Lock winner clip (update status → 'locked')
          return createSupabaseChain({
            data: null,
            error: winnerLockError ? { message: 'Winner lock failed' } : null,
          });
        }
        if (callNum === 4) {
          // Verify winner status
          return createSupabaseChain({ data: winnerVerify, error: null });
        }
        if (callNum === 5) {
          // Eliminate losers
          return createSupabaseChain({
            data: eliminatedClips,
            error: eliminateError ? { message: 'Elimination failed' } : null,
          });
        }
        // Any additional calls
        return createSupabaseChain({ data: null, error: null });
      }

      default:
        return createSupabaseChain({ data: null, error: null });
    }
  });

  const rpcMock = jest.fn().mockReturnValue(Promise.resolve({ data: null, error: null }));

  const supabaseMock = {
    from: fromMock,
    rpc: rpcMock,
  };

  mockCreateClient.mockReturnValue(supabaseMock);

  return { fromMock, supabaseMock };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Advance-Slot Consistency Regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
    process.env.CRON_SECRET = 'cron-secret';

    // Mock global fetch for fire-and-forget frame extraction
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  // --------------------------------------------------------------------------
  // Lock acquisition failure returns 409 without touching data
  // --------------------------------------------------------------------------
  test('lock acquisition fails: returns 409 without modifying any data', async () => {
    setupAdvanceSlotMocks({ lockError: true });

    const { POST } = await import('@/app/api/admin/advance-slot/route');
    const res = await POST(createRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(409);
    expect(body.error).toContain('in progress');
    // forceSyncCounters NOT called — we never got past the lock
    expect(mockForceSyncCounters).not.toHaveBeenCalled();
    // No leaderboard cleared
    expect(mockClearSlotLeaderboard).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // No active season returns 400
  // --------------------------------------------------------------------------
  test('no active season: returns 400', async () => {
    setupAdvanceSlotMocks({ season: null });

    const { POST } = await import('@/app/api/admin/advance-slot/route');
    const res = await POST(createRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('No active season');
  });

  // --------------------------------------------------------------------------
  // No voting slot returns 400
  // --------------------------------------------------------------------------
  test('no voting slot: returns 400', async () => {
    setupAdvanceSlotMocks({ slot: null });

    const { POST } = await import('@/app/api/admin/advance-slot/route');
    const res = await POST(createRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('No active slot');
  });

  // --------------------------------------------------------------------------
  // No clips in slot returns 400
  // --------------------------------------------------------------------------
  test('no clips in slot: returns 400 with descriptive message', async () => {
    setupAdvanceSlotMocks({ winner: null });

    const { POST } = await import('@/app/api/admin/advance-slot/route');
    const res = await POST(createRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('No clips found');
  });

  // --------------------------------------------------------------------------
  // Double-advance prevented: second call gets 409
  // --------------------------------------------------------------------------
  test('double advance prevented: returns 409 when slot already locked', async () => {
    setupAdvanceSlotMocks({ slotLockResult: null }); // Update returns no rows = already advanced

    const { POST } = await import('@/app/api/admin/advance-slot/route');
    const res = await POST(createRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(409);
    expect(body.error).toContain('already advanced');
  });

  // --------------------------------------------------------------------------
  // CRITICAL: Winner clip lock fails after slot locked → 500 returned
  // --------------------------------------------------------------------------
  test('winner clip lock fails after slot locked: returns 500', async () => {
    setupAdvanceSlotMocks({ winnerLockError: true });

    const { POST } = await import('@/app/api/admin/advance-slot/route');
    const res = await POST(createRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toContain('lock winning clip');
  });

  // --------------------------------------------------------------------------
  // CRITICAL: Winner verification fails → 500 returned
  // --------------------------------------------------------------------------
  test('winner verification fails: returns 500 when status not locked', async () => {
    setupAdvanceSlotMocks({ winnerVerify: { status: 'active' } }); // Not locked

    const { POST } = await import('@/app/api/admin/advance-slot/route');
    const res = await POST(createRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toContain('not updated correctly');
  });

  // --------------------------------------------------------------------------
  // forceSyncCounters failure: continues with DB values gracefully
  // --------------------------------------------------------------------------
  test('forceSyncCounters fails: advance continues using existing DB values', async () => {
    mockForceSyncCounters.mockRejectedValue(new Error('Redis connection failed'));

    setupAdvanceSlotMocks();

    const { POST } = await import('@/app/api/admin/advance-slot/route');
    const res = await POST(createRequest());
    const { status } = await parseResponse(res);

    // Should still succeed — sync failure is non-fatal
    // The winner is selected from existing DB vote_count values
    expect(mockForceSyncCounters).toHaveBeenCalled();
    // The route logs a warning but continues
    expect(status).toBeLessThan(500);
  });
});
