/**
 * @jest-environment node
 */

/**
 * Co-Director API Routes Tests
 *
 * Covers:
 *   GET  /api/co-director/brief           - creative brief for current slot
 *   GET  /api/co-director/directions       - direction options for voting
 *   POST /api/co-director/direction-vote   - cast a direction vote
 *   GET  /api/co-director/direction-vote   - get user's current vote
 *   GET  /api/co-director/vote/status      - user vote status across open slots
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
jest.mock('@/lib/device-fingerprint', () => ({
  generateDeviceKey: jest.fn().mockReturnValue('device_test-fingerprint-key'),
}));
jest.mock('@/lib/validations', () => {
  const original = jest.requireActual('@/lib/validations');
  return {
    ...original,
    parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
    DirectionVoteSchema: {},
  };
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { requireCsrf } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validations';
import {
  createMockRequest,
  createSequentialMock,
  parseResponse,
  mockSession,
  TEST_USER,
} from '../helpers/api-test-utils';

import { GET as briefGET } from '@/app/api/co-director/brief/route';
import { GET as directionsGET } from '@/app/api/co-director/directions/route';
import {
  GET as directionVoteGET,
  POST as directionVotePOST,
} from '@/app/api/co-director/direction-vote/route';
import { GET as voteStatusGET } from '@/app/api/co-director/vote/status/route';

const mockCreateClient = createClient as jest.Mock;
const mockGetSession = getServerSession as jest.Mock;
const mockRequireCsrf = requireCsrf as jest.Mock;
const mockRateLimit = rateLimit as jest.Mock;
const mockParseBody = parseBody as jest.Mock;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

afterEach(() => {
  jest.clearAllMocks();
  mockRateLimit.mockResolvedValue(null);
  mockRequireCsrf.mockReturnValue(null);
  mockParseBody.mockImplementation((_schema: unknown, body: unknown) => ({
    success: true,
    data: body,
  }));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEASON_ID = 'aaaa0000-0000-0000-0000-000000000001';
const SLOT_POSITION = 3;
const DIRECTION_ID = 'dddd0000-0000-0000-0000-000000000001';
const VOTE_ID = 'vvvv0000-0000-0000-0000-000000000001';

/**
 * Build a sequential Supabase mock and wire it into createClient.
 * Each entry in `responses` corresponds to one .from() call in order.
 */
function setupSequentialMock(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  const seq = createSequentialMock(responses);
  mockCreateClient.mockReturnValue({ from: seq.from, rpc: jest.fn() });
  return seq;
}

// ===========================================================================
// GET /api/co-director/brief
// ===========================================================================

describe('GET /api/co-director/brief', () => {
  const makeRequest = (params: Record<string, string> = {}) =>
    createMockRequest('/api/co-director/brief', { searchParams: params });

  it('returns 404 when feature flag is disabled', async () => {
    // 1st from() -> feature_flags: disabled
    setupSequentialMock([{ data: { enabled: false } }]);

    const res = await briefGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('returns has_brief=false when no active season', async () => {
    setupSequentialMock([
      // feature_flags -> enabled
      { data: { enabled: true } },
      // seasons -> none
      { data: null },
    ]);

    const res = await briefGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_brief).toBe(false);
    expect(body.message).toBe('No active season');
  });

  it('returns has_brief=false when no active slot accepting submissions', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID, label: 'Season 1' } },
      // story_slots -> none accepting submissions
      { data: null },
    ]);

    const res = await briefGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_brief).toBe(false);
    expect(body.message).toBe('No active slot accepting submissions');
  });

  it('returns has_brief=false when no published brief for current slot', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID, label: 'Season 1' } },
      { data: { slot_position: SLOT_POSITION, brief_id: null, status: 'voting' } },
      // slot_briefs -> none published
      { data: null, error: null },
    ]);

    const res = await briefGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_brief).toBe(false);
    expect(body.season_id).toBe(SEASON_ID);
    expect(body.slot_position).toBe(SLOT_POSITION);
  });

  it('returns the published brief when one exists', async () => {
    const briefData = {
      id: 'brief-001',
      brief_title: 'The Chase Begins',
      scene_description: 'A tense chase through city streets.',
      visual_requirements: 'Dark lighting, rain.',
      tone_guidance: 'Suspenseful, anxious.',
      continuity_notes: 'Character wears a red jacket.',
      do_list: ['Include rain', 'Show urgency'],
      dont_list: ['No daylight scenes'],
      example_prompts: ['A person running through rain-soaked streets'],
      published_at: '2026-01-15T12:00:00Z',
    };

    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID, label: 'Season 1' } },
      { data: { slot_position: SLOT_POSITION, brief_id: 'brief-001', status: 'voting' } },
      { data: briefData, error: null },
    ]);

    const res = await briefGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_brief).toBe(true);
    expect(body.season_id).toBe(SEASON_ID);
    expect(body.brief.title).toBe('The Chase Begins');
    expect(body.brief.scene_description).toBe('A tense chase through city streets.');
    expect(body.brief.example_prompts).toHaveLength(1);
  });

  it('returns 500 when brief query errors', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID, label: 'Season 1' } },
      { data: { slot_position: SLOT_POSITION, brief_id: null, status: 'voting' } },
      { data: null, error: { message: 'DB error' } },
    ]);

    const res = await briefGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch brief');
  });
});

