-- ============================================================================
-- VOTE WEIGHT VALIDATION CONSTRAINTS
-- Ensures vote_weight values are within valid bounds
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. Add CHECK constraint to votes table for vote_weight
-- Valid vote_weight values: 1-10 (1 = normal vote, up to 10 for super votes)
ALTER TABLE votes
ADD CONSTRAINT check_vote_weight_range
CHECK (vote_weight >= 1 AND vote_weight <= 10);

-- 2. Add CHECK constraint to ensure weighted_score on clips is non-negative
ALTER TABLE tournament_clips
ADD CONSTRAINT check_weighted_score_non_negative
CHECK (weighted_score >= 0 OR weighted_score IS NULL);

-- 3. Add CHECK constraint to ensure vote_count is non-negative
ALTER TABLE tournament_clips
ADD CONSTRAINT check_vote_count_non_negative
CHECK (vote_count >= 0 OR vote_count IS NULL);

-- 4. Set default values for new rows
ALTER TABLE votes
ALTER COLUMN vote_weight SET DEFAULT 1;

ALTER TABLE tournament_clips
ALTER COLUMN vote_count SET DEFAULT 0;

ALTER TABLE tournament_clips
ALTER COLUMN weighted_score SET DEFAULT 0;

-- 5. Create a validation trigger for additional checks
CREATE OR REPLACE FUNCTION validate_vote_weight()
RETURNS TRIGGER AS $$
BEGIN
  -- Ensure vote_weight is within bounds
  IF NEW.vote_weight IS NULL THEN
    NEW.vote_weight := 1;
  ELSIF NEW.vote_weight < 1 THEN
    NEW.vote_weight := 1;
  ELSIF NEW.vote_weight > 10 THEN
    NEW.vote_weight := 10;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trigger_validate_vote_weight ON votes;

-- Create trigger
CREATE TRIGGER trigger_validate_vote_weight
  BEFORE INSERT OR UPDATE ON votes
  FOR EACH ROW
  EXECUTE FUNCTION validate_vote_weight();

COMMENT ON CONSTRAINT check_vote_weight_range ON votes IS 'Ensures vote_weight is between 1 and 10';
COMMENT ON CONSTRAINT check_weighted_score_non_negative ON tournament_clips IS 'Ensures weighted_score cannot be negative';
COMMENT ON CONSTRAINT check_vote_count_non_negative ON tournament_clips IS 'Ensures vote_count cannot be negative';
