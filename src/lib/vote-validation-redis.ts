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
 * Record a vote in Redis: dedup marker, daily counter, queue event, active clips set.
 * All operations in a single pipeline (~2ms).
 */
export async function recordVote(
  voterKey: string,
  clipId: string,
  event: VoteQueueEvent,
  date: string
): Promise<void> {
  const r = getRedis();
  const pipeline = r.pipeline();

  // Dedup marker (7-day TTL)
  pipeline.set(KEYS.voted(voterKey, clipId), '1', { ex: DEDUP_TTL });

  // Daily counter (48-hour TTL)
  const dailyKey = KEYS.daily(date, voterKey);
  pipeline.incr(dailyKey);
  pipeline.expire(dailyKey, DAILY_COUNTER_TTL);

  // Queue event for async PostgreSQL persistence
  pipeline.lpush('vote_queue', JSON.stringify(event));

  // Track clip as having recent votes (for counter sync)
  pipeline.sadd(KEYS.activeClips(), clipId);

  await pipeline.exec();
}

/**
 * Remove a vote record from Redis (for unvote).
 */
export async function removeVoteRecord(
  voterKey: string,
  clipId: string,
  date: string
): Promise<void> {
  const r = getRedis();
  const pipeline = r.pipeline();

  pipeline.del(KEYS.voted(voterKey, clipId));
  pipeline.decr(KEYS.daily(date, voterKey));

  await pipeline.exec();
}

// ============================================================================
// SLOT STATE MANAGEMENT (used by auto-advance cron)
// ============================================================================

/**
 * Update the slot state in Redis.
 * Called by auto-advance cron when a slot transitions.
 */
export async function setSlotState(
  seasonId: string,
  state: SlotState
): Promise<void> {
  const r = getRedis();
  await r.set(KEYS.slot(seasonId), JSON.stringify(state));
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

// ============================================================================
// HELPERS
// ============================================================================

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}
