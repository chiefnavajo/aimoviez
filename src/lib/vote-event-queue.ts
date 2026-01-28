// lib/vote-event-queue.ts
// ============================================================================
// VOTE EVENT QUEUE
// Redis list-based queue with crash-safe processing.
// Events are atomically moved from vote_queue to vote_queue:processing,
// then removed after successful database insertion.
// ============================================================================

import { Redis } from '@upstash/redis';
import type {
  VoteQueueEvent,
  DeadLetterEntry,
  VoteQueueHealth,
} from '@/types/vote-queue';

// ============================================================================
// CONFIGURATION
// ============================================================================

const QUEUE_KEYS = {
  main: 'vote_queue',
  processing: 'vote_queue:processing',
  deadLetter: 'vote_queue:dead_letter',
  lastProcessed: 'vote_queue:last_processed_at',
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
    throw new Error('[VoteQueue] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }

  redis = new Redis({ url, token });
  return redis;
}

// ============================================================================
// QUEUE OPERATIONS
// ============================================================================

/**
 * Push a vote event to the main queue.
 */
export async function pushEvent(event: VoteQueueEvent): Promise<void> {
  const r = getRedis();
  await r.lpush(QUEUE_KEYS.main, JSON.stringify(event));
}

/**
 * Dequeue a batch of events from the main queue to the processing queue.
 * Uses LRANGE + LTRIM + RPUSH for crash-safe batch dequeue.
 * Safe because the cron processor holds a distributed lock.
 */
export async function popEvents(count: number): Promise<VoteQueueEvent[]> {
  const r = getRedis();

  // Read the last `count` elements (oldest first, since LPUSH adds to head)
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
  const events: VoteQueueEvent[] = [];
  for (const item of items) {
    try {
      const event = typeof item === 'string' ? JSON.parse(item) : item;
      events.push(event as VoteQueueEvent);
    } catch (error) {
      console.error('[VoteQueue] Failed to parse event:', error);
    }
  }

  return events;
}

/**
 * Acknowledge successfully processed events by removing them from the processing queue.
 */
export async function acknowledgeEvents(events: VoteQueueEvent[]): Promise<void> {
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
export async function acknowledgeEvent(event: VoteQueueEvent): Promise<void> {
  const r = getRedis();
  await r.lrem(QUEUE_KEYS.processing, 1, JSON.stringify(event));
}

/**
 * Move a failed event to the dead letter queue.
 */
export async function moveToDeadLetter(
  event: VoteQueueEvent,
  error: string,
  attempts: number
): Promise<void> {
  const r = getRedis();
  const now = Date.now();

  const deadLetterEntry: DeadLetterEntry = {
    event,
    error,
    attempts,
    firstFailedAt: now,
    lastFailedAt: now,
  };

  const pipeline = r.pipeline();
  // Remove from processing queue
  pipeline.lrem(QUEUE_KEYS.processing, 1, JSON.stringify(event));
  // Add to dead letter queue
  pipeline.lpush(QUEUE_KEYS.deadLetter, JSON.stringify(deadLetterEntry));
  await pipeline.exec();
}

/**
 * Get health statistics for the vote queue.
 */
export async function getQueueHealth(): Promise<VoteQueueHealth> {
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
    avgProcessingTimeMs: 0, // Computed by monitoring, not tracked here
  };
}

/**
 * Recover orphaned events from the processing queue.
 * Events that have been in processing longer than maxAgeMs are considered orphaned
 * (from a crashed cron invocation) and moved back to the main queue.
 *
 * Since we can't check individual event ages in Redis lists efficiently,
 * this moves ALL processing items back to the main queue if any exist.
 * Safe because the distributed lock ensures only one processor runs at a time.
 */
export async function recoverOrphans(): Promise<number> {
  const r = getRedis();

  // Check if there are any items in the processing queue
  const processingCount = await r.llen(QUEUE_KEYS.processing);

  if (processingCount === 0) return 0;

  // Move all processing items back to main queue
  const items = await r.lrange(QUEUE_KEYS.processing, 0, -1);

  if (!items || items.length === 0) return 0;

  const pipeline = r.pipeline();

  // Add items back to main queue (at the head for priority processing)
  for (const item of items) {
    const serialized = typeof item === 'string' ? item : JSON.stringify(item);
    pipeline.rpush(QUEUE_KEYS.main, serialized);
  }

  // Clear the processing queue
  pipeline.del(QUEUE_KEYS.processing);

  await pipeline.exec();

  console.log(`[VoteQueue] Recovered ${items.length} orphaned events`);
  return items.length;
}

/**
 * Update the last processed timestamp.
 */
export async function setLastProcessedAt(): Promise<void> {
  const r = getRedis();
  await r.set(QUEUE_KEYS.lastProcessed, String(Date.now()));
}
