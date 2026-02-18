/**
 * @jest-environment node
 */

/**
 * Character Reference Suggestion Tests
 *
 * Covers three route files:
 *  1. /api/story/pinned-characters/[id]/suggest  (GET, POST)
 *  2. /api/story/pinned-characters/suggestions    (GET)
 *  3. /api/admin/pinned-characters/suggestions    (GET, POST, DELETE)
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
  requireAdminWithAuth: jest.fn(),
}));
jest.mock('@/lib/validations', () => ({
  parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
  SuggestClipFrameSchema: {},
  ReviewSuggestionSchema: {},
}));
jest.mock('@/lib/storage', () => ({
  getStorageProvider: jest.fn().mockResolvedValue('mock-provider'),
  deleteFiles: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/storage/frame-upload', () => ({
  extractFrameAtTimestamp: jest.fn().mockResolvedValue(Buffer.from('fake-image')),
  uploadPinnedFrame: jest.fn().mockResolvedValue({
    url: 'https://example.com/frame.png',
    key: 'frames/test.png',
  }),
}));
jest.mock('@/lib/audit-log', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { deleteFiles } from '@/lib/storage';
import { uploadPinnedFrame } from '@/lib/storage/frame-upload';
import { logAdminAction } from '@/lib/audit-log';
import {
  createSupabaseChain,
  createMockRequest,
  mockSession,
  parseResponse,
  mockAdminAuth,
  mockAdminAuthFail,
  TEST_USER,
  TEST_ADMIN,
} from '../helpers/api-test-utils';

// Route handlers
import {
  GET as suggestGet,
  POST as suggestPost,
} from '@/app/api/story/pinned-characters/[id]/suggest/route';
import { GET as userSuggestionsGet } from '@/app/api/story/pinned-characters/suggestions/route';
import {
  GET as adminSuggestionsGet,
  POST as adminSuggestionsPost,
  DELETE as adminSuggestionsDelete,
} from '@/app/api/admin/pinned-characters/suggestions/route';

const mockGetSession = getServerSession as jest.Mock;
const mockCreateClient = createClient as jest.Mock;
const mockRequireAdminWithAuth = requireAdminWithAuth as jest.Mock;

// ---------------------------------------------------------------------------
// Helper: sequential mock for routes that call .from() many times
// ---------------------------------------------------------------------------

function createSequentialMock(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>,
  extras?: { rpc?: jest.Mock }
) {
  let callIndex = 0;
  const fromCalls: string[] = [];
  const chains = responses.map(r => createSupabaseChain(r));

  const from = jest.fn((table: string) => {
    fromCalls.push(table);
    const idx = callIndex++;
    return chains[Math.min(idx, chains.length - 1)];
  });

  return { from, fromCalls, chains, rpc: extras?.rpc || jest.fn() };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHAR_UUID = '11111111-1111-1111-1111-111111111111';
const CLIP_UUID = '22222222-2222-2222-2222-222222222222';
const SEASON_UUID = '33333333-3333-3333-3333-333333333333';
const SUGGESTION_UUID = '44444444-4444-4444-4444-444444444444';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ===========================================================================
// 1. User suggest route — GET /api/story/pinned-characters/[id]/suggest
// ===========================================================================

describe('GET /api/story/pinned-characters/[id]/suggest', () => {
  it('returns suggestions for the character belonging to current user', async () => {
    mockSession(mockGetSession, TEST_USER);

    const suggestions = [
      { id: 'sug-1', status: 'pending', image_url: 'https://example.com/1.png', created_at: '2026-01-01T00:00:00Z', admin_notes: null },
      { id: 'sug-2', status: 'approved', image_url: 'https://example.com/2.png', created_at: '2026-01-02T00:00:00Z', admin_notes: null },
    ];

    const seq = createSequentialMock([
      // 0: users -> lookup by email
      { data: { id: TEST_USER.userId } },
      // 1: character_reference_suggestions -> daily count
      { data: null, count: 1 },
      // 2: character_reference_suggestions -> user's suggestions for this character
      { data: suggestions },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest');
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestGet(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.suggestions).toEqual(suggestions);
    expect(body.remaining).toBe(2); // 3 - 1 = 2
  });

  it('returns remaining daily count of 3 when user has no suggestions today', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: users -> lookup
      { data: { id: TEST_USER.userId } },
      // 1: character_reference_suggestions -> daily count = 0
      { data: null, count: 0 },
      // 2: character_reference_suggestions -> empty list
      { data: [] },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest');
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestGet(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.remaining).toBe(3);
    expect(body.suggestions).toEqual([]);
  });

  it('returns 401 when unauthenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest');
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestGet(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 404 when user not found in DB', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: users -> not found
      { data: null },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest');
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestGet(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('User not found');
  });
});

// ===========================================================================
// 2. User suggest route — POST /api/story/pinned-characters/[id]/suggest
// ===========================================================================

describe('POST /api/story/pinned-characters/[id]/suggest', () => {
  it('returns 401 when unauthenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      body: { source_clip_id: CLIP_UUID, frame_timestamp: 2.5 },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 403 when feature flag is disabled', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: feature_flags -> both flags, but character_reference_suggestions disabled
      {
        data: [
          { key: 'character_pinning', enabled: true },
          { key: 'character_reference_suggestions', enabled: false },
        ],
      },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      body: { source_clip_id: CLIP_UUID, frame_timestamp: 2.5 },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toBe('Feature not enabled');
  });

  it('returns 403 when character_pinning flag is disabled', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: feature_flags -> character_pinning disabled
      {
        data: [
          { key: 'character_pinning', enabled: false },
          { key: 'character_reference_suggestions', enabled: true },
        ],
      },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      body: { source_clip_id: CLIP_UUID, frame_timestamp: 2.5 },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toBe('Feature not enabled');
  });

  it('returns 429 when daily limit reached', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: feature_flags
      {
        data: [
          { key: 'character_pinning', enabled: true },
          { key: 'character_reference_suggestions', enabled: true },
        ],
      },
      // 1: users -> lookup
      { data: { id: TEST_USER.userId } },
      // 2: character_reference_suggestions -> daily count = 3 (max)
      { data: null, count: 3 },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      body: { source_clip_id: CLIP_UUID, frame_timestamp: 2.5 },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(429);
    expect(body.error).toBe('Daily suggestion limit reached');
    expect(body.remaining).toBe(0);
  });

  it('returns 404 when pinned character not found', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: feature_flags
      {
        data: [
          { key: 'character_pinning', enabled: true },
          { key: 'character_reference_suggestions', enabled: true },
        ],
      },
      // 1: users
      { data: { id: TEST_USER.userId } },
      // 2: character_reference_suggestions -> daily count = 0
      { data: null, count: 0 },
      // 3: pinned_characters -> not found
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      body: { source_clip_id: CLIP_UUID, frame_timestamp: 2.5 },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Character not found');
  });

  it('returns 400 when character is not active', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: feature_flags
      {
        data: [
          { key: 'character_pinning', enabled: true },
          { key: 'character_reference_suggestions', enabled: true },
        ],
      },
      // 1: users
      { data: { id: TEST_USER.userId } },
      // 2: character_reference_suggestions -> daily count = 0
      { data: null, count: 0 },
      // 3: pinned_characters -> inactive
      {
        data: {
          id: CHAR_UUID,
          season_id: SEASON_UUID,
          element_index: 0,
          label: 'Hero',
          is_active: false,
          reference_image_urls: [],
        },
      },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      body: { source_clip_id: CLIP_UUID, frame_timestamp: 2.5 },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Character is not active');
  });

  it('returns 404 when clip not found', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: feature_flags
      {
        data: [
          { key: 'character_pinning', enabled: true },
          { key: 'character_reference_suggestions', enabled: true },
        ],
      },
      // 1: users
      { data: { id: TEST_USER.userId } },
      // 2: character_reference_suggestions -> daily count = 0
      { data: null, count: 0 },
      // 3: pinned_characters -> found, active
      {
        data: {
          id: CHAR_UUID,
          season_id: SEASON_UUID,
          element_index: 0,
          label: 'Hero',
          is_active: true,
          reference_image_urls: [],
        },
      },
      // 4: tournament_clips -> not found
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      body: { source_clip_id: CLIP_UUID, frame_timestamp: 2.5 },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Clip not found');
  });

  it('returns 400 when clip is not a winner or locked clip', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: feature_flags
      {
        data: [
          { key: 'character_pinning', enabled: true },
          { key: 'character_reference_suggestions', enabled: true },
        ],
      },
      // 1: users
      { data: { id: TEST_USER.userId } },
      // 2: character_reference_suggestions -> daily count = 0
      { data: null, count: 0 },
      // 3: pinned_characters -> active
      {
        data: {
          id: CHAR_UUID,
          season_id: SEASON_UUID,
          element_index: 0,
          label: 'Hero',
          is_active: true,
          reference_image_urls: [],
        },
      },
      // 4: tournament_clips -> status 'pending' (not winner/locked)
      {
        data: {
          id: CLIP_UUID,
          video_url: 'https://example.com/video.mp4',
          last_frame_url: 'https://example.com/frame.png',
          status: 'pending',
        },
      },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      body: { source_clip_id: CLIP_UUID, frame_timestamp: 2.5 },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Can only suggest frames from winner clips');
  });

  it('creates suggestion successfully with frame_timestamp (happy path)', async () => {
    mockSession(mockGetSession, TEST_USER);

    const mockUploadPinnedFrame = uploadPinnedFrame as jest.Mock;
    mockUploadPinnedFrame.mockResolvedValue('https://example.com/uploaded-frame.jpg');

    const createdSuggestion = {
      id: SUGGESTION_UUID,
      status: 'pending',
      image_url: 'https://example.com/uploaded-frame.jpg',
      created_at: '2026-02-18T10:00:00Z',
    };

    const seq = createSequentialMock([
      // 0: feature_flags
      {
        data: [
          { key: 'character_pinning', enabled: true },
          { key: 'character_reference_suggestions', enabled: true },
        ],
      },
      // 1: users
      { data: { id: TEST_USER.userId } },
      // 2: character_reference_suggestions -> daily count = 1
      { data: null, count: 1 },
      // 3: pinned_characters -> active
      {
        data: {
          id: CHAR_UUID,
          season_id: SEASON_UUID,
          element_index: 2,
          label: 'Villain',
          is_active: true,
          reference_image_urls: ['https://example.com/ref1.png'],
        },
      },
      // 4: tournament_clips -> winner clip
      {
        data: {
          id: CLIP_UUID,
          video_url: 'https://example.com/video.mp4',
          last_frame_url: 'https://example.com/frame.png',
          status: 'winner',
        },
      },
      // 5: feature_flags -> r2_storage flag
      { data: { enabled: false } },
      // 6: character_reference_suggestions -> insert
      { data: createdSuggestion },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      body: { source_clip_id: CLIP_UUID, frame_timestamp: 2.5 },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.suggestion).toBeDefined();
    expect(body.suggestion.id).toBe(SUGGESTION_UUID);
    expect(body.remaining).toBe(1); // 3 - 1 - 1 = 1
  });

  it('creates suggestion using last_frame_url when no frame_timestamp provided', async () => {
    mockSession(mockGetSession, TEST_USER);

    const createdSuggestion = {
      id: SUGGESTION_UUID,
      status: 'pending',
      image_url: 'https://example.com/last-frame.png',
      created_at: '2026-02-18T10:00:00Z',
    };

    const seq = createSequentialMock([
      // 0: feature_flags
      {
        data: [
          { key: 'character_pinning', enabled: true },
          { key: 'character_reference_suggestions', enabled: true },
        ],
      },
      // 1: users
      { data: { id: TEST_USER.userId } },
      // 2: character_reference_suggestions -> daily count = 0
      { data: null, count: 0 },
      // 3: pinned_characters -> active
      {
        data: {
          id: CHAR_UUID,
          season_id: SEASON_UUID,
          element_index: 0,
          label: 'Hero',
          is_active: true,
          reference_image_urls: [],
        },
      },
      // 4: tournament_clips -> locked clip with last_frame_url
      {
        data: {
          id: CLIP_UUID,
          video_url: 'https://example.com/video.mp4',
          last_frame_url: 'https://example.com/last-frame.png',
          status: 'locked',
        },
      },
      // 5: character_reference_suggestions -> insert (no r2 flag lookup needed)
      { data: createdSuggestion },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/' + CHAR_UUID + '/suggest', {
      method: 'POST',
      // No frame_timestamp — should use last_frame_url
      body: { source_clip_id: CLIP_UUID },
    });
    const params = Promise.resolve({ id: CHAR_UUID });
    const res = await suggestPost(req, { params });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.remaining).toBe(2); // 3 - 0 - 1 = 2
  });
});

// ===========================================================================
// 3. User suggestions list — GET /api/story/pinned-characters/suggestions
// ===========================================================================

describe('GET /api/story/pinned-characters/suggestions', () => {
  it('returns all user suggestions across characters', async () => {
    mockSession(mockGetSession, TEST_USER);

    const suggestionsData = [
      {
        id: 'sug-1',
        status: 'pending',
        image_url: 'https://example.com/1.png',
        admin_notes: null,
        created_at: '2026-01-01T00:00:00Z',
        reviewed_at: null,
        pinned_character_id: CHAR_UUID,
        pinned_characters: {
          label: 'Hero',
          element_index: 0,
          frontal_image_url: 'https://example.com/frontal.png',
        },
      },
      {
        id: 'sug-2',
        status: 'rejected',
        image_url: 'https://example.com/2.png',
        admin_notes: 'Wrong character',
        created_at: '2026-01-02T00:00:00Z',
        reviewed_at: '2026-01-03T00:00:00Z',
        pinned_character_id: 'other-char-id',
        pinned_characters: {
          label: 'Sidekick',
          element_index: 1,
          frontal_image_url: 'https://example.com/frontal2.png',
        },
      },
    ];

    const seq = createSequentialMock([
      // 0: users -> lookup
      { data: { id: TEST_USER.userId } },
      // 1: character_reference_suggestions -> user's suggestions with joins
      { data: suggestionsData },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/suggestions');
    const res = await userSuggestionsGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.suggestions).toHaveLength(2);

    // First suggestion (pending) should not expose admin_notes
    expect(body.suggestions[0].id).toBe('sug-1');
    expect(body.suggestions[0].admin_notes).toBeNull();
    expect(body.suggestions[0].character.label).toBe('Hero');

    // Second suggestion (rejected) should expose admin_notes
    expect(body.suggestions[1].id).toBe('sug-2');
    expect(body.suggestions[1].admin_notes).toBe('Wrong character');
    expect(body.suggestions[1].character.label).toBe('Sidekick');
  });

  it('returns 401 when unauthenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/story/pinned-characters/suggestions');
    const res = await userSuggestionsGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 404 when user not found in DB', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: users -> not found
      { data: null },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/suggestions');
    const res = await userSuggestionsGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  it('returns empty array when user has no suggestions', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      // 0: users -> lookup
      { data: { id: TEST_USER.userId } },
      // 1: character_reference_suggestions -> empty
      { data: [] },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/story/pinned-characters/suggestions');
    const res = await userSuggestionsGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.suggestions).toEqual([]);
  });
});

// ===========================================================================
// 4. Admin suggestions — GET /api/admin/pinned-characters/suggestions
// ===========================================================================

describe('GET /api/admin/pinned-characters/suggestions', () => {
  it('returns 403 for non-admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions');
    const res = await adminSuggestionsGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  it('lists pending suggestions with character and user info', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const suggestionsData = [
      {
        id: SUGGESTION_UUID,
        status: 'pending',
        image_url: 'https://example.com/sug.png',
        source_clip_id: CLIP_UUID,
        frame_timestamp: 3.2,
        admin_notes: null,
        created_at: '2026-02-18T10:00:00Z',
        reviewed_at: null,
        pinned_character_id: CHAR_UUID,
        user_id: TEST_USER.userId,
        season_id: SEASON_UUID,
        pinned_characters: {
          label: 'Hero',
          element_index: 0,
          frontal_image_url: 'https://example.com/frontal.png',
          reference_image_urls: ['https://example.com/ref1.png', 'https://example.com/ref2.png'],
        },
        users: {
          username: 'testuser',
          avatar_url: 'https://example.com/avatar.png',
        },
      },
    ];

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> with joins
      { data: suggestionsData },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions');
    const res = await adminSuggestionsGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.suggestions).toHaveLength(1);

    const sug = body.suggestions[0];
    expect(sug.id).toBe(SUGGESTION_UUID);
    expect(sug.character.label).toBe('Hero');
    expect(sug.character.current_refs).toBe(2);
    expect(sug.user.username).toBe('testuser');
    expect(sug.source_clip_id).toBe(CLIP_UUID);
  });

  it('filters by character_id when provided', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const seq = createSequentialMock([
      { data: [] },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      searchParams: { character_id: CHAR_UUID },
    });
    const res = await adminSuggestionsGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    // Verify that eq was called with pinned_character_id filter
    const eqCalls = seq.chains[0]._calls.filter(c => c.method === 'eq');
    const charIdFilter = eqCalls.find(c =>
      c.args[0] === 'pinned_character_id' && c.args[1] === CHAR_UUID
    );
    expect(charIdFilter).toBeDefined();
  });

  it('filters by season_id when provided', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const seq = createSequentialMock([
      { data: [] },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      searchParams: { season_id: SEASON_UUID },
    });
    const res = await adminSuggestionsGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    // Verify that eq was called with season_id filter
    const eqCalls = seq.chains[0]._calls.filter(c => c.method === 'eq');
    const seasonFilter = eqCalls.find(c =>
      c.args[0] === 'season_id' && c.args[1] === SEASON_UUID
    );
    expect(seasonFilter).toBeDefined();
  });
});

// ===========================================================================
// 5. Admin suggestions — POST (approve) /api/admin/pinned-characters/suggestions
// ===========================================================================

describe('POST /api/admin/pinned-characters/suggestions (approve)', () => {
  it('returns 403 for non-admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'POST',
      body: { suggestion_id: SUGGESTION_UUID },
    });
    const res = await adminSuggestionsPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  it('returns 404 for nonexistent suggestion', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> not found
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'POST',
      body: { suggestion_id: 'nonexistent-id' },
    });
    const res = await adminSuggestionsPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Suggestion not found');
  });

  it('returns 400 for already-reviewed suggestion', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> already approved
      {
        data: {
          id: SUGGESTION_UUID,
          status: 'approved',
          pinned_character_id: CHAR_UUID,
          user_id: TEST_USER.userId,
          image_url: 'https://example.com/sug.png',
        },
      },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'POST',
      body: { suggestion_id: SUGGESTION_UUID },
    });
    const res = await adminSuggestionsPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Suggestion already reviewed');
  });

  it('approves suggestion and calls append_reference_angle RPC', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const rpcMock = jest.fn().mockResolvedValue({
      data: [{ id: CHAR_UUID, reference_image_urls: ['url1', 'url2', 'https://example.com/sug.png'] }],
      error: null,
    });

    const pendingSuggestion = {
      id: SUGGESTION_UUID,
      status: 'pending',
      pinned_character_id: CHAR_UUID,
      user_id: TEST_USER.userId,
      image_url: 'https://example.com/sug.png',
      season_id: SEASON_UUID,
    };

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> pending suggestion
      { data: pendingSuggestion },
      // 1: character_reference_suggestions -> update status to approved
      { data: null },
      // 2: notifications -> insert (non-blocking)
      { data: null },
    ], { rpc: rpcMock });

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'POST',
      body: { suggestion_id: SUGGESTION_UUID },
    });
    const res = await adminSuggestionsPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('approved');

    // Verify RPC was called with correct params
    expect(rpcMock).toHaveBeenCalledWith('append_reference_angle', {
      p_id: CHAR_UUID,
      p_url: 'https://example.com/sug.png',
      p_max_refs: 6,
    });

    // Verify audit log was called
    expect(logAdminAction).toHaveBeenCalled();
    const auditCall = (logAdminAction as jest.Mock).mock.calls[0];
    expect(auditCall[1].action).toBe('approve_reference_suggestion');
    expect(auditCall[1].resourceId).toBe(SUGGESTION_UUID);
  });

  it('returns 400 when character has 6 refs already (RPC returns empty)', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const rpcMock = jest.fn().mockResolvedValue({
      data: [], // empty = max refs reached
      error: null,
    });

    const pendingSuggestion = {
      id: SUGGESTION_UUID,
      status: 'pending',
      pinned_character_id: CHAR_UUID,
      user_id: TEST_USER.userId,
      image_url: 'https://example.com/sug.png',
      season_id: SEASON_UUID,
    };

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> pending suggestion
      { data: pendingSuggestion },
    ], { rpc: rpcMock });

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'POST',
      body: { suggestion_id: SUGGESTION_UUID },
    });
    const res = await adminSuggestionsPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('6 reference angles');
  });

  it('returns 500 when RPC returns an error', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const rpcMock = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });

    const pendingSuggestion = {
      id: SUGGESTION_UUID,
      status: 'pending',
      pinned_character_id: CHAR_UUID,
      user_id: TEST_USER.userId,
      image_url: 'https://example.com/sug.png',
      season_id: SEASON_UUID,
    };

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> pending suggestion
      { data: pendingSuggestion },
    ], { rpc: rpcMock });

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'POST',
      body: { suggestion_id: SUGGESTION_UUID },
    });
    const res = await adminSuggestionsPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to add reference angle');
  });
});

// ===========================================================================
// 6. Admin suggestions — DELETE (reject) /api/admin/pinned-characters/suggestions
// ===========================================================================

describe('DELETE /api/admin/pinned-characters/suggestions (reject)', () => {
  it('returns 403 for non-admin', async () => {
    mockAdminAuthFail(mockRequireAdminWithAuth);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'DELETE',
      body: { suggestion_id: SUGGESTION_UUID },
    });
    const res = await adminSuggestionsDelete(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });

  it('returns 404 for nonexistent suggestion', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> not found
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'DELETE',
      body: { suggestion_id: 'nonexistent-id' },
    });
    const res = await adminSuggestionsDelete(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toBe('Suggestion not found');
  });

  it('returns 400 for already-reviewed suggestion', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> already rejected
      {
        data: {
          id: SUGGESTION_UUID,
          status: 'rejected',
          pinned_character_id: CHAR_UUID,
          user_id: TEST_USER.userId,
          image_url: 'https://example.com/sug.png',
          storage_key: 'pinned/test/key.jpg',
        },
      },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'DELETE',
      body: { suggestion_id: SUGGESTION_UUID },
    });
    const res = await adminSuggestionsDelete(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Suggestion already reviewed');
  });

  it('rejects suggestion and cleans up storage when storage_key exists', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const mockDeleteFiles = deleteFiles as jest.Mock;
    mockDeleteFiles.mockResolvedValue(undefined);

    const pendingSuggestion = {
      id: SUGGESTION_UUID,
      status: 'pending',
      pinned_character_id: CHAR_UUID,
      user_id: TEST_USER.userId,
      image_url: 'https://example.com/sug.png',
      storage_key: 'pinned/season1/0_sug_abc123.jpg',
      season_id: SEASON_UUID,
    };

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> pending suggestion
      { data: pendingSuggestion },
      // 1: character_reference_suggestions -> update status to rejected
      { data: null },
      // 2: feature_flags -> r2_storage
      { data: { enabled: false } },
      // 3: notifications -> insert (non-blocking)
      { data: null },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'DELETE',
      body: { suggestion_id: SUGGESTION_UUID, admin_notes: 'Not the right angle' },
    });
    const res = await adminSuggestionsDelete(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('rejected');

    // Verify storage cleanup was called
    expect(mockDeleteFiles).toHaveBeenCalledWith(
      ['pinned/season1/0_sug_abc123.jpg'],
      'mock-provider'
    );

    // Verify audit log was called
    expect(logAdminAction).toHaveBeenCalled();
    const auditCall = (logAdminAction as jest.Mock).mock.calls[0];
    expect(auditCall[1].action).toBe('reject_reference_suggestion');
    expect(auditCall[1].details.admin_notes).toBe('Not the right angle');
  });

  it('rejects suggestion without storage cleanup when no storage_key', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const mockDeleteFiles = deleteFiles as jest.Mock;

    const pendingSuggestion = {
      id: SUGGESTION_UUID,
      status: 'pending',
      pinned_character_id: CHAR_UUID,
      user_id: TEST_USER.userId,
      image_url: 'https://example.com/last-frame.png',
      storage_key: null, // no storage key — used clip's last_frame_url
      season_id: SEASON_UUID,
    };

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> pending suggestion
      { data: pendingSuggestion },
      // 1: character_reference_suggestions -> update status to rejected
      { data: null },
      // 2: notifications -> insert (non-blocking)
      { data: null },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'DELETE',
      body: { suggestion_id: SUGGESTION_UUID },
    });
    const res = await adminSuggestionsDelete(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.status).toBe('rejected');

    // Storage cleanup should NOT have been called
    expect(mockDeleteFiles).not.toHaveBeenCalled();
  });

  it('returns 500 when update fails', async () => {
    mockAdminAuth(mockRequireAdminWithAuth);

    const pendingSuggestion = {
      id: SUGGESTION_UUID,
      status: 'pending',
      pinned_character_id: CHAR_UUID,
      user_id: TEST_USER.userId,
      image_url: 'https://example.com/sug.png',
      storage_key: null,
      season_id: SEASON_UUID,
    };

    const seq = createSequentialMock([
      // 0: character_reference_suggestions -> pending suggestion
      { data: pendingSuggestion },
      // 1: character_reference_suggestions -> update fails
      { data: null, error: { message: 'DB write error' } },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/admin/pinned-characters/suggestions', {
      method: 'DELETE',
      body: { suggestion_id: SUGGESTION_UUID },
    });
    const res = await adminSuggestionsDelete(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to reject suggestion');
  });
});
