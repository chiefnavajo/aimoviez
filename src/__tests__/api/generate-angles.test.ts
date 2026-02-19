/** @jest-environment node */

/**
 * POST /api/ai/characters/[id]/generate-angles — Unit Tests
 *
 * Auto-generate left/right/rear reference angle views from a frontal photo.
 * Tests cover auth, feature flag, ownership checks, skip logic, happy path,
 * partial success, and total failure.
 */

// =============================================================================
// Module mocks (must come before imports)
// =============================================================================

/* eslint-disable no-var */
var mockGenerateCharacterAngle: jest.Mock;
/* eslint-enable no-var */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/ai-video', () => {
  mockGenerateCharacterAngle = jest.fn();
  return {
    generateCharacterAngle: mockGenerateCharacterAngle,
    ANGLE_PROMPTS: ['@Image1 left', '@Image1 right', '@Image1 rear'],
  };
});
jest.mock('@/lib/storage', () => ({
  getStorageProvider: jest.fn().mockResolvedValue('supabase'),
  getSignedUploadUrl: jest.fn().mockResolvedValue({
    signedUrl: 'https://storage.example.com/signed',
    publicUrl: 'https://storage.example.com/public/angle.png',
    key: 'user-characters/test/angle.png',
  }),
}));

// =============================================================================
// Imports
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import {
  createSequentialMock,
  createMockRequest,
  mockSession,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';
import { POST } from '@/app/api/ai/characters/[id]/generate-angles/route';

// =============================================================================
// Typed mocks
// =============================================================================

const mockGetSession = getServerSession as jest.Mock;
const mockCreateClient = createClient as jest.Mock;

// =============================================================================
// Helpers
// =============================================================================

const CHARACTER_ID = '880e8400-e29b-41d4-a716-446655440003';
const VALID_UUID = TEST_USER.userId;

const DEFAULT_USER = { id: VALID_UUID };
const DEFAULT_CHARACTER = {
  id: CHARACTER_ID,
  frontal_image_url: 'https://cdn.example.com/frontal.jpg',
  reference_image_urls: [],
};

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

/**
 * Build a sequential Supabase mock for the generate-angles route.
 *
 * .from() call order:
 *   0. feature_flags (user_characters + auto_generate_angles) — .in() returns array
 *   1. users — maybeSingle
 *   2. user_characters — maybeSingle
 *   3. feature_flags (r2_storage) — maybeSingle
 * RPC calls: append_user_character_angle (up to 3 times)
 */
function buildGenerateAnglesMock(overrides: Record<string, unknown> = {}) {
  // flag can be: { enabled: true/false } (single-flag format) or an array of rows
  const flagEnabled = overrides.flag !== undefined
    ? (overrides.flag as { enabled: boolean } | null)?.enabled ?? false
    : true;
  const flagRows = flagEnabled
    ? [{ key: 'user_characters', enabled: true }, { key: 'auto_generate_angles', enabled: true }]
    : [];
  const user = overrides.user !== undefined ? overrides.user : DEFAULT_USER;
  const character = overrides.character !== undefined ? overrides.character : DEFAULT_CHARACTER;
  const r2Flag = overrides.r2Flag !== undefined ? overrides.r2Flag : { enabled: false };

  const responses = [
    // 0: feature_flags (.in() query — returns array)
    { data: flagRows, error: null },
    // 1: users
    { data: user, error: null },
    // 2: user_characters
    { data: character, error: null },
    // 3: feature_flags (r2_storage)
    { data: r2Flag, error: null },
  ];

  const rpcResult = overrides.rpcResult !== undefined
    ? overrides.rpcResult
    : [{ id: CHARACTER_ID, reference_image_urls: ['url'] }];
  const rpcError = overrides.rpcError !== undefined ? overrides.rpcError : null;

  const rpcResponses: Record<string, { data?: unknown; error?: unknown }> = {
    append_user_character_angle: { data: rpcResult, error: rpcError },
  };

  const mock = createMockWithRpc(responses, rpcResponses);
  mockCreateClient.mockReturnValue({ from: mock.from, rpc: mock.rpc });
  return mock;
}

function callRoute(characterId: string = CHARACTER_ID) {
  const req = createMockRequest(`/api/ai/characters/${characterId}/generate-angles`, {
    method: 'POST',
  });
  return POST(req, { params: Promise.resolve({ id: characterId }) });
}

// =============================================================================
// Mock global.fetch for image download and upload
// =============================================================================

const originalFetch = global.fetch;
const mockFetch = jest.fn();

// =============================================================================
// beforeEach / afterEach
// =============================================================================

beforeEach(() => {
  jest.clearAllMocks();
  mockSession(mockGetSession, TEST_USER);

  // Default: successful fal.ai generation
  mockGenerateCharacterAngle.mockResolvedValue('https://fal.ai/generated/angle.png');

  // Default: fetch mocks for image download + upload
  mockFetch
    // Download from fal.ai
    .mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('fal.ai')) {
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
          headers: new Map([['content-type', 'image/png']]),
        });
      }
      // Upload to storage
      return Promise.resolve({ ok: true });
    });

  global.fetch = mockFetch as unknown as typeof fetch;

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

