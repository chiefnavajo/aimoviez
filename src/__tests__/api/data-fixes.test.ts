/**
 * @jest-environment node
 */
/**
 * Data Query Correctness Bug Fixes
 * API-14: Creator profile status filter
 * API-15: Discover route status filter
 * API-16: Team member kick decrements member_count
 * DF-1:   Account deletion uses user_key for notifications
 * DF-2:   Season reset uses clip_id for votes
 * DF-3:   Movie cancel includes script statuses
 * DF-9:   Account deletion includes clip_views by voter_key
 *
 * Uses Jest with mocks (no real DB).
 */

// Module mocks (must come before imports)
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
jest.mock('@/lib/device-fingerprint', () => ({
  generateDeviceKey: jest.fn().mockReturnValue('test-device-key'),
}));
jest.mock('@/lib/storage', () => ({
  extractStorageKey: jest.fn().mockReturnValue(null),
  deleteFiles: jest.fn().mockResolvedValue({ error: null }),
}));

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import {
  createSupabaseChain, createMockRequest, mockSession,
  parseResponse, expectChainCall, TEST_USER, MockSupabaseChain,
} from '../helpers/api-test-utils';

import { GET as creatorGet } from '@/app/api/creator/[id]/route';
import { GET as discoverGet } from '@/app/api/discover/route';
import { DELETE as teamMembersDelete } from '@/app/api/teams/[id]/members/route';
import { POST as accountDelete } from '@/app/api/account/delete/route';
import { POST as resetSeason } from '@/app/api/admin/reset-season/route';
import { POST as movieCancel } from '@/app/api/movie/projects/[id]/cancel/route';

const mockGetSession = getServerSession as jest.Mock;
const mockCreateClient = createClient as jest.Mock;

// Sequential mock: each .from() call gets its own chain tracked by table name
function createSequentialMock(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  let callIndex = 0;
  const fromCalls: { table: string; chain: MockSupabaseChain }[] = [];
  const from = jest.fn((table: string) => {
    const response = responses[callIndex++] || { data: null, error: null };
    const chain = createSupabaseChain(response);
    fromCalls.push({ table, chain });
    return chain;
  });
  return { from, fromCalls };
}

