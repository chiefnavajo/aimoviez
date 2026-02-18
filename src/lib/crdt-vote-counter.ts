// lib/crdt-vote-counter.ts
// ============================================================================
// CRDT PN-COUNTER FOR VOTE COUNTING
// Conflict-free replicated data type for distributed vote counting.
// Each node maintains its own increment/decrement counters.
// Total = sum(all P values) - sum(all N values)
// ============================================================================

import { Redis } from '@upstash/redis';

// Default nodeId for single-region serverless (Vercel)
const NODE_ID = process.env.CRDT_NODE_ID || 'main';

// ============================================================================
// REDIS CLIENT
// ============================================================================

let redis: Redis | null = null;

function getRedis(): Redis {
  if (redis) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error('[CRDTCounter] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }

  redis = new Redis({ url, token });
  return redis;
}

// ============================================================================
// KEY HELPERS
// ============================================================================

const KEYS = {
  p: (clipId: string) => `crdt:${clipId}:p`,
  n: (clipId: string) => `crdt:${clipId}:n`,
  pw: (clipId: string) => `crdt:${clipId}:pw`,
  nw: (clipId: string) => `crdt:${clipId}:nw`,
} as const;

// ============================================================================
// TYPES
// ============================================================================

export interface CRDTCountResult {
  voteCount: number;
  weightedScore: number;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Increment vote count and weighted score for a clip.
 * Uses a pipeline (single HTTP call) for both HINCRBY operations.
 */
export async function incrementVote(
  clipId: string,
  weight: number = 1,
  nodeId: string = NODE_ID
): Promise<void> {
  const r = getRedis();
  const pipeline = r.pipeline();
  pipeline.hincrby(KEYS.p(clipId), nodeId, 1);
  pipeline.hincrby(KEYS.pw(clipId), nodeId, weight);
  // 30-day TTL to prevent unbounded key accumulation
  pipeline.expire(KEYS.p(clipId), 30 * 24 * 3600);
  pipeline.expire(KEYS.pw(clipId), 30 * 24 * 3600);
  await pipeline.exec();
}

/**
 * Decrement vote count and weighted score for a clip (unvote).
 * Uses a pipeline (single HTTP call) for both HINCRBY operations.
 */
export async function decrementVote(
  clipId: string,
  weight: number = 1,
  nodeId: string = NODE_ID
): Promise<void> {
  const r = getRedis();
  const pipeline = r.pipeline();
  pipeline.hincrby(KEYS.n(clipId), nodeId, 1);
  pipeline.hincrby(KEYS.nw(clipId), nodeId, weight);
  // 30-day TTL to prevent unbounded key accumulation
  pipeline.expire(KEYS.n(clipId), 30 * 24 * 3600);
  pipeline.expire(KEYS.nw(clipId), 30 * 24 * 3600);
  await pipeline.exec();
}

/**
 * Get the net vote count for a clip.
 * Returns sum(P values) - sum(N values).
 */
export async function getCount(clipId: string): Promise<number> {
  const r = getRedis();
  const pipeline = r.pipeline();
  pipeline.hgetall(KEYS.p(clipId));
  pipeline.hgetall(KEYS.n(clipId));
  const results = await pipeline.exec();

  const pHash = results[0] as Record<string, string> | null;
  const nHash = results[1] as Record<string, string> | null;

  return sumHashValues(pHash) - sumHashValues(nHash);
}

/**
 * Get the net weighted score for a clip.
 * Returns sum(PW values) - sum(NW values).
 */
export async function getWeightedScore(clipId: string): Promise<number> {
  const r = getRedis();
  const pipeline = r.pipeline();
  pipeline.hgetall(KEYS.pw(clipId));
  pipeline.hgetall(KEYS.nw(clipId));
  const results = await pipeline.exec();

  const pwHash = results[0] as Record<string, string> | null;
  const nwHash = results[1] as Record<string, string> | null;

  return sumHashValues(pwHash) - sumHashValues(nwHash);
}

/**
 * Get both vote count and weighted score in a single pipeline call.
 */
export async function getCountAndScore(clipId: string): Promise<CRDTCountResult> {
  const r = getRedis();
  const pipeline = r.pipeline();
  pipeline.hgetall(KEYS.p(clipId));
  pipeline.hgetall(KEYS.n(clipId));
  pipeline.hgetall(KEYS.pw(clipId));
  pipeline.hgetall(KEYS.nw(clipId));
  const results = await pipeline.exec();

  const pHash = results[0] as Record<string, string> | null;
  const nHash = results[1] as Record<string, string> | null;
  const pwHash = results[2] as Record<string, string> | null;
  const nwHash = results[3] as Record<string, string> | null;

  return {
    voteCount: sumHashValues(pHash) - sumHashValues(nHash),
    weightedScore: sumHashValues(pwHash) - sumHashValues(nwHash),
  };
}

/**
 * Get counts and scores for multiple clips in a single pipeline.
 * Used by the counter sync cron for batch processing.
 */
export async function getCountsForClips(
  clipIds: string[]
): Promise<Map<string, CRDTCountResult>> {
  if (clipIds.length === 0) return new Map();

  const r = getRedis();
  const pipeline = r.pipeline();

  // Queue 4 HGETALL commands per clip
  for (const clipId of clipIds) {
    pipeline.hgetall(KEYS.p(clipId));
    pipeline.hgetall(KEYS.n(clipId));
    pipeline.hgetall(KEYS.pw(clipId));
    pipeline.hgetall(KEYS.nw(clipId));
  }

  const results = await pipeline.exec();
  const counters = new Map<string, CRDTCountResult>();

  for (let i = 0; i < clipIds.length; i++) {
    const offset = i * 4;
    const pHash = results[offset] as Record<string, string> | null;
    const nHash = results[offset + 1] as Record<string, string> | null;
    const pwHash = results[offset + 2] as Record<string, string> | null;
    const nwHash = results[offset + 3] as Record<string, string> | null;

    counters.set(clipIds[i], {
      voteCount: sumHashValues(pHash) - sumHashValues(nHash),
      weightedScore: sumHashValues(pwHash) - sumHashValues(nwHash),
    });
  }

  return counters;
}

/**
 * Clear all CRDT keys for a single clip.
 * Used during slot transition to free Redis memory.
 */
export async function clearClip(clipId: string): Promise<void> {
  const r = getRedis();
  await r.del(KEYS.p(clipId), KEYS.n(clipId), KEYS.pw(clipId), KEYS.nw(clipId));
}

/**
 * Clear all CRDT keys for multiple clips.
 * Used during slot transition for batch cleanup.
 */
export async function clearClips(clipIds: string[]): Promise<void> {
  if (clipIds.length === 0) return;

  const r = getRedis();
  const keys: string[] = [];
  for (const clipId of clipIds) {
    keys.push(KEYS.p(clipId), KEYS.n(clipId), KEYS.pw(clipId), KEYS.nw(clipId));
  }
  await r.del(...keys);
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Sum all numeric values in a Redis hash.
 * Upstash returns hash values as strings; this parses and sums them.
 */
function sumHashValues(hash: Record<string, string> | null): number {
  if (!hash) return 0;
  let total = 0;
  for (const value of Object.values(hash)) {
    const num = parseFloat(String(value));
    if (!isNaN(num)) {
      total += num;
    }
  }
  return total;
}
