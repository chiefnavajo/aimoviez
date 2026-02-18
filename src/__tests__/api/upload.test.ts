/**
 * @jest-environment node
 */

/**
 * Upload API Routes Tests
 *
 * Covers:
 *   POST /api/upload/signed-url  - Signed URL generation for direct upload
 *   POST /api/upload/register    - Register clip metadata after direct upload
 *   POST /api/upload             - Full upload flow (form-data upload)
 *   GET  /api/upload             - Check upload status
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
jest.mock('@/lib/validations', () => {
  const actual = jest.requireActual('@/lib/validations');
  return {
    ...actual,
    parseBody: jest.fn((_schema: unknown, body: unknown) => {
      // Default pass-through; individual tests override as needed
      return { success: true, data: body };
    }),
    RegisterClipSchema: actual.RegisterClipSchema ?? {},
  };
});
jest.mock('@/lib/sanitize', () => ({
  sanitizeText: jest.fn((v: string) => v ?? ''),
  sanitizeUrl: jest.fn((v: string) => v ?? null),
  sanitizeFilename: jest.fn((v: string) => v ?? 'unnamed'),
  sanitizeUsername: jest.fn((v: string) => v ?? ''),
}));
jest.mock('@/lib/genres', () => ({
  isValidGenre: jest.fn((code: string) =>
    ['action', 'comedy', 'horror', 'animation', 'thriller', 'sci-fi', 'romance', 'drama'].includes(code)
  ),
  getGenreCodes: jest.fn(() => [
    'action', 'comedy', 'horror', 'animation', 'thriller', 'sci-fi', 'romance', 'drama',
  ]),
}));
jest.mock('@/lib/storage', () => ({
  getStorageProvider: jest.fn().mockResolvedValue('supabase'),
  getSignedUploadUrl: jest.fn().mockResolvedValue({
    provider: 'r2',
    signedUrl: 'https://r2.example.com/signed',
    publicUrl: 'https://cdn.example.com/clips/test.mp4',
    key: 'clips/test.mp4',
  }),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { requireCsrf } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validations';
import { getStorageProvider, getSignedUploadUrl as getProviderSignedUrl } from '@/lib/storage';
import {
  createSupabaseChain,
  createMockRequest,
  mockSession,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

import { POST as signedUrlPost } from '@/app/api/upload/signed-url/route';
import { POST as registerPost } from '@/app/api/upload/register/route';
import { POST as uploadPost, GET as uploadGet } from '@/app/api/upload/route';

const mockGetSession = getServerSession as jest.Mock;
const mockCreateClient = createClient as jest.Mock;
const mockRequireCsrf = requireCsrf as jest.Mock;
const mockRateLimit = rateLimit as jest.Mock;
const mockParseBody = parseBody as jest.Mock;
const mockGetStorageProvider = getStorageProvider as jest.Mock;
const mockGetProviderSignedUrl = getProviderSignedUrl as jest.Mock;

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
// Helper: create a mock storage object for Supabase
// ---------------------------------------------------------------------------

function createMockStorage(opts: {
  createSignedUploadUrlResult?: { data: { signedUrl: string } | null; error: unknown };
  uploadResult?: { data: { path: string } | null; error: unknown };
  publicUrl?: string;
  removeResult?: { error: unknown };
} = {}) {
  const fromBucket = jest.fn(() => ({
    createSignedUploadUrl: jest.fn().mockResolvedValue(
      opts.createSignedUploadUrlResult ?? {
        data: { signedUrl: 'https://test.supabase.co/storage/signed-url' },
        error: null,
      }
    ),
    upload: jest.fn().mockResolvedValue(
      opts.uploadResult ?? {
        data: { path: 'clips/clip_123.mp4' },
        error: null,
      }
    ),
    getPublicUrl: jest.fn().mockReturnValue({
      data: { publicUrl: opts.publicUrl ?? 'https://test.supabase.co/storage/v1/object/public/clips/clip_123.mp4' },
    }),
    remove: jest.fn().mockResolvedValue(
      opts.removeResult ?? { error: null }
    ),
  }));

  return { from: fromBucket };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  mockRequireCsrf.mockResolvedValue(null);
  mockRateLimit.mockResolvedValue(null);
  mockGetStorageProvider.mockResolvedValue('supabase');
  mockParseBody.mockImplementation((_schema: unknown, body: unknown) => ({
    success: true,
    data: body,
  }));
});

// ===========================================================================
// POST /api/upload/signed-url
// ===========================================================================

describe('POST /api/upload/signed-url', () => {
  // -------------------------------------------------------------------------
  // 1. Returns 401 when not authenticated
  // -------------------------------------------------------------------------
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/upload/signed-url', {
      method: 'POST',
      body: { filename: 'test.mp4', contentType: 'video/mp4' },
    });

    const res = await signedUrlPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/logged in/i);
  });

  // -------------------------------------------------------------------------
  // 2. Returns CSRF error when CSRF check fails
  // -------------------------------------------------------------------------
  it('returns CSRF error when CSRF check fails', async () => {
    const { NextResponse } = require('next/server');
    mockRequireCsrf.mockResolvedValueOnce(
      NextResponse.json({ error: 'CSRF token missing' }, { status: 403 })
    );

    const req = createMockRequest('/api/upload/signed-url', {
      method: 'POST',
      body: { filename: 'test.mp4', contentType: 'video/mp4' },
    });

    const res = await signedUrlPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toMatch(/CSRF/i);
  });

  // -------------------------------------------------------------------------
  // 3. Returns rate limit error
  // -------------------------------------------------------------------------
  it('returns rate limit error when rate limited', async () => {
    const { NextResponse } = require('next/server');
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    );

    const req = createMockRequest('/api/upload/signed-url', {
      method: 'POST',
      body: { filename: 'test.mp4', contentType: 'video/mp4' },
    });

    const res = await signedUrlPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(429);
    expect(body.error).toMatch(/too many/i);
  });

  // -------------------------------------------------------------------------
  // 4. Returns 400 for missing filename
  // -------------------------------------------------------------------------
  it('returns 400 when filename is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/signed-url', {
      method: 'POST',
      body: { contentType: 'video/mp4' },
    });

    const res = await signedUrlPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/filename/i);
  });

  // -------------------------------------------------------------------------
  // 5. Returns 400 for missing contentType
  // -------------------------------------------------------------------------
  it('returns 400 when contentType is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/signed-url', {
      method: 'POST',
      body: { filename: 'test.mp4' },
    });

    const res = await signedUrlPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/contentType/i);
  });

  // -------------------------------------------------------------------------
  // 6. Returns 400 for invalid file type
  // -------------------------------------------------------------------------
  it('returns 400 for invalid content type', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/signed-url', {
      method: 'POST',
      body: { filename: 'test.exe', contentType: 'application/octet-stream' },
    });

    const res = await signedUrlPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid.*format|mp4|mov|webm/i);
  });

  // -------------------------------------------------------------------------
  // 7. Returns signed URL for valid request (Supabase provider)
  // -------------------------------------------------------------------------
  it('returns signed URL for valid request with Supabase provider', async () => {
    mockSession(mockGetSession, TEST_USER);
    mockGetStorageProvider.mockResolvedValueOnce('supabase');

    const signedUrl = 'https://test.supabase.co/storage/v1/upload/signed-url-token';
    const publicUrl = 'https://test.supabase.co/storage/v1/object/public/videos/clips/clip_test.mp4';

    // feature_flags query for r2_storage
    const seq = createSequentialMock([
      { data: { enabled: false }, error: null }, // r2_storage feature flag
    ]);

    const storage = createMockStorage({
      createSignedUploadUrlResult: {
        data: { signedUrl },
        error: null,
      },
      publicUrl,
    });

    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/signed-url', {
      method: 'POST',
      body: { filename: 'my-clip.mp4', contentType: 'video/mp4' },
    });

    const res = await signedUrlPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.signedUrl).toBe(signedUrl);
    expect(body.storagePath).toMatch(/^clips\/clip_\d+_[a-f0-9]+\.mp4$/);
    expect(body.expiresIn).toBe(3600);
  });

  // -------------------------------------------------------------------------
  // 8. Returns signed URL via R2 provider
  // -------------------------------------------------------------------------
  it('returns signed URL via R2 provider when feature flag is enabled', async () => {
    mockSession(mockGetSession, TEST_USER);
    mockGetStorageProvider.mockResolvedValueOnce('r2');

    // feature_flags query for r2_storage => enabled
    const seq = createSequentialMock([
      { data: { enabled: true }, error: null },
    ]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const r2Result = {
      signedUrl: 'https://r2.example.com/signed-upload',
      publicUrl: 'https://cdn.aimoviez.app/clips/test.mp4',
      key: 'clips/test.mp4',
    };
    mockGetProviderSignedUrl.mockResolvedValueOnce(r2Result);

    const req = createMockRequest('/api/upload/signed-url', {
      method: 'POST',
      body: { filename: 'clip.mp4', contentType: 'video/mp4' },
    });

    const res = await signedUrlPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.signedUrl).toBe(r2Result.signedUrl);
    expect(body.publicUrl).toBe(r2Result.publicUrl);
    expect(body.bucketName).toBe('r2');
  });

  // -------------------------------------------------------------------------
  // 9. Returns 500 when storage bucket not found
  // -------------------------------------------------------------------------
  it('returns 500 when both storage buckets fail', async () => {
    mockSession(mockGetSession, TEST_USER);
    mockGetStorageProvider.mockResolvedValueOnce('supabase');

    const seq = createSequentialMock([
      { data: { enabled: false }, error: null }, // r2_storage flag
    ]);

    // Both videos and clips buckets fail
    const fromBucket = jest.fn(() => ({
      createSignedUploadUrl: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Bucket not found' },
      }),
      getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: '' } }),
    }));

    mockCreateClient.mockReturnValue({ from: seq.from, storage: { from: fromBucket } });

    const req = createMockRequest('/api/upload/signed-url', {
      method: 'POST',
      body: { filename: 'clip.mp4', contentType: 'video/mp4' },
    });

    const res = await signedUrlPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/failed|bucket|not found/i);
  });
});

// ===========================================================================
// POST /api/upload/register
// ===========================================================================

describe('POST /api/upload/register', () => {
  const validRegisterBody = {
    videoUrl: 'https://test.supabase.co/storage/v1/object/public/clips/clip_123.mp4',
    genre: 'action',
    title: 'My Awesome Clip',
    description: 'A short action clip',
    duration: 7.5,
  };

  // -------------------------------------------------------------------------
  // 10. Returns 401 when not authenticated
  // -------------------------------------------------------------------------
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: validRegisterBody,
    });

    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/logged in/i);
  });

  // -------------------------------------------------------------------------
  // 11. Returns 400 for validation failure (missing required fields)
  // -------------------------------------------------------------------------
  it('returns 400 when validation fails (missing fields)', async () => {
    mockSession(mockGetSession, TEST_USER);

    mockParseBody.mockReturnValueOnce({
      success: false,
      error: 'Video URL is required, Title is required',
    });

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: { genre: 'action' },
    });

    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 12. Returns 400 for invalid genre
  // -------------------------------------------------------------------------
  it('returns 400 for invalid genre', async () => {
    mockSession(mockGetSession, TEST_USER);

    const { isValidGenre } = require('@/lib/genres');
    (isValidGenre as jest.Mock).mockReturnValueOnce(false);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: { ...validRegisterBody, genre: 'invalidgenre' },
    });

    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid genre/i);
  });

  // -------------------------------------------------------------------------
  // 13. Creates tournament_clips record (happy path)
  // -------------------------------------------------------------------------
  it('creates tournament_clips record successfully', async () => {
    mockSession(mockGetSession, TEST_USER);

    const clipId = '11111111-1111-1111-1111-111111111111';

    // Sequential from() calls:
    //  0: users (profile lookup)
    //  1: feature_flags (multi_genre)
    //  2: seasons (active season)
    //  3: story_slots (voting slot)
    //  4: tournament_clips (insert)
    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId, username: 'testuser', avatar_url: null }, error: null }, // users
      { data: { enabled: false }, error: null },                                               // feature_flags
      { data: { id: 'season-1', total_slots: 75, genre: 'action' }, error: null },            // seasons
      { data: { id: 'slot-1', slot_position: 3, status: 'voting', voting_started_at: null, voting_duration_hours: 24 }, error: null }, // story_slots
      { data: { id: clipId, status: 'pending' }, error: null },                               // tournament_clips insert
    ]);

    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: validRegisterBody,
    });

    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clip).toBeDefined();
    expect(body.clip.id).toBe(clipId);
    expect(body.clip.status).toBe('pending');
    expect(body.clip.slot_position).toBe(3);
    expect(body.clip.genre).toBe('action');
    expect(body.message).toMatch(/registered|successful/i);
    expect(body.timerStarted).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 14. Returns waiting_for_clips message when slot is waiting
  // -------------------------------------------------------------------------
  it('returns appropriate message when slot is waiting_for_clips', async () => {
    mockSession(mockGetSession, TEST_USER);

    const clipId = '22222222-2222-2222-2222-222222222222';

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId, username: 'testuser', avatar_url: null }, error: null },
      { data: { enabled: false }, error: null },
      { data: { id: 'season-1', total_slots: 75, genre: 'action' }, error: null },
      { data: { id: 'slot-1', slot_position: 5, status: 'waiting_for_clips', voting_started_at: null, voting_duration_hours: 24 }, error: null },
      { data: { id: clipId, status: 'pending' }, error: null },
    ]);

    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: validRegisterBody,
    });

    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.isWaitingForClips).toBe(true);
    expect(body.message).toMatch(/waiting/i);
  });

  // -------------------------------------------------------------------------
  // 15. Returns 400 when no active season
  // -------------------------------------------------------------------------
  it('returns 400 when no active season exists', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId, username: 'testuser', avatar_url: null }, error: null }, // users
      { data: { enabled: false }, error: null },  // feature_flags
      { data: null, error: null },                 // seasons (none found)
    ]);

    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: validRegisterBody,
    });

    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/no active season/i);
  });

  // -------------------------------------------------------------------------
  // 16. Returns 400 when no active voting slot
  // -------------------------------------------------------------------------
  it('returns 400 when no active voting slot exists', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId, username: 'testuser', avatar_url: null }, error: null },
      { data: { enabled: false }, error: null },
      { data: { id: 'season-1', total_slots: 75, genre: 'action' }, error: null },
      { data: null, error: { message: 'no rows' } }, // no voting slot
    ]);

    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: validRegisterBody,
    });

    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/no active voting slot/i);
  });

  // -------------------------------------------------------------------------
  // 17. Returns 500 on DB insert error and cleans up storage
  // -------------------------------------------------------------------------
  it('returns 500 on database insert error', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId, username: 'testuser', avatar_url: null }, error: null },
      { data: { enabled: false }, error: null },
      { data: { id: 'season-1', total_slots: 75, genre: 'action' }, error: null },
      { data: { id: 'slot-1', slot_position: 3, status: 'voting', voting_started_at: null, voting_duration_hours: 24 }, error: null },
      { data: null, error: { message: 'duplicate key' } }, // insert fails
    ]);

    const removeMock = jest.fn().mockResolvedValue({ error: null });
    const storage = {
      from: jest.fn(() => ({
        remove: removeMock,
      })),
    };

    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: validRegisterBody,
    });

    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/failed to save/i);
  });

  // -------------------------------------------------------------------------
  // 18. Returns 400 when genre mismatches active season
  // -------------------------------------------------------------------------
  it('returns 400 when clip genre does not match season genre', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId, username: 'testuser', avatar_url: null }, error: null },
      { data: { enabled: false }, error: null },
      // Season genre is 'horror', but clip genre is 'action'
      { data: { id: 'season-1', total_slots: 75, genre: 'horror' }, error: null },
    ]);

    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload/register', {
      method: 'POST',
      body: validRegisterBody, // genre: 'action'
    });

    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/horror/i);
  });
});

// ===========================================================================
// POST /api/upload (Full upload flow)
// ===========================================================================

describe('POST /api/upload', () => {
  /**
   * Helper to create a FormData-bearing NextRequest.
   * Jest cannot use the browser FormData directly, so we construct
   * a multipart request manually using the undici/node FormData.
   */
  function createUploadRequest(opts: {
    video?: { name: string; type: string; size: number; content?: Uint8Array };
    genre?: string;
    title?: string;
    description?: string;
    headers?: Record<string, string>;
  } = {}) {
    const formData = new FormData();

    if (opts.video) {
      // Create a File-like blob with proper magic bytes for mp4
      const content = opts.video.content ?? new Uint8Array(
        // ftyp box at offset 4 (common MP4 signature)
        [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, ...new Array(Math.max(0, opts.video.size - 8)).fill(0)]
      );
      const file = new File([content], opts.video.name, { type: opts.video.type });
      // Override size via Object.defineProperty if needed
      if (content.length !== opts.video.size) {
        Object.defineProperty(file, 'size', { value: opts.video.size });
      }
      formData.append('video', file);
    }

    if (opts.genre) formData.append('genre', opts.genre);
    if (opts.title) formData.append('title', opts.title);
    if (opts.description) formData.append('description', opts.description);

    const url = new URL('/api/upload', 'http://localhost:3000');

    return new Request(url.toString(), {
      method: 'POST',
      body: formData,
      headers: {
        'x-forwarded-for': '127.0.0.1',
        'user-agent': 'jest-test-agent',
        ...(opts.headers ?? {}),
      },
    }) as unknown as import('next/server').NextRequest;
  }

  // -------------------------------------------------------------------------
  // 19. Returns 401 when not authenticated
  // -------------------------------------------------------------------------
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createUploadRequest({
      video: { name: 'clip.mp4', type: 'video/mp4', size: 1024 },
      genre: 'action',
      title: 'My Clip',
    });

    const res = await uploadPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/logged in/i);
  });

  // -------------------------------------------------------------------------
  // 20. Returns 400 when no video file provided
  // -------------------------------------------------------------------------
  it('returns 400 when no video file is provided', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    // No video in form data
    const req = createUploadRequest({
      genre: 'action',
      title: 'My Clip',
    });

    const res = await uploadPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/no video/i);
  });

  // -------------------------------------------------------------------------
  // 21. Returns 400 when genre is missing
  // -------------------------------------------------------------------------
  it('returns 400 when genre is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createUploadRequest({
      video: { name: 'clip.mp4', type: 'video/mp4', size: 1024 },
      title: 'My Clip',
    });

    const res = await uploadPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/genre.*required/i);
  });

  // -------------------------------------------------------------------------
  // 22. Returns 400 when title is missing
  // -------------------------------------------------------------------------
  it('returns 400 when title is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createUploadRequest({
      video: { name: 'clip.mp4', type: 'video/mp4', size: 1024 },
      genre: 'action',
    });

    const res = await uploadPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/title.*required/i);
  });

  // -------------------------------------------------------------------------
  // 23. Returns 400 for invalid file type (MIME)
  // -------------------------------------------------------------------------
  it('returns 400 for invalid file MIME type', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createUploadRequest({
      video: { name: 'malware.exe', type: 'application/x-msdownload', size: 1024 },
      genre: 'action',
      title: 'My Clip',
    });

    const res = await uploadPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid format|mp4|mov|webm/i);
  });

  // -------------------------------------------------------------------------
  // 24. Returns 400 for oversized file
  // -------------------------------------------------------------------------
  it('returns 400 for oversized file (>50MB)', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const oversizeBytes = 51 * 1024 * 1024; // 51MB

    // We cannot easily fake File.size through the multipart FormData pipeline
    // because the Request/FormData deserialization creates a new File with the
    // actual content length. Instead, we mock request.formData() directly.
    const mp4Header = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
    const fakeFile = new File([mp4Header], 'big-video.mp4', { type: 'video/mp4' });
    // Forcefully override size on the prototype chain for this instance
    Object.defineProperty(fakeFile, 'size', { get: () => oversizeBytes });

    const fakeFormData = new FormData();
    // We append the real (small) file to satisfy formData structure, then
    // intercept at the request level by providing a custom formData() method.
    fakeFormData.set('video', fakeFile);
    fakeFormData.set('genre', 'action');
    fakeFormData.set('title', 'My Clip');

    const url = new URL('/api/upload', 'http://localhost:3000');
    const baseReq = new Request(url.toString(), {
      method: 'POST',
      headers: {
        'x-forwarded-for': '127.0.0.1',
        'user-agent': 'jest-test-agent',
      },
    });
    // Replace formData() to return our controlled form data with the faked size
    (baseReq as unknown as Record<string, unknown>).formData = async () => fakeFormData;

    const res = await uploadPost(baseReq as unknown as import('next/server').NextRequest);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/file too large|maximum size/i);
  });

  // -------------------------------------------------------------------------
  // 25. Returns 400 for invalid genre
  // -------------------------------------------------------------------------
  it('returns 400 for invalid genre value', async () => {
    mockSession(mockGetSession, TEST_USER);

    const { isValidGenre } = require('@/lib/genres');
    (isValidGenre as jest.Mock).mockReturnValueOnce(false);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createUploadRequest({
      video: { name: 'clip.mp4', type: 'video/mp4', size: 1024 },
      genre: 'notareal_genre',
      title: 'My Clip',
    });

    const res = await uploadPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/invalid genre/i);
  });
});

