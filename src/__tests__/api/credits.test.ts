/**
 * @jest-environment node
 */
/**
 * credits.test.ts
 * Unit tests for the credits API routes:
 *   GET  /api/credits/balance   — authenticated user credit balance
 *   GET  /api/credits/packages  — available credit packages + model pricing
 *   POST /api/credits/purchase  — Stripe checkout session creation
 *   POST /api/credits/webhook   — Stripe webhook handling (checkout.session.completed)
 */

// ---------------------------------------------------------------------------
// Mocks — BEFORE any imports
// ---------------------------------------------------------------------------

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: jest.fn().mockResolvedValue(null) }));

// Stripe mock — mirrors the shape used by the route handlers
const mockCheckoutSessionsCreate = jest.fn();
const mockWebhooksConstructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: mockCheckoutSessionsCreate,
      },
    },
    webhooks: {
      constructEvent: mockWebhooksConstructEvent,
    },
  }));
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import {
  createSupabaseChain,
  createMultiTableMock,
  createSequentialMock,
  createMockRequest,
  parseResponse,
  mockSession,
  expectChainCall,
  TEST_USER,
} from '../helpers/api-test-utils';

import { GET as balanceGet } from '@/app/api/credits/balance/route';
import { GET as packagesGet } from '@/app/api/credits/packages/route';
import { POST as purchasePost } from '@/app/api/credits/purchase/route';
import { POST as webhookPost } from '@/app/api/credits/webhook/route';

// ---------------------------------------------------------------------------
// Shared references
// ---------------------------------------------------------------------------

const mockCreateClient = createClient as jest.Mock;
const mockGetServerSession = getServerSession as jest.Mock;

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test.com';
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// GET /api/credits/balance
// ===========================================================================

describe('GET /api/credits/balance', () => {
  const url = '/api/credits/balance';

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await balanceGet(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns balance for authenticated user', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const chain = createSupabaseChain({
      data: { id: TEST_USER.userId, balance_credits: 150, lifetime_purchased_credits: 500 },
      error: null,
    });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await balanceGet(req));

    expect(status).toBe(200);
    expect(body.balance).toBe(150);
    expect(body.lifetime_purchased).toBe(500);
    expectChainCall(chain, 'from', 'users');
    expectChainCall(chain, 'eq', 'email', TEST_USER.email);
  });

  test('returns 404 when user not found in DB', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const chain = createSupabaseChain({ data: null, error: null });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await balanceGet(req));

    expect(status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  test('returns 500 on database error', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const chain = createSupabaseChain({
      data: null,
      error: { message: 'connection refused', code: 'ECONNREFUSED' },
    });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await balanceGet(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch balance');
  });

  test('defaults null balances to 0', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const chain = createSupabaseChain({
      data: { id: TEST_USER.userId, balance_credits: null, lifetime_purchased_credits: null },
      error: null,
    });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await balanceGet(req));

    expect(status).toBe(200);
    expect(body.balance).toBe(0);
    expect(body.lifetime_purchased).toBe(0);
  });

  test('selects the correct columns', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const chain = createSupabaseChain({
      data: { id: 'u1', balance_credits: 10, lifetime_purchased_credits: 20 },
      error: null,
    });
    mockCreateClient.mockReturnValue({ from: chain.from });

    const req = createMockRequest(url);
    await balanceGet(req);

    expectChainCall(chain, 'select', 'id, balance_credits, lifetime_purchased_credits');
  });
});

// ===========================================================================
// GET /api/credits/packages
// ===========================================================================

