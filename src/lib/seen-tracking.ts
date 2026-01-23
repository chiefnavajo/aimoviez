// lib/seen-tracking.ts
// Redis Set based "seen" tracking for scalable clip distribution
// Handles millions of users and clips without database bloat
//
// Why Redis Sets?
// - O(1) SADD (add) and O(1) SISMEMBER (check) operations
// - Much faster than database JOINs
// - Each user-slot gets a separate set for easy cleanup
// - Can handle millions of clips per user
// - Simple and reliable with standard Redis commands

import { Redis } from '@upstash/redis';

// Initialize Redis client (reuses existing Upstash connection)
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn('[SeenTracking] Redis not configured - falling back to no tracking');
    return null;
  }

  try {
    redis = new Redis({ url, token });
    return redis;
  } catch (error) {
    console.error('[SeenTracking] Failed to create Redis client:', error);
    return null;
  }
}

// TTL for seen tracking sets (30 days in seconds)
// After 30 days, users can see clips again
const SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Generate the Redis key for a user's seen clips set
 * Separate sets per slot for better organization and easier cleanup
 */
function getSeenKey(voterId: string, slotPosition: number): string {
  return `seen:${voterId}:slot:${slotPosition}`;
}

/**
 * Mark a clip as seen by a voter
 * @param voterId - The voter's unique key (user_xxx or anon_xxx)
 * @param slotPosition - The slot position (1-8)
 * @param clipId - The clip UUID
 */
export async function markClipAsSeen(
  voterId: string,
  slotPosition: number,
  clipId: string
): Promise<void> {
  const redisClient = getRedis();
  if (!redisClient) return;

  try {
    const key = getSeenKey(voterId, slotPosition);
    // SADD adds the clipId to the set (O(1) operation)
    await redisClient.sadd(key, clipId);
    // Set TTL to auto-expire old tracking data
    await redisClient.expire(key, SEEN_TTL_SECONDS);
  } catch (error) {
    // Log but don't fail - seen tracking is not critical
    console.error('[SeenTracking] Error marking clip as seen:', error);
  }
}

/**
 * Mark multiple clips as seen (batch operation)
 * @param voterId - The voter's unique key
 * @param slotPosition - The slot position
 * @param clipIds - Array of clip UUIDs
 */
export async function markClipsAsSeen(
  voterId: string,
  slotPosition: number,
  clipIds: string[]
): Promise<void> {
  if (clipIds.length === 0) return;

  const redisClient = getRedis();
  if (!redisClient) return;

  try {
    const key = getSeenKey(voterId, slotPosition);
    // SADD with multiple members (still O(n) where n is number of clips, very fast)
    // Use array form for TypeScript compatibility
    await redisClient.sadd(key, clipIds[0], ...clipIds.slice(1));
    // Set TTL to auto-expire old tracking data
    await redisClient.expire(key, SEEN_TTL_SECONDS);
  } catch (error) {
    console.error('[SeenTracking] Error marking clips as seen:', error);
  }
}

/**
 * Check if a voter has seen a specific clip
 * @param voterId - The voter's unique key
 * @param slotPosition - The slot position
 * @param clipId - The clip UUID
 * @returns true if seen, false if not seen
 */
export async function hasSeenClip(
  voterId: string,
  slotPosition: number,
  clipId: string
): Promise<boolean> {
  const redisClient = getRedis();
  if (!redisClient) return false;

  try {
    const key = getSeenKey(voterId, slotPosition);
    // SISMEMBER returns 1 if member exists, 0 if not (O(1) operation)
    const result = await redisClient.sismember(key, clipId);
    return result === 1;
  } catch (error) {
    console.error('[SeenTracking] Error checking if clip seen:', error);
    // On error, assume not seen (fail open)
    return false;
  }
}

/**
 * Filter a list of clips to only those not seen by the voter
 * This is the main function used for clip distribution
 * @param voterId - The voter's unique key
 * @param slotPosition - The slot position
 * @param clipIds - Array of clip UUIDs to check
 * @returns Array of clip IDs that have NOT been seen
 */
export async function filterUnseenClipIds(
  voterId: string,
  slotPosition: number,
  clipIds: string[]
): Promise<string[]> {
  if (clipIds.length === 0) return [];

  const redisClient = getRedis();
  if (!redisClient) {
    // No Redis - return all clips (fail open)
    return clipIds;
  }

  try {
    const key = getSeenKey(voterId, slotPosition);

    // For small lists, use SISMEMBER for each (batched with pipeline would be better)
    // For large lists, get all seen clips and filter in JS
    if (clipIds.length <= 50) {
      // Use individual SISMEMBER calls (fast for small lists)
      const results = await Promise.all(
        clipIds.map(clipId => redisClient.sismember(key, clipId))
      );
      return clipIds.filter((_, index) => results[index] === 0);
    } else {
      // Get all seen clips in this slot and filter
      const seenClips = await redisClient.smembers(key);
      const seenSet = new Set(seenClips);
      return clipIds.filter(clipId => !seenSet.has(clipId));
    }
  } catch (error) {
    console.error('[SeenTracking] Error filtering unseen clips:', error);
    // On error, return all clips (fail open)
    return clipIds;
  }
}

/**
 * Reset seen tracking for a voter (e.g., when they want to see all clips again)
 * @param voterId - The voter's unique key
 * @param slotPosition - Optional slot position (if not provided, resets all slots)
 */
export async function resetSeenClips(
  voterId: string,
  slotPosition?: number
): Promise<void> {
  const redisClient = getRedis();
  if (!redisClient) return;

  try {
    if (slotPosition !== undefined) {
      // Reset single slot
      const key = getSeenKey(voterId, slotPosition);
      await redisClient.del(key);
    } else {
      // Reset all slots (1-8)
      const keys = Array.from({ length: 8 }, (_, i) => getSeenKey(voterId, i + 1));
      await redisClient.del(...keys);
    }
  } catch (error) {
    console.error('[SeenTracking] Error resetting seen clips:', error);
  }
}

/**
 * Get count of seen clips for a voter in a slot
 * Useful for analytics/debugging
 * @param voterId - The voter's unique key
 * @param slotPosition - The slot position
 * @returns Number of clips seen (or 0 if set doesn't exist)
 */
export async function getSeenClipCount(
  voterId: string,
  slotPosition: number
): Promise<number> {
  const redisClient = getRedis();
  if (!redisClient) return 0;

  try {
    const key = getSeenKey(voterId, slotPosition);
    // SCARD returns the set cardinality (number of elements)
    return await redisClient.scard(key);
  } catch (error) {
    console.error('[SeenTracking] Error getting seen clip count:', error);
    return 0;
  }
}

/**
 * Get all seen clip IDs for a voter in a slot
 * Useful for debugging
 * @param voterId - The voter's unique key
 * @param slotPosition - The slot position
 * @returns Array of seen clip IDs
 */
export async function getSeenClipIds(
  voterId: string,
  slotPosition: number
): Promise<string[]> {
  const redisClient = getRedis();
  if (!redisClient) return [];

  try {
    const key = getSeenKey(voterId, slotPosition);
    return await redisClient.smembers(key);
  } catch (error) {
    console.error('[SeenTracking] Error getting seen clip IDs:', error);
    return [];
  }
}
