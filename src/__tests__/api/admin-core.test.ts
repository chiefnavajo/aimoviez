/**
 * @jest-environment node
 */

/**
 * Admin Core API Routes - Unit Tests
 *
 * Covers:
 *   POST /api/admin/approve
 *   POST /api/admin/reject
 *   POST /api/admin/advance-slot
 *   POST /api/admin/assign-winner
 *   POST /api/admin/update-clip-status
 *   POST /api/admin/update-slot-status
 *   POST /api/admin/reset-user-votes
 *   POST /api/admin/bulk
 *
 * Uses Jest with mocks (no real DB).
 */

// ---------------------------------------------------------------------------
// Module mocks (must come before imports)
// ---------------------------------------------------------------------------

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/csrf', () => ({
  requireCsrf: jest.fn().mockReturnValue(null),
}));
jest.mock('@/lib/admin-auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
  requireAdminWithAuth: jest.fn().mockResolvedValue({
    isAdmin: true,
    userId: '660e8400-e29b-41d4-a716-446655440000',
    email: 'admin@test.com',
  }),
  checkAdminAuth: jest.fn().mockResolvedValue({
    isAdmin: true,
    userId: '660e8400-e29b-41d4-a716-446655440000',
    email: 'admin@test.com',
  }),
}));
jest.mock('@/lib/audit-log', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/leaderboard-redis', () => ({
  clearSlotLeaderboard: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/vote-validation-redis', () => ({
  setSlotState: jest.fn().mockResolvedValue(undefined),
  clearVotingFrozen: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/crdt-vote-counter', () => ({
  clearClips: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/counter-sync', () => ({
  forceSyncCounters: jest.fn().mockResolvedValue({ synced: 0 }),
}));
jest.mock('@/lib/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import {
  createSupabaseChain,
  createMockRequest,
  parseResponse,
  TEST_ADMIN,
} from '../helpers/api-test-utils';

import { POST as approvePost } from '@/app/api/admin/approve/route';
import { POST as rejectPost } from '@/app/api/admin/reject/route';
import { POST as advanceSlotPost } from '@/app/api/admin/advance-slot/route';
import { POST as assignWinnerPost } from '@/app/api/admin/assign-winner/route';
import { POST as updateClipStatusPost } from '@/app/api/admin/update-clip-status/route';
import { POST as updateSlotStatusPost } from '@/app/api/admin/update-slot-status/route';
import { POST as resetUserVotesPost } from '@/app/api/admin/reset-user-votes/route';
import { POST as bulkPost } from '@/app/api/admin/bulk/route';

const mockCreateClient = createClient as jest.Mock;
const mockRequireAdmin = requireAdmin as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// UUIDs must satisfy RFC4122 v4 pattern (version nibble [1-5], variant nibble [89ab])
// to pass the stricter regex in approve route
const VALID_UUID = 'a1111111-1111-4111-a111-111111111111';
const VALID_UUID_2 = 'b2222222-2222-4222-a222-222222222222';
const SEASON_ID = 'c3333333-3333-4333-a333-333333333333';
const SLOT_ID = 'd4444444-4444-4444-a444-444444444444';

/**
 * Creates a sequential Supabase mock where each .from() call returns
 * a fresh chain with the next response in the array.
 */
function createSequentialMock(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  let callIndex = 0;
  const chains = responses.map((r) => createSupabaseChain(r));

  const rpcMock = jest.fn().mockResolvedValue({ data: null, error: { code: '42883' } });

  const channelSendMock = jest.fn().mockResolvedValue('ok');
  const channelUnsubMock = jest.fn().mockResolvedValue(undefined);
  const channelSubscribeMock = jest.fn((cb: (status: string) => void) => {
    // Immediately call back as SUBSCRIBED
    setTimeout(() => cb('SUBSCRIBED'), 0);
    return { send: channelSendMock, unsubscribe: channelUnsubMock };
  });
  const channelMock = jest.fn().mockReturnValue({
    subscribe: channelSubscribeMock,
    send: channelSendMock,
    unsubscribe: channelUnsubMock,
  });

  const from = jest.fn(() => {
    const chain = chains[Math.min(callIndex, chains.length - 1)];
    callIndex++;
    return chain;
  });

  return { from, chains, rpc: rpcMock, channel: channelMock };
}