describe('GET /api/credits/packages', () => {
  const url = '/api/credits/packages';

  function buildPackagesMock(
    packages: unknown[] | null,
    packagesError: unknown | null = null,
    pricing: unknown[] | null = null,
    pricingError: unknown | null = null,
  ) {
    // The route calls .from('credit_packages') then .from('model_pricing') sequentially.
    const seq = createSequentialMock([
      { data: packages, error: packagesError },
      { data: pricing, error: pricingError },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });
    return seq;
  }

  test('returns available packages with enriched pricing', async () => {
    const pkgs = [
      { id: 'pkg-1', name: 'Starter', credits: 100, price_cents: 499, bonus_percent: 0, sort_order: 1 },
      { id: 'pkg-2', name: 'Pro', credits: 500, price_cents: 1999, bonus_percent: 10, sort_order: 2 },
    ];
    const pricing = [
      { model_key: 'gpt-4', display_name: 'GPT-4', credit_cost: 5 },
    ];

    buildPackagesMock(pkgs, null, pricing, null);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await packagesGet(req));

    expect(status).toBe(200);
    expect(body.packages).toHaveLength(2);
    expect(body.packages[0].id).toBe('pkg-1');
    expect(body.packages[0].name).toBe('Starter');
    expect(body.packages[0].credits).toBe(100);
    expect(body.packages[0].total_credits).toBe(100);
    expect(body.packages[0].price_cents).toBe(499);
    // price_per_credit_cents = round(499/100 * 100) / 100 = 4.99
    expect(body.packages[0].price_per_credit_cents).toBe(4.99);
    expect(body.model_pricing).toHaveLength(1);
    expect(body.model_pricing[0].model_key).toBe('gpt-4');
  });

  test('returns empty packages array when no packages exist', async () => {
    buildPackagesMock([], null, [], null);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await packagesGet(req));

    expect(status).toBe(200);
    expect(body.packages).toEqual([]);
    expect(body.model_pricing).toEqual([]);
  });

  test('returns 500 on packages DB error', async () => {
    buildPackagesMock(null, { message: 'relation does not exist' });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await packagesGet(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch packages');
  });

  test('continues without pricing on pricing DB error', async () => {
    const pkgs = [
      { id: 'pkg-1', name: 'Starter', credits: 100, price_cents: 499, bonus_percent: 0, sort_order: 1 },
    ];
    buildPackagesMock(pkgs, null, null, { message: 'pricing table error' });

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await packagesGet(req));

    expect(status).toBe(200);
    expect(body.packages).toHaveLength(1);
    // pricing error is non-fatal; model_pricing should default to []
    expect(body.model_pricing).toEqual([]);
  });

  test('handles null packages data gracefully', async () => {
    buildPackagesMock(null, null, null, null);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await packagesGet(req));

    expect(status).toBe(200);
    expect(body.packages).toEqual([]);
    expect(body.model_pricing).toEqual([]);
  });

  test('does not require authentication', async () => {
    // Packages endpoint is public — no session check
    mockSession(mockGetServerSession, null);
    buildPackagesMock([], null, [], null);

    const req = createMockRequest(url);
    const { status } = await parseResponse(await packagesGet(req));

    expect(status).toBe(200);
  });
});

// ===========================================================================
// POST /api/credits/purchase
// ===========================================================================

