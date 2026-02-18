/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPipelineExec = jest.fn();
const mockPipeline = {
  zincrby: jest.fn().mockReturnThis(),
  zadd: jest.fn().mockReturnThis(),
  zrange: jest.fn().mockReturnThis(),
  zcard: jest.fn().mockReturnThis(),
  exec: mockPipelineExec,
};

const mockRedis = {
  zadd: jest.fn(),
  zincrby: jest.fn(),
  zrevrank: jest.fn(),
  zrange: jest.fn(),
  zcard: jest.fn(),
  del: jest.fn(),
  expire: jest.fn(),
  pipeline: jest.fn(() => mockPipeline),
};

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn(() => mockRedis),
}));

process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  updateClipScore,
  updateVoterScore,
  updateCreatorScore,
  getTopClips,
  getTopVoters,
  getTopCreators,
  getVoterRank,
  getCreatorRank,
  clearSlotLeaderboard,
  batchUpdateClipScores,
  batchUpdateVoterScores,
  batchUpdateCreatorScores,
} from '@/lib/leaderboard-redis';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('leaderboard-redis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // updateClipScore
  // =========================================================================
  describe('updateClipScore', () => {
    it('calls ZADD with the correct namespaced key', async () => {
      await updateClipScore('season-1', 'clip-1', 3, 42.5);

      expect(mockRedis.zadd).toHaveBeenCalledWith(
        'leaderboard:clips:season-1:3',
        { score: 42.5, member: 'clip-1' }
      );
    });

    it('logs warning and does not throw on Redis error', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockRedis.zadd.mockRejectedValueOnce(new Error('connection failed'));

      await expect(updateClipScore('s1', 'c1', 1, 10)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // =========================================================================
  // updateVoterScore
  // =========================================================================
  describe('updateVoterScore', () => {
    it('increments both all-time and daily voter scores in a pipeline', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await updateVoterScore('voter-key-1', 5);

      expect(mockPipeline.zincrby).toHaveBeenCalledWith(
        'leaderboard:voters:all',
        5,
        'voter-key-1'
      );
      // Daily key uses today's date
      const todayDate = new Date().toISOString().split('T')[0];
      expect(mockPipeline.zincrby).toHaveBeenCalledWith(
        `leaderboard:voters:daily:${todayDate}`,
        5,
        'voter-key-1'
      );
    });

    it('sets TTL on the daily key', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await updateVoterScore('voter-1', 1);

      const todayDate = new Date().toISOString().split('T')[0];
      expect(mockRedis.expire).toHaveBeenCalledWith(
        `leaderboard:voters:daily:${todayDate}`,
        48 * 60 * 60 // 48 hours
      );
    });
  });

  // =========================================================================
  // updateCreatorScore
  // =========================================================================
  describe('updateCreatorScore', () => {
    it('updates both season-specific and global leaderboard when seasonId provided', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await updateCreatorScore('alice', 10, 'season-1');

      expect(mockPipeline.zincrby).toHaveBeenCalledWith(
        'leaderboard:creators:season-1',
        10,
        'alice'
      );
      expect(mockPipeline.zincrby).toHaveBeenCalledWith(
        'leaderboard:creators:all',
        10,
        'alice'
      );
    });

    it('only updates global leaderboard when seasonId is omitted', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await updateCreatorScore('bob', 5);

      // Only global key
      const calls = mockPipeline.zincrby.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('leaderboard:creators:all');
    });
  });

  // =========================================================================
  // getTopClips
  // =========================================================================
  describe('getTopClips', () => {
    it('returns entries and total from pipeline', async () => {
      // Newer Upstash SDK object format
      mockPipelineExec.mockResolvedValueOnce([
        [{ value: 'clip-1', score: 100 }, { value: 'clip-2', score: 50 }],
        5,
      ]);

      const result = await getTopClips('season-1', 3, 10, 0);

      expect(result).not.toBeNull();
      expect(result!.entries).toHaveLength(2);
      expect(result!.entries[0]).toEqual({ member: 'clip-1', score: 100 });
      expect(result!.entries[1]).toEqual({ member: 'clip-2', score: 50 });
      expect(result!.total).toBe(5);
    });

    it('handles alternating [member, score, ...] legacy format', async () => {
      mockPipelineExec.mockResolvedValueOnce([
        ['clip-a', '75', 'clip-b', '30'],
        2,
      ]);

      const result = await getTopClips('season-1', 1, 10, 0);

      expect(result!.entries).toHaveLength(2);
      expect(result!.entries[0]).toEqual({ member: 'clip-a', score: 75 });
      expect(result!.entries[1]).toEqual({ member: 'clip-b', score: 30 });
    });

    it('returns null on Redis error', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockPipelineExec.mockRejectedValueOnce(new Error('timeout'));

      const result = await getTopClips('s1', 1, 10, 0);
      expect(result).toBeNull();
      warnSpy.mockRestore();
    });

    it('handles empty raw entries', async () => {
      mockPipelineExec.mockResolvedValueOnce([[], 0]);

      const result = await getTopClips('s1', 1, 10, 0);
      expect(result!.entries).toEqual([]);
      expect(result!.total).toBe(0);
    });
  });

  // =========================================================================
  // getTopVoters
  // =========================================================================
  describe('getTopVoters', () => {
    it('returns null for week timeframe (no weekly set)', async () => {
      const result = await getTopVoters('week', 10, 0);
      expect(result).toBeNull();
    });

    it('queries all-time key for "all" timeframe', async () => {
      mockPipelineExec.mockResolvedValueOnce([
        [{ value: 'voter-1', score: 200 }],
        1,
      ]);

      const result = await getTopVoters('all', 10, 0);

      expect(result!.entries).toHaveLength(1);
      expect(mockPipeline.zrange).toHaveBeenCalledWith(
        'leaderboard:voters:all',
        0,
        9,
        { rev: true, withScores: true }
      );
    });

    it('queries daily key for "today" timeframe', async () => {
      mockPipelineExec.mockResolvedValueOnce([[], 0]);

      await getTopVoters('today', 5, 0);

      const todayDate = new Date().toISOString().split('T')[0];
      expect(mockPipeline.zrange).toHaveBeenCalledWith(
        `leaderboard:voters:daily:${todayDate}`,
        0,
        4,
        { rev: true, withScores: true }
      );
    });
  });

  // =========================================================================
  // getTopCreators
  // =========================================================================
  describe('getTopCreators', () => {
    it('uses season-specific key when seasonId is provided', async () => {
      mockPipelineExec.mockResolvedValueOnce([[], 0]);

      await getTopCreators(10, 0, 'season-1');

      expect(mockPipeline.zrange).toHaveBeenCalledWith(
        'leaderboard:creators:season-1',
        0,
        9,
        { rev: true, withScores: true }
      );
    });

    it('uses global key when seasonId is omitted', async () => {
      mockPipelineExec.mockResolvedValueOnce([[], 0]);

      await getTopCreators(10, 0);

      expect(mockPipeline.zrange).toHaveBeenCalledWith(
        'leaderboard:creators:all',
        0,
        9,
        { rev: true, withScores: true }
      );
    });
  });

  // =========================================================================
  // getVoterRank
  // =========================================================================
  describe('getVoterRank', () => {
    it('returns 1-indexed rank when voter exists', async () => {
      mockRedis.zrevrank.mockResolvedValueOnce(0); // 0-indexed rank

      const rank = await getVoterRank('voter-1', 'all');
      expect(rank).toBe(1);
    });

    it('returns null when voter does not exist', async () => {
      mockRedis.zrevrank.mockResolvedValueOnce(null);

      const rank = await getVoterRank('unknown', 'all');
      expect(rank).toBeNull();
    });

    it('queries daily key for "today" timeframe', async () => {
      mockRedis.zrevrank.mockResolvedValueOnce(4);

      const rank = await getVoterRank('voter-1', 'today');

      const todayDate = new Date().toISOString().split('T')[0];
      expect(mockRedis.zrevrank).toHaveBeenCalledWith(
        `leaderboard:voters:daily:${todayDate}`,
        'voter-1'
      );
      expect(rank).toBe(5);
    });

    it('returns null on Redis error', async () => {
      mockRedis.zrevrank.mockRejectedValueOnce(new Error('fail'));
      const rank = await getVoterRank('voter-1', 'all');
      expect(rank).toBeNull();
    });
  });

  // =========================================================================
  // getCreatorRank
  // =========================================================================
  describe('getCreatorRank', () => {
    it('returns 1-indexed rank for existing creator', async () => {
      mockRedis.zrevrank.mockResolvedValueOnce(2);

      const rank = await getCreatorRank('alice', 'season-1');
      expect(rank).toBe(3);
    });

    it('uses global key when seasonId is omitted', async () => {
      mockRedis.zrevrank.mockResolvedValueOnce(0);

      await getCreatorRank('bob');

      expect(mockRedis.zrevrank).toHaveBeenCalledWith('leaderboard:creators:all', 'bob');
    });

    it('returns null when creator not found', async () => {
      mockRedis.zrevrank.mockResolvedValueOnce(null);
      expect(await getCreatorRank('nobody')).toBeNull();
    });
  });

  // =========================================================================
  // clearSlotLeaderboard
  // =========================================================================
  describe('clearSlotLeaderboard', () => {
    it('deletes the namespaced slot key', async () => {
      await clearSlotLeaderboard('season-1', 5);

      expect(mockRedis.del).toHaveBeenCalledWith('leaderboard:clips:season-1:5');
    });

    it('does not throw on Redis error', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockRedis.del.mockRejectedValueOnce(new Error('fail'));

      await expect(clearSlotLeaderboard('s1', 1)).resolves.toBeUndefined();
      warnSpy.mockRestore();
    });
  });

  // =========================================================================
  // batchUpdateClipScores
  // =========================================================================
  describe('batchUpdateClipScores', () => {
    it('adds multiple clips via pipeline ZADD', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await batchUpdateClipScores('season-1', 2, [
        { clipId: 'c1', weightedScore: 100 },
        { clipId: 'c2', weightedScore: 50 },
      ]);

      expect(mockPipeline.zadd).toHaveBeenCalledTimes(2);
      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        'leaderboard:clips:season-1:2',
        { score: 100, member: 'c1' }
      );
    });

    it('is a no-op for empty clips array', async () => {
      await batchUpdateClipScores('s1', 1, []);
      expect(mockPipelineExec).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // batchUpdateVoterScores
  // =========================================================================
  describe('batchUpdateVoterScores', () => {
    it('uses all-time key for "all" timeframe', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await batchUpdateVoterScores(
        [{ voterKey: 'v1', totalVotes: 100 }],
        'all'
      );

      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        'leaderboard:voters:all',
        { score: 100, member: 'v1' }
      );
    });

    it('uses daily key and sets TTL for "daily" timeframe', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await batchUpdateVoterScores(
        [{ voterKey: 'v1', totalVotes: 50 }],
        'daily',
        '2026-02-18'
      );

      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        'leaderboard:voters:daily:2026-02-18',
        { score: 50, member: 'v1' }
      );
      expect(mockRedis.expire).toHaveBeenCalledWith(
        'leaderboard:voters:daily:2026-02-18',
        48 * 60 * 60
      );
    });

    it('is a no-op for empty voters', async () => {
      await batchUpdateVoterScores([], 'all');
      expect(mockPipelineExec).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // batchUpdateCreatorScores
  // =========================================================================
  describe('batchUpdateCreatorScores', () => {
    it('updates season-specific key when seasonId provided', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await batchUpdateCreatorScores(
        [{ username: 'alice', totalVotes: 200 }],
        'season-1'
      );

      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        'leaderboard:creators:season-1',
        { score: 200, member: 'alice' }
      );
    });

    it('updates global key when seasonId omitted', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);

      await batchUpdateCreatorScores([{ username: 'bob', totalVotes: 100 }]);

      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        'leaderboard:creators:all',
        { score: 100, member: 'bob' }
      );
    });

    it('is a no-op for empty creators', async () => {
      await batchUpdateCreatorScores([]);
      expect(mockPipelineExec).not.toHaveBeenCalled();
    });
  });
});
