/**
 * @jest-environment node
 */

/**
 * Profile & User API Route Tests
 *
 * Covers:
 *   GET  /api/profile/stats          – auth required, returns vote/clip counts
 *   GET  /api/profile/clips          – auth required, returns user's clips
 *   POST /api/profile/clips/pin      – auth + CSRF, pins clip, validates ownership
 *   GET  /api/user/profile           – returns profile, unauthenticated returns exists:false
 *   GET  /api/user/check-username    – auth required, returns availability
 *   POST /api/user/create-profile    – auth + CSRF, creates user profile, validates username
 *   POST /api/user/follow            – auth + CSRF, follow user, validates target exists
 *   DELETE /api/user/follow          – auth + CSRF, unfollow user
 *   GET  /api/user/block             – auth required, returns blocked users
 *   POST /api/user/block             – auth + CSRF, block user
 *   DELETE /api/user/block           – auth + CSRF, unblock user
 *   POST /api/account/delete         – auth + CSRF, deletes account with confirmation
 *
 * Uses Jest with mocks (no real DB).
 */

// ---------------------------------------------------------------------------
// Environment variables (must be set before route modules are imported)
// ---------------------------------------------------------------------------
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

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
jest.mock('@/lib/sanitize', () => ({
  sanitizeText: jest.fn((text: string) => text),
}));
jest.mock('@/lib/storage', () => ({
  extractStorageKey: jest.fn((url: string) => ({ provider: 'supabase', key: url })),
  deleteFiles: jest.fn().mockResolvedValue({ error: null }),
}));
jest.mock('@/lib/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import {
  createMockRequest,
  createSequentialMock,
  parseResponse,
  mockSession,
  TEST_USER,
} from '../helpers/api-test-utils';

import { GET as profileStatsGET } from '@/app/api/profile/stats/route';
import { GET as profileClipsGET } from '@/app/api/profile/clips/route';
import { POST as profileClipsPinPOST } from '@/app/api/profile/clips/pin/route';
import { GET as userProfileGET } from '@/app/api/user/profile/route';
import { GET as checkUsernameGET } from '@/app/api/user/check-username/route';
import { POST as createProfilePOST } from '@/app/api/user/create-profile/route';
import { POST as followPOST, DELETE as followDELETE } from '@/app/api/user/follow/route';
import { GET as blockGET, POST as blockPOST, DELETE as blockDELETE } from '@/app/api/user/block/route';
import { POST as accountDeletePOST } from '@/app/api/account/delete/route';

const mockCreateClient = createClient as jest.Mock;
const mockGetSession = getServerSession as jest.Mock;

// ---------------------------------------------------------------------------
// Chainable Supabase mock helper
// ---------------------------------------------------------------------------

function createChainMock(
  resolveValue: { data?: unknown; error?: unknown; count?: number | null } = {}
) {
  const resolved = {
    data: resolveValue.data ?? null,
    error: resolveValue.error ?? null,
    count: resolveValue.count ?? null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'lt', 'gt', 'gte', 'lte',
    'ilike', 'like', 'is', 'or', 'not',
    'order', 'limit', 'range',
  ].forEach((m) => {
    chain[m] = jest.fn(() => chain);
  });
  chain.single = jest.fn(() => Promise.resolve(resolved));
  chain.maybeSingle = jest.fn(() => Promise.resolve(resolved));
  chain.then = jest.fn((resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolved).then(resolve)
  );
  chain.rpc = jest.fn(() => Promise.resolve({ data: null, error: null }));
  return chain;
}

/**
 * Build a mock Supabase client whose .from() returns chains in order.
 * Each entry is the resolve value for the next .from() call.
 */
