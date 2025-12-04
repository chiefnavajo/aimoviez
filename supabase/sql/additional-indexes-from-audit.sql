-- ============================================================================
-- ADDITIONAL DATABASE INDEXES FROM SECURITY AUDIT
-- These indexes were identified in the security audit as missing
-- ============================================================================

-- 1. Votes table - for user ranking calculations
CREATE INDEX IF NOT EXISTS idx_votes_user_id_created
ON votes(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- 2. Tournament clips - for season + slot queries
CREATE INDEX IF NOT EXISTS idx_clips_season_slot_created
ON tournament_clips(season_id, slot_position, created_at DESC);

-- 3. Comments - partial index for non-deleted comments (faster comment loading)
CREATE INDEX IF NOT EXISTS idx_comments_clip_deleted
ON comments(clip_id, is_deleted) WHERE is_deleted = FALSE;

-- 4. Genre votes - voter key lookup
CREATE INDEX IF NOT EXISTS idx_genre_votes_voter_key
ON genre_votes(voter_key);

-- 5. Votes - for ranking calculations using voter_key and vote_weight
CREATE INDEX IF NOT EXISTS idx_votes_voter_weight
ON votes(voter_key, vote_weight);

-- 6. Reports table index (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reports') THEN
    CREATE INDEX IF NOT EXISTS idx_reports_status_created
    ON reports(status, created_at DESC);
  END IF;
END $$;

-- 7. Blocks table index (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'blocks') THEN
    CREATE INDEX IF NOT EXISTS idx_blocks_blocker
    ON blocks(blocker_id);

    CREATE INDEX IF NOT EXISTS idx_blocks_blocked
    ON blocks(blocked_id);
  END IF;
END $$;

-- 8. Contact messages table index (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contact_messages') THEN
    CREATE INDEX IF NOT EXISTS idx_contact_messages_status
    ON contact_messages(status, created_at DESC);
  END IF;
END $$;

-- Update statistics
ANALYZE votes;
ANALYZE tournament_clips;
ANALYZE comments;
ANALYZE genre_votes;

-- Verify indexes were created
SELECT
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
