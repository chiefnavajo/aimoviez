-- =============================================================================
-- SECURITY FIX: Lock down RPC function permissions
-- =============================================================================
-- Multiple RPC functions were callable by any role (including anon/authenticated)
-- because no explicit GRANT/REVOKE was set. This migration restricts sensitive
-- functions to service_role only, preventing direct PostgREST exploitation.
-- =============================================================================

-- CREDIT FUNCTIONS (service_role only)
REVOKE ALL ON FUNCTION public.admin_grant_credits(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_grant_credits(uuid, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_grant_credits(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_credits(uuid, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.deduct_credits(uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deduct_credits(uuid, integer, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.deduct_credits(uuid, integer, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits(uuid, integer, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.refund_credits(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_credits(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.refund_credits(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.add_credits(uuid, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_credits(uuid, integer, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.add_credits(uuid, integer, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.add_credits(uuid, integer, text, uuid) TO service_role;

-- ADMIN FUNCTIONS (service_role only)
REVOKE ALL ON FUNCTION public.assign_winner_atomic(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_winner_atomic(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.assign_winner_atomic(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_winner_atomic(uuid, uuid, uuid) TO service_role;

-- SLOT REORGANIZATION (service_role only)
REVOKE ALL ON FUNCTION public.reorganize_slots_delete_and_shift(uuid, integer[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorganize_slots_delete_and_shift(uuid, integer[]) FROM anon;
REVOKE ALL ON FUNCTION public.reorganize_slots_delete_and_shift(uuid, integer[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reorganize_slots_delete_and_shift(uuid, integer[]) TO service_role;

REVOKE ALL ON FUNCTION public.reorganize_slots_swap(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorganize_slots_swap(uuid, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.reorganize_slots_swap(uuid, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reorganize_slots_swap(uuid, integer, integer) TO service_role;

-- COMMENT MODERATION (service_role only — was granted to authenticated)
REVOKE ALL ON FUNCTION public.approve_comment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_comment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.approve_comment(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_comment(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.reject_comment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_comment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reject_comment(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reject_comment(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.flag_comment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flag_comment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.flag_comment(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.flag_comment(uuid) TO service_role;

-- XP (service_role only)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_user_xp') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.add_user_xp FROM PUBLIC';
    EXECUTE 'REVOKE ALL ON FUNCTION public.add_user_xp FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION public.add_user_xp FROM authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.add_user_xp TO service_role';
  END IF;
END $$;
