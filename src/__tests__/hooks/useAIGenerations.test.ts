// Tests for useAIGenerations hook

import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { useAIGenerations } from '@/hooks/useAIGenerations';

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

describe('useAIGenerations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches generation history with default pagination', async () => {
    const historyData = {
      success: true,
      generations: [
        {
          id: 'gen-1',
          stage: 'video',
          prompt: 'A spaceship in orbit',
          model: 'minimax',
          video_url: 'https://cdn.example.com/v1.mp4',
          created_at: '2026-02-01T00:00:00Z',
          completed_at: '2026-02-01T00:01:00Z',
        },
        {
          id: 'gen-2',
          stage: 'narration',
          prompt: 'Narrate a dramatic scene',
          model: 'claude',
          created_at: '2026-02-01T01:00:00Z',
        },
      ],
      page: 1,
      limit: 20,
      hasMore: false,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(historyData),
    });

    const { result } = renderHook(() => useAIGenerations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.generations).toHaveLength(2);
    expect(result.current.data?.page).toBe(1);
    expect(result.current.data?.hasMore).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith('/api/ai/history?page=1&limit=20');
  });

  it('passes custom page and limit parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          generations: [],
          page: 3,
          limit: 10,
          hasMore: true,
        }),
    });

    const { result } = renderHook(() => useAIGenerations(3, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFetch).toHaveBeenCalledWith('/api/ai/history?page=3&limit=10');
    expect(result.current.data?.hasMore).toBe(true);
  });

  it('handles fetch error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useAIGenerations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('Failed to fetch AI generations');
  });

  it('returns loading state while fetching', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useAIGenerations(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('includes generation entries with error_message', async () => {
    const data = {
      success: true,
      generations: [
        {
          id: 'gen-err',
          stage: 'video',
          prompt: 'broken prompt',
          model: 'minimax',
          error_message: 'Generation timed out',
          created_at: '2026-02-01T00:00:00Z',
        },
      ],
      page: 1,
      limit: 20,
      hasMore: false,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });

    const { result } = renderHook(() => useAIGenerations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.generations[0].error_message).toBe('Generation timed out');
  });

  it('queries different keys for different page values', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ success: true, generations: [], page: 1, limit: 20, hasMore: false }),
    });

    const wrapper = createWrapper();

    const { result: result1 } = renderHook(() => useAIGenerations(1), { wrapper });
    const { result: result2 } = renderHook(() => useAIGenerations(2), { wrapper });

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
    });

    // Two separate fetch calls for page 1 and page 2
    expect(mockFetch).toHaveBeenCalledWith('/api/ai/history?page=1&limit=20');
    expect(mockFetch).toHaveBeenCalledWith('/api/ai/history?page=2&limit=20');
  });
});
