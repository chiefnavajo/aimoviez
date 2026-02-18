/**
 * @jest-environment node
 *
 * CREDIT PURCHASE FLOW TEST
 * Tests the full credit purchase lifecycle:
 *   Check balance -> Select package -> Create Stripe checkout -> Webhook fires -> Credits added
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

// Stripe mock
const mockStripeCheckoutCreate = jest.fn();
const mockStripeWebhooksConstructEvent = jest.fn();
const mockStripeInstance = {
  checkout: { sessions: { create: mockStripeCheckoutCreate } },
  webhooks: { constructEvent: mockStripeWebhooksConstructEvent },
};

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: mockRequireCsrf }));
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => mockStripeInstance);
});

// ============================================================================
// IMPORTS
// ============================================================================

import {
  createMockRequest,
  createSupabaseChain,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';
import { NextRequest } from 'next/server';

// ============================================================================
// SHARED STATE
// ============================================================================

const USER_ID = TEST_USER.userId;
const PACKAGE_ID = 'pkg-100-credits';
const STRIPE_SESSION_ID = 'cs_test_123';
const PAYMENT_INTENT_ID = 'pi_test_456';

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

describe('Credit Purchase Flow: Balance -> Purchase -> Webhook -> Credits Added', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
  });

  // --------------------------------------------------------------------------
  // STEP 1: Check credit balance
  // --------------------------------------------------------------------------
  test('Step 1: User checks their credit balance', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email },
    });

    const userChain = createSupabaseChain({
      data: { id: USER_ID, balance_credits: 50, lifetime_purchased_credits: 100 },
      error: null,
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({
      from: jest.fn().mockReturnValue(userChain),
    }));

    const { GET } = await import('@/app/api/credits/balance/route');
    const req = createMockRequest('/api/credits/balance');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.balance).toBe(50);
    expect(body.lifetime_purchased).toBe(100);
  });

  // --------------------------------------------------------------------------
  // STEP 2: Unauthenticated user is rejected
  // --------------------------------------------------------------------------
  test('Step 2: Unauthenticated user cannot check balance', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { GET } = await import('@/app/api/credits/balance/route');
    const req = createMockRequest('/api/credits/balance');
    const res = await GET(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toContain('Authentication');
  });

  // --------------------------------------------------------------------------
  // STEP 3: Create Stripe checkout session
  // --------------------------------------------------------------------------
  test('Step 3: User creates a Stripe checkout session for a package', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email },
    });

    const creditFlagChain = createSupabaseChain({
      data: { enabled: true, config: { stripe_enabled: true } },
      error: null,
    });
    const userChain = createSupabaseChain({ data: { id: USER_ID }, error: null });
    const packageChain = createSupabaseChain({
      data: { id: PACKAGE_ID, name: '100 Credits', credits: 100, price_cents: 999, bonus_percent: 0, stripe_price_id: 'price_test_100' },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return creditFlagChain;
      if (fromCallCount === 2) return userChain;
      return packageChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    mockStripeCheckoutCreate.mockResolvedValue({
      id: STRIPE_SESSION_ID,
      url: 'https://checkout.stripe.com/test',
    });

    const { POST } = await import('@/app/api/credits/purchase/route');
    const req = createMockRequest('/api/credits/purchase', {
      method: 'POST',
      body: { packageId: PACKAGE_ID },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/test');
    expect(body.sessionId).toBe(STRIPE_SESSION_ID);
  });

  // --------------------------------------------------------------------------
  // STEP 4: Stripe webhook fires and credits are added
  // --------------------------------------------------------------------------
  test('Step 4: Stripe webhook adds credits after successful payment', async () => {
    // Construct the Stripe event
    const stripeEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: STRIPE_SESSION_ID,
          payment_intent: PAYMENT_INTENT_ID,
          metadata: {
            user_id: USER_ID,
            package_id: PACKAGE_ID,
            credits: '100',
          },
        },
      },
    };

    mockStripeWebhooksConstructEvent.mockReturnValue(stripeEvent);

    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({
      data: { success: true, new_balance: 150, error: null },
      error: null,
    }));

    mockCreateClient.mockReturnValue(buildSupabaseMock({ rpc: rpcMock }));

    const { POST } = await import('@/app/api/credits/webhook/route');

    // Webhook requests use raw text body, not JSON
    const url = new URL('/api/credits/webhook', 'http://localhost:3000');
    const req = new NextRequest(url.toString(), {
      method: 'POST',
      body: JSON.stringify(stripeEvent),
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test_valid',
      },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.received).toBe(true);
    // Verify add_credits RPC was called with correct params
    expect(rpcMock).toHaveBeenCalledWith('add_credits', expect.objectContaining({
      p_user_id: USER_ID,
      p_amount: 100,
      p_stripe_payment_intent_id: PAYMENT_INTENT_ID,
    }));
  });

  // --------------------------------------------------------------------------
  // STEP 5: Duplicate webhook is idempotent
  // --------------------------------------------------------------------------
  test('Step 5: Duplicate webhook does not double-credit the user', async () => {
    const stripeEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: STRIPE_SESSION_ID,
          payment_intent: PAYMENT_INTENT_ID,
          metadata: { user_id: USER_ID, package_id: PACKAGE_ID, credits: '100' },
        },
      },
    };

    mockStripeWebhooksConstructEvent.mockReturnValue(stripeEvent);

    const rpcMock = jest.fn().mockReturnValue(Promise.resolve({
      data: { success: false, error: 'Payment already processed' },
      error: null,
    }));

    mockCreateClient.mockReturnValue(buildSupabaseMock({ rpc: rpcMock }));

    const { POST } = await import('@/app/api/credits/webhook/route');

    const url = new URL('/api/credits/webhook', 'http://localhost:3000');
    const req = new NextRequest(url.toString(), {
      method: 'POST',
      body: JSON.stringify(stripeEvent),
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_test_valid',
      },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    // Should return 200 (idempotent) not 500
    expect(status).toBe(200);
    expect(body.received).toBe(true);
  });
});
