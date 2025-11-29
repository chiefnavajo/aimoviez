-- ============================================================================
-- ATOMIC VOTE COUNTING TRIGGER
-- This trigger automatically updates vote_count and weighted_score
-- when a vote is inserted, preventing race conditions at scale
-- ============================================================================

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION update_clip_vote_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Atomically increment vote_count and weighted_score
  UPDATE tournament_clips
  SET
    vote_count = COALESCE(vote_count, 0) + 1,
    weighted_score = COALESCE(weighted_score, 0) + COALESCE(NEW.vote_weight, 1)
  WHERE id = NEW.clip_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Drop existing trigger if it exists (safe to re-run)
DROP TRIGGER IF EXISTS on_vote_insert ON votes;

-- 3. Create the trigger
CREATE TRIGGER on_vote_insert
AFTER INSERT ON votes
FOR EACH ROW
EXECUTE FUNCTION update_clip_vote_count();

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check trigger was created
SELECT
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_vote_insert';

-- ============================================================================
-- NOTES:
-- After running this migration, you can REMOVE the vote count update
-- from the API code (POST /api/vote) since the trigger handles it.
--
-- However, keeping both won't cause issues - the API update will just
-- be overwritten by the trigger's atomic update.
-- ============================================================================