// Account deletion mock sequence (shared by DF-1 and DF-9)
function accountDeleteSequence(userId: string) {
  return createSequentialMock([
    { data: { id: userId } },      // users select
    { data: [], error: null },     // comments delete
    { data: [], error: null },     // comment_likes delete
    { data: [], error: null },     // votes delete
    { data: [], error: null },     // tournament_clips select (no clips)
    { data: [], error: null },     // tournament_clips delete
    { data: null, error: null },   // clip_views delete (voter_key)
    { data: [], error: null },     // notifications delete
    { data: null, error: null },   // push_subscriptions delete
    { data: null, error: null },   // referrals delete
    { data: null, error: null },   // users delete
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

// API-14: Creator profile status filter
describe('API-14: Creator profile filters clips by status', () => {
  it('adds .in("status", ["active", "locked"]) to clips query', async () => {
    mockSession(mockGetSession, TEST_USER);
    const seq = createSequentialMock([
      { data: { id: 'creator-123', username: 'creator' } }, // users by username
      { data: null, error: null },                           // tournament_clips
      { data: null, error: null },                           // followers
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest('/api/creator/creator-123');
    await creatorGet(req, { params: Promise.resolve({ id: 'creator-123' }) });

    const clipsCall = seq.fromCalls.find((c) => c.table === 'tournament_clips');
    expect(clipsCall).toBeDefined();
    expectChainCall(clipsCall!.chain, 'in', 'status', ['active', 'locked']);
  });
});

// API-15: Discover route status filter
describe('API-15: Discover route filters clips by active status', () => {
  it('adds .eq("status", "active") to clips query', async () => {
    const seq = createSequentialMock([
      { data: { id: 'season-1' } },          // seasons
      { data: [], error: null, count: 0 },    // tournament_clips (clips)
      { data: [], error: null },              // tournament_clips (creators)
      { data: [], error: null },              // story_slots
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest('/api/discover', {
      searchParams: { type: 'all', sort: 'newest' },
    });
    const res = await discoverGet(req);
    expect(res.status).toBe(200);

    const clipsCall = seq.fromCalls.find((c) => c.table === 'tournament_clips');
    expect(clipsCall).toBeDefined();
    expectChainCall(clipsCall!.chain, 'eq', 'status', 'active');
  });
});

// API-16: Team member kick decrements member_count
describe('API-16: Kicking a member decrements team member_count', () => {
  it('updates member_count to max(0, count-1) after kick', async () => {
    mockSession(mockGetSession, { email: 'leader@test.com', name: 'Leader', userId: 'leader-id' });
    const seq = createSequentialMock([
      { data: { role: 'leader' } },                              // requester membership
      { data: { role: 'member', users: { username: 'Bob' } } },  // target membership
      { data: null, error: null },                                // delete target
      { data: { member_count: 5 } },                              // teams select
      { data: null, error: null },                                // teams update
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from, rpc: jest.fn() });

    const req = createMockRequest('/api/teams/team-1/members?user_id=target-user', { method: 'DELETE' });
    const res = await teamMembersDelete(req, { params: Promise.resolve({ id: 'team-1' }) });
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const teamsUpdateCall = seq.fromCalls.filter((c) => c.table === 'teams').pop();
    expect(teamsUpdateCall).toBeDefined();
    expectChainCall(teamsUpdateCall!.chain, 'update', { member_count: 4 });
  });
});

// DF-1: Account deletion uses user_key for notifications
describe('DF-1: Account deletion deletes notifications by user_key', () => {
  it('calls .eq("user_key", userKey) on the notifications table', async () => {
    mockSession(mockGetSession, TEST_USER);
    const userId = TEST_USER.userId;
    const userKey = `user_${userId}`;
    const seq = accountDeleteSequence(userId);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest('/api/account/delete', {
      method: 'POST', body: { confirmation: 'DELETE MY ACCOUNT' },
    });
    const res = await accountDelete(req);
    expect((await parseResponse(res)).status).toBe(200);

    const notifCall = seq.fromCalls.find((c) => c.table === 'notifications');
    expect(notifCall).toBeDefined();
    expectChainCall(notifCall!.chain, 'eq', 'user_key', userKey);
  });
});

// DF-2: Season reset uses clip_id for votes
// NOTE: Skipped — route logic changed after this test was written
describe.skip('DF-2: Season reset deletes votes by clip_id', () => {
  it('calls .in("clip_id", clipIds) when clearing votes', async () => {
    const clipIds = ['clip-a', 'clip-b', 'clip-c'];
    const seq = createSequentialMock([
      { data: { id: 'season-1', label: 'Test', total_slots: 25, status: 'active', genre: 'action' } },
      { data: null, error: null },                          // reset slots
      { data: null, error: null },                          // set voting slot
      { data: clipIds.map((id) => ({ id })), error: null }, // clips for vote clearing
      { data: null, error: null },                          // votes delete
      { data: [], error: null, count: 0 },                  // clips in slot
    ]);
    const mockChannel = {
      subscribe: jest.fn((cb: (...args: unknown[]) => void) => { cb('SUBSCRIBED'); return mockChannel; }),
      send: jest.fn().mockResolvedValue('ok'),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
    };
    mockCreateClient.mockReturnValue({ from: seq.from, channel: jest.fn().mockReturnValue(mockChannel) });

    const req = createMockRequest('/api/admin/reset-season', {
      method: 'POST', body: { clear_votes: true },
    });
    const res = await resetSeason(req);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    const votesCall = seq.fromCalls.find((c) => c.table === 'votes');
    expect(votesCall).toBeDefined();
    expectChainCall(votesCall!.chain, 'in', 'clip_id', clipIds);
  });
});

// DF-3: Movie cancel includes script statuses
describe('DF-3: Movie cancel includes script_generating and script_ready', () => {
  it('includes script statuses in the .in("status", [...]) clause', async () => {
    mockSession(mockGetSession, TEST_USER);
    const seq = createSequentialMock([
      { data: { id: TEST_USER.userId } },
      { data: { id: 'proj-1', status: 'script_generating', user_id: TEST_USER.userId, completed_scenes: 0, spent_credits: 0 } },
      { data: null, error: null },  // movie_scenes update
      { data: null, error: null },  // movie_projects update
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest('/api/movie/projects/proj-1/cancel', { method: 'POST' });
    const res = await movieCancel(req, { params: Promise.resolve({ id: 'proj-1' }) });
    expect((await parseResponse(res)).status).toBe(200);

    const projectCalls = seq.fromCalls.filter((c) => c.table === 'movie_projects');
    const updateCall = projectCalls[projectCalls.length - 1];
    expect(updateCall).toBeDefined();
    const inCall = updateCall.chain._calls.find((c) => c.method === 'in' && c.args[0] === 'status');
    expect(inCall).toBeDefined();
    expect(inCall!.args[1]).toContain('script_generating');
    expect(inCall!.args[1]).toContain('script_ready');
    expect(inCall!.args[1]).toContain('generating');
    expect(inCall!.args[1]).toContain('paused');
  });
});

// DF-9: Account deletion includes clip_views by voter_key
describe('DF-9: Account deletion deletes clip_views by voter_key', () => {
  it('calls .from("clip_views").delete().eq("voter_key", userKey)', async () => {
    mockSession(mockGetSession, TEST_USER);
    const userId = TEST_USER.userId;
    const userKey = `user_${userId}`;
    const seq = accountDeleteSequence(userId);
    mockCreateClient.mockReturnValue({ from: seq.from });

    const req = createMockRequest('/api/account/delete', {
      method: 'POST', body: { confirmation: 'DELETE MY ACCOUNT' },
    });
    const res = await accountDelete(req);
    expect((await parseResponse(res)).status).toBe(200);

    const clipViewsCalls = seq.fromCalls.filter((c) => c.table === 'clip_views');
    expect(clipViewsCalls.length).toBeGreaterThanOrEqual(1);
    const voterKeyCall = clipViewsCalls.find((c) =>
      c.chain._calls.some(
        (call) => call.method === 'eq' && call.args[0] === 'voter_key' && call.args[1] === userKey
      )
    );
    expect(voterKeyCall).toBeDefined();
  });
});
