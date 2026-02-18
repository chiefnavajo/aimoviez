// Tests for useFeatureFlags and useFeature hooks

import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { useFeatureFlags, useFeature } from '@/hooks/useFeatureFlags';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useFeatureFlags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches feature flags successfully', async () => {
    const flagsData = {
      features: {
        co_director: true,
        movie_maker: false,
        teams: true,
      },
      configs: {
        co_director: { max_directions: 4 },
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(flagsData),
    });

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.features).toEqual(flagsData.features);
    expect(result.current.configs).toEqual(flagsData.configs);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith('/api/features');
  });

  it('isEnabled returns true for enabled features', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          features: { teams: true, movie_maker: false },
          configs: {},
        }),
    });

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isEnabled('teams')).toBe(true);
    expect(result.current.isEnabled('movie_maker')).toBe(false);
  });

  it('isEnabled returns false for unknown features', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: {}, configs: {} }),
    });

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEnabled('nonexistent_feature')).toBe(false);
  });

  it('getConfig returns config for a feature', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          features: { co_director: true },
          configs: { co_director: { max_directions: 4, voting_period_hours: 24 } },
        }),
    });

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const config = result.current.getConfig<{ max_directions: number }>('co_director');
    expect(config?.max_directions).toBe(4);
  });

  it('getConfig returns null for missing config', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: {}, configs: {} }),
    });

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getConfig('nonexistent')).toBeNull();
  });

  it('handles fetch error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useFeatureFlags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    // Defaults when errored
    expect(result.current.features).toEqual({});
    expect(result.current.isEnabled('anything')).toBe(false);
  });
});

describe('useFeature', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns enabled status for a specific feature', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          features: { teams: true },
          configs: { teams: { max_members: 10 } },
        }),
    });

    const { result } = renderHook(() => useFeature('teams'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(result.current.config).toEqual({ max_members: 10 });
  });

  it('returns disabled for missing feature', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ features: {}, configs: {} }),
    });

    const { result } = renderHook(() => useFeature('unknown_flag'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
    expect(result.current.config).toBeNull();
  });
});
