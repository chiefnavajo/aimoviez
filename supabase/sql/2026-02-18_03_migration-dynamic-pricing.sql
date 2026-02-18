-- Migration: AI-Powered Dynamic Pricing System
-- Date: 2026-02-18
-- Purpose: Add margin tracking columns, pricing RPCs, and pricing_alerts table
--          to guarantee 30-40% profit margin on every video generation.

-- =============================================================================
-- 1. ADD MARGIN TRACKING COLUMNS TO model_pricing
-- =============================================================================

ALTER TABLE model_pricing
  ADD COLUMN IF NOT EXISTS target_margin_percent INTEGER DEFAULT 35,
  ADD COLUMN IF NOT EXISTS min_credit_cost INTEGER,
  ADD COLUMN IF NOT EXISTS last_cost_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cost_drift_detected BOOLEAN DEFAULT FALSE;

-- =============================================================================
-- 2. PRICING ALERTS TABLE
-- Stores AI recommendations and margin warnings for admin review.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pricing_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key VARCHAR(50) NOT NULL,
  alert_type VARCHAR(30) NOT NULL,
  severity VARCHAR(10) NOT NULL DEFAULT 'warning',
  current_margin_percent NUMERIC(5,2),
  recommended_credit_cost INTEGER,
  ai_analysis TEXT,
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_alert_type CHECK (alert_type IN ('margin_low', 'margin_high', 'cost_drift', 'recommendation')),
  CONSTRAINT valid_severity CHECK (severity IN ('info', 'warning', 'critical'))
);

CREATE INDEX IF NOT EXISTS idx_pricing_alerts_unresolved
  ON pricing_alerts(is_resolved, created_at DESC)
  WHERE is_resolved = FALSE;

-- =============================================================================
-- 3. RPC: calculate_min_credit_cost
-- Computes the minimum credit_cost for a given fal.ai cost and target margin,
-- using the worst-case $/credit from active credit packages.
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_min_credit_cost(
  p_fal_cost_cents INTEGER,
  p_target_margin_percent INTEGER DEFAULT 35
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_worst_case_cents_per_credit NUMERIC;
  v_min_credits INTEGER;
BEGIN
  -- Find worst-case (lowest) revenue per credit across all active packages
  -- worst_case = min(price_cents / total_credits) where total_credits = credits + floor(credits * bonus_percent / 100)
  SELECT MIN(
    p.price_cents::NUMERIC / (p.credits + FLOOR(p.credits * p.bonus_percent / 100.0))
  )
  INTO v_worst_case_cents_per_credit
  FROM credit_packages p
  WHERE p.is_active = TRUE;

  -- If no active packages, return a safe high value
  IF v_worst_case_cents_per_credit IS NULL OR v_worst_case_cents_per_credit <= 0 THEN
    RETURN 999;
  END IF;

  -- min_credit_cost = ceil(fal_cost / (worst_case_per_credit * (1 - margin/100)))
  v_min_credits := CEIL(
    p_fal_cost_cents::NUMERIC / (v_worst_case_cents_per_credit * (1.0 - p_target_margin_percent / 100.0))
  );

  -- Ensure at least 1 credit
  IF v_min_credits < 1 THEN
    v_min_credits := 1;
  END IF;

  RETURN v_min_credits;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_min_credit_cost(INTEGER, INTEGER) TO service_role;

-- =============================================================================
-- 4. RPC: recalculate_all_pricing
-- Loops through all active models, calculates min_credit_cost, and updates
-- credit_cost if it falls below the minimum (to protect margins).
-- Returns a summary of changes made.
-- =============================================================================

CREATE OR REPLACE FUNCTION recalculate_all_pricing()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_model RECORD;
  v_min_cost INTEGER;
  v_changes JSONB := '[]'::JSONB;
BEGIN
  FOR v_model IN
    SELECT model_key, fal_cost_cents, credit_cost, target_margin_percent
    FROM model_pricing
    WHERE is_active = TRUE
  LOOP
    v_min_cost := calculate_min_credit_cost(
      v_model.fal_cost_cents,
      COALESCE(v_model.target_margin_percent, 35)
    );

    -- Update min_credit_cost always, update credit_cost only if below minimum
    UPDATE model_pricing
    SET
      min_credit_cost = v_min_cost,
      credit_cost = CASE
        WHEN credit_cost < v_min_cost THEN v_min_cost
        ELSE credit_cost
      END,
      updated_at = NOW()
    WHERE model_key = v_model.model_key;

    -- Track changes
    IF v_model.credit_cost < v_min_cost THEN
      v_changes := v_changes || jsonb_build_object(
        'model_key', v_model.model_key,
        'old_credit_cost', v_model.credit_cost,
        'new_credit_cost', v_min_cost,
        'reason', 'credit_cost below minimum for target margin'
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'models_checked', (SELECT COUNT(*) FROM model_pricing WHERE is_active = TRUE),
    'changes', v_changes
  );
END;
$$;

GRANT EXECUTE ON FUNCTION recalculate_all_pricing() TO service_role;

-- =============================================================================
-- 5. INITIALIZE min_credit_cost FOR EXISTING MODELS
-- =============================================================================

-- Run recalculate to populate min_credit_cost for all existing models
SELECT recalculate_all_pricing();

-- =============================================================================
-- 6. UPDATE FEATURE FLAG CONFIG WITH PRICING SETTINGS
-- =============================================================================

UPDATE feature_flags
SET config = COALESCE(config, '{}'::jsonb) || '{
  "pricing_auto_adjust": false,
  "pricing_target_margin_min": 30,
  "pricing_target_margin_max": 40,
  "pricing_check_interval_hours": 6,
  "pricing_drift_threshold_percent": 10
}'::jsonb
WHERE key = 'ai_video_generation';
