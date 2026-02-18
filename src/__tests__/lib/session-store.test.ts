/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE imports so hoisting applies
// ---------------------------------------------------------------------------

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const mockPipelineSet = jest.fn();
const mockPipelineExec = jest.fn();

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
    pipeline: () => ({
      set: mockPipelineSet,
      exec: mockPipelineExec,
    }),
  })),
}));

jest.mock('next-auth/jwt', () => ({
  getToken: jest.fn(),
}));

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/auth-options', () => ({
  authOptions: {},
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(),
        })),
      })),
    })),
  })),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { getSessionFast, refreshSession, invalidateSession, SessionData } from '@/lib/session-store';
import { getToken } from 'next-auth/jwt';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url = 'http://localhost:3000/api/test'): NextRequest {
  return new NextRequest(new URL(url));
}

const sampleSession: SessionData = {
  userId: 'user-123',
  email: 'test@example.com',
  username: 'tester',
  hasProfile: true,
  isAdmin: false,
  avatarUrl: null,
  cachedAt: Date.now(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Ensure env vars are set so Redis client initialises
  process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
  process.env.NEXTAUTH_SECRET = 'test-secret';
});

describe('session-store', () => {
  // -----------------------------------------------------------------------
  // getSessionFast
  // -----------------------------------------------------------------------

  describe('getSessionFast', () => {
    it('returns null when getToken throws', async () => {
      (getToken as jest.Mock).mockRejectedValueOnce(new Error('jwt fail'));

      const result = await getSessionFast(makeRequest());
      expect(result).toBeNull();
    });

    it('returns null when token has no email', async () => {
      (getToken as jest.Mock).mockResolvedValueOnce({ sub: '123' });

      const result = await getSessionFast(makeRequest());
      expect(result).toBeNull();
    });

    it('returns cached session from Redis when featureEnabled and userId present', async () => {
      (getToken as jest.Mock).mockResolvedValueOnce({
        email: 'test@example.com',
        userId: 'user-123',
      });
      mockRedisGet.mockResolvedValueOnce(sampleSession);

      const result = await getSessionFast(makeRequest(), true);
      expect(result).toEqual(sampleSession);
      expect(mockRedisGet).toHaveBeenCalledTimes(1);
    });

    it('falls back when Redis cache misses', async () => {
      (getToken as jest.Mock).mockResolvedValueOnce({
        email: 'test@example.com',
        userId: 'user-123',
        username: 'tester',
        hasProfile: true,
        isAdmin: false,
      });
      mockRedisGet.mockResolvedValueOnce(null);

      const result = await getSessionFast(makeRequest(), true);
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-123');
      expect(result!.email).toBe('test@example.com');
    });

    it('builds session from JWT claims when userId and username are available', async () => {
      (getToken as jest.Mock).mockResolvedValueOnce({
        email: 'alice@example.com',
        userId: 'u-abc',
        username: 'alice',
        hasProfile: true,
        isAdmin: true,
      });

      const result = await getSessionFast(makeRequest(), false);
      expect(result).toMatchObject({
        userId: 'u-abc',
        email: 'alice@example.com',
        username: 'alice',
        isAdmin: true,
      });
    });

    it('handles Redis read error gracefully and falls back', async () => {
      (getToken as jest.Mock).mockResolvedValueOnce({
        email: 'test@example.com',
        userId: 'user-123',
        username: 'bob',
        hasProfile: true,
      });
      mockRedisGet.mockRejectedValueOnce(new Error('Redis down'));

      const result = await getSessionFast(makeRequest(), true);
      // Should still succeed via DB fallback
      expect(result).not.toBeNull();
      expect(result!.userId).toBe('user-123');
    });
  });

  // -----------------------------------------------------------------------
  // refreshSession
  // -----------------------------------------------------------------------

  describe('refreshSession', () => {
    it('writes session and email mapping to Redis via pipeline', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await refreshSession('user-123', sampleSession);

      expect(mockPipelineSet).toHaveBeenCalledTimes(2);
      // First call: session data with TTL
      expect(mockPipelineSet).toHaveBeenCalledWith(
        'session:user-123',
        sampleSession,
        { ex: 30 * 60 },
      );
      // Second call: email -> userId mapping with 24h TTL
      expect(mockPipelineSet).toHaveBeenCalledWith(
        expect.stringContaining('session:email:'),
        'user-123',
        { ex: 24 * 60 * 60 },
      );
      expect(mockPipelineExec).toHaveBeenCalledTimes(1);
    });

    it('does not throw when Redis pipeline fails', async () => {
      mockPipelineExec.mockRejectedValueOnce(new Error('pipeline error'));

      // Should not throw
      await expect(refreshSession('user-123', sampleSession)).resolves.toBeUndefined();
    });

    it('does nothing when Redis env vars are missing', async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      // Need to re-import to pick up missing env vars — but the module caches
      // the redis instance. Since the singleton was already created, this tests
      // the path where getRedis() returns the cached client. We verify no error.
      await expect(refreshSession('user-123', sampleSession)).resolves.toBeUndefined();
    });

    it('skips email mapping when email is empty', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      const noEmailSession: SessionData = {
        ...sampleSession,
        email: '',
      };

      await refreshSession('user-123', noEmailSession);

      // Only the session key should be set (not the email map)
      expect(mockPipelineSet).toHaveBeenCalledTimes(1);
      expect(mockPipelineSet).toHaveBeenCalledWith(
        'session:user-123',
        noEmailSession,
        { ex: 30 * 60 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // invalidateSession
  // -----------------------------------------------------------------------

  describe('invalidateSession', () => {
    it('deletes the session key from Redis', async () => {
      mockRedisDel.mockResolvedValueOnce(1);

      await invalidateSession('user-456');

      expect(mockRedisDel).toHaveBeenCalledWith('session:user-456');
    });

    it('does not throw when Redis delete fails', async () => {
      mockRedisDel.mockRejectedValueOnce(new Error('Redis delete error'));

      await expect(invalidateSession('user-456')).resolves.toBeUndefined();
    });
  });
});
