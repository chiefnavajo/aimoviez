/**
 * @jest-environment node
 */

// Mock Redis before imports
const mockRedis = {
  sadd: jest.fn().mockResolvedValue(1),
  sismember: jest.fn().mockResolvedValue(0),
  smembers: jest.fn().mockResolvedValue([]),
  scard: jest.fn().mockResolvedValue(0),
  expire: jest.fn().mockResolvedValue(1),
  del: jest.fn().mockResolvedValue(1),
};

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn(() => mockRedis),
}));

// Set env vars before import so getRedis() can initialize
process.env.UPSTASH_REDIS_REST_URL = 'https://test-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';

import {
  markClipAsSeen,
  markClipsAsSeen,
  hasSeenClip,
  filterUnseenClipIds,
  resetSeenClips,
  getSeenClipCount,
  getSeenClipIds,
} from '@/lib/seen-tracking';

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// markClipAsSeen
// ---------------------------------------------------------------------------

describe('markClipAsSeen', () => {
  it('adds a clip to the seen set with SADD and sets TTL', async () => {
    await markClipAsSeen('user_abc', 3, 'clip-uuid-1');

    expect(mockRedis.sadd).toHaveBeenCalledWith('seen:user_abc:slot:3', 'clip-uuid-1');
    expect(mockRedis.expire).toHaveBeenCalledWith('seen:user_abc:slot:3', 30 * 24 * 60 * 60);
  });

  it('silently handles Redis errors without throwing', async () => {
    mockRedis.sadd.mockRejectedValueOnce(new Error('Redis down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(markClipAsSeen('user_abc', 1, 'clip-1')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    (console.error as jest.Mock).mockRestore();
  });
});

// ---------------------------------------------------------------------------
// markClipsAsSeen (batch)
// ---------------------------------------------------------------------------

describe('markClipsAsSeen', () => {
  it('adds multiple clips in a single SADD call', async () => {
    await markClipsAsSeen('user_abc', 2, ['clip-1', 'clip-2', 'clip-3']);

    expect(mockRedis.sadd).toHaveBeenCalledWith(
      'seen:user_abc:slot:2',
      'clip-1',
      'clip-2',
      'clip-3'
    );
    expect(mockRedis.expire).toHaveBeenCalledWith('seen:user_abc:slot:2', 30 * 24 * 60 * 60);
  });

  it('does nothing when clipIds array is empty', async () => {
    await markClipsAsSeen('user_abc', 1, []);

    expect(mockRedis.sadd).not.toHaveBeenCalled();
    expect(mockRedis.expire).not.toHaveBeenCalled();
  });

  it('silently handles Redis errors', async () => {
    mockRedis.sadd.mockRejectedValueOnce(new Error('Redis error'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(markClipsAsSeen('user_abc', 1, ['c1'])).resolves.toBeUndefined();
    (console.error as jest.Mock).mockRestore();
  });
});

// ---------------------------------------------------------------------------
// hasSeenClip
// ---------------------------------------------------------------------------

describe('hasSeenClip', () => {
  it('returns true when SISMEMBER returns 1', async () => {
    mockRedis.sismember.mockResolvedValueOnce(1);

    const result = await hasSeenClip('user_abc', 5, 'clip-seen');
    expect(result).toBe(true);
    expect(mockRedis.sismember).toHaveBeenCalledWith('seen:user_abc:slot:5', 'clip-seen');
  });

  it('returns false when SISMEMBER returns 0', async () => {
    mockRedis.sismember.mockResolvedValueOnce(0);

    const result = await hasSeenClip('user_abc', 5, 'clip-unseen');
    expect(result).toBe(false);
  });

  it('returns false on Redis error (fail open)', async () => {
    mockRedis.sismember.mockRejectedValueOnce(new Error('timeout'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await hasSeenClip('user_abc', 1, 'clip-1');
    expect(result).toBe(false);
    (console.error as jest.Mock).mockRestore();
  });
});

// ---------------------------------------------------------------------------
// filterUnseenClipIds
// ---------------------------------------------------------------------------

describe('filterUnseenClipIds', () => {
  it('returns empty array for empty input', async () => {
    const result = await filterUnseenClipIds('user_abc', 1, []);
    expect(result).toEqual([]);
    expect(mockRedis.sismember).not.toHaveBeenCalled();
  });

  it('filters out seen clips using SISMEMBER for small lists (<= 50)', async () => {
    // clip-1 is seen (1), clip-2 is not (0), clip-3 is seen (1)
    mockRedis.sismember
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    const result = await filterUnseenClipIds('user_abc', 1, ['clip-1', 'clip-2', 'clip-3']);
    expect(result).toEqual(['clip-2']);
  });

  it('uses SMEMBERS for large lists (> 50) and filters in JS', async () => {
    const clipIds = Array.from({ length: 60 }, (_, i) => `clip-${i}`);
    // Simulate that clip-0 and clip-1 were already seen
    mockRedis.smembers.mockResolvedValueOnce(['clip-0', 'clip-1']);

    const result = await filterUnseenClipIds('user_abc', 1, clipIds);

    expect(mockRedis.smembers).toHaveBeenCalledTimes(1);
    expect(result).not.toContain('clip-0');
    expect(result).not.toContain('clip-1');
    expect(result).toContain('clip-2');
    expect(result.length).toBe(58);
  });

  it('returns all clips on Redis error (fail open)', async () => {
    mockRedis.sismember.mockRejectedValue(new Error('Redis down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await filterUnseenClipIds('user_abc', 1, ['c1', 'c2']);
    expect(result).toEqual(['c1', 'c2']);
    (console.error as jest.Mock).mockRestore();
  });
});

// ---------------------------------------------------------------------------
// resetSeenClips
// ---------------------------------------------------------------------------

describe('resetSeenClips', () => {
  it('deletes a specific slot key when slotPosition is provided', async () => {
    await resetSeenClips('user_abc', 3);

    expect(mockRedis.del).toHaveBeenCalledWith('seen:user_abc:slot:3');
  });

  it('deletes all 8 slot keys when slotPosition is not provided', async () => {
    await resetSeenClips('user_abc');

    expect(mockRedis.del).toHaveBeenCalledTimes(1);
    const args = mockRedis.del.mock.calls[0];
    expect(args).toHaveLength(8);
    expect(args[0]).toBe('seen:user_abc:slot:1');
    expect(args[7]).toBe('seen:user_abc:slot:8');
  });

  it('silently handles Redis errors', async () => {
    mockRedis.del.mockRejectedValueOnce(new Error('Redis error'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(resetSeenClips('user_abc')).resolves.toBeUndefined();
    (console.error as jest.Mock).mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getSeenClipCount
// ---------------------------------------------------------------------------

describe('getSeenClipCount', () => {
  it('returns the count from SCARD', async () => {
    mockRedis.scard.mockResolvedValueOnce(42);

    const count = await getSeenClipCount('user_abc', 2);
    expect(count).toBe(42);
    expect(mockRedis.scard).toHaveBeenCalledWith('seen:user_abc:slot:2');
  });

  it('returns 0 on Redis error', async () => {
    mockRedis.scard.mockRejectedValueOnce(new Error('fail'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const count = await getSeenClipCount('user_abc', 1);
    expect(count).toBe(0);
    (console.error as jest.Mock).mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getSeenClipIds
// ---------------------------------------------------------------------------

describe('getSeenClipIds', () => {
  it('returns clip IDs from SMEMBERS', async () => {
    mockRedis.smembers.mockResolvedValueOnce(['clip-a', 'clip-b']);

    const ids = await getSeenClipIds('user_abc', 4);
    expect(ids).toEqual(['clip-a', 'clip-b']);
    expect(mockRedis.smembers).toHaveBeenCalledWith('seen:user_abc:slot:4');
  });

  it('returns empty array on Redis error', async () => {
    mockRedis.smembers.mockRejectedValueOnce(new Error('fail'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const ids = await getSeenClipIds('user_abc', 1);
    expect(ids).toEqual([]);
    (console.error as jest.Mock).mockRestore();
  });
});
