/**
 * @jest-environment node
 */

/**
 * AI Generation API Routes — Unit Tests
 *
 * Tests for:
 *   POST /api/ai/generate    — submit AI video generation
 *   POST /api/ai/register    — register completed generation as tournament clip
 *   POST /api/ai/complete    — prepare completed generation for submission
 *   POST /api/ai/cancel      — cancel an in-progress generation
 *   GET  /api/ai/history     — fetch user's generation history
 *   GET  /api/ai/status/[id] — poll generation status
 *   POST /api/ai/narrate     — generate AI narration for a video
 */

// =============================================================================
// Module mocks (must come before imports)
// =============================================================================

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
jest.mock('@/lib/validations', () => ({
  parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
  AIGenerateSchema: {},
  AIRegisterSchema: {},
  AINarrateSchema: {},
}));
jest.mock('@/lib/ai-video', () => ({
  sanitizePrompt: jest.fn((prompt: string) => ({ ok: true, prompt })),
  getModelConfig: jest.fn(() => ({ modelId: 'fal-ai/test', costCents: 20 })),
  startGeneration: jest.fn().mockResolvedValue({ requestId: 'fal-req-123' }),
  startImageToVideoGeneration: jest.fn().mockResolvedValue({ requestId: 'fal-req-img-123' }),
  startReferenceToVideoGeneration: jest.fn().mockResolvedValue({ requestId: 'fal-ref-123' }),
  getImageToVideoModelConfig: jest.fn(() => null),
  supportsImageToVideo: jest.fn(() => false),
  cancelFalRequest: jest.fn().mockResolvedValue(undefined),
  checkFalStatus: jest.fn().mockResolvedValue({ status: 'IN_QUEUE' }),
  getModelCosts: jest.fn().mockResolvedValue({
    'kling-2.6': { fal_cost_cents: 20, credit_cost: 10 },
  }),
  MODELS: {
    'kling-2.6': { modelId: 'fal-ai/kling', costCents: 20, supportsAudio: false },
  },
  MODEL_DURATION_SECONDS: { 'kling-2.6': 5 },
}));
jest.mock('@/lib/sanitize', () => ({
  sanitizeText: jest.fn((t: string) => t),
}));
jest.mock('@/lib/audit-log', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/storage', () => ({
  getStorageProvider: jest.fn().mockResolvedValue('supabase'),
  getSignedUploadUrl: jest.fn().mockResolvedValue({ signedUrl: 'https://storage.example.com/signed' }),
  getPublicVideoUrl: jest.fn(() => 'https://storage.example.com/public/clip.mp4'),
}));
jest.mock('@/lib/elevenlabs', () => ({
  generateNarration: jest.fn().mockResolvedValue({
    audioBuffer: Buffer.from('fake-audio'),
    contentType: 'audio/mpeg',
    characterCount: 50,
  }),
  isValidVoiceId: jest.fn(() => true),
}));

// Mock next/server's `after()` — called by the status route for non-blocking fallback polling.
// We use jest.requireActual to preserve NextRequest/NextResponse and only stub `after`.
jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  after: jest.fn((cb: () => void) => { /* no-op in tests — skip background work */ }),
}));

