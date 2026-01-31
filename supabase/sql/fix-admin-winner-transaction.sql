-- ============================================================================
-- ATOMIC ADMIN WINNER ASSIGNMENT
-- This RPC function performs all winner assignment operations in a single transaction
-- Prevents inconsistent state if any step fails
-- ============================================================================

CREATE OR REPLACE FUNCTION assign_winner_atomic(
  p_clip_id UUID,
  p_slot_id UUID,
  p_season_id UUID,
  p_next_slot_position INTEGER,
  p_voting_duration_hours INTEGER DEFAULT 24,
  p_advance_slot BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  winner_clip_id UUID,
  slot_locked INTEGER,
  next_slot_position INTEGER,
  clips_moved INTEGER,
  season_finished BOOLEAN
) AS $$
DECLARE
  v_current_slot_position INTEGER;
  v_total_slots INTEGER;
  v_clips_moved INTEGER := 0;
  v_season_finished BOOLEAN := FALSE;
  v_now TIMESTAMP := NOW();
  v_voting_ends_at TIMESTAMP;
BEGIN
  -- Get current slot position
  SELECT slot_position INTO v_current_slot_position
  FROM story_slots
  WHERE id = p_slot_id;

  -- Get total slots from season
  SELECT total_slots INTO v_total_slots
  FROM seasons
  WHERE id = p_season_id;

  -- 1. Lock the current slot with the selected winner
  UPDATE story_slots
  SET
    status = 'locked',
    winner_tournament_clip_id = p_clip_id
  WHERE id = p_slot_id;

  -- 2. Mark the winning clip as 'locked'
  UPDATE tournament_clips
  SET status = 'locked'
  WHERE id = p_clip_id;

  -- 3. Handle slot advancement
  IF p_advance_slot THEN
    IF p_next_slot_position > COALESCE(v_total_slots, 75) THEN
      -- Season is finished
      UPDATE seasons
      SET status = 'finished'
      WHERE id = p_season_id;

      v_season_finished := TRUE;
    ELSE
      -- Move non-winning clips to next slot FIRST (before activating)
      WITH moved AS (
        UPDATE tournament_clips
        SET
          slot_position = p_next_slot_position,
          vote_count = 0,
          weighted_score = 0,
          hype_score = 0
        WHERE slot_position = v_current_slot_position
          AND season_id = p_season_id
          AND status = 'active'
          AND id != p_clip_id
        RETURNING id
      )
      SELECT COUNT(*) INTO v_clips_moved FROM moved;

      -- Safeguard: verify clips actually exist in next slot before activating
      IF (SELECT COUNT(*) FROM tournament_clips
          WHERE slot_position = p_next_slot_position
            AND season_id = p_season_id
            AND status = 'active') > 0 THEN
        -- Clips exist — activate next slot for voting
        v_voting_ends_at := v_now + (p_voting_duration_hours || ' hours')::INTERVAL;

        UPDATE story_slots
        SET
          status = 'voting',
          voting_started_at = v_now,
          voting_ends_at = v_voting_ends_at,
          voting_duration_hours = p_voting_duration_hours
        WHERE season_id = p_season_id
          AND slot_position = p_next_slot_position;
      ELSE
        -- No clips — set to waiting_for_clips instead of voting
        UPDATE story_slots
        SET
          status = 'waiting_for_clips',
          voting_started_at = NULL,
          voting_ends_at = NULL
        WHERE season_id = p_season_id
          AND slot_position = p_next_slot_position;
      END IF;
    END IF;
  END IF;

  -- Return result
  RETURN QUERY SELECT
    TRUE,
    'Winner assigned successfully'::TEXT,
    p_clip_id,
    v_current_slot_position,
    CASE WHEN v_season_finished THEN NULL ELSE p_next_slot_position END,
    v_clips_moved,
    v_season_finished;

EXCEPTION WHEN OTHERS THEN
  -- On any error, the transaction is rolled back automatically
  RETURN QUERY SELECT
    FALSE,
    ('Error: ' || SQLERRM)::TEXT,
    NULL::UUID,
    NULL::INTEGER,
    NULL::INTEGER,
    0,
    FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name = 'assign_winner_atomic';