/**
 * Builds a mock Supabase client and installs it via mockCreateClient.
 */
function installMock(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  const mock = createSequentialMock(responses);
  mockCreateClient.mockReturnValue(mock);
  return mock;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // Ensure env vars are set so getSupabaseClient() doesn't throw
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  process.env.CRON_SECRET = 'test-cron-secret';

  // Default: admin auth passes
  mockRequireAdmin.mockResolvedValue(null);

  // Suppress console.error/warn in tests
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  // Mock global fetch for fire-and-forget calls (extract-frame, etc.)
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ===========================================================================
// POST /api/admin/approve
// ===========================================================================

describe('POST /api/admin/approve', () => {
  it('returns 403 when not admin', async () => {
    const { NextResponse } = require('next/server');
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const req = createMockRequest('/api/admin/approve', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await approvePost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 when clipId is missing', async () => {
    const req = createMockRequest('/api/admin/approve', {
      method: 'POST',
      body: {},
    });
    const res = await approvePost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/Clip ID/i);
  });

  it('returns 400 for invalid UUID format', async () => {
    const req = createMockRequest('/api/admin/approve', {
      method: 'POST',
      body: { clipId: 'not-a-uuid' },
    });
    const res = await approvePost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/invalid/i);
  });

  it('returns 404 when clip is not found', async () => {
    installMock([
      // 1st from() -> tournament_clips select (currentClip)
      { data: null, error: null },
    ]);

    const req = createMockRequest('/api/admin/approve', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await approvePost(req);
    expect(res.status).toBe(404);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/not found/i);
  });

  it('approves clip successfully via RPC', async () => {
    const mock = createSequentialMock([
      // 1st from() -> tournament_clips select (currentClip)
      {
        data: {
          status: 'pending',
          username: 'testuser',
          season_id: SEASON_ID,
          user_id: VALID_UUID_2,
        },
        error: null,
      },
      // subsequent from() calls for fetching updated clip
      {
        data: {
          id: VALID_UUID,
          status: 'active',
          title: 'Test Clip',
        },
        error: null,
      },
    ]);
    // RPC succeeds
    mock.rpc = jest.fn().mockResolvedValue({
      data: [{ success: true, assigned_slot: 1, resumed_voting: false }],
      error: null,
    });
    mockCreateClient.mockReturnValue(mock);

    const req = createMockRequest('/api/admin/approve', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await approvePost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.success).toBe(true);
  });

  it('approves clip via legacy fallback when RPC does not exist', async () => {
    const mock = createSequentialMock([
      // 1st from() -> tournament_clips select (currentClip)
      {
        data: {
          status: 'pending',
          username: 'testuser',
          season_id: SEASON_ID,
          user_id: VALID_UUID_2,
        },
        error: null,
      },
      // 2nd from() -> story_slots select (activeSlot)
      {
        data: {
          id: SLOT_ID,
          slot_position: 1,
          status: 'voting',
        },
        error: null,
      },
      // 3rd from() -> tournament_clips update (approve)
      {
        data: {
          id: VALID_UUID,
          status: 'active',
          slot_position: 1,
        },
        error: null,
      },
    ]);
    // RPC not found
    mock.rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '42883', message: 'function not found' },
    });
    mockCreateClient.mockReturnValue(mock);

    const req = createMockRequest('/api/admin/approve', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await approvePost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.success).toBe(true);
    expect(body.assignedToSlot).toBe(1);
  });
});

// ===========================================================================
// POST /api/admin/reject
// ===========================================================================