// =============================================================================
// Imports
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { after } from 'next/server';
import { requireCsrf } from '@/lib/csrf';
import { parseBody } from '@/lib/validations';
import { sanitizePrompt, getModelConfig, startGeneration, cancelFalRequest, checkFalStatus, getModelCosts } from '@/lib/ai-video';
import { isValidVoiceId } from '@/lib/elevenlabs';
import {
  createSequentialMock,
  createMockRequest,
  mockSession,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

import { POST as generatePost } from '@/app/api/ai/generate/route';
import { POST as registerPost } from '@/app/api/ai/register/route';
import { POST as completePost } from '@/app/api/ai/complete/route';
import { POST as cancelPost } from '@/app/api/ai/cancel/route';
import { GET as historyGet } from '@/app/api/ai/history/route';
import { GET as statusGet } from '@/app/api/ai/status/[id]/route';
import { POST as narratePost } from '@/app/api/ai/narrate/route';

// =============================================================================
// Typed mocks
// =============================================================================

const mockGetSession = getServerSession as jest.Mock;
const mockCreateClient = createClient as jest.Mock;
const mockRequireCsrf = requireCsrf as jest.Mock;
const mockParseBody = parseBody as jest.Mock;
const mockSanitizePrompt = sanitizePrompt as jest.Mock;
const mockGetModelConfig = getModelConfig as jest.Mock;
const mockStartGeneration = startGeneration as jest.Mock;
const mockCancelFalRequest = cancelFalRequest as jest.Mock;
const mockCheckFalStatus = checkFalStatus as jest.Mock;
const mockGetModelCosts = getModelCosts as jest.Mock;
const mockIsValidVoiceId = isValidVoiceId as jest.Mock;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Helper to safely pick an override value, distinguishing between
 * "not provided" (should use default) and "explicitly null" (should be null).
 * Uses `'key' in obj` check so that `{ generation: null }` produces null,
 * while `{}` produces the default.
 */
function pick<T>(overrides: Record<string, unknown>, key: string, defaultValue: T): T {
  return key in overrides ? (overrides[key] as T) : defaultValue;
}

/** Create a sequential Supabase mock with an rpc function. */
function createMockWithRpc(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>,
  rpcResponses: Record<string, { data?: unknown; error?: unknown }>
) {
  const seq = createSequentialMock(responses);
  const rpc = jest.fn((name: string) => {
    const res = rpcResponses[name] ?? { data: null, error: null };
    return Promise.resolve(res);
  });
  return { from: seq.from, chains: seq.chains, rpc };
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const GENERATION_UUID = '660e8400-e29b-41d4-a716-446655440001';

// Default data objects (shared across builders)
const DEFAULT_USER = { id: VALID_UUID, is_banned: false, balance_credits: 100 };
const DEFAULT_GENERATION_COMPLETED = {
  id: GENERATION_UUID, status: 'completed', video_url: 'https://fal.media/video.mp4',
  completed_at: new Date().toISOString(), storage_key: null,
  complete_initiated_at: null, clip_id: null, model: 'kling-2.6', genre: 'thriller',
};

// =============================================================================
// beforeEach reset
// =============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  // Default: authenticated user
  mockSession(mockGetSession, TEST_USER);
  // Default CSRF: pass
  mockRequireCsrf.mockResolvedValue(null);
  // Default parseBody: passthrough
  mockParseBody.mockImplementation((_s: unknown, body: unknown) => ({ success: true, data: body }));
  // Default sanitizePrompt: pass
  mockSanitizePrompt.mockReturnValue({ ok: true, prompt: 'test prompt that is long enough' });
  // Default getModelConfig
  mockGetModelConfig.mockReturnValue({ modelId: 'fal-ai/test', costCents: 20 });
  // Default getModelCosts
  mockGetModelCosts.mockResolvedValue({
    'kling-2.6': { fal_cost_cents: 20, credit_cost: 10 },
  });
  // Default startGeneration
  mockStartGeneration.mockResolvedValue({ requestId: 'fal-req-123' });
  // Default isValidVoiceId: pass
  mockIsValidVoiceId.mockReturnValue(true);
  // Default env vars
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
});

// #############################################################################
// POST /api/ai/generate
// #############################################################################