// ===========================================================================
// GET /api/upload (Upload status check)
// ===========================================================================

describe('GET /api/upload', () => {
  // -------------------------------------------------------------------------
  // 26. Returns 401 when not authenticated
  // -------------------------------------------------------------------------
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/upload', {
      method: 'GET',
      searchParams: { clipId: '11111111-1111-1111-1111-111111111111' },
    });

    const res = await uploadGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication/i);
  });

  // -------------------------------------------------------------------------
  // 27. Returns 400 when clipId is missing
  // -------------------------------------------------------------------------
  it('returns 400 when clipId is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([]);
    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload', {
      method: 'GET',
    });

    const res = await uploadGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toMatch(/clip id/i);
  });

  // -------------------------------------------------------------------------
  // 28. Returns clip status for valid request
  // -------------------------------------------------------------------------
  it('returns clip status for a valid clipId', async () => {
    mockSession(mockGetSession, TEST_USER);

    const clipId = '33333333-3333-3333-3333-333333333333';

    // Sequential calls:
    //  0: users (profile lookup for ownership check)
    //  1: tournament_clips (clip query)
    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: { id: clipId, status: 'pending', video_url: 'https://test.supabase.co/clip.mp4', vote_count: 0 }, error: null },
    ]);

    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload', {
      method: 'GET',
      searchParams: { clipId },
    });

    const res = await uploadGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clip.id).toBe(clipId);
    expect(body.clip.status).toBe('pending');
    expect(body.clip.vote_count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 29. Returns 404 when clip not found
  // -------------------------------------------------------------------------
  it('returns 404 when clip is not found', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: null, error: null }, // clip not found
    ]);

    const storage = createMockStorage();
    mockCreateClient.mockReturnValue({ from: seq.from, storage });

    const req = createMockRequest('/api/upload', {
      method: 'GET',
      searchParams: { clipId: '44444444-4444-4444-4444-444444444444' },
    });

    const res = await uploadGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });
});
