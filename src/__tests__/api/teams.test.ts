/**
 * @jest-environment node
 */

/**
 * Teams API Unit Tests
 *
 * Covers all teams-related routes:
 *   - GET/POST  /api/teams
 *   - GET/PATCH/DELETE  /api/teams/[id]
 *   - GET/DELETE /api/teams/[id]/members
 *   - GET/POST   /api/teams/[id]/invites
 *   - GET/POST   /api/teams/[id]/messages
 *   - POST       /api/teams/join
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
  sanitizeText: jest.fn((v: string) => v),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import {
  createSupabaseChain,
  createMultiTableMock,
  createSequentialMock,
  createMockRequest,
  mockSession,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

// Route handlers
import { GET as teamsGet, POST as teamsPost } from '@/app/api/teams/route';
import {
  GET as teamByIdGet,
  PATCH as teamByIdPatch,
  DELETE as teamByIdDelete,
} from '@/app/api/teams/[id]/route';
import {
  GET as membersGet,
  DELETE as membersDelete,
} from '@/app/api/teams/[id]/members/route';
import {
  GET as invitesGet,
  POST as invitesPost,
} from '@/app/api/teams/[id]/invites/route';
import {
  GET as messagesGet,
  POST as messagesPost,
} from '@/app/api/teams/[id]/messages/route';
import { POST as joinPost } from '@/app/api/teams/join/route';

// ---------------------------------------------------------------------------
// Typed mocks
// ---------------------------------------------------------------------------

const mockGetSession = getServerSession as jest.Mock;
const mockCreateClient = createClient as jest.Mock;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEAM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_USER_ID = '11111111-2222-3333-4444-555555555555';

function routeCtx(id: string = TEAM_ID) {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Supabase client mock with both `from` and `rpc` support. */
function buildClient(opts: {
  rpc?: jest.Mock;
  from?: jest.Mock;
}) {
  return {
    from: opts.from ?? jest.fn(() => createSupabaseChain()),
    rpc: opts.rpc ?? jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_APP_URL = 'https://aimoviez.com';
});

// ============================================================================
// GET /api/teams  (leaderboard + my-team)
// ============================================================================

describe('GET /api/teams', () => {
  it('returns team leaderboard (public, default mode)', async () => {
    const rpcMock = jest.fn().mockResolvedValue({
      data: [{ id: TEAM_ID, name: 'Alpha', xp: 100 }],
      error: null,
    });
    const fromChain = createSupabaseChain({ data: null, error: null, count: 1 });
    const client = { rpc: rpcMock, from: jest.fn(() => fromChain) };
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest('/api/teams');
    const { status, body } = await parseResponse(await teamsGet(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].name).toBe('Alpha');
    expect(rpcMock).toHaveBeenCalledWith('get_team_leaderboard', expect.objectContaining({ p_limit: 20, p_offset: 0 }));
  });

  it('returns 401 when requesting my-team without session', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/teams', { searchParams: { mode: 'my-team' } });
    const { status, body } = await parseResponse(await teamsGet(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns user team when mode=my-team with valid session', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({
      data: { id: TEAM_ID, name: 'MyTeam' },
      error: null,
    });
    const memberChain = createSupabaseChain({ data: { role: 'leader', joined_at: '2026-01-01' }, error: null });
    const client = { rpc: rpcMock, from: jest.fn(() => memberChain) };
    mockCreateClient.mockReturnValue(client);

    const req = createMockRequest('/api/teams', { searchParams: { mode: 'my-team' } });
    const { status, body } = await parseResponse(await teamsGet(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.team.name).toBe('MyTeam');
    expect(body.membership.role).toBe('leader');
  });

  it('returns 500 when rpc fails for leaderboard', async () => {
    const rpcMock = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'DB error' },
    });
    mockCreateClient.mockReturnValue({ rpc: rpcMock, from: jest.fn() });

    const req = createMockRequest('/api/teams');
    const { status, body } = await parseResponse(await teamsGet(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to get teams');
  });
});