// ===========================================================================
// GET /api/co-director/directions
// ===========================================================================

describe('GET /api/co-director/directions', () => {
  const makeRequest = (params: Record<string, string> = {}) =>
    createMockRequest('/api/co-director/directions', { searchParams: params });

  it('returns 404 when feature flag is disabled', async () => {
    setupSequentialMock([{ data: { enabled: false } }]);

    const res = await directionsGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('returns 404 when no active season and no season_id provided', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      // seasons -> none
      { data: null },
    ]);

    const res = await directionsGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('No active season');
  });

  it('returns voting_open=false when no open direction voting slot', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID } },
      // story_slots -> no open voting
      { data: null },
    ]);

    const res = await directionsGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.voting_open).toBe(false);
    expect(body.directions).toEqual([]);
  });

  it('returns direction options when voting is open', async () => {
    const directions = [
      { id: 'dir-1', title: 'Dark Path', description: 'Go dark', mood: 'tense', suggested_genre: 'thriller', visual_hints: 'shadows', vote_count: 10 },
      { id: 'dir-2', title: 'Light Path', description: 'Go light', mood: 'uplifting', suggested_genre: 'drama', visual_hints: 'sunlight', vote_count: 5 },
    ];

    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID } },
      { data: { slot_position: SLOT_POSITION } },
      // slot info
      { data: { direction_voting_status: 'open', direction_voting_ends_at: '2026-02-20T12:00:00Z' } },
      // direction_options
      { data: directions, error: null },
    ]);

    const res = await directionsGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.voting_open).toBe(true);
    expect(body.directions).toHaveLength(2);
    expect(body.total_votes).toBe(15);
    expect(body.voting_ends_at).toBe('2026-02-20T12:00:00Z');
  });

  it('returns 500 when direction_options query fails', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID } },
      { data: { slot_position: SLOT_POSITION } },
      { data: { direction_voting_status: 'open', direction_voting_ends_at: null } },
      // direction_options -> error
      { data: null, error: { message: 'DB error' } },
    ]);

    const res = await directionsGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch directions');
  });
});

// ===========================================================================
// POST /api/co-director/direction-vote
// ===========================================================================

