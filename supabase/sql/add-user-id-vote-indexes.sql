-- ============================================================================
-- USER_ID BASED VOTE INDEXES
-- Required for profile stats API which queries by user_id (not voter_key)
-- Run this after the critical indexes migration
-- ============================================================================

-- Index for profile stats vote queries by user_id
-- Speeds up: SELECT * FROM votes WHERE user_id = ? ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_votes_user_id_created
ON votes(user_id, created_at DESC)
WHERE user_id IS NOT NULL;

-- Index for counting today's votes by user_id
-- Speeds up: SELECT count(*) FROM votes WHERE user_id = ? AND created_at >= today
CREATE INDEX IF NOT EXISTS idx_votes_user_id
ON votes(user_id)
WHERE user_id IS NOT NULL;

-- Index for tournament clips by user_id (for profile uploaded clips)
-- Speeds up: SELECT * FROM tournament_clips WHERE user_id = ?
CREATE INDEX IF NOT EXISTS idx_tournament_clips_user_id
ON tournament_clips(user_id)
WHERE user_id IS NOT NULL;

-- ============================================================================
-- ANALYZE tables to update statistics
-- ============================================================================
ANALYZE votes;
ANALYZE tournament_clips;

-- ============================================================================
-- VERIFY new indexes
-- ============================================================================
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE '%user_id%'
ORDER BY tablename, indexname;
