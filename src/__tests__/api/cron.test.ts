/**
 * @jest-environment node
 */
/**
 * Comprehensive unit tests for all cron and internal API routes.
 * Tests auth gating (verifyCronAuth), happy paths, and DB error handling.
 *
 * Covers:
 * - 8 cron routes: auto-advance, cleanup-videos, sync-leaderboards,
 *   process-vote-queue, process-comment-queue, sync-vote-counters,
 *   extract-missing-frames, process-movie-scenes, ai-generation-timeout
 * - 2 internal routes: extract-frame, extract-thumbnail
 */

// ============================================================================
// MOCKS — must be declared before any imports
// ============================================================================

import { createMockRequest, createCronRequest, createSupabaseChain } from '../helpers/api-test-utils';

const mockChain = createSupabaseChain({ data: null, error: null });

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ from: mockChain.from, rpc: jest.fn().mockResolvedValue({ data: null, error: null }) })),
}));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/cron-auth', () => ({
  verifyCronAuth: jest.fn().mockReturnValue(null),
}));
jest.mock('@/lib/counter-sync', () => ({
  forceSyncCounters: jest.fn().mockResolvedValue({ synced: 3, errors: [] }),
}));
jest.mock('@/lib/crdt-vote-counter', () => ({
  clearClips: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/vote-validation-redis', () => ({
  setSlotState: jest.fn().mockResolvedValue(undefined),
  setVotingFrozen: jest.fn().mockResolvedValue(undefined),
  clearVotingFrozen: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/storage', () => ({
  extractStorageKey: jest.fn().mockReturnValue({ key: 'test-key', provider: 'supabase' }),
  deleteFiles: jest.fn().mockResolvedValue({ deleted: 1, error: null }),
  getStorageProvider: jest.fn().mockResolvedValue('supabase'),
  getSignedUploadUrl: jest.fn().mockResolvedValue({ signedUrl: 'https://example.com/upload' }),
  getPublicVideoUrl: jest.fn().mockReturnValue('https://example.com/public/video.mp4'),
}));
jest.mock('@/lib/storage/frame-upload', () => ({
  uploadFrame: jest.fn().mockResolvedValue('https://example.com/frame.jpg'),
  extractFrameAtTimestamp: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  uploadFrameWithKey: jest.fn().mockResolvedValue('https://example.com/frame.jpg'),
}));
jest.mock('@/lib/leaderboard-redis', () => ({
  batchUpdateClipScores: jest.fn().mockResolvedValue(undefined),
  batchUpdateVoterScores: jest.fn().mockResolvedValue(undefined),
  batchUpdateCreatorScores: jest.fn().mockResolvedValue(undefined),
  clearSlotLeaderboard: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/vote-event-queue', () => ({
  popEvents: jest.fn().mockResolvedValue([]),
  acknowledgeEvents: jest.fn().mockResolvedValue(undefined),
  acknowledgeEvent: jest.fn().mockResolvedValue(undefined),
  moveToDeadLetter: jest.fn().mockResolvedValue(undefined),
  recoverOrphans: jest.fn().mockResolvedValue(0),
  setLastProcessedAt: jest.fn().mockResolvedValue(undefined),
  getQueueHealth: jest.fn().mockResolvedValue({ pending: 0, processing: 0, deadLetter: 0 }),
  pushEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/comment-event-queue', () => ({
  popCommentEvents: jest.fn().mockResolvedValue([]),
  acknowledgeCommentEvents: jest.fn().mockResolvedValue(undefined),
  acknowledgeCommentEvent: jest.fn().mockResolvedValue(undefined),
  moveCommentToDeadLetter: jest.fn().mockResolvedValue(undefined),
  recoverCommentOrphans: jest.fn().mockResolvedValue(0),
  setCommentLastProcessedAt: jest.fn().mockResolvedValue(undefined),
  getCommentQueueHealth: jest.fn().mockResolvedValue({ pending: 0, processing: 0, deadLetter: 0 }),
  pushCommentEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/ai-video', () => ({
  startGeneration: jest.fn().mockResolvedValue({ requestId: 'fal-req-1' }),
  startImageToVideoGeneration: jest.fn().mockResolvedValue({ requestId: 'fal-req-2' }),
  getModelConfig: jest.fn().mockReturnValue({ name: 'test-model' }),
  checkFalStatus: jest.fn().mockResolvedValue({ status: 'COMPLETED', videoUrl: 'https://example.com/video.mp4' }),
  MODEL_DURATION_SECONDS: { 'test-model': 5 },
  MODELS: { 'test-model': { name: 'test-model' } },
  getCreditCost: jest.fn().mockResolvedValue(10),
}));
jest.mock('@/lib/elevenlabs', () => ({
  generateNarration: jest.fn().mockResolvedValue({ audioBuffer: Buffer.from('audio') }),
}));
jest.mock('@/lib/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@upstash/redis', () => ({
  Redis: jest.fn(() => ({
    eval: jest.fn().mockResolvedValue([]),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
  })),
}));
jest.mock('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }));
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));
jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
  unlink: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/movie-concat', () => ({
  concatenateScenes: jest.fn().mockResolvedValue({ ok: true, publicUrl: 'https://example.com/final.mp4', fileSizeMb: 25 }),
}));
jest.mock('@/lib/visual-learning', () => ({
  extractVisualFeatures: jest.fn().mockResolvedValue(null),
  storeClipVisuals: jest.fn().mockResolvedValue(undefined),
}));