function buildSequentialClient(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>,
  rpcResponse?: { data?: unknown; error?: unknown }
) {
  let idx = 0;
  const chains = responses.map((r) => createChainMock(r));
  const from = jest.fn(() => {
    const chain = chains[Math.min(idx, chains.length - 1)];
    idx++;
    return chain;
  });
  const rpc = jest.fn(() =>
    Promise.resolve({
      data: rpcResponse?.data ?? null,
      error: rpcResponse?.error ?? null,
    })
  );
  return { from, rpc, chains };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Suppress console.error / console.warn noise in tests
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

// ===========================================================================
// GET /api/profile/stats
// ===========================================================================

describe('GET /api/profile/stats', () => {
  const url = '/api/profile/stats';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(url);
    const res = await profileStatsGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication required/i);
  });

  it('returns 404 when user not found in DB', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url);
    const res = await profileStatsGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toMatch(/user not found/i);
  });

  it('returns stats with vote and clip counts for authenticated user', async () => {
    mockSession(mockGetSession, TEST_USER);

    const userId = TEST_USER.userId;
    const client = buildSequentialClient(
      [
        // 1: users lookup by email
        { data: { id: userId, username: 'testuser', avatar_url: null, email: TEST_USER.email } },
        // 2: users stats
        { data: { total_votes_cast: 42, xp: 500, votes_today: 5, current_streak: 3, longest_streak: 10 } },
        // 3: tournament_clips for user
        { data: [{ id: 'clip-1', slot_position: 1 }, { id: 'clip-2', slot_position: 2 }] },
        // 4: story_slots for locked clips
        { data: [{ winner_tournament_clip_id: 'clip-1' }] },
      ],
      // rpc: get_user_rank_by_id
      { data: [{ global_rank: 5, total_users: 100 }] }
    );
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url);
    const res = await profileStatsGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.user.username).toBe('testuser');
    expect(body.stats.total_votes).toBe(42);
    expect(body.stats.clips_uploaded).toBe(2);
    expect(body.stats.clips_locked_in).toBe(1);
    expect(body.stats.global_rank).toBe(5);
    expect(body.achievements).toBeDefined();
    expect(body.badges).toBeDefined();
    expect(body.badges.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// GET /api/profile/clips
// ===========================================================================

describe('GET /api/profile/clips', () => {
  const url = '/api/profile/clips';

  it('returns 401 with empty clips when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const client = buildSequentialClient([]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url);
    const res = await profileClipsGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.clips).toEqual([]);
    expect(body.total_clips).toBe(0);
  });

  it('returns empty clips when user has no clips', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      // users lookup
      { data: { id: TEST_USER.userId } },
      // tournament_clips
      { data: [] },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url);
    const res = await profileClipsGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.clips).toEqual([]);
    expect(body.total_clips).toBe(0);
  });

  it('returns enriched clips with statuses', async () => {
    mockSession(mockGetSession, TEST_USER);

    const userId = TEST_USER.userId;
    const client = buildSequentialClient([
      // users lookup
      { data: { id: userId } },
      // tournament_clips
      {
        data: [
          {
            id: 'clip-a', slot_position: 1, video_url: 'https://example.com/v1.mp4',
            thumbnail_url: 'https://example.com/t1.jpg', genre: 'action',
            vote_count: 10, weighted_score: 15, rank_in_track: 1,
            status: 'approved', created_at: '2026-01-01', is_pinned: false,
            eliminated_at: null, elimination_reason: null, video_deleted_at: null,
          },
        ],
      },
      // story_slots
      { data: [{ slot_position: 1, status: 'voting', winner_tournament_clip_id: null }] },
      // feature_flags (clip_elimination)
      { data: { config: { grace_period_days: 14 } } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url);
    const res = await profileClipsGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.clips.length).toBe(1);
    expect(body.clips[0].status).toBe('competing');
    expect(body.total_clips).toBe(1);
    expect(body.competing_count).toBe(1);
  });
});

// ===========================================================================
// POST /api/profile/clips/pin
// ===========================================================================

