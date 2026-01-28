// lib/vote-count-cache.ts
// ============================================================================
// VOTE COUNT CACHE
// Redis cache for clip vote counts and weighted scores.
// Read-through cache with 15s TTL — eliminates DB reads for the most
// frequently queried data on every page load.
// Returns null when disabled or Redis unavailable (triggers DB fallback).
// ============================================================================

import { Redis } from '@upstash/redis';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_TTL = 15; // seconds

const PREFIX = {
  voteCount: 'vc:',
  weightedScore: 'ws:',
} as const;

// ============================================================================
// TYPES
// ============================================================================

export interface CachedVoteData {
  voteCount: number;
  weightedScore: number;
}

// ============================================================================
// REDIS CLIENT
// ============================================================================

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  redis = new Redis({ url, token });
  return redis;
}

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get cached vote counts for multiple clips.
 * Returns a Map of clipId -> { voteCount, weightedScore }.
 * Missing entries are not included in the map (triggers DB lookup for those).
 * Returns null if Redis unavailable.
 */
export async function getCachedVoteCounts(
  clipIds: string[]
): Promise<Map<string, CachedVoteData> | null> {
  const r = getRedis();
  if (!r || clipIds.length === 0) return null;

  try {
    const vcKeys = clipIds.map(id => `${PREFIX.voteCount}${id}`);
    const wsKeys = clipIds.map(id => `${PREFIX.weightedScore}${id}`);

    const pipeline = r.pipeline();
    for (const key of vcKeys) {
      pipeline.get(key);
    }
    for (const key of wsKeys) {
      pipeline.get(key);
    }

    const results = await pipeline.exec();

    const map = new Map<string, CachedVoteData>();
    const halfLen = clipIds.length;

    for (let i = 0; i < halfLen; i++) {
      const vc = results[i];
      const ws = results[halfLen + i];

      // Only include if both values are cached
      if (vc !== null && vc !== undefined) {
        map.set(clipIds[i], {
          voteCount: Number(vc) || 0,
          weightedScore: ws !== null && ws !== undefined ? Number(ws) || 0 : Number(vc) || 0,
        });
      }
    }

    return map;
  } catch (err) {
    console.warn('[VoteCountCache] getCachedVoteCounts failed:', err);
    return null;
  }
}

// ============================================================================
// WRITE OPERATIONS
// ============================================================================

/**
 * Cache vote counts for a batch of clips.
 * Called after fetching clips from DB to populate cache.
 */
export async function setCachedVoteCounts(
  clips: Array<{ id: string; voteCount: number; weightedScore: number }>
): Promise<void> {
  const r = getRedis();
  if (!r || clips.length === 0) return;

  try {
    const pipeline = r.pipeline();
    for (const clip of clips) {
      pipeline.set(`${PREFIX.voteCount}${clip.id}`, clip.voteCount, { ex: DEFAULT_TTL });
      pipeline.set(`${PREFIX.weightedScore}${clip.id}`, clip.weightedScore, { ex: DEFAULT_TTL });
    }
    await pipeline.exec();
  } catch (err) {
    console.warn('[VoteCountCache] setCachedVoteCounts failed:', err);
  }
}

/**
 * Update a single clip's cached vote count.
 * Called after a vote is cast for instant cache refresh.
 */
export async function updateCachedVoteCount(
  clipId: string,
  voteCount: number,
  weightedScore: number
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    const pipeline = r.pipeline();
    pipeline.set(`${PREFIX.voteCount}${clipId}`, voteCount, { ex: DEFAULT_TTL });
    pipeline.set(`${PREFIX.weightedScore}${clipId}`, weightedScore, { ex: DEFAULT_TTL });
    await pipeline.exec();
  } catch (err) {
    console.warn('[VoteCountCache] updateCachedVoteCount failed:', err);
  }
}

/**
 * Invalidate a clip's cached vote count.
 * Called when vote data may be stale (e.g., vote deletion).
 */
export async function invalidateVoteCount(clipId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.del(`${PREFIX.voteCount}${clipId}`, `${PREFIX.weightedScore}${clipId}`);
  } catch (err) {
    console.warn('[VoteCountCache] invalidateVoteCount failed:', err);
  }
}
