-- ============================================================================
-- USER AI GENERATION LIMIT
-- Allows per-user custom daily video generation limits
-- NULL = use global default from feature flag
-- -1 = unlimited generations
-- > 0 = specific daily limit
-- ============================================================================

-- 1. Add column to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS ai_daily_limit INTEGER DEFAULT NULL;

-- 2. Add comment for documentation
COMMENT ON COLUMN users.ai_daily_limit IS
  'Custom daily AI generation limit. NULL=use global default, -1=unlimited, >0=specific limit';

-- 3. Add constraint to ensure valid values
ALTER TABLE users
ADD CONSTRAINT valid_ai_daily_limit
  CHECK (ai_daily_limit IS NULL OR ai_daily_limit = -1 OR ai_daily_limit > 0);

-- 4. Create optimized RPC that looks up user limit internally
CREATE OR REPLACE FUNCTION check_and_reserve_generation_v2(
  p_user_id UUID,
  p_date DATE,
  p_global_max_daily INTEGER
) RETURNS INTEGER AS $$
DECLARE
  v_user_limit INTEGER;
  v_effective_limit INTEGER;
  v_count INTEGER;
BEGIN
  -- Get user's custom limit (if any)
  SELECT ai_daily_limit INTO v_user_limit
  FROM users
  WHERE id = p_user_id;

  -- Determine effective limit: user override or global default
  -- -1 means unlimited
  IF v_user_limit = -1 THEN
    -- Unlimited: just track count, always allow
    INSERT INTO ai_generation_limits (user_id, date, generation_count)
    VALUES (p_user_id, p_date, 1)
    ON CONFLICT (user_id, date)
    DO UPDATE SET generation_count = ai_generation_limits.generation_count + 1
    RETURNING generation_count INTO v_count;
    RETURN v_count;
  ELSIF v_user_limit IS NOT NULL AND v_user_limit > 0 THEN
    v_effective_limit := v_user_limit;
  ELSE
    v_effective_limit := p_global_max_daily;
  END IF;

  -- Atomic check and reserve with effective limit
  INSERT INTO ai_generation_limits (user_id, date, generation_count)
  VALUES (p_user_id, p_date, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET generation_count = ai_generation_limits.generation_count + 1
  WHERE ai_generation_limits.generation_count < v_effective_limit
  RETURNING generation_count INTO v_count;

  RETURN COALESCE(v_count, -1); -- -1 means limit reached
END;
$$ LANGUAGE plpgsql;

-- 5. Create helper function to get user's effective limit (for UI display)
CREATE OR REPLACE FUNCTION get_user_generation_limit(
  p_user_id UUID,
  p_global_max_daily INTEGER
) RETURNS TABLE(
  custom_limit INTEGER,
  effective_limit INTEGER,
  is_unlimited BOOLEAN
) AS $$
DECLARE
  v_user_limit INTEGER;
BEGIN
  SELECT ai_daily_limit INTO v_user_limit
  FROM users
  WHERE id = p_user_id;

  custom_limit := v_user_limit;

  IF v_user_limit = -1 THEN
    is_unlimited := TRUE;
    effective_limit := NULL;
  ELSIF v_user_limit IS NOT NULL AND v_user_limit > 0 THEN
    is_unlimited := FALSE;
    effective_limit := v_user_limit;
  ELSE
    is_unlimited := FALSE;
    effective_limit := p_global_max_daily;
  END IF;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
