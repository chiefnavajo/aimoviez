-- ============================================================================
-- COMMENT COUNT RPC FUNCTION
-- Efficiently get comment counts for multiple clips in a single query
-- Run this in Supabase SQL Editor
-- ============================================================================

CREATE OR REPLACE FUNCTION get_comment_counts(clip_ids uuid[])
RETURNS TABLE (clip_id uuid, count bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.clip_id,
    COUNT(*)::bigint as count
  FROM comments c
  WHERE c.clip_id = ANY(clip_ids)
    AND c.is_deleted = false
    AND c.parent_comment_id IS NULL
  GROUP BY c.clip_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_comment_counts(uuid[]) TO anon, authenticated, service_role;

COMMENT ON FUNCTION get_comment_counts(uuid[]) IS 'Efficiently get comment counts for multiple clips in a single aggregated query';
