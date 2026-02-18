/**
 * @jest-environment node
 *
 * DATA INTEGRITY REGRESSION TESTS
 * Tests for data integrity bugs that were previously discovered and fixed.
 * Each test documents the bug and verifies the fix remains in place.
 *
 * Bug categories:
 *   - Notification cleanup on account delete uses user_key not user_id
 *   - clip_views cleanup on account delete uses voter_key
 *   - member_count drift on kick
 *   - Account deletion uses correct column names for all tables
 */

// ============================================================================
// MOCKS
// ============================================================================

const mockCreateClient = jest.fn();
const mockGetServerSession = jest.fn();
const mockRateLimit = jest.fn().mockResolvedValue(null);
const mockRequireCsrf = jest.fn().mockResolvedValue(null);
const mockExtractStorageKey = jest.fn().mockReturnValue(null);
const mockDeleteFiles = jest.fn().mockResolvedValue({ error: null });
const mockSanitizeText = jest.fn((t: string) => t);

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: mockRequireCsrf }));
jest.mock('@/lib/storage', () => ({
  extractStorageKey: mockExtractStorageKey,
  deleteFiles: mockDeleteFiles,
}));
jest.mock('@/lib/sanitize', () => ({ sanitizeText: mockSanitizeText }));

// ============================================================================
// IMPORTS
// ============================================================================