describe('POST /api/admin/reject', () => {
  it('returns 403 when not admin', async () => {
    const { NextResponse } = require('next/server');
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const req = createMockRequest('/api/admin/reject', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await rejectPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 when clipId is missing', async () => {
    const req = createMockRequest('/api/admin/reject', {
      method: 'POST',
      body: {},
    });
    const res = await rejectPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid UUID format', async () => {
    const req = createMockRequest('/api/admin/reject', {
      method: 'POST',
      body: { clipId: 'bad-uuid' },
    });
    const res = await rejectPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/invalid/i);
  });

  it('returns 409 when trying to reject a locked clip', async () => {
    installMock([
      // tournament_clips select -> locked clip
      {
        data: {
          status: 'locked',
          username: 'testuser',
          slot_position: 1,
          season_id: SEASON_ID,
          user_id: VALID_UUID_2,
        },
        error: null,
      },
    ]);

    const req = createMockRequest('/api/admin/reject', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await rejectPost(req);
    expect(res.status).toBe(409);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/locked/i);
  });

  it('returns 200 (no-op) when clip is already rejected', async () => {
    installMock([
      {
        data: {
          status: 'rejected',
          username: 'testuser',
          slot_position: 1,
          season_id: SEASON_ID,
          user_id: VALID_UUID_2,
        },
        error: null,
      },
    ]);

    const req = createMockRequest('/api/admin/reject', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await rejectPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.message).toMatch(/already rejected/i);
  });

  it('rejects clip successfully', async () => {
    installMock([
      // tournament_clips select (currentClip) - pending clip
      {
        data: {
          status: 'pending',
          username: 'testuser',
          slot_position: null,
          season_id: SEASON_ID,
          user_id: VALID_UUID_2,
        },
        error: null,
      },
      // tournament_clips update (reject)
      {
        data: {
          id: VALID_UUID,
          status: 'rejected',
        },
        error: null,
      },
    ]);

    const req = createMockRequest('/api/admin/reject', {
      method: 'POST',
      body: { clipId: VALID_UUID, reason: 'Violates guidelines' },
    });
    const res = await rejectPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/rejected/i);
  });
});

// ===========================================================================
// POST /api/admin/advance-slot
// ===========================================================================

describe('POST /api/admin/advance-slot', () => {
  it('returns 403 when not admin', async () => {
    const { NextResponse } = require('next/server');
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const req = createMockRequest('/api/admin/advance-slot', {
      method: 'POST',
      body: {},
    });
    const res = await advanceSlotPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 409 when lock cannot be acquired', async () => {
    const mock = createSequentialMock([
      // 1st from() -> cron_locks delete (clear expired)
      { data: null, error: null },
      // 2nd from() -> cron_locks insert (acquire lock) - fails (conflict)
      { data: null, error: null },
    ]);
    // Override insert to return an error for the lock
    const lockInsertChain = createSupabaseChain({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    let fromCallCount = 0;
    mock.from = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) {
        // cron_locks delete (expired)
        return createSupabaseChain({ data: null, error: null });
      }
      if (fromCallCount === 2) {
        // cron_locks insert (lock acquisition) - FAIL
        return lockInsertChain;
      }
      return createSupabaseChain({ data: null, error: null });
    });
    mockCreateClient.mockReturnValue(mock);

    const req = createMockRequest('/api/admin/advance-slot', {
      method: 'POST',
      body: {},
    });
    const res = await advanceSlotPost(req);
    expect(res.status).toBe(409);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/in progress/i);
  });

  it('returns 400 when no active season found', async () => {
    // Flow for empty body: cron_locks delete, insert, feature_flags, seasons
    let fromCallCount = 0;
    const mock = {
      from: jest.fn(() => {
        fromCallCount++;
        if (fromCallCount <= 2) {
          // #1 cron_locks delete, #2 cron_locks insert (both succeed)
          return createSupabaseChain({ data: null, error: null });
        }
        if (fromCallCount === 3) {
          // #3 feature_flags for multi_genre_enabled
          return createSupabaseChain({ data: { enabled: false }, error: null });
        }
        if (fromCallCount === 4) {
          // #4 seasons query - no active season
          return createSupabaseChain({ data: null, error: null });
        }
        // finally: cron_locks delete (lock release)
        return createSupabaseChain({ data: null, error: null });
      }),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
      channel: jest.fn(),
    };
    mockCreateClient.mockReturnValue(mock);

    const req = createMockRequest('/api/admin/advance-slot', {
      method: 'POST',
      body: {},
    });
    const res = await advanceSlotPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/no active season/i);
  });

  it('returns 400 when no voting slot exists', async () => {
    // Flow for empty body: cron_locks delete, insert, feature_flags, seasons (found), story_slots (none)
    let fromCallCount = 0;
    const mock = {
      from: jest.fn(() => {
        fromCallCount++;
        if (fromCallCount <= 2) {
          // #1 cron_locks delete, #2 cron_locks insert
          return createSupabaseChain({ data: null, error: null });
        }
        if (fromCallCount === 3) {
          // #3 feature_flags for multi_genre_enabled
          return createSupabaseChain({ data: { enabled: false }, error: null });
        }
        if (fromCallCount === 4) {
          // #4 seasons query -> active season
          return createSupabaseChain({
            data: { id: SEASON_ID, status: 'active', total_slots: 75, genre: null },
            error: null,
          });
        }
        if (fromCallCount === 5) {
          // #5 story_slots query -> no voting slot
          return createSupabaseChain({ data: null, error: null });
        }
        // finally: cron_locks delete
        return createSupabaseChain({ data: null, error: null });
      }),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
      channel: jest.fn(),
    };
    mockCreateClient.mockReturnValue(mock);

    const req = createMockRequest('/api/admin/advance-slot', {
      method: 'POST',
      body: {},
    });
    const res = await advanceSlotPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/no active slot/i);
  });
});