describe('POST /api/profile/clips/pin', () => {
  const url = '/api/profile/clips/pin';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(url, { method: 'POST', body: { clipId: 'clip-1' } });
    const res = await profileClipsPinPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/not authenticated/i);
  });

  it('returns 400 when clipId is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      { data: { id: TEST_USER.userId } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { method: 'POST', body: {} });
    const res = await profileClipsPinPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/clipId is required/i);
  });

  it('returns 403 when clip does not belong to the user', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      // users lookup
      { data: { id: TEST_USER.userId } },
      // tournament_clips lookup
      { data: { id: 'clip-1', user_id: 'other-user-id', status: 'eliminated', is_pinned: false, video_deleted_at: null } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { method: 'POST', body: { clipId: 'clip-1' } });
    const res = await profileClipsPinPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toMatch(/not your clip/i);
  });

  it('returns 400 when clip is not eliminated', async () => {
    mockSession(mockGetSession, TEST_USER);
    const userId = TEST_USER.userId;

    const client = buildSequentialClient([
      { data: { id: userId } },
      { data: { id: 'clip-1', user_id: userId, status: 'approved', is_pinned: false, video_deleted_at: null } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { method: 'POST', body: { clipId: 'clip-1' } });
    const res = await profileClipsPinPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/only eliminated clips/i);
  });

  it('successfully pins an eliminated clip', async () => {
    mockSession(mockGetSession, TEST_USER);
    const userId = TEST_USER.userId;

    const client = buildSequentialClient([
      // users lookup
      { data: { id: userId } },
      // tournament_clips lookup (clip is eliminated and not pinned)
      { data: { id: 'clip-1', user_id: userId, status: 'eliminated', is_pinned: false, video_deleted_at: null } },
      // count of currently pinned clips
      { data: null, count: 2 },
      // update pin status
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { method: 'POST', body: { clipId: 'clip-1' } });
    const res = await profileClipsPinPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.is_pinned).toBe(true);
  });
});

// ===========================================================================
// GET /api/user/profile
// ===========================================================================

describe('GET /api/user/profile', () => {
  const url = '/api/user/profile';

  it('returns exists:false when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(url);
    const res = await userProfileGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.exists).toBe(false);
    expect(body.user).toBeNull();
  });

  it('returns exists:false when user not found in DB', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url);
    const res = await userProfileGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.exists).toBe(false);
    expect(body.user).toBeNull();
  });

  it('returns profile data for authenticated user', async () => {
    mockSession(mockGetSession, TEST_USER);

    const userData = {
      id: TEST_USER.userId,
      username: 'testuser',
      display_name: 'Test User',
      bio: 'Hello',
      avatar_url: 'https://example.com/avatar.png',
      level: 5,
      xp: 1200,
      total_votes_cast: 100,
      total_votes_received: 50,
      clips_uploaded: 3,
      clips_locked: 1,
      followers_count: 10,
      following_count: 5,
      created_at: '2026-01-01',
    };

    const client = buildSequentialClient([{ data: userData }]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url);
    const res = await userProfileGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.user.username).toBe('testuser');
    expect(body.user.level).toBe(5);
    expect(body.user.followers_count).toBe(10);
  });
});

// ===========================================================================
// GET /api/user/check-username
// ===========================================================================

describe('GET /api/user/check-username', () => {
  const url = '/api/user/check-username';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(url, { searchParams: { username: 'testuser' } });
    const res = await checkUsernameGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.available).toBe(false);
    expect(body.error).toMatch(/authentication required/i);
  });

  it('rejects username shorter than 3 characters', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest(url, { searchParams: { username: 'ab' } });
    const res = await checkUsernameGET(req);
    const { body } = await parseResponse(res);

    expect(body.available).toBe(false);
    expect(body.error).toMatch(/at least 3 characters/i);
  });

  it('rejects reserved usernames', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest(url, { searchParams: { username: 'admin' } });
    const res = await checkUsernameGET(req);
    const { body } = await parseResponse(res);

    expect(body.available).toBe(false);
    expect(body.error).toMatch(/reserved/i);
  });

  it('rejects invalid characters', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest(url, { searchParams: { username: 'user@name' } });
    const res = await checkUsernameGET(req);
    const { body } = await parseResponse(res);

    expect(body.available).toBe(false);
    expect(body.error).toMatch(/invalid characters/i);
  });

  it('returns available:true when username is free', async () => {
    mockSession(mockGetSession, TEST_USER);

    // No user found with that username (PGRST116 = no rows)
    const client = buildSequentialClient([
      { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { searchParams: { username: 'newuser123' } });
    const res = await checkUsernameGET(req);
    const { body } = await parseResponse(res);

    expect(body.available).toBe(true);
  });

  it('returns available:false when username is taken', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      { data: { id: 'some-other-user-id' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { searchParams: { username: 'takenuser' } });
    const res = await checkUsernameGET(req);
    const { body } = await parseResponse(res);

    expect(body.available).toBe(false);
  });
});

// ===========================================================================
// POST /api/user/create-profile
// ===========================================================================

