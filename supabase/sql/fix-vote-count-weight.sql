-- ============================================================================
-- FIX: VOTE COUNT SHOULD ADD WEIGHT (NOT JUST 1)
-- Mega vote adds 10, Super vote adds 3, Standard vote adds 1
-- ============================================================================

-- 1. Update the trigger function to add vote_weight to vote_count
CREATE OR REPLACE FUNCTION update_clip_vote_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Atomically increment vote_count and weighted_score by vote_weight
  -- Mega vote = 10, Super vote = 3, Standard vote = 1
  UPDATE tournament_clips
  SET
    vote_count = COALESCE(vote_count, 0) + COALESCE(NEW.vote_weight, 1),
    weighted_score = COALESCE(weighted_score, 0) + COALESCE(NEW.vote_weight, 1)
  WHERE id = NEW.clip_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger itself doesn't need to be recreated, just the function
-- The existing trigger (on_vote_insert) will use the updated function

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check trigger function exists and has been updated
SELECT
  routine_name,
  routine_definition
FROM information_schema.routines
WHERE routine_name = 'update_clip_vote_count';
