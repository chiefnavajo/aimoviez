-- ============================================================================
-- FIX CRITICAL ISSUES - January 2025
-- ============================================================================
-- This migration addresses:
-- 1. Missing index on clip_views.voter_key (performance)
-- 2. Atomic admin approve function (race condition)
-- ============================================================================

-- ============================================================================
-- 1. ADD MISSING INDEX ON CLIP_VIEWS
-- ============================================================================
-- The clip_views table is queried by voter_key in _getSeenClipIds()
-- Without this index, queries become O(n) as the table grows

CREATE INDEX IF NOT EXISTS idx_clip_views_voter_key
ON clip_views(voter_key);

-- Composite index for looking up specific clips a user has seen
CREATE INDEX IF NOT EXISTS idx_clip_views_voter_clip
ON clip_views(voter_key, clip_id);

-- ============================================================================
-- 2. ATOMIC ADMIN APPROVE FUNCTION
-- ============================================================================
-- This function handles the approve + slot activation atomically
-- to prevent race conditions when multiple admins approve clips

CREATE OR REPLACE FUNCTION admin_approve_clip_atomic(
  p_clip_id UUID,
  p_admin_id UUID DEFAULT NULL
)
RETURNS TABLE (
  success BOOLEAN,
  clip_id UUID,
  assigned_slot INTEGER,
  resumed_voting BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  v_clip RECORD;
  v_active_slot RECORD;
  v_assigned_slot INTEGER;
  v_resumed_voting BOOLEAN := FALSE;
  v_duration_hours INTEGER := 24;
  v_voting_ends_at TIMESTAMPTZ;
BEGIN
  -- Lock and get the clip
  SELECT tc.id, tc.status, tc.season_id, tc.username
  INTO v_clip
  FROM tournament_clips tc
  WHERE tc.id = p_clip_id
  FOR UPDATE;

  IF v_clip IS NULL THEN
    RETURN QUERY SELECT FALSE, p_clip_id, NULL::INTEGER, FALSE, 'Clip not found'::TEXT;
    RETURN;
  END IF;

  -- Find and lock the active slot for this season
  SELECT ss.id, ss.slot_position, ss.status, ss.voting_duration_hours
  INTO v_active_slot
  FROM story_slots ss
  WHERE ss.season_id = v_clip.season_id
    AND ss.status IN ('voting', 'waiting_for_clips')
  ORDER BY ss.slot_position ASC
  LIMIT 1
  FOR UPDATE;

  IF v_active_slot IS NOT NULL THEN
    v_assigned_slot := v_active_slot.slot_position;

    -- If slot is waiting for clips, activate voting
    IF v_active_slot.status = 'waiting_for_clips' THEN
      v_duration_hours := COALESCE(v_active_slot.voting_duration_hours, 24);
      v_voting_ends_at := NOW() + (v_duration_hours || ' hours')::INTERVAL;

      UPDATE story_slots
      SET status = 'voting',
          voting_started_at = NOW(),
          voting_ends_at = v_voting_ends_at,
          voting_duration_hours = v_duration_hours
      WHERE id = v_active_slot.id;

      v_resumed_voting := TRUE;
    END IF;
  END IF;

  -- Update the clip (preserve existing slot_position if no active slot found)
  UPDATE tournament_clips
  SET status = 'active',
      slot_position = COALESCE(v_assigned_slot, slot_position),
      updated_at = NOW()
  WHERE id = p_clip_id;

  RETURN QUERY SELECT
    TRUE,
    p_clip_id,
    v_assigned_slot,
    v_resumed_voting,
    NULL::TEXT;

EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, p_clip_id, NULL::INTEGER, FALSE, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. ANALYZE TABLES
-- ============================================================================

-- Update statistics for the clip_views table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clip_views') THEN
    ANALYZE clip_views;
    RAISE NOTICE 'Analyzed clip_views table';
  ELSE
    RAISE NOTICE 'clip_views table does not exist';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check indexes were created
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'clip_views';

-- Check function was created
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'admin_approve_clip_atomic';

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Critical fixes applied successfully!';
  RAISE NOTICE '  - Added clip_views indexes';
  RAISE NOTICE '  - Created admin_approve_clip_atomic function';
END $$;
