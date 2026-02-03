-- ============================================================================
-- SLOT REORGANIZATION RPC FUNCTIONS
-- Atomic operations for deleting/shifting and swapping slots
-- These functions run in a single transaction - all-or-nothing
-- ============================================================================

-- Delete slots and shift remaining down (atomic)
CREATE OR REPLACE FUNCTION reorganize_slots_delete_and_shift(
  p_season_id UUID,
  p_positions_to_delete INTEGER[]
) RETURNS JSON AS $$
DECLARE
  v_sorted_positions INTEGER[];
  v_offset INTEGER := 10000;
  v_deleted_slots INTEGER;
  v_deleted_clips INTEGER;
BEGIN
  -- Sort positions for consistent processing
  SELECT ARRAY_AGG(p ORDER BY p) INTO v_sorted_positions FROM unnest(p_positions_to_delete) p;

  -- Check for voting slots - cannot delete slots in voting status
  IF EXISTS (
    SELECT 1 FROM story_slots
    WHERE season_id = p_season_id
      AND slot_position = ANY(v_sorted_positions)
      AND status = 'voting'
  ) THEN
    RAISE EXCEPTION 'Cannot delete slots in voting status';
  END IF;

  -- Step 1: Add offset to all slots to avoid unique constraint violations
  UPDATE story_slots SET slot_position = slot_position + v_offset WHERE season_id = p_season_id;
  UPDATE tournament_clips SET slot_position = slot_position + v_offset WHERE season_id = p_season_id;

  -- Step 2: Delete target slots and clips (now at offset positions)
  DELETE FROM tournament_clips
  WHERE season_id = p_season_id
    AND slot_position = ANY(SELECT p + v_offset FROM unnest(v_sorted_positions) p);
  GET DIAGNOSTICS v_deleted_clips = ROW_COUNT;

  DELETE FROM story_slots
  WHERE season_id = p_season_id
    AND slot_position = ANY(SELECT p + v_offset FROM unnest(v_sorted_positions) p);
  GET DIAGNOSTICS v_deleted_slots = ROW_COUNT;

  -- Step 3: Calculate and apply new positions for remaining slots
  -- For each slot, subtract (offset + count of deleted positions below it)
  UPDATE story_slots ss
  SET slot_position = (ss.slot_position - v_offset) - (
    SELECT COUNT(*) FROM unnest(v_sorted_positions) dp WHERE dp < (ss.slot_position - v_offset)
  )
  WHERE ss.season_id = p_season_id;

  -- Step 4: Same for clips
  UPDATE tournament_clips tc
  SET slot_position = (tc.slot_position - v_offset) - (
    SELECT COUNT(*) FROM unnest(v_sorted_positions) dp WHERE dp < (tc.slot_position - v_offset)
  )
  WHERE tc.season_id = p_season_id;

  RETURN json_build_object(
    'success', true,
    'deleted_slots', v_deleted_slots,
    'deleted_clips', v_deleted_clips,
    'positions_deleted', v_sorted_positions,
    'shift_amount', array_length(v_sorted_positions, 1)
  );
END;
$$ LANGUAGE plpgsql;


-- Swap two slot positions (atomic)
CREATE OR REPLACE FUNCTION reorganize_slots_swap(
  p_season_id UUID,
  p_position_a INTEGER,
  p_position_b INTEGER
) RETURNS JSON AS $$
DECLARE
  v_slot_a_id UUID;
  v_slot_b_id UUID;
  v_slot_a_status TEXT;
  v_slot_b_status TEXT;
  v_temp_position INTEGER := 99999;
BEGIN
  -- Get slot IDs and validate they exist
  SELECT id, status INTO v_slot_a_id, v_slot_a_status
  FROM story_slots WHERE season_id = p_season_id AND slot_position = p_position_a;

  SELECT id, status INTO v_slot_b_id, v_slot_b_status
  FROM story_slots WHERE season_id = p_season_id AND slot_position = p_position_b;

  IF v_slot_a_id IS NULL OR v_slot_b_id IS NULL THEN
    RAISE EXCEPTION 'One or both slots not found';
  END IF;

  -- Check voting status - cannot swap slots in voting status
  IF v_slot_a_status = 'voting' OR v_slot_b_status = 'voting' THEN
    RAISE EXCEPTION 'Cannot swap slots in voting status';
  END IF;

  -- Swap slots using temp position to avoid constraint violations
  UPDATE story_slots SET slot_position = v_temp_position WHERE id = v_slot_a_id;
  UPDATE story_slots SET slot_position = p_position_a WHERE id = v_slot_b_id;
  UPDATE story_slots SET slot_position = p_position_b WHERE id = v_slot_a_id;

  -- Swap clips using same temp position approach
  UPDATE tournament_clips SET slot_position = v_temp_position
  WHERE season_id = p_season_id AND slot_position = p_position_a;

  UPDATE tournament_clips SET slot_position = p_position_a
  WHERE season_id = p_season_id AND slot_position = p_position_b;

  UPDATE tournament_clips SET slot_position = p_position_b
  WHERE season_id = p_season_id AND slot_position = v_temp_position;

  RETURN json_build_object(
    'success', true,
    'swapped', ARRAY[p_position_a, p_position_b],
    'slot_a_status', v_slot_a_status,
    'slot_b_status', v_slot_b_status
  );
END;
$$ LANGUAGE plpgsql;
