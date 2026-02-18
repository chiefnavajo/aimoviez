-- Migration: Add increment_movie_project_field RPC
-- Purpose: Atomic increment of numeric fields on movie_projects to prevent
-- lost updates from read-modify-write race conditions in process-movie-scenes cron.
-- Date: 2026-02-18

CREATE OR REPLACE FUNCTION increment_movie_project_field(
  p_project_id UUID,
  p_field TEXT,
  p_amount INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only allow incrementing specific whitelisted fields to prevent SQL injection
  IF p_field NOT IN ('spent_credits', 'completed_scenes') THEN
    RAISE EXCEPTION 'Field % is not allowed for atomic increment', p_field;
  END IF;

  -- Use EXECUTE for dynamic column name (safe because of whitelist above)
  EXECUTE format(
    'UPDATE movie_projects SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_field, p_field
  ) USING p_amount, p_project_id;
END;
$$;

-- Grant execute to service role (used by cron jobs)
GRANT EXECUTE ON FUNCTION increment_movie_project_field(UUID, TEXT, INTEGER) TO service_role;
