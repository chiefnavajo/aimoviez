// lib/leaderboard-redis.ts
// ============================================================================
// REDIS SORTED SET LEADERBOARDS
// Instant leaderboard queries (~1ms) replacing PostgreSQL GROUP BY (~500-2000ms).
// All operations are no-ops / return null when redis_leaderboards flag is disabled.
// ============================================================================

import { Redis } from '@upstash/redis';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Daily leaderboard TTL: 48 hours (covers timezone edge cases) */
const DAILY_TTL = 48 * 60 * 60;

// ============================================================================
// KEY GENERATORS
// ============================================================================

const KEYS = {
  // Multi-genre: namespace clip leaderboards by seasonId to prevent cross-genre collisions
  clips: (seasonId: string, slotPosition: number) => `leaderboard:clips:${seasonId}:${slotPosition}`,
  // Legacy key for backwards compatibility (single-genre mode)
  clipsLegacy: (slotPosition: number) => `leaderboard:clips:${slotPosition}`,
  votersAll: () => 'leaderboard:voters:all',
  votersDaily: (date: string) => `leaderboard:voters:daily:${date}`,
  creatorsAll: () => 'leaderboard:creators:all',
} as const;

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
// TYPES
// ============================================================================

export interface LeaderboardEntry {
  member: string;
  score: number;
}

// ============================================================================
// WRITE OPERATIONS (called from vote route, inline)
// ============================================================================

/**
 * Update a clip's score in the slot leaderboard.
 * Uses ZADD to set absolute score (idempotent).
 * Multi-genre: seasonId namespaces the key to prevent cross-genre collisions.
 */
export async function updateClipScore(
  seasonId: string,
  clipId: string,
  slotPosition: number,
  weightedScore: number
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.zadd(KEYS.clips(seasonId, slotPosition), { score: weightedScore, member: clipId });
  } catch (err) {
    console.warn('[Leaderboard] updateClipScore failed:', err);
  }
}

/**
 * Increment a voter's score in both all-time and daily leaderboards.
 * Uses ZINCRBY for atomic increment.
 */
export async function updateVoterScore(
  voterKey: string,
  increment: number
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  const todayDate = new Date().toISOString().split('T')[0];

  try {
    const pipeline = r.pipeline();
    pipeline.zincrby(KEYS.votersAll(), increment, voterKey);
    pipeline.zincrby(KEYS.votersDaily(todayDate), increment, voterKey);
    await pipeline.exec();

    // Set TTL on daily key (only if newly created, but expire is idempotent)
    await r.expire(KEYS.votersDaily(todayDate), DAILY_TTL);
  } catch (err) {
    console.warn('[Leaderboard] updateVoterScore failed:', err);
  }
}

/**
 * Increment a creator's score in the all-time leaderboard.
 * Uses ZINCRBY for atomic increment.
 */
export async function updateCreatorScore(
  username: string,
  increment: number
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.zincrby(KEYS.creatorsAll(), increment, username);
  } catch (err) {
    console.warn('[Leaderboard] updateCreatorScore failed:', err);
  }
}

// ============================================================================
// READ OPERATIONS (called from leaderboard routes)
// ============================================================================

/**
 * Get top clips for a specific slot position.
 * Returns null if Redis unavailable (triggers PostgreSQL fallback).
 * Multi-genre: seasonId namespaces the key to prevent cross-genre collisions.
 */
export async function getTopClips(
  seasonId: string,
  slotPosition: number,
  limit: number,
  offset: number
): Promise<{ entries: LeaderboardEntry[]; total: number } | null> {
  const r = getRedis();
  if (!r) return null;

  try {
    const pipeline = r.pipeline();
    pipeline.zrange(KEYS.clips(seasonId, slotPosition), offset, offset + limit - 1, { rev: true, withScores: true });
    pipeline.zcard(KEYS.clips(seasonId, slotPosition));

    const results = await pipeline.exec();

    const rawEntries = results[0] as string[];
    const total = (results[1] as number) || 0;

    const entries = parseZRevRangeWithScores(rawEntries);

    return { entries, total };
  } catch (err) {
    console.warn('[Leaderboard] getTopClips failed:', err);
    return null;
  }
}

/**
 * Get top voters by timeframe.
 * Returns null if Redis unavailable (triggers PostgreSQL fallback).
 */
export async function getTopVoters(
  timeframe: 'all' | 'today' | 'week',
  limit: number,
  offset: number
): Promise<{ entries: LeaderboardEntry[]; total: number } | null> {
  const r = getRedis();
  if (!r) return null;

  // For 'week' timeframe, we don't have a weekly set — fall back to DB
  if (timeframe === 'week') return null;

  const key = timeframe === 'today'
    ? KEYS.votersDaily(new Date().toISOString().split('T')[0])
    : KEYS.votersAll();

  try {
    const pipeline = r.pipeline();
    pipeline.zrange(key, offset, offset + limit - 1, { rev: true, withScores: true });
    pipeline.zcard(key);

    const results = await pipeline.exec();

    const rawEntries = results[0] as string[];
    const total = (results[1] as number) || 0;

    const entries = parseZRevRangeWithScores(rawEntries);

    return { entries, total };
  } catch (err) {
    console.warn('[Leaderboard] getTopVoters failed:', err);
    return null;
  }
}

