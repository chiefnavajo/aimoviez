/**
 * @jest-environment node
 */

/**
 * Story API Route Tests
 *
 * Covers:
 *   GET /api/story              – seasons with slots/clips, empty, DB errors
 *   GET /api/story/last-frame   – last frame URL, no frame, missing season, feature disabled
 *   GET /api/story/pinned-characters – active characters, feature flag off, missing season, auth
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
jest.mock('@/lib/genres', () => ({
  isValidGenre: jest.fn((code: string) => {
    const valid = ['action', 'comedy', 'horror', 'animation', 'thriller', 'sci-fi', 'romance', 'drama'];
    return valid.includes(code);
  }),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import {
  createMockRequest,
  parseResponse,
  mockSession,
  TEST_USER,
} from '../helpers/api-test-utils';

import { GET as storyGET } from '@/app/api/story/route';
import { GET as lastFrameGET } from '@/app/api/story/last-frame/route';
import { GET as pinnedCharsGET } from '@/app/api/story/pinned-characters/route';

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
  chain.then = jest.fn((resolve: any) => Promise.resolve(resolved).then(resolve));
  chain.rpc = jest.fn(() => Promise.resolve(resolved));
  return chain;
}

/**
 * Creates a mock supabase client where different `.from(table)` calls
 * return different chain mocks.  `rpc` is also supported at the client level.
 */
function createMultiTableClient(
  tables: Record<string, { data?: unknown; error?: unknown; count?: number | null }>
) {
  const chains: Record<string, any> = {};
  for (const [table, val] of Object.entries(tables)) {
    chains[table] = createChainMock(val);
  }
  const defaultChain = createChainMock();
  const from = jest.fn((table: string) => chains[table] || defaultChain);
  return { from, rpc: jest.fn(() => Promise.resolve({ data: null, error: null })), chains };
}

/**
 * Creates a mock supabase client where sequential `.from()` calls
 * (regardless of table name) return successive chain mocks.
 */
