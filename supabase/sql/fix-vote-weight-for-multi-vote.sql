-- ============================================================================
-- FIX: Allow vote_weight accumulation for multi-vote mode
-- The previous constraint capped vote_weight at 10, but multi-vote mode
-- accumulates weights (up to 200 daily limit per user)
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. Drop the old CHECK constraint that limits vote_weight to 10
ALTER TABLE votes
DROP CONSTRAINT IF EXISTS check_vote_weight_range;

-- 2. Add new CHECK constraint with higher limit (200 = daily max)
ALTER TABLE votes
ADD CONSTRAINT check_vote_weight_range
CHECK (vote_weight >= 1 AND vote_weight <= 200);

-- 3. Update the trigger function to allow accumulation up to 200
CREATE OR REPLACE FUNCTION validate_vote_weight()
RETURNS TRIGGER AS $$
BEGIN
  -- Ensure vote_weight is within bounds (1-200 for multi-vote accumulation)
  IF NEW.vote_weight IS NULL THEN
    NEW.vote_weight := 1;
  ELSIF NEW.vote_weight < 1 THEN
    NEW.vote_weight := 1;
  ELSIF NEW.vote_weight > 200 THEN
    -- Cap at 200 (daily limit)
    NEW.vote_weight := 200;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger will automatically use the updated function
-- No need to recreate the trigger itself

COMMENT ON CONSTRAINT check_vote_weight_range ON votes IS 'Ensures vote_weight is between 1 and 200 (allows multi-vote accumulation)';
