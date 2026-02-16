-- ============================================================================
-- FIX SPECIAL VOTE RACE CONDITION
-- Prevents users from casting multiple super/mega votes in the same slot
-- by adding partial unique indexes at the database level
-- ============================================================================

-- 1. Create partial unique index for super votes
-- This ensures only ONE super vote per voter per slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_one_super_per_slot
  ON votes (voter_key, slot_position)
  WHERE vote_type = 'super';

-- 2. Create partial unique index for mega votes
-- This ensures only ONE mega vote per voter per slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_one_mega_per_slot
  ON votes (voter_key, slot_position)
  WHERE vote_type = 'mega';

-- ============================================================================
-- NOTE: The insert_vote_atomic function is defined in fix-7-security-vulnerabilities.sql
-- (the canonical version with TEXT params, self-vote prevention, constraint-aware errors).
-- This file only creates the partial unique indexes.
-- ============================================================================

-- Verify indexes were created:
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'votes'
  AND indexname IN ('idx_votes_one_super_per_slot', 'idx_votes_one_mega_per_slot');
