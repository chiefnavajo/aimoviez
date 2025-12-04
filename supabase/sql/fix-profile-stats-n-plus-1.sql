-- ============================================================================
-- FIX N+1 QUERY IN PROFILE STATS
-- Instead of loading ALL votes to calculate rank, use efficient SQL queries
-- ============================================================================

-- 1. Create function to get user's global rank efficiently
CREATE OR REPLACE FUNCTION get_user_global_rank(p_voter_key TEXT)
RETURNS TABLE (
  global_rank INTEGER,
  total_users INTEGER,
  user_vote_count INTEGER
) AS $$
DECLARE
  v_user_votes INTEGER;
  v_rank INTEGER;
  v_total INTEGER;
BEGIN
  -- Get the user's total vote count
  SELECT COUNT(*)::INTEGER INTO v_user_votes
  FROM votes
  WHERE voter_key = p_voter_key;

  -- Count how many users have more votes than this user (rank)
  -- Using a single efficient query instead of loading all votes
  SELECT COUNT(DISTINCT voter_key)::INTEGER + 1 INTO v_rank
  FROM votes
  WHERE voter_key IN (
    SELECT v2.voter_key
    FROM votes v2
    GROUP BY v2.voter_key
    HAVING COUNT(*) > v_user_votes
  );

  -- Get total unique users
  SELECT COUNT(DISTINCT voter_key)::INTEGER INTO v_total
  FROM votes;

  -- If user has no votes, they're at the end
  IF v_user_votes = 0 THEN
    v_rank := v_total + 1;
  END IF;

  RETURN QUERY SELECT v_rank, v_total, v_user_votes;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- ALTERNATIVE: Create a materialized view for the leaderboard
-- This is more efficient for large datasets and can be refreshed periodically
-- ============================================================================

-- Create materialized view for user vote counts
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_vote_counts AS
SELECT
  voter_key,
  COUNT(*) as vote_count,
  RANK() OVER (ORDER BY COUNT(*) DESC) as global_rank
FROM votes
GROUP BY voter_key;

-- Create index on the materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_vote_counts_voter
ON mv_user_vote_counts(voter_key);

-- Create function to refresh the materialized view (call this periodically)
CREATE OR REPLACE FUNCTION refresh_user_vote_counts()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_vote_counts;
END;
$$ LANGUAGE plpgsql;

-- Create function to get rank from materialized view (much faster)
CREATE OR REPLACE FUNCTION get_user_rank_fast(p_voter_key TEXT)
RETURNS TABLE (
  global_rank BIGINT,
  total_users BIGINT,
  user_vote_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(m.global_rank, (SELECT COUNT(*) + 1 FROM mv_user_vote_counts)),
    (SELECT COUNT(*) FROM mv_user_vote_counts),
    COALESCE(m.vote_count, 0::BIGINT)
  FROM (SELECT 1) AS dummy
  LEFT JOIN mv_user_vote_counts m ON m.voter_key = p_voter_key;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check functions were created
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name IN ('get_user_global_rank', 'get_user_rank_fast', 'refresh_user_vote_counts');

-- Check materialized view was created
SELECT schemaname, matviewname
FROM pg_matviews
WHERE matviewname = 'mv_user_vote_counts';
