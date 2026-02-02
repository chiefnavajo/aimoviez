-- add-last-frame-url.sql
-- ============================================================================
-- LAST FRAME CONTINUATION
-- Adds last_frame_url to tournament_clips for story continuity.
-- Adds image_url to ai_generations for image-to-video audit.
-- Adds feature flag to toggle the continuation UI.
-- ============================================================================

-- 1. New column on tournament_clips
ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS last_frame_url TEXT;

-- 2. New column on ai_generations for image-to-video audit trail
ALTER TABLE ai_generations ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 3. Feature flag
INSERT INTO feature_flags (key, name, description, enabled, category, config)
VALUES (
  'last_frame_continuation',
  'Last Frame Continuation',
  'Show "Continue from last scene" option on upload and AI create pages',
  true,
  'engagement',
  '{}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
