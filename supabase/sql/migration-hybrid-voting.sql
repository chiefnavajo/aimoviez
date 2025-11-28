-- ============================================
-- HYBRID VOTING SYSTEM MIGRATION
-- AiMoviez · 8SEC MADNESS
-- ============================================
-- Rules:
--   1. One vote per clip per user (no multi-voting on same clip)
--   2. Can vote on multiple clips in same round
--   3. Daily limit of 200 votes across all rounds
--   4. Super vote (3x): 1 per slot/round
--   5. Mega vote (10x): 1 per slot/round
-- ============================================

-- 1. Add slot_position to votes table for tracking votes per round
ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS slot_position integer;

-- 2. Add vote_type column to track standard/super/mega
ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS vote_type text DEFAULT 'standard';

-- 3. Create unique constraint: one vote per user per clip
-- This prevents dumping all 200 votes on one clip
ALTER TABLE votes
  DROP CONSTRAINT IF EXISTS votes_unique_voter_clip;

ALTER TABLE votes
  ADD CONSTRAINT votes_unique_voter_clip 
  UNIQUE (voter_key, clip_id);

-- 4. Create index for fast lookup of user's votes in current slot
CREATE INDEX IF NOT EXISTS idx_votes_voter_slot 
  ON votes(voter_key, slot_position);

-- 5. Create index for checking super/mega vote usage per slot
CREATE INDEX IF NOT EXISTS idx_votes_voter_slot_type 
  ON votes(voter_key, slot_position, vote_type);

-- 6. Create index for daily vote counting (by created_at date)
CREATE INDEX IF NOT EXISTS idx_votes_voter_created 
  ON votes(voter_key, created_at);

-- ============================================
-- VERIFICATION QUERIES (run manually to check)
-- ============================================
-- Check constraint exists:
-- SELECT conname FROM pg_constraint WHERE conname = 'votes_unique_voter_clip';

-- Check indexes:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'votes';
