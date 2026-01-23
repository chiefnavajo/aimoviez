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
-- UPDATE RPC FUNCTION TO HANDLE NEW CONSTRAINTS
-- ============================================================================

-- Update insert_vote_atomic to catch special vote constraint violations
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
  v_constraint_name TEXT;
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
  -- Handle various unique constraint violations
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
      -- Identify which constraint was violated
      GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;

      -- Check for special vote limit constraints
      IF v_constraint_name = 'idx_votes_one_super_per_slot' THEN
        RETURN QUERY SELECT
          NULL::UUID,
          FALSE,
          0,
          0,
          0,
          'SUPER_LIMIT_EXCEEDED'::TEXT;
      ELSIF v_constraint_name = 'idx_votes_one_mega_per_slot' THEN
        RETURN QUERY SELECT
          NULL::UUID,
          FALSE,
          0,
          0,
          0,
          'MEGA_LIMIT_EXCEEDED'::TEXT;
      ELSE
        -- Default: already voted on this clip
        RETURN QUERY SELECT
          NULL::UUID,
          FALSE,
          0,
          0,
          0,
          'ALREADY_VOTED'::TEXT;
      END IF;
  END;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Check indexes were created:
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'votes'
  AND indexname IN ('idx_votes_one_super_per_slot', 'idx_votes_one_mega_per_slot');

-- Check RPC function was updated:
SELECT routine_name, last_altered
FROM information_schema.routines
WHERE routine_name = 'insert_vote_atomic';

-- ============================================================================
-- NOTE FOR API CODE
-- ============================================================================
-- The RPC function now returns these error codes:
-- - 'ALREADY_VOTED': User already voted on this specific clip
-- - 'SUPER_LIMIT_EXCEEDED': User already used super vote in this slot
-- - 'MEGA_LIMIT_EXCEEDED': User already used mega vote in this slot
-- ============================================================================