describe('POST /api/credits/purchase', () => {
  const url = '/api/credits/purchase';

  function buildPurchaseMock(opts: {
    featureFlag?: { enabled: boolean; config: Record<string, unknown> } | null;
    featureFlagError?: unknown;
    user?: { id: string } | null;
    userError?: unknown;
    pkg?: Record<string, unknown> | null;
    pkgError?: unknown;
  }) {
    // The route makes 3 sequential .from() calls:
    //   1. feature_flags (maybeSingle)
    //   2. users (maybeSingle)
    //   3. credit_packages (maybeSingle)
    const seq = createSequentialMock([
      { data: opts.featureFlag ?? null, error: opts.featureFlagError ?? null },
      { data: opts.user ?? null, error: opts.userError ?? null },
      { data: opts.pkg ?? null, error: opts.pkgError ?? null },
    ]);
    mockCreateClient.mockReturnValue({ from: seq.from });
    return seq;
  }

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, {
      method: 'POST',
      body: { packageId: 'pkg-1' },
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
    expect(body.success).toBe(false);
  });

  test('returns 403 when credit system feature flag is disabled', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: false, config: { stripe_enabled: true } },
    });

    const req = createMockRequest(url, {
      method: 'POST',
      body: { packageId: 'pkg-1' },
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Credit system is not currently available');
  });

  test('returns 403 when stripe_enabled is false in config', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: true, config: { stripe_enabled: false } },
    });

    const req = createMockRequest(url, {
      method: 'POST',
      body: { packageId: 'pkg-1' },
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Purchases are not currently available');
  });

  test('returns 400 for missing packageId', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: true, config: { stripe_enabled: true } },
    });

    const req = createMockRequest(url, {
      method: 'POST',
      body: {},
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('packageId is required');
    expect(body.success).toBe(false);
  });

  test('returns 400 for non-string packageId', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: true, config: { stripe_enabled: true } },
    });

    const req = createMockRequest(url, {
      method: 'POST',
      body: { packageId: 12345 },
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('packageId is required');
  });

  test('returns 404 when user not found', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: true, config: { stripe_enabled: true } },
      user: null,
    });

    const req = createMockRequest(url, {
      method: 'POST',
      body: { packageId: 'pkg-1' },
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  test('returns 404 when package not found', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: true, config: { stripe_enabled: true } },
      user: { id: TEST_USER.userId },
      pkg: null,
    });

    const req = createMockRequest(url, {
      method: 'POST',
      body: { packageId: 'pkg-nonexistent' },
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(404);
    expect(body.error).toBe('Package not found or unavailable');
  });

  test('returns 500 when package has no stripe_price_id', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: true, config: { stripe_enabled: true } },
      user: { id: TEST_USER.userId },
      pkg: {
        id: 'pkg-1', name: 'Starter', credits: 100,
        price_cents: 499, bonus_percent: 0, stripe_price_id: null,
      },
    });

    const req = createMockRequest(url, {
      method: 'POST',
      body: { packageId: 'pkg-1' },
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Package not configured for purchase');
  });

  test('creates Stripe checkout session (happy path)', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: true, config: { stripe_enabled: true } },
      user: { id: TEST_USER.userId },
      pkg: {
        id: 'pkg-1', name: 'Pro Pack', credits: 500,
        price_cents: 1999, bonus_percent: 10, stripe_price_id: 'price_abc123',
      },
    });

    mockCheckoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_session_123',
      url: 'https://checkout.stripe.com/pay/cs_test_session_123',
    });

    const req = createMockRequest(url, {
      method: 'POST',
      body: { packageId: 'pkg-1' },
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sessionId).toBe('cs_test_session_123');
    expect(body.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_session_123');

    // Verify Stripe was called with correct params
    expect(mockCheckoutSessionsCreate).toHaveBeenCalledTimes(1);
    const stripeArgs = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(stripeArgs.mode).toBe('payment');
    expect(stripeArgs.line_items).toEqual([{ price: 'price_abc123', quantity: 1 }]);
    expect(stripeArgs.metadata.user_id).toBe(TEST_USER.userId);
    expect(stripeArgs.metadata.package_id).toBe('pkg-1');
    expect(stripeArgs.metadata.credits).toBe('500');
    expect(stripeArgs.customer_email).toBe(TEST_USER.email);
    expect(stripeArgs.success_url).toContain('purchase=success');
    expect(stripeArgs.cancel_url).toContain('purchase=cancelled');
  });

  test('returns 500 when Stripe checkout creation fails', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: true, config: { stripe_enabled: true } },
      user: { id: TEST_USER.userId },
      pkg: {
        id: 'pkg-1', name: 'Pro Pack', credits: 500,
        price_cents: 1999, bonus_percent: 10, stripe_price_id: 'price_abc123',
      },
    });

    mockCheckoutSessionsCreate.mockRejectedValue(new Error('Stripe API error'));

    const req = createMockRequest(url, {
      method: 'POST',
      body: { packageId: 'pkg-1' },
    });
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to create checkout session');
  });

  test('returns 400 for invalid JSON body', async () => {
    mockSession(mockGetServerSession, TEST_USER);
    buildPurchaseMock({
      featureFlag: { enabled: true, config: { stripe_enabled: true } },
    });

    // Create a request with a body that will fail JSON parsing
    const reqInit: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '127.0.0.1',
        'user-agent': 'jest-test-agent',
      },
      body: 'not valid json{{{',
    };
    const req = new (require('next/server').NextRequest)(
      'http://localhost:3000/api/credits/purchase',
      reqInit,
    );
    const { status, body } = await parseResponse(await purchasePost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
  });
});

