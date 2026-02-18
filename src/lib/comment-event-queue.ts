// lib/comment-event-queue.ts
// ============================================================================
// COMMENT EVENT QUEUE
// Redis list-based queue with crash-safe processing.
// Identical pattern to vote-event-queue.ts.
// Events are atomically moved from comment_queue to comment_queue:processing,
// then removed after successful database insertion.
// ============================================================================

import { Redis } from '@upstash/redis';

// ============================================================================
// TYPES
// ============================================================================

export interface CommentQueueEvent {
  eventId: string;
  clipId: string;
  userKey: string;
  action: 'create' | 'like' | 'unlike' | 'delete';
  timestamp: number;
  data: {
    commentText?: string;
    parentCommentId?: string;
    commentId?: string;
    username?: string;
    avatarUrl?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface CommentDeadLetterEntry {
  event: CommentQueueEvent;
  error: string;
  attempts: number;
  firstFailedAt: number;
  lastFailedAt: number;
}

export interface CommentQueueHealth {
  pendingCount: number;
  processingCount: number;
  deadLetterCount: number;
  lastProcessedAt: number | null;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const QUEUE_KEYS = {
  main: 'comment_queue',
  processing: 'comment_queue:processing',
  deadLetter: 'comment_queue:dead_letter',
  lastProcessed: 'comment_queue:last_processed_at',
} as const;

// ============================================================================
// REDIS CLIENT
// ============================================================================

let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error('[CommentQueue] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }

  redis = new Redis({ url, token });
  return redis;
}

// ============================================================================
// QUEUE OPERATIONS
// ============================================================================

/**
 * Push a comment event to the main queue.
 */
export async function pushCommentEvent(event: CommentQueueEvent): Promise<void> {
  const r = getRedis();
  await r.lpush(QUEUE_KEYS.main, JSON.stringify(event));
}

/**
 * Dequeue a batch of events from the main queue to the processing queue.
 * Uses LRANGE + LTRIM + RPUSH for crash-safe batch dequeue.
 */
export async function popCommentEvents(count: number): Promise<CommentQueueEvent[]> {
  const r = getRedis();

  // H24 fix: Use a Lua script for atomic LRANGE+LTRIM to prevent race conditions.
  // Without this, new LPUSH events between LRANGE and LTRIM can shift list positions,
  // causing LTRIM to remove unprocessed events.
  const luaScript = `
    local items = redis.call('LRANGE', KEYS[1], -tonumber(ARGV[1]), -1)
    if #items > 0 then
      redis.call('LTRIM', KEYS[1], 0, -(#items + 1))
      for _, item in ipairs(items) do
        redis.call('RPUSH', KEYS[2], item)
      end
    end
    return items
  `;

  const items = await r.eval(
    luaScript,
    [QUEUE_KEYS.main, QUEUE_KEYS.processing],
    [count]
  ) as string[];

  if (!items || items.length === 0) return [];

  // Parse events
  const events: CommentQueueEvent[] = [];
  for (const item of items) {
    try {
      const event = typeof item === 'string' ? JSON.parse(item) : item;
      events.push(event as CommentQueueEvent);
    } catch (error) {
      console.error('[CommentQueue] Failed to parse event:', error);
    }
  }

  return events;
}

/**
 * Acknowledge successfully processed events by removing them from the processing queue.
 * H25 fix: Instead of per-item LREM with JSON.stringify() matching (which can silently
 * fail due to JSON key ordering differences after deserialization/reserialization),
 * delete the entire processing queue since all items in the batch were just processed.
 * This is safe because the distributed lock ensures only one processor runs at a time.
 */
export async function acknowledgeCommentEvents(events: CommentQueueEvent[]): Promise<void> {
  if (events.length === 0) return;

  const r = getRedis();
  await r.del(QUEUE_KEYS.processing);
}

/**
 * Acknowledge a single successfully processed event.
 * Uses LREM to remove the specific event from the processing queue,
 * preventing silent loss of other events when processing order differs.
 */
export async function acknowledgeCommentEvent(eventJson: string): Promise<void> {
  const r = getRedis();
  await r.lrem(QUEUE_KEYS.processing, 1, eventJson);
}

/**
 * Move a failed event to the dead letter queue.
 * H25 fix: Uses LPOP instead of LREM with JSON string matching to avoid
 * silent failures from JSON key ordering differences.
 */
export async function moveCommentToDeadLetter(
  event: CommentQueueEvent,
  error: string,
  attempts: number
): Promise<void> {
  const r = getRedis();
  const now = Date.now();

  const deadLetterEntry: CommentDeadLetterEntry = {
    event,
    error,
    attempts,
    firstFailedAt: now,
    lastFailedAt: now,
  };

  const pipeline = r.pipeline();
  // Remove one item from processing queue (safe under distributed lock)
  pipeline.lpop(QUEUE_KEYS.processing);
  // Add to dead letter queue
  pipeline.lpush(QUEUE_KEYS.deadLetter, JSON.stringify(deadLetterEntry));
  // Cap dead letter queue at 1000 entries to prevent unbounded growth
  pipeline.ltrim(QUEUE_KEYS.deadLetter, 0, 999);
  await pipeline.exec();
}

/**
 * Get health statistics for the comment queue.
 */
export async function getCommentQueueHealth(): Promise<CommentQueueHealth> {
  const r = getRedis();
  const pipeline = r.pipeline();

  pipeline.llen(QUEUE_KEYS.main);
  pipeline.llen(QUEUE_KEYS.processing);
  pipeline.llen(QUEUE_KEYS.deadLetter);
  pipeline.get(QUEUE_KEYS.lastProcessed);

  const results = await pipeline.exec();

  return {
    pendingCount: (results[0] as number) || 0,
    processingCount: (results[1] as number) || 0,
    deadLetterCount: (results[2] as number) || 0,
    lastProcessedAt: results[3] ? parseInt(String(results[3]), 10) : null,
  };
}

/**
 * Recover orphaned events from the processing queue.
 * Moves ALL processing items back to the main queue.
 * Safe because the distributed lock ensures only one processor runs at a time.
 */
export async function recoverCommentOrphans(): Promise<number> {
  const r = getRedis();

  const processingCount = await r.llen(QUEUE_KEYS.processing);

  if (processingCount === 0) return 0;

  const items = await r.lrange(QUEUE_KEYS.processing, 0, -1);

  if (!items || items.length === 0) return 0;

  const pipeline = r.pipeline();

  for (const item of items) {
    const serialized = typeof item === 'string' ? item : JSON.stringify(item);
    pipeline.rpush(QUEUE_KEYS.main, serialized);
  }

  pipeline.del(QUEUE_KEYS.processing);

  await pipeline.exec();

  console.log(`[CommentQueue] Recovered ${items.length} orphaned events`);
  return items.length;
}

/**
 * Update the last processed timestamp.
 */
export async function setCommentLastProcessedAt(): Promise<void> {
  const r = getRedis();
  await r.set(QUEUE_KEYS.lastProcessed, String(Date.now()));
}
