/**
 * @jest-environment node
 */
/**
 * admin-co-director.test.ts
 * Unit tests for the admin co-director API routes:
 *   POST /api/admin/co-director/analyze          - Trigger AI story analysis
 *   POST /api/admin/co-director/generate-brief    - Generate creative brief from winning direction
 *   POST /api/admin/co-director/generate-directions - Generate direction options for a slot
 *   POST /api/admin/co-director/open-direction-vote - Open direction voting for a slot
 *   POST /api/admin/co-director/close-direction-vote - Close direction voting and pick winner
 *   GET  /api/admin/co-director/brief             - Get brief for a specific slot
 *   PUT  /api/admin/co-director/brief             - Edit and publish a brief
 *   GET  /api/admin/co-director/analyses          - List story analyses for a season
 */

// ---------------------------------------------------------------------------
// Mocks -- BEFORE any imports
// ---------------------------------------------------------------------------

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: jest.fn().mockReturnValue(null) }));
jest.mock('@/lib/admin-auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
  requireAdminWithAuth: jest.fn().mockResolvedValue({
    isAdmin: true,
    userId: '660e8400-e29b-41d4-a716-446655440000',
    email: 'admin@test.com',
  }),
}));
jest.mock('@/lib/validations', () => ({
  parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
}));
jest.mock('@/lib/audit-log', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));