// ===========================================================================
// POST /api/admin/assign-winner
// ===========================================================================

describe('POST /api/admin/assign-winner', () => {
  it('returns 403 when not admin', async () => {
    const { NextResponse } = require('next/server');
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const req = createMockRequest('/api/admin/assign-winner', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await assignWinnerPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 when clipId is missing', async () => {
    installMock([]);

    const req = createMockRequest('/api/admin/assign-winner', {
      method: 'POST',
      body: {},
    });
    const res = await assignWinnerPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/clipId/i);
  });

  it('returns 404 when clip is not found', async () => {
    installMock([
      // tournament_clips select (clipCheck) - not found
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);

    const req = createMockRequest('/api/admin/assign-winner', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await assignWinnerPost(req);
    expect(res.status).toBe(404);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 400 when no active voting slot found', async () => {
    installMock([
      // clipCheck -> found
      {
        data: { id: VALID_UUID, season_id: SEASON_ID, slot_position: 1, status: 'active' },
        error: null,
      },
      // season -> found
      {
        data: { id: SEASON_ID, status: 'active', total_slots: 75 },
        error: null,
      },
      // activeSlot -> none
      { data: null, error: null },
    ]);

    const req = createMockRequest('/api/admin/assign-winner', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await assignWinnerPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/no active voting slot/i);
  });

  it('returns 400 when clip status is not active', async () => {
    installMock([
      // clipCheck
      {
        data: { id: VALID_UUID, season_id: SEASON_ID, slot_position: 1, status: 'active' },
        error: null,
      },
      // season
      {
        data: { id: SEASON_ID, status: 'active', total_slots: 75 },
        error: null,
      },
      // activeSlot
      {
        data: { id: SLOT_ID, slot_position: 1, voting_duration_hours: 24 },
        error: null,
      },
      // clip full details -> status is 'pending', not 'active'
      {
        data: {
          id: VALID_UUID,
          title: 'Test',
          username: 'user1',
          slot_position: 1,
          status: 'pending',
          vote_count: 5,
        },
        error: null,
      },
    ]);

    const req = createMockRequest('/api/admin/assign-winner', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await assignWinnerPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/status/i);
  });

  it('assigns winner successfully via RPC', async () => {
    const mock = createSequentialMock([
      // clipCheck
      {
        data: { id: VALID_UUID, season_id: SEASON_ID, slot_position: 1, status: 'active' },
        error: null,
      },
      // season
      {
        data: { id: SEASON_ID, status: 'active', total_slots: 75 },
        error: null,
      },
      // activeSlot
      {
        data: { id: SLOT_ID, slot_position: 1, voting_duration_hours: 24 },
        error: null,
      },
      // clip full details
      {
        data: {
          id: VALID_UUID,
          title: 'Winner Clip',
          username: 'winner_user',
          slot_position: 1,
          status: 'active',
          vote_count: 10,
        },
        error: null,
      },
    ]);
    // RPC assign_winner_atomic succeeds
    mock.rpc = jest.fn().mockResolvedValue({
      data: [{ success: true, clips_moved: 3, season_finished: false, next_slot_position: 2 }],
      error: null,
    });

    // Channel mock for broadcast
    const channelMock = {
      subscribe: jest.fn((cb: (status: string) => void) => {
        setTimeout(() => cb('SUBSCRIBED'), 0);
        return channelMock;
      }),
      send: jest.fn().mockResolvedValue('ok'),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
    };
    mock.channel = jest.fn().mockReturnValue(channelMock);
    mockCreateClient.mockReturnValue(mock);

    const req = createMockRequest('/api/admin/assign-winner', {
      method: 'POST',
      body: { clipId: VALID_UUID },
    });
    const res = await assignWinnerPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.ok).toBe(true);
    expect(body.winnerClipId).toBe(VALID_UUID);
  });
});

// ===========================================================================
// POST /api/admin/update-clip-status
// ===========================================================================

describe('POST /api/admin/update-clip-status', () => {
  it('returns 403 when not admin', async () => {
    const { NextResponse } = require('next/server');
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const req = createMockRequest('/api/admin/update-clip-status', {
      method: 'POST',
      body: { clipId: VALID_UUID, newStatus: 'active' },
    });
    const res = await updateClipStatusPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing clipId', async () => {
    installMock([]);

    const req = createMockRequest('/api/admin/update-clip-status', {
      method: 'POST',
      body: { newStatus: 'active' },
    });
    const res = await updateClipStatusPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/clipId/i);
  });

  it('returns 400 for invalid clipId UUID', async () => {
    installMock([]);

    const req = createMockRequest('/api/admin/update-clip-status', {
      method: 'POST',
      body: { clipId: 'not-uuid', newStatus: 'active' },
    });
    const res = await updateClipStatusPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/UUID/i);
  });

  it('returns 400 for invalid newStatus', async () => {
    installMock([]);

    const req = createMockRequest('/api/admin/update-clip-status', {
      method: 'POST',
      body: { clipId: VALID_UUID, newStatus: 'invalid_status' },
    });
    const res = await updateClipStatusPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/newStatus/i);
  });

  it('returns 404 when clip is not found', async () => {
    installMock([
      // clipCheck -> not found
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);

    const req = createMockRequest('/api/admin/update-clip-status', {
      method: 'POST',
      body: { clipId: VALID_UUID, newStatus: 'active' },
    });
    const res = await updateClipStatusPost(req);
    expect(res.status).toBe(404);
  });

  it('returns 200 (no-op) when clip already has the requested status', async () => {
    installMock([
      // clipCheck
      {
        data: { id: VALID_UUID, season_id: SEASON_ID, slot_position: 1, status: 'active' },
        error: null,
      },
      // season
      {
        data: { id: SEASON_ID, status: 'active', total_slots: 75 },
        error: null,
      },
      // clip full details
      {
        data: {
          id: VALID_UUID,
          title: 'Test',
          username: 'user1',
          slot_position: 1,
          status: 'active',
          vote_count: 5,
          season_id: SEASON_ID,
        },
        error: null,
      },
    ]);

    const req = createMockRequest('/api/admin/update-clip-status', {
      method: 'POST',
      body: { clipId: VALID_UUID, newStatus: 'active' },
    });
    const res = await updateClipStatusPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.noOp).toBe(true);
  });

  it('updates clip status from pending to active successfully', async () => {
    installMock([
      // clipCheck
      {
        data: { id: VALID_UUID, season_id: SEASON_ID, slot_position: 1, status: 'pending' },
        error: null,
      },
      // season
      {
        data: { id: SEASON_ID, status: 'active', total_slots: 75 },
        error: null,
      },
      // clip full details
      {
        data: {
          id: VALID_UUID,
          title: 'Great Clip',
          username: 'creator1',
          slot_position: 1,
          status: 'pending',
          vote_count: 0,
          season_id: SEASON_ID,
        },
        error: null,
      },
      // update -> success
      { data: null, error: null },
      // check waiting_for_clips slot (for transition to voting)
      { data: null, error: null },
    ]);

    const req = createMockRequest('/api/admin/update-clip-status', {
      method: 'POST',
      body: { clipId: VALID_UUID, newStatus: 'active' },
    });
    const res = await updateClipStatusPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.ok).toBe(true);
    expect(body.previousStatus).toBe('pending');
    expect(body.newStatus).toBe('active');
  });
});

