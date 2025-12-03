-- ============================================================================
-- SECURITY FEATURE FLAGS
-- Add flags to control security features
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Require authentication for voting (production mode)
INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('require_auth_voting', 'Require Auth for Voting', 'When enabled, users must be logged in to vote. Anonymous voting is disabled. Recommended for production.', 'safety', FALSE, '{}')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;

-- Require authentication for comments
INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('require_auth_comments', 'Require Auth for Comments', 'When enabled, users must be logged in to comment. Anonymous comments are disabled.', 'safety', FALSE, '{}')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category;
