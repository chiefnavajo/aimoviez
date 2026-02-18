/**
 * @jest-environment node
 */

// Mock Redis before imports
const mockPipelineExec = jest.fn().mockResolvedValue([]);
const mockPipelineGet = jest.fn();
const mockPipelineSet = jest.fn();
const mockPipeline = jest.fn().mockReturnValue({
  get: mockPipelineGet,
  set: mockPipelineSet,
  exec: mockPipelineExec,
});

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
  pipeline: mockPipeline,
};

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn(() => mockRedis),
}));

// Set env vars before import so getRedis() can initialize
process.env.UPSTASH_REDIS_REST_URL = 'https://test-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-redis-token';

import {
  getCachedVoteCounts,
  setCachedVoteCounts,
  updateCachedVoteCount,
  invalidateVoteCount,
} from '@/lib/vote-count-cache';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  // Reset the default pipeline mock chain
  mockPipeline.mockReturnValue({
    get: mockPipelineGet,
    set: mockPipelineSet,
    exec: mockPipelineExec,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getCachedVoteCounts
// ---------------------------------------------------------------------------

describe('getCachedVoteCounts', () => {
  it('returns null for empty clipIds array', async () => {
    const result = await getCachedVoteCounts([]);
    expect(result).toBeNull();
    expect(mockPipeline).not.toHaveBeenCalled();
  });

  it('returns a Map with cached data for found clips', async () => {
    // For 2 clips, pipeline does: get vc:clip1, get vc:clip2, get ws:clip1, get ws:clip2
    // exec returns all results in order
    mockPipelineExec.mockResolvedValueOnce([
      10,   // vc:clip-a
      25,   // vc:clip-b
      7.5,  // ws:clip-a
      12.3, // ws:clip-b
    ]);

    const result = await getCachedVoteCounts(['clip-a', 'clip-b']);

    expect(result).not.toBeNull();
    expect(result!.size).toBe(2);
    expect(result!.get('clip-a')).toEqual({ voteCount: 10, weightedScore: 7.5 });
    expect(result!.get('clip-b')).toEqual({ voteCount: 25, weightedScore: 12.3 });
  });

  it('excludes clips with null vote count from the map', async () => {
    // clip-a has data, clip-b has null voteCount
    mockPipelineExec.mockResolvedValueOnce([
      5,    // vc:clip-a
      null, // vc:clip-b (not cached)
      3.2,  // ws:clip-a
      null, // ws:clip-b
    ]);

    const result = await getCachedVoteCounts(['clip-a', 'clip-b']);

    expect(result).not.toBeNull();
    expect(result!.size).toBe(1);
    expect(result!.has('clip-a')).toBe(true);
    expect(result!.has('clip-b')).toBe(false);
  });

  it('returns null on Redis error', async () => {
    mockPipelineExec.mockRejectedValueOnce(new Error('Redis timeout'));

    const result = await getCachedVoteCounts(['clip-a']);

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[VoteCountCache]'),
      expect.any(Error)
    );
  });

  it('defaults weightedScore to 0 when ws is null but vc exists', async () => {
    mockPipelineExec.mockResolvedValueOnce([
      15,   // vc:clip-a
      null, // ws:clip-a (null)
    ]);

    const result = await getCachedVoteCounts(['clip-a']);

    expect(result).not.toBeNull();
    expect(result!.get('clip-a')).toEqual({ voteCount: 15, weightedScore: 0 });
  });
});

// ---------------------------------------------------------------------------
// setCachedVoteCounts
// ---------------------------------------------------------------------------

describe('setCachedVoteCounts', () => {
  it('does nothing for empty clips array', async () => {
    await setCachedVoteCounts([]);

    expect(mockPipeline).not.toHaveBeenCalled();
  });

  it('sets both voteCount and weightedScore keys with TTL for each clip', async () => {
    await setCachedVoteCounts([
      { id: 'clip-a', voteCount: 10, weightedScore: 7.5 },
      { id: 'clip-b', voteCount: 25, weightedScore: 12.3 },
    ]);

    expect(mockPipeline).toHaveBeenCalledTimes(1);
    expect(mockPipelineSet).toHaveBeenCalledTimes(4);

    // Verify keys and TTL (15 seconds)
    expect(mockPipelineSet).toHaveBeenCalledWith('vc:clip-a', 10, { ex: 15 });
    expect(mockPipelineSet).toHaveBeenCalledWith('ws:clip-a', 7.5, { ex: 15 });
    expect(mockPipelineSet).toHaveBeenCalledWith('vc:clip-b', 25, { ex: 15 });
    expect(mockPipelineSet).toHaveBeenCalledWith('ws:clip-b', 12.3, { ex: 15 });

    expect(mockPipelineExec).toHaveBeenCalledTimes(1);
  });

  it('handles Redis errors gracefully', async () => {
    mockPipelineExec.mockRejectedValueOnce(new Error('Redis write error'));

    await setCachedVoteCounts([{ id: 'clip-a', voteCount: 5, weightedScore: 2.0 }]);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[VoteCountCache]'),
      expect.any(Error)
    );
  });
});

// ---------------------------------------------------------------------------
// updateCachedVoteCount
// ---------------------------------------------------------------------------

describe('updateCachedVoteCount', () => {
  it('updates voteCount and weightedScore for a single clip', async () => {
    await updateCachedVoteCount('clip-x', 42, 33.7);

    expect(mockPipeline).toHaveBeenCalledTimes(1);
    expect(mockPipelineSet).toHaveBeenCalledWith('vc:clip-x', 42, { ex: 15 });
    expect(mockPipelineSet).toHaveBeenCalledWith('ws:clip-x', 33.7, { ex: 15 });
    expect(mockPipelineExec).toHaveBeenCalledTimes(1);
  });

  it('handles Redis errors gracefully', async () => {
    mockPipelineExec.mockRejectedValueOnce(new Error('write fail'));

    await updateCachedVoteCount('clip-x', 1, 1);

    expect(console.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// invalidateVoteCount
// ---------------------------------------------------------------------------

describe('invalidateVoteCount', () => {
  it('deletes both voteCount and weightedScore keys', async () => {
    await invalidateVoteCount('clip-y');

    expect(mockRedis.del).toHaveBeenCalledWith('vc:clip-y', 'ws:clip-y');
  });

  it('handles Redis errors gracefully', async () => {
    mockRedis.del.mockRejectedValueOnce(new Error('del fail'));

    await invalidateVoteCount('clip-y');

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[VoteCountCache]'),
      expect.any(Error)
    );
  });
});