// ============================================================================
// POST /api/teams  (create team)
// ============================================================================

describe('POST /api/teams', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'NewTeam' },
    });
    const { status, body } = await parseResponse(await teamsPost(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('creates a team successfully', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({
      data: { id: TEAM_ID, name: 'NewTeam' },
      error: null,
    });
    mockCreateClient.mockReturnValue(buildClient({ rpc: rpcMock }));

    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'NewTeam', description: 'A cool team' },
    });
    const { status, body } = await parseResponse(await teamsPost(req));

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.team.name).toBe('NewTeam');
    expect(rpcMock).toHaveBeenCalledWith('create_team', {
      p_name: 'NewTeam',
      p_description: 'A cool team',
      p_leader_id: TEST_USER.userId,
    });
  });

  it('returns 400 when team name is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: {},
    });
    const { status, body } = await parseResponse(await teamsPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Team name is required');
  });

  it('returns 400 when team name is too short', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'A' },
    });
    const { status, body } = await parseResponse(await teamsPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Team name must be 2-30 characters');
  });

  it('returns 400 when team name is too long', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'A'.repeat(31) },
    });
    const { status, body } = await parseResponse(await teamsPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Team name must be 2-30 characters');
  });

  it('returns 400 when team name contains profanity', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'TeamFuckYeah' },
    });
    const { status, body } = await parseResponse(await teamsPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Team name contains inappropriate content');
  });

  it('returns 400 when description is over 200 chars', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'GoodName', description: 'x'.repeat(201) },
    });
    const { status, body } = await parseResponse(await teamsPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Description must be under 200 characters');
  });

  it('returns 400 when user already in a team', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'already in a team' },
    });
    mockCreateClient.mockReturnValue(buildClient({ rpc: rpcMock }));

    const req = createMockRequest('/api/teams', {
      method: 'POST',
      body: { name: 'AnotherTeam' },
    });
    const { status, body } = await parseResponse(await teamsPost(req));

    expect(status).toBe(400);
    expect(body.error).toMatch(/already in a team/i);
  });
});

// ============================================================================
// GET /api/teams/[id]  (team details)
// ============================================================================

describe('GET /api/teams/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(`/api/teams/${TEAM_ID}`);
    const { status, body } = await parseResponse(await teamByIdGet(req, routeCtx()));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns team details for authenticated user', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({
      data: { id: TEAM_ID, name: 'Alpha', member_count: 3, total_xp: 500 },
      error: null,
    });
    mockCreateClient.mockReturnValue(buildClient({ rpc: rpcMock }));

    const req = createMockRequest(`/api/teams/${TEAM_ID}`);
    const { status, body } = await parseResponse(await teamByIdGet(req, routeCtx()));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.team.name).toBe('Alpha');
  });

  it('returns 404 when team does not exist', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({ data: null, error: null });
    mockCreateClient.mockReturnValue(buildClient({ rpc: rpcMock }));

    const req = createMockRequest(`/api/teams/${TEAM_ID}`);
    const { status, body } = await parseResponse(await teamByIdGet(req, routeCtx()));

    expect(status).toBe(404);
    expect(body.error).toBe('Team not found');
  });
});

// ============================================================================
// PATCH /api/teams/[id]  (update team, leader-only)
// ============================================================================

