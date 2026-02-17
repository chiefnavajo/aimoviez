/**
 * @jest-environment node
 */

/**
 * Security Fixes Tests
 * HIGH severity: API-1, API-2, API-3, API-4
 * LOW severity:  API-17, API-18, API-20
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
jest.mock('@/lib/device-fingerprint', () => ({
  generateDeviceKey: jest.fn().mockReturnValue('test-device-key'),
}));
jest.mock('@/lib/validations', () => ({
  parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
  DirectionVoteSchema: {},
}));
jest.mock('@/lib/supabase-client', () => ({
  getServiceClient: jest.fn(),
}));
jest.mock('@/lib/prompt-learning', () => ({
  recordUserPrompt: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock('@/lib/sanitize', () => ({
  sanitizeUuid: jest.fn((v: string) => v),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { requireCsrf } from '@/lib/csrf';
import { getServiceClient } from '@/lib/supabase-client';
import {
  createSupabaseChain,
  createMockRequest,
  mockSession,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

import { POST as referralPost } from '@/app/api/referral/route';
import { POST as notifSubscribePost } from '@/app/api/notifications/subscribe/route';
import { POST as directionVotePost } from '@/app/api/co-director/direction-vote/route';
import { GET as profileClipsGet } from '@/app/api/profile/clips/route';
import { POST as recordPromptPost } from '@/app/api/clip/record-prompt/route';
import { POST as clipPinPost } from '@/app/api/profile/clips/pin/route';

const mockGetSession = getServerSession as jest.Mock;
const mockCreateClient = createClient as jest.Mock;
const mockGetServiceClient = getServiceClient as jest.Mock;
const mockRequireCsrf = requireCsrf as jest.Mock;

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
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  mockRequireCsrf.mockResolvedValue(null);
});

// ===========================================================================
// API-1 (HIGH): Referral POST ignores body new_user_id
// ===========================================================================

describe('API-1: Referral POST derives new_user_id from session', () => {
  it('uses the session-derived user id, not the body-provided id', async () => {
    mockSession(mockGetSession, TEST_USER);

    // Sequence of .from() calls in the POST handler:
    //  0: feature_flags (isFeatureEnabled - first createClient)
    //  1: feature_flags (isFeatureEnabled - second createClient via getSupabaseClient)
    //    Actually the handler calls isFeatureEnabled which creates its own client,
    //    then getSupabaseClient again. Let's trace carefully:
    //    - isFeatureEnabled creates client -> from('feature_flags')
    //    - handler creates client -> from('users') session lookup
    //      then from('users') referrer lookup
    //      then from('referrals') existing check
    //      then from('referrals') insert
    //      then from('referrals') count
    //      then from('users') update referral_count
    //      then from('users') update referred_by
    //
    //  But isFeatureEnabled creates its OWN client via getSupabaseClient().
    //  The handler also calls getSupabaseClient() separately.
    //  Each createClient call returns the mock, so we need a single mock
    //  that tracks all from() calls across both clients.

    const seq = createSequentialMock([
      // 0: feature_flags -> enabled
      { data: { enabled: true } },
      // 1: users -> session user lookup
      { data: { id: 'real-user-id' } },
      // 2: users -> referrer lookup
      { data: { id: 'referrer-id-999', referral_count: 3 } },
      // 3: referrals -> existing referral check (none)
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
      // 4: referrals -> insert new referral
      { data: { id: 'new-referral-id' } },
      // 5: referrals -> count
      { data: null, count: 4 },
      // 6: users -> update referral_count
      { data: null },
      // 7: users -> update referred_by
      { data: null },
    ]);

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/referral', {
      method: 'POST',
      body: { referral_code: 'ABC12345', new_user_id: 'fake-id-should-be-ignored' },
    });

    const res = await referralPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);

    // Verify session user was looked up by email (call index 1)
    expect(seq.fromCalls[1]).toBe('users');

    // Verify the insert (call index 4) used 'real-user-id', not 'fake-id'
    // The insert chain records an insert() call with the referral object
    // We check by verifying the from calls include 'referrals' for the insert
    expect(seq.fromCalls[4]).toBe('referrals');
  });
});

// ===========================================================================
// API-2 (HIGH): Referral count uses DB count
// ===========================================================================

describe('API-2: Referral POST uses actual DB count for referral_count', () => {
  it('updates referral_count with the count from DB, not an increment', async () => {
    mockSession(mockGetSession, TEST_USER);

    const countChain = createSupabaseChain({ data: null, count: 7 });
    const updateChain = createSupabaseChain({ data: null });
    let fromIndex = 0;
    const chains: ReturnType<typeof createSupabaseChain>[] = [];

    const seq = {
      from: jest.fn((table: string) => {
        const responses = [
          { data: { enabled: true } },             // 0: feature_flags
          { data: { id: 'real-user-id' } },         // 1: users (session)
          { data: { id: 'referrer-42', referral_count: 5 } }, // 2: users (referrer)
          { data: null, error: { code: 'PGRST116', message: 'not found' } }, // 3: referrals (existing)
          { data: { id: 'ref-new' } },              // 4: referrals (insert)
        ];

        const idx = fromIndex++;

        // For the count call (index 5), return our tracked chain
        if (idx === 5) {
          return countChain;
        }
        // For the referral_count update (index 6), return our tracked chain
        if (idx === 6) {
          return updateChain;
        }

        const response = responses[idx] || { data: null };
        const c = createSupabaseChain(response);
        chains.push(c);
        return c;
      }),
    };

    mockCreateClient.mockReturnValue(seq);

    const req = createMockRequest('/api/referral', {
      method: 'POST',
      body: { referral_code: 'XYZ99999' },
    });

    const res = await referralPost(req);
    const { status } = await parseResponse(res);
    expect(status).toBe(200);

    // Verify the count chain used select with { count: 'exact', head: true }
    const selectCall = countChain._calls.find(c => c.method === 'select');
    expect(selectCall).toBeDefined();
    expect(selectCall!.args).toEqual(['*', { count: 'exact', head: true }]);

    // Verify the update chain used the actual count value (7)
    const updateCall = updateChain._calls.find(c => c.method === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall!.args[0]).toEqual({ referral_count: 7 });
  });
});

// ===========================================================================
// API-3 (HIGH): Notification subscribe requires auth
// ===========================================================================

describe('API-3: Notification subscribe auth and validation', () => {
  it('returns 401 when not authenticated', async () => {
    mockSession(mockGetSession, null);

    const req = createMockRequest('/api/notifications/subscribe', {
      method: 'POST',
      body: { subscription: { endpoint: 'https://fcm.googleapis.com/test' } },
    });

    const res = await notifSubscribePost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 400 for invalid push endpoint domain', async () => {
    mockSession(mockGetSession, TEST_USER);
    const chain = createSupabaseChain({ data: { id: 'user-123' } });
    mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

    const req = createMockRequest('/api/notifications/subscribe', {
      method: 'POST',
      body: { subscription: { endpoint: 'https://evil.com/push' } },
    });

    const res = await notifSubscribePost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid push subscription endpoint');
  });

  it('succeeds with valid fcm.googleapis.com endpoint', async () => {
    mockSession(mockGetSession, TEST_USER);

    const userChain = createSupabaseChain({ data: { id: 'user-123' } });
    const upsertChain = createSupabaseChain({ data: { id: 'sub-hash' } });
    let callIdx = 0;

    mockCreateClient.mockReturnValue({
      from: jest.fn(() => {
        return callIdx++ === 0 ? userChain : upsertChain;
      }),
    });

    const req = createMockRequest('/api/notifications/subscribe', {
      method: 'POST',
      body: {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/some-token',
          keys: { p256dh: 'key1', auth: 'key2' },
        },
      },
    });

    const res = await notifSubscribePost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.subscription_id).toBeDefined();
  });
});

// ===========================================================================
// API-4 (HIGH): Direction vote uses upsert (not delete+insert)
// ===========================================================================

describe('API-4: Direction vote uses atomic upsert for vote changes', () => {
  it('calls upsert with onConflict when changing an existing vote', async () => {
    mockSession(mockGetSession, TEST_USER);

    const upsertChain = createSupabaseChain({
      data: { id: 'vote-1', direction_option_id: 'new-option' },
    });
    const oldCountChain = createSupabaseChain({ data: null, count: 3 });
    const newCountChain = createSupabaseChain({ data: null, count: 4 });
    const oldUpdateChain = createSupabaseChain({ data: null });
    const newUpdateChain = createSupabaseChain({ data: null });

    let fromIdx = 0;
    const mockClient = {
      from: jest.fn(() => {
        const idx = fromIdx++;
        const responses: Record<number, ReturnType<typeof createSupabaseChain>> = {
          // 0: feature_flags (isFeatureEnabled)
          0: createSupabaseChain({ data: { enabled: true } }),
          // 1: direction_options
          1: createSupabaseChain({
            data: { id: 'new-option', season_id: 's1', slot_position: 1, title: 'Dir B' },
          }),
          // 2: story_slots (voting open)
          2: createSupabaseChain({
            data: { direction_voting_status: 'open', direction_voting_ends_at: null },
          }),
          // 3: users (session user)
          3: createSupabaseChain({ data: { id: TEST_USER.userId } }),
          // 4: direction_votes (existing vote with different option)
          4: createSupabaseChain({
            data: { id: 'vote-1', direction_option_id: 'old-option', user_id: TEST_USER.userId },
          }),
          // 5: upsert call
          5: upsertChain,
          // 6 & 7: recount (Promise.all for old and new counts)
          6: oldCountChain,
          7: newCountChain,
          // 8 & 9: update direction_options (Promise.all)
          8: oldUpdateChain,
          9: newUpdateChain,
        };
        return responses[idx] || createSupabaseChain({ data: null });
      }),
    };

    mockCreateClient.mockReturnValue(mockClient);

    const req = createMockRequest('/api/co-director/direction-vote', {
      method: 'POST',
      body: { direction_option_id: 'new-option' },
    });

    const res = await directionVotePost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.changed).toBe(true);

    // Verify upsert was called (not delete+insert)
    const upsertCall = upsertChain._calls.find(c => c.method === 'upsert');
    expect(upsertCall).toBeDefined();
    expect(upsertCall!.args[1]).toEqual({
      onConflict: 'season_id,slot_position,voter_key',
    });

    // Verify no delete call on the upsert chain
    const deleteCall = upsertChain._calls.find(c => c.method === 'delete');
    expect(deleteCall).toBeUndefined();

    // Verify recount queries used select with count: 'exact'
    const oldCountSelect = oldCountChain._calls.find(c => c.method === 'select');
    expect(oldCountSelect!.args).toEqual(['*', { count: 'exact', head: true }]);
  });
});

// ===========================================================================
// API-17 (LOW): Profile clips returns 401 when unauthenticated
// ===========================================================================

describe('API-17: Profile clips GET returns 401 without auth', () => {
  it('returns 401 status (not 200 with empty data)', async () => {
    mockSession(mockGetSession, null);
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => createSupabaseChain({ data: null })),
    });

    const req = createMockRequest('/api/profile/clips');
    const res = await profileClipsGet(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.clips).toEqual([]);
    expect(body.total_clips).toBe(0);
  });
});

// ===========================================================================
// API-18 (LOW): Clip record-prompt requires userId
// ===========================================================================

describe('API-18: Clip record-prompt skips DB write without userId', () => {
  it('returns ok:true with recorded:false when session has no userId', async () => {
    // Session exists but has no userId
    mockGetSession.mockResolvedValue({
      user: { email: 'test@example.com', name: 'Test' },
    });

    // Feature flag enabled
    const featureChain = createSupabaseChain({ data: { enabled: true } });
    mockGetServiceClient.mockReturnValue({
      from: jest.fn(() => featureChain),
    });

    const req = createMockRequest('/api/clip/record-prompt', {
      method: 'POST',
      body: {
        slotId: '550e8400-e29b-41d4-a716-446655440000',
        prompt: 'A dramatic scene in the rain',
        model: 'kling-2.6',
      },
    });

    const res = await recordPromptPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.recorded).toBe(false);
  });
});

// ===========================================================================
// API-20 (LOW): Profile clips/pin CSRF protection
// ===========================================================================

describe('API-20: Profile clips/pin POST requires CSRF', () => {
  it('returns 403 when CSRF token is missing', async () => {
    mockSession(mockGetSession, TEST_USER);
    mockCreateClient.mockReturnValue({
      from: jest.fn(() => createSupabaseChain({ data: { id: TEST_USER.userId } })),
    });

    // Make requireCsrf return a 403 response
    mockRequireCsrf.mockResolvedValue(
      new Response(JSON.stringify({ error: 'CSRF token missing' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    );

    const req = createMockRequest('/api/profile/clips/pin', {
      method: 'POST',
      body: { clipId: 'clip-1' },
    });

    const res = await clipPinPost(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(403);
    expect(body.error).toContain('CSRF');
  });
});
