-- Migration: Cooldown-based free generation + Updated credit packages + First-purchase bonus
-- Date: 2026-02-18
-- Purpose: Replace daily counter with time-gap cooldown for free generations,
--          update credit packages with optimized pricing, and add first-purchase bonus logic.

-- =============================================================================
-- 1. CHECK GENERATION COOLDOWN RPC
-- Replaces daily counter with configurable hour-based cooldown.
-- Returns TRUE if user can generate (enough time has passed since last free gen).
-- =============================================================================

CREATE OR REPLACE FUNCTION check_generation_cooldown(
  p_user_id UUID,
  p_cooldown_hours INTEGER DEFAULT 72
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_last_free_gen TIMESTAMPTZ;
  v_hours_elapsed DOUBLE PRECISION;
  v_hours_remaining DOUBLE PRECISION;
  v_user_limit INTEGER;
BEGIN
  -- Check for admin unlimited override (ai_daily_limit = -1)
  SELECT ai_daily_limit INTO v_user_limit
  FROM users WHERE id = p_user_id;

  IF v_user_limit IS NOT NULL AND v_user_limit = -1 THEN
    RETURN jsonb_build_object('allowed', true, 'is_admin', true);
  END IF;

  -- Find last free generation (credit_deducted = FALSE means it was a free gen)
  SELECT MAX(created_at) INTO v_last_free_gen
  FROM ai_generations
  WHERE user_id = p_user_id
    AND credit_deducted = FALSE
    AND status != 'failed';

  -- No previous free gen = allowed
  IF v_last_free_gen IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'first_gen', true);
  END IF;

  -- Calculate hours elapsed
  v_hours_elapsed := EXTRACT(EPOCH FROM (NOW() - v_last_free_gen)) / 3600.0;

  IF v_hours_elapsed >= p_cooldown_hours THEN
    RETURN jsonb_build_object('allowed', true, 'hours_elapsed', round(v_hours_elapsed::numeric, 1));
  ELSE
    v_hours_remaining := p_cooldown_hours - v_hours_elapsed;
    RETURN jsonb_build_object(
      'allowed', false,
      'hours_remaining', round(v_hours_remaining::numeric, 1),
      'next_free_at', v_last_free_gen + (p_cooldown_hours || ' hours')::interval
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION check_generation_cooldown(UUID, INTEGER) TO service_role;

-- =============================================================================
-- 2. UPDATE CREDIT PACKAGES WITH OPTIMIZED PRICING
-- Deactivate old packages and insert new ones.
-- =============================================================================

-- Deactivate all existing packages
UPDATE credit_packages SET is_active = false WHERE is_active = true;

-- Insert new optimized packages
INSERT INTO credit_packages (name, credits, price_cents, bonus_percent, sort_order, is_active) VALUES
  ('Try It',  7,   99,   0,  1, true),
  ('Starter', 25,  299,  0,  2, true),
  ('Popular', 55,  599,  10, 3, true),
  ('Pro',     100, 999,  15, 4, true),
  ('Studio',  250, 2499, 20, 5, true);

-- NOTE: After running this migration, create Stripe Products/Prices and
-- update each package's stripe_price_id:
-- UPDATE credit_packages SET stripe_price_id = 'price_xxx' WHERE name = 'Try It';
-- UPDATE credit_packages SET stripe_price_id = 'price_xxx' WHERE name = 'Starter';
-- etc.

-- =============================================================================
-- 3. UPDATE add_credits RPC TO SUPPORT FIRST-PURCHASE BONUS
-- The bonus is calculated client-side and passed as p_amount (total including bonus).
-- The metadata tracks the breakdown for auditing.
-- =============================================================================

-- The existing add_credits RPC already handles this correctly:
-- - It accepts p_amount (total credits to add)
-- - It updates lifetime_purchased_credits
-- - It has idempotency guard on stripe_payment_intent_id
-- No changes needed to the RPC itself.

-- =============================================================================
-- 4. UPDATE FEATURE FLAG CONFIG SCHEMA
-- Add cooldown config to ai_video_generation flag.
-- =============================================================================

UPDATE feature_flags
SET config = COALESCE(config, '{}'::jsonb) || '{"free_cooldown_hours": 72, "free_model": "kling-2.6"}'::jsonb
WHERE key = 'ai_video_generation';