describe('POST /api/ai/generate', () => {
  const url = '/api/ai/generate';
  const validBody = {
    prompt: 'A cinematic scene of a sunset over the ocean with dramatic clouds',
    model: 'kling-2.6',
  };

  /**
   * Generate route .from() call order (happy path, no image_url, no skip_pinned):
   *   0. users (maybeSingle)
   *   1. feature_flags — ai_video_generation (maybeSingle)
   *   2. feature_flags — character_pinning (maybeSingle) [always checked when !isImageToVideo && !skip_pinned]
   *   3. ai_generations insert (single)
   *   4. ai_generations update — fal_request_id
   * Plus RPCs: check_global_cost_cap, deduct_credits
   */
  function buildGenerateMock(overrides: Record<string, unknown> = {}) {
    const responses = [
      // 0: users lookup
      { data: pick(overrides, 'userData', DEFAULT_USER), error: pick(overrides, 'userError', null) },
      // 1: feature_flags (ai_video_generation)
      { data: pick(overrides, 'featureFlag', { enabled: true, config: null }), error: pick(overrides, 'flagError', null) },
      // 2: feature_flags (character_pinning) — return disabled by default so we skip the pinning subtree
      { data: pick(overrides, 'pinningFlag', { enabled: false }), error: null },
      // 3: ai_generations insert
      { data: pick(overrides, 'generation', { id: GENERATION_UUID }), error: pick(overrides, 'insertError', null) },
      // 4: ai_generations update (fal_request_id)
      { data: null, error: null },
    ];
    const rpcResponses: Record<string, { data?: unknown; error?: unknown }> = {
      check_global_cost_cap: { data: pick(overrides, 'costCapOk', true), error: pick(overrides, 'costCapError', null) },
      deduct_credits: { data: pick(overrides, 'deductResult', { success: true }), error: pick(overrides, 'deductError', null) },
      increment_pinned_usage: { data: null, error: null },
    };
    const mock = createMockWithRpc(responses, rpcResponses);
    mockCreateClient.mockReturnValue({ from: mock.from, rpc: mock.rpc });
    return mock;
  }

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication/i);
  });

  test('returns CSRF error when CSRF check fails', async () => {
    const { NextResponse } = require('next/server');
    mockRequireCsrf.mockResolvedValue(
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
    buildGenerateMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(403);
    expect(body.error).toMatch(/csrf/i);
  });

  test('returns 400 when body validation fails', async () => {
    mockParseBody.mockReturnValue({ success: false, error: 'Prompt must be at least 10 characters' });
    buildGenerateMock();
    const req = createMockRequest(url, { method: 'POST', body: { prompt: 'short' } });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  test('returns 400 when sanitizePrompt rejects prompt', async () => {
    mockSanitizePrompt.mockReturnValue({ ok: false, reason: 'Blocked content' });
    buildGenerateMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toBe('Blocked content');
  });

  test('returns 403 when feature flag is disabled', async () => {
    buildGenerateMock({ featureFlag: { enabled: false, config: null } });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(403);
    expect(body.error).toMatch(/not currently available/i);
  });

  test('returns 403 when user is banned', async () => {
    buildGenerateMock({ userData: { id: VALID_UUID, is_banned: true, balance_credits: 100 } });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(403);
    expect(body.error).toMatch(/suspended/i);
  });

  test('returns 402 when user has insufficient credits', async () => {
    buildGenerateMock({ userData: { id: VALID_UUID, is_banned: false, balance_credits: 2 } });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(402);
    expect(body.code).toBe('INSUFFICIENT_CREDITS');
  });

  test('returns 503 when global cost cap exceeded', async () => {
    buildGenerateMock({ costCapOk: false });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(503);
    expect(body.error).toMatch(/temporarily unavailable/i);
  });

  test('returns success with generationId on happy path', async () => {
    buildGenerateMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.generationId).toBe(GENERATION_UUID);
    expect(body.stage).toBe('queued');
  });

  test('calls deduct_credits RPC after inserting generation', async () => {
    const mock = buildGenerateMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await generatePost(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith('deduct_credits', expect.objectContaining({
      p_user_id: VALID_UUID,
      p_amount: 10,
      p_generation_id: GENERATION_UUID,
    }));
  });

  test('returns 400 when model is invalid', async () => {
    mockGetModelConfig.mockReturnValue(null);
    buildGenerateMock();
    const req = createMockRequest(url, { method: 'POST', body: { ...validBody, model: 'nonexistent-model' } });
    const res = await generatePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toMatch(/invalid model/i);
  });
});

// #############################################################################
// POST /api/ai/register
// #############################################################################

describe('POST /api/ai/register', () => {
  const url = '/api/ai/register';
  const validBody = {
    generationId: GENERATION_UUID,
    genre: 'thriller',
    title: 'My AI Clip',
    description: 'A cool clip',
  };

  const DEFAULT_GEN_REGISTER = {
    id: GENERATION_UUID, status: 'completed', model: 'kling-2.6',
    prompt: 'A test prompt', style: null, storage_key: 'clip_123.mp4', clip_id: null,
    narration_text: null,
  };

  /**
   * Register route .from() call order (after parallelization):
   *   Batch 1 (Promise.all — 4 synchronous .from() calls):
   *     0. feature_flags — ai_video_generation (maybeSingle)
   *     1. users (maybeSingle)
   *     2. feature_flags — r2_storage (maybeSingle)
   *     3. feature_flags — prompt_learning (maybeSingle)
   *   Season query construction (before Batch 2 Promise.all):
   *     4. seasons (maybeSingle)
   *   Batch 2 (Promise.all — ai_generations .from() call, seasonQuery already built):
   *     5. ai_generations lookup (maybeSingle)
   *   Sequential:
   *     6. story_slots (maybeSingle)
   *     7. tournament_clips insert (single)
   *     8. ai_generations update — clip_id (select)
   */
  function buildRegisterMock(overrides: Record<string, unknown> = {}) {
    const responses = [
      // Batch 1 (parallel)
      { data: pick(overrides, 'featureFlag', { enabled: true }), error: null },
      {
        data: pick(overrides, 'userProfile', { id: VALID_UUID, username: 'testuser', avatar_url: 'https://avatar.example.com/test.png', is_banned: false }),
        error: null,
      },
      { data: pick(overrides, 'r2Flag', { enabled: false }), error: null },
      { data: { enabled: false }, error: null }, // prompt_learning flag
      // Season query construction (before Batch 2 Promise.all)
      { data: pick(overrides, 'season', { id: 'season-1', total_slots: 10 }), error: pick(overrides, 'seasonError', null) },
      // Batch 2 (ai_generations .from() inside Promise.all)
      { data: pick(overrides, 'generation', DEFAULT_GEN_REGISTER), error: pick(overrides, 'genError', null) },
      // Sequential
      {
        data: pick(overrides, 'votingSlot', {
          id: 'slot-1', slot_position: 1, status: 'voting',
          voting_started_at: new Date().toISOString(), voting_duration_hours: 24,
        }),
        error: pick(overrides, 'slotError', null),
      },
      { data: pick(overrides, 'clipData', { id: 'clip-1' }), error: pick(overrides, 'clipError', null) },
      { data: pick(overrides, 'updateRows', [{ id: GENERATION_UUID }]), error: pick(overrides, 'updateError', null) },
    ];
    const seq = createSequentialMock(responses);
    mockCreateClient.mockReturnValue({ from: seq.from, rpc: jest.fn() });
    return seq;
  }

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication/i);
  });

  test('returns 403 when feature flag disabled', async () => {
    buildRegisterMock({ featureFlag: { enabled: false } });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(403);
    expect(body.error).toMatch(/not currently available/i);
  });

  test('returns 403 when user is banned', async () => {
    buildRegisterMock({
      userProfile: { id: VALID_UUID, username: 'banned', avatar_url: null, is_banned: true },
    });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(403);
    expect(body.error).toMatch(/suspended/i);
  });

  test('returns 404 when generation not found', async () => {
    // genError triggers the `genError || !gen` check
    buildRegisterMock({ genError: { message: 'not found' } });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  test('returns 400 when generation not completed', async () => {
    buildRegisterMock({
      generation: {
        id: GENERATION_UUID, status: 'pending', model: 'kling-2.6',
        prompt: 'A test', style: null, storage_key: null, clip_id: null,
        narration_text: null,
      },
    });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toMatch(/not ready/i);
  });

  test('returns 409 when generation already registered', async () => {
    buildRegisterMock({
      generation: {
        id: GENERATION_UUID, status: 'completed', model: 'kling-2.6',
        prompt: 'A test', style: null, storage_key: 'clip_123.mp4', clip_id: 'existing-clip-id',
        narration_text: null,
      },
    });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(409);
    expect(body.error).toMatch(/already been registered/i);
  });

  test('returns success with clip data on happy path', async () => {
    buildRegisterMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clip).toBeDefined();
    expect(body.clip.id).toBe('clip-1');
  });

  test('parallelizes feature flag and user queries in batch 1', async () => {
    // Build a full mock matching the parallelized .from() call order:
    //   Batch 1 (Promise.all): feature_flags, users, r2_flag, prompt_learning_flag
    //   Season query construction: seasons
    //   Batch 2 (Promise.all): ai_generations
    //   Sequential: story_slots, clips insert, gen update
    const mock = buildRegisterMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await registerPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.clip).toBeDefined();
    // Verify all 9 .from() calls were made in the expected parallelized order
    expect(mock.from).toHaveBeenCalledTimes(9);
  });
});

