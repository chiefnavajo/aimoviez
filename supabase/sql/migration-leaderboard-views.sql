-- ============================================================================
-- LEADERBOARD OPTIMIZATION: Database Functions for Aggregated Stats
-- These functions perform aggregation in the database instead of loading all rows
-- ============================================================================

-- 1. TOP VOTERS FUNCTION
-- Returns top N voters with aggregated stats
CREATE OR REPLACE FUNCTION get_top_voters(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_timeframe TEXT DEFAULT 'all' -- 'today', 'week', 'all'
)
RETURNS TABLE (
  voter_key TEXT,
  total_votes BIGINT,
  weighted_total BIGINT,
  votes_today BIGINT,
  first_vote_at TIMESTAMPTZ,
  last_vote_at TIMESTAMPTZ
) AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_today_start TIMESTAMPTZ;
BEGIN
  -- Calculate date boundaries
  v_today_start := date_trunc('day', NOW() AT TIME ZONE 'UTC');

  IF p_timeframe = 'today' THEN
    v_start_date := v_today_start;
  ELSIF p_timeframe = 'week' THEN
    v_start_date := v_today_start - INTERVAL '7 days';
  ELSE
    v_start_date := '1970-01-01'::TIMESTAMPTZ;
  END IF;

  RETURN QUERY
  SELECT
    v.voter_key,
    COUNT(*)::BIGINT as total_votes,
    COALESCE(SUM(v.vote_weight), COUNT(*))::BIGINT as weighted_total,
    COUNT(*) FILTER (WHERE v.created_at >= v_today_start)::BIGINT as votes_today,
    MIN(v.created_at) as first_vote_at,
    MAX(v.created_at) as last_vote_at
  FROM votes v
  WHERE v.created_at >= v_start_date
  GROUP BY v.voter_key
  ORDER BY weighted_total DESC, total_votes DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- 2. TOTAL VOTERS COUNT
-- Returns count of unique voters (for pagination)
CREATE OR REPLACE FUNCTION get_voters_count(
  p_timeframe TEXT DEFAULT 'all'
)
RETURNS BIGINT AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_count BIGINT;
BEGIN
  IF p_timeframe = 'today' THEN
    v_start_date := date_trunc('day', NOW() AT TIME ZONE 'UTC');
  ELSIF p_timeframe = 'week' THEN
    v_start_date := date_trunc('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days';
  ELSE
    v_start_date := '1970-01-01'::TIMESTAMPTZ;
  END IF;

  SELECT COUNT(DISTINCT voter_key) INTO v_count
  FROM votes
  WHERE created_at >= v_start_date;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 3. USER RANK FUNCTION
-- Returns a specific user's rank
CREATE OR REPLACE FUNCTION get_voter_rank(
  p_voter_key TEXT,
  p_timeframe TEXT DEFAULT 'all'
)
RETURNS INT AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_rank INT;
BEGIN
  IF p_timeframe = 'today' THEN
    v_start_date := date_trunc('day', NOW() AT TIME ZONE 'UTC');
  ELSIF p_timeframe = 'week' THEN
    v_start_date := date_trunc('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days';
  ELSE
    v_start_date := '1970-01-01'::TIMESTAMPTZ;
  END IF;

  SELECT rank INTO v_rank
  FROM (
    SELECT
      voter_key,
      RANK() OVER (ORDER BY COALESCE(SUM(vote_weight), COUNT(*)) DESC) as rank
    FROM votes
    WHERE created_at >= v_start_date
    GROUP BY voter_key
  ) ranked
  WHERE voter_key = p_voter_key;

  RETURN COALESCE(v_rank, 0);
END;
$$ LANGUAGE plpgsql;

-- 4. TOP CREATORS FUNCTION
-- Returns top N creators with aggregated stats
CREATE OR REPLACE FUNCTION get_top_creators(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_timeframe TEXT DEFAULT 'all'
)
RETURNS TABLE (
  username TEXT,
  avatar_url TEXT,
  total_clips BIGINT,
  total_votes BIGINT,
  weighted_score BIGINT,
  locked_clips BIGINT,
  best_clip_id UUID,
  best_clip_votes BIGINT
) AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
BEGIN
  IF p_timeframe = 'today' THEN
    v_start_date := date_trunc('day', NOW() AT TIME ZONE 'UTC');
  ELSIF p_timeframe = 'week' THEN
    v_start_date := date_trunc('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days';
  ELSE
    v_start_date := '1970-01-01'::TIMESTAMPTZ;
  END IF;

  RETURN QUERY
  WITH clip_stats AS (
    SELECT
      c.username,
      c.avatar_url,
      c.id as clip_id,
      COALESCE(c.vote_count, 0) as vote_count,
      COALESCE(c.weighted_score, 0) as w_score,
      CASE WHEN s.winner_tournament_clip_id = c.id THEN 1 ELSE 0 END as is_winner
    FROM tournament_clips c
    LEFT JOIN story_slots s ON s.winner_tournament_clip_id = c.id
    WHERE c.created_at >= v_start_date
      AND c.username IS NOT NULL
  ),
  creator_agg AS (
    SELECT
      cs.username,
      MAX(cs.avatar_url) as avatar_url,
      COUNT(*)::BIGINT as total_clips,
      SUM(cs.vote_count)::BIGINT as total_votes,
      SUM(cs.w_score)::BIGINT as weighted_score,
      SUM(cs.is_winner)::BIGINT as locked_clips
    FROM clip_stats cs
    GROUP BY cs.username
  ),
  best_clips AS (
    SELECT DISTINCT ON (username)
      username,
      clip_id,
      vote_count
    FROM clip_stats
    ORDER BY username, vote_count DESC
  )
  SELECT
    ca.username,
    ca.avatar_url,
    ca.total_clips,
    ca.total_votes,
    ca.weighted_score,
    ca.locked_clips,
    bc.clip_id as best_clip_id,
    bc.vote_count::BIGINT as best_clip_votes
  FROM creator_agg ca
  LEFT JOIN best_clips bc ON bc.username = ca.username
  ORDER BY ca.total_votes DESC, ca.weighted_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Test the functions
-- SELECT * FROM get_top_voters(10, 0, 'all');
-- SELECT get_voters_count('all');
-- SELECT * FROM get_top_creators(10, 0, 'all');

-- ============================================================================
-- NOTES:
-- After running this migration, update the leaderboard API routes to use
-- these RPC functions instead of loading all rows into memory.
-- ============================================================================
