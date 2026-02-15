-- =============================================================================
-- FIX: Add FOR UPDATE row lock to assign_winner_atomic
-- Prevents race condition when admin + cron attempt concurrent winner assignment
-- =============================================================================

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
  v_current_status TEXT;
  v_total_slots INTEGER;
  v_clips_eliminated INTEGER := 0;
  v_season_finished BOOLEAN := FALSE;
  v_now TIMESTAMP := NOW();
  v_voting_ends_at TIMESTAMP;
BEGIN
  -- Lock the slot row to prevent concurrent winner assignment (FOR UPDATE)
  SELECT slot_position, status INTO v_current_slot_position, v_current_status
  FROM story_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  -- Verify slot is still in voting state (race guard)
  IF v_current_status != 'voting' THEN
    RETURN QUERY SELECT
      FALSE,
      ('Slot is no longer in voting state (current: ' || COALESCE(v_current_status, 'unknown') || ')')::TEXT,
      NULL::UUID, NULL::INTEGER, NULL::INTEGER, 0, FALSE;
    RETURN;
  END IF;

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
    -- Eliminate losing clips — they don't carry forward
    WITH eliminated AS (
      UPDATE tournament_clips
      SET
        status = 'eliminated',
        eliminated_at = v_now,
        elimination_reason = 'lost'
      WHERE slot_position = v_current_slot_position
        AND season_id = p_season_id
        AND status = 'active'
        AND id != p_clip_id
      RETURNING id
    )
    SELECT COUNT(*) INTO v_clips_eliminated FROM eliminated;

    IF p_next_slot_position > COALESCE(v_total_slots, 75) THEN
      -- Season is finished
      UPDATE seasons
      SET status = 'finished'
      WHERE id = p_season_id;

      -- Eliminate any remaining active clips in the season (safety net)
      UPDATE tournament_clips
      SET
        status = 'eliminated',
        eliminated_at = v_now,
        elimination_reason = 'season_ended'
      WHERE season_id = p_season_id
        AND status = 'active';

      v_season_finished := TRUE;
    ELSE
      -- Check if next slot already has clips (from new uploads)
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
        -- No clips — set to waiting_for_clips
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

  -- Return result (clips_moved field now represents clips_eliminated for backward compat)
  RETURN QUERY SELECT
    TRUE,
    'Winner assigned successfully'::TEXT,
    p_clip_id,
    v_current_slot_position,
    CASE WHEN v_season_finished THEN NULL ELSE p_next_slot_position END,
    v_clips_eliminated,
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
