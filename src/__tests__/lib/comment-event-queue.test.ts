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

process.env.UPSTASH_REDIS_REST_URL = 'https://fake-redis.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  pushCommentEvent,
  popCommentEvents,
  acknowledgeCommentEvents,
  acknowledgeCommentEvent,
  moveCommentToDeadLetter,
  getCommentQueueHealth,
  recoverCommentOrphans,
  setCommentLastProcessedAt,
} from '@/lib/comment-event-queue';

import type { CommentQueueEvent } from '@/lib/comment-event-queue';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommentEvent(overrides: Partial<CommentQueueEvent> = {}): CommentQueueEvent {
  return {
    eventId: 'evt-1',
    clipId: 'clip-1',
    userKey: 'user-1',
    action: 'create',
    timestamp: Date.now(),
    data: {
      commentText: 'Hello world',
      username: 'testuser',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('comment-event-queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // pushCommentEvent
  // =========================================================================
  describe('pushCommentEvent', () => {
    it('pushes JSON-serialized event to the comment_queue via LPUSH', async () => {
      const event = makeCommentEvent();
      await pushCommentEvent(event);

      expect(mockRedis.lpush).toHaveBeenCalledWith('comment_queue', JSON.stringify(event));
    });

    it('includes all action types in serialized event', async () => {
      for (const action of ['create', 'like', 'unlike', 'delete'] as const) {
        jest.clearAllMocks();
        const event = makeCommentEvent({ action });
        await pushCommentEvent(event);

        const pushed = mockRedis.lpush.mock.calls[0][1];
        expect(JSON.parse(pushed).action).toBe(action);
      }
    });

    it('preserves optional data fields like parentCommentId', async () => {
      const event = makeCommentEvent({
        data: { commentText: 'reply', parentCommentId: 'parent-1' },
      });
      await pushCommentEvent(event);

      const pushed = mockRedis.lpush.mock.calls[0][1];
      expect(JSON.parse(pushed).data.parentCommentId).toBe('parent-1');
    });
  });

  // =========================================================================
  // popCommentEvents
  // =========================================================================
  describe('popCommentEvents', () => {
    it('returns parsed events from Lua eval', async () => {
      const event = makeCommentEvent();
      mockRedis.eval.mockResolvedValueOnce([JSON.stringify(event)]);

      const result = await popCommentEvents(10);

      expect(result).toHaveLength(1);
      expect(result[0].eventId).toBe('evt-1');
    });

    it('passes comment_queue and comment_queue:processing as keys', async () => {
      mockRedis.eval.mockResolvedValueOnce([]);
      await popCommentEvents(25);

      const [, keys, args] = mockRedis.eval.mock.calls[0];
      expect(keys).toEqual(['comment_queue', 'comment_queue:processing']);
      expect(args).toEqual([25]);
    });

    it('returns empty array when eval returns null', async () => {
      mockRedis.eval.mockResolvedValueOnce(null);
      expect(await popCommentEvents(10)).toEqual([]);
    });

    it('returns empty array when eval returns empty array', async () => {
      mockRedis.eval.mockResolvedValueOnce([]);
      expect(await popCommentEvents(10)).toEqual([]);
    });

    it('skips unparseable items and logs error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const event = makeCommentEvent();
      mockRedis.eval.mockResolvedValueOnce(['{bad json', JSON.stringify(event)]);

      const result = await popCommentEvents(10);

      expect(result).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[CommentQueue] Failed to parse event:'),
        expect.anything()
      );
      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // acknowledgeCommentEvents (batch)
  // =========================================================================
  describe('acknowledgeCommentEvents', () => {
    it('deletes the processing queue when events are provided', async () => {
      await acknowledgeCommentEvents([makeCommentEvent()]);
      expect(mockRedis.del).toHaveBeenCalledWith('comment_queue:processing');
    });

    it('is a no-op for empty events array', async () => {
      await acknowledgeCommentEvents([]);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // acknowledgeCommentEvent (single)
  // =========================================================================
  describe('acknowledgeCommentEvent', () => {
    it('uses LREM to remove a specific serialized event', async () => {
      const json = '{"eventId":"evt-1"}';
      await acknowledgeCommentEvent(json);
      expect(mockRedis.lrem).toHaveBeenCalledWith('comment_queue:processing', 1, json);
    });
  });

  // =========================================================================
  // moveCommentToDeadLetter
  // =========================================================================
  describe('moveCommentToDeadLetter', () => {
    it('atomically moves event from processing to dead letter', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);
      const event = makeCommentEvent();

      await moveCommentToDeadLetter(event, 'db timeout', 3);

      expect(mockPipeline.lpop).toHaveBeenCalledWith('comment_queue:processing');
      expect(mockPipeline.lpush).toHaveBeenCalledWith(
        'comment_queue:dead_letter',
        expect.any(String)
      );

      const entry = JSON.parse(mockPipeline.lpush.mock.calls[0][1]);
      expect(entry.event.eventId).toBe('evt-1');
      expect(entry.error).toBe('db timeout');
      expect(entry.attempts).toBe(3);
      expect(typeof entry.firstFailedAt).toBe('number');
      expect(typeof entry.lastFailedAt).toBe('number');
    });

    it('caps dead letter queue at 1000 entries', async () => {
      mockPipelineExec.mockResolvedValueOnce([]);
      await moveCommentToDeadLetter(makeCommentEvent(), 'err', 1);
      expect(mockPipeline.ltrim).toHaveBeenCalledWith('comment_queue:dead_letter', 0, 999);
    });
  });

  // =========================================================================
  // getCommentQueueHealth
  // =========================================================================
  describe('getCommentQueueHealth', () => {
    it('returns correct health stats from pipeline', async () => {
      mockPipelineExec.mockResolvedValueOnce([10, 3, 2, '1700000000000']);

      const health = await getCommentQueueHealth();

      expect(health).toEqual({
        pendingCount: 10,
        processingCount: 3,
        deadLetterCount: 2,
        lastProcessedAt: 1700000000000,
      });
    });

    it('defaults to zero / null for missing values', async () => {
      mockPipelineExec.mockResolvedValueOnce([null, undefined, 0, null]);

      const health = await getCommentQueueHealth();

      expect(health.pendingCount).toBe(0);
      expect(health.processingCount).toBe(0);
      expect(health.deadLetterCount).toBe(0);
      expect(health.lastProcessedAt).toBeNull();
    });
  });

  // =========================================================================
  // recoverCommentOrphans
  // =========================================================================
  describe('recoverCommentOrphans', () => {
    it('returns 0 when processing queue is empty', async () => {
      mockRedis.llen.mockResolvedValueOnce(0);
      expect(await recoverCommentOrphans()).toBe(0);
    });

    it('moves all processing items back to main queue', async () => {
      const event = makeCommentEvent();
      mockRedis.llen.mockResolvedValueOnce(1);
      mockRedis.lrange.mockResolvedValueOnce([JSON.stringify(event)]);
      mockPipelineExec.mockResolvedValueOnce([]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const count = await recoverCommentOrphans();

      expect(count).toBe(1);
      expect(mockPipeline.rpush).toHaveBeenCalledWith('comment_queue', expect.any(String));
      expect(mockPipeline.del).toHaveBeenCalledWith('comment_queue:processing');
      consoleSpy.mockRestore();
    });

    it('returns 0 when lrange returns empty', async () => {
      mockRedis.llen.mockResolvedValueOnce(2);
      mockRedis.lrange.mockResolvedValueOnce([]);

      expect(await recoverCommentOrphans()).toBe(0);
    });

    it('handles non-string items by serializing them', async () => {
      const eventObj = makeCommentEvent();
      mockRedis.llen.mockResolvedValueOnce(1);
      // Upstash may return already-parsed objects from lrange
      mockRedis.lrange.mockResolvedValueOnce([eventObj]);
      mockPipelineExec.mockResolvedValueOnce([]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const count = await recoverCommentOrphans();

      expect(count).toBe(1);
      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // setCommentLastProcessedAt
  // =========================================================================
  describe('setCommentLastProcessedAt', () => {
    it('sets timestamp on the correct key', async () => {
      const before = Date.now();
      await setCommentLastProcessedAt();
      const after = Date.now();

      expect(mockRedis.set).toHaveBeenCalledTimes(1);
      const [key, value] = mockRedis.set.mock.calls[0];
      expect(key).toBe('comment_queue:last_processed_at');
      const ts = parseInt(value, 10);
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });
});
