-- =============================================================================
-- SECURITY FIX: Lock down RPC function permissions
-- =============================================================================
-- Multiple RPC functions were callable by any role (including anon/authenticated)
-- because no explicit GRANT/REVOKE was set. This migration restricts sensitive
-- functions to service_role only, preventing direct PostgREST exploitation.
--
-- All blocks are idempotent: functions that don't exist are silently skipped.
-- =============================================================================

-- Helper: lock down a function to service_role only (skip if not found)
DO $$
DECLARE
  fn TEXT;
  fns TEXT[] := ARRAY[
    'admin_grant_credits',
    'deduct_credits',
    'refund_credits',
    'add_credits',
    'assign_winner_atomic',
    'reorganize_slots_delete_and_shift',
    'reorganize_slots_swap',
    'approve_comment',
    'reject_comment',
    'flag_comment',
    'add_user_xp'
  ];
  oid_val OID;
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    -- Find any overload of this function in the public schema
    FOR oid_val IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', oid_val::regprocedure);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', oid_val::regprocedure);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', oid_val::regprocedure);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', oid_val::regprocedure);
      RAISE NOTICE 'Locked down function: %', oid_val::regprocedure;
    END LOOP;
  END LOOP;
END $$;
