-- ============================================================================
-- SETUP CRON JOBS FOR MATERIALIZED VIEW REFRESH
-- For high-scale: thousands of votes per minute
-- ============================================================================

-- 1. Enable pg_cron extension (Supabase has this available)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- 3. Schedule refresh of vote counts view every 5 minutes
-- This keeps leaderboard rankings fresh without expensive queries
SELECT cron.schedule(
  'refresh-vote-counts',
  '*/5 * * * *',  -- Every 5 minutes
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_vote_counts$$
);

-- 4. Schedule refresh of clip distribution stats every 5 minutes
-- This helps with fair clip distribution at scale
SELECT cron.schedule(
  'refresh-clip-stats',
  '*/5 * * * *',  -- Every 5 minutes
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_clip_distribution_stats$$
);

-- 5. Schedule cleanup of old clip views (older than 30 days) - daily at 3 AM UTC
-- Prevents unbounded table growth
SELECT cron.schedule(
  'cleanup-old-views',
  '0 3 * * *',  -- Daily at 3:00 AM UTC
  $$SELECT cleanup_old_clip_views()$$
);

-- ============================================================================
-- VERIFY CRON JOBS
-- ============================================================================
SELECT * FROM cron.job;

-- ============================================================================
-- TO UNSCHEDULE (if needed):
-- SELECT cron.unschedule('refresh-vote-counts');
-- SELECT cron.unschedule('refresh-clip-stats');
-- SELECT cron.unschedule('cleanup-old-views');
-- ============================================================================
