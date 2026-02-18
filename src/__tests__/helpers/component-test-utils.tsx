/**
 * Shared utilities for component and hook tests.
 * Provides wrapper components, mock routers, and session helpers.
 */

import React from 'react';
import { render, RenderOptions } from '@testing-library/react';

// Mock session type
export interface MockSession {
  user: {
    email: string;
    name: string;
    userId?: string;
    image?: string;
  };
  expires: string;
}

/**
 * Create a mock session object for testing.
 */
export function createMockSession(overrides: Partial<MockSession['user']> = {}): MockSession {
  return {
    user: {
      email: 'test@example.com',
      name: 'Test User',
      userId: '550e8400-e29b-41d4-a716-446655440000',
      ...overrides,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  };
}

/**
 * Create a mock Next.js router.
 */
export function createMockRouter(overrides: Record<string, unknown> = {}) {
  return {
    basePath: '',
    pathname: '/',
    route: '/',
    asPath: '/',
    query: {},
    push: jest.fn().mockResolvedValue(true),
    replace: jest.fn().mockResolvedValue(true),
    reload: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn().mockResolvedValue(undefined),
    beforePopState: jest.fn(),
    events: {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    },
    isFallback: false,
    isLocaleDomain: false,
    isReady: true,
    isPreview: false,
    locale: 'en',
    ...overrides,
  };
}

/**
 * Create mock useSearchParams return value.
 */
export function createMockSearchParams(params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams(params);
  return {
    get: (key: string) => searchParams.get(key),
    getAll: (key: string) => searchParams.getAll(key),
    has: (key: string) => searchParams.has(key),
    toString: () => searchParams.toString(),
    entries: () => searchParams.entries(),
    keys: () => searchParams.keys(),
    values: () => searchParams.values(),
    forEach: (cb: (value: string, key: string) => void) => searchParams.forEach(cb),
  };
}

/**
 * Simple wrapper that provides common providers for component tests.
 * Since the app uses next-auth SessionProvider and potentially React Query,
 * this wrapper mocks them.
 */
export function createWrapper(session: MockSession | null = null) {
  // Return a wrapper component
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  };
}

/**
 * Custom render that wraps components with common providers.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { session?: MockSession | null }
) {
  const { session = null, ...renderOptions } = options || {};
  const Wrapper = createWrapper(session);
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

/**
 * Mock global fetch with a sequence of responses.
 */
export function mockFetchSequence(
  responses: Array<{ ok?: boolean; status?: number; json?: unknown; text?: string }>
) {
  let callIndex = 0;
  const mockFetch = jest.fn(async () => {
    const resp = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    return {
      ok: resp.ok ?? true,
      status: resp.status ?? (resp.ok === false ? 400 : 200),
      json: async () => resp.json ?? {},
      text: async () => resp.text ?? JSON.stringify(resp.json ?? {}),
      headers: new Headers(),
    };
  });
  global.fetch = mockFetch as unknown as typeof fetch;
  return mockFetch;
}

/**
 * Mock global fetch with a single response.
 */
export function mockFetch(response: { ok?: boolean; status?: number; json?: unknown; text?: string }) {
  return mockFetchSequence([response]);
}
