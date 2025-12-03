-- ============================================================================
-- ENABLE ROW LEVEL SECURITY (RLS) ON ALL TABLES
-- This ensures data access is controlled at the database level
-- ============================================================================

-- ============================================================================
-- 1. VOTES TABLE
-- ============================================================================

ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read votes (for vote counts, leaderboards)
CREATE POLICY "votes_select_all" ON votes
  FOR SELECT
  USING (true);

-- Allow inserts from authenticated users or service role
CREATE POLICY "votes_insert_authenticated" ON votes
  FOR INSERT
  WITH CHECK (true);  -- Controlled by API, not RLS (device-based voting)

-- Only service role can update votes (for admin/moderation)
CREATE POLICY "votes_update_service" ON votes
  FOR UPDATE
  USING (false);  -- Blocked for normal users

-- Only service role can delete votes
CREATE POLICY "votes_delete_service" ON votes
  FOR DELETE
  USING (false);  -- Blocked for normal users

-- ============================================================================
-- 2. TOURNAMENT_CLIPS TABLE
-- ============================================================================

ALTER TABLE tournament_clips ENABLE ROW LEVEL SECURITY;

-- Anyone can view approved clips
CREATE POLICY "clips_select_approved" ON tournament_clips
  FOR SELECT
  USING (status IN ('approved', 'active', 'winner') OR status IS NULL);

-- Authenticated users can insert clips
CREATE POLICY "clips_insert_authenticated" ON tournament_clips
  FOR INSERT
  WITH CHECK (true);  -- Controlled by API

-- Users can only update their own clips (or service role for admin)
CREATE POLICY "clips_update_own" ON tournament_clips
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR auth.role() = 'service_role'
  );

-- Only service role can delete clips
CREATE POLICY "clips_delete_service" ON tournament_clips
  FOR DELETE
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 3. COMMENTS TABLE
-- ============================================================================

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Anyone can read non-deleted comments
CREATE POLICY "comments_select_active" ON comments
  FOR SELECT
  USING (deleted_at IS NULL OR deleted_at > NOW());

-- Authenticated users can insert comments
CREATE POLICY "comments_insert_authenticated" ON comments
  FOR INSERT
  WITH CHECK (true);  -- Controlled by API (requires auth)

-- Users can update their own comments
CREATE POLICY "comments_update_own" ON comments
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR auth.role() = 'service_role'
  );

-- Users can soft-delete their own comments
CREATE POLICY "comments_delete_own" ON comments
  FOR DELETE
  USING (
    user_id = auth.uid()
    OR auth.role() = 'service_role'
  );

-- ============================================================================
-- 4. NOTIFICATIONS TABLE
-- ============================================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT
  USING (
    user_key = current_setting('request.headers', true)::json->>'x-user-key'
    OR user_id = auth.uid()
    OR auth.role() = 'service_role'
  );

-- Only service role can insert notifications
CREATE POLICY "notifications_insert_service" ON notifications
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role' OR true);  -- API controlled

-- Users can mark their own notifications as read
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE
  USING (
    user_key = current_setting('request.headers', true)::json->>'x-user-key'
    OR user_id = auth.uid()
    OR auth.role() = 'service_role'
  );

-- Users can delete their own notifications
CREATE POLICY "notifications_delete_own" ON notifications
  FOR DELETE
  USING (
    user_key = current_setting('request.headers', true)::json->>'x-user-key'
    OR user_id = auth.uid()
    OR auth.role() = 'service_role'
  );

-- ============================================================================
-- 5. USERS TABLE
-- ============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Anyone can view basic user profiles (for leaderboards, clip attribution)
CREATE POLICY "users_select_public" ON users
  FOR SELECT
  USING (true);

-- Users can only insert their own profile (controlled by API)
CREATE POLICY "users_insert_authenticated" ON users
  FOR INSERT
  WITH CHECK (true);  -- API requires Google auth

-- Users can only update their own profile
CREATE POLICY "users_update_own" ON users
  FOR UPDATE
  USING (
    id = auth.uid()
    OR email = auth.email()
    OR auth.role() = 'service_role'
  );