// ===========================================================================
// POST /api/credits/webhook
// ===========================================================================

describe('POST /api/credits/webhook', () => {
  const url = '/api/credits/webhook';

  /**
   * Create a webhook request with optional stripe-signature header and raw body text.
   */
  function createWebhookRequest(rawBody: string, signature?: string) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
      'user-agent': 'Stripe/1.0',
    };
    if (signature) {
      headers['stripe-signature'] = signature;
    }

    return new (require('next/server').NextRequest)(
      'http://localhost:3000/api/credits/webhook',
      { method: 'POST', headers, body: rawBody },
    );
  }

  test('returns 400 for missing stripe-signature header', async () => {
    const req = createWebhookRequest('{}');
    const { status, body } = await parseResponse(await webhookPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Missing stripe-signature header');
  });

  test('returns 400 for invalid signature', async () => {
    mockWebhooksConstructEvent.mockImplementation(() => {
      throw new Error('Signature verification failed');
    });

    const req = createWebhookRequest('{}', 'sig_invalid');
    const { status, body } = await parseResponse(await webhookPost(req));

    expect(status).toBe(400);
    expect(body.error).toBe('Invalid signature');
  });

  test('processes checkout.session.completed event and adds credits', async () => {
    const rpcMock = jest.fn().mockResolvedValue({
      data: { success: true, new_balance: 600 },
      error: null,
    });
    mockCreateClient.mockReturnValue({ rpc: rpcMock });

    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          metadata: {
            user_id: 'user-abc',
            package_id: 'pkg-1',
            credits: '500',
          },
          payment_intent: 'pi_test_456',
        },
      },
    });

    const req = createWebhookRequest('{"type":"checkout.session.completed"}', 'sig_valid');
    const { status, body } = await parseResponse(await webhookPost(req));

    expect(status).toBe(200);
    expect(body.received).toBe(true);

    // Verify RPC was called correctly
    expect(rpcMock).toHaveBeenCalledWith('add_credits', {
      p_user_id: 'user-abc',
      p_amount: 500,
      p_stripe_payment_intent_id: 'pi_test_456',
      p_package_id: 'pkg-1',
    });
  });

  test('handles duplicate events (idempotency) gracefully', async () => {
    const rpcMock = jest.fn().mockResolvedValue({
      data: { success: false, error: 'Payment already processed' },
      error: null,
    });
    mockCreateClient.mockReturnValue({ rpc: rpcMock });

    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          metadata: {
            user_id: 'user-abc',
            package_id: 'pkg-1',
            credits: '500',
          },
          payment_intent: 'pi_test_456',
        },
      },
    });

    const req = createWebhookRequest('{"type":"checkout.session.completed"}', 'sig_valid');
    const { status, body } = await parseResponse(await webhookPost(req));

    // Route returns 200 even for duplicates (to prevent Stripe retries)
    expect(status).toBe(200);
    expect(body.received).toBe(true);
  });

  test('ignores unrelated event types', async () => {
    mockWebhooksConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: {} },
    });

    const rpcMock = jest.fn();
    mockCreateClient.mockReturnValue({ rpc: rpcMock });

    const req = createWebhookRequest('{"type":"payment_intent.succeeded"}', 'sig_valid');
    const { status, body } = await parseResponse(await webhookPost(req));

    expect(status).toBe(200);
    expect(body.received).toBe(true);
    // RPC should not be called for non-checkout events
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test('returns 200 with error info when metadata is missing', async () => {
    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_bad_metadata',
          metadata: {},
          payment_intent: 'pi_test_789',
        },
      },
    });

    const rpcMock = jest.fn();
    mockCreateClient.mockReturnValue({ rpc: rpcMock });

    const req = createWebhookRequest('{}', 'sig_valid');
    const { status, body } = await parseResponse(await webhookPost(req));

    // Returns 200 to prevent Stripe retries for malformed metadata
    expect(status).toBe(200);
    expect(body.received).toBe(true);
    expect(body.error).toBe('Invalid metadata');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test('returns 200 with error info when credits is zero', async () => {
    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_zero',
          metadata: {
            user_id: 'user-abc',
            package_id: 'pkg-1',
            credits: '0',
          },
          payment_intent: 'pi_test_000',
        },
      },
    });

    const rpcMock = jest.fn();
    mockCreateClient.mockReturnValue({ rpc: rpcMock });

    const req = createWebhookRequest('{}', 'sig_valid');
    const { status, body } = await parseResponse(await webhookPost(req));

    expect(status).toBe(200);
    expect(body.error).toBe('Invalid metadata');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test('returns 200 with error when payment_intent is missing', async () => {
    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_no_pi',
          metadata: {
            user_id: 'user-abc',
            package_id: 'pkg-1',
            credits: '500',
          },
          payment_intent: null,
        },
      },
    });

    const rpcMock = jest.fn();
    mockCreateClient.mockReturnValue({ rpc: rpcMock });

    const req = createWebhookRequest('{}', 'sig_valid');
    const { status, body } = await parseResponse(await webhookPost(req));

    expect(status).toBe(200);
    expect(body.error).toBe('Missing payment intent');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test('returns 500 when add_credits RPC fails', async () => {
    const rpcMock = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'RPC function not found' },
    });
    mockCreateClient.mockReturnValue({ rpc: rpcMock });

    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_rpc_fail',
          metadata: {
            user_id: 'user-abc',
            package_id: 'pkg-1',
            credits: '500',
          },
          payment_intent: 'pi_test_fail',
        },
      },
    });

    const req = createWebhookRequest('{}', 'sig_valid');
    const { status, body } = await parseResponse(await webhookPost(req));

    // Returns 500 so Stripe retries
    expect(status).toBe(500);
    expect(body.error).toBe('Failed to add credits');
  });

  test('handles payment_intent as an object with id', async () => {
    const rpcMock = jest.fn().mockResolvedValue({
      data: { success: true, new_balance: 1000 },
      error: null,
    });
    mockCreateClient.mockReturnValue({ rpc: rpcMock });

    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_obj_pi',
          metadata: {
            user_id: 'user-xyz',
            package_id: 'pkg-2',
            credits: '1000',
          },
          payment_intent: { id: 'pi_object_id' },
        },
      },
    });

    const req = createWebhookRequest('{}', 'sig_valid');
    const { status, body } = await parseResponse(await webhookPost(req));

    expect(status).toBe(200);
    expect(body.received).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('add_credits', {
      p_user_id: 'user-xyz',
      p_amount: 1000,
      p_stripe_payment_intent_id: 'pi_object_id',
      p_package_id: 'pkg-2',
    });
  });

  test('returns 500 when STRIPE_WEBHOOK_SECRET is missing', async () => {
    const savedSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;

    try {
      const req = createWebhookRequest('{}', 'sig_valid');
      const { status, body } = await parseResponse(await webhookPost(req));

      expect(status).toBe(500);
      expect(body.error).toBe('Webhook not configured');
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = savedSecret;
    }
  });

  test('passes null for package_id when metadata has no package_id', async () => {
    const rpcMock = jest.fn().mockResolvedValue({
      data: { success: true, new_balance: 100 },
      error: null,
    });
    mockCreateClient.mockReturnValue({ rpc: rpcMock });

    mockWebhooksConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_no_pkg',
          metadata: {
            user_id: 'user-abc',
            credits: '100',
          },
          payment_intent: 'pi_no_pkg',
        },
      },
    });

    const req = createWebhookRequest('{}', 'sig_valid');
    const { status } = await parseResponse(await webhookPost(req));

    expect(status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith('add_credits', {
      p_user_id: 'user-abc',
      p_amount: 100,
      p_stripe_payment_intent_id: 'pi_no_pkg',
      p_package_id: null,
    });
  });
});