/**
 * Get top creators.
 * Returns null if Redis unavailable (triggers PostgreSQL fallback).
 */
export async function getTopCreators(
  limit: number,
  offset: number
): Promise<{ entries: LeaderboardEntry[]; total: number } | null> {
  const r = getRedis();
  if (!r) return null;

  try {
    const pipeline = r.pipeline();
    pipeline.zrange(KEYS.creatorsAll(), offset, offset + limit - 1, { rev: true, withScores: true });
    pipeline.zcard(KEYS.creatorsAll());

    const results = await pipeline.exec();

    const rawEntries = results[0] as string[];
    const total = (results[1] as number) || 0;

    const entries = parseZRevRangeWithScores(rawEntries);

    return { entries, total };
  } catch (err) {
    console.warn('[Leaderboard] getTopCreators failed:', err);
    return null;
  }
}

/**
 * Get a voter's rank (0-indexed).
 * Returns null if unavailable.
 */
export async function getVoterRank(
  voterKey: string,
  timeframe: 'all' | 'today'
): Promise<number | null> {
  const r = getRedis();
  if (!r) return null;

  const key = timeframe === 'today'
    ? KEYS.votersDaily(new Date().toISOString().split('T')[0])
    : KEYS.votersAll();

  try {
    const rank = await r.zrevrank(key, voterKey);
    return rank !== null ? rank + 1 : null; // Convert to 1-indexed
  } catch {
    return null;
  }
}

/**
 * Get a creator's rank (0-indexed).
 * Returns null if unavailable.
 */
export async function getCreatorRank(username: string): Promise<number | null> {
  const r = getRedis();
  if (!r) return null;

  try {
    const rank = await r.zrevrank(KEYS.creatorsAll(), username);
    return rank !== null ? rank + 1 : null; // Convert to 1-indexed
  } catch {
    return null;
  }
}

/**
 * Clear the leaderboard for a specific slot (on slot transition).
 * Multi-genre: seasonId namespaces the key to prevent cross-genre collisions.
 */
export async function clearSlotLeaderboard(seasonId: string, slotPosition: number): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.del(KEYS.clips(seasonId, slotPosition));
  } catch (err) {
    console.warn('[Leaderboard] clearSlotLeaderboard failed:', err);
  }
}

// ============================================================================
// BATCH WRITE (called from sync-leaderboards cron)
// ============================================================================

/**
 * Batch update clip scores for a slot.
 * Used by sync-leaderboards cron for consistency.
 * Multi-genre: seasonId namespaces the key to prevent cross-genre collisions.
 */
export async function batchUpdateClipScores(
  seasonId: string,
  slotPosition: number,
  clips: Array<{ clipId: string; weightedScore: number }>
): Promise<void> {
  const r = getRedis();
  if (!r || clips.length === 0) return;

  try {
    const pipeline = r.pipeline();
    for (const clip of clips) {
      pipeline.zadd(KEYS.clips(seasonId, slotPosition), { score: clip.weightedScore, member: clip.clipId });
    }
    await pipeline.exec();
  } catch (err) {
    console.warn('[Leaderboard] batchUpdateClipScores failed:', err);
  }
}

/**
 * Batch update voter scores.
 * Uses ZADD (absolute set) for consistency sync.
 */
export async function batchUpdateVoterScores(
  voters: Array<{ voterKey: string; totalVotes: number }>,
  timeframe: 'all' | 'daily',
  date?: string
): Promise<void> {
  const r = getRedis();
  if (!r || voters.length === 0) return;

  const key = timeframe === 'daily' && date
    ? KEYS.votersDaily(date)
    : KEYS.votersAll();

  try {
    const pipeline = r.pipeline();
    for (const voter of voters) {
      pipeline.zadd(key, { score: voter.totalVotes, member: voter.voterKey });
    }
    await pipeline.exec();

    if (timeframe === 'daily') {
      await r.expire(key, DAILY_TTL);
    }
  } catch (err) {
    console.warn('[Leaderboard] batchUpdateVoterScores failed:', err);
  }
}

/**
 * Batch update creator scores.
 * Uses ZADD (absolute set) for consistency sync.
 */
export async function batchUpdateCreatorScores(
  creators: Array<{ username: string; totalVotes: number }>
): Promise<void> {
  const r = getRedis();
  if (!r || creators.length === 0) return;

  try {
    const pipeline = r.pipeline();
    for (const creator of creators) {
      pipeline.zadd(KEYS.creatorsAll(), { score: creator.totalVotes, member: creator.username });
    }
    await pipeline.exec();
  } catch (err) {
    console.warn('[Leaderboard] batchUpdateCreatorScores failed:', err);
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Parse ZREVRANGE response with scores into LeaderboardEntry array.
 * Upstash returns alternating [member, score, member, score, ...] when withScores is true.
 */
function parseZRevRangeWithScores(raw: unknown): LeaderboardEntry[] {
  if (!raw || !Array.isArray(raw)) return [];

  const entries: LeaderboardEntry[] = [];

  for (let i = 0; i < raw.length; i += 2) {
    const member = String(raw[i]);
    const score = Number(raw[i + 1]) || 0;
    entries.push({ member, score });
  }

  return entries;
}
