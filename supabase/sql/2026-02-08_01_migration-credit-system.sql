-- Migration: Credit-Based Monetization System
-- Every AI video generation costs credits. No free tier.
-- Users purchase credit packages via Stripe, admins control pricing/margins.

-- =============================================================================
-- 1. CREDIT PACKAGES (admin-configurable pricing tiers)
-- =============================================================================

CREATE TABLE IF NOT EXISTS credit_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  credits INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  bonus_percent INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  stripe_price_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_packages_active
  ON credit_packages(is_active, sort_order) WHERE is_active = TRUE;

-- Seed data
INSERT INTO credit_packages (name, credits, price_cents, bonus_percent, sort_order) VALUES
  ('Starter', 10, 199, 0, 1),
  ('Popular', 20, 349, 10, 2),
  ('Pro', 50, 799, 20, 3),
  ('Studio', 100, 1499, 25, 4)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 2. MODEL PRICING (admin margins per AI model)
-- =============================================================================

CREATE TABLE IF NOT EXISTS model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  fal_cost_cents INTEGER NOT NULL,
  credit_cost INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data based on current fal.ai pricing
INSERT INTO model_pricing (model_key, display_name, fal_cost_cents, credit_cost) VALUES
  ('kling-2.6', 'Kling 2.6', 35, 7),
  ('hailuo-2.3', 'Hailuo 2.3', 49, 9),
  ('veo3-fast', 'Veo3 Fast', 80, 15),
  ('sora-2', 'Sora 2', 80, 15),
  ('kling-o1-ref', 'Kling O1 Reference', 56, 11)
ON CONFLICT (model_key) DO UPDATE SET
  fal_cost_cents = EXCLUDED.fal_cost_cents,
  credit_cost = EXCLUDED.credit_cost;

-- =============================================================================
-- 3. USER CREDIT BALANCE (add columns to users table)
-- =============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS balance_credits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_purchased_credits INTEGER DEFAULT 0;

-- Ensure non-negative balance
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_balance_non_negative;
ALTER TABLE users
  ADD CONSTRAINT users_balance_non_negative CHECK (balance_credits >= 0);

-- =============================================================================
-- 4. CREDIT TRANSACTIONS (audit trail)
-- =============================================================================

CREATE TABLE IF NOT EXISTS credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(30) NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference_id UUID,
  stripe_payment_intent_id VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_transaction_type CHECK (type IN ('purchase', 'generation', 'refund', 'admin_grant', 'admin_deduct', 'bonus'))
);

CREATE INDEX IF NOT EXISTS idx_credit_trans_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_trans_type ON credit_transactions(type);
CREATE INDEX IF NOT EXISTS idx_credit_trans_ref ON credit_transactions(reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_trans_stripe ON credit_transactions(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- =============================================================================
-- 5. AI GENERATIONS - ADD CREDIT TRACKING COLUMNS
-- =============================================================================

ALTER TABLE ai_generations
  ADD COLUMN IF NOT EXISTS credit_deducted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS credit_amount INTEGER;

-- Index for finding orphaned paid generations
CREATE INDEX IF NOT EXISTS idx_ai_gen_credit_orphans
  ON ai_generations(credit_deducted, status, created_at)
  WHERE credit_deducted = TRUE AND status IN ('pending', 'processing', 'failed');

-- =============================================================================
-- 6. RPC: DEDUCT CREDITS (atomic, with double-spend prevention)
-- =============================================================================

CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_generation_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Lock row for update (prevents race conditions)
  SELECT balance_credits INTO v_current_balance
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  IF v_current_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient credits', 'current', v_current_balance, 'required', p_amount);
  END IF;

  v_new_balance := v_current_balance - p_amount;

  -- Update balance
  UPDATE users SET balance_credits = v_new_balance WHERE id = p_user_id;

  -- Log transaction
  INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id)
  VALUES (p_user_id, 'generation', -p_amount, v_new_balance, p_generation_id);

  -- Mark generation as charged
  UPDATE ai_generations
  SET credit_deducted = TRUE, credit_amount = p_amount
  WHERE id = p_generation_id;

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance, 'deducted', p_amount);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 7. RPC: REFUND CREDITS (for failed generations)
-- =============================================================================

