/**
 * @jest-environment node
 */
/**
 * validation-fixes.test.ts
 * Input validation and limit bug fixes across API routes.
 * Covers: batch limits, config validation, URL hostname allowlisting,
 *         exact-match queries, and leaderboard limit caps.
 */
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import {
  createSupabaseChain, createMultiTableMock, createMockRequest,
  parseResponse, TEST_USER,
} from '../helpers/api-test-utils';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/admin-auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
  checkAdminAuth: jest.fn().mockResolvedValue({ userId: 'admin', email: 'admin@test.com' }),
}));
jest.mock('@/lib/audit-log', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/leaderboard-redis', () => ({
  getTopVoters: jest.fn().mockResolvedValue(null),
  getVoterRank: jest.fn().mockResolvedValue(null),
  getTopCreators: jest.fn().mockResolvedValue(null),
}));

import { PATCH as moderationPatch } from '@/app/api/admin/moderation/route';
import { DELETE as commentsDelete } from '@/app/api/admin/comments/route';
import { DELETE as notificationsDelete } from '@/app/api/notifications/route';
import { PUT as flagsPut } from '@/app/api/admin/feature-flags/route';
import { GET as downloadGet } from '@/app/api/movie/projects/[id]/download/route';
import { POST as resetUserVotes } from '@/app/api/admin/reset-user-votes/route';
import { GET as votersGet } from '@/app/api/leaderboard/voters/route';
import { GET as creatorsGet } from '@/app/api/leaderboard/creators/route';

const mockCreateClient = createClient as jest.Mock;

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

beforeEach(() => {
  jest.clearAllMocks();
  (getServerSession as jest.Mock).mockResolvedValue({
    user: { email: TEST_USER.email, name: TEST_USER.name, userId: TEST_USER.userId },
  });
});

// === API-6: Batch moderation clip_ids limit (100) ===========================
describe('API-6: Batch moderation clip_ids limit', () => {
  test('PATCH with 101 clip_ids returns 400', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `clip-${i}`);
    const req = createMockRequest('/api/admin/moderation', {
      method: 'PATCH', body: { clip_ids: ids, action: 'approve' },
    });
    const { status, body } = await parseResponse(await moderationPatch(req));
    expect(status).toBe(400);
    expect(body.error).toBe('Maximum 100 clips per batch');
  });

  test('PATCH with 100 clip_ids passes validation', async () => {
    const chain = createSupabaseChain({ data: [], error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });
    const ids = Array.from({ length: 100 }, (_, i) => `clip-${i}`);
    const req = createMockRequest('/api/admin/moderation', {
      method: 'PATCH', body: { clip_ids: ids, action: 'approve' },
    });
    const { status } = await parseResponse(await moderationPatch(req));
    expect(status).toBe(200);
  });
});