// ===========================================================================
// POST /api/admin/update-slot-status
// ===========================================================================

describe('POST /api/admin/update-slot-status', () => {
  it('returns 403 when not admin', async () => {
    const { NextResponse } = require('next/server');
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const req = createMockRequest('/api/admin/update-slot-status', {
      method: 'POST',
      body: { slotPosition: 1, newStatus: 'voting' },
    });
    const res = await updateSlotStatusPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing slotPosition', async () => {
    installMock([]);

    const req = createMockRequest('/api/admin/update-slot-status', {
      method: 'POST',
      body: { newStatus: 'voting' },
    });
    const res = await updateSlotStatusPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/slotPosition/i);
  });

  it('returns 400 for non-integer slotPosition', async () => {
    installMock([]);

    const req = createMockRequest('/api/admin/update-slot-status', {
      method: 'POST',
      body: { slotPosition: 1.5, newStatus: 'voting' },
    });
    const res = await updateSlotStatusPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid newStatus', async () => {
    installMock([]);

    const req = createMockRequest('/api/admin/update-slot-status', {
      method: 'POST',
      body: { slotPosition: 1, newStatus: 'invalid' },
    });
    const res = await updateSlotStatusPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/newStatus/i);
  });

  it('returns 404 when no active season is found', async () => {
    installMock([
      // season query -> none
      { data: null, error: null },
    ]);

    const req = createMockRequest('/api/admin/update-slot-status', {
      method: 'POST',
      body: { slotPosition: 1, newStatus: 'waiting_for_clips' },
    });
    const res = await updateSlotStatusPost(req);
    expect(res.status).toBe(404);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/no active season/i);
  });

  it('returns 404 when slot is not found', async () => {
    installMock([
      // season -> found
      {
        data: { id: SEASON_ID, status: 'active', total_slots: 75 },
        error: null,
      },
      // slot -> not found (slotPosition is within range but doesn't exist)
      { data: null, error: null },
    ]);

    const req = createMockRequest('/api/admin/update-slot-status', {
      method: 'POST',
      body: { slotPosition: 50, newStatus: 'waiting_for_clips' },
    });
    const res = await updateSlotStatusPost(req);
    expect(res.status).toBe(404);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 200 (no-op) when slot already has the requested status', async () => {
    installMock([
      // season
      {
        data: { id: SEASON_ID, status: 'active', total_slots: 75 },
        error: null,
      },
      // slot -> already voting
      {
        data: {
          id: SLOT_ID,
          slot_position: 1,
          status: 'voting',
          winner_tournament_clip_id: null,
          voting_started_at: new Date().toISOString(),
          voting_ends_at: new Date().toISOString(),
          voting_duration_hours: 24,
        },
        error: null,
      },
    ]);

    const req = createMockRequest('/api/admin/update-slot-status', {
      method: 'POST',
      body: { slotPosition: 1, newStatus: 'voting' },
    });
    const res = await updateSlotStatusPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.noOp).toBe(true);
  });

  it('updates slot status from upcoming to waiting_for_clips', async () => {
    const channelMock = {
      subscribe: jest.fn((cb: (status: string) => void) => {
        setTimeout(() => cb('SUBSCRIBED'), 0);
        return channelMock;
      }),
      send: jest.fn().mockResolvedValue('ok'),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
    };

    const mock = createSequentialMock([
      // season
      {
        data: { id: SEASON_ID, status: 'active', total_slots: 75 },
        error: null,
      },
      // slot
      {
        data: {
          id: SLOT_ID,
          slot_position: 3,
          status: 'upcoming',
          winner_tournament_clip_id: null,
          voting_started_at: null,
          voting_ends_at: null,
          voting_duration_hours: null,
        },
        error: null,
      },
      // update slot -> success
      { data: null, error: null },
    ]);
    mock.channel = jest.fn().mockReturnValue(channelMock);
    mockCreateClient.mockReturnValue(mock);

    const req = createMockRequest('/api/admin/update-slot-status', {
      method: 'POST',
      body: { slotPosition: 3, newStatus: 'waiting_for_clips' },
    });
    const res = await updateSlotStatusPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.ok).toBe(true);
    expect(body.previousStatus).toBe('upcoming');
    expect(body.newStatus).toBe('waiting_for_clips');
  });
});

