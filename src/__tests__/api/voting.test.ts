/**
 * @jest-environment node
 */

/**
 * Voting API Route Tests
 * Comprehensive unit tests for GET, POST, DELETE /api/vote
 *
 * Tests cover: rate limiting, CSRF, auth, validation, self-vote prevention,
 * daily limits, slot validation, voting period expiry, duplicate votes,
 * ban checks, vote revocation, and happy paths.
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
  requireCsrf: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/device-fingerprint', () => ({
  generateDeviceKey: jest.fn().mockReturnValue('test-device-key'),
  extractDeviceSignals: jest.fn().mockReturnValue({}),
  assessDeviceRisk: jest.fn().mockReturnValue({ score: 0, reasons: [] }),
  shouldFlagVote: jest.fn().mockReturnValue(false),
}));
jest.mock('@/lib/validations', () => ({
  parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
  VoteRequestSchema: {},
}));
jest.mock('@/lib/crdt-vote-counter', () => ({
  incrementVote: jest.fn().mockResolvedValue(undefined),
  decrementVote: jest.fn().mockResolvedValue(undefined),
  getCountAndScore: jest.fn().mockResolvedValue({ voteCount: 1, weightedScore: 1 }),
}));
jest.mock('@/lib/vote-validation-redis', () => ({
  validateVoteRedis: jest.fn().mockResolvedValue({ valid: true, dailyCount: 0 }),
  recordVote: jest.fn().mockResolvedValue(true),
  removeVoteRecord: jest.fn().mockResolvedValue(undefined),
  isVotingFrozen: jest.fn().mockResolvedValue(false),
  seedDailyVoteCount: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/circuit-breaker', () => ({
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn((fn: () => unknown) => fn()),
  })),
}));
jest.mock('@/lib/realtime-broadcast', () => ({
  broadcastVoteUpdate: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/vote-count-cache', () => ({
  getCachedVoteCounts: jest.fn().mockResolvedValue(new Map()),
  setCachedVoteCounts: jest.fn().mockResolvedValue(undefined),
  updateCachedVoteCount: jest.fn(),
  invalidateVoteCount: jest.fn(),
}));
jest.mock('@/lib/leaderboard-redis', () => ({
  updateClipScore: jest.fn().mockResolvedValue(undefined),
  updateVoterScore: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/genres', () => ({
  isValidGenre: jest.fn().mockReturnValue(true),
}));
jest.mock('@/lib/captcha', () => ({
  verifyCaptcha: jest.fn().mockResolvedValue({ success: true }),
  getClientIp: jest.fn().mockReturnValue('127.0.0.1'),
}));
jest.mock('@/lib/logger', () => ({
  createRequestLogger: jest.fn().mockReturnValue({}),
  logAudit: jest.fn(),
}));
jest.mock('@/lib/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { requireCsrf } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validations';
import { isValidGenre } from '@/lib/genres';
import { GET, POST, DELETE } from '@/app/api/vote/route';
import {
  createMockRequest,
  parseResponse,
  mockSession,
  TEST_USER,
} from '@/__tests__/helpers/api-test-utils';

// Typed references to mocks
const mockCreateClient = createClient as jest.Mock;
const mockGetSession = getServerSession as jest.Mock;
const mockRequireCsrf = requireCsrf as jest.Mock;
const mockRateLimit = rateLimit as jest.Mock;
const mockParseBody = parseBody as jest.Mock;
const mockIsValidGenre = isValidGenre as jest.Mock;

// ---------------------------------------------------------------------------
// Helper: chainable Supabase mock
// ---------------------------------------------------------------------------

function createChainMock(
  resolveValue: { data?: unknown; error?: unknown; count?: number | null } = {}
) {
  const resolved = {
    data: resolveValue.data ?? null,
    error: resolveValue.error ?? null,
    count: resolveValue.count ?? null,
  };
  const chain: any = {};
  [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'lt', 'gt', 'gte', 'lte',
    'ilike', 'like', 'is', 'or', 'not',
    'order', 'limit', 'range',
  ].forEach(m => {
    chain[m] = jest.fn(() => chain);
  });
  chain.single = jest.fn(() => Promise.resolve(resolved));
  chain.maybeSingle = jest.fn(() => Promise.resolve(resolved));
  chain.then = jest.fn((resolve: any) => Promise.resolve(resolved).then(resolve));
  return chain;
}

// ---------------------------------------------------------------------------
// Table-aware Supabase mock builder
// ---------------------------------------------------------------------------

/**
 * Creates a mock Supabase client that responds based on table name.
 * Each table can have one or more sequential responses.
 * The `rpc` method dispatches by function name.
 *
 * Usage:
 *   const mock = createTableMock({
 *     feature_flags: [{ data: [] }],
 *     votes: [{ data: [], count: 0 }],
 *     seasons: [{ data: { id: 's1', status: 'active' } }],
 *   }, {
 *     insert_vote_atomic: { data: [{ vote_id: 'v1' }] },
 *   });
 */