// === API-7: Batch delete comments limit (200) ===============================
describe('API-7: Batch delete comments limit', () => {
  test('DELETE with 201 commentIds returns 400', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `cmt-${i}`);
    const req = createMockRequest('/api/admin/comments', {
      method: 'DELETE', body: { commentIds: ids },
    });
    const { status, body } = await parseResponse(await commentsDelete(req));
    expect(status).toBe(400);
    expect(body.error).toBe('Maximum 200 comments per bulk delete');
  });

  test('DELETE with 200 commentIds passes validation', async () => {
    const multi = createMultiTableMock({
      users: { data: { id: 'admin-id' }, error: null },
      comments: { data: null, error: null },
    });
    mockCreateClient.mockReturnValue({ from: multi.from });
    const ids = Array.from({ length: 200 }, (_, i) => `cmt-${i}`);
    const req = createMockRequest('/api/admin/comments', {
      method: 'DELETE', body: { commentIds: ids },
    });
    const { status, body } = await parseResponse(await commentsDelete(req));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// === API-8: Batch delete notifications limit (500) ==========================
describe('API-8: Batch delete notifications limit', () => {
  test('DELETE with 501 notification_ids returns 400', async () => {
    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });
    const ids = Array.from({ length: 501 }, (_, i) => `notif-${i}`);
    const req = createMockRequest('/api/notifications', {
      method: 'DELETE', body: { notification_ids: ids },
    });
    const { status, body } = await parseResponse(await notificationsDelete(req));
    expect(status).toBe(400);
    expect(body.error).toBe('Maximum 500 notifications per delete');
  });

  test('DELETE with 500 notification_ids passes validation', async () => {
    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });
    const ids = Array.from({ length: 500 }, (_, i) => `notif-${i}`);
    const req = createMockRequest('/api/notifications', {
      method: 'DELETE', body: { notification_ids: ids },
    });
    const { status, body } = await parseResponse(await notificationsDelete(req));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// === API-12: Feature flags config validation ================================
describe('API-12: Feature flags config validation', () => {
  test('PUT with config=[] returns 400', async () => {
    const req = createMockRequest('/api/admin/feature-flags', {
      method: 'PUT', body: { key: 'test_flag', config: [] },
    });
    const { status, body } = await parseResponse(await flagsPut(req));
    expect(status).toBe(400);
    expect(body.error).toBe('config must be a JSON object');
  });

  test('PUT with config=null returns 400', async () => {
    const req = createMockRequest('/api/admin/feature-flags', {
      method: 'PUT', body: { key: 'test_flag', config: null },
    });
    const { status, body } = await parseResponse(await flagsPut(req));
    expect(status).toBe(400);
    expect(body.error).toBe('config must be a JSON object');
  });

  test('PUT with config="string" returns 400', async () => {
    const req = createMockRequest('/api/admin/feature-flags', {
      method: 'PUT', body: { key: 'test_flag', config: 'string' },
    });
    const { status, body } = await parseResponse(await flagsPut(req));
    expect(status).toBe(400);
    expect(body.error).toBe('config must be a JSON object');
  });

  test('PUT with oversized config returns 400', async () => {
    const req = createMockRequest('/api/admin/feature-flags', {
      method: 'PUT', body: { key: 'test_flag', config: { large: 'x'.repeat(10001) } },
    });
    const { status, body } = await parseResponse(await flagsPut(req));
    expect(status).toBe(400);
    expect(body.error).toBe('config too large');
  });

  test('PUT with valid config passes validation', async () => {
    const chain = createSupabaseChain({
      data: { key: 'test_flag', name: 'Test Flag', enabled: true, config: { valid: true } },
      error: null,
    });
    mockCreateClient.mockReturnValue({ from: chain.from });
    const req = createMockRequest('/api/admin/feature-flags', {
      method: 'PUT', body: { key: 'test_flag', config: { valid: true } },
    });
    const { status } = await parseResponse(await flagsPut(req));
    expect(status).toBe(200);
  });
});

// === API-5: Download route URL hostname validation ==========================
describe('API-5: Download URL hostname validation', () => {
  const context = { params: Promise.resolve({ id: 'proj-1' }) };

  function buildDownloadMock(finalVideoUrl: string) {
    const multi = createMultiTableMock({
      users: { data: { id: 'user-1' }, error: null },
      movie_projects: {
        data: {
          id: 'proj-1', status: 'completed', user_id: 'user-1',
          title: 'Test', final_video_url: finalVideoUrl, total_duration_seconds: 60,
        },
        error: null,
      },
    });
    const storageMock = {
      from: jest.fn().mockReturnValue({
        createSignedUrl: jest.fn().mockResolvedValue({ data: null }),
      }),
    };
    mockCreateClient.mockReturnValue({ from: multi.from, storage: storageMock });
  }

  test('malicious URL is blocked', async () => {
    buildDownloadMock('https://evil.com/steal-data');
    const req = createMockRequest('/api/movie/projects/proj-1/download');
    const { status, body } = await parseResponse(await downloadGet(req, context));
    expect(status).toBe(500);
    expect(body.error).toBe('Download URL not available');
  });

  test('valid Supabase storage URL is allowed', async () => {
    const validUrl = 'https://myproject.supabase.co/storage/v1/object/videos/final.mp4';
    buildDownloadMock(validUrl);
    const req = createMockRequest('/api/movie/projects/proj-1/download');
    const res = await downloadGet(req, context);
    expect([301, 302, 307, 308]).toContain(res.status);
    expect(res.headers.get('location')).toBe(validUrl);
  });
});

// === API-13: reset-user-votes uses eq not ilike =============================
describe('API-13: reset-user-votes uses eq not ilike', () => {
  test('username lookup uses .eq() for exact match', async () => {
    const chain = createSupabaseChain({
      data: { id: 'user-1', username: 'testuser', email: 'test@test.com' },
      error: null,
    });
    mockCreateClient.mockReturnValue({ from: chain.from });
    const req = createMockRequest('/api/admin/reset-user-votes', {
      method: 'POST', body: { username: 'testuser' },
    });
    await resetUserVotes(req);

    const eqCalls = chain._calls.filter(c => c.method === 'eq' && c.args[0] === 'username');
    expect(eqCalls.length).toBeGreaterThan(0);
    expect(eqCalls[0].args).toEqual(['username', 'testuser']);

    const ilikeCalls = chain._calls.filter(c => c.method === 'ilike' && c.args[0] === 'username');
    expect(ilikeCalls.length).toBe(0);
  });
});

// === API-10, API-11: Leaderboard limit caps (100) ===========================
describe('API-10: Voters leaderboard limit cap', () => {
  function buildVotersMock() {
    const chain = createSupabaseChain({ data: [], error: null });
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'no rpc' } });
    mockCreateClient.mockReturnValue({ from: chain.from, rpc });
  }

  test('limit=200 is capped to 100', async () => {
    buildVotersMock();
    const req = createMockRequest('/api/leaderboard/voters', { searchParams: { limit: '200' } });
    const { body } = await parseResponse(await votersGet(req));
    expect(body.page_size).toBeLessThanOrEqual(100);
  });

  test('limit=50 is respected as-is', async () => {
    buildVotersMock();
    const req = createMockRequest('/api/leaderboard/voters', { searchParams: { limit: '50' } });
    const { body } = await parseResponse(await votersGet(req));
    expect(body.page_size).toBe(50);
  });
});

describe('API-11: Creators leaderboard limit cap', () => {
  function buildCreatorsMock() {
    const chain = createSupabaseChain({ data: [], error: null });
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'no rpc' } });
    mockCreateClient.mockReturnValue({ from: chain.from, rpc });
  }

  test('limit=200 is capped to 100', async () => {
    buildCreatorsMock();
    const req = createMockRequest('/api/leaderboard/creators', { searchParams: { limit: '200' } });
    const { body } = await parseResponse(await creatorsGet(req));
    expect(body.page_size).toBeLessThanOrEqual(100);
  });

  test('limit=50 is respected as-is', async () => {
    buildCreatorsMock();
    const req = createMockRequest('/api/leaderboard/creators', { searchParams: { limit: '50' } });
    const { body } = await parseResponse(await creatorsGet(req));
    expect(body.page_size).toBe(50);
  });
});