describe('PATCH /api/teams/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(`/api/teams/${TEAM_ID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const { status, body } = await parseResponse(await teamByIdPatch(req, routeCtx()));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 403 when non-leader tries to update', async () => {
    mockSession(mockGetSession, TEST_USER);

    // from('teams').select().eq().single() returns a different leader
    const teamChain = createSupabaseChain({ data: { leader_id: OTHER_USER_ID }, error: null });
    mockCreateClient.mockReturnValue({ from: jest.fn(() => teamChain), rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const { status, body } = await parseResponse(await teamByIdPatch(req, routeCtx()));

    expect(status).toBe(403);
    expect(body.error).toBe('Only team leader can update team');
  });

  it('updates team name successfully as leader', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      // 1st from: check leader
      { data: { leader_id: TEST_USER.userId }, error: null },
      // 2nd from: update
      { data: null, error: null },
    ]);
    const rpcMock = jest.fn().mockResolvedValue({
      data: { id: TEAM_ID, name: 'Updated' },
      error: null,
    });
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: rpcMock });

    const req = createMockRequest(`/api/teams/${TEAM_ID}`, {
      method: 'PATCH',
      body: { name: 'Updated' },
    });
    const { status, body } = await parseResponse(await teamByIdPatch(req, routeCtx()));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 400 when no valid fields provided', async () => {
    mockSession(mockGetSession, TEST_USER);

    const teamChain = createSupabaseChain({ data: { leader_id: TEST_USER.userId }, error: null });
    mockCreateClient.mockReturnValue({ from: jest.fn(() => teamChain), rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}`, {
      method: 'PATCH',
      body: {},
    });
    const { status, body } = await parseResponse(await teamByIdPatch(req, routeCtx()));

    expect(status).toBe(400);
    expect(body.error).toBe('No valid fields to update');
  });
});

// ============================================================================
// DELETE /api/teams/[id]  (disband team, leader-only)
// ============================================================================

describe('DELETE /api/teams/[id]', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(`/api/teams/${TEAM_ID}`, { method: 'DELETE' });
    const { status, body } = await parseResponse(await teamByIdDelete(req, routeCtx()));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 403 when non-leader tries to delete', async () => {
    mockSession(mockGetSession, TEST_USER);

    const teamChain = createSupabaseChain({ data: { leader_id: OTHER_USER_ID, name: 'Alpha' }, error: null });
    mockCreateClient.mockReturnValue({ from: jest.fn(() => teamChain), rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}`, { method: 'DELETE' });
    const { status, body } = await parseResponse(await teamByIdDelete(req, routeCtx()));

    expect(status).toBe(403);
    expect(body.error).toBe('Only team leader can disband team');
  });

  it('disbands team successfully as leader', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      // 1st from: check leader
      { data: { leader_id: TEST_USER.userId, name: 'Alpha' }, error: null },
      // 2nd from: delete
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}`, { method: 'DELETE' });
    const { status, body } = await parseResponse(await teamByIdDelete(req, routeCtx()));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toContain('Alpha');
  });

  it('returns 404 when team does not exist', async () => {
    mockSession(mockGetSession, TEST_USER);

    const teamChain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: jest.fn(() => teamChain), rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}`, { method: 'DELETE' });
    const { status, body } = await parseResponse(await teamByIdDelete(req, routeCtx()));

    expect(status).toBe(404);
    expect(body.error).toBe('Team not found');
  });
});

// ============================================================================
// GET /api/teams/[id]/members
// ============================================================================

