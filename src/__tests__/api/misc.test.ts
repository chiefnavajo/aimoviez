/**
 * @jest-environment node
 */

/**
 * Miscellaneous API Route Tests
 * Covers: CSRF, Health, Health/Redis, Features, Genres, Genre-Vote,
 *         Discover, Seasons/Active, Clip/[id], Contact, Report, Referral, Watch
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
  requireCsrf: jest.fn().mockResolvedValue(null),
  generateCsrfToken: jest.fn().mockReturnValue('mock-csrf-token-abc'),
}));
jest.mock('@/lib/validations', () => ({
  parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
  GenreVoteSchema: {},
}));
jest.mock('@/lib/sanitize', () => ({
  sanitizeText: jest.fn((v: string) => (v ? v.trim() : '')),
  escapeHtml: jest.fn((v: string) => (v ? v.trim() : '')),
  sanitizeUuid: jest.fn((v: string) => v),
}));
jest.mock('@/lib/genres', () => ({
  getGenreEmoji: jest.fn().mockReturnValue('emoji'),
  getGenreLabel: jest.fn().mockReturnValue('Action'),
  LAUNCH_GENRES: ['action', 'comedy', 'horror', 'animation'],
  isValidGenre: jest.fn().mockReturnValue(true),
}));
jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    dbsize: jest.fn().mockResolvedValue(42),
  })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import {
  createSupabaseChain,
  createSequentialMock,
  createMockRequest,
  mockSession,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

import { GET as csrfGet } from '@/app/api/csrf/route';
import { GET as healthGet } from '@/app/api/health/route';
import { GET as healthRedisGet } from '@/app/api/health/redis/route';
import { GET as featuresGet } from '@/app/api/features/route';
import { GET as genresGet, POST as genresPost } from '@/app/api/genres/route';
import { GET as genreVoteGet, POST as genreVotePost } from '@/app/api/genre-vote/route';
import { GET as discoverGet } from '@/app/api/discover/route';
import { GET as seasonsActiveGet } from '@/app/api/seasons/active/route';
import { GET as clipGet } from '@/app/api/clip/[id]/route';
import { POST as contactPost } from '@/app/api/contact/route';
import { POST as reportPost } from '@/app/api/report/route';
import { GET as referralGet, POST as referralPost } from '@/app/api/referral/route';
import { GET as watchGet } from '@/app/api/watch/route';

const mockGetSession = getServerSession as jest.Mock;
const mockCreateClient = createClient as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSequentialFromMock(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  let callIndex = 0;
  const chains = responses.map((r) => createSupabaseChain(r));

  const from = jest.fn(() => {
    const chain = chains[Math.min(callIndex, chains.length - 1)];
    callIndex++;
    return chain;
  });

  return { from, chains };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.NEXTAUTH_SECRET = 'test-secret';
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
  process.env.UPSTASH_REDIS_REST_URL = 'https://test-redis.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
});

// ===========================================================================
// CSRF - GET /api/csrf
// ===========================================================================

describe('GET /api/csrf', () => {
  it('returns success and sets csrf-token cookie', async () => {
    const req = createMockRequest('/api/csrf');
    const res = await csrfGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Verify cookie is set
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toContain('csrf-token=');
  });
});

// ===========================================================================
// HEALTH - GET /api/health
// ===========================================================================

describe('GET /api/health', () => {
  it('returns health status with timestamp and checks array', async () => {
    const chain = createSupabaseChain({ data: { id: 'season-1' }, error: null });
    const storageChain = createSupabaseChain({ data: [], error: null });

    mockCreateClient.mockReturnValue({
      from: chain.from,
      storage: { from: jest.fn().mockReturnValue({ list: jest.fn().mockResolvedValue({ data: [], error: null }) }) },
    });

    const res = await healthGet();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.timestamp).toBeDefined();
    expect(body.status).toBeDefined();
    expect(body.checks).toBeDefined();
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns unhealthy status when database check fails', async () => {
    // Missing env vars scenario
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const res = await healthGet();
    const { body } = await parseResponse(res);

    expect(body.checks).toBeDefined();
    // Environment check should fail due to missing vars
    const envCheck = body.checks.find((c: { name: string }) => c.name === 'environment');
    if (envCheck) {
      expect(envCheck.status).toBe('fail');
    }
  });
});

// ===========================================================================
// HEALTH REDIS - GET /api/health/redis
// ===========================================================================

describe('GET /api/health/redis', () => {
  it('returns redis health status with connectivity check', async () => {
    const req = createMockRequest('/api/health/redis');
    const res = await healthRedisGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.timestamp).toBeDefined();
    expect(body.status).toBeDefined();
    expect(body.checks).toBeDefined();
    expect(Array.isArray(body.checks)).toBe(true);
  });

  it('returns unhealthy when Redis env vars are missing', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    const req = createMockRequest('/api/health/redis');
    const res = await healthRedisGet(req);
    const { body } = await parseResponse(res);

    expect(body.status).toBe('unhealthy');
    const connCheck = body.checks.find((c: { name: string }) => c.name === 'connectivity');
    expect(connCheck?.status).toBe('fail');
  });
});

// ===========================================================================
// FEATURES - GET /api/features
// ===========================================================================

describe('GET /api/features', () => {
  it('returns feature flags map', async () => {
    const chain = createSupabaseChain({
      data: [
        { key: 'multi_genre_enabled', enabled: true, config: { max_genres: 4 } },
        { key: 'referral_system', enabled: false, config: null },
      ],
      error: null,
    });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/features');
    const res = await featuresGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.features).toBeDefined();
    expect(body.features.multi_genre_enabled).toBe(true);
    expect(body.features.referral_system).toBe(false);
  });

  it('returns empty features on database error (graceful degradation)', async () => {
    const chain = createSupabaseChain({ data: null, error: { code: '42P01', message: 'table not found' } });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/features');
    const res = await featuresGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.features).toEqual({});
  });

  it('strips sensitive config keys from response', async () => {
    const chain = createSupabaseChain({
      data: [
        { key: 'cost_limits', enabled: true, config: { daily_cost_limit_cents: 500, display_label: 'Costs' } },
      ],
      error: null,
    });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/features');
    const res = await featuresGet(req);
    const { body } = await parseResponse(res);

    // daily_cost_limit_cents should be stripped
    if (body.configs.cost_limits) {
      expect(body.configs.cost_limits.daily_cost_limit_cents).toBeUndefined();
      expect(body.configs.cost_limits.display_label).toBe('Costs');
    }
  });
});

// ===========================================================================
// GENRES - GET /api/genres
// ===========================================================================

describe('GET /api/genres', () => {
  it('returns genre vote summary with options', async () => {
    const chain = createSupabaseChain({
      data: [
        { genre_code: 'COMEDY', voter_key: 'device_abc' },
        { genre_code: 'COMEDY', voter_key: 'device_def' },
        { genre_code: 'THRILLER', voter_key: 'device_ghi' },
      ],
      error: null,
    });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/genres', { searchParams: { season: '2' } });
    const res = await genresGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.seasonNumber).toBe(2);
    expect(body.totalVotes).toBe(3);
    expect(body.options).toBeDefined();
    expect(Array.isArray(body.options)).toBe(true);
  });

  it('returns 400 for invalid season number', async () => {
    const chain = createSupabaseChain({ data: [], error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/genres', { searchParams: { season: '-1' } });
    const res = await genresGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('Invalid season');
  });
});

// ===========================================================================
// GENRE VOTE - POST /api/genre-vote
// ===========================================================================

describe('POST /api/genre-vote', () => {
  it('casts a genre vote and returns updated counts', async () => {
    // Upsert succeeds, then RPC returns stats
    const upsertChain = createSupabaseChain({ data: null, error: null });
    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        return upsertChain;
      }),
      rpc: jest.fn().mockResolvedValue({
        data: [
          { genre: 'Comedy', vote_count: 5, user_voted: true },
          { genre: 'Thriller', vote_count: 3, user_voted: false },
        ],
        error: null,
      }),
    });

    const req = createMockRequest('/api/genre-vote', {
      method: 'POST',
      body: { genre: 'Comedy' },
    });
    const res = await genreVotePost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.genre).toBe('Comedy');
  });

  it('returns 400 for invalid genre via validation failure', async () => {
    const { parseBody } = require('@/lib/validations');
    (parseBody as jest.Mock).mockReturnValueOnce({
      success: false,
      error: 'Invalid genre',
    });

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from, rpc: jest.fn() });

    const req = createMockRequest('/api/genre-vote', {
      method: 'POST',
      body: { genre: 'InvalidGenre' },
    });
    const res = await genreVotePost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });
});

describe('GET /api/genre-vote', () => {
  it('returns genre vote stats with percentages', async () => {
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => createSupabaseChain({ data: null, error: null })),
      rpc: jest.fn().mockResolvedValue({
        data: [
          { genre: 'Comedy', vote_count: 10, user_voted: false },
          { genre: 'Thriller', vote_count: 5, user_voted: true },
        ],
        error: null,
      }),
    });

    const req = createMockRequest('/api/genre-vote');
    const res = await genreVoteGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.counts).toBeDefined();
    expect(body.percentages).toBeDefined();
    expect(body.total_votes).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// DISCOVER - GET /api/discover
// ===========================================================================

describe('GET /api/discover', () => {
  it('returns paginated clips and creators', async () => {
    // Sequential: seasons query, then clips query, then creators query, then locked slots
    const seasonChain = createSupabaseChain({
      data: { id: 'season-1' },
      error: null,
    });
    const clipsChain = createSupabaseChain({
      data: [
        {
          id: 'clip-1',
          thumbnail_url: 'https://thumb.jpg',
          video_url: 'https://video.mp4',
          username: 'user1',
          avatar_url: null,
          genre: 'Action',
          vote_count: 10,
          slot_position: 1,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      error: null,
      count: 1,
    });
    const creatorsClipChain = createSupabaseChain({
      data: [
        { user_id: 'u1', username: 'user1', avatar_url: null, vote_count: 10, id: 'clip-1' },
      ],
      error: null,
    });
    const lockedSlotsChain = createSupabaseChain({ data: [], error: null });

    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        if (callIdx === 1) return seasonChain; // seasons lookup
        if (callIdx === 2) return clipsChain; // clips query
        if (callIdx === 3) return creatorsClipChain; // creator clips
        return lockedSlotsChain; // locked slots
      }),
    });

    const req = createMockRequest('/api/discover', {
      searchParams: { sort: 'newest', page: '1', limit: '10' },
    });
    const res = await discoverGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.clips).toBeDefined();
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(10);
    expect(body.has_more).toBeDefined();
  });
});

// ===========================================================================
// SEASONS ACTIVE - GET /api/seasons/active
// ===========================================================================

describe('GET /api/seasons/active', () => {
  it('returns active seasons with genre info', async () => {
    // Sequential: feature_flags, seasons, voting slots, locked slots, clips
    const featureFlagChain = createSupabaseChain({ data: { enabled: true }, error: null });
    const seasonsChain = createSupabaseChain({
      data: [
        { id: 'season-1', label: 'Season 1', genre: 'action', total_slots: 75, status: 'active' },
      ],
      error: null,
    });
    const votingSlotsChain = createSupabaseChain({
      data: [{ season_id: 'season-1', slot_position: 3 }],
      error: null,
    });
    const lockedSlotsChain = createSupabaseChain({
      data: [{ season_id: 'season-1' }],
      error: null,
    });
    const clipsChain = createSupabaseChain({
      data: [{ season_id: 'season-1' }],
      error: null,
    });

    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        if (callIdx === 1) return featureFlagChain;
        if (callIdx === 2) return seasonsChain;
        if (callIdx === 3) return votingSlotsChain;
        if (callIdx === 4) return lockedSlotsChain;
        return clipsChain;
      }),
    });

    const req = createMockRequest('/api/seasons/active');
    const res = await seasonsActiveGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.seasons).toBeDefined();
    expect(Array.isArray(body.seasons)).toBe(true);
    expect(body.multiGenreEnabled).toBe(true);
    if (body.seasons.length > 0) {
      expect(body.seasons[0].genre).toBe('action');
      expect(body.seasons[0].currentSlot).toBe(3);
    }
  });

  it('returns empty seasons array when no active seasons exist', async () => {
    const featureFlagChain = createSupabaseChain({ data: { enabled: false }, error: null });
    const seasonsChain = createSupabaseChain({ data: [], error: null });

    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        if (callIdx === 1) return featureFlagChain;
        return seasonsChain;
      }),
    });

    const req = createMockRequest('/api/seasons/active');
    const res = await seasonsActiveGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.seasons).toEqual([]);
  });
});

// ===========================================================================
// CLIP [id] - GET /api/clip/[id]
// ===========================================================================

describe('GET /api/clip/[id]', () => {
  it('returns clip details by ID', async () => {
    mockGetSession.mockResolvedValue(null);

    const clipData = {
      id: 'clip-uuid',
      video_url: 'https://video.mp4',
      thumbnail_url: 'https://thumb.jpg',
      username: 'creator1',
      avatar_url: null,
      title: 'My Clip',
      description: 'A cool clip',
      vote_count: 42,
      weighted_score: 55,
      genre: 'Action',
      slot_position: 1,
      status: 'active',
      view_count: 100,
      created_at: '2026-01-01T00:00:00Z',
      season_id: 'season-1',
    };

    const slotData = {
      id: 'slot-1',
      slot_position: 1,
      status: 'voting',
      voting_ends_at: '2026-12-31T00:00:00Z',
      winner_tournament_clip_id: null,
      season_id: 'season-1',
    };

    const seasonData = { id: 'season-1', name: 'Season 1', status: 'active' };

    // Sequential: clip, slot, season, comments count, rank, total in slot
    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        if (callIdx === 1) return createSupabaseChain({ data: clipData, error: null }); // clip
        if (callIdx === 2) return createSupabaseChain({ data: null, error: null }); // votes (no user)
        if (callIdx === 3) return createSupabaseChain({ data: slotData, error: null }); // slot
        if (callIdx === 4) return createSupabaseChain({ data: seasonData, error: null }); // season
        if (callIdx === 5) return createSupabaseChain({ data: null, error: null, count: 5 }); // comments
        if (callIdx === 6) return createSupabaseChain({ data: null, error: null, count: 2 }); // rank
        return createSupabaseChain({ data: null, error: null, count: 10 }); // total in slot
      }),
    });

    const req = createMockRequest('/api/clip/clip-uuid');
    const res = await clipGet(req, { params: Promise.resolve({ id: 'clip-uuid' }) });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.clip).toBeDefined();
    expect(body.clip.id).toBe('clip-uuid');
    expect(body.clip.vote_count).toBe(42);
    expect(body.clip.genre).toBe('Action');
    expect(body.user_vote).toBeDefined();
    expect(body.stats).toBeDefined();
  });

  it('returns 404 when clip is not found', async () => {
    mockGetSession.mockResolvedValue(null);

    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        return createSupabaseChain({ data: null, error: null });
      }),
    });

    const req = createMockRequest('/api/clip/nonexistent');
    const res = await clipGet(req, { params: Promise.resolve({ id: 'nonexistent' }) });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toContain('not found');
  });
});

// ===========================================================================
// CONTACT - POST /api/contact
// ===========================================================================

describe('POST /api/contact', () => {
  it('submits a contact form successfully', async () => {
    mockGetSession.mockResolvedValue(null);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/contact', {
      method: 'POST',
      body: {
        reason: 'general',
        email: 'user@example.com',
        subject: 'Hello there',
        message: 'I have a question about the platform, can you help me?',
      },
    });
    const res = await contactPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 400 when email is missing', async () => {
    mockGetSession.mockResolvedValue(null);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/contact', {
      method: 'POST',
      body: {
        reason: 'general',
        email: '',
        subject: 'Hello there',
        message: 'I have a question about the platform, can you help me?',
      },
    });
    const res = await contactPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 400 when message is too short', async () => {
    mockGetSession.mockResolvedValue(null);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/contact', {
      method: 'POST',
      body: {
        reason: 'general',
        email: 'user@example.com',
        subject: 'Hello there',
        message: 'Short',
      },
    });
    const res = await contactPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('Message must be');
  });

  it('returns 400 when reason is invalid', async () => {
    mockGetSession.mockResolvedValue(null);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/contact', {
      method: 'POST',
      body: {
        reason: 'invalid-reason',
        email: 'user@example.com',
        subject: 'Hello there',
        message: 'I have a question about the platform, can you help me?',
      },
    });
    const res = await contactPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('Invalid reason');
  });
});

// ===========================================================================
// REPORT - POST /api/report
// ===========================================================================

describe('POST /api/report', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/report', {
      method: 'POST',
      body: { clipId: 'clip-1', reason: 'spam' },
    });
    const res = await reportPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toContain('Authentication required');
  });

  it('returns 400 when reason is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/report', {
      method: 'POST',
      body: { clipId: 'clip-1' },
    });
    const res = await reportPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('Invalid reason');
  });

  it('returns 400 when no target (clipId/userId/commentId) is specified', async () => {
    mockSession(mockGetSession, TEST_USER);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/report', {
      method: 'POST',
      body: { reason: 'spam' },
    });
    const res = await reportPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('Must specify');
  });

  it('submits a report successfully with valid data', async () => {
    mockSession(mockGetSession, TEST_USER);

    // Sequential: check existing report (none found), insert report
    const existingChain = createSupabaseChain({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
    const insertChain = createSupabaseChain({ data: null, error: null });

    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        if (callIdx === 1) return existingChain;
        return insertChain;
      }),
    });

    const req = createMockRequest('/api/report', {
      method: 'POST',
      body: {
        clipId: 'clip-1',
        reason: 'spam',
        description: 'This is spam content',
      },
    });
    const res = await reportPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ===========================================================================
// REFERRAL - GET /api/referral
// ===========================================================================

describe('GET /api/referral', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    // feature_flags check returns enabled
    const featureChain = createSupabaseChain({ data: { enabled: true }, error: null });
    mockCreateClient.mockReturnValue({ from: featureChain.from });

    const req = createMockRequest('/api/referral');
    const res = await referralGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toContain('Unauthorized');
  });

  it('returns referral info when authenticated', async () => {
    mockSession(mockGetSession, TEST_USER);

    // Sequential: feature_flags, users, referrals
    const featureChain = createSupabaseChain({ data: { enabled: true }, error: null });
    const userChain = createSupabaseChain({
      data: { id: TEST_USER.userId, referral_code: 'ABCD1234', referral_count: 3, referred_by: null },
      error: null,
    });
    const referralsChain = createSupabaseChain({
      data: [
        { id: 'ref-1', status: 'completed', reward_amount: 50, created_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-02T00:00:00Z' },
      ],
      error: null,
    });

    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        if (callIdx === 1) return featureChain;
        if (callIdx === 2) return userChain;
        return referralsChain;
      }),
    });

    const req = createMockRequest('/api/referral');
    const res = await referralGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.referral_code).toBe('ABCD1234');
    expect(body.referral_count).toBe(3);
    expect(body.referral_link).toContain('ABCD1234');
    expect(body.tiers).toBeDefined();
  });

  it('returns disabled message when referral feature is off', async () => {
    mockSession(mockGetSession, TEST_USER);

    const featureChain = createSupabaseChain({ data: { enabled: false }, error: null });
    mockCreateClient.mockReturnValue({ from: featureChain.from });

    const req = createMockRequest('/api/referral');
    const res = await referralGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.message).toContain('not enabled');
  });
});

// ===========================================================================
// REFERRAL - POST /api/referral
// ===========================================================================

describe('POST /api/referral', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest('/api/referral', {
      method: 'POST',
      body: { referral_code: 'ABCD1234' },
    });
    const res = await referralPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toContain('Authentication required');
  });

  it('returns 400 when referral_code is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    // feature_flags enabled, then user lookup
    const featureChain = createSupabaseChain({ data: { enabled: true }, error: null });
    const userChain = createSupabaseChain({ data: { id: TEST_USER.userId }, error: null });

    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        if (callIdx === 1) return featureChain;
        return userChain;
      }),
    });

    const req = createMockRequest('/api/referral', {
      method: 'POST',
      body: {},
    });
    const res = await referralPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('Referral code is required');
  });
});

// ===========================================================================
// WATCH - GET /api/watch
// ===========================================================================

describe('GET /api/watch', () => {
  it('returns finished seasons with slots', async () => {
    const finishedSeason = {
      id: 'season-done',
      label: 'Season 1',
      status: 'finished',
      total_slots: 75,
      created_at: '2025-06-01T00:00:00Z',
    };

    const lockedSlot = {
      id: 'slot-1',
      slot_position: 1,
      winner_tournament_clip_id: 'clip-w1',
      status: 'locked',
      season_id: 'season-done',
    };

    const winningClip = {
      id: 'clip-w1',
      video_url: 'https://video.mp4',
      thumbnail_url: 'https://thumb.jpg',
      username: 'winner',
      genre: 'Action',
      vote_count: 99,
    };

    let callIdx = 0;
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        callIdx++;
        if (callIdx === 1) return createSupabaseChain({ data: [finishedSeason], error: null }); // seasons
        if (callIdx === 2) return createSupabaseChain({ data: [lockedSlot], error: null }); // slots
        return createSupabaseChain({ data: [winningClip], error: null }); // clips
      }),
    });

    const res = await watchGet();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.hasFinishedSeasons).toBe(true);
    expect(body.seasons).toBeDefined();
    expect(body.seasons.length).toBe(1);
    expect(body.seasons[0].slots.length).toBe(1);
    expect(body.seasons[0].slots[0].clip.username).toBe('winner');
  });

  it('returns empty when no finished seasons exist', async () => {
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => createSupabaseChain({ data: [], error: null })),
    });

    const res = await watchGet();
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.hasFinishedSeasons).toBe(false);
    expect(body.seasons).toEqual([]);
  });
});