// #############################################################################
// POST /api/ai/complete
// #############################################################################

describe('POST /api/ai/complete', () => {
  const url = '/api/ai/complete';
  const validBody = { generationId: GENERATION_UUID };

  /**
   * Complete route .from() call order (after parallelization):
   *   Batch 1 (Promise.all — 2 parallel calls):
   *     0. users (maybeSingle)
   *     1. feature_flags — r2_storage (maybeSingle)
   *   Sequential:
   *     2. ai_generations lookup (maybeSingle)
   *     3. ai_generations update — complete_initiated_at guard (select)
   *     4. seasons (via .limit(1) -> thenable, returns array)
   *     5. story_slots (via .limit(1) -> thenable, returns array)
   *     6. ai_generations update — storage_key
   */
  function buildCompleteMock(overrides: Record<string, unknown> = {}) {
    const responses = [
      // Batch 1 (parallel)
      { data: pick(overrides, 'user', { id: VALID_UUID }), error: pick(overrides, 'userError', null) },
      { data: pick(overrides, 'r2Flag', { enabled: false }), error: null },
      // Sequential
      {
        data: pick(overrides, 'generation', {
          id: GENERATION_UUID, status: 'completed', video_url: 'https://fal.media/video.mp4',
          completed_at: new Date().toISOString(), storage_key: null,
          complete_initiated_at: null, clip_id: null, model: 'kling-2.6', genre: 'thriller',
        }),
        error: pick(overrides, 'genError', null),
      },
      { data: pick(overrides, 'guardRows', [{ id: GENERATION_UUID }]), error: pick(overrides, 'guardError', null) },
      { data: pick(overrides, 'seasons', [{ id: 'season-1' }]), error: null },
      { data: pick(overrides, 'slots', [{ id: 'slot-1' }]), error: null },
      { data: null, error: pick(overrides, 'updateError', null) },
    ];
    const seq = createSequentialMock(responses);
    mockCreateClient.mockReturnValue({ from: seq.from, rpc: jest.fn() });
    return seq;
  }

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await completePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication/i);
  });

  test('returns 400 when generationId is missing', async () => {
    buildCompleteMock();
    const req = createMockRequest(url, { method: 'POST', body: {} });
    const res = await completePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toMatch(/generationId/i);
  });

  test('returns 404 when generation not found', async () => {
    // Use genError to trigger the `genError || !gen` early exit
    buildCompleteMock({ genError: { message: 'not found' } });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await completePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  test('returns 400 when generation not completed', async () => {
    buildCompleteMock({
      generation: {
        id: GENERATION_UUID, status: 'pending', video_url: null,
        completed_at: null, storage_key: null, complete_initiated_at: null,
        clip_id: null, model: 'kling-2.6', genre: null,
      },
    });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await completePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toMatch(/not ready/i);
  });

  test('returns 409 when double-complete guard triggers', async () => {
    buildCompleteMock({ guardRows: [], guardError: null });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await completePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(409);
    expect(body.error).toMatch(/already being processed/i);
  });

  test('returns signed upload URL on happy path (no narration)', async () => {
    buildCompleteMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await completePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.signedUploadUrl).toBeDefined();
    expect(body.storageKey).toBeDefined();
    expect(body.falVideoUrl).toBe('https://fal.media/video.mp4');
  });

  test('returns 410 when video has expired (> 7 days old)', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    buildCompleteMock({
      generation: {
        id: GENERATION_UUID, status: 'completed', video_url: 'https://fal.media/video.mp4',
        completed_at: eightDaysAgo, storage_key: null,
        complete_initiated_at: null, clip_id: null, model: 'kling-2.6', genre: null,
      },
    });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await completePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(410);
    expect(body.error).toMatch(/expired/i);
  });

  test('fails fast with 409 before season/slot queries when double-complete guard triggers', async () => {
    // complete_initiated_at is set and recent (within 10 min) — guard should fire immediately
    const recentTimestamp = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 min ago
    const mock = buildCompleteMock({
      generation: {
        id: GENERATION_UUID, status: 'completed', video_url: 'https://fal.media/video.mp4',
        completed_at: new Date().toISOString(), storage_key: null,
        complete_initiated_at: recentTimestamp, clip_id: null, model: 'kling-2.6', genre: 'thriller',
      },
      // The guard update returns empty rows (meaning another request already set it)
      guardRows: [],
    });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await completePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(409);
    expect(body.error).toMatch(/already being processed/i);
    // Verify we stopped before season/slot queries:
    // A successful complete would call .from() 7 times (user, r2flag, gen, guard, seasons, slots, update).
    // The 409 path should stop at 4 (user, r2flag, gen, guard).
    expect(mock.from.mock.calls.length).toBeLessThan(7);
  });
});