function createSequentialClient(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  let idx = 0;
  const chains = responses.map((r) => createChainMock(r));
  const from = jest.fn(() => {
    const chain = chains[Math.min(idx, chains.length - 1)];
    idx++;
    return chain;
  });
  return { from, rpc: jest.fn(), chains };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

afterEach(() => {
  jest.clearAllMocks();
});

// ============================================================================
// GET /api/story
// ============================================================================

describe('GET /api/story', () => {
  const SEASON_ID = 'season-001';
  const SLOT_ID = 'slot-001';
  const CLIP_ID = 'clip-001';

  const makeSeason = (overrides: Record<string, unknown> = {}) => ({
    id: SEASON_ID,
    status: 'active',
    label: 'Season 1',
    total_slots: 75,
    created_at: '2026-01-01T00:00:00Z',
    description: 'The first season',
    ...overrides,
  });

  const makeSlot = (overrides: Record<string, unknown> = {}) => ({
    id: SLOT_ID,
    season_id: SEASON_ID,
    slot_position: 1,
    status: 'locked',
    genre: 'action',
    winner_tournament_clip_id: CLIP_ID,
    ...overrides,
  });

  const makeClip = (overrides: Record<string, unknown> = {}) => ({
    id: CLIP_ID,
    video_url: 'https://cdn.example.com/video.mp4',
    thumbnail_url: 'https://cdn.example.com/thumb.jpg',
    username: 'creator1',
    avatar_url: 'https://cdn.example.com/avatar.jpg',
    vote_count: 42,
    genre: 'action',
    ...overrides,
  });

  function buildReq(params: Record<string, string> = {}) {
    return createMockRequest('/api/story', { searchParams: { fresh: 'true', ...params } });
  }

  it('returns seasons with slots and winning clips', async () => {
    const client = createSequentialClient([
      // 1. seasons query
      { data: [makeSeason()] },
      // 2. story_slots query
      { data: [makeSlot()] },
      // 3. tournament_clips (winners)
      { data: [makeClip()] },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await storyGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.seasons).toHaveLength(1);

    const season = body.seasons[0];
    expect(season.id).toBe(SEASON_ID);
    expect(season.name).toBe('Season 1');
    expect(season.status).toBe('active');
    expect(season.total_slots).toBe(75);
    expect(season.slots).toHaveLength(1);
    expect(season.slots[0].winning_clip).toBeDefined();
    expect(season.slots[0].winning_clip.id).toBe(CLIP_ID);
    expect(season.slots[0].winning_clip.username).toBe('creator1');
    expect(season.slots[0].winning_clip.vote_count).toBe(42);
  });

  it('returns empty seasons array when no seasons exist', async () => {
    const client = createSequentialClient([
      { data: [] },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await storyGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.seasons).toEqual([]);
  });

  it('returns 500 when seasons query fails', async () => {
    const client = createSequentialClient([
      { data: null, error: { message: 'DB connection failed' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await storyGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to load seasons');
    expect(body.seasons).toEqual([]);
  });

  it('returns 500 when slots query fails', async () => {
    const client = createSequentialClient([
      { data: [makeSeason()] },
      { data: null, error: { message: 'Slots table error' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await storyGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to load slots');
    expect(body.seasons).toEqual([]);
  });

  it('maps season status "finished" to "completed"', async () => {
    const client = createSequentialClient([
      { data: [makeSeason({ status: 'finished' })] },
      { data: [] },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await storyGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.seasons[0].status).toBe('completed');
  });

  it('includes current_voting_slot when a slot is in voting status', async () => {
    const client = createSequentialClient([
      { data: [makeSeason()] },
      { data: [makeSlot({ status: 'voting', slot_position: 3, winner_tournament_clip_id: null })] },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await storyGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.seasons[0].current_voting_slot).toBe(3);
  });

  it('handles slots with no winning clip gracefully', async () => {
    const client = createSequentialClient([
      { data: [makeSeason()] },
      { data: [makeSlot({ winner_tournament_clip_id: null, status: 'upcoming' })] },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await storyGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.seasons[0].slots[0].winning_clip).toBeUndefined();
  });

  it('returns 500 when env vars are missing', async () => {
    const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const res = await storyGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Server configuration error');

    process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl;
  });
});

// ============================================================================
// GET /api/story/last-frame
// ============================================================================

describe('GET /api/story/last-frame', () => {
  const SEASON_ID = 'season-lf-001';

  function buildReq(params: Record<string, string> = {}) {
    return createMockRequest('/api/story/last-frame', { searchParams: params });
  }

  it('returns last frame URL for a valid previous winner', async () => {
    const client = createSequentialClient([
      // 1. feature_flags
      {
        data: [
          { key: 'last_frame_continuation', enabled: true },
          { key: 'multi_genre_enabled', enabled: false },
        ],
      },
      // 2. seasons (active)
      { data: { id: SEASON_ID, genre: 'action' } },
      // 3. story_slots current (voting)
      { data: { slot_position: 3 } },
      // 4. story_slots previous locked
      { data: { winner_tournament_clip_id: 'clip-win-01' } },
      // 5. tournament_clips
      { data: { last_frame_url: 'https://cdn.example.com/frame.jpg', title: 'Epic Battle' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await lastFrameGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBe('https://cdn.example.com/frame.jpg');
    expect(body.slotPosition).toBe(2);
    expect(body.clipTitle).toBe('Epic Battle');
    expect(body.genre).toBe('action');
  });

  it('returns null when feature is disabled', async () => {
    const client = createSequentialClient([
      {
        data: [
          { key: 'last_frame_continuation', enabled: false },
          { key: 'multi_genre_enabled', enabled: false },
        ],
      },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await lastFrameGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBeNull();
    expect(body.reason).toBe('feature_disabled');
  });

  it('returns null when no active season exists', async () => {
    const client = createSequentialClient([
      {
        data: [
          { key: 'last_frame_continuation', enabled: true },
          { key: 'multi_genre_enabled', enabled: false },
        ],
      },
      // seasons query returns null
      { data: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await lastFrameGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBeNull();
    expect(body.reason).toBe('no_active_season');
  });

  it('returns null when current slot is the first slot', async () => {
    const client = createSequentialClient([
      {
        data: [
          { key: 'last_frame_continuation', enabled: true },
          { key: 'multi_genre_enabled', enabled: false },
        ],
      },
      { data: { id: SEASON_ID, genre: 'action' } },
      // current slot is position 1
      { data: { slot_position: 1 } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await lastFrameGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBeNull();
    expect(body.reason).toBe('first_slot');
  });

  it('returns null when no current non-locked slot exists', async () => {
    const client = createSequentialClient([
      {
        data: [
          { key: 'last_frame_continuation', enabled: true },
          { key: 'multi_genre_enabled', enabled: false },
        ],
      },
      { data: { id: SEASON_ID, genre: 'action' } },
      // no current slot
      { data: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await lastFrameGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBeNull();
    expect(body.reason).toBe('first_slot');
  });

  it('returns null when previous slot has no winner', async () => {
    const client = createSequentialClient([
      {
        data: [
          { key: 'last_frame_continuation', enabled: true },
          { key: 'multi_genre_enabled', enabled: false },
        ],
      },
      { data: { id: SEASON_ID, genre: 'action' } },
      { data: { slot_position: 5 } },
      // previous slot has no winner
      { data: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await lastFrameGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBeNull();
    expect(body.reason).toBe('no_previous_winner');
  });

  it('returns null when frame has not been extracted yet', async () => {
    const client = createSequentialClient([
      {
        data: [
          { key: 'last_frame_continuation', enabled: true },
          { key: 'multi_genre_enabled', enabled: false },
        ],
      },
      { data: { id: SEASON_ID, genre: 'action' } },
      { data: { slot_position: 4 } },
      { data: { winner_tournament_clip_id: 'clip-win-02' } },
      // clip has no last_frame_url
      { data: { last_frame_url: null, title: 'No Frame Yet' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await lastFrameGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBeNull();
    expect(body.reason).toBe('frame_not_extracted');
  });

  it('requires genre param when multi_genre_enabled is on', async () => {
    const client = createSequentialClient([
      {
        data: [
          { key: 'last_frame_continuation', enabled: true },
          { key: 'multi_genre_enabled', enabled: true },
        ],
      },
    ]);
    mockCreateClient.mockReturnValue(client);

    // No genre param provided
    const res = await lastFrameGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBeNull();
    expect(body.reason).toBe('genre_required');
  });

  it('returns null for invalid genre param', async () => {
    const client = createSequentialClient([
      {
        data: [
          { key: 'last_frame_continuation', enabled: true },
          { key: 'multi_genre_enabled', enabled: false },
        ],
      },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await lastFrameGET(buildReq({ genre: 'not-a-real-genre' }));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBeNull();
    expect(body.reason).toBe('invalid_genre');
  });

  it('handles unexpected errors gracefully', async () => {
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => { throw new Error('Unexpected DB crash'); }),
    });

    const res = await lastFrameGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.lastFrameUrl).toBeNull();
    expect(body.reason).toBe('error');
  });
});

// ============================================================================
// GET /api/story/pinned-characters
// ============================================================================

describe('GET /api/story/pinned-characters', () => {
  const SEASON_ID = 'season-pc-001';

  const makeCharacter = (index: number) => ({
    id: `char-${index}`,
    element_index: index,
    label: `Character ${index}`,
    frontal_image_url: `https://cdn.example.com/char-${index}.jpg`,
    reference_image_urls: ['https://cdn.example.com/ref1.jpg', 'https://cdn.example.com/ref2.jpg'],
    usage_count: index * 10,
  });

  function buildReq(params: Record<string, string> = {}) {
    return createMockRequest('/api/story/pinned-characters', { searchParams: params });
  }

  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns active pinned characters for the current season', async () => {
    mockSession(mockGetSession, TEST_USER);

    const chars = [makeCharacter(0), makeCharacter(1), makeCharacter(2)];

    const client = createSequentialClient([
      // 1. feature_flags
      { data: { enabled: true } },
      // 2. seasons (active) — returns array with .limit(1)
      { data: [{ id: SEASON_ID }] },
      // 3. pinned_characters
      { data: chars },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.enabled).toBe(true);
    expect(body.season_id).toBe(SEASON_ID);
    expect(body.characters).toHaveLength(3);
    expect(body.characters[0]).toEqual({
      id: 'char-0',
      element_index: 0,
      label: 'Character 0',
      frontal_image_url: 'https://cdn.example.com/char-0.jpg',
      reference_count: 2,
      appearance_description: null,
    });
  });

  it('returns empty characters with enabled=false when feature flag is off', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = createSequentialClient([
      // feature_flags: disabled
      { data: { enabled: false } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.enabled).toBe(false);
    expect(body.characters).toEqual([]);
  });

  it('returns empty when no feature flag row exists', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = createSequentialClient([
      // feature_flags: no row
      { data: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.enabled).toBe(false);
    expect(body.characters).toEqual([]);
  });

  it('returns empty characters when no active season and no season_id param', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = createSequentialClient([
      // feature_flags: enabled
      { data: { enabled: true } },
      // seasons: no active season
      { data: null },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.characters).toEqual([]);
    expect(body.reason).toBe('no_active_season');
  });

  it('uses season_id from query param when provided', async () => {
    mockSession(mockGetSession, TEST_USER);

    const explicitSeasonId = 'season-explicit-999';
    const chars = [makeCharacter(0)];

    const client = createSequentialClient([
      // 1. feature_flags
      { data: { enabled: true } },
      // 2. pinned_characters (skips season lookup because season_id is provided)
      { data: chars },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await pinnedCharsGET(buildReq({ season_id: explicitSeasonId }));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.season_id).toBe(explicitSeasonId);
    expect(body.characters).toHaveLength(1);
  });

  it('returns 500 when pinned_characters query errors', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = createSequentialClient([
      // feature_flags
      { data: { enabled: true } },
      // seasons — returns array with .limit(1)
      { data: [{ id: SEASON_ID }] },
      // pinned_characters: error
      { data: null, error: { message: 'Table not found' } },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch pinned characters');
  });

  it('returns empty characters array when no pinned characters exist', async () => {
    mockSession(mockGetSession, TEST_USER);

    const client = createSequentialClient([
      { data: { enabled: true } },
      // seasons — returns array with .limit(1)
      { data: [{ id: SEASON_ID }] },
      { data: [] },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.characters).toEqual([]);
    expect(body.season_id).toBe(SEASON_ID);
  });

  it('handles unexpected errors with 500', async () => {
    mockSession(mockGetSession, TEST_USER);

    mockCreateClient.mockReturnValue({
      from: jest.fn(() => { throw new Error('Unexpected crash'); }),
    });

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('returns appearance_description when present', async () => {
    mockSession(mockGetSession, TEST_USER);

    const charsWithDesc = [{
      id: 'char-desc-1',
      element_index: 1,
      label: 'Blue Alien',
      frontal_image_url: 'https://cdn.example.com/alien.jpg',
      reference_image_urls: [],
      usage_count: 5,
      appearance_description: 'tall alien with blue skin and glowing eyes',
    }];

    const client = createSequentialClient([
      { data: { enabled: true } },
      { data: [{ id: SEASON_ID }] },
      { data: charsWithDesc },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.characters[0].appearance_description).toBe('tall alien with blue skin and glowing eyes');
  });

  it('returns null appearance_description when not set', async () => {
    mockSession(mockGetSession, TEST_USER);

    const charsNoDesc = [{
      id: 'char-no-desc',
      element_index: 1,
      label: 'Robot',
      frontal_image_url: 'https://cdn.example.com/robot.jpg',
      reference_image_urls: ['https://cdn.example.com/ref.jpg'],
      usage_count: 0,
    }];

    const client = createSequentialClient([
      { data: { enabled: true } },
      { data: [{ id: SEASON_ID }] },
      { data: charsNoDesc },
    ]);
    mockCreateClient.mockReturnValue(client);

    const res = await pinnedCharsGET(buildReq());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.characters[0].appearance_description).toBeNull();
    expect(body.characters[0].reference_count).toBe(1);
  });
});
