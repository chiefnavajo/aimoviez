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

  const items = await r.lrange(QUEUE_KEYS.main, -count, -1);

  if (!items || items.length === 0) return [];

  const pipeline = r.pipeline();

  // Remove the dequeued items from main queue
  pipeline.ltrim(QUEUE_KEYS.main, 0, -(items.length + 1));

  // Add them to processing queue
  for (const item of items) {
    const serialized = typeof item === 'string' ? item : JSON.stringify(item);
    pipeline.rpush(QUEUE_KEYS.processing, serialized);
  }

  await pipeline.exec();

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
 */
export async function acknowledgeCommentEvents(events: CommentQueueEvent[]): Promise<void> {
  if (events.length === 0) return;

  const r = getRedis();
  const pipeline = r.pipeline();

  for (const event of events) {
    pipeline.lrem(QUEUE_KEYS.processing, 1, JSON.stringify(event));
  }

  await pipeline.exec();
}

/**
 * Acknowledge a single successfully processed event.
 */
export async function acknowledgeCommentEvent(event: CommentQueueEvent): Promise<void> {
  const r = getRedis();
  await r.lrem(QUEUE_KEYS.processing, 1, JSON.stringify(event));
}

/**
 * Move a failed event to the dead letter queue.
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
  pipeline.lrem(QUEUE_KEYS.processing, 1, JSON.stringify(event));
  pipeline.lpush(QUEUE_KEYS.deadLetter, JSON.stringify(deadLetterEntry));
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