// ============================================================================
// GLOBAL SETUP
// ============================================================================

beforeAll(() => {
  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  process.env.UPSTASH_REDIS_REST_URL = 'https://test-redis.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';
});

// ============================================================================
// HELPERS — use require() for fresh mock references after resetModules
// ============================================================================

function getVerifyCronAuth(): jest.Mock {
  return require('@/lib/cron-auth').verifyCronAuth as jest.Mock;
}

function getMockCreateClient(): jest.Mock {
  return require('@supabase/supabase-js').createClient as jest.Mock;
}

/**
 * Reset chain to default resolve values.
 */
function resetChain(resolveValue?: { data?: unknown; error?: unknown; count?: number | null }) {
  mockChain._calls.length = 0;
  // Mutate in-place — the chain's terminal methods (single, maybeSingle, then)
  // hold a reference to _resolveValue, so we must update the same object.
  mockChain._resolveValue.data = resolveValue?.data ?? null;
  mockChain._resolveValue.error = resolveValue?.error ?? null;
  mockChain._resolveValue.count = resolveValue?.count ?? null;
}

/**
 * Mock verifyCronAuth to return a 401 response for the next call.
 */
function mockAuthFailure() {
  const { NextResponse } = require('next/server');
  getVerifyCronAuth().mockReturnValueOnce(
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  );
}

/**
 * Mock verifyCronAuth to pass (return null).
 */
function mockAuthSuccess() {
  getVerifyCronAuth().mockReturnValue(null);
}

/**
 * Restore default mock implementations that jest.clearAllMocks() wipes out.
 */
function restoreQueueMocks() {
  const voteQueue = require('@/lib/vote-event-queue');
  (voteQueue.popEvents as jest.Mock).mockResolvedValue([]);
  (voteQueue.acknowledgeEvents as jest.Mock).mockResolvedValue(undefined);
  (voteQueue.acknowledgeEvent as jest.Mock).mockResolvedValue(undefined);
  (voteQueue.moveToDeadLetter as jest.Mock).mockResolvedValue(undefined);
  (voteQueue.recoverOrphans as jest.Mock).mockResolvedValue(0);
  (voteQueue.setLastProcessedAt as jest.Mock).mockResolvedValue(undefined);
  (voteQueue.getQueueHealth as jest.Mock).mockResolvedValue({ pending: 0, processing: 0, deadLetter: 0 });
  (voteQueue.pushEvent as jest.Mock).mockResolvedValue(undefined);

  const commentQueue = require('@/lib/comment-event-queue');
  (commentQueue.popCommentEvents as jest.Mock).mockResolvedValue([]);
  (commentQueue.acknowledgeCommentEvents as jest.Mock).mockResolvedValue(undefined);
  (commentQueue.acknowledgeCommentEvent as jest.Mock).mockResolvedValue(undefined);
  (commentQueue.moveCommentToDeadLetter as jest.Mock).mockResolvedValue(undefined);
  (commentQueue.recoverCommentOrphans as jest.Mock).mockResolvedValue(0);
  (commentQueue.setCommentLastProcessedAt as jest.Mock).mockResolvedValue(undefined);
  (commentQueue.getCommentQueueHealth as jest.Mock).mockResolvedValue({ pending: 0, processing: 0, deadLetter: 0 });
  (commentQueue.pushCommentEvent as jest.Mock).mockResolvedValue(undefined);

  const counterSync = require('@/lib/counter-sync');
  (counterSync.forceSyncCounters as jest.Mock).mockResolvedValue({ synced: 3, errors: [] });
}