CREATE OR REPLACE FUNCTION refund_credits(
  p_user_id UUID,
  p_generation_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_original_amount INTEGER;
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_already_refunded BOOLEAN;
BEGIN
  -- Check if already refunded
  SELECT EXISTS (
    SELECT 1 FROM credit_transactions
    WHERE reference_id = p_generation_id AND type = 'refund'
  ) INTO v_already_refunded;

  IF v_already_refunded THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already refunded');
  END IF;

  -- Find original deduction amount from generation record
  SELECT credit_amount INTO v_original_amount
  FROM ai_generations
  WHERE id = p_generation_id AND credit_deducted = TRUE;

  IF v_original_amount IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No credit transaction found for generation');
  END IF;

  -- Lock and update user balance
  SELECT balance_credits INTO v_current_balance
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  v_new_balance := v_current_balance + v_original_amount;

  UPDATE users SET balance_credits = v_new_balance WHERE id = p_user_id;

  -- Log refund transaction
  INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, metadata)
  VALUES (p_user_id, 'refund', v_original_amount, v_new_balance, p_generation_id,
          jsonb_build_object('reason', 'generation_failed'));

  RETURN jsonb_build_object('success', true, 'refunded', v_original_amount, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 8. RPC: ADD CREDITS (for purchases via Stripe webhook)
-- =============================================================================

CREATE OR REPLACE FUNCTION add_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_stripe_payment_intent_id VARCHAR(100) DEFAULT NULL,
  p_package_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_already_processed BOOLEAN;
BEGIN
  -- Idempotency check for Stripe payments
  IF p_stripe_payment_intent_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM credit_transactions
      WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
    ) INTO v_already_processed;

    IF v_already_processed THEN
      RETURN jsonb_build_object('success', false, 'error', 'Payment already processed');
    END IF;
  END IF;

  -- Lock and update user balance
  SELECT balance_credits INTO v_current_balance
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  v_new_balance := v_current_balance + p_amount;

  UPDATE users
  SET balance_credits = v_new_balance,
      lifetime_purchased_credits = lifetime_purchased_credits + p_amount
  WHERE id = p_user_id;

  -- Log purchase transaction
  INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, stripe_payment_intent_id, metadata)
  VALUES (p_user_id, 'purchase', p_amount, v_new_balance, p_package_id, p_stripe_payment_intent_id,
          jsonb_build_object('package_id', p_package_id));

  RETURN jsonb_build_object('success', true, 'added', p_amount, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 9. RPC: ADMIN GRANT CREDITS
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_grant_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  SELECT balance_credits INTO v_current_balance
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  v_new_balance := v_current_balance + p_amount;

  UPDATE users SET balance_credits = v_new_balance WHERE id = p_user_id;

  INSERT INTO credit_transactions (user_id, type, amount, balance_after, metadata)
  VALUES (p_user_id, 'admin_grant', p_amount, v_new_balance,
          jsonb_build_object('reason', COALESCE(p_reason, 'Admin grant')));

  RETURN jsonb_build_object('success', true, 'granted', p_amount, 'new_balance', v_new_balance);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 10. RPC: GET MODEL CREDIT COST
-- =============================================================================

CREATE OR REPLACE FUNCTION get_model_credit_cost(p_model_key VARCHAR(50))
RETURNS INTEGER AS $$
DECLARE
  v_cost INTEGER;
BEGIN
  SELECT credit_cost INTO v_cost
  FROM model_pricing
  WHERE model_key = p_model_key AND is_active = TRUE;

  -- Fallback to 10 credits if model not found
  RETURN COALESCE(v_cost, 10);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 11. ROW LEVEL SECURITY
-- =============================================================================

-- Credit packages: public read for active packages
ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_packages_public_read ON credit_packages;
CREATE POLICY credit_packages_public_read ON credit_packages
  FOR SELECT USING (is_active = TRUE);

-- Model pricing: public read for active models
ALTER TABLE model_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_pricing_public_read ON model_pricing;
CREATE POLICY model_pricing_public_read ON model_pricing
  FOR SELECT USING (is_active = TRUE);

-- Credit transactions: users read own only
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_trans_own_read ON credit_transactions;
CREATE POLICY credit_trans_own_read ON credit_transactions
  FOR SELECT USING (user_id = auth.uid());

-- =============================================================================
-- 12. FEATURE FLAG FOR CREDIT SYSTEM
-- =============================================================================

INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('credit_system', 'Credit-Based Payments', 'Enable credit-based monetization for AI generation', 'monetization', FALSE,
   '{"stripe_enabled": false, "min_purchase_credits": 10}')
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 13. SYSTEM CACHE TABLE (for JWKS fallback)
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_cache (
  key VARCHAR(100) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 14. CRON LOCKS TABLE - SKIPPED (already exists)
-- =============================================================================
-- The cron_locks table already exists with columns:
-- job_name, lock_id, expires_at, acquired_at
-- No changes needed.
