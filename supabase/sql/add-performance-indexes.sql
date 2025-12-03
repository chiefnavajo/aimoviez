-- ============================================================================
-- PERFORMANCE INDEXES
-- Run this migration to improve query performance
-- ============================================================================

-- Index for voting page queries (most frequently used)
-- Speeds up: SELECT * FROM tournament_clips WHERE season_id = ? AND slot_position = ? AND status = 'active'
CREATE INDEX IF NOT EXISTS idx_clips_season_slot_status
ON tournament_clips(season_id, slot_position, status);

-- Index for leaderboard queries
-- Speeds up: SELECT * FROM tournament_clips ORDER BY vote_count DESC
CREATE INDEX IF NOT EXISTS idx_clips_vote_count
ON tournament_clips(vote_count DESC);

-- Index for user profile clips
-- Speeds up: SELECT * FROM tournament_clips WHERE user_id = ?
CREATE INDEX IF NOT EXISTS idx_clips_user_id
ON tournament_clips(user_id);

-- Index for comments loading
-- Speeds up: SELECT * FROM comments WHERE clip_id = ? ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_comments_clip_id_created
ON comments(clip_id, created_at DESC);

-- Index for votes by user (for checking if user has voted)
-- Speeds up: SELECT * FROM votes WHERE voter_key = ? AND clip_id = ?
CREATE INDEX IF NOT EXISTS idx_votes_voter_clip
ON votes(voter_key, clip_id);

-- Index for story slots by season
-- Speeds up: SELECT * FROM story_slots WHERE season_id = ? ORDER BY slot_position
CREATE INDEX IF NOT EXISTS idx_slots_season_position
ON story_slots(season_id, slot_position);

-- Index for active season lookup
-- Speeds up: SELECT * FROM seasons WHERE status = 'active'
CREATE INDEX IF NOT EXISTS idx_seasons_status
ON seasons(status);

-- Index for leaderboard voters (top voters)
-- Speeds up: Aggregation queries for vote counts by voter
CREATE INDEX IF NOT EXISTS idx_votes_voter_key
ON votes(voter_key);

-- Index for notifications
-- Speeds up: SELECT * FROM notifications WHERE user_id = ? AND is_read = false
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
ON notifications(user_id, is_read) WHERE is_read = false;

-- ============================================================================
-- ANALYZE tables to update statistics for query planner
-- ============================================================================
ANALYZE tournament_clips;
ANALYZE comments;
ANALYZE votes;
ANALYZE story_slots;
ANALYZE seasons;
ANALYZE notifications;
