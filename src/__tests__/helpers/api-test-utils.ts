// Shared mock utilities for API route unit tests
// Provides chainable Supabase mocks, Redis mocks, NextRequest helpers, and session mocks

import { NextRequest } from 'next/server';

// ============================================================================
// SUPABASE MOCK
// ============================================================================

export interface MockSupabaseChain {
  from: jest.Mock;
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  upsert: jest.Mock;
  delete: jest.Mock;
  eq: jest.Mock;
  neq: jest.Mock;
  in: jest.Mock;
  lt: jest.Mock;
  gt: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  ilike: jest.Mock;
  like: jest.Mock;
  is: jest.Mock;
  or: jest.Mock;
  not: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  range: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  then: jest.Mock;
  // Track calls for assertions
  _calls: { method: string; args: unknown[] }[];
  _resolveValue: { data: unknown; error: unknown; count?: number | null };
}

/**
 * Creates a chainable Supabase mock that records all method calls.
 * Configure the return value with `_resolveValue` before calling the chain.
 *
 * Usage:
 *   const chain = createSupabaseChain({ data: [...], error: null });
 *   mockCreateClient.mockReturnValue({ from: chain.from });
 *   // After route handler runs:
 *   expect(chain._calls).toContainEqual({ method: 'eq', args: ['user_key', 'user_xxx'] });
 */
export function createSupabaseChain(
  resolveValue: { data?: unknown; error?: unknown; count?: number | null } = {}
): MockSupabaseChain {
  const calls: { method: string; args: unknown[] }[] = [];
  const resolved = {
    data: resolveValue.data ?? null,
    error: resolveValue.error ?? null,
    count: resolveValue.count ?? null,
  };

  const chain: Partial<MockSupabaseChain> = {
    _calls: calls,
    _resolveValue: resolved,
  };

  // All chainable methods return the chain itself
  const chainableMethods = [
    'from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'lt', 'gt', 'gte', 'lte',
    'ilike', 'like', 'is', 'or', 'not',
    'order', 'limit', 'range',
  ] as const;

  for (const method of chainableMethods) {
    (chain as Record<string, unknown>)[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    });
  }

  // Terminal methods return the resolved value
  chain.single = jest.fn(() => {
    calls.push({ method: 'single', args: [] });
    return Promise.resolve(resolved);
  });

  chain.maybeSingle = jest.fn(() => {
    calls.push({ method: 'maybeSingle', args: [] });
    return Promise.resolve(resolved);
  });

  // Make the chain itself thenable (for queries without .single())
  chain.then = jest.fn((resolve) => {
    return Promise.resolve(resolved).then(resolve);
  });

  return chain as MockSupabaseChain;
}

/**
 * Creates a multi-response Supabase mock where different .from() tables
 * return different chainable mocks.
 *
 * Usage:
 *   const mocks = createMultiTableMock({
 *     users: { data: { id: '123' }, error: null },
 *     referrals: { data: null, error: null, count: 5 },
 *   });
 *   mockCreateClient.mockReturnValue({ from: mocks.from });
 */
export function createMultiTableMock(
  tables: Record<string, { data?: unknown; error?: unknown; count?: number | null }>
) {
  const chains: Record<string, MockSupabaseChain> = {};

  for (const [table, resolveValue] of Object.entries(tables)) {
    chains[table] = createSupabaseChain(resolveValue);
  }

  const defaultChain = createSupabaseChain();

  const from = jest.fn((table: string) => {
    return chains[table] || defaultChain;
  });

  return { from, chains, defaultChain };
}

// ============================================================================
// REDIS MOCK
// ============================================================================

export interface MockRedis {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  sadd: jest.Mock;
  srem: jest.Mock;
  smembers: jest.Mock;
  scard: jest.Mock;
  pipeline: jest.Mock;
  hget: jest.Mock;
  hset: jest.Mock;
  hdel: jest.Mock;
  hgetall: jest.Mock;
  incr: jest.Mock;
  expire: jest.Mock;
  exists: jest.Mock;
}

export function createMockRedis(overrides: Partial<MockRedis> = {}): MockRedis {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    scard: jest.fn().mockResolvedValue(0),
    pipeline: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    }),
    hget: jest.fn().mockResolvedValue(null),
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

// ============================================================================
// NEXT REQUEST HELPERS
// ============================================================================