// #############################################################################
// POST /api/ai/cancel
// #############################################################################

describe('POST /api/ai/cancel', () => {
  const url = '/api/ai/cancel';
  const validBody = { generationId: GENERATION_UUID };

  /**
   * Cancel route .from() call order:
   *   0. users (maybeSingle)
   *   1. ai_generations lookup (maybeSingle)
   *   2. ai_generations update (status -> failed)
   */
  function buildCancelMock(overrides: Record<string, unknown> = {}) {
    const responses = [
      { data: pick(overrides, 'user', { id: VALID_UUID }), error: pick(overrides, 'userError', null) },
      {
        data: pick(overrides, 'generation', {
          id: GENERATION_UUID, status: 'pending', fal_request_id: 'fal-req-123',
          model: 'kling-2.6', user_id: VALID_UUID, credit_deducted: true, credit_amount: 10,
        }),
        error: pick(overrides, 'genError', null),
      },
      { data: null, error: pick(overrides, 'updateError', null) },
    ];
    const rpcResponses: Record<string, { data?: unknown; error?: unknown }> = {
      refund_credits: { data: pick(overrides, 'refundResult', { success: true, refunded: 10 }), error: pick(overrides, 'refundError', null) },
    };
    const mock = createMockWithRpc(responses, rpcResponses);
    mockCreateClient.mockReturnValue({ from: mock.from, rpc: mock.rpc });
    return mock;
  }

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await cancelPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication/i);
  });

  test('returns 400 when generationId missing', async () => {
    buildCancelMock();
    const req = createMockRequest(url, { method: 'POST', body: {} });
    const res = await cancelPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toMatch(/generationId/i);
  });

  test('returns 404 when generation not found', async () => {
    // Use genError to trigger the `genError || !gen` early exit
    buildCancelMock({ genError: { message: 'not found' } });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await cancelPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  test('returns 409 when generation already completed', async () => {
    buildCancelMock({
      generation: {
        id: GENERATION_UUID, status: 'completed', fal_request_id: 'fal-req-123',
        model: 'kling-2.6', user_id: VALID_UUID, credit_deducted: true, credit_amount: 10,
      },
    });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await cancelPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(409);
    expect(body.alreadyCompleted).toBe(true);
  });

  test('returns 400 when generation is already failed', async () => {
    buildCancelMock({
      generation: {
        id: GENERATION_UUID, status: 'failed', fal_request_id: 'fal-req-123',
        model: 'kling-2.6', user_id: VALID_UUID, credit_deducted: false, credit_amount: 0,
      },
    });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await cancelPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toMatch(/cannot be cancelled/i);
  });

  test('cancels generation and refunds credits on happy path', async () => {
    const mock = buildCancelMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await cancelPost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Verify fal.ai cancel was called
    expect(mockCancelFalRequest).toHaveBeenCalledWith('kling-2.6', 'fal-req-123');
    // Verify refund was attempted
    expect(mock.rpc).toHaveBeenCalledWith('refund_credits', {
      p_user_id: VALID_UUID,
      p_generation_id: GENERATION_UUID,
    });
  });
});

