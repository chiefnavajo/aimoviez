/**
 * @jest-environment node
 */

/**
 * Comments API Tests
 * Tests for GET, POST, and DELETE /api/comments
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
}));
jest.mock('@/lib/sanitize', () => ({
  sanitizeComment: jest.fn((v: string) => (v ? v.trim() : '')),
  sanitizeText: jest.fn((v: string) => (v ? v.trim() : '')),
}));
jest.mock('@/lib/utils', () => ({
  getAvatarUrl: jest.fn((_url: string | null, seed: string) => `https://avatar/${seed}`),
  generateAvatarUrl: jest.fn((seed: string) => `https://avatar/generated/${seed}`),
}));
jest.mock('@/lib/validations', () => {
  const original = jest.requireActual('@/lib/validations');
  return {
    ...original,
    parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
  };
});
jest.mock('@/lib/session-store', () => ({
  getSessionFast: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/realtime-broadcast', () => ({
  broadcastCommentEvent: jest.fn(),
}));
jest.mock('@/lib/comment-event-queue', () => ({
  pushCommentEvent: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { requireCsrf } from '@/lib/csrf';
import { parseBody } from '@/lib/validations';
import {
  createSupabaseChain,
  createMockRequest,
  mockSession,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

import { GET, POST, DELETE } from '@/app/api/comments/route';

const mockGetSession = getServerSession as jest.Mock;
const mockCreateClient = createClient as jest.Mock;
const mockRequireCsrf = requireCsrf as jest.Mock;
const mockParseBody = parseBody as jest.Mock;

// ---------------------------------------------------------------------------
// Helper: sequential mock for routes that call .from() many times
// ---------------------------------------------------------------------------

function createSequentialMock(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  let callIndex = 0;
  const fromCalls: string[] = [];

  const from = jest.fn((table: string) => {
    fromCalls.push(table);
    const idx = callIndex++;
    const response = responses[idx] || { data: null, error: null };
    return createSupabaseChain(response);
  });

  return { from, fromCalls };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLIP_ID = '11111111-1111-1111-1111-111111111111';
const COMMENT_ID = '22222222-2222-2222-2222-222222222222';
const USER_KEY = `user_${TEST_USER.userId}`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  mockRequireCsrf.mockResolvedValue(null);
  // Default: parseBody passes through
  mockParseBody.mockImplementation((_schema: unknown, body: unknown) => ({
    success: true,
    data: body,
  }));
});

// ===========================================================================
// GET /api/comments
// ===========================================================================

describe('GET /api/comments', () => {
  it('returns 400 when clipId is missing', async () => {
    const req = createMockRequest('/api/comments');

    const mock = createSequentialMock([]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('clipId is required');
  });

  it('returns comments for a given clip_id', async () => {
    mockSession(mockGetSession, TEST_USER);

    const sampleComment = {
      id: COMMENT_ID,
      clip_id: CLIP_ID,
      user_key: USER_KEY,
      username: 'Test User',
      avatar_url: null,
      comment_text: 'Great clip!',
      likes_count: 3,
      parent_comment_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      is_deleted: false,
    };

    // Sequential calls:
    // 0: feature_flags
    // 1: users (getUserInfo)
    // 2: comments (top-level query with count)
    // 3: comment_likes (user likes)
    // 4: comments (batch replies)
    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null }, // users
      { data: [sampleComment], error: null, count: 1 },       // comments
      { data: [], error: null },                               // comment_likes
      { data: [], error: null },                               // replies
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      searchParams: { clipId: CLIP_ID },
    });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].id).toBe(COMMENT_ID);
    expect(body.comments[0].comment_text).toBe('Great clip!');
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
  });

  it('handles pagination parameters', async () => {
    mockSession(mockGetSession, TEST_USER);

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: [], error: null, count: 50 },                    // comments (page 3)
      { data: [], error: null },                               // comment_likes
      { data: [], error: null },                               // replies
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      searchParams: { clipId: CLIP_ID, page: '3', limit: '10' },
    });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.page).toBe(3);
    expect(body.page_size).toBe(10);
    expect(body.has_more).toBe(true); // 50 total > offset(20) + limit(10)
  });

  it('returns countOnly when requested', async () => {
    const mock = createSequentialMock([
      { data: null, error: null, count: 42 },                  // comments count
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      searchParams: { clipId: CLIP_ID, countOnly: 'true' },
    });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.count).toBe(42);
    expect(body.comments).toBeUndefined();
  });

  it('returns 500 when the database query fails', async () => {
    mockSession(mockGetSession, TEST_USER);

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: null, error: { message: 'DB failure', code: 'XXXXX' } }, // comments fail
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      searchParams: { clipId: CLIP_ID },
    });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch comments');
  });

  it('marks comments as is_own when user_key matches', async () => {
    mockSession(mockGetSession, TEST_USER);

    const ownComment = {
      id: COMMENT_ID,
      clip_id: CLIP_ID,
      user_key: USER_KEY,
      username: 'Test User',
      avatar_url: null,
      comment_text: 'My own comment',
      likes_count: 0,
      parent_comment_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      is_deleted: false,
    };

    const mock = createSequentialMock([
      { data: [], error: null },
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: [ownComment], error: null, count: 1 },
      { data: [], error: null },
      { data: [], error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      searchParams: { clipId: CLIP_ID },
    });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.comments[0].is_own).toBe(true);
  });

  it('marks comments as is_liked when user has liked them', async () => {
    mockSession(mockGetSession, TEST_USER);

    const comment = {
      id: COMMENT_ID,
      clip_id: CLIP_ID,
      user_key: 'user_other',
      username: 'Other User',
      avatar_url: null,
      comment_text: 'A comment',
      likes_count: 5,
      parent_comment_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      is_deleted: false,
    };

    const mock = createSequentialMock([
      { data: [], error: null },
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: [comment], error: null, count: 1 },
      { data: [{ comment_id: COMMENT_ID }], error: null },    // user liked this comment
      { data: [], error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      searchParams: { clipId: CLIP_ID },
    });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.comments[0].is_liked).toBe(true);
  });

  it('returns replies for a parent comment via parentId param', async () => {
    mockSession(mockGetSession, TEST_USER);
    const parentId = '33333333-3333-3333-3333-333333333333';

    const reply = {
      id: COMMENT_ID,
      clip_id: CLIP_ID,
      user_key: 'user_other',
      username: 'Replier',
      avatar_url: null,
      comment_text: 'A reply',
      likes_count: 1,
      parent_comment_id: parentId,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: [reply], error: null, count: 1 },               // replies query
      { data: [], error: null },                               // comment_likes
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      searchParams: { clipId: CLIP_ID, parentId },
    });
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.replies).toHaveLength(1);
    expect(body.replies[0].parent_comment_id).toBe(parentId);
    expect(body.total).toBe(1);
  });
});

// ===========================================================================
// POST /api/comments
// ===========================================================================

describe('POST /api/comments', () => {
  it('returns 401 when user is not authenticated', async () => {
    mockSession(mockGetSession, null);

    // Sequential calls:
    // 0: feature_flags
    // 1: users (getUserInfo - no session, falls through)
    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'POST',
      body: { clipId: CLIP_ID, comment_text: 'Hello' },
    });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/[Aa]uthentication required/);
  });

  it('checks CSRF token', async () => {
    const csrfResponse = new Response(JSON.stringify({ error: 'CSRF token invalid' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
    mockRequireCsrf.mockResolvedValueOnce(csrfResponse);

    const req = createMockRequest('/api/comments', {
      method: 'POST',
      body: { clipId: CLIP_ID, comment_text: 'Test' },
    });
    const res = await POST(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(403);
    expect(mockRequireCsrf).toHaveBeenCalledWith(req);
  });

  it('creates a comment successfully (sync path)', async () => {
    mockSession(mockGetSession, TEST_USER);

    const insertedComment = {
      id: COMMENT_ID,
      clip_id: CLIP_ID,
      user_key: USER_KEY,
      username: 'Test User',
      avatar_url: `https://avatar/generated/${TEST_USER.userId}`,
      comment_text: 'This is a test comment',
      likes_count: 0,
      parent_comment_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    // Sequential calls:
    // 0: feature_flags (getCommentFeatureFlags)
    // 1: users (getUserInfo)
    // 2: users (ban check)
    // 3: comments (insert)
    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: { is_banned: false }, error: null },             // ban check
      { data: insertedComment, error: null },                  // comment insert
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'POST',
      body: { clipId: CLIP_ID, comment_text: 'This is a test comment' },
    });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.comment).toBeDefined();
    expect(body.comment.comment_text).toBe('This is a test comment');
    expect(body.comment.is_own).toBe(true);
    expect(body.comment.is_liked).toBe(false);
  });

  it('returns 400 when comment_text is empty', async () => {
    mockSession(mockGetSession, TEST_USER);

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: { is_banned: false }, error: null },             // ban check
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    // parseBody succeeds but sanitizeComment returns empty string for empty input
    const req = createMockRequest('/api/comments', {
      method: 'POST',
      body: { clipId: CLIP_ID, comment_text: '' },
    });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/[Cc]omment.*empty/);
  });

  it('returns 400 when validation fails', async () => {
    mockSession(mockGetSession, TEST_USER);

    // Override parseBody to simulate validation failure
    mockParseBody.mockReturnValueOnce({
      success: false,
      error: 'Comment text is required',
    });

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: { is_banned: false }, error: null },             // ban check
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'POST',
      body: { clipId: CLIP_ID },
    });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Comment text is required');
  });

  it('returns 403 when user is banned', async () => {
    mockSession(mockGetSession, TEST_USER);

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: { is_banned: true }, error: null },              // ban check - BANNED
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'POST',
      body: { clipId: CLIP_ID, comment_text: 'I am banned' },
    });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toMatch(/suspended/);
  });

  it('returns 500 when database insert fails', async () => {
    mockSession(mockGetSession, TEST_USER);

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: { is_banned: false }, error: null },             // ban check
      { data: null, error: { message: 'Insert failed' } },    // comment insert fails
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'POST',
      body: { clipId: CLIP_ID, comment_text: 'This will fail' },
    });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toMatch(/[Ff]ailed to create comment/);
  });

  it('creates a reply with parent_comment_id', async () => {
    mockSession(mockGetSession, TEST_USER);
    const parentId = '33333333-3333-3333-3333-333333333333';

    const insertedReply = {
      id: COMMENT_ID,
      clip_id: CLIP_ID,
      user_key: USER_KEY,
      username: 'Test User',
      avatar_url: null,
      comment_text: 'This is a reply',
      likes_count: 0,
      parent_comment_id: parentId,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    // Sequential calls:
    // 0: feature_flags
    // 1: users (getUserInfo)
    // 2: users (ban check)
    // 3: comments (nesting depth check - parent has no parent)
    // 4: comments (insert reply)
    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: { is_banned: false }, error: null },             // ban check
      { data: { parent_comment_id: null }, error: null },      // depth check (level 1)
      { data: insertedReply, error: null },                    // comment insert
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'POST',
      body: { clipId: CLIP_ID, comment_text: 'This is a reply', parent_comment_id: parentId },
    });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.comment.parent_comment_id).toBe(parentId);
  });

  it('returns 400 when reply nesting depth exceeds 5 levels', async () => {
    mockSession(mockGetSession, TEST_USER);
    const deepParentId = '44444444-4444-4444-4444-444444444444';

    // Simulate 6 levels of nesting by returning parent_comment_id for each depth query
    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: { is_banned: false }, error: null },             // ban check
      // Depth checks: each returns a parent, simulating deep nesting
      { data: { parent_comment_id: 'level-5' }, error: null },
      { data: { parent_comment_id: 'level-4' }, error: null },
      { data: { parent_comment_id: 'level-3' }, error: null },
      { data: { parent_comment_id: 'level-2' }, error: null },
      { data: { parent_comment_id: 'level-1' }, error: null },
      { data: { parent_comment_id: null }, error: null },      // root reached at depth 6
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'POST',
      body: { clipId: CLIP_ID, comment_text: 'Too deep', parent_comment_id: deepParentId },
    });
    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/[Mm]aximum reply depth/);
  });
});

// ===========================================================================
// DELETE /api/comments
// ===========================================================================

describe('DELETE /api/comments', () => {
  it('returns 401 when user is not authenticated', async () => {
    mockSession(mockGetSession, null);

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'DELETE',
      body: { comment_id: COMMENT_ID },
    });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/[Aa]uthentication required/);
  });

  it('checks CSRF token', async () => {
    const csrfResponse = new Response(JSON.stringify({ error: 'CSRF token invalid' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
    mockRequireCsrf.mockResolvedValueOnce(csrfResponse);

    const req = createMockRequest('/api/comments', {
      method: 'DELETE',
      body: { comment_id: COMMENT_ID },
    });
    const res = await DELETE(req);
    const { status } = await parseResponse(res);

    expect(status).toBe(403);
    expect(mockRequireCsrf).toHaveBeenCalledWith(req);
  });

  it('deletes own comment successfully (soft delete)', async () => {
    mockSession(mockGetSession, TEST_USER);

    const deletedComment = {
      id: COMMENT_ID,
      clip_id: CLIP_ID,
      user_key: USER_KEY,
      is_deleted: true,
    };

    // Sequential calls:
    // 0: feature_flags
    // 1: users (getUserInfo)
    // 2: comments (update soft delete)
    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: deletedComment, error: null },                   // soft delete
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'DELETE',
      body: { comment_id: COMMENT_ID },
    });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/[Dd]eleted/);
  });

  it('returns 404 when trying to delete another user\'s comment', async () => {
    mockSession(mockGetSession, TEST_USER);

    // The update query uses .eq('user_key', userKey) so it won't match
    // another user's comment, resulting in null data
    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: null, error: null },                             // update returns null (not owner)
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'DELETE',
      body: { comment_id: COMMENT_ID },
    });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toMatch(/not found|permission/i);
  });

  it('returns 404 when comment does not exist', async () => {
    mockSession(mockGetSession, TEST_USER);

    const nonexistentId = '99999999-9999-9999-9999-999999999999';

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
      { data: null, error: null },                             // update returns null (not found)
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'DELETE',
      body: { comment_id: nonexistentId },
    });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toMatch(/not found|permission/i);
  });

  it('returns 400 when validation fails for delete', async () => {
    mockSession(mockGetSession, TEST_USER);

    mockParseBody.mockReturnValueOnce({
      success: false,
      error: 'Invalid comment ID format',
    });

    const mock = createSequentialMock([
      { data: [], error: null },                               // feature_flags
      { data: { id: TEST_USER.userId, username: 'Test User', avatar_url: null }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: mock.from });

    const req = createMockRequest('/api/comments', {
      method: 'DELETE',
      body: { comment_id: 'not-a-uuid' },
    });
    const res = await DELETE(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid comment ID format');
  });

  it('returns 500 when Supabase env vars are missing', async () => {
    mockSession(mockGetSession, TEST_USER);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const req = createMockRequest('/api/comments', {
      method: 'DELETE',
      body: { comment_id: COMMENT_ID },
    });
    const res = await DELETE(req);
    const { status } = await parseResponse(res);

    // The route throws internally due to missing env vars
    expect(status).toBe(500);
  });
});