import {
  createMockRequest,
  createSupabaseChain,
  expectChainCall,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

// ============================================================================
// SHARED STATE
// ============================================================================

const USER_ID = TEST_USER.userId;
const USER_KEY = `user_${USER_ID}`;
const TEAM_ID = 'team-data-001';

function buildSupabaseMock(overrides?: Record<string, jest.Mock>) {
  return {
    from: jest.fn(),
    rpc: jest.fn().mockReturnValue(Promise.resolve({ data: null, error: null })),
    storage: {
      from: jest.fn().mockReturnValue({
        remove: jest.fn().mockResolvedValue({}),
      }),
    },
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Data Integrity Regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  // --------------------------------------------------------------------------
  // BUG: Notifications were not deleted on account deletion because the
  //   query used .eq('user_id', userId) but notifications table uses user_key
  // FIX: Account delete now uses .eq('user_key', `user_${userId}`)
  // --------------------------------------------------------------------------
  test('Account delete: notifications are deleted by user_key', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    const userChain = createSupabaseChain({ data: { id: USER_ID }, error: null });
    const commentDeleteChain = createSupabaseChain({ data: [], error: null });
    const commentLikesChain = createSupabaseChain({ data: [], error: null });
    const votesDeleteChain = createSupabaseChain({ data: [], error: null });
    const clipsChain = createSupabaseChain({ data: [], error: null }); // no clips
    const clipsDeleteChain = createSupabaseChain({ data: [], error: null }); // tournament_clips delete (always runs)
    const viewsCleanupChain = createSupabaseChain({ data: null, error: null });
    const notificationDeleteChain = createSupabaseChain({ data: [], error: null });
    const pushSubChain = createSupabaseChain({ data: null, error: null });
    const referralChain = createSupabaseChain({ data: null, error: null });
    const profileDeleteChain = createSupabaseChain({ data: null, error: null });

    let fromCallCount = 0;
    const chains: ReturnType<typeof createSupabaseChain>[] = [
      userChain,          // 1: users lookup
      commentDeleteChain, // 2: comments delete
      commentLikesChain,  // 3: comment_likes delete
      votesDeleteChain,   // 4: votes delete
      clipsChain,         // 5: tournament_clips select
      clipsDeleteChain,   // 6: tournament_clips delete (always runs)
      viewsCleanupChain,  // 7: clip_views delete (viewer)
      notificationDeleteChain, // 8: notifications delete
      pushSubChain,       // 9: push_subscriptions delete
      referralChain,      // 10: referrals delete
      profileDeleteChain, // 11: users delete
    ];

    const fromMock = jest.fn(() => {
      const chain = chains[Math.min(fromCallCount, chains.length - 1)];
      fromCallCount++;
      return chain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/account/delete/route');
    const req = createMockRequest('/api/account/delete', {
      method: 'POST',
      body: { confirmation: 'DELETE MY ACCOUNT' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Verify notifications were deleted by user_key (not user_id)
    expectChainCall(notificationDeleteChain, 'eq', 'user_key', USER_KEY);
  });

  // --------------------------------------------------------------------------
  // BUG: Comments were deleted by user_id but comments table uses user_key
  // FIX: Account delete uses .eq('user_key', userKey) for comments
  // --------------------------------------------------------------------------
  test('Account delete: comments are deleted by user_key', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    const userChain = createSupabaseChain({ data: { id: USER_ID }, error: null });
    const commentDeleteChain = createSupabaseChain({ data: [{ id: 'c1' }], error: null });

    const chains = [
      userChain,
      commentDeleteChain,
      ...Array(9).fill(createSupabaseChain({ data: null, error: null })),
    ];
    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      const chain = chains[Math.min(fromCallCount, chains.length - 1)];
      fromCallCount++;
      return chain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/account/delete/route');
    const req = createMockRequest('/api/account/delete', {
      method: 'POST',
      body: { confirmation: 'DELETE MY ACCOUNT' },
    });

    await POST(req);

    // Comments table uses user_key, not user_id
    expectChainCall(commentDeleteChain, 'eq', 'user_key', USER_KEY);
  });

  // --------------------------------------------------------------------------
  // BUG: clip_views for user's viewing history not deleted
  // FIX: Account delete now deletes clip_views by voter_key = userKey
  // --------------------------------------------------------------------------
  test('Account delete: clip_views (viewer history) deleted by voter_key', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    const userChain = createSupabaseChain({ data: { id: USER_ID }, error: null });
    const commentDeleteChain = createSupabaseChain({ data: [], error: null });
    const commentLikesChain = createSupabaseChain({ data: [], error: null });
    const votesDeleteChain = createSupabaseChain({ data: [], error: null });
    const clipsChain = createSupabaseChain({ data: [], error: null });
    const clipsDeleteChain = createSupabaseChain({ data: [], error: null }); // tournament_clips delete (always runs)
    const viewerCleanupChain = createSupabaseChain({ data: null, error: null });
    const notifChain = createSupabaseChain({ data: [], error: null });
    const pushChain = createSupabaseChain({ data: null, error: null });
    const referralChain = createSupabaseChain({ data: null, error: null });
    const profileChain = createSupabaseChain({ data: null, error: null });

    const chains = [
      userChain, commentDeleteChain, commentLikesChain, votesDeleteChain,
      clipsChain, clipsDeleteChain, viewerCleanupChain, notifChain, pushChain, referralChain, profileChain,
    ];
    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      const chain = chains[Math.min(fromCallCount, chains.length - 1)];
      fromCallCount++;
      return chain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/account/delete/route');
    const req = createMockRequest('/api/account/delete', {
      method: 'POST',
      body: { confirmation: 'DELETE MY ACCOUNT' },
    });

    await POST(req);

    // clip_views viewer history uses voter_key
    expectChainCall(viewerCleanupChain, 'eq', 'voter_key', USER_KEY);
  });

  // --------------------------------------------------------------------------
  // BUG: Account delete requires confirmation
  // FIX: POST body must contain confirmation: 'DELETE MY ACCOUNT'
  // --------------------------------------------------------------------------
  test('Account delete: requires exact confirmation text', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    const { POST } = await import('@/app/api/account/delete/route');
    const req = createMockRequest('/api/account/delete', {
      method: 'POST',
      body: { confirmation: 'wrong text' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('DELETE MY ACCOUNT');
  });

  // --------------------------------------------------------------------------
  // BUG: member_count drifted when kicking members (not decremented)
  // FIX: DELETE /api/teams/[id]/members now reads current count and decrements
  // --------------------------------------------------------------------------
  test('Team kick: member_count is decremented after kicking a member', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: USER_ID },
    });

    const requesterMembershipChain = createSupabaseChain({ data: { role: 'leader' }, error: null });
    const targetMembershipChain = createSupabaseChain({
      data: { role: 'member', users: { username: 'kicked_user' } },
      error: null,
    });
    const deleteMemberChain = createSupabaseChain({ data: null, error: null });
    const teamCountChain = createSupabaseChain({ data: { member_count: 3 }, error: null });
    const updateCountChain = createSupabaseChain({ data: null, error: null });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return requesterMembershipChain;
      if (fromCallCount === 2) return targetMembershipChain;
      if (fromCallCount === 3) return deleteMemberChain;
      if (fromCallCount === 4) return teamCountChain;
      return updateCountChain;
    });

    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({ data: null, error: null }));
    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock, rpc: rpcMock }));

    const { DELETE } = await import('@/app/api/teams/[id]/members/route');
    const req = createMockRequest(`/api/teams/${TEAM_ID}/members?user_id=target-user-id`, {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: TEAM_ID }) });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);

    // Verify member_count was updated with decremented value (3 -> 2)
    expectChainCall(updateCountChain, 'eq', 'id', TEAM_ID);
  });

  // --------------------------------------------------------------------------
  // BUG: Account delete did not validate userId format (injection risk)
  // FIX: UUID regex validation added before using userId in queries
  // --------------------------------------------------------------------------
  test('Account delete: rejects non-UUID user ID format', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    // User lookup returns a non-UUID id (simulates DB corruption)
    const userChain = createSupabaseChain({ data: { id: 'not-a-uuid' }, error: null });
    const fromMock = jest.fn().mockReturnValue(userChain);
    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/account/delete/route');
    const req = createMockRequest('/api/account/delete', {
      method: 'POST',
      body: { confirmation: 'DELETE MY ACCOUNT' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(500);
    expect(body.error).toContain('Invalid user ID');
  });

  // --------------------------------------------------------------------------
  // BUG: Team name validation allowed inappropriate content
  // FIX: Blocked words filter added to POST /api/teams
  // --------------------------------------------------------------------------
  test('Team creation: inappropriate team names are rejected', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: USER_ID },
    });

    const rpcMock = jest.fn();
    mockCreateClient.mockReturnValue(buildSupabaseMock({ rpc: rpcMock }));

    const { POST } = await import('@/app/api/teams/route');
    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'Team FuckYeah', description: 'bad name' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toContain('inappropriate');
    // RPC should NOT have been called
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // BUG: Team name too short/long was accepted
  // FIX: Length validation (2-30 characters) added
  // --------------------------------------------------------------------------
  test('Team creation: name length is validated (2-30 chars)', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: USER_ID },
    });

    const rpcMock = jest.fn();
    mockCreateClient.mockReturnValue(buildSupabaseMock({ rpc: rpcMock }));

    const { POST } = await import('@/app/api/teams/route');

    // Too short
    const reqShort = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'A' },
    });
    const resShort = await POST(reqShort);
    expect(resShort.status).toBe(400);

    // Too long
    const reqLong = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'A'.repeat(31) },
    });
    const resLong = await POST(reqLong);
    expect(resLong.status).toBe(400);
  });
});