function createTableMock(
  tables: Record<string, Array<{ data?: unknown; error?: unknown; count?: number | null }>>,
  rpcs: Record<string, { data?: unknown; error?: unknown }> = {}
) {
  const tableCallCounts: Record<string, number> = {};

  const from = jest.fn((tableName: string) => {
    if (!tableCallCounts[tableName]) tableCallCounts[tableName] = 0;
    const responses = tables[tableName] || [{ data: null }];
    const idx = Math.min(tableCallCounts[tableName], responses.length - 1);
    tableCallCounts[tableName]++;
    return createChainMock(responses[idx]);
  });

  const rpc = jest.fn((funcName: string) => {
    const response = rpcs[funcName] || { data: null };
    return createChainMock(response);
  });

  return { from, rpc, tableCallCounts };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// Use fake timers to expire the module-level featureFlagsCache (10-min TTL)
// between tests. This ensures each test gets fresh feature flag data.
beforeAll(() => {
  jest.useFakeTimers({ now: Date.now() });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.advanceTimersByTime(11 * 60 * 1000);
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  mockRequireCsrf.mockResolvedValue(null);
  mockRateLimit.mockResolvedValue(null);
  mockParseBody.mockImplementation((_schema: unknown, body: unknown) => ({
    success: true,
    data: body,
  }));
  mockIsValidGenre.mockReturnValue(true);
  mockGetSession.mockResolvedValue(null);
});

// ===========================================================================
// GET /api/vote
// ===========================================================================

describe('GET /api/vote', () => {
  // -----------------------------------------------------------------------
  // 1. Rate limiting
  // -----------------------------------------------------------------------
  it('returns rate limit response when rate limited', async () => {
    const rateLimitResp = new Response(
      JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    );
    mockRateLimit.mockResolvedValueOnce(rateLimitResp);

    const req = createMockRequest('/api/vote');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(429);
    expect(body.error).toBe('Too many requests');
  });

  // -----------------------------------------------------------------------
  // 2. No active season -> empty clips
  // -----------------------------------------------------------------------
  it('returns empty clips when no active season', async () => {
    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: [], count: 0 }],
      seasons: [{ data: null }, { data: null }], // active=null, finished=null
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.clips).toEqual([]);
    expect(body.seasonStatus).toBe('none');
  });

  // -----------------------------------------------------------------------
  // 3. No active slot -> empty clips
  // -----------------------------------------------------------------------
  it('returns empty clips when no active slot', async () => {
    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: [], count: 0 }],
      seasons: [{ data: { id: 's1', status: 'active', total_slots: 75 } }],
      story_slots: [{ data: null }, { data: null }], // voting=null, waiting_for_clips=null
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.clips).toEqual([]);
    expect(body.currentSlot).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 4. Happy path: clips for active voting slot
  // -----------------------------------------------------------------------
  it('returns clips for active voting slot (happy path)', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const clipData = [
      {
        id: 'clip-1',
        thumbnail_url: 'https://example.com/thumb1.jpg',
        video_url: 'https://example.com/vid1.mp4',
        username: 'creator1',
        avatar_url: null,
        genre: 'COMEDY',
        slot_position: 1,
        vote_count: 5,
        weighted_score: 5,
        hype_score: 5,
        created_at: new Date().toISOString(),
        view_count: 10,
      },
      {
        id: 'clip-2',
        thumbnail_url: 'https://example.com/thumb2.jpg',
        video_url: 'https://example.com/vid2.mp4',
        username: 'creator2',
        avatar_url: 'https://example.com/avatar.jpg',
        genre: 'COMEDY',
        slot_position: 1,
        vote_count: 3,
        weighted_score: 3,
        hype_score: 3,
        created_at: new Date().toISOString(),
        view_count: 5,
      },
    ];

    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }],
        votes: [{ data: [], count: 0 }, { data: [] }], // getUserVotesToday, getUserVotesInSlot
        seasons: [{ data: { id: 's1', status: 'active', total_slots: 75 } }],
        story_slots: [{ data: { id: 'slot1', season_id: 's1', slot_position: 1, status: 'voting', voting_ends_at: futureDate, voting_started_at: new Date().toISOString() } }],
        tournament_clips: [{ data: null, count: 2 }], // clip count query
        clip_views: [{ data: [] }],
        comments: [{ data: [] }],
      },
      {
        get_clips_randomized: { data: clipData },
        get_comment_counts: { data: [] },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.clips.length).toBe(2);
    expect(body.clips[0]).toHaveProperty('clip_id');
    expect(body.clips[0]).toHaveProperty('vote_count');
    expect(body.clips[0]).toHaveProperty('user');
    expect(body.currentSlot).toBe(1);
    expect(body.totalSlots).toBe(75);
    expect(body.votingEndsAt).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 5. Genre-filtered clips
  // -----------------------------------------------------------------------
  it('rejects genre param when multi_genre_enabled is false', async () => {
    // When multi_genre_enabled is false (default), genre param returns 400
    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', {
      searchParams: { genre: 'comedy' },
    });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.code).toBe('GENRE_NOT_SUPPORTED');
  });

  // -----------------------------------------------------------------------
  // 6. Invalid genre parameter
  // -----------------------------------------------------------------------
  it('rejects invalid genre parameter', async () => {
    mockIsValidGenre.mockReturnValueOnce(false);

    const mockSupa = createTableMock({});
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', {
      searchParams: { genre: 'INVALID_GENRE' },
    });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('Invalid genre');
  });

  // -----------------------------------------------------------------------
  // 7. Returns votedClipIds for authenticated user
  // -----------------------------------------------------------------------
  it('returns votedClipIds for authenticated user', async () => {
    mockSession(mockGetSession, TEST_USER);
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }],
        users: [{ data: { id: TEST_USER.userId } }],
        votes: [
          { data: [{ vote_weight: 1 }], count: 1 }, // getUserVotesToday
          { data: [{ clip_id: 'clip-voted-1', vote_weight: 1, vote_type: 'standard', created_at: new Date().toISOString(), slot_position: 1 }] }, // getUserVotesInSlot
        ],
        seasons: [{ data: { id: 's1', status: 'active', total_slots: 75 } }],
        story_slots: [{ data: { id: 'slot1', season_id: 's1', slot_position: 1, status: 'voting', voting_ends_at: futureDate, voting_started_at: new Date().toISOString() } }],
        tournament_clips: [{ data: null, count: 1 }],
      },
      {
        get_clips_randomized: { data: [] },
        get_comment_counts: { data: [] },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.votedClipIds).toContain('clip-voted-1');
  });

  // -----------------------------------------------------------------------
  // 8. Graceful degradation on DB error
  // -----------------------------------------------------------------------
  it('returns fallback response on DB error (graceful degradation)', async () => {
    // Return a chain that rejects to simulate DB failures
    const errorChain = createChainMock({ data: null });
    errorChain.then = jest.fn((_resolve: any, reject: any) => {
      return Promise.reject(new Error('DB connection failed')).catch(reject || (() => {}));
    });
    errorChain.maybeSingle = jest.fn(() => Promise.reject(new Error('DB connection failed')));
    errorChain.single = jest.fn(() => Promise.reject(new Error('DB connection failed')));

    const mockSupa = {
      from: jest.fn(() => errorChain),
      rpc: jest.fn(() => errorChain),
    };
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    // The catch block returns 500 with fallback data
    expect(status).toBe(500);
    expect(body.clips).toEqual([]);
    expect(body.votedClipIds).toEqual([]);
  });
});