describe('POST /api/user/create-profile', () => {
  const url = '/api/user/create-profile';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { username: 'newuser' },
    });
    const res = await createProfilePOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/authentication required/i);
  });

  it('returns 400 when username is too short', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { username: 'ab' },
    });
    const res = await createProfilePOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/at least 3 characters/i);
  });

  it('returns 400 when username has invalid format', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { username: 'UPPER-case!' },
    });
    const res = await createProfilePOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid username format/i);
  });

  it('returns 409 when email already has a profile', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      // existing user by email
      { data: { id: TEST_USER.userId, username: 'existinguser' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { username: 'newuser' },
    });
    const res = await createProfilePOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(409);
    expect(body.error).toMatch(/profile already exists/i);
  });

  it('successfully creates a new profile', async () => {
    mockSession(mockGetSession, TEST_USER);

    const newUserId = '770e8400-e29b-41d4-a716-446655440000';
    const client = buildSequentialClient([
      // no existing user by email
      { data: null, error: { code: 'PGRST116', message: 'no rows' } },
      // no existing user by username
      { data: null, error: { code: 'PGRST116', message: 'no rows' } },
      // insert returns the new user
      {
        data: {
          id: newUserId,
          username: 'brandnewuser',
          display_name: 'Brand New',
          bio: null,
          avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=brandnewuser',
          level: 1,
        },
      },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { username: 'brandnewuser', display_name: 'Brand New' },
    });
    const res = await createProfilePOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.user.username).toBe('brandnewuser');
    expect(body.user.level).toBe(1);
  });
});

// ===========================================================================
// POST /api/user/follow
// ===========================================================================

describe('POST /api/user/follow', () => {
  const url = '/api/user/follow';
  const TARGET_USER_ID = '880e8400-e29b-41d4-a716-446655440000';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(url, { method: 'POST', body: { userId: TARGET_USER_ID } });
    const res = await followPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication required/i);
  });

  it('returns 400 when userId is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest(url, { method: 'POST', body: {} });
    const res = await followPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/userId is required/i);
  });

  it('returns 400 when userId is not a valid UUID', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest(url, { method: 'POST', body: { userId: 'not-a-uuid' } });
    const res = await followPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/invalid userId format/i);
  });

  it('returns 400 when trying to follow yourself', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      // current user lookup
      { data: { id: TEST_USER.userId, username: 'testuser' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { method: 'POST', body: { userId: TEST_USER.userId } });
    const res = await followPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/cannot follow yourself/i);
  });

  it('returns 404 when target user does not exist', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      // current user lookup
      { data: { id: TEST_USER.userId, username: 'testuser' } },
      // target user lookup - not found
      { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { method: 'POST', body: { userId: TARGET_USER_ID } });
    const res = await followPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toMatch(/target user not found/i);
  });

  it('successfully follows a user', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      // current user
      { data: { id: TEST_USER.userId, username: 'testuser' } },
      // target user
      { data: { id: TARGET_USER_ID, username: 'targetuser' } },
      // upsert into followers
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { method: 'POST', body: { userId: TARGET_USER_ID } });
    const res = await followPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.isFollowing).toBe(true);
    expect(body.message).toMatch(/following @targetuser/i);
  });
});

// ===========================================================================
// DELETE /api/user/follow
// ===========================================================================

describe('DELETE /api/user/follow', () => {
  const TARGET_USER_ID = '880e8400-e29b-41d4-a716-446655440000';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/user/follow', {
      method: 'DELETE',
      searchParams: { userId: TARGET_USER_ID },
    });
    const res = await followDELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication required/i);
  });

  it('returns 400 when userId query param is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest('/api/user/follow', { method: 'DELETE' });
    const res = await followDELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/userId.*required/i);
  });

  it('successfully unfollows a user', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      // current user
      { data: { id: TEST_USER.userId } },
      // delete from followers
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest('/api/user/follow', {
      method: 'DELETE',
      searchParams: { userId: TARGET_USER_ID },
    });
    const res = await followDELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.isFollowing).toBe(false);
  });
});

// ===========================================================================
// GET/POST/DELETE /api/user/block
// ===========================================================================

