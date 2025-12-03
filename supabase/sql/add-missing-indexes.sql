-- ============================================================================
-- ADD MISSING INDEXES
-- These indexes were identified as missing from the audit
-- ============================================================================

-- 1. Composite index for tournament_clips (season, slot, status)
-- Used in complex queries filtering by multiple conditions
CREATE INDEX IF NOT EXISTS idx_clips_season_slot_status
ON tournament_clips(season_id, slot_position, status);

-- 2. Index for votes.user_id (partial - only non-null)
-- Speeds up queries for authenticated user votes
CREATE INDEX IF NOT EXISTS idx_votes_user_id
ON votes(user_id)
WHERE user_id IS NOT NULL;

-- 3. Composite index for notifications (user, read status, date)
-- Speeds up "get unread notifications" queries
-- Only create if notifications table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read
    ON notifications(user_id, is_read, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_user_key_read
    ON notifications(user_key, is_read, created_at DESC);

    RAISE NOTICE 'Created notification indexes';
  ELSE
    RAISE NOTICE 'notifications table does not exist, skipping indexes';
  END IF;
END $$;

-- 4. Index for tournament_clips.user_id (already in CRITICAL-FIX-1 as idx_clips_user)
-- Adding explicit name version for clarity
CREATE INDEX IF NOT EXISTS idx_clips_user_id
ON tournament_clips(user_id);

-- ============================================================================
-- ANALYZE tables to update statistics
-- ============================================================================
ANALYZE tournament_clips;
ANALYZE votes;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    ANALYZE notifications;
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION: List all indexes on key tables
-- ============================================================================
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('tournament_clips', 'votes', 'notifications')
ORDER BY tablename, indexname;
