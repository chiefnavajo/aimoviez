/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Mocks - must be declared before imports
// ---------------------------------------------------------------------------

const mockPipelineExec = jest.fn();
const mockPipeline = {
  lpop: jest.fn().mockReturnThis(),
  lpush: jest.fn().mockReturnThis(),
  ltrim: jest.fn().mockReturnThis(),
  rpush: jest.fn().mockReturnThis(),
  llen: jest.fn().mockReturnThis(),
  get: jest.fn().mockReturnThis(),
  del: jest.fn().mockReturnThis(),
  exec: mockPipelineExec,
};

const mockRedis = {
  lpush: jest.fn(),
  lrem: jest.fn(),
  llen: jest.fn(),
  lrange: jest.fn(),
  del: jest.fn(),
  set: jest.fn(),
  eval: jest.fn(),
  pipeline: jest.fn(() => mockPipeline),
};

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn(() => mockRedis),
}));

// Provide env vars so getRedis() can construct the client
process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  pushEvent,
  popEvents,
  acknowledgeEvents,
  acknowledgeEvent,
  moveToDeadLetter,
  getQueueHealth,
  recoverOrphans,
  setLastProcessedAt,
} from '@/lib/vote-event-queue';

import type { VoteQueueEvent } from '@/types/vote-queue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<VoteQueueEvent> = {}): VoteQueueEvent {
  return {
    voteId: 'vote-1',
    clipId: 'clip-1',
    voterKey: 'voter-1',
    direction: 'up',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('vote-event-queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // pushEvent
  // =========================================================================
  describe('pushEvent', () => {
    it('pushes a JSON-serialized event to the main queue via LPUSH', async () => {
      const event = makeEvent();
      await pushEvent(event);

      expect(mockRedis.lpush).toHaveBeenCalledTimes(1);
      expect(mockRedis.lpush).toHaveBeenCalledWith('vote_queue', JSON.stringify(event));
    });

    it('serializes all event fields including optional metadata', async () => {
      const event = makeEvent({ metadata: { source: 'test' }, sessionId: 'sess-1' });
      await pushEvent(event);

      const pushed = mockRedis.lpush.mock.calls[0][1];
      const parsed = JSON.parse(pushed);
      expect(parsed.metadata).toEqual({ source: 'test' });
      expect(parsed.sessionId).toBe('sess-1');
    });
  });

  // =========================================================================
  // popEvents
  // =========================================================================
  describe('popEvents', () => {
    it('returns parsed events from the Lua eval', async () => {
      const event = makeEvent();
      mockRedis.eval.mockResolvedValueOnce([JSON.stringify(event)]);

      const result = await popEvents(10);

      expect(result).toHaveLength(1);
      expect(result[0].voteId).toBe('vote-1');
    });

    it('passes correct keys and count to eval', async () => {
      mockRedis.eval.mockResolvedValueOnce([]);
      await popEvents(50);

      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      const [, keys, args] = mockRedis.eval.mock.calls[0];
      expect(keys).toEqual(['vote_queue', 'vote_queue:processing']);
      expect(args).toEqual([50]);
    });

    it('returns empty array when eval returns null', async () => {
      mockRedis.eval.mockResolvedValueOnce(null);
      const result = await popEvents(10);
      expect(result).toEqual([]);
    });

    it('returns empty array when eval returns empty list', async () => {
      mockRedis.eval.mockResolvedValueOnce([]);
      const result = await popEvents(10);
      expect(result).toEqual([]);
    });

    it('skips items that fail to parse and logs error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const event = makeEvent();
      mockRedis.eval.mockResolvedValueOnce(['not-valid-json', JSON.stringify(event)]);

      const result = await popEvents(10);

      expect(result).toHaveLength(1);
      expect(result[0].voteId).toBe('vote-1');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VoteQueue] Failed to parse event:'),
        expect.anything()
      );
      consoleSpy.mockRestore();
    });

    it('handles already-parsed objects from eval', async () => {
      const event = makeEvent();
      // Upstash may return already-parsed objects
      mockRedis.eval.mockResolvedValueOnce([event]);

      const result = await popEvents(10);
      expect(result).toHaveLength(1);
      expect(result[0].voteId).toBe('vote-1');
    });
  });

  // =========================================================================
  // acknowledgeEvents (batch)
  // =========================================================================
  describe('acknowledgeEvents', () => {
    it('deletes the processing queue when events are non-empty', async () => {
      await acknowledgeEvents([makeEvent()]);

      expect(mockRedis.del).toHaveBeenCalledWith('vote_queue:processing');
    });

    it('does nothing when events array is empty', async () => {
      await acknowledgeEvents([]);

      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // acknowledgeEvent (single)
  // =========================================================================
  describe('acknowledgeEvent', () => {
    it('removes a single serialized event from the processing queue via LREM', async () => {
      const json = JSON.stringify(makeEvent());
      await acknowledgeEvent(json);

      expect(mockRedis.lrem).toHaveBeenCalledWith('vote_queue:processing', 1, json);
    });
  });

  // =========================================================================
  // moveToDeadLetter
  // =========================================================================
  describe('moveToDeadLetter', () => {
    it('uses a pipeline to move event from processing to dead letter queue', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);
      const event = makeEvent();
      await moveToDeadLetter(event, 'some error', 3);

      expect(mockPipeline.lpop).toHaveBeenCalledWith('vote_queue:processing');
      expect(mockPipeline.lpush).toHaveBeenCalledWith(
        'vote_queue:dead_letter',
        expect.any(String)
      );
      // Verify the dead letter entry structure
      const serialized = mockPipeline.lpush.mock.calls[0][1];
      const entry = JSON.parse(serialized);
      expect(entry.event.voteId).toBe('vote-1');
      expect(entry.error).toBe('some error');
      expect(entry.attempts).toBe(3);
      expect(entry.firstFailedAt).toBeDefined();
      expect(entry.lastFailedAt).toBeDefined();
    });

    it('caps the dead letter queue at 1000 entries', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);
      await moveToDeadLetter(makeEvent(), 'err', 1);

      expect(mockPipeline.ltrim).toHaveBeenCalledWith('vote_queue:dead_letter', 0, 999);
    });
  });

  // =========================================================================
  // getQueueHealth
  // =========================================================================
  describe('getQueueHealth', () => {
    it('returns correct health stats from pipeline results', async () => {
      mockPipelineExec.mockResolvedValueOnce([5, 2, 1, '1700000000000']);

      const health = await getQueueHealth();

      expect(health).toEqual({
        pendingCount: 5,
        processingCount: 2,
        deadLetterCount: 1,
        lastProcessedAt: 1700000000000,
        avgProcessingTimeMs: 0,
      });
    });

    it('defaults to 0/null when pipeline returns nullish values', async () => {
      mockPipelineExec.mockResolvedValueOnce([0, null, undefined, null]);

      const health = await getQueueHealth();

      expect(health.pendingCount).toBe(0);
      expect(health.processingCount).toBe(0);
      expect(health.deadLetterCount).toBe(0);
      expect(health.lastProcessedAt).toBeNull();
    });
  });

  // =========================================================================
  // recoverOrphans
  // =========================================================================
  describe('recoverOrphans', () => {
    it('returns 0 when processing queue is empty', async () => {
      mockRedis.llen.mockResolvedValueOnce(0);

      const count = await recoverOrphans();
      expect(count).toBe(0);
    });

    it('moves orphaned events (old timestamp) back to main queue', async () => {
      const oldEvent = makeEvent({ timestamp: Date.now() - 10 * 60 * 1000 }); // 10 min ago
      mockRedis.llen.mockResolvedValueOnce(1);
      mockRedis.lrange.mockResolvedValueOnce([JSON.stringify(oldEvent)]);
      mockPipelineExec.mockResolvedValueOnce([]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const count = await recoverOrphans();

      expect(count).toBe(1);
      expect(mockPipeline.rpush).toHaveBeenCalledWith('vote_queue', expect.any(String));
      expect(mockPipeline.del).toHaveBeenCalledWith('vote_queue:processing');
      consoleSpy.mockRestore();
    });

    it('keeps recent events in processing and only moves orphans', async () => {
      const recentEvent = makeEvent({ timestamp: Date.now() - 1000 }); // 1 sec ago
      const oldEvent = makeEvent({ voteId: 'old-vote', timestamp: Date.now() - 10 * 60 * 1000 });

      mockRedis.llen.mockResolvedValueOnce(2);
      mockRedis.lrange.mockResolvedValueOnce([
        JSON.stringify(recentEvent),
        JSON.stringify(oldEvent),
      ]);
      mockPipelineExec.mockResolvedValueOnce([]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const count = await recoverOrphans();

      expect(count).toBe(1);
      // Old event goes to main queue
      const rpushCalls = mockPipeline.rpush.mock.calls;
      const mainQueuePushes = rpushCalls.filter((c: any[]) => c[0] === 'vote_queue');
      expect(mainQueuePushes).toHaveLength(1);
      // Recent event stays in processing
      const processingPushes = rpushCalls.filter((c: any[]) => c[0] === 'vote_queue:processing');
      expect(processingPushes).toHaveLength(1);
      consoleSpy.mockRestore();
    });

    it('treats unparseable items as orphans', async () => {
      mockRedis.llen.mockResolvedValueOnce(1);
      mockRedis.lrange.mockResolvedValueOnce(['not-valid-json']);
      mockPipelineExec.mockResolvedValueOnce([]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const count = await recoverOrphans();

      expect(count).toBe(1);
      consoleSpy.mockRestore();
    });

    it('returns 0 when lrange returns null/empty', async () => {
      mockRedis.llen.mockResolvedValueOnce(1);
      mockRedis.lrange.mockResolvedValueOnce([]);

      const count = await recoverOrphans();
      expect(count).toBe(0);
    });
  });

  // =========================================================================
  // setLastProcessedAt
  // =========================================================================
  describe('setLastProcessedAt', () => {
    it('sets the last processed timestamp in Redis', async () => {
      const before = Date.now();
      await setLastProcessedAt();
      const after = Date.now();

      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      const [key, value] = mockRedis.set.mock.calls[0];
      expect(key).toBe('vote_queue:last_processed_at');
      const ts = parseInt(value, 10);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});