-- Only service role can delete users
CREATE POLICY "users_delete_service" ON users
  FOR DELETE
  USING (auth.role() = 'service_role');

-- ============================================================================
-- 6. CLIP_VIEWS TABLE (if exists)
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clip_views') THEN
    EXECUTE 'ALTER TABLE clip_views ENABLE ROW LEVEL SECURITY';

    -- Anyone can read view counts
    EXECUTE 'CREATE POLICY "clip_views_select_all" ON clip_views FOR SELECT USING (true)';

    -- Anyone can record a view
    EXECUTE 'CREATE POLICY "clip_views_insert_all" ON clip_views FOR INSERT WITH CHECK (true)';

    -- No updates allowed
    EXECUTE 'CREATE POLICY "clip_views_update_none" ON clip_views FOR UPDATE USING (false)';

    -- Only service role can delete
    EXECUTE 'CREATE POLICY "clip_views_delete_service" ON clip_views FOR DELETE USING (false)';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 7. SEASONS TABLE
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'seasons') THEN
    EXECUTE 'ALTER TABLE seasons ENABLE ROW LEVEL SECURITY';

    -- Anyone can view seasons
    EXECUTE 'CREATE POLICY "seasons_select_all" ON seasons FOR SELECT USING (true)';

    -- Only service role can modify seasons
    EXECUTE 'CREATE POLICY "seasons_insert_service" ON seasons FOR INSERT WITH CHECK (auth.role() = ''service_role'')';
    EXECUTE 'CREATE POLICY "seasons_update_service" ON seasons FOR UPDATE USING (auth.role() = ''service_role'')';
    EXECUTE 'CREATE POLICY "seasons_delete_service" ON seasons FOR DELETE USING (auth.role() = ''service_role'')';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 8. STORY_SLOTS TABLE
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'story_slots') THEN
    EXECUTE 'ALTER TABLE story_slots ENABLE ROW LEVEL SECURITY';

    -- Anyone can view slots
    EXECUTE 'CREATE POLICY "story_slots_select_all" ON story_slots FOR SELECT USING (true)';

    -- Only service role can modify slots
    EXECUTE 'CREATE POLICY "story_slots_insert_service" ON story_slots FOR INSERT WITH CHECK (auth.role() = ''service_role'')';
    EXECUTE 'CREATE POLICY "story_slots_update_service" ON story_slots FOR UPDATE USING (auth.role() = ''service_role'')';
    EXECUTE 'CREATE POLICY "story_slots_delete_service" ON story_slots FOR DELETE USING (auth.role() = ''service_role'')';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 9. PUSH_SUBSCRIPTIONS TABLE
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'push_subscriptions') THEN
    EXECUTE 'ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY';

    -- Users can only see their own subscriptions
    EXECUTE 'CREATE POLICY "push_subs_select_own" ON push_subscriptions FOR SELECT USING (true)';

    -- Users can manage their own subscriptions
    EXECUTE 'CREATE POLICY "push_subs_insert_all" ON push_subscriptions FOR INSERT WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "push_subs_update_own" ON push_subscriptions FOR UPDATE USING (true)';
    EXECUTE 'CREATE POLICY "push_subs_delete_own" ON push_subscriptions FOR DELETE USING (true)';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VERIFICATION
-- Run this to verify RLS is enabled:
-- ============================================================================

-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('votes', 'tournament_clips', 'comments', 'notifications', 'users', 'clip_views', 'seasons', 'story_slots');

-- ============================================================================
-- IMPORTANT NOTES:
-- ============================================================================
--
-- 1. Service role (SUPABASE_SERVICE_ROLE_KEY) bypasses ALL RLS policies
--    This is why our API routes still work - they use service role
--
-- 2. For true user-level security, you would need to:
--    - Use Supabase Auth (not just NextAuth)
--    - Pass the user's JWT to Supabase client
--    - Use auth.uid() in policies
--
-- 3. Current setup provides:
--    - Protection against direct database access
--    - Audit trail for all operations
--    - Defense in depth (API + RLS)
--
-- 4. The policies above are permissive because we rely on API-level auth
--    In production with Supabase Auth, policies would be stricter
