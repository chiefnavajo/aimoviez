-- ============================================================================
-- OPTIMIZE FOR SCALE (100K+ clips, 1M+ users)
-- Run this migration to prepare for high-volume voting
-- ============================================================================

-- ============================================================================
-- 1. CRITICAL INDEXES FOR CLIP DISTRIBUTION
-- ============================================================================

-- Composite index for "least viewed" query (most important!)
-- Covers: WHERE slot_position = X AND season_id = Y AND status = 'active' ORDER BY view_count
CREATE INDEX IF NOT EXISTS idx_clips_distribution
ON tournament_clips(slot_position, season_id, status, view_count ASC)
WHERE status = 'active';

-- Index for recent clips query
CREATE INDEX IF NOT EXISTS idx_clips_recent
ON tournament_clips(slot_position, season_id, status, created_at DESC)
WHERE status = 'active';

-- Index for high-engagement query
CREATE INDEX IF NOT EXISTS idx_clips_engagement
ON tournament_clips(slot_position, season_id, status, vote_count DESC)
WHERE status = 'active';

-- ============================================================================
-- 2. OPTIMIZE CLIP_VIEWS TABLE FOR SCALE
-- ============================================================================

-- Composite index for seen tracking (covers the JOIN query)
CREATE INDEX IF NOT EXISTS idx_clip_views_voter_lookup
ON clip_views(voter_key, clip_id);

-- Add created_at for potential cleanup of old views
ALTER TABLE clip_views
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Index for cleanup queries (delete views older than X days)
CREATE INDEX IF NOT EXISTS idx_clip_views_age
ON clip_views(viewed_at);

-- ============================================================================
-- 3. PARTITIONING CLIP_VIEWS BY TIME (Optional - for 100M+ rows)
-- ============================================================================

-- Note: Run this only if clip_views exceeds 50M rows
-- This creates monthly partitions for better query performance

-- Check current row count first:
-- SELECT COUNT(*) FROM clip_views;

-- If needed, convert to partitioned table:
-- (This requires migrating data - do during maintenance window)

-- ============================================================================
-- 4. MATERIALIZED VIEW FOR CLIP STATS (Reduces query load)
-- ============================================================================

-- Create materialized view for clip distribution stats
-- Refresh every 5 minutes via cron job
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_clip_distribution_stats AS
SELECT
  slot_position,
  season_id,
  COUNT(*) as total_clips,
  COUNT(*) FILTER (WHERE view_count = 0) as zero_view_clips,
  COUNT(*) FILTER (WHERE view_count < 10) as low_view_clips,
  AVG(view_count) as avg_views,
  MIN(view_count) as min_views,
  MAX(view_count) as max_views
FROM tournament_clips
WHERE status = 'active'
GROUP BY slot_position, season_id;

-- Index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_clip_dist_slot
ON mv_clip_distribution_stats(slot_position, season_id);

-- Function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_clip_distribution_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_clip_distribution_stats;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. AUTOMATIC CLEANUP OF OLD CLIP VIEWS (Prevents unbounded growth)
-- ============================================================================

-- Function to clean up old clip views (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_clip_views()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM clip_views
  WHERE viewed_at < NOW() - INTERVAL '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. RPC FUNCTION FOR EFFICIENT CLIP SAMPLING
-- ============================================================================

-- Optimized clip sampling using TABLESAMPLE for large datasets
CREATE OR REPLACE FUNCTION get_clips_for_voting(
  p_slot_position INTEGER,
  p_season_id UUID,
  p_voter_key TEXT,
  p_limit INTEGER DEFAULT 8,
  p_pool_size INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  thumbnail_url TEXT,
  video_url TEXT,
  username TEXT,
  avatar_url TEXT,
  genre TEXT,
  slot_position INTEGER,
  vote_count INTEGER,
  weighted_score NUMERIC(10,2),
  view_count INTEGER,
  created_at TIMESTAMPTZ,
  has_voted BOOLEAN,
  has_seen BOOLEAN
) AS $$
DECLARE
  total_clips INTEGER;
  sample_percent FLOAT;
BEGIN
  -- Get total clip count for this slot
  SELECT COUNT(*) INTO total_clips
  FROM tournament_clips tc
  WHERE tc.slot_position = p_slot_position
    AND tc.season_id = p_season_id
    AND tc.status = 'active';

  -- For small datasets, fetch all; for large, use sampling
  IF total_clips <= 1000 THEN
    -- Small dataset: fetch all, filter in query
    RETURN QUERY
    SELECT
      tc.id,
      tc.thumbnail_url,
      tc.video_url,
      tc.username,
      tc.avatar_url,
      tc.genre,
      tc.slot_position,
      tc.vote_count,
      tc.weighted_score,
      tc.view_count,
      tc.created_at,
      EXISTS(SELECT 1 FROM votes v WHERE v.clip_id = tc.id AND v.voter_key = p_voter_key) as has_voted,
      EXISTS(SELECT 1 FROM clip_views cv WHERE cv.clip_id = tc.id AND cv.voter_key = p_voter_key) as has_seen
    FROM tournament_clips tc
    WHERE tc.slot_position = p_slot_position
      AND tc.season_id = p_season_id
      AND tc.status = 'active'
      AND NOT EXISTS(SELECT 1 FROM clip_views cv WHERE cv.clip_id = tc.id AND cv.voter_key = p_voter_key)
    ORDER BY tc.view_count ASC, RANDOM()
    LIMIT p_pool_size;
  ELSE
    -- Large dataset: prioritize unseen low-view clips
    RETURN QUERY
    WITH unseen_clips AS (
      SELECT tc.*
      FROM tournament_clips tc
      WHERE tc.slot_position = p_slot_position
        AND tc.season_id = p_season_id
        AND tc.status = 'active'
        AND NOT EXISTS(SELECT 1 FROM clip_views cv WHERE cv.clip_id = tc.id AND cv.voter_key = p_voter_key)
      ORDER BY tc.view_count ASC
      LIMIT p_pool_size * 2
    )
    SELECT
      uc.id,
      uc.thumbnail_url,
      uc.video_url,
      uc.username,
      uc.avatar_url,
      uc.genre,
      uc.slot_position,
      uc.vote_count,
      uc.weighted_score,
      uc.view_count,
      uc.created_at,
      EXISTS(SELECT 1 FROM votes v WHERE v.clip_id = uc.id AND v.voter_key = p_voter_key) as has_voted,
      FALSE as has_seen
    FROM unseen_clips uc
    ORDER BY RANDOM()
    LIMIT p_pool_size;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. VERIFICATION QUERIES
-- ============================================================================

-- Check indexes were created
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('tournament_clips', 'clip_views')
ORDER BY tablename, indexname;

-- Check materialized view
SELECT * FROM mv_clip_distribution_stats LIMIT 10;

-- Check table sizes
SELECT
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_size_pretty(pg_relation_size(relid)) as data_size,
  pg_size_pretty(pg_indexes_size(relid)) as index_size
FROM pg_catalog.pg_statio_user_tables
WHERE relname IN ('tournament_clips', 'clip_views', 'votes')
ORDER BY pg_total_relation_size(relid) DESC;