/**
 * Set up chain to resolve with specific data, and configure the Supabase client mock.
 */
function setupSupabase(resolveValue?: { data?: unknown; error?: unknown; count?: number | null }) {
  resetChain(resolveValue);
  getMockCreateClient().mockReturnValue({
    from: mockChain.from,
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  });
}

/**
 * Set up Supabase mock where the first N from() calls work normally but
 * subsequent ones throw, to simulate errors INSIDE the try/catch block.
 * Routes typically call from() for lock cleanup + lock insert before the
 * main try block, so we let those succeed and fail on later calls.
 */
function setupSupabaseFailsAfterLock(successCalls = 3) {
  let callCount = 0;
  getMockCreateClient().mockReturnValue({
    from: jest.fn((...args: unknown[]) => {
      callCount++;
      if (callCount > successCalls) {
        throw new Error('DB connection failed');
      }
      return mockChain.from(...args);
    }),
    rpc: jest.fn(),
  });
}

/**
 * Set up Supabase mock that throws on any from() call.
 * Used to test the outer try/catch error handling.
 */
function setupSupabaseThrows() {
  getMockCreateClient().mockReturnValue({
    from: jest.fn(() => { throw new Error('DB connection failed'); }),
    rpc: jest.fn(() => { throw new Error('DB connection failed'); }),
  });
}

// ============================================================================
// 1. CRON: AUTO-ADVANCE
// ============================================================================

