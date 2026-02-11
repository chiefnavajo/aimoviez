-- ============================================================================
-- FIX 7 REMAINING SECURITY VULNERABILITIES
-- ============================================================================
-- Fixes:
--   #3  - Restrict is_admin column updates via trigger
--   #4  - Add admin check inside admin_approve_clip_atomic RPC
--   #6  - Fix clips_update_own RLS policy to include user ownership
--   #8  - Block banned users from voting (DB trigger)
--   #9  - Block banned users from commenting (DB trigger)
--   #12 - Prevent self-voting in insert_vote_atomic RPC
--   #14 - Limit comment nesting depth (DB trigger)
-- ============================================================================

-- ============================================================================
-- FIX #3: Restrict is_admin column updates
-- ============================================================================
-- Problem: Service role (used by API) can set is_admin=true on any user.
-- Fix: Trigger that prevents is_admin from being changed unless the
--      calling context explicitly sets a config flag (only admin RPCs do this).
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_unauthorized_admin_promotion()
RETURNS TRIGGER AS $$
BEGIN
  -- Only allow is_admin changes if the session has explicitly opted in
  -- (set by trusted admin RPCs only)
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin THEN
    -- Check for a session-level flag that only admin RPCs set
    IF current_setting('app.allow_admin_change', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Unauthorized: cannot modify is_admin field';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_admin_promotion ON users;
CREATE TRIGGER trg_prevent_admin_promotion
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION prevent_unauthorized_admin_promotion();

-- Also fix the RLS policy to allow users to update their own non-admin fields
DROP POLICY IF EXISTS "users_update_own" ON users;
CREATE POLICY "users_update_own" ON users
  FOR UPDATE
  USING (
    id = auth.uid()
    OR auth.role() = 'service_role'
  );


-- ============================================================================
-- FIX #4: Add admin check inside admin_approve_clip_atomic RPC
-- ============================================================================
-- Problem: Function has no internal admin verification. Any authenticated
--          user can call it directly via PostgREST.
-- Fix: Validate p_admin_id is actually an admin before proceeding.
-- ============================================================================

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
  v_is_admin BOOLEAN;
BEGIN
  -- SECURITY: Verify the caller is an admin
  IF p_admin_id IS NULL THEN
    RETURN QUERY SELECT FALSE, p_clip_id, NULL::INTEGER, FALSE, 'Admin ID is required'::TEXT;
    RETURN;
  END IF;

  SELECT u.is_admin INTO v_is_admin
  FROM users u WHERE u.id = p_admin_id;

  IF v_is_admin IS NOT TRUE THEN
    RETURN QUERY SELECT FALSE, p_clip_id, NULL::INTEGER, FALSE, 'Unauthorized: caller is not an admin'::TEXT;
    RETURN;
  END IF;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke direct access from anon/authenticated — only service_role should call
REVOKE EXECUTE ON FUNCTION admin_approve_clip_atomic(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION admin_approve_clip_atomic(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_approve_clip_atomic(UUID, UUID) TO service_role;


-- ============================================================================
-- FIX #6: Fix clips_update_own RLS policy
-- ============================================================================
-- Problem: Policy only checks service_role, missing user_id = auth.uid().
-- Fix: Allow users to update their own clips OR service_role for admin ops.
-- ============================================================================

DROP POLICY IF EXISTS "clips_update_own" ON tournament_clips;
CREATE POLICY "clips_update_own" ON tournament_clips
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR auth.role() = 'service_role'
  );


-- ============================================================================
-- FIX #8: Block banned users from voting
-- ============================================================================
-- Problem: Banned users can still insert votes at DB level.
-- Fix: Trigger on votes table that checks the user's ban status.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_voter_not_banned()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_is_banned BOOLEAN;
BEGIN
  -- Extract user_id from voter_key (format: "user_<uuid>")
  IF NEW.voter_key LIKE 'user_%' THEN
    v_user_id := substring(NEW.voter_key FROM 6)::UUID;

    SELECT u.is_banned INTO v_is_banned
    FROM users u WHERE u.id = v_user_id;

    IF v_is_banned IS TRUE THEN
      RAISE EXCEPTION 'Banned users cannot vote';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_voter_not_banned ON votes;
CREATE TRIGGER trg_check_voter_not_banned
  BEFORE INSERT ON votes
  FOR EACH ROW
  EXECUTE FUNCTION check_voter_not_banned();


-- ============================================================================
-- FIX #9: Block banned users from commenting
-- ============================================================================
-- Problem: Banned users can still insert comments at DB level.
-- Fix: Trigger on comments table that checks the user's ban status.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_commenter_not_banned()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_is_banned BOOLEAN;
BEGIN
  -- Extract user_id from user_key (format: "user_<uuid>")
  IF NEW.user_key LIKE 'user_%' THEN
    v_user_id := substring(NEW.user_key FROM 6)::UUID;

    SELECT u.is_banned INTO v_is_banned
    FROM users u WHERE u.id = v_user_id;

    IF v_is_banned IS TRUE THEN
      RAISE EXCEPTION 'Banned users cannot comment';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_commenter_not_banned ON comments;
CREATE TRIGGER trg_check_commenter_not_banned
  BEFORE INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION check_commenter_not_banned();


-- ============================================================================
-- FIX #12: Prevent self-voting in insert_vote_atomic
-- ============================================================================
-- Problem: Users can vote on their own clips. No check at any level.
-- Fix: Add self-vote check inside insert_vote_atomic RPC function.
-- ============================================================================

-- Drop existing function versions
DROP FUNCTION IF EXISTS insert_vote_atomic(TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION insert_vote_atomic(
  p_clip_id TEXT,
  p_voter_key TEXT,
  p_user_id TEXT DEFAULT NULL,
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
)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clip_uuid UUID := p_clip_id::UUID;
  v_user_uuid UUID := CASE WHEN p_user_id IS NOT NULL AND p_user_id != '' THEN p_user_id::UUID ELSE NULL END;
  v_vote_id UUID;
  v_existing_weight INTEGER;
  v_new_weight INTEGER;
  v_was_new BOOLEAN := TRUE;
  v_new_vote_count INTEGER;
  v_new_weighted_score INTEGER;
  v_clip_owner_id UUID;
BEGIN
  -- SECURITY FIX #12: Prevent self-voting
  IF v_user_uuid IS NOT NULL THEN
    SELECT tc.user_id INTO v_clip_owner_id
    FROM tournament_clips tc WHERE tc.id = v_clip_uuid;

    IF v_clip_owner_id IS NOT NULL AND v_clip_owner_id = v_user_uuid THEN
      RETURN QUERY SELECT NULL::UUID, FALSE, 0, 0, 0, 'SELF_VOTE_NOT_ALLOWED'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- For multi-vote mode or power votes, we may need to update existing vote
  IF p_multi_vote_mode OR p_is_power_vote THEN
    -- Check if vote exists
    SELECT v.id, v.vote_weight INTO v_vote_id, v_existing_weight
    FROM votes v
    WHERE v.clip_id = v_clip_uuid AND v.voter_key = p_voter_key
    FOR UPDATE;

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
      WHERE id = v_clip_uuid;

      -- Get updated stats
      SELECT tc.vote_count, tc.weighted_score
      INTO v_new_vote_count, v_new_weighted_score
      FROM tournament_clips tc WHERE tc.id = v_clip_uuid;

      RETURN QUERY SELECT
        v_vote_id,
        v_was_new,
        v_new_weight,
        COALESCE(v_new_vote_count, 0),
        COALESCE(v_new_weighted_score, 0)::INTEGER,
        NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Try to insert new vote
  -- If unique constraint fails, return error code
  BEGIN
    INSERT INTO votes (clip_id, voter_key, user_id, vote_weight, vote_type, slot_position, flagged, created_at)
    VALUES (v_clip_uuid, p_voter_key, v_user_uuid, p_vote_weight, p_vote_type, p_slot_position, p_flagged, NOW())
    RETURNING id INTO v_vote_id;

    v_was_new := TRUE;
    v_new_weight := p_vote_weight;

    -- H13: Always update clip counts directly (do not rely on triggers which may be disabled)
    UPDATE tournament_clips
    SET vote_count = COALESCE(vote_count, 0) + p_vote_weight,
        weighted_score = COALESCE(weighted_score, 0) + p_vote_weight
    WHERE id = v_clip_uuid;

    -- Get the updated stats
    SELECT tc.vote_count, tc.weighted_score
    INTO v_new_vote_count, v_new_weighted_score
    FROM tournament_clips tc WHERE tc.id = v_clip_uuid;

    RETURN QUERY SELECT
      v_vote_id,
      v_was_new,
      v_new_weight,
      COALESCE(v_new_vote_count, 0),
      COALESCE(v_new_weighted_score, 0)::INTEGER,
      NULL::TEXT;

  EXCEPTION
    WHEN unique_violation THEN
      -- Already voted - return error (only happens if multi_vote_mode is FALSE)
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION insert_vote_atomic(TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION insert_vote_atomic(TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN) TO anon;


-- ============================================================================
-- FIX #14: Limit comment nesting depth
-- ============================================================================
-- Problem: Comments can be nested 50+ levels deep, causing perf issues.
-- Fix: Trigger that enforces a maximum nesting depth of 5 levels.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_comment_nesting_depth()
RETURNS TRIGGER AS $$
DECLARE
  v_depth INTEGER := 0;
  v_current_parent UUID := NEW.parent_comment_id;
BEGIN
  -- No parent = top-level comment, always OK
  IF v_current_parent IS NULL THEN
    RETURN NEW;
  END IF;

  -- Walk up the parent chain to count depth
  WHILE v_current_parent IS NOT NULL AND v_depth < 6 LOOP
    v_depth := v_depth + 1;

    SELECT c.parent_comment_id INTO v_current_parent
    FROM comments c WHERE c.id = v_current_parent;
  END LOOP;

  IF v_depth > 5 THEN
    RAISE EXCEPTION 'Maximum comment nesting depth (5) exceeded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_comment_nesting_depth ON comments;
CREATE TRIGGER trg_check_comment_nesting_depth
  BEFORE INSERT ON comments
  FOR EACH ROW
  EXECUTE FUNCTION check_comment_nesting_depth();


-- ============================================================================
-- RELOAD SCHEMA CACHE
-- ============================================================================
NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check all triggers are created
SELECT trigger_name, event_object_table, action_timing
FROM information_schema.triggers
WHERE trigger_name IN (
  'trg_prevent_admin_promotion',
  'trg_check_voter_not_banned',
  'trg_check_commenter_not_banned',
  'trg_check_comment_nesting_depth'
);

-- Check admin_approve_clip_atomic was updated
SELECT routine_name, security_type
FROM information_schema.routines
WHERE routine_name = 'admin_approve_clip_atomic';

-- Check insert_vote_atomic was updated
SELECT routine_name, security_type
FROM information_schema.routines
WHERE routine_name = 'insert_vote_atomic';

DO $$
BEGIN
  RAISE NOTICE '✅ All 7 security vulnerabilities fixed:';
  RAISE NOTICE '  #3  - is_admin changes blocked by trigger';
  RAISE NOTICE '  #4  - admin_approve_clip_atomic now verifies admin status';
  RAISE NOTICE '  #6  - clips_update_own RLS includes user_id check';
  RAISE NOTICE '  #8  - Banned users blocked from voting via trigger';
  RAISE NOTICE '  #9  - Banned users blocked from commenting via trigger';
  RAISE NOTICE '  #12 - Self-voting blocked in insert_vote_atomic';
  RAISE NOTICE '  #14 - Comment nesting limited to 5 levels via trigger';
END $$;