afterEach(() => {
  global.fetch = originalFetch;
});

// #############################################################################
// Tests
// #############################################################################

describe('POST /api/ai/characters/[id]/generate-angles', () => {
  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);
    const res = await callRoute();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toMatch(/authentication/i);
  });

  test('returns 403 when feature flag is disabled', async () => {
    buildGenerateAnglesMock({ flag: { enabled: false } });
    const res = await callRoute();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(403);
    expect(body.error).toMatch(/not enabled/i);
  });

  test('returns 404 when user not found', async () => {
    buildGenerateAnglesMock({ user: null });
    const res = await callRoute();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(404);
    expect(body.error).toMatch(/user not found/i);
  });

  test('returns 404 when character not found or not owned', async () => {
    buildGenerateAnglesMock({ character: null });
    const res = await callRoute();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(404);
    expect(body.error).toMatch(/not found|not owned/i);
  });

  test('skips generation when character already has >= 3 angles', async () => {
    buildGenerateAnglesMock({
      character: {
        id: CHARACTER_ID,
        frontal_image_url: 'https://cdn.example.com/frontal.jpg',
        reference_image_urls: [
          'https://cdn.example.com/left.png',
          'https://cdn.example.com/right.png',
          'https://cdn.example.com/rear.png',
        ],
      },
    });
    const res = await callRoute();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(true);
    expect(body.reference_count).toBe(3);
    // generateCharacterAngle should NOT have been called
    expect(mockGenerateCharacterAngle).not.toHaveBeenCalled();
  });

  test('happy path: generates 3 angles and returns generated count', async () => {
    buildGenerateAnglesMock();
    mockGenerateCharacterAngle
      .mockResolvedValueOnce('https://fal.ai/generated/left.png')
      .mockResolvedValueOnce('https://fal.ai/generated/right.png')
      .mockResolvedValueOnce('https://fal.ai/generated/rear.png');

    const res = await callRoute();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.generated).toBe(3);
    expect(body.reference_count).toBe(3); // 0 existing + 3 new
    expect(mockGenerateCharacterAngle).toHaveBeenCalledTimes(3);
  });

  test('partial success: 1 of 3 fal.ai calls fails, returns generated: 2', async () => {
    buildGenerateAnglesMock();
    mockGenerateCharacterAngle
      .mockResolvedValueOnce('https://fal.ai/generated/left.png')
      .mockRejectedValueOnce(new Error('fal.ai timeout'))
      .mockResolvedValueOnce('https://fal.ai/generated/rear.png');

    const res = await callRoute();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.generated).toBe(2);
    expect(body.reference_count).toBe(2); // 0 existing + 2 new
  });

  test('all fal.ai calls fail, returns generated: 0', async () => {
    buildGenerateAnglesMock();
    mockGenerateCharacterAngle
      .mockRejectedValueOnce(new Error('fal.ai error 1'))
      .mockRejectedValueOnce(new Error('fal.ai error 2'))
      .mockRejectedValueOnce(new Error('fal.ai error 3'));

    const res = await callRoute();
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.generated).toBe(0);
    expect(body.reference_count).toBe(0); // 0 existing + 0 new
  });
});
