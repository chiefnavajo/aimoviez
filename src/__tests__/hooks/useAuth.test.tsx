// Tests for useAuth hook
// Verifies authenticated, unauthenticated, and loading states, profile fetch

import { renderHook, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockPush = jest.fn();
const mockUseRouter = jest.fn(() => ({
  push: mockPush,
  replace: jest.fn(),
  prefetch: jest.fn(),
  back: jest.fn(),
}));

const mockUsePathname = jest.fn(() => '/dashboard');

// Override the jest.setup.ts mocks for these tests
jest.mock('next/navigation', () => ({
  useRouter: () => mockUseRouter(),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

const mockUseSession = jest.fn();

jest.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
  signIn: jest.fn(),
  signOut: jest.fn(),
}));

// Must import after mocks are set up
import { useAuth } from '@/hooks/useAuth';

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: unauthenticated
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    mockUsePathname.mockReturnValue('/dashboard');
    // Clear localStorage
    localStorage.clear();
  });

  it('returns loading state while session is loading', () => {
    mockUseSession.mockReturnValue({ data: null, status: 'loading' });

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('returns unauthenticated state when no session', async () => {
    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.hasProfile).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.session).toBeNull();
  });

  it('returns authenticated state with profile from session', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: {
          userId: 'u1',
          username: 'testuser',
          name: 'Test User',
          image: 'https://example.com/avatar.png',
          hasProfile: true,
          email: 'test@example.com',
        },
      },
      status: 'authenticated',
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.hasProfile).toBe(true);
    expect(result.current.user).toEqual({
      id: 'u1',
      username: 'testuser',
      display_name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
      level: 1,
    });
  });

  it('fetches profile from API when not in session or cache', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { email: 'test@example.com' },
      },
      status: 'authenticated',
    });

    const profileData = {
      exists: true,
      user: {
        id: 'u1',
        username: 'apiuser',
        display_name: 'API User',
        avatar_url: 'https://example.com/av.png',
        level: 5,
      },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(profileData),
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasProfile).toBe(true);
    expect(result.current.user?.username).toBe('apiuser');
    expect(mockFetch).toHaveBeenCalledWith('/api/user/profile', {
      signal: expect.any(AbortSignal),
    });
  });

  it('uses cached profile from localStorage', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { email: 'test@example.com' },
      },
      status: 'authenticated',
    });

    const cachedProfile = {
      id: 'u1',
      username: 'cached_user',
      display_name: 'Cached User',
      avatar_url: 'https://example.com/cached.png',
      level: 3,
    };
    localStorage.setItem('user_profile', JSON.stringify(cachedProfile));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasProfile).toBe(true);
    expect(result.current.user?.username).toBe('cached_user');
    // Should NOT have made a fetch call since cache was used
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles API returning no profile (needs onboarding)', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { email: 'new@example.com' },
      },
      status: 'authenticated',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ exists: false }),
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.hasProfile).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('cleans up abort controller on unmount', async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { email: 'test@example.com' },
      },
      status: 'authenticated',
    });

    // Never-resolving fetch to simulate in-flight request
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { unmount } = renderHook(() => useAuth());

    // Should not throw on unmount while fetch is pending
    unmount();

    // Verify the abort signal was used
    expect(mockFetch).toHaveBeenCalledWith('/api/user/profile', {
      signal: expect.any(AbortSignal),
    });
  });
});