// ===========================================================================
// POST /api/vote
// ===========================================================================

describe('POST /api/vote', () => {
  const validBody = { clipId: 'clip-abc-123' };

  // -----------------------------------------------------------------------
  // 1. Rate limiting
  // -----------------------------------------------------------------------
  it('returns rate limit response when rate limited', async () => {
    const rateLimitResp = new Response(
      JSON.stringify({ error: 'Rate limit exceeded' }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    );
    mockRateLimit.mockResolvedValueOnce(rateLimitResp);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(429);
    expect(body.error).toBe('Rate limit exceeded');
  });

  // -----------------------------------------------------------------------
  // 2. CSRF error
  // -----------------------------------------------------------------------
  it('returns CSRF error when CSRF check fails', async () => {
    const csrfResp = new Response(
      JSON.stringify({ error: 'CSRF token missing' }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    );
    mockRequireCsrf.mockResolvedValueOnce(csrfResp);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toContain('CSRF');
  });

  // -----------------------------------------------------------------------
  // 3. Invalid body
  // -----------------------------------------------------------------------
  it('returns 400 for invalid body', async () => {
    mockParseBody.mockReturnValueOnce({ success: false, error: 'clipId is required' });

    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: {} });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('clipId is required');
  });

  // -----------------------------------------------------------------------
  // 4. Clip not found
  // -----------------------------------------------------------------------
  it('returns 404 when clip not found', async () => {
    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: [], count: 0 }],
      tournament_clips: [{ data: null }], // not found
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Clip not found');
  });

  // -----------------------------------------------------------------------
  // 5. Self-voting prevention
  // -----------------------------------------------------------------------
  it('returns 403 for self-voting', async () => {
    mockSession(mockGetSession, TEST_USER);

    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      users: [{ data: { is_banned: false } }],
      votes: [{ data: [], count: 0 }],
      tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: TEST_USER.userId } }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.code).toBe('SELF_VOTE_NOT_ALLOWED');
  });

  // -----------------------------------------------------------------------
  // 6. Inactive clip status
  // -----------------------------------------------------------------------
  it('returns 400 for inactive clip status', async () => {
    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: [], count: 0 }],
      tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'eliminated', user_id: 'other-user' } }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.code).toBe('INVALID_CLIP_STATUS');
  });

  // -----------------------------------------------------------------------
  // 7. Daily vote limit reached
  // -----------------------------------------------------------------------
  it('returns 429 when daily limit reached', async () => {
    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: Array(200).fill({ vote_weight: 1 }), count: 200 }],
      tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(429);
    expect(body.code).toBe('DAILY_LIMIT');
  });

  // -----------------------------------------------------------------------
  // 8. No active voting slot
  // -----------------------------------------------------------------------
  it('returns 400 when no active voting slot', async () => {
    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: [], count: 0 }],
      tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
      story_slots: [{ data: null }], // no active slot
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.code).toBe('NO_ACTIVE_SLOT');
  });

  // -----------------------------------------------------------------------
  // 9. Clip in wrong slot
  // -----------------------------------------------------------------------
  it('returns 400 when clip is in wrong slot', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: [], count: 0 }],
      tournament_clips: [{ data: { slot_position: 3, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
      story_slots: [{ data: { slot_position: 1, status: 'voting', voting_ends_at: futureDate } }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.code).toBe('WRONG_SLOT');
  });

  // -----------------------------------------------------------------------
  // 10. Voting period expired
  // -----------------------------------------------------------------------
  it('returns 400 when voting period expired', async () => {
    const pastDate = new Date(Date.now() - 3600000).toISOString();

    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: [], count: 0 }],
      tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
      story_slots: [{ data: { slot_position: 1, status: 'voting', voting_ends_at: pastDate } }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.code).toBe('VOTING_EXPIRED');
  });

  // -----------------------------------------------------------------------
  // 11. Successful vote (happy path)
  // -----------------------------------------------------------------------
  it('returns 200 on successful vote (happy path)', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }],
        votes: [{ data: [], count: 0 }],
        tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
        story_slots: [{ data: { slot_position: 1, status: 'voting', voting_ends_at: futureDate } }],
      },
      {
        insert_vote_atomic: {
          data: [{
            vote_id: 'v1',
            was_new_vote: true,
            new_vote_count: 6,
            new_weighted_score: 6,
            final_vote_weight: 1,
          }],
        },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clipId).toBe('clip-abc-123');
    expect(body.newScore).toBe(6);
    expect(body.totalVotesToday).toBe(1);
    expect(body.remainingVotes.standard).toBe(199);
  });

  // -----------------------------------------------------------------------
  // 12. Duplicate vote (ALREADY_VOTED)
  // -----------------------------------------------------------------------
  it('returns 409 for duplicate vote', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }],
        votes: [{ data: [], count: 0 }],
        tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
        story_slots: [{ data: { slot_position: 1, status: 'voting', voting_ends_at: futureDate } }],
      },
      {
        insert_vote_atomic: { data: [{ error_code: 'ALREADY_VOTED' }] },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(409);
    expect(body.code).toBe('ALREADY_VOTED');
  });

  // -----------------------------------------------------------------------
  // 13. Auth required but not logged in
  // -----------------------------------------------------------------------
  it('returns 401 when auth required but not logged in', async () => {
    mockGetSession.mockResolvedValue(null);

    const mockSupa = createTableMock({
      feature_flags: [{ data: [{ key: 'require_auth_voting', enabled: true }] }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  // -----------------------------------------------------------------------
  // 14. Banned user
  // -----------------------------------------------------------------------
  it('returns 403 when user is banned', async () => {
    mockSession(mockGetSession, TEST_USER);

    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      users: [{ data: { is_banned: true } }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.code).toBe('USER_BANNED');
  });

  // -----------------------------------------------------------------------
  // 15. RPC function not found (503)
  // -----------------------------------------------------------------------
  it('returns 503 when RPC function not found', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }],
        votes: [{ data: [], count: 0 }],
        tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
        story_slots: [{ data: { slot_position: 1, status: 'voting', voting_ends_at: futureDate } }],
      },
      {
        insert_vote_atomic: { data: null, error: { code: '42883', message: 'function insert_vote_atomic does not exist' } },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(503);
    expect(body.code).toBe('RPC_NOT_FOUND');
  });

  // -----------------------------------------------------------------------
  // 16. Generic RPC error (500)
  // -----------------------------------------------------------------------
  it('returns 500 on generic RPC error', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }],
        votes: [{ data: [], count: 0 }],
        tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
        story_slots: [{ data: { slot_position: 1, status: 'voting', voting_ends_at: futureDate } }],
      },
      {
        insert_vote_atomic: { data: null, error: { code: 'UNKNOWN', message: 'Something broke' } },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 17. Waiting for clips slot
  // -----------------------------------------------------------------------
  it('returns 400 when slot is waiting for clips', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: [], count: 0 }],
      tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
      story_slots: [{ data: { slot_position: 1, status: 'waiting_for_clips', voting_ends_at: futureDate } }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.code).toBe('WAITING_FOR_CLIPS');
  });

  // -----------------------------------------------------------------------
  // 18. Self-vote detected by RPC
  // -----------------------------------------------------------------------
  it('returns 403 when RPC detects self-vote', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }],
        votes: [{ data: [], count: 0 }],
        tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
        story_slots: [{ data: { slot_position: 1, status: 'voting', voting_ends_at: futureDate } }],
      },
      {
        insert_vote_atomic: { data: [{ error_code: 'SELF_VOTE_NOT_ALLOWED' }] },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.code).toBe('SELF_VOTE_NOT_ALLOWED');
  });

  // -----------------------------------------------------------------------
  // 19. Catch-all error handler
  // -----------------------------------------------------------------------
  it('returns 500 on unexpected exception', async () => {
    // Simulate an error that makes the route's catch block fire.
    // We return a chain that rejects to avoid dangling unhandled rejections.
    const errorChain = createChainMock({ data: null });
    // Override the .then to reject so any await on the chain throws
    errorChain.then = jest.fn((_resolve: any, reject: any) => {
      return Promise.reject(new Error('unexpected DB failure')).catch(reject || (() => {}));
    });
    errorChain.maybeSingle = jest.fn(() => Promise.reject(new Error('unexpected DB failure')));
    errorChain.single = jest.fn(() => Promise.reject(new Error('unexpected DB failure')));

    const mockSupa = {
      from: jest.fn(() => errorChain),
      rpc: jest.fn(() => errorChain),
    };
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to cast vote');
  });

  // -----------------------------------------------------------------------
  // 20. Vote count update response fields
  // -----------------------------------------------------------------------
  it('includes correct remainingVotes in success response', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }],
        votes: [{ data: Array(10).fill({ vote_weight: 1 }), count: 10 }],
        tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
        story_slots: [{ data: { slot_position: 1, status: 'voting', voting_ends_at: futureDate } }],
      },
      {
        insert_vote_atomic: {
          data: [{
            vote_id: 'v1',
            was_new_vote: true,
            new_vote_count: 6,
            new_weighted_score: 6,
            final_vote_weight: 1,
          }],
        },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: validBody });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.totalVotesToday).toBe(11); // 10 existing + 1 new
    expect(body.remainingVotes.standard).toBe(189); // 200 - 11
  });
});