describe('POST /api/co-director/direction-vote', () => {
  const makeVoteRequest = (body: Record<string, unknown> = {}) =>
    createMockRequest('/api/co-director/direction-vote', {
      method: 'POST',
      body: { direction_option_id: DIRECTION_ID, ...body },
      headers: { 'x-csrf-token': 'valid-token' },
    });

  it('returns CSRF error when CSRF check fails', async () => {
    const { NextResponse } = require('next/server');
    const csrfResponse = NextResponse.json({ error: 'CSRF token invalid' }, { status: 403 });
    mockRequireCsrf.mockReturnValue(csrfResponse);

    const res = await directionVotePOST(makeVoteRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toBe('CSRF token invalid');
  });

  it('returns 404 when feature flag is disabled', async () => {
    setupSequentialMock([{ data: { enabled: false } }]);

    const res = await directionVotePOST(makeVoteRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('returns 400 when body validation fails', async () => {
    setupSequentialMock([{ data: { enabled: true } }]);
    mockParseBody.mockReturnValue({ success: false, error: 'Invalid direction option ID' });

    const res = await directionVotePOST(makeVoteRequest({ direction_option_id: 'not-a-uuid' }));
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid direction option ID');
  });

  it('returns 404 when direction option does not exist', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      // direction_options -> not found
      { data: null, error: { message: 'not found' } },
    ]);

    const res = await directionVotePOST(makeVoteRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Direction option not found');
  });

  it('returns 400 when direction voting is not open', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      // direction_options -> found
      { data: { id: DIRECTION_ID, season_id: SEASON_ID, slot_position: SLOT_POSITION, title: 'Dark Path' } },
      // story_slots -> voting closed
      { data: { direction_voting_status: 'closed', direction_voting_ends_at: null } },
    ]);

    const res = await directionVotePOST(makeVoteRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Direction voting is not open for this slot');
  });

  it('returns 400 when direction voting period has expired', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago

    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: DIRECTION_ID, season_id: SEASON_ID, slot_position: SLOT_POSITION, title: 'Dark Path' } },
      { data: { direction_voting_status: 'open', direction_voting_ends_at: pastDate } },
    ]);

    const res = await directionVotePOST(makeVoteRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Direction voting has ended for this slot');
  });

  it('returns idempotent success when already voted for the same direction', async () => {
    // Session lookup returns no session (anonymous voter)
    mockGetSession.mockResolvedValue(null);

    setupSequentialMock([
      { data: { enabled: true } },
      // direction_options -> found
      { data: { id: DIRECTION_ID, season_id: SEASON_ID, slot_position: SLOT_POSITION, title: 'Dark Path' } },
      // story_slots -> open
      { data: { direction_voting_status: 'open', direction_voting_ends_at: '2026-12-31T23:59:59Z' } },
      // users lookup (session has no email, so this won't be called -- but getServerSession might still be invoked)
      // existingVote -> already voted for same option
      { data: { id: VOTE_ID, direction_option_id: DIRECTION_ID, user_id: null } },
    ]);

    const res = await directionVotePOST(makeVoteRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toBe('Already voted for this direction');
    expect(body.changed).toBe(false);
  });

  it('records a new vote successfully', async () => {
    mockGetSession.mockResolvedValue(null);

    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: DIRECTION_ID, season_id: SEASON_ID, slot_position: SLOT_POSITION, title: 'Dark Path' } },
      { data: { direction_voting_status: 'open', direction_voting_ends_at: '2026-12-31T23:59:59Z' } },
      // existingVote -> no previous vote
      { data: null },
      // insert -> success
      { data: { id: VOTE_ID }, error: null },
    ]);

    const res = await directionVotePOST(makeVoteRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toBe('Vote recorded');
    expect(body.voted_for).toBe(DIRECTION_ID);
    expect(body.changed).toBe(false);
  });

  it('returns 400 on unique constraint violation (race condition double vote)', async () => {
    mockGetSession.mockResolvedValue(null);

    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: DIRECTION_ID, season_id: SEASON_ID, slot_position: SLOT_POSITION, title: 'Dark Path' } },
      { data: { direction_voting_status: 'open', direction_voting_ends_at: '2026-12-31T23:59:59Z' } },
      // existingVote -> no previous vote
      { data: null },
      // insert -> unique constraint error (23505)
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    ]);

    const res = await directionVotePOST(makeVoteRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('You have already voted for this slot');
  });

  it('returns rate limit response when rate-limited', async () => {
    const { NextResponse } = require('next/server');
    mockRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );

    const res = await directionVotePOST(makeVoteRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(429);
    expect(body.error).toBe('Too many requests');
  });
});

