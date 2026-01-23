-- ============================================================================
-- SIMPLIFY CLIP DISTRIBUTION FOR INFINITE SCALE
-- ============================================================================
-- This migration removes per-user seen tracking and uses view_count + random jitter
-- for fair, scalable clip distribution.
--
-- Key insight: view_count is already a global "seen" tracker that ensures fairness.
-- Adding per-user tracking doesn't scale and isn't necessary for core functionality.
-- ============================================================================

-- ============================================================================
-- 1. NEW RPC: Get clips with randomized fairness (no seen tracking)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_clips_randomized(
  p_slot_position INTEGER,
  p_season_id UUID,
  p_exclude_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INTEGER DEFAULT 20,
  p_jitter INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  thumbnail_url TEXT,
  video_url TEXT,
  username TEXT,
  avatar_url TEXT,
  genre TEXT,
  slot_position INTEGER,
  vote_count INTEGER,
  weighted_score NUMERIC(10,2),
  hype_score NUMERIC(10,2),
  view_count INTEGER,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- Return clips ordered by view_count with random jitter
  -- This ensures:
  -- 1. Low-view clips get priority (fairness)
  -- 2. Random jitter prevents same clips every request (variety)
  -- 3. No per-user storage needed (infinite scale)
  RETURN QUERY
  SELECT
    tc.id,
    tc.thumbnail_url,
    tc.video_url,
    tc.username,
    tc.avatar_url,
    tc.genre,
    tc.slot_position,
    tc.vote_count,
    tc.weighted_score,
    tc.hype_score,
    tc.view_count,
    tc.created_at
  FROM tournament_clips tc
  WHERE tc.slot_position = p_slot_position
    AND tc.season_id = p_season_id
    AND tc.status = 'active'
    AND (CARDINALITY(p_exclude_ids) = 0 OR tc.id != ALL(p_exclude_ids))
  ORDER BY tc.view_count + (RANDOM() * p_jitter)
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. INDEX FOR RANDOMIZED QUERY
-- ============================================================================

-- The existing idx_clips_distribution index works well for this query
-- But we add a comment for clarity
COMMENT ON INDEX idx_clips_distribution IS
  'Supports get_clips_randomized() - orders by view_count with jitter for fair distribution';

-- ============================================================================
-- 3. OPTIONAL: Drop old seen-tracking related objects if not needed elsewhere
-- ============================================================================

-- Note: We keep clip_views table for analytics/view_count tracking
-- but it's no longer used for filtering clips in the voting flow

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Test the new function
-- SELECT * FROM get_clips_randomized(1, 'your-season-uuid-here', ARRAY[]::UUID[], 10, 50);
