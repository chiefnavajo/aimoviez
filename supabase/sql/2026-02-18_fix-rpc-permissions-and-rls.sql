-- ============================================================================
-- FIX: RPC Permissions & RLS INSERT Policies (2026-02-18)
--
-- CRITICAL: Multiple SECURITY DEFINER functions were granted to anon/public,
-- allowing direct database manipulation bypassing all API protections.
-- Anyone with the public anon key could insert/delete votes and reorganize slots.
-- ============================================================================

-- ============================================================================
-- 1. REVOKE anon access from vote atomic RPCs
-- These should only be called via service_role from API routes
-- ============================================================================

-- insert_vote_atomic: was granted to anon in fix-7-security-vulnerabilities.sql
REVOKE EXECUTE ON FUNCTION insert_vote_atomic(TEXT, TEXT, TEXT, INTEGER, TEXT, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN) FROM anon;

-- delete_vote_atomic: was granted to anon in fix-vote-delete-race-condition.sql
REVOKE EXECUTE ON FUNCTION delete_vote_atomic(TEXT, TEXT) FROM anon;

-- ============================================================================
-- 2. RESTRICT slot reorganization RPCs to service_role only
-- These had no GRANT/REVOKE → defaulted to public (anyone can call)
-- ============================================================================

REVOKE EXECUTE ON FUNCTION reorganize_slots_delete_and_shift(UUID, INTEGER[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION reorganize_slots_delete_and_shift(UUID, INTEGER[]) TO service_role;

REVOKE EXECUTE ON FUNCTION reorganize_slots_swap(UUID, INTEGER, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION reorganize_slots_swap(UUID, INTEGER, INTEGER) TO service_role;

-- ============================================================================
-- 3. TIGHTEN RLS INSERT policies
-- All INSERT policies had WITH CHECK (true) — allowing any role to insert.
-- Change to require authenticated or service_role.
-- ============================================================================

-- Drop and recreate votes INSERT policy
DROP POLICY IF EXISTS "votes_insert_authenticated" ON votes;
CREATE POLICY "votes_insert_authenticated" ON votes
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Drop and recreate clips INSERT policy
DROP POLICY IF EXISTS "clips_insert_authenticated" ON tournament_clips;
CREATE POLICY "clips_insert_authenticated" ON tournament_clips
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Drop and recreate comments INSERT policy
DROP POLICY IF EXISTS "comments_insert_authenticated" ON comments;
CREATE POLICY "comments_insert_authenticated" ON comments
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Drop and recreate users INSERT policy
DROP POLICY IF EXISTS "users_insert_authenticated" ON users;
CREATE POLICY "users_insert_authenticated" ON users
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Fix notifications INSERT policy (had OR true which nullifies the check)
DROP POLICY IF EXISTS "notifications_insert_service" ON notifications;
CREATE POLICY "notifications_insert_service" ON notifications
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 4. VERIFY: Reload PostgREST schema cache
-- ============================================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION QUERIES (run manually to confirm):
--
-- Check function permissions:
-- SELECT proname, proacl FROM pg_proc WHERE proname IN (
--   'insert_vote_atomic', 'delete_vote_atomic',
--   'reorganize_slots_delete_and_shift', 'reorganize_slots_swap'
-- );
--
-- Check RLS policies:
-- SELECT tablename, policyname, qual, with_check
-- FROM pg_policies
-- WHERE tablename IN ('votes', 'tournament_clips', 'comments', 'users', 'notifications')
-- AND cmd = 'INSERT';
-- ============================================================================