describe('CRON: auto-advance', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    restoreQueueMocks();
    mockAuthSuccess();
    setupSupabase();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    ({ GET } = await import('@/app/api/cron/auto-advance/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/cron/auto-advance');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns ok when no expired slots found', async () => {
    const req = createCronRequest('/api/cron/auto-advance', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 500 on unexpected database error', async () => {
    // auto-advance has try/catch wrapping lock acquisition, so from() throwing is caught
    setupSupabaseFailsAfterLock(0);
    ({ GET } = await import('@/app/api/cron/auto-advance/route'));
    const req = createCronRequest('/api/cron/auto-advance', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

// ============================================================================
// 2. CRON: CLEANUP-VIDEOS
// ============================================================================

describe('CRON: cleanup-videos', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthSuccess();
    setupSupabase();
    ({ GET } = await import('@/app/api/cron/cleanup-videos/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/cron/cleanup-videos');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('returns ok when no videos need cleanup', async () => {
    const req = createCronRequest('/api/cron/cleanup-videos', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('throws on unexpected DB error (caught by framework)', async () => {
    setupSupabaseThrows();
    ({ GET } = await import('@/app/api/cron/cleanup-videos/route'));
    const req = createCronRequest('/api/cron/cleanup-videos', 'test-cron-secret');
    await expect(GET(req as any)).rejects.toThrow('DB connection failed');
  });
});

// ============================================================================
// 3. CRON: SYNC-LEADERBOARDS
// ============================================================================

describe('CRON: sync-leaderboards', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthSuccess();
    setupSupabase();
    ({ GET } = await import('@/app/api/cron/sync-leaderboards/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/cron/sync-leaderboards');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('skips when redis_leaderboards feature flag is disabled', async () => {
    resetChain({ data: { enabled: false }, error: null });
    const req = createCronRequest('/api/cron/sync-leaderboards', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(true);
    expect(body.reason).toContain('redis_leaderboards disabled');
  });

  it('throws on unexpected DB error (caught by framework)', async () => {
    setupSupabaseThrows();
    ({ GET } = await import('@/app/api/cron/sync-leaderboards/route'));
    const req = createCronRequest('/api/cron/sync-leaderboards', 'test-cron-secret');
    await expect(GET(req as any)).rejects.toThrow('DB connection failed');
  });
});

// ============================================================================
// 4. CRON: PROCESS-VOTE-QUEUE
// ============================================================================

describe('CRON: process-vote-queue', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    restoreQueueMocks();
    mockAuthSuccess();
    setupSupabase();
    ({ GET } = await import('@/app/api/cron/process-vote-queue/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/cron/process-vote-queue');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('skips when async_voting feature flag is disabled', async () => {
    resetChain({ data: { enabled: false }, error: null });
    const req = createCronRequest('/api/cron/process-vote-queue', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(true);
    expect(body.reason).toContain('async_voting disabled');
  });

  it('returns ok with 0 processed when queue is empty', async () => {
    resetChain({ data: { enabled: true }, error: null });
    const req = createCronRequest('/api/cron/process-vote-queue', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
  });
});

// ============================================================================
// 5. CRON: PROCESS-COMMENT-QUEUE
// ============================================================================

describe('CRON: process-comment-queue', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    restoreQueueMocks();
    mockAuthSuccess();
    setupSupabase();
    ({ GET } = await import('@/app/api/cron/process-comment-queue/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/cron/process-comment-queue');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('skips when async_comments feature flag is disabled', async () => {
    resetChain({ data: { enabled: false }, error: null });
    const req = createCronRequest('/api/cron/process-comment-queue', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(true);
    expect(body.reason).toContain('async_comments disabled');
  });

  it('returns ok with 0 processed when queue is empty', async () => {
    resetChain({ data: { enabled: true }, error: null });
    const req = createCronRequest('/api/cron/process-comment-queue', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
  });
});

// ============================================================================
// 6. CRON: SYNC-VOTE-COUNTERS
// ============================================================================

describe('CRON: sync-vote-counters', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthSuccess();
    setupSupabase();
    ({ GET } = await import('@/app/api/cron/sync-vote-counters/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/cron/sync-vote-counters');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('skips when async_voting feature flag is disabled', async () => {
    resetChain({ data: { enabled: false }, error: null });
    const req = createCronRequest('/api/cron/sync-vote-counters', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(true);
    expect(body.reason).toContain('async_voting disabled');
  });

  it('returns ok when no active clips to sync', async () => {
    resetChain({ data: { enabled: true }, error: null });
    const req = createCronRequest('/api/cron/sync-vote-counters', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Redis eval returns empty [] by default, so synced=0 or message about no clips
    expect(body.synced).toBe(0);
  });
});

// ============================================================================
// 7. CRON: EXTRACT-MISSING-FRAMES
// ============================================================================

describe('CRON: extract-missing-frames', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthSuccess();
    setupSupabase();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    ({ GET } = await import('@/app/api/cron/extract-missing-frames/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/cron/extract-missing-frames');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('returns ok when no missing frames found', async () => {
    const req = createCronRequest('/api/cron/extract-missing-frames', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(0);
  });

  it('throws on unexpected DB error (caught by framework)', async () => {
    setupSupabaseThrows();
    ({ GET } = await import('@/app/api/cron/extract-missing-frames/route'));
    const req = createCronRequest('/api/cron/extract-missing-frames', 'test-cron-secret');
    await expect(GET(req as any)).rejects.toThrow('DB connection failed');
  });
});

// ============================================================================
// 8. CRON: PROCESS-MOVIE-SCENES
// ============================================================================

describe('CRON: process-movie-scenes', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthSuccess();
    setupSupabase();
    ({ GET } = await import('@/app/api/cron/process-movie-scenes/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/cron/process-movie-scenes');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('returns ok when no generating projects found', async () => {
    const req = createCronRequest('/api/cron/process-movie-scenes', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toContain('No generating projects');
  });

  it('throws on unexpected DB error (caught by framework)', async () => {
    setupSupabaseThrows();
    ({ GET } = await import('@/app/api/cron/process-movie-scenes/route'));
    const req = createCronRequest('/api/cron/process-movie-scenes', 'test-cron-secret');
    await expect(GET(req as any)).rejects.toThrow('DB connection failed');
  });
});

// ============================================================================
// 9. CRON: AI-GENERATION-TIMEOUT
// ============================================================================

describe('CRON: ai-generation-timeout', () => {
  let GET: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthSuccess();
    setupSupabase();
    ({ GET } = await import('@/app/api/cron/ai-generation-timeout/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/cron/ai-generation-timeout');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('returns ok with results when no stale generations found', async () => {
    const req = createCronRequest('/api/cron/ai-generation-timeout', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.results).toBeDefined();
  });

  it('returns 500 on unexpected error', async () => {
    setupSupabaseThrows();
    ({ GET } = await import('@/app/api/cron/ai-generation-timeout/route'));
    const req = createCronRequest('/api/cron/ai-generation-timeout', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});

// ============================================================================
// 10. INTERNAL: EXTRACT-FRAME
// ============================================================================

describe('INTERNAL: extract-frame', () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthSuccess();
    setupSupabase();
    ({ POST } = await import('@/app/api/internal/extract-frame/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/internal/extract-frame', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when clipId is missing', async () => {
    const req = createMockRequest('/api/internal/extract-frame', {
      method: 'POST',
      body: {},
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('clipId required');
  });

  it('returns 400 for invalid clipId format (UUID validation)', async () => {
    const req = createMockRequest('/api/internal/extract-frame', {
      method: 'POST',
      body: { clipId: '../../../etc/passwd' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid clipId format');
  });

  it('returns 404 when clip is not found', async () => {
    mockChain.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const req = createMockRequest('/api/internal/extract-frame', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(404);
  });

  it('returns skipped when clip already has last_frame_url', async () => {
    mockChain.single.mockResolvedValueOnce({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        video_url: 'https://example.com/video.mp4',
        status: 'locked',
        last_frame_url: 'https://example.com/frame.jpg',
      },
      error: null,
    });
    const req = createMockRequest('/api/internal/extract-frame', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.skipped).toBe(true);
  });

  it('returns 400 when clip is not locked', async () => {
    mockChain.single.mockResolvedValueOnce({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        video_url: 'https://example.com/video.mp4',
        status: 'active',
        last_frame_url: null,
      },
      error: null,
    });
    const req = createMockRequest('/api/internal/extract-frame', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not locked');
  });

  it('returns 400 when clip has no video_url', async () => {
    mockChain.single.mockResolvedValueOnce({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        video_url: null,
        status: 'locked',
        last_frame_url: null,
      },
      error: null,
    });
    const req = createMockRequest('/api/internal/extract-frame', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('no video_url');
  });
});

// ============================================================================
// 11. INTERNAL: EXTRACT-THUMBNAIL
// ============================================================================

describe('INTERNAL: extract-thumbnail', () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockAuthSuccess();
    setupSupabase();
    ({ POST } = await import('@/app/api/internal/extract-thumbnail/route'));
  });
  afterEach(() => jest.resetModules());

  it('returns 401 when cron auth fails', async () => {
    mockAuthFailure();
    const req = createMockRequest('/api/internal/extract-thumbnail', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when clipId is missing', async () => {
    const req = createMockRequest('/api/internal/extract-thumbnail', {
      method: 'POST',
      body: {},
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('clipId required');
  });

  it('returns 400 for invalid clipId format (UUID validation)', async () => {
    const req = createMockRequest('/api/internal/extract-thumbnail', {
      method: 'POST',
      body: { clipId: 'not-a-uuid' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid clipId format');
  });

  it('returns 404 when clip is not found', async () => {
    mockChain.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const req = createMockRequest('/api/internal/extract-thumbnail', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(404);
  });

  it('skips extraction when clip already has a real thumbnail', async () => {
    mockChain.single.mockResolvedValueOnce({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        video_url: 'https://example.com/video.mp4',
        thumbnail_url: 'https://example.com/thumb.jpg',
        season_id: 'season-1',
        vote_count: 5,
        status: 'active',
      },
      error: null,
    });
    const req = createMockRequest('/api/internal/extract-thumbnail', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.skipped).toBe(true);
  });

  it('returns 400 when clip has no video_url', async () => {
    mockChain.single.mockResolvedValueOnce({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        video_url: null,
        thumbnail_url: null,
        season_id: 'season-1',
        vote_count: 0,
        status: 'active',
      },
      error: null,
    });
    const req = createMockRequest('/api/internal/extract-thumbnail', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('no video_url');
  });
});

// ============================================================================
// CROSS-CUTTING: Lock contention (skips when lock held)
// ============================================================================

describe('CROSS-CUTTING: distributed lock contention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthSuccess();
  });
  afterEach(() => jest.resetModules());

  it('auto-advance returns ok/skipped when lock is held', async () => {
    resetChain();
    // Lock insert fails (duplicate key)
    mockChain.insert.mockImplementation(() => {
      const failChain = { ...mockChain };
      failChain.then = jest.fn((resolve: (v: unknown) => void) =>
        Promise.resolve({ data: null, error: { message: 'duplicate key', code: '23505' } }).then(resolve)
      ) as any;
      return failChain;
    });
    setupSupabase();
    // Re-setup to use chain with failing insert
    getMockCreateClient().mockReturnValue({
      from: mockChain.from,
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const { GET } = await import('@/app/api/cron/auto-advance/route');
    const req = createCronRequest('/api/cron/auto-advance', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(true);
  });

  it('cleanup-videos returns 202 when lock is held', async () => {
    resetChain();
    mockChain.insert.mockImplementation(() => {
      const failChain = { ...mockChain };
      failChain.then = jest.fn((resolve: (v: unknown) => void) =>
        Promise.resolve({ data: null, error: { message: 'duplicate key', code: '23505' } }).then(resolve)
      ) as any;
      return failChain;
    });
    getMockCreateClient().mockReturnValue({
      from: mockChain.from,
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const { GET } = await import('@/app/api/cron/cleanup-videos/route');
    const req = createCronRequest('/api/cron/cleanup-videos', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.skipped).toBe(true);
  });

  it('process-movie-scenes returns 202 when lock is held', async () => {
    resetChain();
    mockChain.insert.mockImplementation(() => {
      const failChain = { ...mockChain };
      failChain.then = jest.fn((resolve: (v: unknown) => void) =>
        Promise.resolve({ data: null, error: { message: 'duplicate key', code: '23505' } }).then(resolve)
      ) as any;
      return failChain;
    });
    getMockCreateClient().mockReturnValue({
      from: mockChain.from,
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const { GET } = await import('@/app/api/cron/process-movie-scenes/route');
    const req = createCronRequest('/api/cron/process-movie-scenes', 'test-cron-secret');
    const res = await GET(req as any);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.skipped).toBe(true);
  });
});

// ============================================================================
// CROSS-CUTTING: verifyCronAuth is called with authorization header
// ============================================================================

describe('CROSS-CUTTING: verifyCronAuth invocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthSuccess();
    setupSupabase();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
  });
  afterEach(() => jest.resetModules());

  it('auto-advance passes authorization header to verifyCronAuth', async () => {
    const { GET } = await import('@/app/api/cron/auto-advance/route');
    const req = createCronRequest('/api/cron/auto-advance', 'test-cron-secret');
    await GET(req as any);
    expect(getVerifyCronAuth()).toHaveBeenCalledWith('Bearer test-cron-secret');
  });

  it('cleanup-videos passes authorization header to verifyCronAuth', async () => {
    const { GET } = await import('@/app/api/cron/cleanup-videos/route');
    const req = createCronRequest('/api/cron/cleanup-videos', 'test-cron-secret');
    await GET(req as any);
    expect(getVerifyCronAuth()).toHaveBeenCalledWith('Bearer test-cron-secret');
  });

  it('ai-generation-timeout passes authorization header to verifyCronAuth', async () => {
    const { GET } = await import('@/app/api/cron/ai-generation-timeout/route');
    const req = createCronRequest('/api/cron/ai-generation-timeout', 'test-cron-secret');
    await GET(req as any);
    expect(getVerifyCronAuth()).toHaveBeenCalledWith('Bearer test-cron-secret');
  });

  it('extract-frame passes authorization header to verifyCronAuth', async () => {
    const { POST } = await import('@/app/api/internal/extract-frame/route');
    const req = createMockRequest('/api/internal/extract-frame', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
      headers: { authorization: 'Bearer test-cron-secret' },
    });
    await POST(req as any);
    expect(getVerifyCronAuth()).toHaveBeenCalledWith('Bearer test-cron-secret');
  });

  it('extract-thumbnail passes authorization header to verifyCronAuth', async () => {
    const { POST } = await import('@/app/api/internal/extract-thumbnail/route');
    const req = createMockRequest('/api/internal/extract-thumbnail', {
      method: 'POST',
      body: { clipId: '550e8400-e29b-41d4-a716-446655440000' },
      headers: { authorization: 'Bearer test-cron-secret' },
    });
    await POST(req as any);
    expect(getVerifyCronAuth()).toHaveBeenCalledWith('Bearer test-cron-secret');
  });
});
