-- ============================================================================
-- ENABLE LEARNING FEATURES - FINAL SETUP (5 of 5)
-- Enables prompt and visual learning, syncs existing data
-- ============================================================================
-- Created: 2026-02-07 20:30:00 UTC
-- Version: 1.0.0
-- Run this in Supabase SQL Editor AFTER all previous migrations
-- Order: Run this FIFTH (final step)
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
-- 2. SYNC EXISTING DATA
-- This syncs vote_count and is_winner from tournament_clips to prompt_history
-- ============================================================================

SELECT * FROM bulk_sync_prompt_learning();

-- ============================================================================
-- 3. RECALCULATE VOCABULARY SCORES
-- Updates vocabulary tables with correct Bayesian scores
-- ============================================================================

SELECT * FROM recalculate_vocabulary_scores();

-- ============================================================================
-- 4. VERIFICATION QUERIES
-- Run these to check current state
-- ============================================================================

-- Check prompt_history data
SELECT
  COUNT(*) as total_prompts,
  COUNT(*) FILTER (WHERE vote_count > 0) as prompts_with_votes,
  COUNT(*) FILTER (WHERE is_winner = true) as winning_prompts,
  COUNT(*) FILTER (WHERE scene_elements IS NOT NULL) as prompts_with_elements
FROM prompt_history;

-- Check vocabulary tables
SELECT 'scene_vocabulary' as table_name, COUNT(*) as count FROM scene_vocabulary
UNION ALL
SELECT 'visual_vocabulary', COUNT(*) FROM visual_vocabulary
UNION ALL
SELECT 'model_prompt_patterns', COUNT(*) FROM model_prompt_patterns
UNION ALL
SELECT 'clip_visuals', COUNT(*) FROM clip_visuals;

-- ============================================================================
-- 5. NEXT STEPS (RUN VIA ADMIN API, NOT SQL)
-- ============================================================================

-- The scene_elements extraction requires Claude Haiku API calls.
-- You must use the admin API endpoints to process existing data:
--
-- 1. Process existing prompts (extracts scene elements):
--    POST /api/admin/prompt-learning/process?batchSize=50
--
-- 2. Process existing clips for visual features:
--    POST /api/admin/visual-learning/process?batchSize=10
--
-- These endpoints require admin authentication.

-- ============================================================================
-- 6. OPTIONAL: DAILY DECAY CRON JOB
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
