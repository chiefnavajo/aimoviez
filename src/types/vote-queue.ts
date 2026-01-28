// types/vote-queue.ts
// ============================================================================
// ASYNC VOTE PROCESSING TYPES
// Type definitions for the Redis-backed vote queue pipeline (Phase 1)
// ============================================================================

// =========================
// QUEUE EVENT TYPES
// =========================

/** Vote event pushed to the Redis queue for async processing */
export interface VoteQueueEvent {
  /** Unique vote identifier (from the votes table) */
  voteId: string;
  /** The clip being voted on */
  clipId: string;
  /** Voter identifier (hashed device key or user_<id>) */
  voterKey: string;
  /** Vote direction: 'up' for casting a vote, 'down' for revoking */
  direction: 'up' | 'down';
  /** Unix timestamp (ms) when the event was created */
  timestamp: number;
  /** Optional session identifier for tracing */
  sessionId?: string;
  /** Arbitrary metadata for analytics or debugging */
  metadata?: Record<string, unknown>;
}

// =========================
// DEAD LETTER QUEUE
// =========================

/** Entry in the dead letter queue for failed vote processing */
export interface DeadLetterEntry {
  /** The original vote event that failed */
  event: VoteQueueEvent;
  /** Human-readable error description */
  error: string;
  /** Number of processing attempts */
  attempts: number;
  /** Unix timestamp (ms) of the first failure */
  firstFailedAt: number;
  /** Unix timestamp (ms) of the most recent failure */
  lastFailedAt: number;
}

// =========================
// COUNTER SYNC TYPES
// =========================

/** A single item in a counter sync batch (Redis -> PostgreSQL) */
export interface CounterSyncItem {
  /** The clip whose counters are being synced */
  clipId: string;
  /** Absolute vote count to SET in PostgreSQL */
  voteCount: number;
  /** Absolute weighted score to SET in PostgreSQL */
  weightedScore: number;
  /** Unix timestamp (ms) when this sync was performed */
  syncedAt: number;
}

// =========================
// QUEUE HEALTH & MONITORING
// =========================

/** Health statistics for the vote processing queue */
export interface VoteQueueHealth {
  /** Number of events waiting to be processed */
  pendingCount: number;
  /** Number of events currently being processed */
  processingCount: number;
  /** Number of events in the dead letter queue */
  deadLetterCount: number;
  /** Unix timestamp (ms) of the last successfully processed event, or null if none */
  lastProcessedAt: number | null;
  /** Average processing time in milliseconds */
  avgProcessingTimeMs: number;
}

// =========================
// CIRCUIT BREAKER STATE
// =========================

/** Circuit breaker states for the vote pipeline */
export type CircuitState = 'closed' | 'open' | 'half-open';

// =========================
// FEATURE FLAG CONFIG
// =========================

/** Configuration for the async voting feature flag */
export interface AsyncVotingConfig {
  /** Whether async vote processing is enabled */
  enabled: boolean;
  /** Number of clips per counter sync batch */
  batchSize: number;
  /** Interval (ms) between counter sync runs */
  syncIntervalMs: number;
  /** Maximum retry attempts before dead-lettering */
  maxRetries: number;
  /** Dead letter count threshold before overflow to PostgreSQL */
  deadLetterOverflowThreshold: number;
}

/** Default configuration for async voting (used when flag is enabled without custom config) */
export const DEFAULT_ASYNC_VOTING_CONFIG: AsyncVotingConfig = {
  enabled: false,
  batchSize: 100,
  syncIntervalMs: 30000,
  maxRetries: 5,
  deadLetterOverflowThreshold: 1000,
};
