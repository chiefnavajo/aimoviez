-- Fix: Reject negative amounts in deduct_credits and add_credits
-- Prevents credit manipulation via negative amount exploitation

-- =============================================================================
-- deduct_credits: Add p_amount > 0 guard
-- =============================================================================
CREATE OR REPLACE FUNCTION "public"."deduct_credits"("p_user_id" "uuid", "p_amount" integer, "p_generation_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Validate amount is positive
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

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
$$;

-- =============================================================================
-- add_credits: Add p_amount > 0 guard
-- =============================================================================
CREATE OR REPLACE FUNCTION "public"."add_credits"("p_user_id" "uuid", "p_amount" integer, "p_stripe_payment_intent_id" character varying DEFAULT NULL::character varying, "p_package_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_current_balance INTEGER;
  v_new_balance INTEGER;
  v_already_processed BOOLEAN;
BEGIN
  -- Validate amount is positive
  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

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
$$;