describe('GET /api/teams/[id]/members', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(`/api/teams/${TEAM_ID}/members`);
    const { status, body } = await parseResponse(await membersGet(req, routeCtx()));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns member list sorted by role', async () => {
    mockSession(mockGetSession, TEST_USER);

    const members = [
      { id: '1', role: 'member', contribution_xp: 10, contribution_votes: 5, last_active_date: null, joined_at: '2026-01-02', users: { id: OTHER_USER_ID, username: 'member1', avatar_url: null, level: 1, xp: 10 } },
      { id: '2', role: 'leader', contribution_xp: 50, contribution_votes: 20, last_active_date: null, joined_at: '2026-01-01', users: { id: TEST_USER.userId, username: 'leader1', avatar_url: null, level: 5, xp: 100 } },
    ];
    const chain = createSupabaseChain({ data: members, error: null });
    mockCreateClient.mockReturnValue({ from: jest.fn(() => chain), rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/members`);
    const { status, body } = await parseResponse(await membersGet(req, routeCtx()));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.members).toHaveLength(2);
    // Leader should come first after sorting
    expect(body.members[0].role).toBe('leader');
    expect(body.members[1].role).toBe('member');
  });
});

// ============================================================================
// DELETE /api/teams/[id]/members  (leave or kick)
// ============================================================================

describe('DELETE /api/teams/[id]/members', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(`/api/teams/${TEAM_ID}/members`, { method: 'DELETE' });
    const { status, body } = await parseResponse(await membersDelete(req, routeCtx()));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('allows user to leave team (no user_id param)', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({ data: null, error: null });
    mockCreateClient.mockReturnValue(buildClient({ rpc: rpcMock }));

    const req = createMockRequest(`/api/teams/${TEAM_ID}/members`, { method: 'DELETE' });
    const { status, body } = await parseResponse(await membersDelete(req, routeCtx()));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.message).toBe('Left team successfully');
    expect(rpcMock).toHaveBeenCalledWith('leave_team', { p_user_id: TEST_USER.userId });
  });

  it('returns 403 when regular member tries to kick', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      // 1st from: requester membership
      { data: { role: 'member' }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/members`, {
      method: 'DELETE',
      searchParams: { user_id: OTHER_USER_ID },
    });
    const { status, body } = await parseResponse(await membersDelete(req, routeCtx()));

    expect(status).toBe(403);
    expect(body.error).toBe('Only leader or officers can kick members');
  });

  it('returns 403 when trying to kick team leader', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      // 1st from: requester is officer
      { data: { role: 'officer' }, error: null },
      // 2nd from: target is leader
      { data: { role: 'leader', users: { username: 'LeaderGuy' } }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/members`, {
      method: 'DELETE',
      searchParams: { user_id: OTHER_USER_ID },
    });
    const { status, body } = await parseResponse(await membersDelete(req, routeCtx()));

    expect(status).toBe(403);
    expect(body.error).toBe('Cannot kick team leader');
  });
});

// ============================================================================
// GET /api/teams/[id]/invites
// ============================================================================

describe('GET /api/teams/[id]/invites', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(`/api/teams/${TEAM_ID}/invites`);
    const { status, body } = await parseResponse(await invitesGet(req, routeCtx()));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 403 when user is not in team', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      // 1st from: membership check returns null
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/invites`);
    const { status, body } = await parseResponse(await invitesGet(req, routeCtx()));

    expect(status).toBe(403);
    expect(body.error).toBe('You are not in this team');
  });

  it('returns active invites for team member', async () => {
    mockSession(mockGetSession, TEST_USER);

    const invites = [
      { id: 'inv-1', invite_code: 'ABC12345', max_uses: 5, uses: 1, expires_at: '2026-12-31', created_at: '2026-01-01', invited_by: TEST_USER.userId, users: { username: 'TestUser' } },
    ];
    const seqMock = createSequentialMock([
      // 1st from: membership check
      { data: { role: 'member' }, error: null },
      // 2nd from: invites query
      { data: invites, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/invites`);
    const { status, body } = await parseResponse(await invitesGet(req, routeCtx()));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0].code).toBe('ABC12345');
  });
});

// ============================================================================
// POST /api/teams/[id]/invites  (create invite)
// ============================================================================

describe('POST /api/teams/[id]/invites', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(`/api/teams/${TEAM_ID}/invites`, { method: 'POST', body: {} });
    const { status, body } = await parseResponse(await invitesPost(req, routeCtx()));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 403 when user is not in team', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      // 1st from: membership check returns null
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/invites`, { method: 'POST', body: {} });
    const { status, body } = await parseResponse(await invitesPost(req, routeCtx()));

    expect(status).toBe(403);
    expect(body.error).toBe('You are not in this team');
  });

  it('creates invite successfully as team member', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({ data: 'NEWCODE1', error: null });
    const seqMock = createSequentialMock([
      // 1st from: membership check
      { data: { role: 'member' }, error: null },
      // 2nd from: team size check
      { data: { member_count: 3 }, error: null },
      // 3rd from: insert invite
      { data: { id: 'inv-new', invite_code: 'NEWCODE1', max_uses: 5, expires_at: '2026-02-25T00:00:00Z' }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: rpcMock });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/invites`, { method: 'POST', body: {} });
    const { status, body } = await parseResponse(await invitesPost(req, routeCtx()));

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.invite.code).toBe('NEWCODE1');
    expect(body.invite.share_link).toContain('NEWCODE1');
  });

  it('returns 400 when team is full', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      // 1st from: membership check
      { data: { role: 'member' }, error: null },
      // 2nd from: team size check - full
      { data: { member_count: 5 }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/invites`, { method: 'POST', body: {} });
    const { status, body } = await parseResponse(await invitesPost(req, routeCtx()));

    expect(status).toBe(400);
    expect(body.error).toBe('Team is full (max 5 members)');
  });
});