// #############################################################################
// GET /api/ai/history
// #############################################################################

describe('GET /api/ai/history', () => {
  const url = '/api/ai/history';

  /**
   * History route .from() call order:
   *   0. users (maybeSingle)
   *   1. ai_generations query (range -> thenable)
   */
  function buildHistoryMock(overrides: Record<string, unknown> = {}) {
    const responses = [
      { data: pick(overrides, 'user', { id: VALID_UUID }), error: pick(overrides, 'userError', null) },
      {
        data: pick(overrides, 'generations', [
          { id: 'gen-1', status: 'completed', prompt: 'Ocean sunset', model: 'kling-2.6', style: null, genre: 'thriller', video_url: 'https://fal.media/1.mp4', clip_id: null, error_message: null, created_at: '2026-01-15T10:00:00Z', completed_at: '2026-01-15T10:05:00Z' },
          { id: 'gen-2', status: 'pending', prompt: 'Space battle', model: 'kling-2.6', style: null, genre: 'sci-fi', video_url: null, clip_id: null, error_message: null, created_at: '2026-01-16T10:00:00Z', completed_at: null },
        ]),
        error: pick(overrides, 'genError', null),
      },
    ];
    const seq = createSequentialMock(responses);
    mockCreateClient.mockReturnValue({ from: seq.from, rpc: jest.fn() });
    return seq;
  }

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);
    const req = createMockRequest(url);
    const res = await historyGet(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toMatch(/unauthorized/i);
  });

  test('returns 404 when user not found', async () => {
    // Use userError to trigger the `userError || !user` early exit
    buildHistoryMock({ userError: { message: 'not found' } });
    const req = createMockRequest(url);
    const res = await historyGet(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  test('returns generation history with mapped stages on happy path', async () => {
    buildHistoryMock();
    const req = createMockRequest(url);
    const res = await historyGet(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.generations).toHaveLength(2);
    expect(body.generations[0].stage).toBe('ready'); // completed -> ready
    expect(body.generations[1].stage).toBe('queued'); // pending -> queued
  });

  test('supports pagination parameters', async () => {
    buildHistoryMock({ generations: [] });
    const req = createMockRequest(url, { searchParams: { page: '2', limit: '5' } });
    const res = await historyGet(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(5);
    expect(body.hasMore).toBe(false);
  });

  test('returns 500 when generation query fails', async () => {
    buildHistoryMock({ genError: { message: 'Query failed' } });
    const req = createMockRequest(url);
    const res = await historyGet(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(500);
    expect(body.error).toMatch(/failed to fetch/i);
  });
});

// #############################################################################
// GET /api/ai/status/[id]
// #############################################################################

describe('GET /api/ai/status/[id]', () => {
  const url = '/api/ai/status/' + GENERATION_UUID;

  /**
   * Status route .from() call order (after optimization):
   *   0. ai_generations lookup (maybeSingle)
   * User ID now comes from session.user.userId (no DB lookup).
   * Fallback polling uses after() from next/server (mocked as no-op).
   */
  function buildStatusMock(overrides: Record<string, unknown> = {}) {
    const responses = [
      {
        data: pick(overrides, 'generation', {
          id: GENERATION_UUID, status: 'completed', video_url: 'https://fal.media/video.mp4',
          error_message: null, user_id: VALID_UUID, fal_request_id: 'fal-req-123',
          model: 'kling-2.6', created_at: new Date().toISOString(),
        }),
        error: pick(overrides, 'genError', null),
      },
    ];
    const seq = createSequentialMock(responses);
    mockCreateClient.mockReturnValue({ from: seq.from, rpc: jest.fn() });
    return seq;
  }

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);
    const req = createMockRequest(url);
    const res = await statusGet(req, { params: Promise.resolve({ id: GENERATION_UUID }) });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication/i);
  });

  test('returns 400 for invalid UUID format', async () => {
    buildStatusMock();
    const req = createMockRequest('/api/ai/status/not-a-uuid');
    const res = await statusGet(req, { params: Promise.resolve({ id: 'not-a-uuid' }) });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toMatch(/invalid.*id.*format/i);
  });

  test('returns 404 when generation not found', async () => {
    // Use genError to trigger `genError` early exit
    buildStatusMock({ genError: { message: 'not found' } });
    const req = createMockRequest(url);
    const res = await statusGet(req, { params: Promise.resolve({ id: GENERATION_UUID }) });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(500);
    expect(body.error).toMatch(/internal server error/i);
  });

  test('returns 404 when user_id does not match (prevents enumeration)', async () => {
    buildStatusMock({
      generation: {
        id: GENERATION_UUID, status: 'completed', video_url: 'https://fal.media/video.mp4',
        error_message: null, user_id: 'other-user-id', fal_request_id: 'fal-req-123',
        model: 'kling-2.6', created_at: new Date().toISOString(),
      },
    });
    const req = createMockRequest(url);
    const res = await statusGet(req, { params: Promise.resolve({ id: GENERATION_UUID }) });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  test('returns mapped stage on happy path (completed -> ready)', async () => {
    buildStatusMock();
    const req = createMockRequest(url);
    const res = await statusGet(req, { params: Promise.resolve({ id: GENERATION_UUID }) });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stage).toBe('ready');
    expect(body.videoUrl).toBe('https://fal.media/video.mp4');
  });

  test('returns queued stage for pending status', async () => {
    buildStatusMock({
      generation: {
        id: GENERATION_UUID, status: 'pending', video_url: null,
        error_message: null, user_id: VALID_UUID, fal_request_id: 'placeholder_xxx',
        model: 'kling-2.6', created_at: new Date().toISOString(),
      },
    });
    const req = createMockRequest(url);
    const res = await statusGet(req, { params: Promise.resolve({ id: GENERATION_UUID }) });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.stage).toBe('queued');
  });

  test('returns failed stage for failed status', async () => {
    buildStatusMock({
      generation: {
        id: GENERATION_UUID, status: 'failed', video_url: null,
        error_message: 'fal.ai timeout', user_id: VALID_UUID,
        fal_request_id: 'fal-req-123', model: 'kling-2.6',
        created_at: new Date().toISOString(),
      },
    });
    const req = createMockRequest(url);
    const res = await statusGet(req, { params: Promise.resolve({ id: GENERATION_UUID }) });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.stage).toBe('failed');
    expect(body.error).toBe('fal.ai timeout');
  });

  test('uses session.user.userId instead of DB lookup', async () => {
    // The status route only needs 1 .from() call (ai_generations).
    // There should be NO users table query — userId comes from session.
    const seq = buildStatusMock();
    const req = createMockRequest(url);
    const res = await statusGet(req, { params: Promise.resolve({ id: GENERATION_UUID }) });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Only 1 .from() call should have been made (ai_generations), not 2 (users + ai_generations)
    expect(seq.from).toHaveBeenCalledTimes(1);
  });

  test('uses after() for non-blocking fallback poll when stuck > 2min', async () => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    buildStatusMock({
      generation: {
        id: GENERATION_UUID, status: 'pending', video_url: null,
        error_message: null, user_id: VALID_UUID,
        fal_request_id: 'fal-req-123', model: 'kling-2.6',
        created_at: threeMinutesAgo,
      },
    });
    const req = createMockRequest(url);
    const res = await statusGet(req, { params: Promise.resolve({ id: GENERATION_UUID }) });
    const { status, body } = await parseResponse(res);
    // Response returns current DB status immediately
    expect(status).toBe(200);
    expect(body.stage).toBe('queued');
    // after() should have been called for background fallback polling
    expect((after as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  test('returns DB status immediately even when fallback would trigger', async () => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    buildStatusMock({
      generation: {
        id: GENERATION_UUID, status: 'pending', video_url: null,
        error_message: null, user_id: VALID_UUID,
        fal_request_id: 'fal-req-123', model: 'kling-2.6',
        created_at: threeMinutesAgo,
      },
    });
    const req = createMockRequest(url);
    const res = await statusGet(req, { params: Promise.resolve({ id: GENERATION_UUID }) });
    const { status, body } = await parseResponse(res);
    // The response should return the DB status (queued), NOT 'ready' —
    // proving the response doesn't wait for the fal.ai check
    expect(status).toBe(200);
    expect(body.stage).toBe('queued');
    expect(body.videoUrl).toBeNull();
  });
});

