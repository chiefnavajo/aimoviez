// lib/counter-sync.ts
// ============================================================================
// COUNTER SYNC UTILITY
// Force-syncs CRDT counters from Redis to PostgreSQL.
// Used by sync-vote-counters cron and auto-advance (pre-winner sync).
// ============================================================================

import { SupabaseClient } from '@supabase/supabase-js';
import { getCountsForClips } from '@/lib/crdt-vote-counter';

// ============================================================================
// TYPES
// ============================================================================

export interface SyncResult {
  synced: number;
  errors: Array<{ clip_id: string; error: string }>;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Force-sync CRDT counters for the given clips to PostgreSQL.
 * Reads the current CRDT state and calls batch_update_vote_counts RPC
 * to set absolute values (idempotent — safe to re-run).
 */
export async function forceSyncCounters(
  supabase: SupabaseClient,
  clipIds: string[]
): Promise<SyncResult> {
  if (clipIds.length === 0) {
    return { synced: 0, errors: [] };
  }

  // Read all CRDT counters in a single pipeline
  const counters = await getCountsForClips(clipIds);

  // Build batch update payload
  const updates = Array.from(counters.entries()).map(([clipId, counts]) => ({
    clip_id: clipId,
    vote_count: counts.voteCount,
    weighted_score: counts.weightedScore,
  }));

  if (updates.length === 0) {
    return { synced: 0, errors: [] };
  }

  // Call the Phase 0 batch update RPC
  const { data: result, error } = await supabase.rpc('batch_update_vote_counts', {
    p_updates: updates,
  });

  if (error) {
    console.error('[forceSyncCounters] RPC error:', error);
    return {
      synced: 0,
      errors: [{ clip_id: 'batch', error: error.message }],
    };
  }

  const rpcResult = result as { updated_count: number; errors: Array<{ clip_id: string; error: string }> } | null;

  return {
    synced: rpcResult?.updated_count ?? updates.length,
    errors: rpcResult?.errors ?? [],
  };
}
