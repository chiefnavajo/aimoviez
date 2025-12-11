-- ============================================================================
-- FIX VOTE INSERT RACE CONDITION
-- This migration adds an atomic upsert RPC function for voting
-- that handles the race condition between check-then-insert
-- ============================================================================

-- RPC FUNCTION: Atomic vote insert with proper handling
-- Uses INSERT ... ON CONFLICT to atomically handle duplicates
-- Returns the vote details including whether it was a new vote or existing
CREATE OR REPLACE FUNCTION insert_vote_atomic(
  p_clip_id UUID,
  p_voter_key TEXT,
  p_user_id UUID DEFAULT NULL,
  p_vote_weight INTEGER DEFAULT 1,
  p_vote_type TEXT DEFAULT 'standard',
  p_slot_position INTEGER DEFAULT 1,
  p_flagged BOOLEAN DEFAULT FALSE,
  p_multi_vote_mode BOOLEAN DEFAULT FALSE,
  p_is_power_vote BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  vote_id UUID,
  was_new_vote BOOLEAN,
  final_vote_weight INTEGER,
  new_vote_count INTEGER,
  new_weighted_score INTEGER,
  error_code TEXT
) AS $$
DECLARE
  v_vote_id UUID;
  v_existing_weight INTEGER;
  v_new_weight INTEGER;
  v_was_new BOOLEAN := TRUE;
  v_new_vote_count INTEGER;
  v_new_weighted_score INTEGER;
BEGIN
  -- For multi-vote mode or power votes, we may need to update existing vote
  IF p_multi_vote_mode OR p_is_power_vote THEN
    -- Check if vote exists
    SELECT v.id, v.vote_weight INTO v_vote_id, v_existing_weight
    FROM votes v
    WHERE v.clip_id = p_clip_id AND v.voter_key = p_voter_key
    FOR UPDATE;  -- Lock the row to prevent concurrent updates

    IF v_vote_id IS NOT NULL THEN
      -- Update existing vote (add weight for power votes)
      v_new_weight := COALESCE(v_existing_weight, 0) + p_vote_weight;
      v_was_new := FALSE;

      UPDATE votes
      SET vote_weight = v_new_weight,
          vote_type = p_vote_type,
          created_at = NOW()
      WHERE id = v_vote_id;

      -- Update clip counts manually since trigger only fires on INSERT
      UPDATE tournament_clips
      SET vote_count = COALESCE(vote_count, 0) + p_vote_weight,
          weighted_score = COALESCE(weighted_score, 0) + p_vote_weight
      WHERE id = p_clip_id;

      -- Get updated stats
      SELECT tc.vote_count, tc.weighted_score
      INTO v_new_vote_count, v_new_weighted_score
      FROM tournament_clips tc WHERE tc.id = p_clip_id;

      RETURN QUERY SELECT
        v_vote_id,
        v_was_new,
        v_new_weight,
        COALESCE(v_new_vote_count, 0),
        COALESCE(v_new_weighted_score, 0),
        NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Try to insert new vote
  -- If unique constraint fails, return error code
  BEGIN
    INSERT INTO votes (clip_id, voter_key, user_id, vote_weight, vote_type, slot_position, flagged, created_at)
    VALUES (p_clip_id, p_voter_key, p_user_id, p_vote_weight, p_vote_type, p_slot_position, p_flagged, NOW())
    RETURNING id INTO v_vote_id;

    v_was_new := TRUE;
    v_new_weight := p_vote_weight;

    -- The on_vote_insert trigger will update the clip counts
    -- Get the updated stats
    SELECT tc.vote_count, tc.weighted_score
    INTO v_new_vote_count, v_new_weighted_score
    FROM tournament_clips tc WHERE tc.id = p_clip_id;

    RETURN QUERY SELECT
      v_vote_id,
      v_was_new,
      v_new_weight,
      COALESCE(v_new_vote_count, 0),
      COALESCE(v_new_weighted_score, 0),
      NULL::TEXT;

  EXCEPTION
    WHEN unique_violation THEN
      -- Already voted - return error
      RETURN QUERY SELECT
        NULL::UUID,
        FALSE,
        0,
        0,
        0,
        'ALREADY_VOTED'::TEXT;
  END;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Add unique constraint if not exists
-- This is the primary defense against duplicate votes
-- ============================================================================

-- Check if constraint exists first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'votes_clip_voter_unique'
  ) THEN
    ALTER TABLE votes
    ADD CONSTRAINT votes_clip_voter_unique
    UNIQUE (clip_id, voter_key);
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check function was created
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'insert_vote_atomic';

-- Check constraint exists
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'votes' AND constraint_type = 'UNIQUE';