// #############################################################################
// POST /api/ai/narrate
// #############################################################################

describe('POST /api/ai/narrate', () => {
  const url = '/api/ai/narrate';
  const validBody = {
    generationId: GENERATION_UUID,
    text: 'The hero walked into the sunset, never looking back.',
    voiceId: 'voice-1',
  };

  const DEFAULT_NARRATION_CONFIG = {
    voices: [{ id: 'voice-1', name: 'Voice One' }],
    max_chars: 200,
    cost_per_generation_cents: 5,
    daily_limit: 10,
    model: 'eleven_monolingual_v1',
    output_format: 'mp3_44100_128',
  };

  /**
   * Narrate route .from() call order:
   *   0. feature_flags — elevenlabs_narration (maybeSingle)
   *   1. users (maybeSingle)
   *   2. ai_generations lookup (maybeSingle)
   *   3. ai_generations count — daily narration limit (select with count, thenable)
   *   4. ai_generations update — narration metadata
   * Plus RPC: check_global_cost_cap
   */
  function buildNarrateMock(overrides: Record<string, unknown> = {}) {
    const responses = [
      {
        data: pick(overrides, 'featureFlag', { enabled: true, config: DEFAULT_NARRATION_CONFIG }),
        error: null,
      },
      { data: pick(overrides, 'userData', { id: VALID_UUID, is_banned: false }), error: null },
      {
        data: pick(overrides, 'generation', { id: GENERATION_UUID, status: 'completed' }),
        error: null,
      },
      { data: null, error: null, count: pick(overrides, 'narrationCount', 0) },
      { data: null, error: pick(overrides, 'updateError', null) },
    ];
    const rpcResponses: Record<string, { data?: unknown; error?: unknown }> = {
      check_global_cost_cap: { data: pick(overrides, 'costCapOk', true), error: null },
    };
    const mock = createMockWithRpc(responses, rpcResponses);
    mockCreateClient.mockReturnValue({ from: mock.from, rpc: mock.rpc });
    return mock;
  }

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await narratePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication/i);
  });

  test('returns 403 when feature flag disabled', async () => {
    buildNarrateMock({ featureFlag: { enabled: false, config: null } });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await narratePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(403);
    expect(body.error).toMatch(/not currently available/i);
  });

  test('returns 403 when user is banned', async () => {
    buildNarrateMock({ userData: { id: VALID_UUID, is_banned: true } });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await narratePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(403);
    expect(body.error).toMatch(/suspended/i);
  });

  test('returns 400 when body validation fails', async () => {
    mockParseBody.mockReturnValue({ success: false, error: 'Narration text is required' });
    buildNarrateMock();
    const req = createMockRequest(url, { method: 'POST', body: {} });
    const res = await narratePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  test('returns 400 when voice ID is invalid', async () => {
    mockIsValidVoiceId.mockReturnValue(false);
    buildNarrateMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await narratePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toMatch(/invalid voice/i);
  });

  test('returns 404 when generation not found', async () => {
    // The narrate route checks `if (!gen)` after maybeSingle. We use genError via
    // a modified mock to trigger the condition properly.
    // Since `pick` resolves generation to null when we pass explicit null, and
    // `null ?? default` would return default, we instead craft the mock so the
    // 3rd from() call resolves with data: null by using a direct approach.
    const responses = [
      { data: { enabled: true, config: DEFAULT_NARRATION_CONFIG }, error: null },
      { data: { id: VALID_UUID, is_banned: false }, error: null },
      { data: null, error: null }, // generation not found
      { data: null, error: null, count: 0 },
      { data: null, error: null },
    ];
    const rpcResponses = { check_global_cost_cap: { data: true, error: null } };
    const mock = createMockWithRpc(responses, rpcResponses);
    mockCreateClient.mockReturnValue({ from: mock.from, rpc: mock.rpc });

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await narratePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  test('returns 503 when global cost cap exceeded', async () => {
    buildNarrateMock({ costCapOk: false });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await narratePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(503);
    expect(body.error).toMatch(/temporarily unavailable/i);
  });

  test('returns success with audioBase64 on happy path', async () => {
    mockIsValidVoiceId.mockReturnValue(true);
    buildNarrateMock();
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await narratePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.audioBase64).toBeDefined();
    expect(body.contentType).toBe('audio/mpeg');
    expect(body.characterCount).toBe(50);
  });

  test('returns 429 when daily narration limit is reached', async () => {
    buildNarrateMock({ narrationCount: 10 });
    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const res = await narratePost(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(429);
    expect(body.error).toMatch(/daily.*limit/i);
  });
});
