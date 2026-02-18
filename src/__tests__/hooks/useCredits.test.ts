// Tests for useCredits hook
// Verifies balance fetch, 401 handling, error states, loading states, refetch

import { renderHook, act, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { useCredits } from '@/hooks/useCredits';

describe('useCredits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts in loading state', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useCredits());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.balance).toBe(0);
    expect(result.current.lifetimePurchased).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('fetches balance successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ balance: 150, lifetime_purchased: 500 }),
    });

    const { result } = renderHook(() => useCredits());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.balance).toBe(150);
    expect(result.current.lifetimePurchased).toBe(500);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith('/api/credits/balance', {
      credentials: 'include',
    });
  });

  it('handles 401 unauthenticated gracefully (zero balance, no error)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Not authenticated' }),
    });

    const { result } = renderHook(() => useCredits());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.balance).toBe(0);
    expect(result.current.lifetimePurchased).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('handles non-401 fetch error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    const { result } = renderHook(() => useCredits());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch balance');
    expect(result.current.balance).toBe(0);
  });

  it('handles network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const { result } = renderHook(() => useCredits());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Network failure');
  });

  it('refetch updates balance', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ balance: 100, lifetime_purchased: 100 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ balance: 50, lifetime_purchased: 100 }),
      });

    const { result } = renderHook(() => useCredits());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBe(100);

    // Trigger refetch
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.balance).toBe(50);
  });

  it('defaults missing fields to zero', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}), // no balance or lifetime_purchased
    });

    const { result } = renderHook(() => useCredits());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.balance).toBe(0);
    expect(result.current.lifetimePurchased).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('does not update state after unmount', async () => {
    // Use a delayed response to test unmount race
    let resolvePromise: (value: unknown) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const { result, unmount } = renderHook(() => useCredits());
    expect(result.current.isLoading).toBe(true);

    // Unmount before fetch resolves
    unmount();

    // Now resolve - should not throw or update state
    await act(async () => {
      resolvePromise!({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ balance: 999, lifetime_purchased: 999 }),
      });
    });

    // No assertion on result.current after unmount - just ensure no errors thrown
  });
});