// ===========================================================================
// DELETE /api/vote
// ===========================================================================

describe('DELETE /api/vote', () => {
  const deleteBody = { clipId: 'clip-to-delete' };

  // -----------------------------------------------------------------------
  // 1. Rate limiting
  // -----------------------------------------------------------------------
  it('returns rate limit when rate limited', async () => {
    const rateLimitResp = new Response(
      JSON.stringify({ error: 'Too many requests' }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    );
    mockRateLimit.mockResolvedValueOnce(rateLimitResp);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: deleteBody });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(429);
    expect(body.error).toBe('Too many requests');
  });

  // -----------------------------------------------------------------------
  // 2. CSRF error
  // -----------------------------------------------------------------------
  it('returns CSRF error when CSRF fails', async () => {
    const csrfResp = new Response(
      JSON.stringify({ error: 'CSRF token missing' }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    );
    mockRequireCsrf.mockResolvedValueOnce(csrfResp);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: deleteBody });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toContain('CSRF');
  });

  // -----------------------------------------------------------------------
  // 3. Missing clipId
  // -----------------------------------------------------------------------
  it('returns 400 when clipId missing', async () => {
    const mockSupa = createTableMock({});
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: {} });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('clipId is required');
  });

  // -----------------------------------------------------------------------
  // 4. No vote found
  // -----------------------------------------------------------------------
  it('returns 404 when no vote found to revoke', async () => {
    const mockSupa = createTableMock(
      { votes: [{ data: [], count: 0 }] },
      { delete_vote_atomic: { data: [] } } // empty array = no vote found
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: deleteBody });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.code).toBe('NOT_VOTED');
  });

  // -----------------------------------------------------------------------
  // 5. Successful vote revoke
  // -----------------------------------------------------------------------
  it('returns 200 on successful vote revoke', async () => {
    const mockSupa = createTableMock(
      {
        votes: [{ data: [], count: 0 }], // getUserVotesToday after delete
      },
      {
        delete_vote_atomic: {
          data: [{
            vote_id: 'v-del-1',
            vote_weight: 1,
            new_vote_count: 4,
            new_weighted_score: 4,
          }],
        },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: deleteBody });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clipId).toBe('clip-to-delete');
    expect(body.newScore).toBe(4);
    expect(body.remainingVotes.standard).toBe(200);
  });

  // -----------------------------------------------------------------------
  // 6. RPC function not found
  // -----------------------------------------------------------------------
  it('returns 500 when RPC function not found', async () => {
    const mockSupa = createTableMock(
      {},
      { delete_vote_atomic: { data: null, error: { code: '42883', message: 'function delete_vote_atomic does not exist' } } }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: deleteBody });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toContain('Server configuration error');
  });

  // -----------------------------------------------------------------------
  // 7. Generic RPC error on delete
  // -----------------------------------------------------------------------
  it('returns 500 on generic RPC error during delete', async () => {
    const mockSupa = createTableMock(
      {},
      { delete_vote_atomic: { data: null, error: { code: 'UNKNOWN', message: 'Connection lost' } } }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: deleteBody });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to revoke vote');
  });

  // -----------------------------------------------------------------------
  // 8. Authenticated user revoke
  // -----------------------------------------------------------------------
  it('revokes vote using authenticated voter key', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn(() => createChainMock({
      data: [{
        vote_id: 'v-del-auth',
        vote_weight: 1,
        new_vote_count: 2,
        new_weighted_score: 2,
      }],
    }));

    const mockSupa = {
      from: jest.fn(() => createChainMock({ data: [{ vote_weight: 1 }], count: 1 })),
      rpc: rpcMock,
    };
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: deleteBody });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Verify RPC was called with user-prefixed voter key
    expect(rpcMock).toHaveBeenCalledWith('delete_vote_atomic', {
      p_voter_key: `user_${TEST_USER.userId}`,
      p_clip_id: 'clip-to-delete',
    });
  });

  // -----------------------------------------------------------------------
  // 9. Catch-all error handler
  // -----------------------------------------------------------------------
  it('returns 500 on unexpected exception', async () => {
    const mockSupa = {
      from: jest.fn(() => createChainMock({ data: null })),
      rpc: jest.fn(() => createChainMock({ data: null, error: null })),
    };
    // Override rpc to return a chain whose resolution rejects
    mockSupa.rpc = jest.fn(() => {
      const chain = createChainMock({ data: null });
      chain.then = jest.fn((_resolve: any, reject: any) => {
        return Promise.reject(new Error('unexpected')).catch(reject || (() => {}));
      });
      return chain;
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: deleteBody });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to revoke vote');
  });

  // -----------------------------------------------------------------------
  // 10. clipId must be a string
  // -----------------------------------------------------------------------
  it('returns 400 when clipId is not a string', async () => {
    const mockSupa = createTableMock({});
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: { clipId: 12345 } });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('clipId is required');
  });
});

