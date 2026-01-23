-- ============================================================================
-- GENRE VOTE STATS RPC FUNCTION
-- Consolidates 7 parallel COUNT queries into a single GROUP BY query
-- Reduces database connections and improves performance
-- ============================================================================

-- RPC FUNCTION: Get all genre vote counts in one query
CREATE OR REPLACE FUNCTION get_genre_vote_stats(p_voter_key TEXT DEFAULT NULL)
RETURNS TABLE (
  genre TEXT,
  vote_count BIGINT,
  user_voted BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    gv.genre,
    COUNT(*)::BIGINT as vote_count,
    BOOL_OR(gv.voter_key = p_voter_key) as user_voted
  FROM genre_votes gv
  GROUP BY gv.genre
  ORDER BY vote_count DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check function was created
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'get_genre_vote_stats';

-- Test the function (optional)
-- SELECT * FROM get_genre_vote_stats('test-voter-key');
