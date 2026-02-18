// Tests for useAdminAuth hook
// Verifies admin check, non-admin rejection, loading state, unauthenticated state

import { renderHook, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockUseSession = jest.fn();

jest.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));

import { useAdminAuth } from '@/hooks/useAdminAuth';

describe('useAdminAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
  });

  it('starts in loading state', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });

    const { result } = renderHook(() => useAdminAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAdmin).toBe(false);
  });

  it('returns not admin when unauthenticated', async () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toBe('Not authenticated');
    // Should not have called the API
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns admin: true when API responds 200', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: 'admin@example.com' } },
      status: 'authenticated',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith('/api/admin/stats', {
      signal: expect.any(AbortSignal),
    });
  });

  it('returns admin: false when API responds 403', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: 'user@example.com' } },
      status: 'authenticated',
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toBe('Not authorized as admin');
  });

  it('returns admin: false when API responds 401', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: 'expired@example.com' } },
      status: 'authenticated',
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toBe('Not authenticated');
  });

  it('handles network error gracefully', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { email: 'admin@example.com' } },
      status: 'authenticated',
    });

    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAdminAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.error).toBe('Failed to verify admin status');
  });
});
