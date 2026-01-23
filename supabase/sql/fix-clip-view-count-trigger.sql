-- ============================================================================
-- FIX CLIP VIEW COUNT DISTRIBUTION
-- This migration adds a trigger to increment view_count on tournament_clips
-- when a new view is recorded in clip_views table
-- ============================================================================

-- 1. Create trigger function to increment view_count
CREATE OR REPLACE FUNCTION increment_clip_view_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Increment view_count on the tournament_clips table
  -- Only increment for new views (INSERT), not updates
  UPDATE tournament_clips
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = NEW.clip_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Drop existing trigger if it exists (safe to re-run)
DROP TRIGGER IF EXISTS on_clip_view_insert ON clip_views;

-- 3. Create the trigger for INSERT on clip_views
CREATE TRIGGER on_clip_view_insert
AFTER INSERT ON clip_views
FOR EACH ROW
EXECUTE FUNCTION increment_clip_view_count();

-- ============================================================================
-- BACKFILL: Update view_count for existing clips based on clip_views
-- This ensures existing data is accurate
-- ============================================================================

-- Update all clips with their actual view counts
UPDATE tournament_clips tc
SET view_count = (
  SELECT COUNT(*)
  FROM clip_views cv
  WHERE cv.clip_id = tc.id
)
WHERE EXISTS (
  SELECT 1 FROM clip_views cv WHERE cv.clip_id = tc.id
);

-- Set view_count to 0 for clips with no views (instead of NULL)
UPDATE tournament_clips
SET view_count = 0
WHERE view_count IS NULL;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check trigger was created
SELECT
  trigger_name,
  event_manipulation,
  action_timing
FROM information_schema.triggers
WHERE trigger_name = 'on_clip_view_insert';

-- Check function was created
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name = 'increment_clip_view_count';

-- Show sample of view counts
SELECT
  id,
  username,
  view_count,
  vote_count
FROM tournament_clips
ORDER BY view_count DESC
LIMIT 10;