// Mock Claude API / AI dependencies
jest.mock('@/lib/claude-director', () => ({
  analyzeStory: jest.fn().mockResolvedValue({
    ok: true,
    analysis: { characters: [], plot_threads: [], tone: 'dramatic' },
    inputTokens: 500,
    outputTokens: 200,
    costCents: 1,
  }),
  writeBrief: jest.fn().mockResolvedValue({
    ok: true,
    brief: {
      brief_title: 'Test Brief',
      scene_description: 'A test scene',
      visual_requirements: 'Dark lighting',
      tone_guidance: 'Suspenseful',
      continuity_notes: null,
      do_list: ['Be dramatic'],
      dont_list: ['No comedy'],
      example_prompts: ['A dark alley scene'],
    },
    inputTokens: 600,
    outputTokens: 300,
    costCents: 2,
  }),
  generateDirections: jest.fn().mockResolvedValue({
    ok: true,
    directions: [
      { title: 'Direction A', description: 'Go left', mood: 'tense', suggested_genre: 'thriller', visual_hints: 'dark', narrative_hooks: 'twist' },
      { title: 'Direction B', description: 'Go right', mood: 'calm', suggested_genre: 'drama', visual_hints: 'bright', narrative_hooks: 'reveal' },
    ],
    inputTokens: 400,
    outputTokens: 250,
    costCents: 1,
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { requireAdmin, requireAdminWithAuth } from '@/lib/admin-auth';
import { analyzeStory, writeBrief, generateDirections } from '@/lib/claude-director';
import {
  createSequentialMock,
  createMockRequest,
  parseResponse,
  mockAdminAuthFail,
} from '../helpers/api-test-utils';

import { POST as analyzePost } from '@/app/api/admin/co-director/analyze/route';
import { POST as generateBriefPost } from '@/app/api/admin/co-director/generate-brief/route';
import { POST as generateDirectionsPost } from '@/app/api/admin/co-director/generate-directions/route';
import { POST as openDirectionVotePost } from '@/app/api/admin/co-director/open-direction-vote/route';
import { POST as closeDirectionVotePost } from '@/app/api/admin/co-director/close-direction-vote/route';
import { GET as briefGet, PUT as briefPut } from '@/app/api/admin/co-director/brief/route';
import { GET as analysesGet } from '@/app/api/admin/co-director/analyses/route';

// ---------------------------------------------------------------------------
// Shared references
// ---------------------------------------------------------------------------

const mockCreateClient = createClient as jest.Mock;
const mockRequireAdmin = requireAdmin as jest.Mock;
const mockRequireAdminWithAuth = requireAdminWithAuth as jest.Mock;
const mockAnalyzeStory = analyzeStory as jest.Mock;
const mockWriteBrief = writeBrief as jest.Mock;
const mockGenerateDirections = generateDirections as jest.Mock;

const SEASON_ID = 'aaaa1111-bbbb-cccc-dddd-eeee11111111';
const SLOT_ID = 'ffff2222-3333-4444-5555-666677778888';
const DIRECTION_ID = 'dddd3333-4444-5555-6666-777788889999';
const BRIEF_ID = 'bbbb4444-5555-6666-7777-888899990000';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

beforeEach(() => {
  jest.clearAllMocks();

  // Restore default admin auth (success) after any test that overrides it
  mockRequireAdmin.mockResolvedValue(null);
  mockRequireAdminWithAuth.mockResolvedValue({
    isAdmin: true,
    userId: '660e8400-e29b-41d4-a716-446655440000',
    email: 'admin@test.com',
  });
});

// ===========================================================================
// POST /api/admin/co-director/analyze
// ===========================================================================

describe('POST /api/admin/co-director/analyze', () => {
  const url = '/api/admin/co-director/analyze';

  function makeRequest(body: Record<string, unknown> = { season_id: SEASON_ID }) {
    return createMockRequest(url, { method: 'POST', body });
  }

  test('returns 403 when user is not admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = makeRequest();
    const { status, body } = await parseResponse(await analyzePost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  test('returns 403 when feature flag is disabled', async () => {
    // 1st from('feature_flags') -> disabled
    const seq = createSequentialMock([
      { data: { enabled: false }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await analyzePost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('AI Co-Director is not enabled');
  });

  test('returns 404 when season is not found', async () => {
    const seq = createSequentialMock([
      // feature_flags -> enabled
      { data: { enabled: true }, error: null },
      // seasons -> not found
      { data: null, error: { message: 'not found' } },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await analyzePost(req));

    expect(status).toBe(404);
    expect(body.error).toBe('Season not found');
  });

  test('returns 400 when no winning clips to analyze', async () => {
    const seq = createSequentialMock([
      // feature_flags -> enabled
      { data: { enabled: true }, error: null },
      // seasons -> found
      { data: { id: SEASON_ID, label: 'Season 1', total_slots: 75 }, error: null },
      // story_slots -> empty (no winners)
      { data: [], error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await analyzePost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('No winning clips to analyze');
  });

  test('happy path: analyzes story and returns result', async () => {
    const storedAnalysis = {
      id: 'analysis-1',
      season_id: SEASON_ID,
      slot_position: 3,
      analysis: { characters: [], plot_threads: [], tone: 'dramatic' },
    };
    const seq = createSequentialMock([
      // feature_flags -> enabled
      { data: { enabled: true }, error: null },
      // seasons -> found
      { data: { id: SEASON_ID, label: 'Season 1', total_slots: 75 }, error: null },
      // story_slots -> winners
      { data: [
        { slot_position: 1, winner_tournament_clip_id: 'clip-1' },
        { slot_position: 2, winner_tournament_clip_id: 'clip-2' },
        { slot_position: 3, winner_tournament_clip_id: 'clip-3' },
      ], error: null },
      // tournament_clips -> clip details
      { data: [
        { id: 'clip-1', title: 'Clip 1', description: 'desc1', ai_prompt: 'prompt1', slot_position: 1 },
        { id: 'clip-2', title: 'Clip 2', description: 'desc2', ai_prompt: 'prompt2', slot_position: 2 },
        { id: 'clip-3', title: 'Clip 3', description: 'desc3', ai_prompt: 'prompt3', slot_position: 3 },
      ], error: null },
      // story_analyses -> upsert result
      { data: storedAnalysis, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await analyzePost(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.analysis).toEqual(storedAnalysis);
    expect(body.tokens).toBeDefined();
    expect(body.cost_cents).toBeDefined();
    expect(mockAnalyzeStory).toHaveBeenCalledTimes(1);
  });

  test('returns 500 when Claude analysis fails', async () => {
    mockAnalyzeStory.mockResolvedValueOnce({ ok: false, error: 'API error' });

    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      { data: { id: SEASON_ID, label: 'Season 1', total_slots: 75 }, error: null },
      { data: [{ slot_position: 1, winner_tournament_clip_id: 'clip-1' }], error: null },
      { data: [{ id: 'clip-1', title: 'Clip 1', description: 'd', ai_prompt: 'p', slot_position: 1 }], error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await analyzePost(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Story analysis failed');
  });
});

// ===========================================================================
// POST /api/admin/co-director/generate-brief
// ===========================================================================

describe('POST /api/admin/co-director/generate-brief', () => {
  const url = '/api/admin/co-director/generate-brief';

  function makeRequest(body: Record<string, unknown> = { season_id: SEASON_ID, slot_position: 5 }) {
    return createMockRequest(url, { method: 'POST', body });
  }

  test('returns 403 when user is not admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateBriefPost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  test('returns 404 when slot is not found', async () => {
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      { data: null, error: { message: 'not found' } },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateBriefPost(req));

    expect(status).toBe(404);
    expect(body.error).toBe('Slot not found');
  });

  test('returns 400 when no winning direction is set', async () => {
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      { data: { id: SLOT_ID, winning_direction_id: null, direction_voting_status: 'closed' }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateBriefPost(req));

    expect(status).toBe(400);
    expect(body.error).toContain('No winning direction');
  });

  test('happy path: generates brief and returns result', async () => {
    const storedBrief = {
      id: BRIEF_ID,
      season_id: SEASON_ID,
      slot_position: 5,
      brief_title: 'Test Brief',
      status: 'draft',
    };
    const seq = createSequentialMock([
      // feature_flags -> enabled
      { data: { enabled: true }, error: null },
      // story_slots -> found with winning direction
      { data: { id: SLOT_ID, winning_direction_id: DIRECTION_ID, direction_voting_status: 'closed' }, error: null },
      // direction_options -> winning direction
      { data: {
        id: DIRECTION_ID, option_number: 1, title: 'Go Dark',
        description: 'Darker tone', mood: 'tense', suggested_genre: 'thriller',
        visual_hints: 'shadows', narrative_hooks: 'cliffhanger',
      }, error: null },
      // story_analyses -> latest analysis
      { data: { analysis: { characters: [], plot_threads: [], tone: 'dramatic' } }, error: null },
      // slot_briefs -> previous briefs (for continuity)
      { data: [], error: null },
      // slot_briefs -> upsert result
      { data: storedBrief, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateBriefPost(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.brief).toEqual(storedBrief);
    expect(body.tokens).toBeDefined();
    expect(mockWriteBrief).toHaveBeenCalledTimes(1);
  });

  test('returns 500 when Claude brief generation fails', async () => {
    mockWriteBrief.mockResolvedValueOnce({ ok: false, error: 'brief gen error' });

    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      { data: { id: SLOT_ID, winning_direction_id: DIRECTION_ID, direction_voting_status: 'closed' }, error: null },
      { data: { id: DIRECTION_ID, option_number: 1, title: 'T', description: 'D', mood: '', suggested_genre: '', visual_hints: '', narrative_hooks: '' }, error: null },
      { data: { analysis: { characters: [] } }, error: null },
      { data: [], error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateBriefPost(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Brief generation failed');
  });
});

// ===========================================================================
// POST /api/admin/co-director/generate-directions
// ===========================================================================

describe('POST /api/admin/co-director/generate-directions', () => {
  const url = '/api/admin/co-director/generate-directions';

  function makeRequest(body: Record<string, unknown> = { season_id: SEASON_ID, slot_position: 5 }) {
    return createMockRequest(url, { method: 'POST', body });
  }

  test('returns 403 when user is not admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateDirectionsPost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  test('returns 400 when no story analysis exists', async () => {
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      // story_analyses -> none found (maybeSingle returns null)
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateDirectionsPost(req));

    expect(status).toBe(400);
    expect(body.error).toContain('No story analysis found');
  });

  test('returns 400 when voting is already open for the slot', async () => {
    const seq = createSequentialMock([
      // feature_flags -> enabled
      { data: { enabled: true }, error: null },
      // story_analyses -> found
      { data: { id: 'a-1', analysis: { characters: [] }, slot_position: 3 }, error: null },
      // seasons -> total_slots
      { data: { total_slots: 75 }, error: null },
      // feature_flags config -> max_directions
      { data: { config: { max_directions: 3 } }, error: null },
      // story_slots -> direction_voting_status = open
      { data: { direction_voting_status: 'open' }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateDirectionsPost(req));

    expect(status).toBe(400);
    expect(body.error).toContain('Cannot regenerate directions while voting is open');
  });

  test('happy path: generates directions and returns result', async () => {
    const storedDirections = [
      { id: 'd-1', option_number: 1, title: 'Direction A', vote_count: 0 },
      { id: 'd-2', option_number: 2, title: 'Direction B', vote_count: 0 },
    ];
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      // story_analyses -> latest
      { data: { id: 'a-1', analysis: { characters: [] }, slot_position: 3 }, error: null },
      // seasons -> total_slots
      { data: { total_slots: 75 }, error: null },
      // feature_flags config
      { data: { config: { max_directions: 3 } }, error: null },
      // story_slots -> voting not open
      { data: { direction_voting_status: 'closed' }, error: null },
      // direction_options -> existing (empty, no old to delete)
      { data: [], error: null },
      // direction_options -> insert
      { data: storedDirections, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateDirectionsPost(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.directions).toEqual(storedDirections);
    expect(body.tokens).toBeDefined();
    expect(mockGenerateDirections).toHaveBeenCalledTimes(1);
  });

  test('returns 500 when Claude direction generation fails', async () => {
    mockGenerateDirections.mockResolvedValueOnce({ ok: false, error: 'direction gen error' });

    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      { data: { id: 'a-1', analysis: { characters: [] }, slot_position: 3 }, error: null },
      { data: { total_slots: 75 }, error: null },
      { data: { config: { max_directions: 3 } }, error: null },
      { data: { direction_voting_status: 'closed' }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await generateDirectionsPost(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Direction generation failed');
  });
});

// ===========================================================================
// POST /api/admin/co-director/open-direction-vote
// ===========================================================================

describe('POST /api/admin/co-director/open-direction-vote', () => {
  const url = '/api/admin/co-director/open-direction-vote';

  function makeRequest(body: Record<string, unknown> = { season_id: SEASON_ID, slot_position: 5, duration_hours: 24 }) {
    return createMockRequest(url, { method: 'POST', body });
  }

  test('returns 403 when user is not admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = makeRequest();
    const { status, body } = await parseResponse(await openDirectionVotePost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  test('returns 400 when no direction options exist for the slot', async () => {
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      // direction_options -> none found
      { data: [], error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await openDirectionVotePost(req));

    expect(status).toBe(400);
    expect(body.error).toContain('No direction options found');
  });

  test('returns 400 when voting is already open', async () => {
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      // direction_options -> exist
      { data: [{ id: 'd-1' }, { id: 'd-2' }], error: null },
      // story_slots -> voting already open
      { data: { id: SLOT_ID, direction_voting_status: 'open' }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await openDirectionVotePost(req));

    expect(status).toBe(400);
    expect(body.error).toContain('already open');
  });

  test('happy path: opens voting and returns result', async () => {
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      // direction_options -> exist
      { data: [{ id: 'd-1' }, { id: 'd-2' }], error: null },
      // story_slots -> voting closed, can be opened
      { data: { id: SLOT_ID, direction_voting_status: 'closed' }, error: null },
      // story_slots -> update succeeds
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await openDirectionVotePost(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toBe('Direction voting opened');
    expect(body.ends_at).toBeDefined();
    expect(body.directions_count).toBe(2);
  });
});

// ===========================================================================
// POST /api/admin/co-director/close-direction-vote
// ===========================================================================

describe('POST /api/admin/co-director/close-direction-vote', () => {
  const url = '/api/admin/co-director/close-direction-vote';

  function makeRequest(body: Record<string, unknown> = { season_id: SEASON_ID, slot_position: 5 }) {
    return createMockRequest(url, { method: 'POST', body });
  }

  test('returns 403 when user is not admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = makeRequest();
    const { status, body } = await parseResponse(await closeDirectionVotePost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  test('returns 400 when voting is not open for this slot', async () => {
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      // story_slots -> voting is closed
      { data: { id: SLOT_ID, direction_voting_status: 'closed' }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await closeDirectionVotePost(req));

    expect(status).toBe(400);
    expect(body.error).toContain('not open');
  });

  test('returns 404 when slot is not found', async () => {
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      // story_slots -> not found
      { data: null, error: { message: 'not found' } },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await closeDirectionVotePost(req));

    expect(status).toBe(404);
    expect(body.error).toBe('Slot not found');
  });

  test('happy path: closes voting and returns winner', async () => {
    const directions = [
      { id: 'd-1', title: 'Direction A', description: 'Go left', vote_count: 10, created_at: '2026-01-01' },
      { id: 'd-2', title: 'Direction B', description: 'Go right', vote_count: 5, created_at: '2026-01-01' },
    ];
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      // story_slots -> voting is open
      { data: { id: SLOT_ID, direction_voting_status: 'open' }, error: null },
      // direction_options -> sorted by votes
      { data: directions, error: null },
      // story_slots -> update with winner
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await closeDirectionVotePost(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toBe('Direction voting closed');
    expect(body.winner.id).toBe('d-1');
    expect(body.winner.title).toBe('Direction A');
    expect(body.winner.vote_count).toBe(10);
    expect(body.total_votes).toBe(15);
    expect(body.all_results).toHaveLength(2);
  });
});

// ===========================================================================
// GET /api/admin/co-director/brief
// ===========================================================================

describe('GET /api/admin/co-director/brief', () => {
  const url = '/api/admin/co-director/brief';

  test('returns 403 when user is not admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = createMockRequest(url, { searchParams: { season_id: SEASON_ID } });
    const { status, body } = await parseResponse(await briefGet(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  test('returns 400 when season_id is missing', async () => {
    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await briefGet(req));

    expect(status).toBe(400);
    expect(body.error).toBe('season_id is required');
  });

  test('happy path: returns briefs for a season', async () => {
    const briefs = [
      { id: BRIEF_ID, season_id: SEASON_ID, slot_position: 5, brief_title: 'Brief 5', status: 'published' },
      { id: 'b-2', season_id: SEASON_ID, slot_position: 3, brief_title: 'Brief 3', status: 'draft' },
    ];
    const seq = createSequentialMock([
      { data: briefs, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url, { searchParams: { season_id: SEASON_ID } });
    const { status, body } = await parseResponse(await briefGet(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.briefs).toEqual(briefs);
    expect(body.briefs).toHaveLength(2);
  });
});

// ===========================================================================
// PUT /api/admin/co-director/brief
// ===========================================================================

describe('PUT /api/admin/co-director/brief', () => {
  const url = '/api/admin/co-director/brief';

  const briefPayload = {
    brief_id: BRIEF_ID,
    brief_title: 'Updated Brief',
    scene_description: 'An updated scene',
    visual_requirements: 'Bright lighting',
    tone_guidance: 'Upbeat',
    continuity_notes: null,
    do_list: ['Be cheerful'],
    dont_list: ['No sadness'],
    example_prompts: ['A sunny beach scene'],
  };

  function makeRequest(body: Record<string, unknown> = briefPayload) {
    return createMockRequest(url, { method: 'PUT', body });
  }

  test('returns 403 when user is not admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = makeRequest();
    const { status, body } = await parseResponse(await briefPut(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  test('returns 404 when brief does not exist', async () => {
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
      // slot_briefs -> not found
      { data: null, error: { message: 'not found' } },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest();
    const { status, body } = await parseResponse(await briefPut(req));

    expect(status).toBe(404);
    expect(body.error).toBe('Brief not found');
  });

  test('happy path: updates and publishes a brief', async () => {
    const existingBrief = { id: BRIEF_ID, season_id: SEASON_ID, slot_position: 5, status: 'draft' };
    const updatedBrief = { ...existingBrief, ...briefPayload, status: 'published' };

    const seq = createSequentialMock([
      // feature_flags -> enabled
      { data: { enabled: true }, error: null },
      // slot_briefs -> existing brief found
      { data: existingBrief, error: null },
      // story_slots -> update brief_id (publish side-effect)
      { data: null, error: null },
      // slot_briefs -> update result
      { data: updatedBrief, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = makeRequest({ ...briefPayload, publish: true });
    const { status, body } = await parseResponse(await briefPut(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.published).toBe(true);
    expect(body.brief).toEqual(updatedBrief);
  });
});

// ===========================================================================
// GET /api/admin/co-director/analyses
// ===========================================================================

describe('GET /api/admin/co-director/analyses', () => {
  const url = '/api/admin/co-director/analyses';

  test('returns 403 when user is not admin', async () => {
    mockAdminAuthFail(mockRequireAdmin);

    const req = createMockRequest(url, { searchParams: { season_id: SEASON_ID } });
    const { status } = await parseResponse(await analysesGet(req));

    // requireAdmin returns the 403 NextResponse directly
    expect(status).toBe(403);
  });

  test('returns 400 when season_id is missing', async () => {
    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await analysesGet(req));

    expect(status).toBe(400);
    expect(body.error).toBe('season_id is required');
  });

  test('happy path: returns analyses with enriched user info', async () => {
    const adminUserId = '660e8400-e29b-41d4-a716-446655440000';
    const analyses = [
      { id: 'a-1', season_id: SEASON_ID, slot_position: 5, analysis: {}, triggered_by: adminUserId, cost_cents: 1, created_at: '2026-01-01' },
      { id: 'a-2', season_id: SEASON_ID, slot_position: 3, analysis: {}, triggered_by: adminUserId, cost_cents: 2, created_at: '2026-01-02' },
    ];
    const users = [
      { id: adminUserId, username: 'admin_user', email: 'admin@test.com' },
    ];
    const seq = createSequentialMock([
      // story_analyses -> list
      { data: analyses, error: null },
      // users -> triggered_by enrichment
      { data: users, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url, { searchParams: { season_id: SEASON_ID } });
    const { status, body } = await parseResponse(await analysesGet(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.analyses).toHaveLength(2);
    expect(body.analyses[0].triggered_by_name).toBe('admin_user');
    expect(body.analyses[1].triggered_by_name).toBe('admin_user');
  });

  test('returns 500 when database query fails', async () => {
    const seq = createSequentialMock([
      // story_analyses -> database error
      { data: null, error: { message: 'db error' } },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest(url, { searchParams: { season_id: SEASON_ID } });
    const { status, body } = await parseResponse(await analysesGet(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch analyses');
  });
});