/**
 * Create a NextRequest for testing API route handlers.
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
  } = {}
): NextRequest {
  const { method = 'GET', body, headers = {}, searchParams = {} } = options;

  const urlObj = new URL(url, 'http://localhost:3000');
  for (const [key, value] of Object.entries(searchParams)) {
    urlObj.searchParams.set(key, value);
  }

  const reqInit: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '127.0.0.1',
      'user-agent': 'jest-test-agent',
      ...headers,
    },
  };

  if (body && method !== 'GET') {
    reqInit.body = JSON.stringify(body);
  }

  return new NextRequest(urlObj.toString(), reqInit);
}

// ============================================================================
// SESSION MOCK HELPERS
// ============================================================================

export const TEST_USER = {
  email: 'test@example.com',
  name: 'Test User',
  userId: '550e8400-e29b-41d4-a716-446655440000',
};

export const TEST_ADMIN = {
  email: 'admin@aimoviez.app',
  name: 'Admin User',
  userId: '660e8400-e29b-41d4-a716-446655440000',
};

/**
 * Mock getServerSession to return a specific session.
 * Call with null for unauthenticated requests.
 */
export function mockSession(
  getServerSessionMock: jest.Mock,
  user: { email: string; name?: string; userId?: string } | null
) {
  if (user === null) {
    getServerSessionMock.mockResolvedValue(null);
  } else {
    getServerSessionMock.mockResolvedValue({
      user: {
        email: user.email,
        name: user.name || 'Test User',
        userId: user.userId,
      },
    });
  }
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Check if a Supabase chain had a specific method called with specific args.
 */
export function expectChainCall(
  chain: MockSupabaseChain,
  method: string,
  ...expectedArgs: unknown[]
) {
  const matching = chain._calls.filter(
    (c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(expectedArgs)
  );
  if (matching.length === 0) {
    const allCalls = chain._calls.map(c => `${c.method}(${JSON.stringify(c.args)})`).join('\n  ');
    throw new Error(
      `Expected chain call ${method}(${JSON.stringify(expectedArgs)}) not found.\nActual calls:\n  ${allCalls}`
    );
  }
}

/**
 * Check that a Supabase chain did NOT have a specific method called.
 */
export function expectNoChainCall(chain: MockSupabaseChain, method: string) {
  const matching = chain._calls.filter((c) => c.method === method);
  if (matching.length > 0) {
    throw new Error(
      `Expected no ${method}() calls but found ${matching.length}: ${JSON.stringify(matching)}`
    );
  }
}

/**
 * Parse a NextResponse JSON body.
 */
export async function parseResponse(response: Response) {
  const body = await response.json();
  return { status: response.status, body };
}

// ============================================================================
// SEQUENTIAL MOCK (for routes with multiple .from() calls)
// ============================================================================

/**
 * Creates a mock that returns different results for sequential calls.
 * Useful when a route calls .from('same_table') multiple times.
 *
 * Usage:
 *   const seqMock = createSequentialMock([
 *     { data: { id: '1' }, error: null },   // 1st call
 *     { data: null, error: { message: 'not found' } },  // 2nd call
 *   ]);
 *   mockCreateClient.mockReturnValue({ from: seqMock.from, rpc: jest.fn() });
 */
export function createSequentialMock(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  let callIndex = 0;
  const chains = responses.map(r => createSupabaseChain(r));

  const from = jest.fn(() => {
    const chain = chains[Math.min(callIndex, chains.length - 1)];
    callIndex++;
    return chain;
  });

  return { from, chains };
}

// ============================================================================
// CRON REQUEST HELPER
// ============================================================================

/**
 * Create a NextRequest with CRON_SECRET authorization header.
 */
export function createCronRequest(
  url: string,
  secret?: string
): NextRequest {
  const headers: Record<string, string> = {};
  if (secret) {
    headers['authorization'] = `Bearer ${secret}`;
  }
  return createMockRequest(url, { headers });
}

// ============================================================================
// ADMIN AUTH MOCK HELPER
// ============================================================================

/**
 * Mock requireAdmin / requireAdminWithAuth to succeed.
 * Pass the mock function reference.
 */
export function mockAdminAuth(
  mock: jest.Mock,
  userId: string = TEST_ADMIN.userId
) {
  mock.mockResolvedValue({
    isAdmin: true,
    userId,
    email: TEST_ADMIN.email,
  });
}

/**
 * Mock requireAdmin / requireAdminWithAuth to fail (not admin).
 */
export function mockAdminAuthFail(mock: jest.Mock) {
  const { NextResponse } = require('next/server');
  mock.mockResolvedValue(
    NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  );
}

/**
 * Mock requireAdmin / requireAdminWithAuth to fail (not authenticated).
 */
export function mockAdminAuthUnauth(mock: jest.Mock) {
  const { NextResponse } = require('next/server');
  mock.mockResolvedValue(
    NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  );
}

// ============================================================================
// QUICK ASSERTION
// ============================================================================

/**
 * Assert response status code.
 */
export async function expectStatus(response: Response, status: number) {
  expect(response.status).toBe(status);
  return response;
}

/**
 * Assert response status and parse JSON body.
 */
export async function expectJson(response: Response, status: number) {
  expect(response.status).toBe(status);
  const body = await response.json();
  return body;
}
