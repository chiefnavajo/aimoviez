-- ============================================================================
-- FIX VOTE DELETE RACE CONDITION
-- This migration adds:
-- 1. A trigger for atomic vote count decrement on DELETE
-- 2. An RPC function for safe vote deletion with verification
-- ============================================================================

-- 1. Create trigger function for vote deletion
CREATE OR REPLACE FUNCTION update_clip_vote_count_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Atomically decrement vote_count and weighted_score
  -- Use GREATEST to prevent negative values
  UPDATE tournament_clips
  SET
    vote_count = GREATEST(0, COALESCE(vote_count, 0) - 1),
    weighted_score = GREATEST(0, COALESCE(weighted_score, 0) - COALESCE(OLD.vote_weight, 1))
  WHERE id = OLD.clip_id;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 2. Drop existing trigger if it exists (safe to re-run)
DROP TRIGGER IF EXISTS on_vote_delete ON votes;

-- 3. Create the trigger for DELETE
CREATE TRIGGER on_vote_delete
AFTER DELETE ON votes
FOR EACH ROW
EXECUTE FUNCTION update_clip_vote_count_on_delete();

-- ============================================================================
-- RPC FUNCTION: Atomic vote deletion with verification
-- Returns the deleted vote details or null if not found/not owned
-- This prevents race conditions by doing everything in one transaction
-- ============================================================================

CREATE OR REPLACE FUNCTION delete_vote_atomic(
  p_voter_key TEXT,
  p_clip_id UUID
)
RETURNS TABLE (
  vote_id UUID,
  vote_type TEXT,
  vote_weight INTEGER,
  slot_position INTEGER,
  new_vote_count INTEGER,
  new_weighted_score INTEGER
) AS $$
DECLARE
  v_vote_id UUID;
  v_vote_type TEXT;
  v_vote_weight INTEGER;
  v_slot_position INTEGER;
  v_new_vote_count INTEGER;
  v_new_weighted_score INTEGER;
BEGIN
  -- Lock the vote row and verify ownership in one step
  -- This prevents TOCTOU race conditions
  SELECT v.id, v.vote_type, v.vote_weight, v.slot_position
  INTO v_vote_id, v_vote_type, v_vote_weight, v_slot_position
  FROM votes v
  WHERE v.voter_key = p_voter_key
    AND v.clip_id = p_clip_id
  FOR UPDATE;  -- Lock the row

  -- If no vote found, return empty result
  IF v_vote_id IS NULL THEN
    RETURN;
  END IF;

  -- Delete the vote (this will trigger update_clip_vote_count_on_delete)
  DELETE FROM votes WHERE id = v_vote_id;

  -- Get the updated clip stats
  SELECT tc.vote_count, tc.weighted_score
  INTO v_new_vote_count, v_new_weighted_score
  FROM tournament_clips tc
  WHERE tc.id = p_clip_id;

  -- Return the result
  RETURN QUERY SELECT
    v_vote_id,
    v_vote_type,
    v_vote_weight,
    v_slot_position,
    COALESCE(v_new_vote_count, 0),
    COALESCE(v_new_weighted_score, 0);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check trigger was created
SELECT
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE trigger_name = 'on_vote_delete';

-- Check function was created
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name = 'delete_vote_atomic';
