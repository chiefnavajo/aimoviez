/* ============================================================================
   DISABLE VOTE TRIGGERS
   ============================================================================
   Run this ONLY after verifying the Redis pipeline works correctly
   for 24-48 hours. These triggers increment vote_count and weighted_score
   on tournament_clips — once Redis CRDT counters + sync cron handle this,
   the triggers become redundant and add unnecessary DB load.

   To re-enable if needed:
     See supabase/sql/migration-vote-trigger.sql for original trigger definition.
   ============================================================================ */

DROP TRIGGER IF EXISTS on_vote_insert ON votes;
DROP TRIGGER IF EXISTS on_vote_delete ON votes;
