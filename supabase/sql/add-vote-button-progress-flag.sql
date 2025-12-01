-- ============================================================================
-- ADD VOTE BUTTON PROGRESS FEATURE FLAG
-- Run this in Supabase SQL Editor
-- ============================================================================

INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('vote_button_progress', 'Vote Button Progress Ring', 'Shows daily vote progress as a filling ring around the vote button. Ring color changes from blue → cyan → green → gold as votes increase.', 'engagement', FALSE, '{}')
ON CONFLICT (key) DO NOTHING;
