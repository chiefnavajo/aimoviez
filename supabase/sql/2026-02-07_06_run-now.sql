-- ============================================================================
-- RUN NOW - Enable Learning Features (6 of 6)
-- Quick setup script to enable and verify learning system
-- ============================================================================
-- Created: 2026-02-07 20:35:00 UTC
-- Version: 1.0.0
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Enable prompt learning
UPDATE feature_flags
SET enabled = true, updated_at = NOW()
WHERE key = 'prompt_learning';

-- Enable visual learning
UPDATE feature_flags
SET enabled = true, updated_at = NOW()
WHERE key = 'visual_learning';

-- Verify flags enabled
SELECT key, enabled FROM feature_flags WHERE key IN ('prompt_learning', 'visual_learning');

-- Sync existing data
SELECT * FROM bulk_sync_prompt_learning();

-- Recalculate scores
SELECT * FROM recalculate_vocabulary_scores();

-- Check results
SELECT
  COUNT(*) as total_prompts,
  COUNT(*) FILTER (WHERE vote_count > 0) as prompts_with_votes,
  COUNT(*) FILTER (WHERE is_winner = true) as winning_prompts
FROM prompt_history;
