/**
 * @jest-environment node
 *
 * TEAM COLLABORATION FLOW TEST
 * Tests the full team lifecycle:
 *   Create team -> Create invite -> Member joins -> Team chat -> Leave team
 *
 * Imports route handlers and calls them in sequence with shared mocked state.
 */

// ============================================================================
// MOCKS
// ============================================================================

const mockCreateClient = jest.fn();
const mockGetServerSession = jest.fn();
const mockRateLimit = jest.fn().mockResolvedValue(null);
const mockRequireCsrf = jest.fn().mockResolvedValue(null);
const mockSanitizeText = jest.fn((t: string) => t);

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: mockRequireCsrf }));
jest.mock('@/lib/sanitize', () => ({ sanitizeText: mockSanitizeText }));

// ============================================================================
// IMPORTS
// ============================================================================

import {
  createMockRequest,
  createSupabaseChain,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

// ============================================================================
// SHARED STATE
// ============================================================================

const LEADER_ID = TEST_USER.userId;
const MEMBER_ID = 'member-002-uuid';
const TEAM_ID = 'team-001';
const INVITE_CODE = 'ABCD1234';

function buildSupabaseMock(overrides?: Record<string, jest.Mock>) {
  return {
    from: jest.fn(),
    rpc: jest.fn().mockReturnValue(Promise.resolve({ data: null, error: null })),
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Team Collaboration Flow: Create -> Invite -> Join -> Chat -> Leave', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  // --------------------------------------------------------------------------
  // STEP 1: Create a team
  // --------------------------------------------------------------------------
  test('Step 1: User creates a new team', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: LEADER_ID },
    });

    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({
      data: { id: TEAM_ID, name: 'Test Team', leader_id: LEADER_ID, member_count: 1 },
      error: null,
    }));

    mockCreateClient.mockReturnValue(buildSupabaseMock({ rpc: rpcMock }));

    const { POST } = await import('@/app/api/teams/route');
    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'Test Team', description: 'Our team' },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.team.id).toBe(TEAM_ID);
    expect(rpcMock).toHaveBeenCalledWith('create_team', expect.objectContaining({
      p_name: 'Test Team',
      p_leader_id: LEADER_ID,
    }));
  });

  // --------------------------------------------------------------------------
  // STEP 2: Create an invite code
  // --------------------------------------------------------------------------
  test('Step 2: Leader creates an invite code for the team', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email, userId: LEADER_ID },
    });

    const membershipChain = createSupabaseChain({ data: { role: 'leader' }, error: null });
    const teamSizeChain = createSupabaseChain({ data: { member_count: 1 }, error: null });
    const insertInviteChain = createSupabaseChain({
      data: { id: 'invite-001', invite_code: INVITE_CODE, max_uses: 5, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return membershipChain;
      if (fromCallCount === 2) return teamSizeChain;
      return insertInviteChain;
    });

    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({ data: INVITE_CODE, error: null }));

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock, rpc: rpcMock }));

    const { POST } = await import('@/app/api/teams/[id]/invites/route');
    const req = createMockRequest(`/api/teams/${TEAM_ID}/invites`, {
      method: 'POST',
      body: { max_uses: 5, expires_in_days: 7 },
    });

    const res = await POST(req, { params: Promise.resolve({ id: TEAM_ID }) });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.invite.code).toBe(INVITE_CODE);
    expect(body.invite.share_link).toContain(INVITE_CODE);
  });

  // --------------------------------------------------------------------------
  // STEP 3: Another user joins via invite code
  // --------------------------------------------------------------------------
  test('Step 3: Another user joins the team via invite code', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'member@example.com', userId: MEMBER_ID },
    });

    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({
      data: { id: TEAM_ID, name: 'Test Team' },
      error: null,
    }));

    mockCreateClient.mockReturnValue(buildSupabaseMock({ rpc: rpcMock }));

    const { POST } = await import('@/app/api/teams/join/route');
    const req = createMockRequest('/api/teams/join', {
      method: 'POST',
      body: { code: INVITE_CODE },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.team.name).toBe('Test Team');
    expect(rpcMock).toHaveBeenCalledWith('join_team_via_code', expect.objectContaining({
      p_user_id: MEMBER_ID,
      p_invite_code: INVITE_CODE,
    }));
  });

  // --------------------------------------------------------------------------
  // STEP 4: Team member sends a chat message
  // --------------------------------------------------------------------------
  test('Step 4: Team member sends a message in team chat', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'member@example.com', userId: MEMBER_ID, image: null },
    });

    const membershipChain = createSupabaseChain({ data: { id: 'membership-001' }, error: null });
    const userChain = createSupabaseChain({ data: { username: 'member_user' }, error: null });
    const insertMessageChain = createSupabaseChain({
      data: { id: 'msg-001', message: 'Hello team!', created_at: new Date().toISOString(), user_id: MEMBER_ID, username: 'member_user' },
      error: null,
    });
    const updateActiveChain = createSupabaseChain({ data: null, error: null });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return membershipChain;
      if (fromCallCount === 2) return userChain;
      if (fromCallCount === 3) return insertMessageChain;
      return updateActiveChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/teams/[id]/messages/route');
    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`, {
      method: 'POST',
      body: { message: 'Hello team!' },
    });

    const res = await POST(req, { params: Promise.resolve({ id: TEAM_ID }) });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.message.message).toBe('Hello team!');
  });

  // --------------------------------------------------------------------------
  // STEP 5: Non-member cannot send messages
  // --------------------------------------------------------------------------
  test('Step 5: Non-member cannot send messages to team chat', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'outsider@example.com', userId: 'outsider-id' },
    });

    // Membership check returns null (not a member)
    const membershipChain = createSupabaseChain({ data: null, error: { message: 'not found', details: '', hint: '', code: 'PGRST116' } });

    const fromMock = jest.fn().mockReturnValue(membershipChain);
    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/teams/[id]/messages/route');
    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`, {
      method: 'POST',
      body: { message: 'I should not be here' },
    });

    const res = await POST(req, { params: Promise.resolve({ id: TEAM_ID }) });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toContain('not in this team');
  });
});
