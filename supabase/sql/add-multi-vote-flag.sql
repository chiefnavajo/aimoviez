-- ============================================================================
-- ADD MULTI-VOTE MODE FEATURE FLAG
-- Allows voting on the same clip multiple times (up to 200 daily limit)
-- Run this in Supabase SQL Editor
-- ============================================================================

INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('multi_vote_mode', 'Multi-Vote Mode', 'Allow users to vote on the same clip multiple times (up to daily limit of 200). When OFF, users can only vote once per clip.', 'engagement', FALSE, '{"daily_limit": 200}')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  config = EXCLUDED.config;