// ===========================================================================
// POST /api/admin/reset-user-votes
// ===========================================================================

describe('POST /api/admin/reset-user-votes', () => {
  it('returns 403 when not admin', async () => {
    const { NextResponse } = require('next/server');
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const req = createMockRequest('/api/admin/reset-user-votes', {
      method: 'POST',
      body: { username: 'testuser' },
    });
    const res = await resetUserVotesPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 when username is missing', async () => {
    installMock([]);

    const req = createMockRequest('/api/admin/reset-user-votes', {
      method: 'POST',
      body: {},
    });
    const res = await resetUserVotesPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/username/i);
  });

  it('returns 400 when username is empty string', async () => {
    installMock([]);

    const req = createMockRequest('/api/admin/reset-user-votes', {
      method: 'POST',
      body: { username: '   ' },
    });
    const res = await resetUserVotesPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when user is not found', async () => {
    installMock([
      // users select -> not found
      { data: null, error: null },
    ]);

    const req = createMockRequest('/api/admin/reset-user-votes', {
      method: 'POST',
      body: { username: 'nonexistent_user' },
    });
    const res = await resetUserVotesPost(req);
    expect(res.status).toBe(404);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/not found/i);
  });

  it('resets votes successfully', async () => {
    installMock([
      // users select -> found
      {
        data: {
          id: VALID_UUID,
          username: 'testuser',
          email: 'testuser@example.com',
        },
        error: null,
      },
      // votes count
      { data: null, error: null, count: 15 },
      // votes delete
      { data: null, error: null },
    ]);

    const req = createMockRequest('/api/admin/reset-user-votes', {
      method: 'POST',
      body: { username: 'testuser' },
    });
    const res = await resetUserVotesPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.ok).toBe(true);
    expect(body.votes_deleted).toBe(15);
    expect(body.user.username).toBe('testuser');
  });

  it('strips leading @ from username', async () => {
    installMock([
      // users select
      {
        data: {
          id: VALID_UUID,
          username: 'testuser',
          email: 'testuser@example.com',
        },
        error: null,
      },
      // votes count
      { data: null, error: null, count: 0 },
      // votes delete
      { data: null, error: null },
    ]);

    const req = createMockRequest('/api/admin/reset-user-votes', {
      method: 'POST',
      body: { username: '@testuser' },
    });
    const res = await resetUserVotesPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.ok).toBe(true);
  });
});