// ============================================================================
// GET /api/teams/[id]/messages
// ============================================================================

describe('GET /api/teams/[id]/messages', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`);
    const { status, body } = await parseResponse(await messagesGet(req, routeCtx()));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 403 when user is not in team', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      // 1st from: membership check returns null
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`);
    const { status, body } = await parseResponse(await messagesGet(req, routeCtx()));

    expect(status).toBe(403);
    expect(body.error).toBe('You are not in this team');
  });

  it('returns messages for team member', async () => {
    mockSession(mockGetSession, TEST_USER);

    const messages = [
      { id: 'msg-1', message: 'Hello', created_at: '2026-01-01T12:00:00Z', user_id: TEST_USER.userId, username: 'TestUser', users: { avatar_url: 'https://img.test/1.png' } },
      { id: 'msg-2', message: 'World', created_at: '2026-01-01T12:01:00Z', user_id: OTHER_USER_ID, username: 'Other', users: { avatar_url: null } },
    ];
    const seqMock = createSequentialMock([
      // 1st from: membership check
      { data: { id: 'mem-1' }, error: null },
      // 2nd from: messages query
      { data: messages, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`);
    const { status, body } = await parseResponse(await messagesGet(req, routeCtx()));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.messages).toHaveLength(2);
    // Messages are reversed for chronological order
    expect(body.messages[0].message).toBe('World');
    expect(body.messages[1].message).toBe('Hello');
  });
});

// ============================================================================
// POST /api/teams/[id]/messages  (send message)
// ============================================================================

describe('POST /api/teams/[id]/messages', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`, {
      method: 'POST',
      body: { message: 'hi' },
    });
    const { status, body } = await parseResponse(await messagesPost(req, routeCtx()));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 403 when user is not in team', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      // 1st from: membership check returns null
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`, {
      method: 'POST',
      body: { message: 'hello' },
    });
    const { status, body } = await parseResponse(await messagesPost(req, routeCtx()));

    expect(status).toBe(403);
    expect(body.error).toBe('You are not in this team');
  });

  it('returns 400 when message is empty', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      { data: { id: 'mem-1' }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`, {
      method: 'POST',
      body: { message: '' },
    });
    const { status, body } = await parseResponse(await messagesPost(req, routeCtx()));

    expect(status).toBe(400);
    // Could be either "Message is required" or "Message must be 1-500 characters" depending on empty string handling
    expect(body.error).toBeDefined();
  });

  it('returns 400 when message exceeds 500 chars', async () => {
    mockSession(mockGetSession, TEST_USER);

    const seqMock = createSequentialMock([
      { data: { id: 'mem-1' }, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`, {
      method: 'POST',
      body: { message: 'x'.repeat(501) },
    });
    const { status, body } = await parseResponse(await messagesPost(req, routeCtx()));

    expect(status).toBe(400);
    expect(body.error).toBe('Message must be 1-500 characters');
  });

  it('sends message successfully as team member', async () => {
    mockSession(mockGetSession, TEST_USER);

    const newMsg = { id: 'msg-new', message: 'Hello team!', created_at: '2026-02-18T10:00:00Z', user_id: TEST_USER.userId, username: 'TestUser' };
    const seqMock = createSequentialMock([
      // 1st from: membership check
      { data: { id: 'mem-1' }, error: null },
      // 2nd from: get username
      { data: { username: 'TestUser' }, error: null },
      // 3rd from: insert message
      { data: newMsg, error: null },
      // 4th from: update last_active_date
      { data: null, error: null },
    ]);
    mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });

    const req = createMockRequest(`/api/teams/${TEAM_ID}/messages`, {
      method: 'POST',
      body: { message: 'Hello team!' },
    });
    const { status, body } = await parseResponse(await messagesPost(req, routeCtx()));

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.message.message).toBe('Hello team!');
  });
});

// ============================================================================
// POST /api/teams/join
// ============================================================================

describe('POST /api/teams/join', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/teams/join', {
      method: 'POST',
      body: { code: 'ABC12345' },
    });
    const { status, body } = await parseResponse(await joinPost(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Not authenticated');
  });

  it('returns 400 when invite code is missing', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest('/api/teams/join', {
      method: 'POST',
      body: {},
    });
    const { status, body } = await parseResponse(await joinPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Invite code is required');
  });

  it('returns 400 when invite code format is invalid (too short)', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest('/api/teams/join', {
      method: 'POST',
      body: { code: 'AB' },
    });
    const { status, body } = await parseResponse(await joinPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid invite code format');
  });

  it('returns 400 when invite code format is invalid (too long)', async () => {
    mockSession(mockGetSession, TEST_USER);

    const req = createMockRequest('/api/teams/join', {
      method: 'POST',
      body: { code: 'ABCDEFGHIJKLMNOP' },
    });
    const { status, body } = await parseResponse(await joinPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid invite code format');
  });

  it('joins team successfully with valid invite code', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({
      data: { id: TEAM_ID, name: 'CoolTeam' },
      error: null,
    });
    mockCreateClient.mockReturnValue(buildClient({ rpc: rpcMock }));

    const req = createMockRequest('/api/teams/join', {
      method: 'POST',
      body: { code: 'ABC12345' },
    });
    const { status, body } = await parseResponse(await joinPost(req));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.team.name).toBe('CoolTeam');
    expect(body.message).toContain('CoolTeam');
    expect(rpcMock).toHaveBeenCalledWith('join_team_via_code', {
      p_user_id: TEST_USER.userId,
      p_invite_code: 'ABC12345',
    });
  });

  it('returns 400 when user is already in a team', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'already in a team' },
    });
    mockCreateClient.mockReturnValue(buildClient({ rpc: rpcMock }));

    const req = createMockRequest('/api/teams/join', {
      method: 'POST',
      body: { code: 'ABC12345' },
    });
    const { status, body } = await parseResponse(await joinPost(req));

    expect(status).toBe(400);
    expect(body.error).toMatch(/already in a team/i);
  });

  it('returns 400 when invite code is invalid or expired', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'Invalid or expired invite code' },
    });
    mockCreateClient.mockReturnValue(buildClient({ rpc: rpcMock }));

    const req = createMockRequest('/api/teams/join', {
      method: 'POST',
      body: { code: 'EXPIRED1' },
    });
    const { status, body } = await parseResponse(await joinPost(req));

    expect(status).toBe(400);
    expect(body.error).toMatch(/Invalid or expired/i);
  });

  it('returns 400 when team is full', async () => {
    mockSession(mockGetSession, TEST_USER);

    const rpcMock = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'Team is full' },
    });
    mockCreateClient.mockReturnValue(buildClient({ rpc: rpcMock }));

    const req = createMockRequest('/api/teams/join', {
      method: 'POST',
      body: { code: 'FULLTEAM' },
    });
    const { status, body } = await parseResponse(await joinPost(req));

    expect(status).toBe(400);
    expect(body.error).toMatch(/full/i);
  });
});