// ===========================================================================
// GET /api/co-director/direction-vote
// ===========================================================================

describe('GET /api/co-director/direction-vote', () => {
  const makeRequest = (params: Record<string, string> = {}) =>
    createMockRequest('/api/co-director/direction-vote', { searchParams: params });

  it('returns 404 when feature flag is disabled', async () => {
    setupSequentialMock([{ data: { enabled: false } }]);

    const res = await directionVoteGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('returns has_voted=false when no open voting slot', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      // seasons -> active
      { data: { id: SEASON_ID } },
      // story_slots -> none open
      { data: null },
    ]);

    const res = await directionVoteGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_voted).toBe(false);
    expect(body.message).toBe('No direction voting currently open');
  });

  it('returns vote info when user has voted', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID } },
      { data: { slot_position: SLOT_POSITION } },
      // direction_votes -> found
      { data: { id: VOTE_ID, direction_option_id: DIRECTION_ID } },
    ]);

    const res = await directionVoteGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_voted).toBe(true);
    expect(body.voted_for).toBe(DIRECTION_ID);
    expect(body.season_id).toBe(SEASON_ID);
    expect(body.slot_position).toBe(SLOT_POSITION);
  });

  it('returns has_voted=false when user has not voted', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID } },
      { data: { slot_position: SLOT_POSITION } },
      // direction_votes -> none
      { data: null },
    ]);

    const res = await directionVoteGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_voted).toBe(false);
    expect(body.voted_for).toBeNull();
  });
});

// ===========================================================================
// GET /api/co-director/vote/status
// ===========================================================================

describe('GET /api/co-director/vote/status', () => {
  const makeRequest = (params: Record<string, string> = {}) =>
    createMockRequest('/api/co-director/vote/status', { searchParams: params });

  it('returns 404 when feature flag is disabled', async () => {
    setupSequentialMock([{ data: { enabled: false } }]);

    const res = await voteStatusGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Not found');
  });

  it('returns has_active_voting=false when no active season', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      // seasons -> none
      { data: null },
    ]);

    const res = await voteStatusGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_active_voting).toBe(false);
    expect(body.votes).toEqual([]);
  });

  it('returns has_active_voting=false when no open voting slots', async () => {
    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID } },
      // story_slots -> none with open direction_voting_status
      { data: null },
    ]);

    const res = await voteStatusGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_active_voting).toBe(false);
    expect(body.votes).toEqual([]);
  });

  it('returns vote status per slot when voting is active and user has voted', async () => {
    const openSlots = [
      { slot_position: 3, direction_voting_status: 'open', direction_voting_ends_at: '2026-02-20T12:00:00Z' },
      { slot_position: 4, direction_voting_status: 'open', direction_voting_ends_at: '2026-02-21T12:00:00Z' },
    ];

    const votes = [
      { slot_position: 3, direction_option_id: DIRECTION_ID },
    ];

    setupSequentialMock([
      { data: { enabled: true } },
      { data: { id: SEASON_ID } },
      // story_slots -> open slots (this resolves via .then since no .single()/.maybeSingle())
      { data: openSlots },
      // direction_votes -> user's votes
      { data: votes },
    ]);

    const res = await voteStatusGET(makeRequest());
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.has_active_voting).toBe(true);
    expect(body.season_id).toBe(SEASON_ID);
    expect(body.slots).toHaveLength(2);
    // Slot 3: user voted
    expect(body.slots[0].slot_position).toBe(3);
    expect(body.slots[0].has_voted).toBe(true);
    expect(body.slots[0].voted_for).toBe(DIRECTION_ID);
    // Slot 4: user did not vote
    expect(body.slots[1].slot_position).toBe(4);
    expect(body.slots[1].has_voted).toBe(false);
    expect(body.slots[1].voted_for).toBeNull();
  });
});