// ===========================================================================
// Cross-cutting concerns
// ===========================================================================

describe('Cross-cutting vote concerns', () => {
  // -----------------------------------------------------------------------
  // Environment variable validation
  // -----------------------------------------------------------------------
  it('throws when SUPABASE_URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // createSupabaseServerClient throws before the handler's try-catch
    const req = createMockRequest('/api/vote');
    await expect(GET(req)).rejects.toThrow('Missing SUPABASE_URL');

    // Restore
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  // -----------------------------------------------------------------------
  // Genre param rejected when multi-genre disabled
  // -----------------------------------------------------------------------
  it('GET rejects genre param when multi_genre_enabled is false', async () => {
    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }], // empty = all flags false
        votes: [{ data: [], count: 0 }],
        seasons: [{ data: { id: 's1', status: 'active', total_slots: 75 } }],
        story_slots: [{ data: { id: 'slot1', season_id: 's1', slot_position: 1, status: 'voting', voting_ends_at: new Date(Date.now() + 3600000).toISOString() } }],
      },
      { get_clips_randomized: { data: [] } }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { searchParams: { genre: 'comedy' } });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.code).toBe('GENRE_NOT_SUPPORTED');
  });

  // -----------------------------------------------------------------------
  // Vote response structure validation
  // -----------------------------------------------------------------------
  it('GET response has all expected VotingStateResponse fields', async () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    const mockSupa = createTableMock(
      {
        feature_flags: [{ data: [] }],
        votes: [{ data: [], count: 0 }, { data: [] }],
        seasons: [{ data: { id: 's1', status: 'active', total_slots: 75 } }],
        story_slots: [{ data: { id: 'slot1', season_id: 's1', slot_position: 3, status: 'voting', voting_ends_at: futureDate, voting_started_at: new Date().toISOString() } }],
        tournament_clips: [{ data: null, count: 0 }],
      },
      {
        get_clips_randomized: { data: [] },
        get_comment_counts: { data: [] },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);

    // Verify all required fields exist in the response
    expect(body).toHaveProperty('clips');
    expect(body).toHaveProperty('totalVotesToday');
    expect(body).toHaveProperty('userRank');
    expect(body).toHaveProperty('remainingVotes');
    expect(body).toHaveProperty('votedClipIds');
    expect(body).toHaveProperty('currentSlot');
    expect(body).toHaveProperty('totalSlots');
    expect(body).toHaveProperty('streak');
    expect(body).toHaveProperty('votingEndsAt');
    expect(body).toHaveProperty('votingStartedAt');
    expect(body).toHaveProperty('timeRemainingSeconds');
    expect(body).toHaveProperty('totalClipsInSlot');
    expect(body).toHaveProperty('clipsShown');
    expect(body).toHaveProperty('hasMoreClips');
  });

  // -----------------------------------------------------------------------
  // POST db error on daily vote check returns 503
  // -----------------------------------------------------------------------
  it('POST returns 503 when daily vote check fails', async () => {
    const mockSupa = createTableMock({
      feature_flags: [{ data: [] }],
      votes: [{ data: null, error: { message: 'connection timeout' } }],
      tournament_clips: [{ data: { slot_position: 1, season_id: 's1', vote_count: 5, weighted_score: 5, status: 'active', user_id: 'other-user' } }],
    });
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'POST', body: { clipId: 'clip-1' } });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(503);
    expect(body.code).toBe('DB_ERROR');
  });

  // -----------------------------------------------------------------------
  // DELETE preserves remainingVotes after revoke
  // -----------------------------------------------------------------------
  it('DELETE response includes correct remainingVotes after revoke', async () => {
    const mockSupa = createTableMock(
      {
        votes: [{ data: Array(5).fill({ vote_weight: 1 }), count: 5 }],
      },
      {
        delete_vote_atomic: {
          data: [{ vote_id: 'v-del-1', vote_weight: 1, new_vote_count: 9, new_weighted_score: 9 }],
        },
      }
    );
    mockCreateClient.mockReturnValue(mockSupa);

    const req = createMockRequest('/api/vote', { method: 'DELETE', body: { clipId: 'clip-x' } });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.totalVotesToday).toBe(5);
    expect(body.remainingVotes.standard).toBe(195); // 200 - 5
  });
});
