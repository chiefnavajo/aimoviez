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
 * H25 fix: Instead of per-item LREM with JSON.stringify() matching (which can silently
 * fail due to JSON key ordering differences after deserialization/reserialization),
 * delete the entire processing queue since all items in the batch were just processed.
 * This is safe because the distributed lock ensures only one processor runs at a time.
 */
export async function acknowledgeEvents(events: VoteQueueEvent[]): Promise<void> {
  if (events.length === 0) return;

  const r = getRedis();
  await r.del(QUEUE_KEYS.processing);
}

/**
 * Acknowledge a single successfully processed event.
 * Uses LREM to remove the specific event from the processing queue,
 * preventing silent loss of other events when processing order differs.
 */
export async function acknowledgeEvent(eventJson: string): Promise<void> {
  const r = getRedis();
  await r.lrem(QUEUE_KEYS.processing, 1, eventJson);
}

/**
 * Move a failed event to the dead letter queue.
 * H25 fix: Uses LPOP instead of LREM with JSON string matching to avoid
 * silent failures from JSON key ordering differences.
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
  // Remove one item from processing queue (safe under distributed lock)
  pipeline.lpop(QUEUE_KEYS.processing);
  // Add to dead letter queue
  pipeline.lpush(QUEUE_KEYS.deadLetter, JSON.stringify(deadLetterEntry));
  // Cap dead letter queue at 1000 entries to prevent unbounded growth
  pipeline.ltrim(QUEUE_KEYS.deadLetter, 0, 999);
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
  const ORPHAN_AGE_MS = 5 * 60 * 1000; // 5 minutes — items older than this are considered orphaned
  const now = Date.now();

  // Check if there are any items in the processing queue
  const processingCount = await r.llen(QUEUE_KEYS.processing);

  if (processingCount === 0) return 0;

  // Read all processing items
  const items = await r.lrange(QUEUE_KEYS.processing, 0, -1);

  if (!items || items.length === 0) return 0;

  const orphaned: string[] = [];
  const stillActive: string[] = [];

  for (const item of items) {
    const serialized = typeof item === 'string' ? item : JSON.stringify(item);
    try {
      const parsed = typeof item === 'string' ? JSON.parse(item) : item;
      const age = now - (parsed.timestamp || 0);
      if (age > ORPHAN_AGE_MS) {
        orphaned.push(serialized);
      } else {
        stillActive.push(serialized);
      }
    } catch {
      // Can't parse — treat as orphaned to avoid permanent stuck items
      orphaned.push(serialized);
    }
  }

  if (orphaned.length === 0) return 0;

  const pipeline = r.pipeline();

  // Move only orphaned items back to main queue
  for (const item of orphaned) {
    pipeline.rpush(QUEUE_KEYS.main, item);
  }

  // Rebuild the processing queue with only still-active items
  pipeline.del(QUEUE_KEYS.processing);
  for (const item of stillActive) {
    pipeline.rpush(QUEUE_KEYS.processing, item);
  }

  await pipeline.exec();

  console.log(`[VoteQueue] Recovered ${orphaned.length} orphaned events (${stillActive.length} still active)`);
  return orphaned.length;
}

/**
 * Update the last processed timestamp.
 */
export async function setLastProcessedAt(): Promise<void> {
  const r = getRedis();
  await r.set(QUEUE_KEYS.lastProcessed, String(Date.now()));
}
