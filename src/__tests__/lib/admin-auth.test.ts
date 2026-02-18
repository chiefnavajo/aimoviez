/**
 * @jest-environment node
 */

// Mock dependencies before imports
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

const mockSupabaseFrom = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockSupabaseFrom,
  })),
}));

jest.mock('@/lib/auth-options', () => ({
  authOptions: { providers: [] },
}));

import { getServerSession } from 'next-auth';
import { checkAdminAuth, requireAdmin, requireAdminWithAuth } from '@/lib/admin-auth';

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

// ---------------------------------------------------------------------------
// checkAdminAuth
// ---------------------------------------------------------------------------

describe('checkAdminAuth', () => {
  it('returns not authenticated when session is null', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const result = await checkAdminAuth();

    expect(result.isAdmin).toBe(false);
    expect(result.userId).toBeNull();
    expect(result.email).toBeNull();
    expect(result.error).toBe('Not authenticated');
  });

  it('returns not authenticated when session has no email', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { name: 'Test' },
      expires: '2099-01-01',
    });

    const result = await checkAdminAuth();

    expect(result.isAdmin).toBe(false);
    expect(result.email).toBeNull();
    expect(result.error).toBe('Not authenticated');
  });

  it('returns user not found when DB lookup fails', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'user@example.com' },
      expires: '2099-01-01',
    });

    mockSupabaseFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'not found' },
          }),
        }),
      }),
    });

    const result = await checkAdminAuth();

    expect(result.isAdmin).toBe(false);
    expect(result.email).toBe('user@example.com');
    expect(result.error).toBe('User not found in database');
  });

  it('returns isAdmin false for a non-admin user', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'regular@example.com' },
      expires: '2099-01-01',
    });

    mockSupabaseFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'user-123', email: 'regular@example.com', is_admin: false },
            error: null,
          }),
        }),
      }),
    });

    const result = await checkAdminAuth();

    expect(result.isAdmin).toBe(false);
    expect(result.userId).toBe('user-123');
    expect(result.email).toBe('regular@example.com');
    expect(result.error).toBeUndefined();
  });

  it('returns isAdmin true for an admin user', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'admin@example.com' },
      expires: '2099-01-01',
    });

    mockSupabaseFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'admin-456', email: 'admin@example.com', is_admin: true },
            error: null,
          }),
        }),
      }),
    });

    const result = await checkAdminAuth();

    expect(result.isAdmin).toBe(true);
    expect(result.userId).toBe('admin-456');
    expect(result.email).toBe('admin@example.com');
    expect(result.error).toBeUndefined();
  });

  it('handles exceptions gracefully', async () => {
    mockGetServerSession.mockRejectedValueOnce(new Error('Session DB down'));

    const result = await checkAdminAuth();

    expect(result.isAdmin).toBe(false);
    expect(result.userId).toBeNull();
    expect(result.email).toBeNull();
    expect(result.error).toBe('Failed to verify admin status');
  });
});

// ---------------------------------------------------------------------------
// requireAdmin
// ---------------------------------------------------------------------------

describe('requireAdmin', () => {
  it('returns null when user is admin', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'admin@example.com' },
      expires: '2099-01-01',
    });

    mockSupabaseFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'admin-1', email: 'admin@example.com', is_admin: true },
            error: null,
          }),
        }),
      }),
    });

    const result = await requireAdmin();
    expect(result).toBeNull();
  });

  it('returns 401 when user is not logged in', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const result = await requireAdmin();
    expect(result).not.toBeNull();

    const body = await result!.json();
    expect(result!.status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 403 when user is logged in but not admin', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'regular@example.com' },
      expires: '2099-01-01',
    });

    mockSupabaseFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'user-1', email: 'regular@example.com', is_admin: false },
            error: null,
          }),
        }),
      }),
    });

    const result = await requireAdmin();
    expect(result).not.toBeNull();

    const body = await result!.json();
    expect(result!.status).toBe(403);
    expect(body.error).toBe('Admin access required');
  });
});

// ---------------------------------------------------------------------------
// requireAdminWithAuth
// ---------------------------------------------------------------------------

describe('requireAdminWithAuth', () => {
  it('returns AdminAuthResult when user is admin', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'admin@example.com' },
      expires: '2099-01-01',
    });

    mockSupabaseFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'admin-1', email: 'admin@example.com', is_admin: true },
            error: null,
          }),
        }),
      }),
    });

    const result = await requireAdminWithAuth();

    // Should not be a NextResponse, but AdminAuthResult
    expect(result).toHaveProperty('isAdmin', true);
    expect(result).toHaveProperty('userId', 'admin-1');
    expect(result).toHaveProperty('email', 'admin@example.com');
  });

  it('returns 401 NextResponse when not authenticated', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const result = await requireAdminWithAuth();

    // Should be a NextResponse
    expect(result).toHaveProperty('status', 401);
    const body = await (result as Response).json();
    expect(body.error).toBe('Authentication required');
  });

  it('returns 403 NextResponse when user is not admin', async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { email: 'user@example.com' },
      expires: '2099-01-01',
    });

    mockSupabaseFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { id: 'user-1', email: 'user@example.com', is_admin: false },
            error: null,
          }),
        }),
      }),
    });

    const result = await requireAdminWithAuth();

    expect(result).toHaveProperty('status', 403);
    const body = await (result as Response).json();
    expect(body.error).toBe('Admin access required');
  });
});