// ===========================================================================
// POST /api/admin/bulk
// ===========================================================================

describe('POST /api/admin/bulk', () => {
  it('returns 403 when not admin', async () => {
    const { NextResponse } = require('next/server');
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    );

    const req = createMockRequest('/api/admin/bulk', {
      method: 'POST',
      body: { action: 'approve', clipIds: [VALID_UUID] },
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid action', async () => {
    const req = createMockRequest('/api/admin/bulk', {
      method: 'POST',
      body: { action: 'invalid_action', clipIds: [VALID_UUID] },
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/invalid action/i);
  });

  it('returns 400 when clipIds is empty', async () => {
    const req = createMockRequest('/api/admin/bulk', {
      method: 'POST',
      body: { action: 'approve', clipIds: [] },
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/non-empty/i);
  });

  it('returns 400 when clipIds exceeds limit of 50', async () => {
    const ids = Array.from({ length: 51 }, (_, i) =>
      `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`
    );

    const req = createMockRequest('/api/admin/bulk', {
      method: 'POST',
      body: { action: 'approve', clipIds: ids },
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/50/);
  });

  it('returns 400 when clipIds contain invalid UUIDs', async () => {
    const req = createMockRequest('/api/admin/bulk', {
      method: 'POST',
      body: { action: 'approve', clipIds: ['not-a-uuid', VALID_UUID] },
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(400);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/invalid/i);
  });

  it('bulk approves clips successfully', async () => {
    installMock([
      // sampleClip -> find pending clip for season_id
      {
        data: { season_id: SEASON_ID },
        error: null,
      },
      // activeSlot for slot_position
      {
        data: { slot_position: 1 },
        error: null,
      },
      // tournament_clips update (approve)
      {
        data: [{ id: VALID_UUID }, { id: VALID_UUID_2 }],
        error: null,
      },
      // check for waiting_for_clips slot transition
      {
        data: { id: SLOT_ID, slot_position: 1 },
        error: null,
      },
      // update slot to voting
      { data: null, error: null },
    ]);

    const req = createMockRequest('/api/admin/bulk', {
      method: 'POST',
      body: { action: 'approve', clipIds: [VALID_UUID, VALID_UUID_2] },
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.success).toBe(true);
    expect(body.action).toBe('approve');
    expect(body.updated).toBe(2);
  });

  it('bulk rejects clips successfully', async () => {
    installMock([
      // tournament_clips update (reject)
      {
        data: [{ id: VALID_UUID }],
        error: null,
      },
    ]);

    const req = createMockRequest('/api/admin/bulk', {
      method: 'POST',
      body: { action: 'reject', clipIds: [VALID_UUID] },
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.success).toBe(true);
    expect(body.action).toBe('reject');
    expect(body.updated).toBe(1);
  });

  it('bulk delete returns 409 when all clips are winners', async () => {
    installMock([
      // story_slots query -> all clipIds are winners
      {
        data: [
          { slot_position: 1, winner_tournament_clip_id: VALID_UUID },
        ],
        error: null,
      },
    ]);

    const req = createMockRequest('/api/admin/bulk', {
      method: 'POST',
      body: { action: 'delete', clipIds: [VALID_UUID] },
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(409);
    const { body } = await parseResponse(res);
    expect(body.error).toMatch(/winner/i);
  });

  it('bulk delete succeeds for non-winner clips', async () => {
    installMock([
      // story_slots query -> no winners
      { data: [], error: null },
      // active clips to delete (for slot cleanup)
      { data: [], error: null },
      // tournament_clips delete
      {
        data: [{ id: VALID_UUID }],
        error: null,
      },
    ]);

    const req = createMockRequest('/api/admin/bulk', {
      method: 'POST',
      body: { action: 'delete', clipIds: [VALID_UUID] },
    });
    const res = await bulkPost(req);
    expect(res.status).toBe(200);
    const { body } = await parseResponse(res);
    expect(body.success).toBe(true);
    expect(body.action).toBe('delete');
  });
});
