/**
 * @jest-environment node
 */
/**
 * leaderboard-notifications.test.ts
 * Unit tests for leaderboard and notification API routes:
 *   GET  /api/leaderboard            — main leaderboard with clips, season, pagination
 *   GET  /api/leaderboard/clips      — top clips by vote count
 *   GET  /api/leaderboard/creators   — top creators by total votes
 *   GET  /api/leaderboard/voters     — top voters by vote count
 *   GET  /api/leaderboard/live       — real-time combined dashboard data
 *   GET  /api/notifications          — fetch user notifications
 *   PATCH /api/notifications         — mark notifications as read
 *   DELETE /api/notifications        — delete notifications
 *   POST /api/notifications/subscribe   — save push subscription
 *   POST /api/notifications/unsubscribe — remove push subscription
 */

// ---------------------------------------------------------------------------
// Mocks — BEFORE any imports
// ---------------------------------------------------------------------------

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: jest.fn().mockReturnValue(null) }));
jest.mock('@/lib/admin-auth', () => ({ requireAdmin: jest.fn() }));
jest.mock('@/lib/leaderboard-redis', () => ({
  getTopClips: jest.fn().mockResolvedValue(null),
  getTopCreators: jest.fn().mockResolvedValue(null),
  getTopVoters: jest.fn().mockResolvedValue(null),
  getVoterRank: jest.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { requireAdmin } from '@/lib/admin-auth';
import {
  createSupabaseChain,
  createSequentialMock,
  createMockRequest,
  parseResponse,
  mockSession,
  TEST_USER,
} from '../helpers/api-test-utils';

import { GET as leaderboardGet } from '@/app/api/leaderboard/route';
import { GET as clipsGet } from '@/app/api/leaderboard/clips/route';
import { GET as creatorsGet } from '@/app/api/leaderboard/creators/route';
import { GET as votersGet } from '@/app/api/leaderboard/voters/route';
import { GET as liveGet } from '@/app/api/leaderboard/live/route';
import { GET as notificationsGet, PATCH as notificationsPatch, DELETE as notificationsDelete } from '@/app/api/notifications/route';
import { POST as subscribePost } from '@/app/api/notifications/subscribe/route';
import { POST as unsubscribePost } from '@/app/api/notifications/unsubscribe/route';

// ---------------------------------------------------------------------------
// Shared references
// ---------------------------------------------------------------------------

const mockCreateClient = createClient as jest.Mock;
const mockGetServerSession = getServerSession as jest.Mock;
const mockRequireAdmin = requireAdmin as jest.Mock;

// Counter to generate unique season IDs per test, preventing in-memory cache
// collisions across tests (the route modules cache by season_id in their keys).
let testCounter = 0;
function uniqueSeasonId() {
  return `season-test-${++testCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: requireAdmin blocks (non-admin). Routes that need it will override.
  const { NextResponse } = require('next/server');
  mockRequireAdmin.mockResolvedValue(
    NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  );
});

// ===========================================================================
// HELPERS
// ===========================================================================

/**
 * Build a sequential mock for the main /api/leaderboard route.
 *
 * Without genre param and with redis disabled, the .from() call sequence is:
 *   1. seasons (active season lookup, returns array via .limit(1))
 *   2. feature_flags (redis_leaderboards)
 *   3. story_slots (active slot)
 *   4. tournament_clips (count — head:true)
 *   5. tournament_clips (paginated clips)
 *   6. tournament_clips (total votes for percentage calc)
 */
function buildLeaderboardMainMock(opts: {
  season?: unknown;
  redisFlag?: unknown;
  activeSlot?: unknown;
  clipsCount?: number | null;
  clips?: unknown[];
  clipsError?: unknown;
  totalVotes?: unknown[];
}) {
  const seq = createSequentialMock([
    { data: opts.season !== undefined ? [opts.season] : [], error: null },
    { data: opts.redisFlag ?? null, error: null },
    { data: opts.activeSlot ?? null, error: null },
    { data: null, error: null, count: opts.clipsCount ?? 0 },
    { data: opts.clips ?? [], error: opts.clipsError ?? null },
    { data: opts.totalVotes ?? [], error: null },
  ]);
  mockCreateClient.mockReturnValue({ from: seq.from });
  return seq;
}

/**
 * Build a sequential mock for /api/leaderboard/clips route (DB fallback path).
 *
 * Without genre param and with redis disabled, the .from() call sequence is:
 *   1. feature_flags (redis_leaderboards)
 *   2. seasons (fallback season lookup)
 *   3. tournament_clips (paginated with count)
 */
function buildClipsMock(opts: {
  redisFlag?: unknown;
  fallbackSeason?: unknown;
  clips?: unknown[];
  clipsCount?: number | null;
  clipsError?: unknown;
}) {
  const seasonId = (opts.fallbackSeason as any)?.id ?? uniqueSeasonId();
  const fallbackSeason = opts.fallbackSeason ?? { id: seasonId };

  const seq = createSequentialMock([
    { data: opts.redisFlag ?? null, error: null },
    { data: fallbackSeason, error: null },
    { data: opts.clips ?? [], error: opts.clipsError ?? null, count: opts.clipsCount ?? 0 },
  ]);
  mockCreateClient.mockReturnValue({ from: seq.from });
  return seq;
}

/**
 * Build mocks for /api/leaderboard/creators route (DB fallback via RPC path).
 *
 * Without genre param and with redis disabled, the calls are:
 *   1. feature_flags (from)
 *   2. seasons (from)
 *   3. get_top_creators (rpc)
 *   4. tournament_clips count (from) — only when RPC succeeds
 */
function buildCreatorsMock(opts: {
  redisFlag?: unknown;
  season?: unknown;
  rpcData?: unknown[] | null;
  rpcError?: unknown;
  totalCount?: number | null;
}) {
  const seasonId = (opts.season as any)?.id ?? uniqueSeasonId();
  const season = opts.season ?? { id: seasonId };

  const seq = createSequentialMock([
    { data: opts.redisFlag ?? null, error: null },
    { data: season, error: null },
  ]);
  const rpcMock = jest.fn().mockResolvedValue({
    data: opts.rpcData ?? [],
    error: opts.rpcError ?? null,
  });
  // Additional from() calls after RPC (e.g. total count)
  const countChain = createSupabaseChain({ data: null, error: null, count: opts.totalCount ?? 0 });

  let fromCallIndex = 0;
  const fromMock = jest.fn(() => {
    if (fromCallIndex < seq.chains.length) {
      const chain = seq.chains[fromCallIndex];
      fromCallIndex++;
      return chain;
    }
    return countChain;
  });

  mockCreateClient.mockReturnValue({ from: fromMock, rpc: rpcMock });
  return { fromMock, rpcMock };
}

// ===========================================================================
// GET /api/leaderboard
// ===========================================================================

describe('GET /api/leaderboard', () => {
  const url = '/api/leaderboard';

  test('returns empty clips when no active season exists', async () => {
    buildLeaderboardMainMock({ season: undefined });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await leaderboardGet(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clips).toEqual([]);
    expect(body.season).toBeNull();
    expect(body.message).toBe('No active season');
  });

  test('returns ranked clips with pagination for active season', async () => {
    const sid = uniqueSeasonId();
    const season = { id: sid, label: 'Season 1', status: 'active', total_slots: 10 };
    const clips = [
      { id: 'clip-1', video_url: 'v1.mp4', thumbnail_url: 't1.jpg', username: 'alice', avatar_url: 'a1.jpg', vote_count: 50, genre: 'comedy', title: 'Funny', slot_position: 1 },
      { id: 'clip-2', video_url: 'v2.mp4', thumbnail_url: 't2.jpg', username: 'bob', avatar_url: 'a2.jpg', vote_count: 30, genre: 'comedy', title: 'LOL', slot_position: 1 },
    ];
    const totalVotes = [{ vote_count: 50 }, { vote_count: 30 }];

    buildLeaderboardMainMock({
      season,
      redisFlag: null,
      activeSlot: null,
      clipsCount: 2,
      clips,
      totalVotes,
    });

    const req = createMockRequest(url, { searchParams: { limit: '10', offset: '0' } });
    const { status, body } = await parseResponse(await leaderboardGet(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clips).toHaveLength(2);
    expect(body.clips[0].rank).toBe(1);
    expect(body.clips[0].id).toBe('clip-1');
    expect(body.clips[1].rank).toBe(2);
    expect(body.season.id).toBe(sid);
    expect(body.totalVotes).toBe(80);
    expect(body.pagination.limit).toBe(10);
    expect(body.pagination.offset).toBe(0);
    expect(body.pagination.hasMore).toBe(false);
  });

  test('respects pagination limit and offset parameters', async () => {
    const sid = uniqueSeasonId();
    const season = { id: sid, label: 'S1', status: 'active', total_slots: 5 };
    const clips = [
      { id: 'clip-3', video_url: 'v3.mp4', thumbnail_url: 't3.jpg', username: 'carol', avatar_url: '', vote_count: 10, genre: 'drama', title: 'Deep', slot_position: 2 },
    ];

    buildLeaderboardMainMock({
      season,
      clipsCount: 25,
      clips,
      totalVotes: [{ vote_count: 10 }],
    });

    const req = createMockRequest(url, { searchParams: { limit: '5', offset: '20' } });
    const { status, body } = await parseResponse(await leaderboardGet(req));

    expect(status).toBe(200);
    expect(body.clips[0].rank).toBe(21);
    expect(body.pagination.limit).toBe(5);
    expect(body.pagination.offset).toBe(20);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.total).toBe(25);
  });

  test('clamps limit to MAX_LIMIT (100)', async () => {
    const sid = uniqueSeasonId();
    const season = { id: sid, label: 'S', status: 'active', total_slots: 5 };

    buildLeaderboardMainMock({ season, clips: [], totalVotes: [] });

    const req = createMockRequest(url, { searchParams: { limit: '500' } });
    const { status, body } = await parseResponse(await leaderboardGet(req));

    expect(status).toBe(200);
    expect(body.pagination.limit).toBe(100);
  });

  test('returns 500 when clips query fails', async () => {
    const sid = uniqueSeasonId();
    const season = { id: sid, label: 'S', status: 'active', total_slots: 5 };

    buildLeaderboardMainMock({
      season,
      clipsError: { message: 'DB unavailable', code: 'ECONNREFUSED' },
    });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await leaderboardGet(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch clips');
  });
});

// ===========================================================================
// GET /api/leaderboard/clips
// ===========================================================================

describe('GET /api/leaderboard/clips', () => {
  const url = '/api/leaderboard/clips';

  test('returns enriched clips with rank and pagination info', async () => {
    const clips = [
      {
        id: 'c1', thumbnail_url: 'thumb1.jpg', video_url: 'vid1.mp4',
        username: 'alice', avatar_url: 'av1.jpg', genre: 'comedy',
        slot_position: 1, vote_count: 100, weighted_score: 120,
        hype_score: 5, created_at: '2026-01-01T00:00:00Z',
      },
    ];

    buildClipsMock({ clips, clipsCount: 1 });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await clipsGet(req));

    expect(status).toBe(200);
    expect(body.clips).toHaveLength(1);
    expect(body.clips[0].rank).toBe(1);
    expect(body.clips[0].id).toBe('c1');
    expect(body.clips[0].vote_count).toBe(100);
    expect(body.clips[0].status).toBe('competing');
    expect(body.timeframe).toBe('all');
    expect(body.total_clips).toBe(1);
    expect(body.has_more).toBe(false);
  });

  test('returns empty clips array when no clips exist', async () => {
    buildClipsMock({ clips: [], clipsCount: 0 });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await clipsGet(req));

    expect(status).toBe(200);
    expect(body.clips).toEqual([]);
    expect(body.total_clips).toBe(0);
  });

  test('returns 500 on database error', async () => {
    buildClipsMock({ clipsError: { message: 'timeout' } });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await clipsGet(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch leaderboard clips');
  });

  test('sanitizes video file thumbnail URLs with placeholder', async () => {
    const clips = [
      {
        id: 'c2', thumbnail_url: 'video.mp4', video_url: 'vid.mp4',
        username: 'bob', avatar_url: '', genre: 'drama',
        slot_position: 1, vote_count: 50, weighted_score: 60,
        hype_score: 0, created_at: '2026-01-01T00:00:00Z',
      },
    ];

    buildClipsMock({ clips, clipsCount: 1 });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await clipsGet(req));

    expect(status).toBe(200);
    expect(body.clips[0].thumbnail_url).toContain('dicebear.com');
    expect(body.clips[0].thumbnail_url).not.toBe('video.mp4');
  });
});

// ===========================================================================
// GET /api/leaderboard/creators
// ===========================================================================

describe('GET /api/leaderboard/creators', () => {
  const url = '/api/leaderboard/creators';

  test('returns creators from RPC with ranking data', async () => {
    const rpcCreators = [
      {
        username: 'topCreator', avatar_url: 'avatar.jpg',
        total_clips: 5, total_votes: 200, locked_clips: 2,
        best_clip_id: 'bc1', best_clip_votes: 80,
      },
    ];

    buildCreatorsMock({ rpcData: rpcCreators, totalCount: 1 });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await creatorsGet(req));

    expect(status).toBe(200);
    expect(body.creators).toHaveLength(1);
    expect(body.creators[0].rank).toBe(1);
    expect(body.creators[0].username).toBe('topCreator');
    expect(body.creators[0].total_votes).toBe(200);
    expect(body.creators[0].total_clips).toBe(5);
    expect(body.creators[0].avg_votes_per_clip).toBe(40);
    expect(body.timeframe).toBe('all');
  });

  test('returns empty creators when RPC returns no data', async () => {
    buildCreatorsMock({ rpcData: [], totalCount: 0 });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await creatorsGet(req));

    expect(status).toBe(200);
    expect(body.creators).toEqual([]);
    expect(body.total_creators).toBe(0);
  });

  test('handles pagination parameters correctly', async () => {
    const rpcCreators = [
      { username: 'c1', avatar_url: '', total_clips: 1, total_votes: 50, locked_clips: 0, best_clip_id: 'x1', best_clip_votes: 50 },
    ];

    buildCreatorsMock({ rpcData: rpcCreators, totalCount: 25 });

    const req = createMockRequest(url, { searchParams: { page: '3', limit: '10' } });
    const { status, body } = await parseResponse(await creatorsGet(req));

    expect(status).toBe(200);
    expect(body.page).toBe(3);
    expect(body.page_size).toBe(10);
    // rank should reflect offset: (3-1)*10 + 1 = 21
    expect(body.creators[0].rank).toBe(21);
  });
});

// ===========================================================================
// GET /api/leaderboard/voters
// ===========================================================================

describe('GET /api/leaderboard/voters', () => {
  const url = '/api/leaderboard/voters';

  test('returns voter rankings from RPC with level calculation', async () => {
    const rpcVoters = [
      { voter_key: 'user_abc123', weighted_total: 400, total_votes: 400, votes_today: 10 },
    ];

    const seq = createSequentialMock([
      { data: null, error: null },  // feature_flags
    ]);

    const rpcMock = jest.fn();
    // 1st rpc call: get_top_voters
    rpcMock.mockResolvedValueOnce({ data: rpcVoters, error: null });
    // 2nd rpc call: get_voters_count
    rpcMock.mockResolvedValueOnce({ data: 50, error: null });
    // 3rd rpc call: get_voter_rank
    rpcMock.mockResolvedValueOnce({ data: 1, error: null });

    let fromCallIndex = 0;
    const userChain = createSupabaseChain({
      data: [{ id: 'abc123', username: 'VoterKing', avatar_url: 'vk.jpg' }],
      error: null,
    });
    const fromMock = jest.fn(() => {
      if (fromCallIndex < seq.chains.length) {
        const chain = seq.chains[fromCallIndex];
        fromCallIndex++;
        return chain;
      }
      return userChain;
    });

    mockCreateClient.mockReturnValue({ from: fromMock, rpc: rpcMock });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await votersGet(req));

    expect(status).toBe(200);
    expect(body.voters).toHaveLength(1);
    expect(body.voters[0].rank).toBe(1);
    expect(body.voters[0].username).toBe('VoterKing');
    expect(body.voters[0].total_votes).toBe(400);
    // level = floor(sqrt(400/100)) + 1 = floor(2) + 1 = 3
    expect(body.voters[0].level).toBe(3);
    expect(body.total_voters).toBe(50);
    expect(body.current_user_rank).toBe(1);
  });

  test('returns empty voters when no votes exist', async () => {
    const seq = createSequentialMock([
      { data: null, error: null }, // feature_flags
    ]);

    const rpcMock = jest.fn();
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    rpcMock.mockResolvedValueOnce({ data: 0, error: null });
    rpcMock.mockResolvedValueOnce({ data: null, error: null });

    let fromCallIndex = 0;
    const fromMock = jest.fn(() => {
      const chain = seq.chains[Math.min(fromCallIndex, seq.chains.length - 1)];
      fromCallIndex++;
      return chain;
    });

    mockCreateClient.mockReturnValue({ from: fromMock, rpc: rpcMock });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await votersGet(req));

    expect(status).toBe(200);
    expect(body.voters).toEqual([]);
    expect(body.total_voters).toBe(0);
  });
});

// ===========================================================================
// GET /api/leaderboard/live
// ===========================================================================

describe('GET /api/leaderboard/live', () => {
  const url = '/api/leaderboard/live';

  test('returns combined live leaderboard data from DB fallback', async () => {
    // Without genre param and with redis disabled, the .from() sequence is:
    // 1. feature_flags
    // 2. seasons (fallback)
    // 3. tournament_clips (top clips — limit 10)
    // 4. tournament_clips (all clips for creator aggregation — limit 500)
    // 5. story_slots (locked)
    // 6. mv_user_vote_counts (top voters)
    // 7. tournament_clips (trending)
    // 8. votes (today count)
    // 9. mv_user_vote_counts (active voters count)

    const topClips = [
      { id: 'tc1', thumbnail_url: 'th1.jpg', username: 'alice', vote_count: 100, slot_position: 1 },
    ];
    const allClips = [
      { user_id: 'u1', username: 'alice', avatar_url: 'a.jpg', vote_count: 100, id: 'tc1' },
    ];
    const lockedSlots: unknown[] = [];
    const topVoters = [
      { voter_key: 'user_v1', vote_count: 300 },
    ];
    const trending = [
      { id: 'tc1', thumbnail_url: 'th1.jpg', username: 'alice', vote_count: 100, hype_score: 50 },
    ];

    const seq = createSequentialMock([
      { data: null, error: null },                    // 1. feature_flags
      { data: { id: 'season-live-1' }, error: null }, // 2. seasons (fallback)
      { data: topClips, error: null },                 // 3. tournament_clips (top)
      { data: allClips, error: null },                 // 4. tournament_clips (all creators)
      { data: lockedSlots, error: null },              // 5. story_slots (locked)
      { data: topVoters, error: null },                // 6. mv_user_vote_counts (top voters)
      { data: trending, error: null },                 // 7. tournament_clips (trending)
      { data: null, error: null, count: 500 },         // 8. votes (today count)
      { data: null, error: null, count: 200 },         // 9. mv_user_vote_counts (active voters count)
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await liveGet(req));

    expect(status).toBe(200);
    expect(body.top_clips).toHaveLength(1);
    expect(body.top_clips[0].rank).toBe(1);
    expect(body.top_clips[0].username).toBe('alice');
    expect(body.top_creators).toHaveLength(1);
    expect(body.top_creators[0].rank).toBe(1);
    expect(body.top_voters).toHaveLength(1);
    expect(body.trending_now).toHaveLength(1);
    expect(body.trending_now[0].momentum).toBe(50);
    expect(body.stats.total_clips).toBe(1);
    expect(body.stats.total_votes).toBe(500);
    expect(body.stats.active_voters).toBe(200);
    expect(body.stats.last_updated).toBeDefined();
  });

  test('returns 500 on unexpected error', async () => {
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => { throw new Error('Connection lost'); }),
    });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await liveGet(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });
});

// ===========================================================================
// GET /api/notifications
// ===========================================================================

describe('GET /api/notifications', () => {
  const url = '/api/notifications';

  test('returns notifications for an authenticated user', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const notifications = [
      { id: 'n1', type: 'clip_approved', title: 'Clip Approved', message: 'Your clip was approved', action_url: '/clip/1', metadata: {}, is_read: false, created_at: '2026-01-15T12:00:00Z', read_at: null },
      { id: 'n2', type: 'achievement_unlocked', title: 'Achievement!', message: 'You unlocked Gold', action_url: null, metadata: {}, is_read: true, created_at: '2026-01-14T10:00:00Z', read_at: '2026-01-14T11:00:00Z' },
    ];

    const seq = createSequentialMock([
      { data: notifications, error: null, count: 2 },
      { data: null, error: null, count: 1 },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await notificationsGet(req));

    expect(status).toBe(200);
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0].id).toBe('n1');
    expect(body.unread_count).toBe(1);
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(20);
    expect(body.has_more).toBe(false);
  });

  test('supports unread filter', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const unreadNotifications = [
      { id: 'n1', type: 'comment_received', title: 'New Comment', message: 'Someone commented', action_url: null, metadata: {}, is_read: false, created_at: '2026-01-15T12:00:00Z', read_at: null },
    ];

    const seq = createSequentialMock([
      { data: unreadNotifications, error: null, count: 1 },
      { data: null, error: null, count: 1 },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url, { searchParams: { filter: 'unread' } });
    const { status, body } = await parseResponse(await notificationsGet(req));

    expect(status).toBe(200);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].is_read).toBe(false);
  });

  test('returns 500 on database error', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const seq = createSequentialMock([
      { data: null, error: { message: 'table not found' } },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await notificationsGet(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch notifications');
  });
});

// ===========================================================================
// PATCH /api/notifications (mark as read)
// ===========================================================================

describe('PATCH /api/notifications', () => {
  const url = '/api/notifications';

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, {
      method: 'PATCH',
      body: { mark_all_read: true },
    });
    const { status, body } = await parseResponse(await notificationsPatch(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('marks specific notifications as read', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const updatedNotifications = [
      { id: 'n1', is_read: true, read_at: '2026-02-01T10:00:00Z' },
    ];

    const chain = createSupabaseChain({ data: updatedNotifications, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url, {
      method: 'PATCH',
      body: { notification_ids: ['n1'] },
    });
    const { status, body } = await parseResponse(await notificationsPatch(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.updated_count).toBe(1);
  });

  test('marks all notifications as read', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const updatedNotifications = [
      { id: 'n1', is_read: true },
      { id: 'n2', is_read: true },
      { id: 'n3', is_read: true },
    ];

    const chain = createSupabaseChain({ data: updatedNotifications, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url, {
      method: 'PATCH',
      body: { mark_all_read: true },
    });
    const { status, body } = await parseResponse(await notificationsPatch(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.updated_count).toBe(3);
  });

  test('returns 400 when neither notification_ids nor mark_all_read provided', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const req = createMockRequest(url, {
      method: 'PATCH',
      body: {},
    });
    const { status, body } = await parseResponse(await notificationsPatch(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Either notification_ids or mark_all_read must be provided');
  });
});

// ===========================================================================
// DELETE /api/notifications
// ===========================================================================

describe('DELETE /api/notifications', () => {
  const url = '/api/notifications';

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, {
      method: 'DELETE',
      body: { notification_ids: ['n1'] },
    });
    const { status, body } = await parseResponse(await notificationsDelete(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('deletes specified notifications', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url, {
      method: 'DELETE',
      body: { notification_ids: ['n1', 'n2'] },
    });
    const { status, body } = await parseResponse(await notificationsDelete(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('2 notification(s) deleted');
  });

  test('returns 400 when notification_ids is missing', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const req = createMockRequest(url, {
      method: 'DELETE',
      body: {},
    });
    const { status, body } = await parseResponse(await notificationsDelete(req));

    expect(status).toBe(400);
    expect(body.error).toBe('notification_ids array is required');
  });

  test('returns 400 when deleting more than 500 notifications', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const ids = Array.from({ length: 501 }, (_, i) => `n${i}`);

    const req = createMockRequest(url, {
      method: 'DELETE',
      body: { notification_ids: ids },
    });
    const { status, body } = await parseResponse(await notificationsDelete(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Maximum 500 notifications per delete');
  });
});

// ===========================================================================
// POST /api/notifications/subscribe
// ===========================================================================

describe('POST /api/notifications/subscribe', () => {
  const url = '/api/notifications/subscribe';

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, {
      method: 'POST',
      body: {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
          keys: { p256dh: 'key1', auth: 'key2' },
        },
      },
    });
    const { status, body } = await parseResponse(await subscribePost(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('saves push subscription for authenticated user', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },  // users lookup
      { data: { id: 'sub-hash' }, error: null },         // push_subscriptions upsert
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url, {
      method: 'POST',
      body: {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
          keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
        },
      },
    });
    const { status, body } = await parseResponse(await subscribePost(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.subscription_id).toBeDefined();
  });

  test('returns 400 for missing subscription data', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url, {
      method: 'POST',
      body: {},
    });
    const { status, body } = await parseResponse(await subscribePost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid subscription data');
  });

  test('returns 400 for invalid endpoint domain', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url, {
      method: 'POST',
      body: {
        subscription: {
          endpoint: 'https://evil.example.com/push',
          keys: { p256dh: 'k1', auth: 'k2' },
        },
      },
    });
    const { status, body } = await parseResponse(await subscribePost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid push subscription endpoint');
  });

  test('returns success even when table does not exist yet (42P01)', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: null, error: { code: '42P01', message: 'relation does not exist' } },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url, {
      method: 'POST',
      body: {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
          keys: { p256dh: 'k1', auth: 'k2' },
        },
      },
    });
    const { status, body } = await parseResponse(await subscribePost(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain('pending table setup');
  });
});

// ===========================================================================
// POST /api/notifications/unsubscribe
// ===========================================================================

describe('POST /api/notifications/unsubscribe', () => {
  const url = '/api/notifications/unsubscribe';

  test('removes push subscription successfully', async () => {
    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url, {
      method: 'POST',
      body: {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        },
      },
    });
    const { status, body } = await parseResponse(await unsubscribePost(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Subscription removed successfully');
  });

  test('returns 400 for missing subscription data', async () => {
    const req = createMockRequest(url, {
      method: 'POST',
      body: {},
    });
    const { status, body } = await parseResponse(await unsubscribePost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid subscription data');
  });

  test('returns success even when table does not exist (42P01)', async () => {
    const chain = createSupabaseChain({
      data: null,
      error: { code: '42P01', message: 'relation does not exist' },
    });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url, {
      method: 'POST',
      body: {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        },
      },
    });
    const { status, body } = await parseResponse(await unsubscribePost(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Subscription removed');
  });

  test('returns 500 on database error', async () => {
    const chain = createSupabaseChain({
      data: null,
      error: { code: 'ECONNREFUSED', message: 'connection refused' },
    });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url, {
      method: 'POST',
      body: {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        },
      },
    });
    const { status, body } = await parseResponse(await unsubscribePost(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to remove subscription');
  });
});