describe('GET /api/user/block', () => {
  const url = '/api/user/block';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(url);
    const res = await blockGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication required/i);
  });

  it('returns blocked users list', async () => {
    mockGetSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: TEST_USER.userId },
    });

    const blockedList = [
      { id: 'block-1', blocked_id: 'user-x', created_at: '2026-01-15', blocked: { id: 'user-x', username: 'blockedguy', avatar_url: null } },
    ];
    const client = buildSequentialClient([{ data: blockedList }]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url);
    const res = await blockGET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0].blocked_id).toBe('user-x');
  });
});

describe('POST /api/user/block', () => {
  const url = '/api/user/block';
  const TARGET_ID = '990e8400-e29b-41d4-a716-446655440000';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(url, { method: 'POST', body: { userId: TARGET_ID } });
    const res = await blockPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication required/i);
  });

  it('returns 400 when trying to block yourself', async () => {
    mockGetSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: TEST_USER.userId },
    });

    const req = createMockRequest(url, { method: 'POST', body: { userId: TEST_USER.userId } });
    const res = await blockPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/cannot block yourself/i);
  });

  it('returns 404 when target user does not exist', async () => {
    mockGetSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: TEST_USER.userId },
    });

    const client = buildSequentialClient([
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { method: 'POST', body: { userId: TARGET_ID } });
    const res = await blockPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toMatch(/user not found/i);
  });

  it('successfully blocks a user', async () => {
    mockGetSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: TEST_USER.userId },
    });

    const client = buildSequentialClient([
      // target user lookup
      { data: { id: TARGET_ID, username: 'baduser' } },
      // insert block
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, { method: 'POST', body: { userId: TARGET_ID } });
    const res = await blockPOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/blocked baduser/i);
  });
});

describe('DELETE /api/user/block', () => {
  const TARGET_ID = '990e8400-e29b-41d4-a716-446655440000';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/user/block', {
      method: 'DELETE',
      searchParams: { userId: TARGET_ID },
    });
    const res = await blockDELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication required/i);
  });

  it('returns 400 when userId is missing', async () => {
    mockGetSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: TEST_USER.userId },
    });

    const req = createMockRequest('/api/user/block', { method: 'DELETE' });
    const res = await blockDELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/userId is required/i);
  });

  it('successfully unblocks a user', async () => {
    mockGetSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: TEST_USER.userId },
    });

    const client = buildSequentialClient([
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest('/api/user/block', {
      method: 'DELETE',
      searchParams: { userId: TARGET_ID },
    });
    const res = await blockDELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ===========================================================================
// POST /api/account/delete
// ===========================================================================

describe('POST /api/account/delete', () => {
  const url = '/api/account/delete';

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { confirmation: 'DELETE MY ACCOUNT' },
    });
    const res = await accountDeletePOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication required/i);
  });

  it('returns 400 when confirmation text is wrong', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { confirmation: 'delete my account' },
    });
    const res = await accountDeletePOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/DELETE MY ACCOUNT/);
  });

  it('returns 404 when user profile not found', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = buildSequentialClient([
      // users lookup - not found
      { data: null, error: { code: 'PGRST116', message: 'no rows' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { confirmation: 'DELETE MY ACCOUNT' },
    });
    const res = await accountDeletePOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toMatch(/profile not found/i);
  });

  it('successfully deletes account and all associated data', async () => {
    mockSession(mockGetSession, TEST_USER);
    const userId = TEST_USER.userId;

    const client = buildSequentialClient([
      // 1: users lookup for profile.id
      { data: { id: userId } },
      // 2: delete comments
      { data: [{ id: 'c1' }] },
      // 3: delete comment_likes
      { data: [] },
      // 4: delete votes
      { data: [{ id: 'v1' }, { id: 'v2' }] },
      // 5: get clips for video cleanup
      { data: [{ id: 'clip-1', video_url: 'https://example.com/v.mp4' }] },
      // 6: update story_slots (clear winner)
      { data: null, error: null },
      // 7: delete tournament_clips
      { data: [{ id: 'clip-1' }] },
      // 8: delete clip_views by clip_id
      { data: null, error: null },
      // 9: delete clip_views by voter_key
      { data: null, error: null },
      // 10: delete notifications
      { data: [] },
      // 11: delete push_subscriptions
      { data: null, error: null },
      // 12: delete referrals
      { data: null, error: null },
      // 13: delete user record
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { confirmation: 'DELETE MY ACCOUNT' },
    });
    const res = await accountDeletePOST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/permanently deleted/i);
  });
});
