-- ============================================================================
-- ADD DURATION COLUMN TO TOURNAMENT_CLIPS
-- Stores video duration in seconds for validation and display
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Add duration column (nullable for backward compatibility with existing clips)
ALTER TABLE tournament_clips
ADD COLUMN IF NOT EXISTS duration_seconds DECIMAL(5,2);

-- Add constraint to ensure duration is within valid range (0-10 seconds)
ALTER TABLE tournament_clips
ADD CONSTRAINT check_duration_range
CHECK (duration_seconds IS NULL OR (duration_seconds >= 0 AND duration_seconds <= 10));

COMMENT ON COLUMN tournament_clips.duration_seconds IS 'Video duration in seconds (max 8.5s enforced by app)';
