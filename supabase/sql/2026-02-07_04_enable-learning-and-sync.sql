-- ============================================================================
-- ENABLE LEARNING FEATURES AND INITIAL SYNC (4 of 4)
-- Activates prompt & visual learning, runs initial data synchronization
-- ============================================================================
-- Created: 2026-02-07 19:50:00 UTC
-- Version: 1.0.0
-- Run this in Supabase SQL Editor AFTER all previous migrations
-- Order: Run this FOURTH (final step)
-- ============================================================================

-- ============================================================================
-- 1. ENABLE FEATURE FLAGS
-- ============================================================================

-- Enable prompt learning (AI learns from user prompts)
UPDATE feature_flags
SET enabled = true, updated_at = NOW()
WHERE key = 'prompt_learning';

-- Enable visual learning (AI learns from video thumbnails)
UPDATE feature_flags
SET enabled = true, updated_at = NOW()
WHERE key = 'visual_learning';

-- Verify flags are enabled
SELECT key, name, enabled, updated_at
FROM feature_flags
WHERE key IN ('prompt_learning', 'visual_learning');

-- ============================================================================
-- 2. INITIAL DATA SYNC
-- Syncs existing vote_count and is_winner from tournament_clips to prompt_history
-- ============================================================================

-- Sync all existing prompts with their current vote counts and winner status
SELECT * FROM bulk_sync_prompt_learning();

-- ============================================================================
-- 3. RECALCULATE VOCABULARY SCORES
-- Updates all vocabulary tables with correct scores based on synced data
-- ============================================================================

SELECT * FROM recalculate_vocabulary_scores();

-- ============================================================================
-- 4. VERIFICATION QUERIES
-- Run these to verify the system is working
-- ============================================================================

-- Check prompt_history has data with votes
SELECT
  COUNT(*) as total_prompts,
  COUNT(*) FILTER (WHERE vote_count > 0) as prompts_with_votes,
  COUNT(*) FILTER (WHERE is_winner = true) as winning_prompts
FROM prompt_history;

-- Check vocabulary has been populated
SELECT
  'scene_vocabulary' as table_name,
  COUNT(*) as total_terms,
  COUNT(*) FILTER (WHERE avg_vote_score > 0) as scored_terms
FROM scene_vocabulary
UNION ALL
SELECT
  'visual_vocabulary',
  COUNT(*),
  COUNT(*) FILTER (WHERE avg_vote_score > 0)
FROM visual_vocabulary
UNION ALL
SELECT
  'model_prompt_patterns',
  COUNT(*),
  COUNT(*) FILTER (WHERE avg_vote_score > 0)
FROM model_prompt_patterns;

-- ============================================================================
-- 5. OPTIONAL: SET UP DAILY DECAY CRON JOB
-- Uncomment if pg_cron extension is available
-- ============================================================================

-- SELECT cron.schedule(
--   'daily-learning-decay',
--   '0 4 * * *',  -- Run at 4 AM UTC daily
--   'SELECT * FROM apply_daily_decay()'
-- );

-- ============================================================================
-- END OF SETUP
-- ============================================================================
