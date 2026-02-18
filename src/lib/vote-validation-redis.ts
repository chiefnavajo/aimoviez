// lib/vote-validation-redis.ts
// ============================================================================
// REDIS-BASED VOTE VALIDATION
// Replaces PostgreSQL queries in the vote hot path when async_voting is enabled.
// All validation completes in ~2-4ms (vs ~50-100ms with PostgreSQL).
// ============================================================================

import { Redis } from '@upstash/redis';
import type { VoteQueueEvent } from '@/types/vote-queue';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Daily counter TTL: 48 hours (covers UTC timezone edge cases) */
const DAILY_COUNTER_TTL = 48 * 60 * 60;

/** Dedup marker TTL: 7 days */
const DEDUP_TTL = 7 * 24 * 60 * 60;

/** Voting freeze marker TTL: 120 seconds */
const FROZEN_TTL = 120;

// ============================================================================
// KEY GENERATORS
// ============================================================================

const KEYS = {
  daily: (date: string, voterKey: string) => `daily:${date}:${voterKey}`,
  voted: (voterKey: string, clipId: string) => `voted:${voterKey}:${clipId}`,
  slot: (seasonId: string) => `slot:${seasonId}`,
  frozen: (seasonId: string, slotPos: number) => `slot_frozen:${seasonId}:${slotPos}`,
  activeClips: () => 'clips_active',
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
    throw new Error('[VoteValidation] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  }

  redis = new Redis({ url, token });
  return redis;
}

// ============================================================================
// TYPES
// ============================================================================

export interface VoteValidationResult {
  valid: boolean;
  code?: string;
  message?: string;
  dailyCount?: number;
}

interface SlotState {
  slotPosition: number;
  status: string;
  votingEndsAt: string | null;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate a vote against Redis state in a single pipeline (~2ms).
 * Checks: daily limit, dedup, slot validity, voting freeze.
 */
export async function validateVoteRedis(
  voterKey: string,
  clipId: string,
  seasonId: string,
  slotPosition: number,
  dailyLimit: number
): Promise<VoteValidationResult> {
  const r = getRedis();
  const todayDate = getTodayDateString();

  // Single pipeline: 4 reads in 1 HTTP call
  const pipeline = r.pipeline();
  pipeline.get(KEYS.daily(todayDate, voterKey));
  pipeline.exists(KEYS.voted(voterKey, clipId));
  pipeline.get(KEYS.slot(seasonId));
  pipeline.exists(KEYS.frozen(seasonId, slotPosition));

  const results = await pipeline.exec();

  // Parse results
  const dailyCount = parseInt(String(results[0] ?? '0'), 10) || 0;
  const alreadyVoted = results[1] as number; // EXISTS returns 0 or 1
  const slotDataRaw = results[2] as string | null;
  const isFrozen = results[3] as number; // EXISTS returns 0 or 1

  // Check daily limit
  if (dailyCount >= dailyLimit) {
    return {
      valid: false,
      code: 'DAILY_LIMIT',
      message: `Daily vote limit reached (${dailyLimit} votes)`,
      dailyCount,
    };
  }

  // Check duplicate vote
  if (alreadyVoted === 1) {
    return {
      valid: false,
      code: 'ALREADY_VOTED',
      message: 'Already voted on this clip',
      dailyCount,
    };
  }

  // Check slot state
  if (!slotDataRaw) {
    return {
      valid: false,
      code: 'SLOT_STATE_MISSING',
      message: 'Slot state not found in Redis',
      dailyCount,
    };
  }

  let slotState: SlotState;
  try {
    slotState = typeof slotDataRaw === 'string'
      ? JSON.parse(slotDataRaw)
      : slotDataRaw as unknown as SlotState;
  } catch {
    return {
      valid: false,
      code: 'SLOT_STATE_MISSING',
      message: 'Invalid slot state in Redis',
      dailyCount,
    };
  }

  if (slotState.status !== 'voting') {
    return {
      valid: false,
      code: 'NO_ACTIVE_SLOT',
      message: 'No active voting slot',
      dailyCount,
    };
  }

  if (slotState.slotPosition !== slotPosition) {
    return {
      valid: false,
      code: 'WRONG_SLOT',
      message: 'Clip is not in the current voting slot',
      dailyCount,
    };
  }

  // H12: Check voting_ends_at — reject votes after the voting period has expired
  if (slotState.votingEndsAt) {
    const endsAt = new Date(slotState.votingEndsAt).getTime();
    if (Date.now() > endsAt) {
      return {
        valid: false,
        code: 'VOTING_EXPIRED',
        message: 'Voting period has ended',
        dailyCount,
      };
    }
  }

  // Check voting freeze
  if (isFrozen === 1) {
    return {
      valid: false,
      code: 'VOTING_FROZEN',
      message: 'Voting is closing, results being tallied',
      dailyCount,
    };
  }

  return { valid: true, dailyCount };
}

// ============================================================================
// RECORDING
// ============================================================================

/**
 * Record a vote in Redis: dedup marker (atomic SETNX), daily counter, queue event, active clips set.
 * Uses SET NX for the dedup marker to atomically prevent duplicate votes (TOCTOU fix).
 * Returns true if vote was recorded, false if duplicate detected.
 */
export async function recordVote(
  voterKey: string,
  clipId: string,
  event: VoteQueueEvent,
  date: string
): Promise<boolean> {
  const r = getRedis();

  // Atomic dedup: SET NX returns true only if key didn't exist (first vote wins)
  const dedupKey = KEYS.voted(voterKey, clipId);
  const wasSet = await r.set(dedupKey, '1', { ex: DEDUP_TTL, nx: true });

  if (!wasSet) {
    // Another concurrent request already recorded this vote
    return false;
  }

  // Dedup succeeded — record the rest in a pipeline
  // FIX: Wrap pipeline in try/catch. If the pipeline fails (e.g. queue push fails),
  // delete the dedup key so the user can retry. Otherwise the dedup marker persists
  // and the vote is permanently lost — the user can never re-vote on this clip.
  try {
    const pipeline = r.pipeline();

    // Daily counter (48-hour TTL)
    const dailyKey = KEYS.daily(date, voterKey);
    pipeline.incr(dailyKey);
    pipeline.expire(dailyKey, DAILY_COUNTER_TTL);

    // Queue event for async PostgreSQL persistence
    pipeline.lpush('vote_queue', JSON.stringify(event));

    // Track clip as having recent votes (for counter sync)
    pipeline.sadd(KEYS.activeClips(), clipId);

    await pipeline.exec();
    return true;
  } catch (pipelineError) {
    // Pipeline failed — clean up the dedup key to allow retry
    console.error('[recordVote] Pipeline failed, removing dedup key to allow retry:', pipelineError);
    try {
      await r.del(dedupKey);
    } catch (cleanupErr) {
      console.error('[recordVote] Failed to clean up dedup key after pipeline failure:', cleanupErr);
    }
    throw pipelineError;
  }
}

/**
 * Remove a vote record from Redis (for unvote).
 * Uses a Lua script to atomically decrement the daily counter and clamp to 0,
 * preventing negative values that could allow vote limit bypass (H3 fix).
 */
export async function removeVoteRecord(
  voterKey: string,
  clipId: string,
  date: string
): Promise<void> {
  const r = getRedis();
  const dailyKey = KEYS.daily(date, voterKey);

  // Delete the dedup marker
  await r.del(KEYS.voted(voterKey, clipId));

  // Atomically decrement daily counter and clamp to 0 via Lua script.
  // This prevents race conditions where concurrent unvotes could push
  // the counter negative, allowing extra votes beyond the daily limit.
  const luaScript = `
    local key = KEYS[1]
    local val = redis.call('DECR', key)
    if val < 0 then
      redis.call('SET', key, 0)
      return 0
    end
    return val
  `;
  await r.eval(luaScript, [dailyKey], []);
}

// ============================================================================
// SLOT STATE MANAGEMENT (used by auto-advance cron)
// ============================================================================

// FIX: Add TTL to prevent stale keys from accumulating
const SLOT_STATE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Update the slot state in Redis.
 * Called by auto-advance cron when a slot transitions.
 */
export async function setSlotState(
  seasonId: string,
  state: SlotState
): Promise<void> {
  const r = getRedis();
  // FIX: Add TTL to prevent stale slot state from accumulating after season ends
  await r.set(KEYS.slot(seasonId), JSON.stringify(state), { ex: SLOT_STATE_TTL });
}

/**
 * Set the voting freeze flag for a slot.
 * Prevents new votes during the transition window.
 */
export async function setVotingFrozen(
  seasonId: string,
  slotPos: number
): Promise<void> {
  const r = getRedis();
  await r.set(KEYS.frozen(seasonId, slotPos), '1', { ex: FROZEN_TTL });
}

/**
 * Clear the voting freeze flag for a slot.
 * Called by auto-advance cron after a slot transition completes
 * to prevent stale freeze keys from rejecting votes on the old slot.
 */
export async function clearVotingFrozen(
  seasonId: string,
  slotPos: number
): Promise<void> {
  const r = getRedis();
  await r.del(KEYS.frozen(seasonId, slotPos));
}

/**
 * Check if voting is frozen for a specific slot.
 * Used by the sync vote path to respect the freeze window.
 * Returns false if Redis is unavailable (fail-open for sync path).
 */
export async function isVotingFrozen(
  seasonId: string,
  slotPos: number
): Promise<boolean> {
  try {
    const r = getRedis();
    const val = await r.get(KEYS.frozen(seasonId, slotPos));
    return val === '1' || val === 1;
  } catch {
    // Redis unavailable — fail open for sync path (votes still validated by DB)
    return false;
  }
}

/**
 * Get the daily vote count for a voter.
 */
export async function getDailyVoteCount(
  voterKey: string,
  date: string
): Promise<number> {
  const r = getRedis();
  const count = await r.get(KEYS.daily(date, voterKey));
  return parseInt(String(count ?? '0'), 10) || 0;
}

/**
 * Seed the Redis daily vote counter from the DB count.
 * Called after sync DB path votes to keep Redis in sync
 * when circuit breaker switches between paths (M5 fix).
 */
export async function seedDailyVoteCount(
  voterKey: string,
  date: string,
  dbCount: number
): Promise<void> {
  try {
    const r = getRedis();
    const dailyKey = KEYS.daily(date, voterKey);
    await r.set(dailyKey, dbCount, { ex: DAILY_COUNTER_TTL });
  } catch {
    // Non-fatal: Redis seeding failure doesn't affect the vote
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}
