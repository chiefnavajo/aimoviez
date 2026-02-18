


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



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


ALTER FUNCTION "public"."add_credits"("p_user_id" "uuid", "p_amount" integer, "p_stripe_payment_intent_id" character varying, "p_package_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_team_xp"("p_user_id" "uuid", "p_xp_amount" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_team_id UUID;
BEGIN
  SELECT team_id INTO v_team_id FROM team_members WHERE user_id = p_user_id;
  IF v_team_id IS NULL THEN RETURN; END IF;

  -- Update team total XP
  UPDATE teams SET total_xp = total_xp + p_xp_amount, updated_at = NOW()
  WHERE id = v_team_id;

  -- Update member contribution
  UPDATE team_members SET contribution_xp = contribution_xp + p_xp_amount
  WHERE user_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."add_team_xp"("p_user_id" "uuid", "p_xp_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_user_xp"("user_id" "uuid", "xp_to_add" integer) RETURNS TABLE("new_xp" integer, "new_level" integer, "level_up" boolean)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  old_level INTEGER;
  updated_xp INTEGER;
  updated_level INTEGER;
BEGIN
  -- Get current level
  SELECT level INTO old_level FROM users WHERE id = user_id;
  
  -- Update XP
  UPDATE users 
  SET xp = xp + xp_to_add,
      level = calculate_level(xp + xp_to_add)
  WHERE id = user_id
  RETURNING xp, level INTO updated_xp, updated_level;
  
  RETURN QUERY SELECT updated_xp, updated_level, updated_level > old_level;
END;
$$;


ALTER FUNCTION "public"."add_user_xp"("user_id" "uuid", "xp_to_add" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_approve_clip_atomic"("p_clip_id" "uuid", "p_admin_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("success" boolean, "clip_id" "uuid", "assigned_slot" integer, "resumed_voting" boolean, "error_message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_clip RECORD;
  v_active_slot RECORD;
  v_assigned_slot INTEGER;
  v_resumed_voting BOOLEAN := FALSE;
  v_duration_hours INTEGER := 24;
  v_voting_ends_at TIMESTAMPTZ;
  v_is_admin BOOLEAN;
BEGIN
  -- SECURITY: Verify the caller is an admin
  IF p_admin_id IS NULL THEN
    RETURN QUERY SELECT FALSE, p_clip_id, NULL::INTEGER, FALSE, 'Admin ID is required'::TEXT;
    RETURN;
  END IF;

  SELECT u.is_admin INTO v_is_admin
  FROM users u WHERE u.id = p_admin_id;

  IF v_is_admin IS NOT TRUE THEN
    RETURN QUERY SELECT FALSE, p_clip_id, NULL::INTEGER, FALSE, 'Unauthorized: caller is not an admin'::TEXT;
    RETURN;
  END IF;

  -- Lock and get the clip
  SELECT tc.id, tc.status, tc.season_id, tc.username
  INTO v_clip
  FROM tournament_clips tc
  WHERE tc.id = p_clip_id
  FOR UPDATE;

  IF v_clip IS NULL THEN
    RETURN QUERY SELECT FALSE, p_clip_id, NULL::INTEGER, FALSE, 'Clip not found'::TEXT;
    RETURN;
  END IF;

  -- Find and lock the active slot for this season
  SELECT ss.id, ss.slot_position, ss.status, ss.voting_duration_hours
  INTO v_active_slot
  FROM story_slots ss
  WHERE ss.season_id = v_clip.season_id
    AND ss.status IN ('voting', 'waiting_for_clips')
  ORDER BY ss.slot_position ASC
  LIMIT 1
  FOR UPDATE;

  IF v_active_slot IS NOT NULL THEN
    v_assigned_slot := v_active_slot.slot_position;

    -- If slot is waiting for clips, activate voting
    IF v_active_slot.status = 'waiting_for_clips' THEN
      v_duration_hours := COALESCE(v_active_slot.voting_duration_hours, 24);
      v_voting_ends_at := NOW() + (v_duration_hours || ' hours')::INTERVAL;

      UPDATE story_slots
      SET status = 'voting',
          voting_started_at = NOW(),
          voting_ends_at = v_voting_ends_at,
          voting_duration_hours = v_duration_hours
      WHERE id = v_active_slot.id;

      v_resumed_voting := TRUE;
    END IF;
  END IF;

  -- Update the clip (preserve existing slot_position if no active slot found)
  UPDATE tournament_clips
  SET status = 'active',
      slot_position = COALESCE(v_assigned_slot, slot_position),
      updated_at = NOW()
  WHERE id = p_clip_id;

  RETURN QUERY SELECT
    TRUE,
    p_clip_id,
    v_assigned_slot,
    v_resumed_voting,
    NULL::TEXT;

EXCEPTION
  WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, p_clip_id, NULL::INTEGER, FALSE, SQLERRM::TEXT;
END;
$$;


ALTER FUNCTION "public"."admin_approve_clip_atomic"("p_clip_id" "uuid", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_grant_credits"("p_user_id" "uuid", "p_amount" integer, "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
  DECLARE
    v_current_balance INTEGER;
    v_new_balance INTEGER;
  BEGIN
    -- Validate that amount is positive to prevent accidental or malicious negative grants
    IF p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
    END IF;

    SELECT balance_credits INTO v_current_balance
    FROM users WHERE id = p_user_id FOR UPDATE;

    IF v_current_balance IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    v_new_balance := v_current_balance + p_amount;

    UPDATE users
    SET balance_credits = v_new_balance,
        lifetime_earned_credits = lifetime_earned_credits + p_amount
    WHERE id = p_user_id;

    INSERT INTO credit_transactions (user_id, type, amount, balance_after, metadata)
    VALUES (p_user_id, 'admin_grant', p_amount, v_new_balance,
            jsonb_build_object('reason', COALESCE(p_reason, 'Admin grant')));

    RETURN jsonb_build_object('success', true, 'granted', p_amount, 'new_balance', v_new_balance);
  END;
  $$;


ALTER FUNCTION "public"."admin_grant_credits"("p_user_id" "uuid", "p_amount" integer, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."append_reference_angle"("p_id" "uuid", "p_url" "text", "p_max_refs" integer DEFAULT 6) RETURNS TABLE("id" "uuid", "reference_image_urls" "text"[])
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  UPDATE pinned_characters pc
  SET reference_image_urls = pc.reference_image_urls || p_url
  WHERE pc.id = p_id
    AND coalesce(array_length(pc.reference_image_urls, 1), 0) < p_max_refs
  RETURNING pc.id, pc.reference_image_urls;
END;
$$;


ALTER FUNCTION "public"."append_reference_angle"("p_id" "uuid", "p_url" "text", "p_max_refs" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_daily_decay"("p_decay_rate" double precision DEFAULT 0.995) RETURNS TABLE("scene_vocab_decayed" integer, "visual_vocab_decayed" integer, "patterns_decayed" integer, "terms_pruned" integer)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_scene_count INTEGER := 0;
  v_visual_count INTEGER := 0;
  v_pattern_count INTEGER := 0;
  v_pruned INTEGER := 0;
BEGIN
  -- Apply decay to scene vocabulary
  UPDATE scene_vocabulary
  SET
    decay_factor = decay_factor * p_decay_rate,
    updated_at = NOW()
  WHERE decay_factor > 0.01;

  GET DIAGNOSTICS v_scene_count = ROW_COUNT;

  -- Apply decay to visual vocabulary
  UPDATE visual_vocabulary
  SET
    decay_factor = decay_factor * p_decay_rate,
    updated_at = NOW()
  WHERE decay_factor > 0.01;

  GET DIAGNOSTICS v_visual_count = ROW_COUNT;

  -- Apply decay to model patterns
  UPDATE model_prompt_patterns
  SET
    decay_factor = decay_factor * p_decay_rate,
    updated_at = NOW()
  WHERE decay_factor > 0.01;

  GET DIAGNOSTICS v_pattern_count = ROW_COUNT;

  -- Prune terms that have decayed below threshold
  DELETE FROM scene_vocabulary WHERE decay_factor < 0.01 AND frequency < 5;
  DELETE FROM visual_vocabulary WHERE decay_factor < 0.01 AND frequency < 5;
  DELETE FROM model_prompt_patterns WHERE decay_factor < 0.01 AND usage_count < 5;

  GET DIAGNOSTICS v_pruned = ROW_COUNT;

  scene_vocab_decayed := v_scene_count;
  visual_vocab_decayed := v_visual_count;
  patterns_decayed := v_pattern_count;
  terms_pruned := v_pruned;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."apply_daily_decay"("p_decay_rate" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_comment"("p_comment_id" "uuid", "p_admin_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE comments
  SET
    moderation_status = 'approved',
    moderated_by = p_admin_id,
    moderated_at = NOW()
  WHERE id = p_comment_id;

  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."approve_comment"("p_comment_id" "uuid", "p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_winner_atomic"("p_clip_id" "uuid", "p_slot_id" "uuid", "p_season_id" "uuid", "p_next_slot_position" integer, "p_voting_duration_hours" integer DEFAULT 24, "p_advance_slot" boolean DEFAULT true) RETURNS TABLE("success" boolean, "message" "text", "winner_clip_id" "uuid", "slot_locked" integer, "next_slot_position" integer, "clips_moved" integer, "season_finished" boolean)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_current_slot_position INTEGER;
  v_current_status TEXT;
  v_total_slots INTEGER;
  v_clips_eliminated INTEGER := 0;
  v_season_finished BOOLEAN := FALSE;
  v_now TIMESTAMP := NOW();
  v_voting_ends_at TIMESTAMP;
BEGIN
  -- Lock the slot row to prevent concurrent winner assignment (FOR UPDATE)
  SELECT slot_position, status INTO v_current_slot_position, v_current_status
  FROM story_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  -- Verify slot is still in voting state (race guard)
  IF v_current_status != 'voting' THEN
    RETURN QUERY SELECT
      FALSE,
      ('Slot is no longer in voting state (current: ' || COALESCE(v_current_status, 'unknown') || ')')::TEXT,
      NULL::UUID, NULL::INTEGER, NULL::INTEGER, 0, FALSE;
    RETURN;
  END IF;

  -- Get total slots from season
  SELECT total_slots INTO v_total_slots
  FROM seasons
  WHERE id = p_season_id;

  -- 1. Lock the current slot with the selected winner
  UPDATE story_slots
  SET
    status = 'locked',
    winner_tournament_clip_id = p_clip_id
  WHERE id = p_slot_id;

  -- 2. Mark the winning clip as 'locked'
  UPDATE tournament_clips
  SET status = 'locked'
  WHERE id = p_clip_id;

  -- 3. Handle slot advancement
  IF p_advance_slot THEN
    -- Eliminate losing clips — they don't carry forward
    WITH eliminated AS (
      UPDATE tournament_clips
      SET
        status = 'eliminated',
        eliminated_at = v_now,
        elimination_reason = 'lost'
      WHERE slot_position = v_current_slot_position
        AND season_id = p_season_id
        AND status = 'active'
        AND id != p_clip_id
      RETURNING id
    )
    SELECT COUNT(*) INTO v_clips_eliminated FROM eliminated;

    IF p_next_slot_position > COALESCE(v_total_slots, 75) THEN
      -- Season is finished
      UPDATE seasons
      SET status = 'finished'
      WHERE id = p_season_id;

      -- Eliminate any remaining active clips in the season (safety net)
      UPDATE tournament_clips
      SET
        status = 'eliminated',
        eliminated_at = v_now,
        elimination_reason = 'season_ended'
      WHERE season_id = p_season_id
        AND status = 'active';

      v_season_finished := TRUE;
    ELSE
      -- Check if next slot already has clips (from new uploads)
      IF (SELECT COUNT(*) FROM tournament_clips
          WHERE slot_position = p_next_slot_position
            AND season_id = p_season_id
            AND status = 'active') > 0 THEN
        -- Clips exist — activate next slot for voting
        v_voting_ends_at := v_now + (p_voting_duration_hours || ' hours')::INTERVAL;

        UPDATE story_slots
        SET
          status = 'voting',
          voting_started_at = v_now,
          voting_ends_at = v_voting_ends_at,
          voting_duration_hours = p_voting_duration_hours
        WHERE season_id = p_season_id
          AND slot_position = p_next_slot_position;
      ELSE
        -- No clips — set to waiting_for_clips
        UPDATE story_slots
        SET
          status = 'waiting_for_clips',
          voting_started_at = NULL,
          voting_ends_at = NULL
        WHERE season_id = p_season_id
          AND slot_position = p_next_slot_position;
      END IF;
    END IF;
  END IF;

  -- Return result (clips_moved field now represents clips_eliminated for backward compat)
  RETURN QUERY SELECT
    TRUE,
    'Winner assigned successfully'::TEXT,
    p_clip_id,
    v_current_slot_position,
    CASE WHEN v_season_finished THEN NULL ELSE p_next_slot_position END,
    v_clips_eliminated,
    v_season_finished;

EXCEPTION WHEN OTHERS THEN
  -- On any error, the transaction is rolled back automatically
  RETURN QUERY SELECT
    FALSE,
    ('Error: ' || SQLERRM)::TEXT,
    NULL::UUID,
    NULL::INTEGER,
    NULL::INTEGER,
    0,
    FALSE;
END;
$$;


ALTER FUNCTION "public"."assign_winner_atomic"("p_clip_id" "uuid", "p_slot_id" "uuid", "p_season_id" "uuid", "p_next_slot_position" integer, "p_voting_duration_hours" integer, "p_advance_slot" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."batch_update_vote_counts"("p_updates" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$                                                                                                                                                                               
  DECLARE                                                                                                                                                                             
    v_item JSONB;                                                                                                                                                                     
    v_clip_id UUID;                                                                                                                                                                   
    v_vote_count INTEGER;                                                                                                                                                             
    v_weighted_score INTEGER;                                                                                                                                                         
    v_updated_count INTEGER := 0;                                                                                                                                                     
    v_errors JSONB := '[]'::JSONB;                                                                                                                                                    
    v_error_text TEXT;                                                                                                                                                                
  BEGIN                                                                                                                                                                               
    IF jsonb_typeof(p_updates) != 'array' THEN                                                                                                                                        
      RETURN jsonb_build_object(                                                                                                                                                      
        'updated_count', 0,                                                                                                                                                           
        'errors', jsonb_build_array(                                                                                                                                                  
          jsonb_build_object('clip_id', NULL, 'error', 'p_updates must be a JSON array')                                                                                              
        )                                                                                                                                                                             
      );                                                                                                                                                                              
    END IF;                                                                                                                                                                           
                                                                                                                                                                                      
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_updates)                                                                                                                       
    LOOP                                                                                                                                                                              
      BEGIN                                                                                                                                                                           
        v_clip_id := (v_item ->> 'clip_id')::UUID;                                                                                                                                    
        v_vote_count := (v_item ->> 'vote_count')::INTEGER;                                                                                                                           
        v_weighted_score := (v_item ->> 'weighted_score')::INTEGER;                                                                                                                   
                                                                                                                                                                                      
        UPDATE tournament_clips                                                                                                                                                       
        SET                                                                                                                                                                           
          vote_count = v_vote_count,                                                                                                                                                  
          weighted_score = v_weighted_score,                                                                                                                                          
          updated_at = NOW()                                                                                                                                                          
        WHERE id = v_clip_id;                                                                                                                                                         
                                                                                                                                                                                      
        IF FOUND THEN                                                                                                                                                                 
          v_updated_count := v_updated_count + 1;                                                                                                                                     
        ELSE                                                                                                                                                                          
          v_errors := v_errors || jsonb_build_array(                                                                                                                                  
            jsonb_build_object(                                                                                                                                                       
              'clip_id', v_item ->> 'clip_id',                                                                                                                                        
              'error', 'Clip not found'                                                                                                                                               
            )                                                                                                                                                                         
          );                                                                                                                                                                          
        END IF;                                                                                                                                                                       
                                                                                                                                                                                      
      EXCEPTION                                                                                                                                                                       
        WHEN OTHERS THEN                                                                                                                                                              
          GET STACKED DIAGNOSTICS v_error_text = MESSAGE_TEXT;                                                                                                                        
          v_errors := v_errors || jsonb_build_array(                                                                                                                                  
            jsonb_build_object(                                                                                                                                                       
              'clip_id', v_item ->> 'clip_id',                                                                                                                                        
              'error', v_error_text                                                                                                                                                   
            )                                                                                                                                                                         
          );                                                                                                                                                                          
      END;                                                                                                                                                                            
    END LOOP;                                                                                                                                                                         
                                                                                                                                                                                      
    RETURN jsonb_build_object(                                                                                                                                                        
      'updated_count', v_updated_count,                                                                                                                                               
      'errors', v_errors                                                                                                                                                              
    );                                                                                                                                                                                
  END;                                                                                                                                                                                
  $$;


ALTER FUNCTION "public"."batch_update_vote_counts"("p_updates" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bulk_sync_prompt_learning"() RETURNS TABLE("synced" integer, "errors" integer)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_synced INTEGER := 0;
  v_errors INTEGER := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      ph.id as prompt_id,
      tc.vote_count,
      (tc.status = 'winner') as is_winner
    FROM prompt_history ph
    JOIN tournament_clips tc ON ph.clip_id = tc.id
    WHERE ph.vote_count != COALESCE(tc.vote_count, 0)
       OR ph.is_winner != (tc.status = 'winner')
  LOOP
    BEGIN
      UPDATE prompt_history
      SET
        vote_count = COALESCE(rec.vote_count, 0),
        is_winner = rec.is_winner,
        updated_at = NOW()
      WHERE id = rec.prompt_id;

      v_synced := v_synced + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
    END;
  END LOOP;

  synced := v_synced;
  errors := v_errors;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."bulk_sync_prompt_learning"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_bayesian_score"("p_total_votes" integer, "p_frequency" integer, "p_winner_count" integer, "p_decay_factor" double precision DEFAULT 1.0, "p_prior_mean" double precision DEFAULT 5.0, "p_prior_weight" integer DEFAULT 10) RETURNS double precision
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_raw_avg FLOAT;
  v_bayesian_avg FLOAT;
  v_winner_bonus FLOAT;
  v_final_score FLOAT;
BEGIN
  -- Handle edge cases
  IF p_frequency = 0 OR p_frequency IS NULL THEN
    RETURN 0.0;
  END IF;

  -- Calculate raw average
  v_raw_avg := COALESCE(p_total_votes, 0)::FLOAT / p_frequency;

  -- Apply Bayesian smoothing: (C × m + sum of votes) / (C + n)
  -- Where C = prior weight, m = prior mean, n = number of samples
  v_bayesian_avg := (p_prior_weight * p_prior_mean + COALESCE(p_total_votes, 0))::FLOAT /
                    (p_prior_weight + p_frequency);

  -- Add winner bonus (up to 50% boost based on win rate)
  v_winner_bonus := 1.0 + (0.5 * COALESCE(p_winner_count, 0)::FLOAT / NULLIF(p_frequency, 0));

  -- Apply decay factor and winner bonus
  v_final_score := v_bayesian_avg * v_winner_bonus * COALESCE(p_decay_factor, 1.0);

  RETURN v_final_score;
END;
$$;


ALTER FUNCTION "public"."calculate_bayesian_score"("p_total_votes" integer, "p_frequency" integer, "p_winner_count" integer, "p_decay_factor" double precision, "p_prior_mean" double precision, "p_prior_weight" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_level"("xp_amount" integer) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN GREATEST(1, floor(sqrt(xp_amount / 100.0)) + 1);
END;
$$;


ALTER FUNCTION "public"."calculate_level"("xp_amount" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_min_credit_cost"("p_fal_cost_cents" integer, "p_target_margin_percent" integer DEFAULT 35) RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
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


ALTER FUNCTION "public"."calculate_min_credit_cost"("p_fal_cost_cents" integer, "p_target_margin_percent" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_reserve_generation"("p_user_id" "uuid", "p_date" "date", "p_max_daily" integer) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO ai_generation_limits (user_id, date, generation_count)
  VALUES (p_user_id, p_date, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET generation_count = ai_generation_limits.generation_count + 1
  WHERE ai_generation_limits.generation_count < p_max_daily
  RETURNING generation_count INTO v_count;

  RETURN COALESCE(v_count, -1); -- -1 means limit reached
END;
$$;


ALTER FUNCTION "public"."check_and_reserve_generation"("p_user_id" "uuid", "p_date" "date", "p_max_daily" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_and_reserve_generation_v2"("p_user_id" "uuid", "p_date" "date", "p_global_max_daily" integer) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."check_and_reserve_generation_v2"("p_user_id" "uuid", "p_date" "date", "p_global_max_daily" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_comment_nesting_depth"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_depth INTEGER := 0;
  v_current_parent UUID := NEW.parent_comment_id;
BEGIN
  -- No parent = top-level comment, always OK
  IF v_current_parent IS NULL THEN
    RETURN NEW;
  END IF;

  -- Walk up the parent chain to count depth
  WHILE v_current_parent IS NOT NULL AND v_depth < 6 LOOP
    v_depth := v_depth + 1;

    SELECT c.parent_comment_id INTO v_current_parent
    FROM comments c WHERE c.id = v_current_parent;
  END LOOP;

  IF v_depth > 5 THEN
    RAISE EXCEPTION 'Maximum comment nesting depth (5) exceeded';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_comment_nesting_depth"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_commenter_not_banned"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_user_id UUID;
  v_is_banned BOOLEAN;
BEGIN
  -- Extract user_id from user_key (format: "user_<uuid>")
  IF NEW.user_key LIKE 'user_%' THEN
    v_user_id := substring(NEW.user_key FROM 6)::UUID;

    SELECT u.is_banned INTO v_is_banned
    FROM users u WHERE u.id = v_user_id;

    IF v_is_banned IS TRUE THEN
      RAISE EXCEPTION 'Banned users cannot comment';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_commenter_not_banned"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_generation_cooldown"("p_user_id" "uuid", "p_cooldown_hours" integer DEFAULT 72) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."check_generation_cooldown"("p_user_id" "uuid", "p_cooldown_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_global_cost_cap"("p_daily_limit_cents" integer, "p_monthly_limit_cents" integer, "p_new_cost_cents" integer) RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_daily_total INTEGER;
  v_monthly_total INTEGER;
BEGIN
  SELECT COALESCE(SUM(cost_cents + COALESCE(narration_cost_cents, 0)), 0) INTO v_daily_total
  FROM ai_generations
  WHERE created_at >= CURRENT_DATE
    AND status != 'failed';

  SELECT COALESCE(SUM(cost_cents + COALESCE(narration_cost_cents, 0)), 0) INTO v_monthly_total
  FROM ai_generations
  WHERE created_at >= date_trunc('month', CURRENT_DATE)
    AND status != 'failed';

  RETURN (v_daily_total + p_new_cost_cents <= p_daily_limit_cents)
     AND (v_monthly_total + p_new_cost_cents <= p_monthly_limit_cents);
END;
$$;


ALTER FUNCTION "public"."check_global_cost_cap"("p_daily_limit_cents" integer, "p_monthly_limit_cents" integer, "p_new_cost_cents" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_voter_not_banned"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_user_id UUID;
  v_is_banned BOOLEAN;
BEGIN
  -- Extract user_id from voter_key (format: "user_<uuid>")
  IF NEW.voter_key LIKE 'user_%' THEN
    v_user_id := substring(NEW.voter_key FROM 6)::UUID;

    SELECT u.is_banned INTO v_is_banned
    FROM users u WHERE u.id = v_user_id;

    IF v_is_banned IS TRUE THEN
      RAISE EXCEPTION 'Banned users cannot vote';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_voter_not_banned"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_clip_views"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM clip_views
  WHERE viewed_at < NOW() - INTERVAL '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_clip_views"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_notifications"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$                                                                                                                                                                                   
  BEGIN                                                                                                                                                                                                
    DELETE FROM notifications                                                                                                                                                                          
    WHERE created_at < NOW() - INTERVAL '30 days'                                                                                                                                                      
      AND is_read = TRUE;                                                                                                                                                                              
  END;                                                                                                                                                                                                 
  $$;


ALTER FUNCTION "public"."cleanup_old_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_team"("p_name" "text", "p_description" "text", "p_leader_id" "uuid") RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_team_id UUID;
  v_existing_team UUID;
BEGIN
  -- Check if user already in a team
  SELECT team_id INTO v_existing_team FROM team_members WHERE user_id = p_leader_id;
  IF v_existing_team IS NOT NULL THEN
    RAISE EXCEPTION 'User is already in a team';
  END IF;

  -- Create team
  INSERT INTO teams (name, description, leader_id, member_count)
  VALUES (p_name, p_description, p_leader_id, 1)
  RETURNING id INTO v_team_id;

  -- Add leader as member
  INSERT INTO team_members (team_id, user_id, role, last_active_date)
  VALUES (v_team_id, p_leader_id, 'leader', CURRENT_DATE);

  RETURN get_team_with_stats(v_team_id);
END;
$$;


ALTER FUNCTION "public"."create_team"("p_name" "text", "p_description" "text", "p_leader_id" "uuid") OWNER TO "postgres";


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


ALTER FUNCTION "public"."deduct_credits"("p_user_id" "uuid", "p_amount" integer, "p_generation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_vote_atomic"("p_voter_key" "text", "p_clip_id" "text") RETURNS TABLE("vote_id" "uuid", "vote_type" "text", "vote_weight" integer, "slot_position" integer, "new_vote_count" integer, "new_weighted_score" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_clip_uuid UUID := p_clip_id::UUID;
  v_vote_id UUID;
  v_vote_type TEXT;
  v_vote_weight INTEGER;
  v_slot_position INTEGER;
  v_new_vote_count INTEGER;
  v_new_weighted_score INTEGER;
BEGIN
  -- Lock the vote row and verify ownership in one step
  -- This prevents TOCTOU race conditions
  SELECT v.id, v.vote_type, v.vote_weight, v.slot_position
  INTO v_vote_id, v_vote_type, v_vote_weight, v_slot_position
  FROM votes v
  WHERE v.voter_key = p_voter_key
    AND v.clip_id = v_clip_uuid
  FOR UPDATE;  -- Lock the row

  -- If no vote found, return empty result
  IF v_vote_id IS NULL THEN
    RETURN;
  END IF;

  -- Delete the vote (this will trigger update_clip_vote_count_on_delete)
  DELETE FROM votes WHERE id = v_vote_id;

  -- Get the updated clip stats
  SELECT tc.vote_count, tc.weighted_score
  INTO v_new_vote_count, v_new_weighted_score
  FROM tournament_clips tc
  WHERE tc.id = v_clip_uuid;

  -- Return the result
  RETURN QUERY SELECT
    v_vote_id,
    v_vote_type,
    v_vote_weight,
    v_slot_position,
    COALESCE(v_new_vote_count, 0),
    COALESCE(v_new_weighted_score, 0)::INTEGER;
END;
$$;


ALTER FUNCTION "public"."delete_vote_atomic"("p_voter_key" "text", "p_clip_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."flag_comment"("p_comment_id" "uuid", "p_reason" "text" DEFAULT 'User reported'::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE comments
  SET
    moderation_status = 'flagged',
    moderation_reason = p_reason
  WHERE id = p_comment_id
    AND moderation_status = 'approved';

  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."flag_comment"("p_comment_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_invite_code"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$;


ALTER FUNCTION "public"."generate_invite_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_clips_for_voting"("p_slot_position" integer, "p_season_id" "uuid", "p_voter_key" "text", "p_limit" integer DEFAULT 8, "p_pool_size" integer DEFAULT 100) RETURNS TABLE("id" "uuid", "thumbnail_url" "text", "video_url" "text", "username" "text", "avatar_url" "text", "genre" "text", "slot_position" integer, "vote_count" integer, "weighted_score" numeric, "view_count" integer, "created_at" timestamp with time zone, "has_voted" boolean, "has_seen" boolean)
    LANGUAGE "plpgsql"
    AS $$                                                                                                                                   
  DECLARE                                                                                                                                   
    total_clips INTEGER;                                                                                                                    
  BEGIN                                                                                                                                     
    SELECT COUNT(*) INTO total_clips                                                                                                        
    FROM tournament_clips tc                                                                                                                
    WHERE tc.slot_position = p_slot_position                                                                                                
      AND tc.season_id = p_season_id                                                                                                        
      AND tc.status = 'active';                                                                                                             
                                                                                                                                            
    IF total_clips <= 1000 THEN                                                                                                             
      RETURN QUERY                                                                                                                          
      SELECT                                                                                                                                
        tc.id,                                                                                                                              
        tc.thumbnail_url,                                                                                                                   
        tc.video_url,                                                                                                                       
        tc.username,                                                                                                                        
        tc.avatar_url,                                                                                                                      
        tc.genre,                                                                                                                           
        tc.slot_position,                                                                                                                   
        tc.vote_count,                                                                                                                      
        tc.weighted_score,                                                                                                                  
        tc.view_count,                                                                                                                      
        tc.created_at,                                                                                                                      
        EXISTS(SELECT 1 FROM votes v WHERE v.clip_id = tc.id AND v.voter_key = p_voter_key) as has_voted,                                   
        EXISTS(SELECT 1 FROM clip_views cv WHERE cv.clip_id = tc.id AND cv.voter_key = p_voter_key) as has_seen                             
      FROM tournament_clips tc                                                                                                              
      WHERE tc.slot_position = p_slot_position                                                                                              
        AND tc.season_id = p_season_id                                                                                                      
        AND tc.status = 'active'                                                                                                            
        AND NOT EXISTS(SELECT 1 FROM clip_views cv WHERE cv.clip_id = tc.id AND cv.voter_key = p_voter_key)                                 
      ORDER BY tc.view_count ASC, RANDOM()                                                                                                  
      LIMIT p_pool_size;                                                                                                                    
    ELSE                                                                                                                                    
      RETURN QUERY                                                                                                                          
      WITH unseen_clips AS (                                                                                                                
        SELECT tc.*                                                                                                                         
        FROM tournament_clips tc                                                                                                            
        WHERE tc.slot_position = p_slot_position                                                                                            
          AND tc.season_id = p_season_id                                                                                                    
          AND tc.status = 'active'                                                                                                          
          AND NOT EXISTS(SELECT 1 FROM clip_views cv WHERE cv.clip_id = tc.id AND cv.voter_key = p_voter_key)                               
        ORDER BY tc.view_count ASC                                                                                                          
        LIMIT p_pool_size * 2                                                                                                               
      )                                                                                                                                     
      SELECT                                                                                                                                
        uc.id,                                                                                                                              
        uc.thumbnail_url,                                                                                                                   
        uc.video_url,                                                                                                                       
        uc.username,                                                                                                                        
        uc.avatar_url,                                                                                                                      
        uc.genre,                                                                                                                           
        uc.slot_position,                                                                                                                   
        uc.vote_count,                                                                                                                      
        uc.weighted_score,                                                                                                                  
        uc.view_count,                                                                                                                      
        uc.created_at,                                                                                                                      
        EXISTS(SELECT 1 FROM votes v WHERE v.clip_id = uc.id AND v.voter_key = p_voter_key) as has_voted,                                   
        FALSE as has_seen                                                                                                                   
      FROM unseen_clips uc                                                                                                                  
      ORDER BY RANDOM()                                                                                                                     
      LIMIT p_pool_size;                                                                                                                    
    END IF;                                                                                                                                 
  END;                                                                                                                                      
  $$;


ALTER FUNCTION "public"."get_clips_for_voting"("p_slot_position" integer, "p_season_id" "uuid", "p_voter_key" "text", "p_limit" integer, "p_pool_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_comment_counts"("clip_ids" "uuid"[]) RETURNS TABLE("clip_id" "uuid", "count" bigint)
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.clip_id,
    COUNT(*)::bigint as count
  FROM comments c
  WHERE c.clip_id = ANY(clip_ids)
    AND c.is_deleted = false
    AND c.parent_comment_id IS NULL
  GROUP BY c.clip_id;
END;
$$;


ALTER FUNCTION "public"."get_comment_counts"("clip_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_comment_counts"("clip_ids" "uuid"[]) IS 'Efficiently get comment counts for multiple clips in a single aggregated query';



CREATE OR REPLACE FUNCTION "public"."get_feature_config"("feature_key" character varying) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    (SELECT config FROM feature_flags WHERE key = feature_key),
    '{}'::JSONB
  );
$$;


ALTER FUNCTION "public"."get_feature_config"("feature_key" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_genre_vote_stats"("p_voter_key" "text" DEFAULT NULL::"text") RETURNS TABLE("genre" "text", "vote_count" bigint, "user_voted" boolean)
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."get_genre_vote_stats"("p_voter_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_model_credit_cost"("p_model_key" character varying) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_cost INTEGER;
BEGIN
  SELECT credit_cost INTO v_cost
  FROM model_pricing
  WHERE model_key = p_model_key AND is_active = TRUE;

  -- Fallback to 10 credits if model not found
  RETURN COALESCE(v_cost, 10);
END;
$$;


ALTER FUNCTION "public"."get_model_credit_cost"("p_model_key" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_team_leaderboard"("p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0) RETURNS json
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN (
    SELECT json_agg(team_row)
    FROM (
      SELECT
        t.id,
        t.name,
        t.logo_url,
        t.level,
        t.total_xp,
        t.current_streak,
        t.member_count,
        COALESCE(SUM(u.total_votes_cast), 0)::INTEGER as combined_votes,
        (
          SELECT COUNT(*)::INTEGER FROM story_slots ss
          JOIN tournament_clips tc ON ss.winner_tournament_clip_id = tc.id
          JOIN team_members tm2 ON tc.user_id = tm2.user_id
          WHERE tm2.team_id = t.id
        ) as combined_wins,
        ROW_NUMBER() OVER (ORDER BY t.total_xp DESC, t.current_streak DESC) as rank
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN users u ON u.id = tm.user_id
      GROUP BY t.id
      ORDER BY t.total_xp DESC, t.current_streak DESC
      LIMIT p_limit OFFSET p_offset
    ) team_row
  );
END;
$$;


ALTER FUNCTION "public"."get_team_leaderboard"("p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_team_with_stats"("p_team_id" "uuid") RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'id', t.id,
    'name', t.name,
    'description', t.description,
    'logo_url', t.logo_url,
    'leader_id', t.leader_id,
    'level', t.level,
    'total_xp', t.total_xp,
    'current_streak', t.current_streak,
    'longest_streak', t.longest_streak,
    'member_count', t.member_count,
    'created_at', t.created_at,
    'combined_votes', COALESCE(SUM(u.total_votes_cast), 0),
    'combined_wins', (
      SELECT COUNT(*)::INTEGER FROM story_slots ss
      JOIN tournament_clips tc ON ss.winner_tournament_clip_id = tc.id
      JOIN team_members tm2 ON tc.user_id = tm2.user_id
      WHERE tm2.team_id = t.id
    ),
    'members', (
      SELECT json_agg(json_build_object(
        'id', tm.id,
        'user_id', tm.user_id,
        'username', u2.username,
        'avatar_url', u2.avatar_url,
        'role', tm.role,
        'contribution_xp', tm.contribution_xp,
        'contribution_votes', tm.contribution_votes,
        'last_active_date', tm.last_active_date,
        'joined_at', tm.joined_at,
        'level', u2.level
      ) ORDER BY
        CASE tm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
        tm.joined_at
      )
      FROM team_members tm
      JOIN users u2 ON u2.id = tm.user_id
      WHERE tm.team_id = t.id
    )
  ) INTO result
  FROM teams t
  LEFT JOIN team_members tm ON tm.team_id = t.id
  LEFT JOIN users u ON u.id = tm.user_id
  WHERE t.id = p_team_id
  GROUP BY t.id;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_team_with_stats"("p_team_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_creators"("p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0, "p_timeframe" "text" DEFAULT 'all'::"text") RETURNS TABLE("username" "text", "avatar_url" "text", "total_clips" bigint, "total_votes" bigint, "weighted_score" bigint, "locked_clips" bigint, "best_clip_id" "uuid", "best_clip_votes" bigint)
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."get_top_creators"("p_limit" integer, "p_offset" integer, "p_timeframe" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_top_voters"("p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0, "p_timeframe" "text" DEFAULT 'all'::"text") RETURNS TABLE("voter_key" "text", "total_votes" bigint, "weighted_total" bigint, "votes_today" bigint, "first_vote_at" timestamp with time zone, "last_vote_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."get_top_voters"("p_limit" integer, "p_offset" integer, "p_timeframe" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_generation_limit"("p_user_id" "uuid", "p_global_max_daily" integer) RETURNS TABLE("custom_limit" integer, "effective_limit" integer, "is_unlimited" boolean)
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."get_user_generation_limit"("p_user_id" "uuid", "p_global_max_daily" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_global_rank"("p_voter_key" "text") RETURNS TABLE("global_rank" integer, "total_users" integer, "user_vote_count" integer)
    LANGUAGE "plpgsql" STABLE
    AS $$
  DECLARE
    v_user_votes INTEGER;
    v_rank INTEGER;
    v_total INTEGER;
  BEGIN
    SELECT COUNT(*)::INTEGER INTO v_user_votes
    FROM votes
    WHERE voter_key = p_voter_key;

    SELECT COUNT(DISTINCT voter_key)::INTEGER + 1 INTO v_rank
    FROM votes
    WHERE voter_key IN (
      SELECT v2.voter_key
      FROM votes v2
      GROUP BY v2.voter_key
      HAVING COUNT(*) > v_user_votes
    );

    SELECT COUNT(DISTINCT voter_key)::INTEGER INTO v_total
    FROM votes;

    IF v_user_votes = 0 THEN
      v_rank := v_total + 1;
    END IF;

    RETURN QUERY SELECT v_rank, v_total, v_user_votes;
  END;
  $$;


ALTER FUNCTION "public"."get_user_global_rank"("p_voter_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_rank_fast"("p_voter_key" "text") RETURNS TABLE("global_rank" bigint, "total_users" bigint, "user_vote_count" bigint)
    LANGUAGE "plpgsql" STABLE
    AS $$
  BEGIN
    RETURN QUERY
    SELECT
      COALESCE(m.global_rank, (SELECT COUNT(*) + 1 FROM mv_user_vote_counts)),
      (SELECT COUNT(*) FROM mv_user_vote_counts),
      COALESCE(m.vote_count, 0::BIGINT)
    FROM (SELECT 1) AS dummy
    LEFT JOIN mv_user_vote_counts m ON m.voter_key = p_voter_key;
  END;
  $$;


ALTER FUNCTION "public"."get_user_rank_fast"("p_voter_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_team"("p_user_id" "uuid") RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_team_id UUID;
BEGIN
  SELECT team_id INTO v_team_id FROM team_members WHERE user_id = p_user_id;
  IF v_team_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN get_team_with_stats(v_team_id);
END;
$$;


ALTER FUNCTION "public"."get_user_team"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_voter_rank"("p_voter_key" "text", "p_timeframe" "text" DEFAULT 'all'::"text") RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."get_voter_rank"("p_voter_key" "text", "p_timeframe" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_voters_count"("p_timeframe" "text" DEFAULT 'all'::"text") RETURNS bigint
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."get_voters_count"("p_timeframe" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_clip_view_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Increment view_count on the tournament_clips table
  -- Only increment for new views (INSERT), not updates
  UPDATE tournament_clips
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = NEW.clip_id;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."increment_clip_view_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_pinned_usage"("p_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "sql"
    AS $$
  UPDATE pinned_characters
  SET usage_count = usage_count + 1
  WHERE id = ANY(p_ids);
$$;


ALTER FUNCTION "public"."increment_pinned_usage"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_vote_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text" DEFAULT NULL::"text", "p_vote_weight" integer DEFAULT 1, "p_vote_type" "text" DEFAULT 'standard'::"text", "p_slot_position" integer DEFAULT 1, "p_flagged" boolean DEFAULT false, "p_multi_vote_mode" boolean DEFAULT false, "p_is_power_vote" boolean DEFAULT false) RETURNS TABLE("vote_id" "uuid", "was_new_vote" boolean, "final_vote_weight" integer, "new_vote_count" integer, "new_weighted_score" integer, "error_code" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_clip_uuid UUID := p_clip_id::UUID;
  v_user_uuid UUID := CASE WHEN p_user_id IS NOT NULL AND p_user_id != '' THEN p_user_id::UUID ELSE NULL END;
  v_vote_id UUID;
  v_existing_weight INTEGER;
  v_new_weight INTEGER;
  v_was_new BOOLEAN := TRUE;
  v_new_vote_count INTEGER;
  v_new_weighted_score INTEGER;
  v_clip_owner_id UUID;
BEGIN
  -- SECURITY FIX #12: Prevent self-voting
  IF v_user_uuid IS NOT NULL THEN
    SELECT tc.user_id INTO v_clip_owner_id
    FROM tournament_clips tc WHERE tc.id = v_clip_uuid;

    IF v_clip_owner_id IS NOT NULL AND v_clip_owner_id = v_user_uuid THEN
      RETURN QUERY SELECT NULL::UUID, FALSE, 0, 0, 0, 'SELF_VOTE_NOT_ALLOWED'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- For multi-vote mode or power votes, we may need to update existing vote
  IF p_multi_vote_mode OR p_is_power_vote THEN
    -- Check if vote exists
    SELECT v.id, v.vote_weight INTO v_vote_id, v_existing_weight
    FROM votes v
    WHERE v.clip_id = v_clip_uuid AND v.voter_key = p_voter_key
    FOR UPDATE;

    IF v_vote_id IS NOT NULL THEN
      -- Update existing vote (add weight for power votes)
      v_new_weight := COALESCE(v_existing_weight, 0) + p_vote_weight;
      v_was_new := FALSE;

      UPDATE votes
      SET vote_weight = v_new_weight,
          vote_type = p_vote_type,
          created_at = NOW()
      WHERE id = v_vote_id;

      -- Update clip counts manually since trigger only fires on INSERT
      UPDATE tournament_clips
      SET vote_count = COALESCE(vote_count, 0) + p_vote_weight,
          weighted_score = COALESCE(weighted_score, 0) + p_vote_weight
      WHERE id = v_clip_uuid;

      -- Get updated stats
      SELECT tc.vote_count, tc.weighted_score
      INTO v_new_vote_count, v_new_weighted_score
      FROM tournament_clips tc WHERE tc.id = v_clip_uuid;

      RETURN QUERY SELECT
        v_vote_id,
        v_was_new,
        v_new_weight,
        COALESCE(v_new_vote_count, 0),
        COALESCE(v_new_weighted_score, 0)::INTEGER,
        NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- Try to insert new vote
  -- If unique constraint fails, return error code
  BEGIN
    INSERT INTO votes (clip_id, voter_key, user_id, vote_weight, vote_type, slot_position, flagged, created_at)
    VALUES (v_clip_uuid, p_voter_key, v_user_uuid, p_vote_weight, p_vote_type, p_slot_position, p_flagged, NOW())
    RETURNING id INTO v_vote_id;

    v_was_new := TRUE;
    v_new_weight := p_vote_weight;

    -- H13: Always update clip counts directly (do not rely on triggers which may be disabled)
    UPDATE tournament_clips
    SET vote_count = COALESCE(vote_count, 0) + p_vote_weight,
        weighted_score = COALESCE(weighted_score, 0) + p_vote_weight
    WHERE id = v_clip_uuid;

    -- Get the updated stats
    SELECT tc.vote_count, tc.weighted_score
    INTO v_new_vote_count, v_new_weighted_score
    FROM tournament_clips tc WHERE tc.id = v_clip_uuid;

    RETURN QUERY SELECT
      v_vote_id,
      v_was_new,
      v_new_weight,
      COALESCE(v_new_vote_count, 0),
      COALESCE(v_new_weighted_score, 0)::INTEGER,
      NULL::TEXT;

  EXCEPTION
    WHEN unique_violation THEN
      -- Already voted - return error (only happens if multi_vote_mode is FALSE)
      RETURN QUERY SELECT
        NULL::UUID,
        FALSE,
        0,
        0,
        0,
        'ALREADY_VOTED'::TEXT;
  END;
END;
$$;


ALTER FUNCTION "public"."insert_vote_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text", "p_vote_weight" integer, "p_vote_type" "text", "p_slot_position" integer, "p_flagged" boolean, "p_multi_vote_mode" boolean, "p_is_power_vote" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_feature_enabled"("feature_key" character varying) RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT COALESCE(
    (SELECT enabled FROM feature_flags WHERE key = feature_key),
    FALSE
  );
$$;


ALTER FUNCTION "public"."is_feature_enabled"("feature_key" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_user_blocked"("checker_id" "uuid", "target_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    AS $$
  BEGIN
    RETURN EXISTS (
      SELECT 1 FROM user_blocks
      WHERE (blocker_id = checker_id AND blocked_id = target_id)
         OR (blocker_id = target_id AND blocked_id = checker_id)
    );
  END;
  $$;


ALTER FUNCTION "public"."is_user_blocked"("checker_id" "uuid", "target_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_team_via_code"("p_user_id" "uuid", "p_invite_code" "text") RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_invite RECORD;
  v_existing_team UUID;
  v_member_count INTEGER;
BEGIN
  -- Check if user already in a team
  SELECT team_id INTO v_existing_team FROM team_members WHERE user_id = p_user_id;
  IF v_existing_team IS NOT NULL THEN
    RAISE EXCEPTION 'User is already in a team';
  END IF;

  -- Get invite
  SELECT * INTO v_invite FROM team_invites
  WHERE invite_code = UPPER(p_invite_code)
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_uses IS NULL OR uses < max_uses);

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite code';
  END IF;

  -- Check team size (max 5)
  SELECT member_count INTO v_member_count FROM teams WHERE id = v_invite.team_id;
  IF v_member_count >= 5 THEN
    RAISE EXCEPTION 'Team is full (max 5 members)';
  END IF;

  -- Add member
  INSERT INTO team_members (team_id, user_id, role, last_active_date)
  VALUES (v_invite.team_id, p_user_id, 'member', CURRENT_DATE);

  -- Increment invite uses
  UPDATE team_invites SET uses = uses + 1 WHERE id = v_invite.id;

  RETURN get_team_with_stats(v_invite.team_id);
END;
$$;


ALTER FUNCTION "public"."join_team_via_code"("p_user_id" "uuid", "p_invite_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."leave_team"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_membership RECORD;
  v_new_leader UUID;
BEGIN
  -- Get membership
  SELECT tm.*, t.id as team_id_check FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE tm.user_id = p_user_id
  INTO v_membership;

  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'User is not in a team';
  END IF;

  -- If leader, transfer or disband
  IF v_membership.role = 'leader' THEN
    -- Find new leader (oldest officer, then oldest member)
    SELECT user_id INTO v_new_leader
    FROM team_members
    WHERE team_id = v_membership.team_id AND user_id != p_user_id
    ORDER BY
      CASE role WHEN 'officer' THEN 0 ELSE 1 END,
      joined_at
    LIMIT 1;

    IF v_new_leader IS NOT NULL THEN
      -- Transfer leadership
      UPDATE team_members SET role = 'leader' WHERE user_id = v_new_leader;
      UPDATE teams SET leader_id = v_new_leader WHERE id = v_membership.team_id;
    ELSE
      -- Disband team (no other members)
      DELETE FROM teams WHERE id = v_membership.team_id;
      RETURN TRUE;
    END IF;
  END IF;

  -- Remove member
  DELETE FROM team_members WHERE user_id = p_user_id;
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."leave_team"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_unauthorized_admin_promotion"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Only allow is_admin changes if the session has explicitly opted in
  -- (set by trusted admin RPCs only)
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin THEN
    -- Check for a session-level flag that only admin RPCs set
    IF current_setting('app.allow_admin_change', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Unauthorized: cannot modify is_admin field';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_unauthorized_admin_promotion"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_all_pricing"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."recalculate_all_pricing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recalculate_vocabulary_scores"() RETURNS TABLE("vocabulary_updated" integer, "patterns_updated" integer)
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_vocab_count INTEGER := 0;
  v_pattern_count INTEGER := 0;
BEGIN
  -- Recalculate scene_vocabulary scores from all prompts
  UPDATE scene_vocabulary sv
  SET
    total_votes = agg.total_votes,
    avg_vote_score = agg.avg_score,
    winner_count = agg.winner_count,
    updated_at = NOW()
  FROM (
    SELECT
      sv2.id,
      COALESCE(SUM(ph.vote_count), 0) as total_votes,
      CASE WHEN COUNT(*) > 0
           THEN COALESCE(SUM(ph.vote_count), 0)::FLOAT / COUNT(*)
           ELSE 0
      END as avg_score,
      COUNT(*) FILTER (WHERE ph.is_winner) as winner_count
    FROM scene_vocabulary sv2
    JOIN prompt_history ph ON ph.season_id = sv2.season_id
    WHERE ph.scene_elements IS NOT NULL
      AND (
        -- Check if term exists in any scene_elements category
        ph.scene_elements->'lighting' ? sv2.term
        OR ph.scene_elements->'location' ? sv2.term
        OR ph.scene_elements->'camera' ? sv2.term
        OR ph.scene_elements->'atmosphere' ? sv2.term
        OR ph.scene_elements->'objects' ? sv2.term
        OR ph.scene_elements->'colors' ? sv2.term
        OR ph.scene_elements->'motion' ? sv2.term
        OR ph.scene_elements->>'time_of_day' = sv2.term
      )
    GROUP BY sv2.id
  ) agg
  WHERE sv.id = agg.id;

  GET DIAGNOSTICS v_vocab_count = ROW_COUNT;

  -- Recalculate model_prompt_patterns scores
  -- This requires pattern matching which is expensive, so we do a simpler approach
  UPDATE model_prompt_patterns mpp
  SET
    total_votes = agg.total_votes,
    avg_vote_score = agg.avg_score,
    winner_count = agg.winner_count,
    updated_at = NOW()
  FROM (
    SELECT
      mpp2.id,
      COALESCE(SUM(ph.vote_count), 0) as total_votes,
      CASE WHEN COUNT(*) > 0
           THEN COALESCE(SUM(ph.vote_count), 0)::FLOAT / COUNT(*)
           ELSE 0
      END as avg_score,
      COUNT(*) FILTER (WHERE ph.is_winner) as winner_count
    FROM model_prompt_patterns mpp2
    JOIN prompt_history ph ON ph.ai_model = mpp2.ai_model
    WHERE LOWER(ph.user_prompt) LIKE '%' || LOWER(mpp2.pattern_text) || '%'
    GROUP BY mpp2.id
  ) agg
  WHERE mpp.id = agg.id;

  GET DIAGNOSTICS v_pattern_count = ROW_COUNT;

  vocabulary_updated := v_vocab_count;
  patterns_updated := v_pattern_count;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."recalculate_vocabulary_scores"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_clip_distribution_stats"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_clip_distribution_stats;
END;
$$;


ALTER FUNCTION "public"."refresh_clip_distribution_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_user_vote_counts"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_vote_counts;
  END;
  $$;


ALTER FUNCTION "public"."refresh_user_vote_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refund_credits"("p_user_id" "uuid", "p_generation_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."refund_credits"("p_user_id" "uuid", "p_generation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_comment"("p_comment_id" "uuid", "p_admin_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE comments
  SET
    moderation_status = 'rejected',
    moderated_by = p_admin_id,
    moderated_at = NOW(),
    moderation_reason = p_reason,
    is_deleted = true  -- Also soft-delete rejected comments
  WHERE id = p_comment_id;

  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."reject_comment"("p_comment_id" "uuid", "p_admin_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorganize_slots_delete_and_shift"("p_season_id" "uuid", "p_positions_to_delete" integer[]) RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_sorted_positions INTEGER[];
  v_offset INTEGER := 10000;
  v_deleted_slots INTEGER;
  v_deleted_clips INTEGER;
BEGIN
  -- Sort positions for consistent processing
  SELECT ARRAY_AGG(p ORDER BY p) INTO v_sorted_positions FROM unnest(p_positions_to_delete) p;

  -- Check for voting slots - cannot delete slots in voting status
  IF EXISTS (
    SELECT 1 FROM story_slots
    WHERE season_id = p_season_id
      AND slot_position = ANY(v_sorted_positions)
      AND status = 'voting'
  ) THEN
    RAISE EXCEPTION 'Cannot delete slots in voting status';
  END IF;

  -- Step 1: Add offset to all slots to avoid unique constraint violations
  UPDATE story_slots SET slot_position = slot_position + v_offset WHERE season_id = p_season_id;
  UPDATE tournament_clips SET slot_position = slot_position + v_offset WHERE season_id = p_season_id;

  -- Step 2: Delete target slots and clips (now at offset positions)
  DELETE FROM tournament_clips
  WHERE season_id = p_season_id
    AND slot_position = ANY(SELECT p + v_offset FROM unnest(v_sorted_positions) p);
  GET DIAGNOSTICS v_deleted_clips = ROW_COUNT;

  DELETE FROM story_slots
  WHERE season_id = p_season_id
    AND slot_position = ANY(SELECT p + v_offset FROM unnest(v_sorted_positions) p);
  GET DIAGNOSTICS v_deleted_slots = ROW_COUNT;

  -- Step 3: Calculate and apply new positions for remaining slots
  -- For each slot, subtract (offset + count of deleted positions below it)
  UPDATE story_slots ss
  SET slot_position = (ss.slot_position - v_offset) - (
    SELECT COUNT(*) FROM unnest(v_sorted_positions) dp WHERE dp < (ss.slot_position - v_offset)
  )
  WHERE ss.season_id = p_season_id;

  -- Step 4: Same for clips
  UPDATE tournament_clips tc
  SET slot_position = (tc.slot_position - v_offset) - (
    SELECT COUNT(*) FROM unnest(v_sorted_positions) dp WHERE dp < (tc.slot_position - v_offset)
  )
  WHERE tc.season_id = p_season_id;

  RETURN json_build_object(
    'success', true,
    'deleted_slots', v_deleted_slots,
    'deleted_clips', v_deleted_clips,
    'positions_deleted', v_sorted_positions,
    'shift_amount', array_length(v_sorted_positions, 1)
  );
END;
$$;


ALTER FUNCTION "public"."reorganize_slots_delete_and_shift"("p_season_id" "uuid", "p_positions_to_delete" integer[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorganize_slots_swap"("p_season_id" "uuid", "p_position_a" integer, "p_position_b" integer) RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_slot_a_id UUID;
  v_slot_b_id UUID;
  v_slot_a_status TEXT;
  v_slot_b_status TEXT;
  v_temp_position INTEGER := 99999;
BEGIN
  -- Get slot IDs and validate they exist
  SELECT id, status INTO v_slot_a_id, v_slot_a_status
  FROM story_slots WHERE season_id = p_season_id AND slot_position = p_position_a;

  SELECT id, status INTO v_slot_b_id, v_slot_b_status
  FROM story_slots WHERE season_id = p_season_id AND slot_position = p_position_b;

  IF v_slot_a_id IS NULL OR v_slot_b_id IS NULL THEN
    RAISE EXCEPTION 'One or both slots not found';
  END IF;

  -- Check voting status - cannot swap slots in voting status
  IF v_slot_a_status = 'voting' OR v_slot_b_status = 'voting' THEN
    RAISE EXCEPTION 'Cannot swap slots in voting status';
  END IF;

  -- Swap slots using temp position to avoid constraint violations
  UPDATE story_slots SET slot_position = v_temp_position WHERE id = v_slot_a_id;
  UPDATE story_slots SET slot_position = p_position_a WHERE id = v_slot_b_id;
  UPDATE story_slots SET slot_position = p_position_b WHERE id = v_slot_a_id;

  -- Swap clips using same temp position approach
  UPDATE tournament_clips SET slot_position = v_temp_position
  WHERE season_id = p_season_id AND slot_position = p_position_a;

  UPDATE tournament_clips SET slot_position = p_position_a
  WHERE season_id = p_season_id AND slot_position = p_position_b;

  UPDATE tournament_clips SET slot_position = p_position_b
  WHERE season_id = p_season_id AND slot_position = v_temp_position;

  RETURN json_build_object(
    'success', true,
    'swapped', ARRAY[p_position_a, p_position_b],
    'slot_a_status', v_slot_a_status,
    'slot_b_status', v_slot_b_status
  );
END;
$$;


ALTER FUNCTION "public"."reorganize_slots_swap"("p_season_id" "uuid", "p_position_a" integer, "p_position_b" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_vote_date"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.vote_date := NEW.created_at::date;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_vote_date"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_prompt_learning_from_clip"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_season_id UUID;
  v_prompt_id UUID;
  v_old_vote_count INTEGER;
  v_old_is_winner BOOLEAN;
  v_scene_elements JSONB;
BEGIN
  -- Get the prompt_history record for this clip
  SELECT id, vote_count, is_winner, scene_elements, season_id
  INTO v_prompt_id, v_old_vote_count, v_old_is_winner, v_scene_elements, v_season_id
  FROM prompt_history
  WHERE clip_id = NEW.id
  LIMIT 1;

  -- If no prompt record exists, nothing to sync
  IF v_prompt_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Update prompt_history with new vote_count and winner status
  UPDATE prompt_history
  SET
    vote_count = COALESCE(NEW.vote_count, 0),
    is_winner = (NEW.status = 'winner'),
    updated_at = NOW()
  WHERE id = v_prompt_id;

  -- If vote count changed significantly or winner status changed, update vocabulary
  IF (NEW.vote_count IS DISTINCT FROM OLD.vote_count AND ABS(COALESCE(NEW.vote_count, 0) - COALESCE(OLD.vote_count, 0)) >= 1)
     OR (NEW.status = 'winner' AND OLD.status != 'winner') THEN

    -- Recalculate vocabulary scores for terms from this prompt
    -- This is done via a separate batch process to avoid trigger overhead
    -- Mark the prompt for reprocessing by setting a flag
    UPDATE prompt_history
    SET updated_at = NOW()  -- Touch to trigger reprocessing
    WHERE id = v_prompt_id;

  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_prompt_learning_from_clip"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_visual_learning_from_clip"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Update clip_visuals with new vote_count and winner status
  UPDATE clip_visuals
  SET
    vote_count = COALESCE(NEW.vote_count, 0),
    is_winner = (NEW.status = 'winner'),
    updated_at = NOW()
  WHERE clip_id = NEW.id;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_visual_learning_from_clip"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."track_team_vote"("p_user_id" "uuid", "p_clip_id" "text", "p_slot_position" integer) RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_team_id UUID;
  v_member_count INTEGER;
  v_result JSON;
BEGIN
  -- Get user's team
  SELECT team_id INTO v_team_id FROM team_members WHERE user_id = p_user_id;
  IF v_team_id IS NULL THEN
    RETURN json_build_object('has_team', false, 'multiplier', 1.0);
  END IF;

  -- Upsert coordination record
  INSERT INTO team_vote_coordination (team_id, clip_id, slot_position, member_votes)
  VALUES (v_team_id, p_clip_id, p_slot_position, 1)
  ON CONFLICT (team_id, clip_id)
  DO UPDATE SET
    member_votes = team_vote_coordination.member_votes + 1,
    updated_at = NOW()
  RETURNING member_votes INTO v_member_count;

  -- Update member's activity and contribution
  UPDATE team_members
  SET last_active_date = CURRENT_DATE,
      contribution_votes = contribution_votes + 1
  WHERE user_id = p_user_id;

  -- Return coordination info
  RETURN json_build_object(
    'has_team', true,
    'team_id', v_team_id,
    'member_votes', v_member_count,
    'multiplier', CASE WHEN v_member_count >= 3 THEN 1.5 ELSE 1.0 END,
    'threshold_reached', v_member_count >= 3
  );
END;
$$;


ALTER FUNCTION "public"."track_team_vote"("p_user_id" "uuid", "p_clip_id" "text", "p_slot_position" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_ai_gen_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_ai_gen_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_all_team_streaks"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  team_record RECORD;
  all_members_active BOOLEAN;
BEGIN
  FOR team_record IN SELECT id, current_streak, last_active_date FROM teams LOOP
    -- Check if ALL members were active yesterday or today
    SELECT bool_and(last_active_date >= CURRENT_DATE - INTERVAL '1 day')
    INTO all_members_active
    FROM team_members
    WHERE team_id = team_record.id;

    IF all_members_active AND team_record.last_active_date < CURRENT_DATE THEN
      -- Increment streak
      UPDATE teams SET
        current_streak = current_streak + 1,
        longest_streak = GREATEST(longest_streak, current_streak + 1),
        last_active_date = CURRENT_DATE,
        updated_at = NOW()
      WHERE id = team_record.id;
    ELSIF NOT all_members_active AND team_record.last_active_date < CURRENT_DATE - INTERVAL '1 day' THEN
      -- Reset streak if any member missed more than 1 day
      UPDATE teams SET
        current_streak = 0,
        updated_at = NOW()
      WHERE id = team_record.id;
    END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."update_all_team_streaks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_clip_vote_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
  BEGIN
    UPDATE tournament_clips
    SET
      vote_count = COALESCE(vote_count, 0) + COALESCE(NEW.vote_weight, 1),
      weighted_score = COALESCE(weighted_score, 0) + COALESCE(NEW.vote_weight, 1)
    WHERE id = NEW.clip_id;
    RETURN NEW;
  END;
  $$;


ALTER FUNCTION "public"."update_clip_vote_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_clip_vote_count_on_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Atomically decrement vote_count and weighted_score
  -- Use GREATEST to prevent negative values
  UPDATE tournament_clips
  SET
    vote_count = GREATEST(0, COALESCE(vote_count, 0) - 1),
    weighted_score = GREATEST(0, COALESCE(weighted_score, 0) - COALESCE(OLD.vote_weight, 1))
  WHERE id = OLD.clip_id;

  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."update_clip_vote_count_on_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_comment_likes_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE comments SET likes_count = likes_count - 1 WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_comment_likes_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_comments_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_comments_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_direction_vote_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE direction_options SET vote_count = COALESCE(vote_count, 0) + 1
    WHERE id = NEW.direction_option_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE direction_options SET vote_count = GREATEST(0, COALESCE(vote_count, 0) - 1)
    WHERE id = OLD.direction_option_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_direction_vote_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_feature_flags_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_feature_flags_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_followers_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Increment follower's following_count
    UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    -- Increment target's followers_count
    UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Decrement follower's following_count
    UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    -- Decrement target's followers_count
    UPDATE users SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = OLD.following_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_followers_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_movie_projects_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_movie_projects_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_pinned_chars_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_pinned_chars_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_prompt_history_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_prompt_history_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_team_member_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE teams SET member_count = member_count + 1, updated_at = NOW()
    WHERE id = NEW.team_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE teams SET member_count = member_count - 1, updated_at = NOW()
    WHERE id = OLD.team_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."update_team_member_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_stats_on_vote"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$                                                                                                                                                                                
  DECLARE                                                                                                                                                                                              
    v_voter_uuid UUID;                                                                                                                                                                                 
    v_clip_owner_id UUID;                                                                                                                                                                              
  BEGIN                                                                                                                                                                                                
    IF NEW.user_id IS NOT NULL AND NEW.user_id != '' THEN                                                                                                                                              
      BEGIN                                                                                                                                                                                            
        v_voter_uuid := NEW.user_id::UUID;                                                                                                                                                             
                                                                                                                                                                                                       
        UPDATE users                                                                                                                                                                                   
        SET total_votes_cast = COALESCE(total_votes_cast, 0) + 1,                                                                                                                                      
            updated_at = NOW()                                                                                                                                                                         
        WHERE id = v_voter_uuid;                                                                                                                                                                       
                                                                                                                                                                                                       
        PERFORM add_user_xp(v_voter_uuid, 10);                                                                                                                                                         
      EXCEPTION WHEN OTHERS THEN                                                                                                                                                                       
        RAISE WARNING '[update_user_stats_on_vote] Failed to update voter stats for user_id=%: %', NEW.user_id, SQLERRM;                                                                               
      END;                                                                                                                                                                                             
    END IF;                                                                                                                                                                                            
                                                                                                                                                                                                       
    BEGIN                                                                                                                                                                                              
      SELECT user_id INTO v_clip_owner_id                                                                                                                                                              
      FROM tournament_clips                                                                                                                                                                            
      WHERE id = NEW.clip_id;                                                                                                                                                                          
                                                                                                                                                                                                       
      IF v_clip_owner_id IS NOT NULL THEN                                                                                                                                                              
        UPDATE users                                                                                                                                                                                   
        SET total_votes_received = COALESCE(total_votes_received, 0) + 1,                                                                                                                              
            updated_at = NOW()                                                                                                                                                                         
        WHERE id = v_clip_owner_id;                                                                                                                                                                    
      END IF;                                                                                                                                                                                          
    EXCEPTION WHEN OTHERS THEN                                                                                                                                                                         
      RAISE WARNING '[update_user_stats_on_vote] Failed to update clip owner stats for clip_id=%: %', NEW.clip_id, SQLERRM;                                                                            
    END;                                                                                                                                                                                               
                                                                                                                                                                                                       
    RETURN NEW;                                                                                                                                                                                        
  END;                                                                                                                                                                                                 
  $$;


ALTER FUNCTION "public"."update_user_stats_on_vote"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_stats_on_vote_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$                                                                                                                                                                                
  DECLARE                                                                                                                                                                                              
    v_voter_uuid UUID;                                                                                                                                                                                 
    v_clip_owner_id UUID;                                                                                                                                                                              
  BEGIN                                                                                                                                                                                                
    IF OLD.user_id IS NOT NULL AND OLD.user_id != '' THEN                                                                                                                                              
      BEGIN                                                                                                                                                                                            
        v_voter_uuid := OLD.user_id::UUID;                                                                                                                                                             
                                                                                                                                                                                                       
        UPDATE users                                                                                                                                                                                   
        SET total_votes_cast = GREATEST(0, COALESCE(total_votes_cast, 0) - 1),                                                                                                                         
            updated_at = NOW()                                                                                                                                                                         
        WHERE id = v_voter_uuid;                                                                                                                                                                       
      EXCEPTION WHEN OTHERS THEN                                                                                                                                                                       
        RAISE WARNING '[update_user_stats_on_vote_delete] Failed for user_id=%: %', OLD.user_id, SQLERRM;                                                                                              
      END;                                                                                                                                                                                             
    END IF;                                                                                                                                                                                            
                                                                                                                                                                                                       
    BEGIN                                                                                                                                                                                              
      SELECT user_id INTO v_clip_owner_id                                                                                                                                                              
      FROM tournament_clips                                                                                                                                                                            
      WHERE id = OLD.clip_id;                                                                                                                                                                          
                                                                                                                                                                                                       
      IF v_clip_owner_id IS NOT NULL THEN                                                                                                                                                              
        UPDATE users                                                                                                                                                                                   
        SET total_votes_received = GREATEST(0, COALESCE(total_votes_received, 0) - 1),                                                                                                                 
            updated_at = NOW()                                                                                                                                                                         
        WHERE id = v_clip_owner_id;                                                                                                                                                                    
      END IF;                                                                                                                                                                                          
    EXCEPTION WHEN OTHERS THEN                                                                                                                                                                         
      RAISE WARNING '[update_user_stats_on_vote_delete] Failed for clip_id=%: %', OLD.clip_id, SQLERRM;                                                                                                
    END;                                                                                                                                                                                               
                                                                                                                                                                                                       
    RETURN OLD;                                                                                                                                                                                        
  END;                                                                                                                                                                                                 
  $$;


ALTER FUNCTION "public"."update_user_stats_on_vote_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_user_vote_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$                                                                                                    
  DECLARE                                                                                                                  
    v_today DATE := CURRENT_DATE;                                                                                          
    v_user_streak INT;                                                                                                     
    v_last_date DATE;                                                                                                      
  BEGIN                                                                                                                    
    IF NEW.user_id IS NULL OR NEW.user_id = '' THEN                                                                        
      RETURN NEW;                                                                                                          
    END IF;                                                                                                                
                                                                                                                           
    SELECT current_streak, last_vote_date                                                                                  
    INTO v_user_streak, v_last_date                                                                                        
    FROM users WHERE id = NEW.user_id::UUID;                                                                               
                                                                                                                           
    UPDATE users SET                                                                                                       
      total_votes_cast = total_votes_cast + 1,                                                                             
      xp = xp + COALESCE(NEW.vote_weight, 1),                                                                              
      level = calculate_level(xp + COALESCE(NEW.vote_weight, 1)),                                                          
      votes_today = CASE                                                                                                   
        WHEN last_vote_reset IS NULL OR last_vote_reset < v_today THEN 1                                                   
        ELSE votes_today + 1                                                                                               
      END,                                                                                                                 
      last_vote_reset = v_today,                                                                                           
      current_streak = CASE                                                                                                
        WHEN v_last_date IS NULL THEN 1                                                                                    
        WHEN v_last_date = v_today THEN current_streak                                                                     
        WHEN v_last_date = v_today - 1 THEN current_streak + 1                                                             
        ELSE 1                                                                                                             
      END,                                                                                                                 
      longest_streak = GREATEST(                                                                                           
        longest_streak,                                                                                                    
        CASE                                                                                                               
          WHEN v_last_date IS NULL THEN 1                                                                                  
          WHEN v_last_date = v_today THEN current_streak                                                                   
          WHEN v_last_date = v_today - 1 THEN current_streak + 1                                                           
          ELSE 1                                                                                                           
        END                                                                                                                
      ),                                                                                                                   
      last_vote_date = v_today                                                                                             
    WHERE id = NEW.user_id::UUID;                                                                                          
                                                                                                                           
    RETURN NEW;                                                                                                            
  END;                                                                                                                     
  $$;


ALTER FUNCTION "public"."update_user_vote_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_users_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_users_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_model_pattern"("p_ai_model" character varying, "p_pattern_type" character varying, "p_pattern_text" character varying, "p_vote_count" integer, "p_is_winner" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO model_prompt_patterns (
    ai_model, pattern_type, pattern_text, usage_count,
    total_votes, avg_vote_score, winner_count, decay_factor
  ) VALUES (
    p_ai_model,
    p_pattern_type,
    p_pattern_text,
    1,
    p_vote_count,
    p_vote_count::FLOAT,
    CASE WHEN p_is_winner THEN 1 ELSE 0 END,
    1.0  -- Fresh patterns start with full decay factor
  )
  ON CONFLICT (ai_model, pattern_type, pattern_text) DO UPDATE SET
    usage_count = model_prompt_patterns.usage_count + 1,
    total_votes = model_prompt_patterns.total_votes + p_vote_count,
    avg_vote_score = (model_prompt_patterns.total_votes + p_vote_count)::FLOAT /
                     (model_prompt_patterns.usage_count + 1),
    winner_count = model_prompt_patterns.winner_count +
                   CASE WHEN p_is_winner THEN 1 ELSE 0 END,
    -- Boost decay factor on reuse
    decay_factor = LEAST(1.0, model_prompt_patterns.decay_factor + 0.1),
    updated_at = NOW();
END;
$$;


ALTER FUNCTION "public"."upsert_model_pattern"("p_ai_model" character varying, "p_pattern_type" character varying, "p_pattern_text" character varying, "p_vote_count" integer, "p_is_winner" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_scene_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean, "p_example_prompt" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO scene_vocabulary (
    season_id, term, category, frequency, total_votes,
    avg_vote_score, winner_count, example_prompts, decay_factor
  ) VALUES (
    p_season_id,
    p_term,
    p_category,
    1,
    p_vote_count,
    p_vote_count::FLOAT,
    CASE WHEN p_is_winner THEN 1 ELSE 0 END,
    ARRAY[p_example_prompt],
    1.0  -- Fresh terms start with full decay factor
  )
  ON CONFLICT (season_id, term, category) DO UPDATE SET
    frequency = scene_vocabulary.frequency + 1,
    total_votes = scene_vocabulary.total_votes + p_vote_count,
    avg_vote_score = (scene_vocabulary.total_votes + p_vote_count)::FLOAT /
                     (scene_vocabulary.frequency + 1),
    winner_count = scene_vocabulary.winner_count +
                   CASE WHEN p_is_winner THEN 1 ELSE 0 END,
    example_prompts = CASE
      WHEN array_length(scene_vocabulary.example_prompts, 1) < 5
      THEN array_append(scene_vocabulary.example_prompts, p_example_prompt)
      ELSE scene_vocabulary.example_prompts
    END,
    -- Boost decay factor on reuse (partially restore freshness)
    decay_factor = LEAST(1.0, scene_vocabulary.decay_factor + 0.1),
    updated_at = NOW();
END;
$$;


ALTER FUNCTION "public"."upsert_scene_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean, "p_example_prompt" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_visual_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  INSERT INTO visual_vocabulary (
    season_id, term, category, frequency, total_votes,
    avg_vote_score, winner_count, decay_factor
  ) VALUES (
    p_season_id,
    p_term,
    p_category,
    1,
    p_vote_count,
    p_vote_count::FLOAT,
    CASE WHEN p_is_winner THEN 1 ELSE 0 END,
    1.0
  )
  ON CONFLICT (season_id, term, category) DO UPDATE SET
    frequency = visual_vocabulary.frequency + 1,
    total_votes = visual_vocabulary.total_votes + p_vote_count,
    avg_vote_score = (visual_vocabulary.total_votes + p_vote_count)::FLOAT /
                     (visual_vocabulary.frequency + 1),
    winner_count = visual_vocabulary.winner_count +
                   CASE WHEN p_is_winner THEN 1 ELSE 0 END,
    -- Boost decay factor on reuse
    decay_factor = LEAST(1.0, visual_vocabulary.decay_factor + 0.1),
    updated_at = NOW();
END;
$$;


ALTER FUNCTION "public"."upsert_visual_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_vote_weight"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
  $$;


ALTER FUNCTION "public"."validate_vote_weight"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vote_insert_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text" DEFAULT NULL::"text", "p_vote_weight" integer DEFAULT 1, "p_vote_type" "text" DEFAULT 'standard'::"text", "p_slot_position" integer DEFAULT 1, "p_flagged" boolean DEFAULT false, "p_multi_vote_mode" boolean DEFAULT false, "p_is_power_vote" boolean DEFAULT false) RETURNS TABLE("vote_id" "uuid", "was_new_vote" boolean, "final_vote_weight" integer, "new_vote_count" integer, "new_weighted_score" integer, "error_code" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$                                                                                                                    
  DECLARE                                                                                                                  
    v_clip_uuid UUID := p_clip_id::UUID;                                                                                   
    v_vote_id UUID;                                                                                                        
    v_existing_weight INTEGER;                                                                                             
    v_new_weight INTEGER;                                                                                                  
    v_was_new BOOLEAN := TRUE;                                                                                             
    v_new_vote_count INTEGER;                                                                                              
    v_new_weighted_score INTEGER;                                                                                          
  BEGIN                                                                                                                    
    IF p_multi_vote_mode OR p_is_power_vote THEN                                                                           
      SELECT v.id, v.vote_weight INTO v_vote_id, v_existing_weight                                                         
      FROM votes v                                                                                                         
      WHERE v.clip_id = v_clip_uuid AND v.voter_key = p_voter_key                                                          
      FOR UPDATE;                                                                                                          
      IF v_vote_id IS NOT NULL THEN                                                                                        
        v_new_weight := COALESCE(v_existing_weight, 0) + p_vote_weight;                                                    
        v_was_new := FALSE;                                                                                                
        UPDATE votes                                                                                                       
        SET vote_weight = v_new_weight,                                                                                    
            vote_type = p_vote_type,                                                                                       
            created_at = NOW()                                                                                             
        WHERE id = v_vote_id;                                                                                              
        UPDATE tournament_clips                                                                                            
        SET vote_count = COALESCE(vote_count, 0) + p_vote_weight,                                                          
            weighted_score = COALESCE(weighted_score, 0) + p_vote_weight                                                   
        WHERE id = v_clip_uuid;                                                                                            
        SELECT tc.vote_count, tc.weighted_score                                                                            
        INTO v_new_vote_count, v_new_weighted_score                                                                        
        FROM tournament_clips tc WHERE tc.id = v_clip_uuid;                                                                
        RETURN QUERY SELECT v_vote_id, v_was_new, v_new_weight,                                                            
          COALESCE(v_new_vote_count, 0), COALESCE(v_new_weighted_score, 0), NULL::TEXT;                                    
        RETURN;                                                                                                            
      END IF;                                                                                                              
    END IF;                                                                                                                
    BEGIN                                                                                                                  
      INSERT INTO votes (clip_id, voter_key, user_id, vote_weight, vote_type, slot_position, flagged, created_at)          
      VALUES (v_clip_uuid, p_voter_key, p_user_id, p_vote_weight, p_vote_type, p_slot_position, p_flagged, NOW())          
      RETURNING id INTO v_vote_id;                                                                                         
      v_was_new := TRUE;                                                                                                   
      v_new_weight := p_vote_weight;                                                                                       
      SELECT tc.vote_count, tc.weighted_score                                                                              
      INTO v_new_vote_count, v_new_weighted_score                                                                          
      FROM tournament_clips tc WHERE tc.id = v_clip_uuid;                                                                  
      RETURN QUERY SELECT v_vote_id, v_was_new, v_new_weight,                                                              
        COALESCE(v_new_vote_count, 0), COALESCE(v_new_weighted_score, 0), NULL::TEXT;                                      
    EXCEPTION                                                                                                              
      WHEN unique_violation THEN                                                                                           
        RETURN QUERY SELECT NULL::UUID, FALSE, 0, 0, 0, 'ALREADY_VOTED'::TEXT;                                             
    END;                                                                                                                   
  END;                                                                                                                     
  $$;


ALTER FUNCTION "public"."vote_insert_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text", "p_vote_weight" integer, "p_vote_type" "text", "p_slot_position" integer, "p_flagged" boolean, "p_multi_vote_mode" boolean, "p_is_power_vote" boolean) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ai_generation_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "generation_count" integer DEFAULT 0
);


ALTER TABLE "public"."ai_generation_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_generations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "fal_request_id" character varying(200) NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "prompt" character varying(2000) NOT NULL,
    "model" character varying(50) NOT NULL,
    "style" character varying(50),
    "genre" character varying(20),
    "video_url" "text",
    "clip_id" "uuid",
    "error_message" "text",
    "cost_cents" integer,
    "storage_key" character varying(500),
    "complete_initiated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "image_url" "text",
    "narration_text" character varying(300),
    "narration_voice_id" character varying(100),
    "narration_cost_cents" integer DEFAULT 0,
    "pinned_character_ids" "uuid"[],
    "generation_mode" character varying(30) DEFAULT 'text-to-video'::character varying,
    "credit_deducted" boolean DEFAULT false,
    "credit_amount" integer,
    CONSTRAINT "valid_ai_status" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'completed'::character varying, 'failed'::character varying, 'expired'::character varying])::"text"[])))
);


ALTER TABLE "public"."ai_generations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid",
    "admin_email" "text" NOT NULL,
    "action" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "text",
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "ip_address" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_logs" IS 'Tracks all admin actions for security audit trail';



CREATE TABLE IF NOT EXISTS "public"."character_reference_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "pinned_character_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "season_id" "uuid" NOT NULL,
    "source_clip_id" "uuid" NOT NULL,
    "frame_timestamp" double precision,
    "image_url" "text" NOT NULL,
    "storage_key" "text",
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "admin_notes" "text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "character_reference_suggestions_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'rejected'::character varying])::"text"[])))
);


ALTER TABLE "public"."character_reference_suggestions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clip_views" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clip_id" "uuid" NOT NULL,
    "voter_key" "text" NOT NULL,
    "viewed_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."clip_views" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clip_visuals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clip_id" "uuid" NOT NULL,
    "season_id" "uuid" NOT NULL,
    "thumbnail_url" "text" NOT NULL,
    "features" "jsonb" NOT NULL,
    "prompt_used" "text",
    "vote_count" integer DEFAULT 0,
    "is_winner" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."clip_visuals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."comment_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "user_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."comment_likes" OWNER TO "postgres";


COMMENT ON TABLE "public"."comment_likes" IS 'Tracks which users liked which comments';



CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_key" "text" NOT NULL,
    "username" "text" NOT NULL,
    "avatar_url" "text",
    "comment_text" "text" NOT NULL,
    "likes_count" integer DEFAULT 0,
    "parent_comment_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    "clip_id" "uuid",
    "moderation_status" "text" DEFAULT 'approved'::"text",
    "moderated_by" "uuid",
    "moderated_at" timestamp with time zone,
    "moderation_reason" "text",
    CONSTRAINT "comment_max_length" CHECK (("length"("comment_text") <= 500)),
    CONSTRAINT "comment_not_empty" CHECK (("length"(TRIM(BOTH FROM "comment_text")) > 0)),
    CONSTRAINT "comments_moderation_status_check" CHECK (("moderation_status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'flagged'::"text"])))
);


ALTER TABLE "public"."comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."comments" IS 'Stores comments on clips';



COMMENT ON COLUMN "public"."comments"."user_key" IS 'Hashed device identifier or user ID';



COMMENT ON COLUMN "public"."comments"."username" IS 'Display name of commenter';



COMMENT ON COLUMN "public"."comments"."comment_text" IS 'The comment content';



COMMENT ON COLUMN "public"."comments"."likes_count" IS 'Number of likes on this comment';



COMMENT ON COLUMN "public"."comments"."parent_comment_id" IS 'For replies - ID of parent comment';



COMMENT ON COLUMN "public"."comments"."is_deleted" IS 'Soft delete flag';



COMMENT ON COLUMN "public"."comments"."moderation_status" IS 'pending=awaiting review, approved=visible, rejected=hidden, flagged=reported by users';



CREATE TABLE IF NOT EXISTS "public"."tournament_clips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clip_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "slot_position" integer,
    "thumbnail_url" "text" NOT NULL,
    "vote_count" integer DEFAULT 0 NOT NULL,
    "weighted_score" numeric(10,2) DEFAULT 0 NOT NULL,
    "rank_in_track" integer,
    "username" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "video_url" "text",
    "description" "text",
    "title" "text",
    "genre" "text" DEFAULT 'other'::"text" NOT NULL,
    "uploader_key" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "track_id" "text" DEFAULT 'track-main'::"text",
    "hype_score" numeric DEFAULT 0,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "view_count" integer DEFAULT 0,
    "season_id" "uuid",
    "duration_seconds" numeric(5,2),
    "is_ai_generated" boolean DEFAULT false,
    "ai_prompt" "text",
    "ai_model" character varying(50),
    "ai_generation_id" character varying(200),
    "ai_style" character varying(50),
    "is_pinned" boolean DEFAULT false,
    "eliminated_at" timestamp with time zone,
    "elimination_reason" "text",
    "video_deleted_at" timestamp with time zone,
    "last_frame_url" "text",
    "has_narration" boolean DEFAULT false,
    CONSTRAINT "check_duration_range" CHECK ((("duration_seconds" IS NULL) OR (("duration_seconds" >= (0)::numeric) AND ("duration_seconds" <= (10)::numeric)))),
    CONSTRAINT "check_vote_count_non_negative" CHECK ((("vote_count" >= 0) OR ("vote_count" IS NULL))),
    CONSTRAINT "check_weighted_score_non_negative" CHECK ((("weighted_score" >= (0)::numeric) OR ("weighted_score" IS NULL)))
);


ALTER TABLE "public"."tournament_clips" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tournament_clips"."duration_seconds" IS 'Video duration in seconds (max 8.5s enforced by app)';



COMMENT ON CONSTRAINT "check_vote_count_non_negative" ON "public"."tournament_clips" IS 'Ensures vote_count cannot be negative';



COMMENT ON CONSTRAINT "check_weighted_score_non_negative" ON "public"."tournament_clips" IS 'Ensures weighted_score cannot be negative';



CREATE OR REPLACE VIEW "public"."comment_moderation_queue" AS
 SELECT "c"."id",
    "c"."clip_id",
    "c"."username",
    "c"."avatar_url",
    "c"."comment_text",
    "c"."likes_count",
    "c"."parent_comment_id",
    "c"."created_at",
    "c"."moderation_status",
    "c"."moderation_reason",
    "tc"."title" AS "clip_title",
    "tc"."thumbnail_url" AS "clip_thumbnail"
   FROM ("public"."comments" "c"
     LEFT JOIN "public"."tournament_clips" "tc" ON (("c"."clip_id" = "tc"."id")))
  WHERE (("c"."moderation_status" = ANY (ARRAY['pending'::"text", 'flagged'::"text"])) AND ("c"."is_deleted" = false))
  ORDER BY
        CASE "c"."moderation_status"
            WHEN 'flagged'::"text" THEN 1
            WHEN 'pending'::"text" THEN 2
            ELSE NULL::integer
        END, "c"."created_at" DESC;


ALTER VIEW "public"."comment_moderation_queue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contact_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "reason" character varying(50) NOT NULL,
    "email" character varying(255) NOT NULL,
    "subject" character varying(255) NOT NULL,
    "message" "text" NOT NULL,
    "status" character varying(20) DEFAULT 'new'::character varying,
    "admin_notes" "text",
    "user_agent" "text",
    "ip_address" character varying(45),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid"
);


ALTER TABLE "public"."contact_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "clip_id" "uuid",
    "reported_user_id" "uuid",
    "comment_id" "uuid",
    "reason" character varying(50) NOT NULL,
    "description" "text",
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "admin_notes" "text",
    "action_taken" character varying(50),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    CONSTRAINT "report_has_target" CHECK ((("clip_id" IS NOT NULL) OR ("reported_user_id" IS NOT NULL) OR ("comment_id" IS NOT NULL)))
);


ALTER TABLE "public"."content_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(50) NOT NULL,
    "credits" integer NOT NULL,
    "price_cents" integer NOT NULL,
    "bonus_percent" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "stripe_price_id" character varying(100),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "credit_packages_credits_positive" CHECK (("credits" > 0))
);


ALTER TABLE "public"."credit_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" character varying(30) NOT NULL,
    "amount" integer NOT NULL,
    "balance_after" integer NOT NULL,
    "reference_id" "uuid",
    "stripe_payment_intent_id" character varying(100),
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_transaction_type" CHECK ((("type")::"text" = ANY ((ARRAY['purchase'::character varying, 'generation'::character varying, 'refund'::character varying, 'admin_grant'::character varying, 'admin_deduct'::character varying, 'bonus'::character varying])::"text"[])))
);


ALTER TABLE "public"."credit_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cron_locks" (
    "job_name" "text" NOT NULL,
    "lock_id" "text" NOT NULL,
    "acquired_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."cron_locks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."direction_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "slot_position" integer NOT NULL,
    "option_number" integer NOT NULL,
    "title" character varying(200) NOT NULL,
    "description" "text" NOT NULL,
    "mood" character varying(100),
    "suggested_genre" character varying(50),
    "visual_hints" "text",
    "narrative_hooks" "text",
    "vote_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "direction_options_option_number_check" CHECK ((("option_number" >= 1) AND ("option_number" <= 5))),
    CONSTRAINT "direction_options_vote_count_check" CHECK (("vote_count" >= 0))
);


ALTER TABLE "public"."direction_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."direction_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "direction_option_id" "uuid" NOT NULL,
    "voter_key" character varying(100) NOT NULL,
    "user_id" "uuid",
    "season_id" "uuid" NOT NULL,
    "slot_position" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."direction_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key" character varying(50) NOT NULL,
    "name" character varying(100) NOT NULL,
    "description" "text",
    "enabled" boolean DEFAULT false,
    "category" character varying(50) DEFAULT 'general'::character varying,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."feature_flags" OWNER TO "postgres";


COMMENT ON TABLE "public"."feature_flags" IS 'Admin-controlled feature toggles for the application';



CREATE TABLE IF NOT EXISTS "public"."votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "voter_key" "text" NOT NULL,
    "clip_id" "uuid" NOT NULL,
    "vote_weight" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "text",
    "vote_date" "date",
    "slot_position" integer,
    "vote_type" "text" DEFAULT 'standard'::"text",
    "flagged" boolean DEFAULT false,
    CONSTRAINT "check_vote_weight_range" CHECK ((("vote_weight" >= 1) AND ("vote_weight" <= 200)))
);


ALTER TABLE "public"."votes" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."flagged_votes_summary" AS
 SELECT "v"."id",
    "v"."clip_id",
    "v"."voter_key",
    "v"."vote_type",
    "v"."vote_weight",
    "v"."created_at",
    "v"."flagged",
    "tc"."username" AS "clip_owner",
    "tc"."video_url"
   FROM ("public"."votes" "v"
     LEFT JOIN "public"."tournament_clips" "tc" ON (("v"."clip_id" = "tc"."id")))
  WHERE ("v"."flagged" = true)
  ORDER BY "v"."created_at" DESC;


ALTER VIEW "public"."flagged_votes_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."followers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "follower_id" "uuid" NOT NULL,
    "following_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "no_self_follow" CHECK (("follower_id" <> "following_id"))
);


ALTER TABLE "public"."followers" OWNER TO "postgres";


COMMENT ON TABLE "public"."followers" IS 'Follow relationships between users';



CREATE TABLE IF NOT EXISTS "public"."genre_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_number" integer NOT NULL,
    "genre_code" "text" NOT NULL,
    "voter_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."genre_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."model_prompt_patterns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ai_model" character varying(50) NOT NULL,
    "pattern_type" character varying(50) NOT NULL,
    "pattern_text" character varying(200) NOT NULL,
    "usage_count" integer DEFAULT 1,
    "total_votes" integer DEFAULT 0,
    "avg_vote_score" double precision DEFAULT 0,
    "winner_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "decay_factor" double precision DEFAULT 1.0
);


ALTER TABLE "public"."model_prompt_patterns" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."model_patterns_scored" AS
 SELECT "id",
    "ai_model",
    "pattern_type",
    "pattern_text",
    "usage_count",
    "total_votes",
    "avg_vote_score",
    "winner_count",
    "created_at",
    "updated_at",
    "decay_factor",
    "public"."calculate_bayesian_score"("total_votes", "usage_count", "winner_count", "decay_factor") AS "bayesian_score"
   FROM "public"."model_prompt_patterns" "mpp"
  WHERE ("usage_count" >= 1);


ALTER VIEW "public"."model_patterns_scored" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."model_pricing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "model_key" character varying(50) NOT NULL,
    "display_name" character varying(100) NOT NULL,
    "fal_cost_cents" integer NOT NULL,
    "credit_cost" integer NOT NULL,
    "is_active" boolean DEFAULT true,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "target_margin_percent" integer DEFAULT 35,
    "min_credit_cost" integer,
    "last_cost_check_at" timestamp with time zone,
    "cost_drift_detected" boolean DEFAULT false,
    CONSTRAINT "model_pricing_credit_cost_positive" CHECK (("credit_cost" > 0))
);


ALTER TABLE "public"."model_pricing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."movie_access" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "granted_by" "uuid",
    "max_projects" integer DEFAULT 5,
    "max_scenes_per_project" integer DEFAULT 150,
    "is_active" boolean DEFAULT true,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."movie_access" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."movie_projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" character varying(200) NOT NULL,
    "description" "text",
    "source_text" "text" NOT NULL,
    "model" character varying(50) DEFAULT 'kling-2.6'::character varying NOT NULL,
    "style" character varying(50),
    "voice_id" character varying(100),
    "aspect_ratio" character varying(10) DEFAULT '16:9'::character varying,
    "target_duration_minutes" integer DEFAULT 10 NOT NULL,
    "status" character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    "total_scenes" integer DEFAULT 0,
    "completed_scenes" integer DEFAULT 0,
    "current_scene" integer DEFAULT 0,
    "estimated_credits" integer DEFAULT 0,
    "spent_credits" integer DEFAULT 0,
    "final_video_url" "text",
    "total_duration_seconds" numeric(8,2),
    "error_message" "text",
    "script_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    CONSTRAINT "movie_projects_spent_credits_non_negative" CHECK (("spent_credits" >= 0)),
    CONSTRAINT "valid_movie_status" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'script_generating'::character varying, 'script_ready'::character varying, 'generating'::character varying, 'paused'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying])::"text"[])))
);


ALTER TABLE "public"."movie_projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."movie_scenes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "scene_number" integer NOT NULL,
    "video_prompt" "text" NOT NULL,
    "narration_text" "text",
    "scene_title" character varying(200),
    "status" character varying(30) DEFAULT 'pending'::character varying NOT NULL,
    "ai_generation_id" "uuid",
    "video_url" "text",
    "public_video_url" "text",
    "last_frame_url" "text",
    "duration_seconds" numeric(6,2),
    "credit_cost" integer DEFAULT 0,
    "error_message" "text",
    "retry_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    CONSTRAINT "valid_scene_status" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'generating'::character varying, 'narrating'::character varying, 'merging'::character varying, 'completed'::character varying, 'failed'::character varying, 'skipped'::character varying])::"text"[])))
);


ALTER TABLE "public"."movie_scenes" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_clip_distribution_stats" AS
 SELECT "slot_position",
    "season_id",
    "count"(*) AS "total_clips",
    "count"(*) FILTER (WHERE ("view_count" = 0)) AS "zero_view_clips",
    "count"(*) FILTER (WHERE ("view_count" < 10)) AS "low_view_clips",
    "avg"("view_count") AS "avg_views",
    "min"("view_count") AS "min_views",
    "max"("view_count") AS "max_views"
   FROM "public"."tournament_clips"
  WHERE ("status" = 'active'::"text")
  GROUP BY "slot_position", "season_id"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_clip_distribution_stats" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_user_vote_counts" AS
 SELECT "voter_key",
    "count"(*) AS "vote_count",
    "rank"() OVER (ORDER BY ("count"(*)) DESC) AS "global_rank"
   FROM "public"."votes"
  GROUP BY "voter_key"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_user_vote_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_key" "text" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "action_url" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "is_read" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_at" timestamp with time zone,
    CONSTRAINT "notifications_type_check" CHECK (("type" = ANY (ARRAY['clip_approved'::"text", 'clip_rejected'::"text", 'clip_locked_in'::"text", 'slot_voting_started'::"text", 'achievement_unlocked'::"text", 'daily_goal_reached'::"text", 'new_follower'::"text", 'comment_received'::"text", 'vote_received'::"text", 'system_announcement'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."notifications" IS 'Stores user notifications for all events';



CREATE TABLE IF NOT EXISTS "public"."pinned_characters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "element_index" integer DEFAULT 1 NOT NULL,
    "label" character varying(100),
    "frontal_image_url" "text" NOT NULL,
    "reference_image_urls" "text"[] DEFAULT '{}'::"text"[],
    "source_clip_id" "uuid",
    "source_frame_timestamp" double precision,
    "pinned_by" "uuid",
    "usage_count" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_element_index" CHECK ((("element_index" >= 1) AND ("element_index" <= 4)))
);


ALTER TABLE "public"."pinned_characters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pricing_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "model_key" character varying(50) NOT NULL,
    "alert_type" character varying(30) NOT NULL,
    "severity" character varying(10) DEFAULT 'warning'::character varying NOT NULL,
    "current_margin_percent" numeric(5,2),
    "recommended_credit_cost" integer,
    "ai_analysis" "text",
    "is_resolved" boolean DEFAULT false,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "valid_alert_type" CHECK ((("alert_type")::"text" = ANY ((ARRAY['margin_low'::character varying, 'margin_high'::character varying, 'cost_drift'::character varying, 'recommendation'::character varying])::"text"[]))),
    CONSTRAINT "valid_severity" CHECK ((("severity")::"text" = ANY ((ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying])::"text"[])))
);


ALTER TABLE "public"."pricing_alerts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompt_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "clip_id" "uuid",
    "slot_id" "uuid",
    "season_id" "uuid" NOT NULL,
    "user_prompt" "text" NOT NULL,
    "ai_model" character varying(50) NOT NULL,
    "brief_id" "uuid",
    "vote_count" integer DEFAULT 0,
    "is_winner" boolean DEFAULT false,
    "scene_elements" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."prompt_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompt_visual_correlation" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_id" "uuid",
    "clip_visual_id" "uuid",
    "season_id" "uuid" NOT NULL,
    "correlation_score" double precision DEFAULT 1.0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."prompt_visual_correlation" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referrals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_id" "uuid" NOT NULL,
    "referred_id" "uuid",
    "referral_code" character varying(20) NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "reward_claimed" boolean DEFAULT false,
    "reward_amount" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."referrals" OWNER TO "postgres";


COMMENT ON TABLE "public"."referrals" IS 'Tracks user referrals and rewards';



CREATE TABLE IF NOT EXISTS "public"."scene_vocabulary" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "term" character varying(100) NOT NULL,
    "category" character varying(50) NOT NULL,
    "frequency" integer DEFAULT 1,
    "total_votes" integer DEFAULT 0,
    "avg_vote_score" double precision DEFAULT 0,
    "winner_count" integer DEFAULT 0,
    "example_prompts" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "decay_factor" double precision DEFAULT 1.0
);


ALTER TABLE "public"."scene_vocabulary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."scene_vocabulary_scored" AS
 SELECT "id",
    "season_id",
    "term",
    "category",
    "frequency",
    "total_votes",
    "avg_vote_score",
    "winner_count",
    "example_prompts",
    "created_at",
    "updated_at",
    "decay_factor",
    "public"."calculate_bayesian_score"("total_votes", "frequency", "winner_count", "decay_factor") AS "bayesian_score"
   FROM "public"."scene_vocabulary" "sv"
  WHERE ("frequency" >= 1);


ALTER VIEW "public"."scene_vocabulary_scored" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    "status" "text" NOT NULL,
    "total_slots" integer DEFAULT 75 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "finished_at" timestamp with time zone,
    "description" "text" DEFAULT ''::"text",
    "genre" "text",
    CONSTRAINT "seasons_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'finished'::"text"])))
);


ALTER TABLE "public"."seasons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slot_briefs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "slot_position" integer NOT NULL,
    "winning_direction_id" "uuid",
    "brief_title" character varying(200) NOT NULL,
    "scene_description" "text" NOT NULL,
    "visual_requirements" "text" NOT NULL,
    "tone_guidance" "text" NOT NULL,
    "continuity_notes" "text",
    "do_list" "text",
    "dont_list" "text",
    "example_prompts" "text"[],
    "status" character varying(20) DEFAULT 'draft'::character varying,
    "model_used" character varying(100),
    "input_token_count" integer,
    "output_token_count" integer,
    "cost_cents" integer,
    "published_at" timestamp with time zone,
    "published_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "slot_briefs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'archived'::character varying])::"text"[])))
);


ALTER TABLE "public"."slot_briefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_analyses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "slot_position" integer NOT NULL,
    "analysis" "jsonb" NOT NULL,
    "model_used" character varying(100) DEFAULT 'claude-sonnet-4-20250514'::character varying,
    "input_token_count" integer,
    "output_token_count" integer,
    "cost_cents" integer,
    "triggered_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."story_analyses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_slots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "slot_position" integer NOT NULL,
    "status" "text" NOT NULL,
    "genre" "text",
    "winning_clip_id" "uuid",
    "voting_started_at" timestamp with time zone,
    "voting_ends_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "winner_tournament_clip_id" "uuid",
    "voting_duration_hours" integer DEFAULT 24,
    "direction_voting_status" character varying(20) DEFAULT NULL::character varying,
    "direction_voting_ends_at" timestamp with time zone,
    "winning_direction_id" "uuid",
    "brief_id" "uuid",
    CONSTRAINT "story_slots_status_check" CHECK (("status" = ANY (ARRAY['upcoming'::"text", 'voting'::"text", 'locked'::"text", 'archived'::"text", 'waiting_for_clips'::"text"])))
);


ALTER TABLE "public"."story_slots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_cache" (
    "key" character varying(100) NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."system_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "invite_code" "text" NOT NULL,
    "max_uses" integer DEFAULT 5,
    "uses" integer DEFAULT 0,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."team_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "contribution_xp" bigint DEFAULT 0,
    "contribution_votes" integer DEFAULT 0,
    "last_active_date" "date",
    "joined_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "team_members_role_check" CHECK (("role" = ANY (ARRAY['leader'::"text", 'officer'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "message_length" CHECK ((("char_length"("message") >= 1) AND ("char_length"("message") <= 500)))
);


ALTER TABLE "public"."team_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_vote_coordination" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "team_id" "uuid" NOT NULL,
    "clip_id" "text" NOT NULL,
    "slot_position" integer NOT NULL,
    "member_votes" integer DEFAULT 1,
    "bonus_applied" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."team_vote_coordination" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teams" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "logo_url" "text",
    "leader_id" "uuid" NOT NULL,
    "level" integer DEFAULT 1,
    "total_xp" bigint DEFAULT 0,
    "current_streak" integer DEFAULT 0,
    "longest_streak" integer DEFAULT 0,
    "last_active_date" "date",
    "member_count" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "team_description_length" CHECK ((("description" IS NULL) OR ("char_length"("description") <= 200))),
    CONSTRAINT "team_name_length" CHECK ((("char_length"("name") >= 2) AND ("char_length"("name") <= 30)))
);


ALTER TABLE "public"."teams" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "blocker_id" "uuid" NOT NULL,
    "blocked_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "no_self_block" CHECK (("blocker_id" <> "blocked_id"))
);


ALTER TABLE "public"."user_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "google_id" "text",
    "email" "text",
    "device_key" "text",
    "username" "text" NOT NULL,
    "display_name" "text",
    "bio" "text",
    "avatar_url" "text",
    "level" integer DEFAULT 1,
    "xp" integer DEFAULT 0,
    "total_votes_cast" integer DEFAULT 0,
    "total_votes_received" integer DEFAULT 0,
    "clips_uploaded" integer DEFAULT 0,
    "clips_locked" integer DEFAULT 0,
    "followers_count" integer DEFAULT 0,
    "following_count" integer DEFAULT 0,
    "is_verified" boolean DEFAULT false,
    "is_banned" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_admin" boolean DEFAULT false,
    "referral_code" character varying(20),
    "referred_by" "uuid",
    "referral_count" integer DEFAULT 0,
    "current_streak" integer DEFAULT 0,
    "longest_streak" integer DEFAULT 0,
    "last_vote_date" "date",
    "votes_today" integer DEFAULT 0,
    "last_vote_reset" "date",
    "ai_daily_limit" integer,
    "balance_credits" integer DEFAULT 0,
    "lifetime_purchased_credits" integer DEFAULT 0,
    "lifetime_earned_credits" integer DEFAULT 0,
    CONSTRAINT "bio_length" CHECK ((("bio" IS NULL) OR ("length"("bio") <= 150))),
    CONSTRAINT "username_format" CHECK (("username" ~ '^[a-z0-9_]+$'::"text")),
    CONSTRAINT "username_length" CHECK ((("length"("username") >= 3) AND ("length"("username") <= 20))),
    CONSTRAINT "users_balance_non_negative" CHECK (("balance_credits" >= 0)),
    CONSTRAINT "valid_ai_daily_limit" CHECK ((("ai_daily_limit" IS NULL) OR ("ai_daily_limit" = '-1'::integer) OR ("ai_daily_limit" > 0)))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS 'User profiles for the app';



COMMENT ON COLUMN "public"."users"."google_id" IS 'Google OAuth ID for authenticated users';



COMMENT ON COLUMN "public"."users"."device_key" IS 'Hashed device identifier for anonymous users';



COMMENT ON COLUMN "public"."users"."level" IS 'User level calculated from XP';



COMMENT ON COLUMN "public"."users"."xp" IS 'Experience points earned from activities';



COMMENT ON COLUMN "public"."users"."ai_daily_limit" IS 'Custom daily AI generation limit. NULL=use global default, -1=unlimited, >0=specific limit';



CREATE TABLE IF NOT EXISTS "public"."visual_vocabulary" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "season_id" "uuid" NOT NULL,
    "term" character varying(100) NOT NULL,
    "category" character varying(50) NOT NULL,
    "frequency" integer DEFAULT 1,
    "total_votes" integer DEFAULT 0,
    "avg_vote_score" double precision DEFAULT 0,
    "winner_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "decay_factor" double precision DEFAULT 1.0
);


ALTER TABLE "public"."visual_vocabulary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."visual_vocabulary_scored" AS
 SELECT "id",
    "season_id",
    "term",
    "category",
    "frequency",
    "total_votes",
    "avg_vote_score",
    "winner_count",
    "created_at",
    "updated_at",
    "decay_factor",
    "public"."calculate_bayesian_score"("total_votes", "frequency", "winner_count", "decay_factor") AS "bayesian_score"
   FROM "public"."visual_vocabulary" "vv"
  WHERE ("frequency" >= 1);


ALTER VIEW "public"."visual_vocabulary_scored" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_generation_limits"
    ADD CONSTRAINT "ai_generation_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_generation_limits"
    ADD CONSTRAINT "ai_generation_limits_user_id_date_key" UNIQUE ("user_id", "date");



ALTER TABLE ONLY "public"."ai_generations"
    ADD CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."character_reference_suggestions"
    ADD CONSTRAINT "character_reference_suggestions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clip_views"
    ADD CONSTRAINT "clip_views_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clip_visuals"
    ADD CONSTRAINT "clip_visuals_clip_id_key" UNIQUE ("clip_id");



ALTER TABLE ONLY "public"."clip_visuals"
    ADD CONSTRAINT "clip_visuals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_comment_id_user_key_key" UNIQUE ("comment_id", "user_key");



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_submissions"
    ADD CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_packages"
    ADD CONSTRAINT "credit_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credit_transactions"
    ADD CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cron_locks"
    ADD CONSTRAINT "cron_locks_job_name_key" UNIQUE ("job_name");



ALTER TABLE ONLY "public"."cron_locks"
    ADD CONSTRAINT "cron_locks_pkey" PRIMARY KEY ("job_name");



ALTER TABLE ONLY "public"."direction_options"
    ADD CONSTRAINT "direction_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."direction_options"
    ADD CONSTRAINT "direction_options_season_id_slot_position_option_number_key" UNIQUE ("season_id", "slot_position", "option_number");



ALTER TABLE ONLY "public"."direction_votes"
    ADD CONSTRAINT "direction_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."direction_votes"
    ADD CONSTRAINT "direction_votes_season_id_slot_position_voter_key_key" UNIQUE ("season_id", "slot_position", "voter_key");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."followers"
    ADD CONSTRAINT "followers_follower_id_following_id_key" UNIQUE ("follower_id", "following_id");



ALTER TABLE ONLY "public"."followers"
    ADD CONSTRAINT "followers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."genre_votes"
    ADD CONSTRAINT "genre_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."genre_votes"
    ADD CONSTRAINT "genre_votes_unique_vote_per_device" UNIQUE ("season_number", "voter_key");



ALTER TABLE ONLY "public"."model_pricing"
    ADD CONSTRAINT "model_pricing_model_key_key" UNIQUE ("model_key");



ALTER TABLE ONLY "public"."model_pricing"
    ADD CONSTRAINT "model_pricing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."model_prompt_patterns"
    ADD CONSTRAINT "model_prompt_patterns_ai_model_pattern_type_pattern_text_key" UNIQUE ("ai_model", "pattern_type", "pattern_text");



ALTER TABLE ONLY "public"."model_prompt_patterns"
    ADD CONSTRAINT "model_prompt_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movie_access"
    ADD CONSTRAINT "movie_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movie_access"
    ADD CONSTRAINT "movie_access_user_unique" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."movie_projects"
    ADD CONSTRAINT "movie_projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movie_scenes"
    ADD CONSTRAINT "movie_scenes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."movie_scenes"
    ADD CONSTRAINT "movie_scenes_unique_number" UNIQUE ("project_id", "scene_number");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pinned_characters"
    ADD CONSTRAINT "pinned_characters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pinned_characters"
    ADD CONSTRAINT "pinned_characters_season_id_element_index_key" UNIQUE ("season_id", "element_index");



ALTER TABLE ONLY "public"."pricing_alerts"
    ADD CONSTRAINT "pricing_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prompt_history"
    ADD CONSTRAINT "prompt_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prompt_visual_correlation"
    ADD CONSTRAINT "prompt_visual_correlation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prompt_visual_correlation"
    ADD CONSTRAINT "prompt_visual_correlation_prompt_id_clip_visual_id_key" UNIQUE ("prompt_id", "clip_visual_id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scene_vocabulary"
    ADD CONSTRAINT "scene_vocabulary_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scene_vocabulary"
    ADD CONSTRAINT "scene_vocabulary_season_id_term_category_key" UNIQUE ("season_id", "term", "category");



ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slot_briefs"
    ADD CONSTRAINT "slot_briefs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."slot_briefs"
    ADD CONSTRAINT "slot_briefs_season_id_slot_position_key" UNIQUE ("season_id", "slot_position");



ALTER TABLE ONLY "public"."story_analyses"
    ADD CONSTRAINT "story_analyses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."story_analyses"
    ADD CONSTRAINT "story_analyses_season_id_slot_position_key" UNIQUE ("season_id", "slot_position");



ALTER TABLE ONLY "public"."story_slots"
    ADD CONSTRAINT "story_slots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_cache"
    ADD CONSTRAINT "system_cache_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_user_id_key" UNIQUE ("team_id", "user_id");



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."team_messages"
    ADD CONSTRAINT "team_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_vote_coordination"
    ADD CONSTRAINT "team_vote_coordination_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_vote_coordination"
    ADD CONSTRAINT "team_vote_coordination_team_id_clip_id_key" UNIQUE ("team_id", "clip_id");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tournament_clips"
    ADD CONSTRAINT "tournament_clips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_blocks"
    ADD CONSTRAINT "unique_block" UNIQUE ("blocker_id", "blocked_id");



ALTER TABLE ONLY "public"."user_blocks"
    ADD CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_google_id_key" UNIQUE ("google_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."visual_vocabulary"
    ADD CONSTRAINT "visual_vocabulary_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."visual_vocabulary"
    ADD CONSTRAINT "visual_vocabulary_season_id_term_category_key" UNIQUE ("season_id", "term", "category");



ALTER TABLE ONLY "public"."votes"
    ADD CONSTRAINT "votes_clip_voter_unique" UNIQUE ("clip_id", "voter_key");



ALTER TABLE ONLY "public"."votes"
    ADD CONSTRAINT "votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."votes"
    ADD CONSTRAINT "votes_unique_voter_clip" UNIQUE ("voter_key", "clip_id");



CREATE INDEX "idx_ai_gen_credit_orphans" ON "public"."ai_generations" USING "btree" ("credit_deducted", "status", "created_at") WHERE (("credit_deducted" = true) AND (("status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'failed'::character varying])::"text"[])));



CREATE UNIQUE INDEX "idx_ai_gen_fal_id" ON "public"."ai_generations" USING "btree" ("fal_request_id");



CREATE INDEX "idx_ai_gen_status" ON "public"."ai_generations" USING "btree" ("status") WHERE (("status")::"text" = ANY ((ARRAY['pending'::character varying, 'processing'::character varying])::"text"[]));



CREATE INDEX "idx_ai_gen_user" ON "public"."ai_generations" USING "btree" ("user_id");



CREATE INDEX "idx_audit_logs_action" ON "public"."audit_logs" USING "btree" ("action");



CREATE INDEX "idx_audit_logs_admin_id" ON "public"."audit_logs" USING "btree" ("admin_id");



CREATE INDEX "idx_audit_logs_created_at" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_logs_resource" ON "public"."audit_logs" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "idx_clip_views_age" ON "public"."clip_views" USING "btree" ("viewed_at");



CREATE INDEX "idx_clip_views_clip_id" ON "public"."clip_views" USING "btree" ("clip_id");



CREATE INDEX "idx_clip_views_voter" ON "public"."clip_views" USING "btree" ("voter_key", "clip_id");



CREATE INDEX "idx_clip_views_voter_clip" ON "public"."clip_views" USING "btree" ("voter_key", "clip_id");



CREATE INDEX "idx_clip_views_voter_key" ON "public"."clip_views" USING "btree" ("voter_key");



CREATE INDEX "idx_clip_views_voter_lookup" ON "public"."clip_views" USING "btree" ("voter_key", "clip_id");



CREATE INDEX "idx_clip_visuals_season" ON "public"."clip_visuals" USING "btree" ("season_id");



CREATE INDEX "idx_clip_visuals_season_winner_votes" ON "public"."clip_visuals" USING "btree" ("season_id", "is_winner", "vote_count" DESC);



CREATE INDEX "idx_clip_visuals_winner" ON "public"."clip_visuals" USING "btree" ("is_winner") WHERE ("is_winner" = true);



CREATE INDEX "idx_clips_ai_generated" ON "public"."tournament_clips" USING "btree" ("is_ai_generated") WHERE ("is_ai_generated" = true);



CREATE INDEX "idx_clips_distribution" ON "public"."tournament_clips" USING "btree" ("slot_position", "season_id", "status", "view_count") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_clips_elimination_cleanup" ON "public"."tournament_clips" USING "btree" ("status", "eliminated_at") WHERE (("status" = ANY (ARRAY['eliminated'::"text", 'rejected'::"text"])) AND ("is_pinned" = false));



CREATE INDEX "idx_clips_engagement" ON "public"."tournament_clips" USING "btree" ("slot_position", "season_id", "status", "vote_count" DESC) WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_clips_pinned" ON "public"."tournament_clips" USING "btree" ("user_id") WHERE ("is_pinned" = true);



CREATE INDEX "idx_clips_recent" ON "public"."tournament_clips" USING "btree" ("slot_position", "season_id", "status", "created_at" DESC) WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_clips_season_slot_created" ON "public"."tournament_clips" USING "btree" ("season_id", "slot_position", "created_at" DESC);



CREATE INDEX "idx_clips_season_slot_status" ON "public"."tournament_clips" USING "btree" ("season_id", "slot_position", "status");



CREATE INDEX "idx_clips_slot_season_status" ON "public"."tournament_clips" USING "btree" ("slot_position", "season_id", "status");



CREATE INDEX "idx_clips_status" ON "public"."tournament_clips" USING "btree" ("status");



CREATE INDEX "idx_clips_status_created" ON "public"."tournament_clips" USING "btree" ("status", "created_at" DESC) WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_clips_user_id" ON "public"."tournament_clips" USING "btree" ("user_id");



CREATE INDEX "idx_clips_view_count" ON "public"."tournament_clips" USING "btree" ("view_count" NULLS FIRST) WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_clips_vote_count" ON "public"."tournament_clips" USING "btree" ("vote_count" DESC);



CREATE INDEX "idx_clips_weighted_score" ON "public"."tournament_clips" USING "btree" ("weighted_score" DESC);



CREATE INDEX "idx_comment_likes_comment_id" ON "public"."comment_likes" USING "btree" ("comment_id");



CREATE INDEX "idx_comment_likes_user_key" ON "public"."comment_likes" USING "btree" ("user_key");



CREATE INDEX "idx_comments_clip_deleted" ON "public"."comments" USING "btree" ("clip_id", "is_deleted") WHERE ("is_deleted" = false);



CREATE INDEX "idx_comments_clip_id" ON "public"."comments" USING "btree" ("clip_id");



CREATE INDEX "idx_comments_created_at" ON "public"."comments" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_comments_likes" ON "public"."comments" USING "btree" ("likes_count" DESC);



CREATE INDEX "idx_comments_moderation_status" ON "public"."comments" USING "btree" ("moderation_status") WHERE ("moderation_status" <> 'approved'::"text");



CREATE INDEX "idx_comments_parent_id" ON "public"."comments" USING "btree" ("parent_comment_id");



CREATE INDEX "idx_comments_pending_moderation" ON "public"."comments" USING "btree" ("created_at" DESC) WHERE ("moderation_status" = 'pending'::"text");



CREATE INDEX "idx_comments_user_key" ON "public"."comments" USING "btree" ("user_key");



CREATE INDEX "idx_contact_submissions_created_at" ON "public"."contact_submissions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_contact_submissions_status" ON "public"."contact_submissions" USING "btree" ("status");



CREATE INDEX "idx_contact_submissions_user_id" ON "public"."contact_submissions" USING "btree" ("user_id");



CREATE INDEX "idx_content_reports_clip" ON "public"."content_reports" USING "btree" ("clip_id") WHERE ("clip_id" IS NOT NULL);



CREATE INDEX "idx_content_reports_created_at" ON "public"."content_reports" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_content_reports_reporter" ON "public"."content_reports" USING "btree" ("reporter_id");



CREATE INDEX "idx_content_reports_status" ON "public"."content_reports" USING "btree" ("status");



CREATE INDEX "idx_content_reports_user" ON "public"."content_reports" USING "btree" ("reported_user_id") WHERE ("reported_user_id" IS NOT NULL);



CREATE INDEX "idx_credit_packages_active" ON "public"."credit_packages" USING "btree" ("is_active", "sort_order") WHERE ("is_active" = true);



CREATE INDEX "idx_credit_trans_ref" ON "public"."credit_transactions" USING "btree" ("reference_id") WHERE ("reference_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_credit_trans_stripe_unique" ON "public"."credit_transactions" USING "btree" ("stripe_payment_intent_id") WHERE ("stripe_payment_intent_id" IS NOT NULL);



CREATE INDEX "idx_credit_trans_type" ON "public"."credit_transactions" USING "btree" ("type");



CREATE INDEX "idx_credit_trans_user" ON "public"."credit_transactions" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_credit_transactions_refund_unique" ON "public"."credit_transactions" USING "btree" ("reference_id") WHERE ((("type")::"text" = 'refund'::"text") AND ("reference_id" IS NOT NULL));



CREATE INDEX "idx_cron_locks_expires" ON "public"."cron_locks" USING "btree" ("expires_at");



CREATE INDEX "idx_direction_options_slot" ON "public"."direction_options" USING "btree" ("season_id", "slot_position");



CREATE INDEX "idx_direction_votes_option" ON "public"."direction_votes" USING "btree" ("direction_option_id");



CREATE INDEX "idx_direction_votes_voter" ON "public"."direction_votes" USING "btree" ("voter_key", "season_id", "slot_position");



CREATE INDEX "idx_feature_flags_category" ON "public"."feature_flags" USING "btree" ("category");



CREATE INDEX "idx_feature_flags_key" ON "public"."feature_flags" USING "btree" ("key");



CREATE INDEX "idx_followers_follower" ON "public"."followers" USING "btree" ("follower_id");



CREATE INDEX "idx_followers_following" ON "public"."followers" USING "btree" ("following_id");



CREATE INDEX "idx_genre_votes_voter_key" ON "public"."genre_votes" USING "btree" ("voter_key");



CREATE INDEX "idx_model_patterns_decay" ON "public"."model_prompt_patterns" USING "btree" ("decay_factor") WHERE ("decay_factor" < (0.5)::double precision);



CREATE INDEX "idx_model_patterns_model" ON "public"."model_prompt_patterns" USING "btree" ("ai_model");



CREATE INDEX "idx_model_patterns_score" ON "public"."model_prompt_patterns" USING "btree" ("avg_vote_score" DESC) WHERE ("usage_count" >= 3);



CREATE INDEX "idx_movie_access_user_id" ON "public"."movie_access" USING "btree" ("user_id");



CREATE INDEX "idx_movie_projects_status" ON "public"."movie_projects" USING "btree" ("status");



CREATE INDEX "idx_movie_projects_user_id" ON "public"."movie_projects" USING "btree" ("user_id");



CREATE INDEX "idx_movie_projects_user_status" ON "public"."movie_projects" USING "btree" ("user_id", "status");



CREATE INDEX "idx_movie_scenes_generation" ON "public"."movie_scenes" USING "btree" ("ai_generation_id") WHERE ("ai_generation_id" IS NOT NULL);



CREATE INDEX "idx_movie_scenes_project_id" ON "public"."movie_scenes" USING "btree" ("project_id");



CREATE INDEX "idx_movie_scenes_project_number" ON "public"."movie_scenes" USING "btree" ("project_id", "scene_number");



CREATE INDEX "idx_movie_scenes_status" ON "public"."movie_scenes" USING "btree" ("status");



CREATE UNIQUE INDEX "idx_mv_clip_dist_slot" ON "public"."mv_clip_distribution_stats" USING "btree" ("slot_position", "season_id");



CREATE UNIQUE INDEX "idx_mv_user_vote_counts_voter" ON "public"."mv_user_vote_counts" USING "btree" ("voter_key");



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_is_read" ON "public"."notifications" USING "btree" ("is_read");



CREATE INDEX "idx_notifications_type" ON "public"."notifications" USING "btree" ("type");



CREATE INDEX "idx_notifications_user_key" ON "public"."notifications" USING "btree" ("user_key");



CREATE INDEX "idx_pinned_chars_season" ON "public"."pinned_characters" USING "btree" ("season_id") WHERE ("is_active" = true);



CREATE INDEX "idx_pricing_alerts_unresolved" ON "public"."pricing_alerts" USING "btree" ("is_resolved", "created_at" DESC) WHERE ("is_resolved" = false);



CREATE INDEX "idx_prompt_history_scene_elements" ON "public"."prompt_history" USING "gin" ("scene_elements");



CREATE INDEX "idx_prompt_history_season_model" ON "public"."prompt_history" USING "btree" ("season_id", "ai_model");



CREATE INDEX "idx_prompt_history_unprocessed" ON "public"."prompt_history" USING "btree" ("created_at" DESC) WHERE ("scene_elements" IS NULL);



CREATE INDEX "idx_prompt_history_vote_count" ON "public"."prompt_history" USING "btree" ("vote_count" DESC);



CREATE INDEX "idx_prompt_history_winner" ON "public"."prompt_history" USING "btree" ("is_winner") WHERE ("is_winner" = true);



CREATE INDEX "idx_prompt_history_winning_by_season" ON "public"."prompt_history" USING "btree" ("season_id", "vote_count" DESC) WHERE ("is_winner" = true);



CREATE INDEX "idx_prompt_visual_season" ON "public"."prompt_visual_correlation" USING "btree" ("season_id");



CREATE INDEX "idx_ref_suggestions_character" ON "public"."character_reference_suggestions" USING "btree" ("pinned_character_id");



CREATE INDEX "idx_ref_suggestions_pending" ON "public"."character_reference_suggestions" USING "btree" ("status", "created_at") WHERE (("status")::"text" = 'pending'::"text");



CREATE INDEX "idx_ref_suggestions_user" ON "public"."character_reference_suggestions" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_referrals_code" ON "public"."referrals" USING "btree" ("referral_code");



CREATE INDEX "idx_referrals_referrer" ON "public"."referrals" USING "btree" ("referrer_id");



CREATE INDEX "idx_referrals_status" ON "public"."referrals" USING "btree" ("status");



CREATE INDEX "idx_scene_vocab_avg_score" ON "public"."scene_vocabulary" USING "btree" ("avg_vote_score" DESC) WHERE ("avg_vote_score" > (0)::double precision);



CREATE INDEX "idx_scene_vocab_decay" ON "public"."scene_vocabulary" USING "btree" ("decay_factor") WHERE ("decay_factor" < (0.5)::double precision);



CREATE INDEX "idx_scene_vocab_frequency" ON "public"."scene_vocabulary" USING "btree" ("frequency" DESC);



CREATE INDEX "idx_scene_vocab_season_cat" ON "public"."scene_vocabulary" USING "btree" ("season_id", "category");



CREATE UNIQUE INDEX "idx_seasons_active_genre" ON "public"."seasons" USING "btree" ("genre") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_seasons_genre" ON "public"."seasons" USING "btree" ("genre");



CREATE INDEX "idx_seasons_status" ON "public"."seasons" USING "btree" ("status");



CREATE INDEX "idx_seasons_status_genre" ON "public"."seasons" USING "btree" ("status", "genre");



CREATE INDEX "idx_slot_briefs_published" ON "public"."slot_briefs" USING "btree" ("status") WHERE (("status")::"text" = 'published'::"text");



CREATE INDEX "idx_slot_briefs_slot" ON "public"."slot_briefs" USING "btree" ("season_id", "slot_position");



CREATE INDEX "idx_slots_season_position" ON "public"."story_slots" USING "btree" ("season_id", "slot_position");



CREATE INDEX "idx_slots_season_status" ON "public"."story_slots" USING "btree" ("season_id", "status");



CREATE INDEX "idx_slots_status" ON "public"."story_slots" USING "btree" ("status");



CREATE INDEX "idx_story_analyses_season" ON "public"."story_analyses" USING "btree" ("season_id");



CREATE UNIQUE INDEX "idx_story_slots_season_slot" ON "public"."story_slots" USING "btree" ("season_id", "slot_position");



CREATE UNIQUE INDEX "idx_story_slots_unique" ON "public"."story_slots" USING "btree" ("season_id", "slot_position");



CREATE INDEX "idx_team_invites_code" ON "public"."team_invites" USING "btree" ("invite_code");



CREATE INDEX "idx_team_invites_team" ON "public"."team_invites" USING "btree" ("team_id");



CREATE INDEX "idx_team_members_team" ON "public"."team_members" USING "btree" ("team_id");



CREATE INDEX "idx_team_members_user" ON "public"."team_members" USING "btree" ("user_id");



CREATE INDEX "idx_team_messages_created" ON "public"."team_messages" USING "btree" ("team_id", "created_at" DESC);



CREATE INDEX "idx_team_messages_team" ON "public"."team_messages" USING "btree" ("team_id");



CREATE INDEX "idx_team_vote_coord" ON "public"."team_vote_coordination" USING "btree" ("team_id", "clip_id");



CREATE INDEX "idx_teams_leader" ON "public"."teams" USING "btree" ("leader_id");



CREATE INDEX "idx_teams_level" ON "public"."teams" USING "btree" ("level" DESC);



CREATE INDEX "idx_teams_streak" ON "public"."teams" USING "btree" ("current_streak" DESC);



CREATE UNIQUE INDEX "idx_tournament_clips_clip_id" ON "public"."tournament_clips" USING "btree" ("clip_id");



CREATE INDEX "idx_tournament_clips_season_id" ON "public"."tournament_clips" USING "btree" ("season_id");



CREATE INDEX "idx_tournament_clips_slot_position" ON "public"."tournament_clips" USING "btree" ("slot_position");



CREATE INDEX "idx_tournament_clips_status" ON "public"."tournament_clips" USING "btree" ("status");



CREATE INDEX "idx_tournament_clips_user_id" ON "public"."tournament_clips" USING "btree" ("user_id");



CREATE INDEX "idx_tournament_clips_vote_count" ON "public"."tournament_clips" USING "btree" ("vote_count" DESC);



CREATE UNIQUE INDEX "idx_unique_clip_report" ON "public"."content_reports" USING "btree" ("reporter_id", "clip_id") WHERE (("clip_id" IS NOT NULL) AND (("status")::"text" = 'pending'::"text"));



CREATE UNIQUE INDEX "idx_unique_user_report" ON "public"."content_reports" USING "btree" ("reporter_id", "reported_user_id") WHERE (("reported_user_id" IS NOT NULL) AND (("status")::"text" = 'pending'::"text"));



CREATE INDEX "idx_user_blocks_blocked" ON "public"."user_blocks" USING "btree" ("blocked_id");



CREATE INDEX "idx_user_blocks_blocker" ON "public"."user_blocks" USING "btree" ("blocker_id");



CREATE INDEX "idx_users_device_key" ON "public"."users" USING "btree" ("device_key");



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email");



CREATE INDEX "idx_users_google_id" ON "public"."users" USING "btree" ("google_id");



CREATE INDEX "idx_users_level" ON "public"."users" USING "btree" ("level" DESC);



CREATE INDEX "idx_users_username" ON "public"."users" USING "btree" ("username");



CREATE INDEX "idx_users_xp" ON "public"."users" USING "btree" ("xp" DESC);



CREATE INDEX "idx_visual_vocab_decay" ON "public"."visual_vocabulary" USING "btree" ("decay_factor") WHERE ("decay_factor" < (0.5)::double precision);



CREATE INDEX "idx_visual_vocab_frequency" ON "public"."visual_vocabulary" USING "btree" ("frequency" DESC);



CREATE INDEX "idx_visual_vocab_score" ON "public"."visual_vocabulary" USING "btree" ("avg_vote_score" DESC) WHERE ("avg_vote_score" > (0)::double precision);



CREATE INDEX "idx_visual_vocab_season_cat" ON "public"."visual_vocabulary" USING "btree" ("season_id", "category");



CREATE INDEX "idx_votes_clip_id" ON "public"."votes" USING "btree" ("clip_id");



CREATE INDEX "idx_votes_created_at" ON "public"."votes" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_votes_flagged" ON "public"."votes" USING "btree" ("flagged") WHERE ("flagged" = true);



CREATE UNIQUE INDEX "idx_votes_one_mega_per_slot" ON "public"."votes" USING "btree" ("voter_key", "slot_position") WHERE ("vote_type" = 'mega'::"text");



CREATE UNIQUE INDEX "idx_votes_one_super_per_slot" ON "public"."votes" USING "btree" ("voter_key", "slot_position") WHERE ("vote_type" = 'super'::"text");



CREATE INDEX "idx_votes_user_id" ON "public"."votes" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_votes_user_id_created" ON "public"."votes" USING "btree" ("user_id", "created_at" DESC) WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_votes_voter_clip" ON "public"."votes" USING "btree" ("voter_key", "clip_id");



CREATE INDEX "idx_votes_voter_key" ON "public"."votes" USING "btree" ("voter_key");



CREATE INDEX "idx_votes_voter_key_created" ON "public"."votes" USING "btree" ("voter_key", "created_at" DESC);



CREATE INDEX "idx_votes_voter_slot" ON "public"."votes" USING "btree" ("voter_key", "slot_position");



CREATE INDEX "idx_votes_voter_slot_type" ON "public"."votes" USING "btree" ("voter_key", "slot_position", "vote_type");



CREATE INDEX "idx_votes_voter_weight" ON "public"."votes" USING "btree" ("voter_key", "vote_weight");



CREATE OR REPLACE TRIGGER "comment_likes_count_trigger" AFTER INSERT OR DELETE ON "public"."comment_likes" FOR EACH ROW EXECUTE FUNCTION "public"."update_comment_likes_count"();



CREATE OR REPLACE TRIGGER "comments_updated_at_trigger" BEFORE UPDATE ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."update_comments_updated_at"();



CREATE OR REPLACE TRIGGER "direction_options_updated_at" BEFORE UPDATE ON "public"."direction_options" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "feature_flags_updated_at" BEFORE UPDATE ON "public"."feature_flags" FOR EACH ROW EXECUTE FUNCTION "public"."update_feature_flags_updated_at"();



CREATE OR REPLACE TRIGGER "followers_count_trigger" AFTER INSERT OR DELETE ON "public"."followers" FOR EACH ROW EXECUTE FUNCTION "public"."update_followers_count"();



CREATE OR REPLACE TRIGGER "movie_projects_updated_at" BEFORE UPDATE ON "public"."movie_projects" FOR EACH ROW EXECUTE FUNCTION "public"."update_movie_projects_updated_at"();



CREATE OR REPLACE TRIGGER "on_clip_view_insert" AFTER INSERT ON "public"."clip_views" FOR EACH ROW EXECUTE FUNCTION "public"."increment_clip_view_count"();



CREATE OR REPLACE TRIGGER "on_vote_delete" AFTER DELETE ON "public"."votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_clip_vote_count_on_delete"();



CREATE OR REPLACE TRIGGER "on_vote_delete_update_user_stats" AFTER DELETE ON "public"."votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_stats_on_vote_delete"();



CREATE OR REPLACE TRIGGER "on_vote_insert" AFTER INSERT ON "public"."votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_clip_vote_count"();



CREATE OR REPLACE TRIGGER "on_vote_update_user_stats" AFTER INSERT ON "public"."votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_stats_on_vote"();



CREATE OR REPLACE TRIGGER "set_vote_date_trigger" BEFORE INSERT ON "public"."votes" FOR EACH ROW EXECUTE FUNCTION "public"."set_vote_date"();



CREATE OR REPLACE TRIGGER "slot_briefs_updated_at" BEFORE UPDATE ON "public"."slot_briefs" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "story_analyses_updated_at" BEFORE UPDATE ON "public"."story_analyses" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "trg_ai_gen_updated_at" BEFORE UPDATE ON "public"."ai_generations" FOR EACH ROW EXECUTE FUNCTION "public"."update_ai_gen_updated_at"();



CREATE OR REPLACE TRIGGER "trg_check_comment_nesting_depth" BEFORE INSERT ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."check_comment_nesting_depth"();



CREATE OR REPLACE TRIGGER "trg_check_commenter_not_banned" BEFORE INSERT ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."check_commenter_not_banned"();



CREATE OR REPLACE TRIGGER "trg_check_voter_not_banned" BEFORE INSERT ON "public"."votes" FOR EACH ROW EXECUTE FUNCTION "public"."check_voter_not_banned"();



CREATE OR REPLACE TRIGGER "trg_clip_visuals_updated_at" BEFORE UPDATE ON "public"."clip_visuals" FOR EACH ROW EXECUTE FUNCTION "public"."update_prompt_history_updated_at"();



CREATE OR REPLACE TRIGGER "trg_direction_vote_count" AFTER INSERT OR DELETE ON "public"."direction_votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_direction_vote_count"();



CREATE OR REPLACE TRIGGER "trg_pinned_chars_updated_at" BEFORE UPDATE ON "public"."pinned_characters" FOR EACH ROW EXECUTE FUNCTION "public"."update_pinned_chars_updated_at"();



CREATE OR REPLACE TRIGGER "trg_prevent_admin_promotion" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_unauthorized_admin_promotion"();



CREATE OR REPLACE TRIGGER "trg_prompt_history_updated_at" BEFORE UPDATE ON "public"."prompt_history" FOR EACH ROW EXECUTE FUNCTION "public"."update_prompt_history_updated_at"();



CREATE OR REPLACE TRIGGER "trg_scene_vocab_updated_at" BEFORE UPDATE ON "public"."scene_vocabulary" FOR EACH ROW EXECUTE FUNCTION "public"."update_prompt_history_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sync_prompt_learning" AFTER UPDATE OF "vote_count", "status" ON "public"."tournament_clips" FOR EACH ROW EXECUTE FUNCTION "public"."sync_prompt_learning_from_clip"();



CREATE OR REPLACE TRIGGER "trg_sync_visual_learning" AFTER UPDATE OF "vote_count", "status" ON "public"."tournament_clips" FOR EACH ROW EXECUTE FUNCTION "public"."sync_visual_learning_from_clip"();



CREATE OR REPLACE TRIGGER "trg_visual_vocab_updated_at" BEFORE UPDATE ON "public"."visual_vocabulary" FOR EACH ROW EXECUTE FUNCTION "public"."update_prompt_history_updated_at"();



CREATE OR REPLACE TRIGGER "trigger_team_member_count" AFTER INSERT OR DELETE ON "public"."team_members" FOR EACH ROW EXECUTE FUNCTION "public"."update_team_member_count"();



CREATE OR REPLACE TRIGGER "trigger_validate_vote_weight" BEFORE INSERT OR UPDATE ON "public"."votes" FOR EACH ROW EXECUTE FUNCTION "public"."validate_vote_weight"();



CREATE OR REPLACE TRIGGER "update_contact_submissions_updated_at" BEFORE UPDATE ON "public"."contact_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_content_reports_updated_at" BEFORE UPDATE ON "public"."content_reports" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "users_updated_at_trigger" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_users_updated_at"();



CREATE OR REPLACE TRIGGER "vote_stats_trigger" AFTER INSERT ON "public"."votes" FOR EACH ROW EXECUTE FUNCTION "public"."update_user_vote_stats"();



ALTER TABLE ONLY "public"."ai_generation_limits"
    ADD CONSTRAINT "ai_generation_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."ai_generations"
    ADD CONSTRAINT "ai_generations_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "public"."tournament_clips"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_generations"
    ADD CONSTRAINT "ai_generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."character_reference_suggestions"
    ADD CONSTRAINT "character_reference_suggestions_pinned_character_id_fkey" FOREIGN KEY ("pinned_character_id") REFERENCES "public"."pinned_characters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."character_reference_suggestions"
    ADD CONSTRAINT "character_reference_suggestions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."character_reference_suggestions"
    ADD CONSTRAINT "character_reference_suggestions_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."character_reference_suggestions"
    ADD CONSTRAINT "character_reference_suggestions_source_clip_id_fkey" FOREIGN KEY ("source_clip_id") REFERENCES "public"."tournament_clips"("id");



ALTER TABLE ONLY "public"."character_reference_suggestions"
    ADD CONSTRAINT "character_reference_suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clip_visuals"
    ADD CONSTRAINT "clip_visuals_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "public"."tournament_clips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clip_visuals"
    ADD CONSTRAINT "clip_visuals_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_moderated_by_fkey" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_parent_comment_id_fkey" FOREIGN KEY ("parent_comment_id") REFERENCES "public"."comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_submissions"
    ADD CONSTRAINT "contact_submissions_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."contact_submissions"
    ADD CONSTRAINT "contact_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "public"."tournament_clips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."credit_transactions"
    ADD CONSTRAINT "credit_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."direction_options"
    ADD CONSTRAINT "direction_options_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."direction_votes"
    ADD CONSTRAINT "direction_votes_direction_option_id_fkey" FOREIGN KEY ("direction_option_id") REFERENCES "public"."direction_options"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."direction_votes"
    ADD CONSTRAINT "direction_votes_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."direction_votes"
    ADD CONSTRAINT "direction_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clip_views"
    ADD CONSTRAINT "fk_clip_views_clip" FOREIGN KEY ("clip_id") REFERENCES "public"."tournament_clips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."story_slots"
    ADD CONSTRAINT "fk_story_slots_season" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tournament_clips"
    ADD CONSTRAINT "fk_tournament_clips_season" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tournament_clips"
    ADD CONSTRAINT "fk_tournament_clips_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."votes"
    ADD CONSTRAINT "fk_votes_clip" FOREIGN KEY ("clip_id") REFERENCES "public"."tournament_clips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."followers"
    ADD CONSTRAINT "followers_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."followers"
    ADD CONSTRAINT "followers_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."movie_access"
    ADD CONSTRAINT "movie_access_granted_by_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."movie_access"
    ADD CONSTRAINT "movie_access_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."movie_projects"
    ADD CONSTRAINT "movie_projects_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."movie_scenes"
    ADD CONSTRAINT "movie_scenes_generation_fk" FOREIGN KEY ("ai_generation_id") REFERENCES "public"."ai_generations"("id");



ALTER TABLE ONLY "public"."movie_scenes"
    ADD CONSTRAINT "movie_scenes_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."movie_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pinned_characters"
    ADD CONSTRAINT "pinned_characters_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pinned_characters"
    ADD CONSTRAINT "pinned_characters_source_clip_id_fkey" FOREIGN KEY ("source_clip_id") REFERENCES "public"."tournament_clips"("id");



ALTER TABLE ONLY "public"."pricing_alerts"
    ADD CONSTRAINT "pricing_alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."prompt_history"
    ADD CONSTRAINT "prompt_history_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "public"."slot_briefs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prompt_history"
    ADD CONSTRAINT "prompt_history_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "public"."tournament_clips"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prompt_history"
    ADD CONSTRAINT "prompt_history_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prompt_history"
    ADD CONSTRAINT "prompt_history_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "public"."story_slots"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prompt_history"
    ADD CONSTRAINT "prompt_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."prompt_visual_correlation"
    ADD CONSTRAINT "prompt_visual_correlation_clip_visual_id_fkey" FOREIGN KEY ("clip_visual_id") REFERENCES "public"."clip_visuals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prompt_visual_correlation"
    ADD CONSTRAINT "prompt_visual_correlation_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompt_history"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."prompt_visual_correlation"
    ADD CONSTRAINT "prompt_visual_correlation_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referred_id_fkey" FOREIGN KEY ("referred_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."referrals"
    ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."scene_vocabulary"
    ADD CONSTRAINT "scene_vocabulary_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slot_briefs"
    ADD CONSTRAINT "slot_briefs_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."slot_briefs"
    ADD CONSTRAINT "slot_briefs_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slot_briefs"
    ADD CONSTRAINT "slot_briefs_winning_direction_id_fkey" FOREIGN KEY ("winning_direction_id") REFERENCES "public"."direction_options"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."story_analyses"
    ADD CONSTRAINT "story_analyses_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."story_analyses"
    ADD CONSTRAINT "story_analyses_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."story_slots"
    ADD CONSTRAINT "story_slots_brief_id_fkey" FOREIGN KEY ("brief_id") REFERENCES "public"."slot_briefs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."story_slots"
    ADD CONSTRAINT "story_slots_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id");



ALTER TABLE ONLY "public"."story_slots"
    ADD CONSTRAINT "story_slots_winning_direction_id_fkey" FOREIGN KEY ("winning_direction_id") REFERENCES "public"."direction_options"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."team_invites"
    ADD CONSTRAINT "team_invites_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_members"
    ADD CONSTRAINT "team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_messages"
    ADD CONSTRAINT "team_messages_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_messages"
    ADD CONSTRAINT "team_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."team_vote_coordination"
    ADD CONSTRAINT "team_vote_coordination_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teams"
    ADD CONSTRAINT "teams_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."tournament_clips"
    ADD CONSTRAINT "tournament_clips_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id");



ALTER TABLE ONLY "public"."user_blocks"
    ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_blocks"
    ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."visual_vocabulary"
    ADD CONSTRAINT "visual_vocabulary_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can read audit logs" ON "public"."audit_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can update contact submissions" ON "public"."contact_submissions" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can update reports" ON "public"."content_reports" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can view contact submissions" ON "public"."contact_submissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Anyone can read feature flags" ON "public"."feature_flags" FOR SELECT USING (true);



CREATE POLICY "Anyone can submit contact form" ON "public"."contact_submissions" FOR INSERT WITH CHECK (true);



CREATE POLICY "Team invites viewable by team members" ON "public"."team_invites" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."team_members"
  WHERE (("team_members"."team_id" = "team_invites"."team_id") AND ("team_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Team leader can update" ON "public"."teams" FOR UPDATE USING (("auth"."uid"() = "leader_id"));



CREATE POLICY "Team members are viewable by everyone" ON "public"."team_members" FOR SELECT USING (true);



CREATE POLICY "Team members can send messages" ON "public"."team_messages" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."team_members"
  WHERE (("team_members"."team_id" = "team_messages"."team_id") AND ("team_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Team messages viewable by team members" ON "public"."team_messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."team_members"
  WHERE (("team_members"."team_id" = "team_messages"."team_id") AND ("team_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Teams are viewable by everyone" ON "public"."teams" FOR SELECT USING (true);



CREATE POLICY "Users can create reports" ON "public"."content_reports" FOR INSERT WITH CHECK (("auth"."uid"() = "reporter_id"));



CREATE POLICY "Users can create their own blocks" ON "public"."user_blocks" FOR INSERT WITH CHECK (("auth"."uid"() = "blocker_id"));



CREATE POLICY "Users can delete own movie projects" ON "public"."movie_projects" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete their own blocks" ON "public"."user_blocks" FOR DELETE USING (("auth"."uid"() = "blocker_id"));



CREATE POLICY "Users can insert own movie projects" ON "public"."movie_projects" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can read own referrals" ON "public"."referrals" FOR SELECT USING (true);



CREATE POLICY "Users can update own movie projects" ON "public"."movie_projects" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own movie scenes" ON "public"."movie_scenes" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."movie_projects"
  WHERE (("movie_projects"."id" = "movie_scenes"."project_id") AND ("movie_projects"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view own movie access" ON "public"."movie_access" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own movie projects" ON "public"."movie_projects" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own movie scenes" ON "public"."movie_scenes" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."movie_projects"
  WHERE (("movie_projects"."id" = "movie_scenes"."project_id") AND ("movie_projects"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own blocks" ON "public"."user_blocks" FOR SELECT USING (("auth"."uid"() = "blocker_id"));



CREATE POLICY "Users can view their own reports" ON "public"."content_reports" FOR SELECT USING ((("auth"."uid"() = "reporter_id") OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))));



CREATE POLICY "Vote coordination viewable by team members" ON "public"."team_vote_coordination" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."team_members"
  WHERE (("team_members"."team_id" = "team_vote_coordination"."team_id") AND ("team_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "ai_gen_select" ON "public"."ai_generations" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."ai_generation_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_generations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_limits_select" ON "public"."ai_generation_limits" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."character_reference_suggestions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clip_views" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clip_views_delete_service" ON "public"."clip_views" FOR DELETE USING (false);



CREATE POLICY "clip_views_insert_all" ON "public"."clip_views" FOR INSERT WITH CHECK (true);



CREATE POLICY "clip_views_select_all" ON "public"."clip_views" FOR SELECT USING (true);



CREATE POLICY "clip_views_update_none" ON "public"."clip_views" FOR UPDATE USING (false);



ALTER TABLE "public"."clip_visuals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clip_visuals_modify_service" ON "public"."clip_visuals" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "clip_visuals_select_all" ON "public"."clip_visuals" FOR SELECT USING (true);



CREATE POLICY "clips_delete_service" ON "public"."tournament_clips" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "clips_insert_authenticated" ON "public"."tournament_clips" FOR INSERT WITH CHECK (true);



CREATE POLICY "clips_select_approved" ON "public"."tournament_clips" FOR SELECT USING ((("status" = ANY (ARRAY['approved'::"text", 'active'::"text", 'winner'::"text", 'locked'::"text", 'competing'::"text", 'locked_in'::"text"])) OR ("status" IS NULL)));



CREATE POLICY "clips_update_own" ON "public"."tournament_clips" FOR UPDATE USING ((("user_id" = "auth"."uid"()) OR ("auth"."role"() = 'service_role'::"text")));



ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comments_delete_own" ON "public"."comments" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "comments_insert_authenticated" ON "public"."comments" FOR INSERT WITH CHECK (true);



CREATE POLICY "comments_select_active" ON "public"."comments" FOR SELECT USING ((("is_deleted" = false) OR ("is_deleted" IS NULL)));



CREATE POLICY "comments_update_own" ON "public"."comments" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."contact_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "credit_packages_public_read" ON "public"."credit_packages" FOR SELECT USING (("is_active" = true));



CREATE POLICY "credit_trans_own_read" ON "public"."credit_transactions" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."credit_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."direction_options" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "direction_options_modify_service" ON "public"."direction_options" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "direction_options_select_all" ON "public"."direction_options" FOR SELECT USING (true);



ALTER TABLE "public"."direction_votes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "direction_votes_delete_service" ON "public"."direction_votes" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "direction_votes_insert_service" ON "public"."direction_votes" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "direction_votes_select_all" ON "public"."direction_votes" FOR SELECT USING (true);



ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "model_patterns_modify_service" ON "public"."model_prompt_patterns" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "model_patterns_select_all" ON "public"."model_prompt_patterns" FOR SELECT USING (true);



ALTER TABLE "public"."model_pricing" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "model_pricing_public_read" ON "public"."model_pricing" FOR SELECT USING (("is_active" = true));



ALTER TABLE "public"."model_prompt_patterns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."movie_access" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."movie_projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."movie_scenes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pinned_characters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pinned_chars_select" ON "public"."pinned_characters" FOR SELECT USING (true);



ALTER TABLE "public"."prompt_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prompt_history_modify_service" ON "public"."prompt_history" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "prompt_history_select_all" ON "public"."prompt_history" FOR SELECT USING (true);



ALTER TABLE "public"."prompt_visual_correlation" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prompt_visual_modify_service" ON "public"."prompt_visual_correlation" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "prompt_visual_select_all" ON "public"."prompt_visual_correlation" FOR SELECT USING (true);



ALTER TABLE "public"."referrals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scene_vocab_modify_service" ON "public"."scene_vocabulary" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "scene_vocab_select_all" ON "public"."scene_vocabulary" FOR SELECT USING (true);



ALTER TABLE "public"."scene_vocabulary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."seasons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasons_delete_service" ON "public"."seasons" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "seasons_insert_service" ON "public"."seasons" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "seasons_select_all" ON "public"."seasons" FOR SELECT USING (true);



CREATE POLICY "seasons_update_service" ON "public"."seasons" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."slot_briefs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "slot_briefs_modify_service" ON "public"."slot_briefs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "slot_briefs_select_all" ON "public"."slot_briefs" FOR SELECT USING (true);



ALTER TABLE "public"."story_analyses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "story_analyses_modify_service" ON "public"."story_analyses" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "story_analyses_select_all" ON "public"."story_analyses" FOR SELECT USING (true);



ALTER TABLE "public"."story_slots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "story_slots_delete_service" ON "public"."story_slots" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "story_slots_insert_service" ON "public"."story_slots" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "story_slots_select_all" ON "public"."story_slots" FOR SELECT USING (true);



CREATE POLICY "story_slots_update_service" ON "public"."story_slots" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."team_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."team_vote_coordination" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."teams" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tournament_clips" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_delete_service" ON "public"."users" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "users_insert_authenticated" ON "public"."users" FOR INSERT WITH CHECK (true);



CREATE POLICY "users_select_public" ON "public"."users" FOR SELECT USING (true);



CREATE POLICY "users_update_own" ON "public"."users" FOR UPDATE USING ((("id" = "auth"."uid"()) OR ("auth"."role"() = 'service_role'::"text")));



CREATE POLICY "visual_vocab_modify_service" ON "public"."visual_vocabulary" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "visual_vocab_select_all" ON "public"."visual_vocabulary" FOR SELECT USING (true);



ALTER TABLE "public"."visual_vocabulary" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."votes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "votes_delete_service" ON "public"."votes" FOR DELETE USING (false);



CREATE POLICY "votes_insert_authenticated" ON "public"."votes" FOR INSERT WITH CHECK (true);



CREATE POLICY "votes_select_all" ON "public"."votes" FOR SELECT USING (true);



CREATE POLICY "votes_update_service" ON "public"."votes" FOR UPDATE USING (false);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_credits"("p_user_id" "uuid", "p_amount" integer, "p_stripe_payment_intent_id" character varying, "p_package_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_credits"("p_user_id" "uuid", "p_amount" integer, "p_stripe_payment_intent_id" character varying, "p_package_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_team_xp"("p_user_id" "uuid", "p_xp_amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."add_team_xp"("p_user_id" "uuid", "p_xp_amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_team_xp"("p_user_id" "uuid", "p_xp_amount" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_user_xp"("user_id" "uuid", "xp_to_add" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_user_xp"("user_id" "uuid", "xp_to_add" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_approve_clip_atomic"("p_clip_id" "uuid", "p_admin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_grant_credits"("p_user_id" "uuid", "p_amount" integer, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_grant_credits"("p_user_id" "uuid", "p_amount" integer, "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."append_reference_angle"("p_id" "uuid", "p_url" "text", "p_max_refs" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."append_reference_angle"("p_id" "uuid", "p_url" "text", "p_max_refs" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."append_reference_angle"("p_id" "uuid", "p_url" "text", "p_max_refs" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_daily_decay"("p_decay_rate" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."apply_daily_decay"("p_decay_rate" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_daily_decay"("p_decay_rate" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_comment"("p_comment_id" "uuid", "p_admin_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."approve_comment"("p_comment_id" "uuid", "p_admin_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."assign_winner_atomic"("p_clip_id" "uuid", "p_slot_id" "uuid", "p_season_id" "uuid", "p_next_slot_position" integer, "p_voting_duration_hours" integer, "p_advance_slot" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assign_winner_atomic"("p_clip_id" "uuid", "p_slot_id" "uuid", "p_season_id" "uuid", "p_next_slot_position" integer, "p_voting_duration_hours" integer, "p_advance_slot" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."batch_update_vote_counts"("p_updates" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."batch_update_vote_counts"("p_updates" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."batch_update_vote_counts"("p_updates" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."bulk_sync_prompt_learning"() TO "anon";
GRANT ALL ON FUNCTION "public"."bulk_sync_prompt_learning"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bulk_sync_prompt_learning"() TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_bayesian_score"("p_total_votes" integer, "p_frequency" integer, "p_winner_count" integer, "p_decay_factor" double precision, "p_prior_mean" double precision, "p_prior_weight" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_bayesian_score"("p_total_votes" integer, "p_frequency" integer, "p_winner_count" integer, "p_decay_factor" double precision, "p_prior_mean" double precision, "p_prior_weight" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_bayesian_score"("p_total_votes" integer, "p_frequency" integer, "p_winner_count" integer, "p_decay_factor" double precision, "p_prior_mean" double precision, "p_prior_weight" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_level"("xp_amount" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_level"("xp_amount" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_level"("xp_amount" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."calculate_min_credit_cost"("p_fal_cost_cents" integer, "p_target_margin_percent" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_min_credit_cost"("p_fal_cost_cents" integer, "p_target_margin_percent" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_min_credit_cost"("p_fal_cost_cents" integer, "p_target_margin_percent" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_reserve_generation"("p_user_id" "uuid", "p_date" "date", "p_max_daily" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_reserve_generation"("p_user_id" "uuid", "p_date" "date", "p_max_daily" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_reserve_generation"("p_user_id" "uuid", "p_date" "date", "p_max_daily" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_and_reserve_generation_v2"("p_user_id" "uuid", "p_date" "date", "p_global_max_daily" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_and_reserve_generation_v2"("p_user_id" "uuid", "p_date" "date", "p_global_max_daily" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_and_reserve_generation_v2"("p_user_id" "uuid", "p_date" "date", "p_global_max_daily" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_comment_nesting_depth"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_comment_nesting_depth"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_comment_nesting_depth"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_commenter_not_banned"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_commenter_not_banned"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_commenter_not_banned"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_generation_cooldown"("p_user_id" "uuid", "p_cooldown_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_generation_cooldown"("p_user_id" "uuid", "p_cooldown_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_generation_cooldown"("p_user_id" "uuid", "p_cooldown_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_global_cost_cap"("p_daily_limit_cents" integer, "p_monthly_limit_cents" integer, "p_new_cost_cents" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_global_cost_cap"("p_daily_limit_cents" integer, "p_monthly_limit_cents" integer, "p_new_cost_cents" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_global_cost_cap"("p_daily_limit_cents" integer, "p_monthly_limit_cents" integer, "p_new_cost_cents" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_voter_not_banned"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_voter_not_banned"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_voter_not_banned"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_clip_views"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_clip_views"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_clip_views"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_notifications"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_notifications"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_notifications"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_team"("p_name" "text", "p_description" "text", "p_leader_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."create_team"("p_name" "text", "p_description" "text", "p_leader_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_team"("p_name" "text", "p_description" "text", "p_leader_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."deduct_credits"("p_user_id" "uuid", "p_amount" integer, "p_generation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deduct_credits"("p_user_id" "uuid", "p_amount" integer, "p_generation_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_vote_atomic"("p_voter_key" "text", "p_clip_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_vote_atomic"("p_voter_key" "text", "p_clip_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_vote_atomic"("p_voter_key" "text", "p_clip_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."flag_comment"("p_comment_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."flag_comment"("p_comment_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_invite_code"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_invite_code"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_invite_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_clips_for_voting"("p_slot_position" integer, "p_season_id" "uuid", "p_voter_key" "text", "p_limit" integer, "p_pool_size" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_clips_for_voting"("p_slot_position" integer, "p_season_id" "uuid", "p_voter_key" "text", "p_limit" integer, "p_pool_size" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_clips_for_voting"("p_slot_position" integer, "p_season_id" "uuid", "p_voter_key" "text", "p_limit" integer, "p_pool_size" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_comment_counts"("clip_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_comment_counts"("clip_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_comment_counts"("clip_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_feature_config"("feature_key" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."get_feature_config"("feature_key" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_feature_config"("feature_key" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_genre_vote_stats"("p_voter_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_genre_vote_stats"("p_voter_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_genre_vote_stats"("p_voter_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_model_credit_cost"("p_model_key" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."get_model_credit_cost"("p_model_key" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_model_credit_cost"("p_model_key" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_team_leaderboard"("p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_team_leaderboard"("p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_team_leaderboard"("p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_team_with_stats"("p_team_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_team_with_stats"("p_team_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_team_with_stats"("p_team_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_top_creators"("p_limit" integer, "p_offset" integer, "p_timeframe" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_top_creators"("p_limit" integer, "p_offset" integer, "p_timeframe" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_creators"("p_limit" integer, "p_offset" integer, "p_timeframe" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_top_voters"("p_limit" integer, "p_offset" integer, "p_timeframe" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_top_voters"("p_limit" integer, "p_offset" integer, "p_timeframe" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_top_voters"("p_limit" integer, "p_offset" integer, "p_timeframe" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_generation_limit"("p_user_id" "uuid", "p_global_max_daily" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_generation_limit"("p_user_id" "uuid", "p_global_max_daily" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_generation_limit"("p_user_id" "uuid", "p_global_max_daily" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_global_rank"("p_voter_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_global_rank"("p_voter_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_global_rank"("p_voter_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_rank_fast"("p_voter_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_rank_fast"("p_voter_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_rank_fast"("p_voter_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_team"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_team"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_team"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_voter_rank"("p_voter_key" "text", "p_timeframe" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_voter_rank"("p_voter_key" "text", "p_timeframe" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_voter_rank"("p_voter_key" "text", "p_timeframe" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_voters_count"("p_timeframe" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_voters_count"("p_timeframe" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_voters_count"("p_timeframe" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_clip_view_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."increment_clip_view_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_clip_view_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_pinned_usage"("p_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_pinned_usage"("p_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_pinned_usage"("p_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_vote_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text", "p_vote_weight" integer, "p_vote_type" "text", "p_slot_position" integer, "p_flagged" boolean, "p_multi_vote_mode" boolean, "p_is_power_vote" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."insert_vote_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text", "p_vote_weight" integer, "p_vote_type" "text", "p_slot_position" integer, "p_flagged" boolean, "p_multi_vote_mode" boolean, "p_is_power_vote" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_vote_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text", "p_vote_weight" integer, "p_vote_type" "text", "p_slot_position" integer, "p_flagged" boolean, "p_multi_vote_mode" boolean, "p_is_power_vote" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_feature_enabled"("feature_key" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."is_feature_enabled"("feature_key" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_feature_enabled"("feature_key" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_user_blocked"("checker_id" "uuid", "target_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_user_blocked"("checker_id" "uuid", "target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_user_blocked"("checker_id" "uuid", "target_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."join_team_via_code"("p_user_id" "uuid", "p_invite_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."join_team_via_code"("p_user_id" "uuid", "p_invite_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_team_via_code"("p_user_id" "uuid", "p_invite_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."leave_team"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."leave_team"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."leave_team"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_unauthorized_admin_promotion"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_unauthorized_admin_promotion"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_unauthorized_admin_promotion"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_all_pricing"() TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_all_pricing"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_all_pricing"() TO "service_role";



GRANT ALL ON FUNCTION "public"."recalculate_vocabulary_scores"() TO "anon";
GRANT ALL ON FUNCTION "public"."recalculate_vocabulary_scores"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."recalculate_vocabulary_scores"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_clip_distribution_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_clip_distribution_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_clip_distribution_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_user_vote_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_user_vote_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_user_vote_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."refund_credits"("p_user_id" "uuid", "p_generation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refund_credits"("p_user_id" "uuid", "p_generation_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_comment"("p_comment_id" "uuid", "p_admin_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reject_comment"("p_comment_id" "uuid", "p_admin_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reorganize_slots_delete_and_shift"("p_season_id" "uuid", "p_positions_to_delete" integer[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorganize_slots_delete_and_shift"("p_season_id" "uuid", "p_positions_to_delete" integer[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reorganize_slots_swap"("p_season_id" "uuid", "p_position_a" integer, "p_position_b" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorganize_slots_swap"("p_season_id" "uuid", "p_position_a" integer, "p_position_b" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_vote_date"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_vote_date"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_vote_date"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_prompt_learning_from_clip"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_prompt_learning_from_clip"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_prompt_learning_from_clip"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_visual_learning_from_clip"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_visual_learning_from_clip"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_visual_learning_from_clip"() TO "service_role";



GRANT ALL ON FUNCTION "public"."track_team_vote"("p_user_id" "uuid", "p_clip_id" "text", "p_slot_position" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."track_team_vote"("p_user_id" "uuid", "p_clip_id" "text", "p_slot_position" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."track_team_vote"("p_user_id" "uuid", "p_clip_id" "text", "p_slot_position" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_ai_gen_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_ai_gen_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_ai_gen_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_all_team_streaks"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_all_team_streaks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_all_team_streaks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_clip_vote_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_clip_vote_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_clip_vote_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_clip_vote_count_on_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_clip_vote_count_on_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_clip_vote_count_on_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_comment_likes_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_comment_likes_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_comment_likes_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_comments_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_comments_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_comments_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_direction_vote_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_direction_vote_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_direction_vote_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_feature_flags_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_feature_flags_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_feature_flags_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_followers_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_followers_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_followers_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_movie_projects_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_movie_projects_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_movie_projects_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_pinned_chars_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_pinned_chars_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_pinned_chars_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_prompt_history_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_prompt_history_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_prompt_history_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_team_member_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_team_member_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_team_member_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_stats_on_vote"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_stats_on_vote"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_stats_on_vote"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_stats_on_vote_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_stats_on_vote_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_stats_on_vote_delete"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_user_vote_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_user_vote_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_user_vote_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_users_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_users_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_users_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_model_pattern"("p_ai_model" character varying, "p_pattern_type" character varying, "p_pattern_text" character varying, "p_vote_count" integer, "p_is_winner" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_model_pattern"("p_ai_model" character varying, "p_pattern_type" character varying, "p_pattern_text" character varying, "p_vote_count" integer, "p_is_winner" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_model_pattern"("p_ai_model" character varying, "p_pattern_type" character varying, "p_pattern_text" character varying, "p_vote_count" integer, "p_is_winner" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_scene_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean, "p_example_prompt" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_scene_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean, "p_example_prompt" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_scene_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean, "p_example_prompt" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_visual_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_visual_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_visual_vocabulary"("p_season_id" "uuid", "p_term" character varying, "p_category" character varying, "p_vote_count" integer, "p_is_winner" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_vote_weight"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_vote_weight"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_vote_weight"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vote_insert_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text", "p_vote_weight" integer, "p_vote_type" "text", "p_slot_position" integer, "p_flagged" boolean, "p_multi_vote_mode" boolean, "p_is_power_vote" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vote_insert_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text", "p_vote_weight" integer, "p_vote_type" "text", "p_slot_position" integer, "p_flagged" boolean, "p_multi_vote_mode" boolean, "p_is_power_vote" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vote_insert_atomic"("p_clip_id" "text", "p_voter_key" "text", "p_user_id" "text", "p_vote_weight" integer, "p_vote_type" "text", "p_slot_position" integer, "p_flagged" boolean, "p_multi_vote_mode" boolean, "p_is_power_vote" boolean) TO "service_role";



GRANT ALL ON TABLE "public"."ai_generation_limits" TO "anon";
GRANT ALL ON TABLE "public"."ai_generation_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_generation_limits" TO "service_role";



GRANT ALL ON TABLE "public"."ai_generations" TO "anon";
GRANT ALL ON TABLE "public"."ai_generations" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_generations" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."character_reference_suggestions" TO "service_role";



GRANT ALL ON TABLE "public"."clip_views" TO "anon";
GRANT ALL ON TABLE "public"."clip_views" TO "authenticated";
GRANT ALL ON TABLE "public"."clip_views" TO "service_role";



GRANT ALL ON TABLE "public"."clip_visuals" TO "anon";
GRANT ALL ON TABLE "public"."clip_visuals" TO "authenticated";
GRANT ALL ON TABLE "public"."clip_visuals" TO "service_role";



GRANT ALL ON TABLE "public"."comment_likes" TO "anon";
GRANT ALL ON TABLE "public"."comment_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."comment_likes" TO "service_role";



GRANT ALL ON TABLE "public"."comments" TO "anon";
GRANT ALL ON TABLE "public"."comments" TO "authenticated";
GRANT ALL ON TABLE "public"."comments" TO "service_role";



GRANT ALL ON TABLE "public"."tournament_clips" TO "anon";
GRANT ALL ON TABLE "public"."tournament_clips" TO "authenticated";
GRANT ALL ON TABLE "public"."tournament_clips" TO "service_role";



GRANT ALL ON TABLE "public"."comment_moderation_queue" TO "anon";
GRANT ALL ON TABLE "public"."comment_moderation_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."comment_moderation_queue" TO "service_role";



GRANT ALL ON TABLE "public"."contact_submissions" TO "anon";
GRANT ALL ON TABLE "public"."contact_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."content_reports" TO "anon";
GRANT ALL ON TABLE "public"."content_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."content_reports" TO "service_role";



GRANT ALL ON TABLE "public"."credit_packages" TO "anon";
GRANT ALL ON TABLE "public"."credit_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_packages" TO "service_role";



GRANT ALL ON TABLE "public"."credit_transactions" TO "anon";
GRANT ALL ON TABLE "public"."credit_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."cron_locks" TO "anon";
GRANT ALL ON TABLE "public"."cron_locks" TO "authenticated";
GRANT ALL ON TABLE "public"."cron_locks" TO "service_role";



GRANT ALL ON TABLE "public"."direction_options" TO "anon";
GRANT ALL ON TABLE "public"."direction_options" TO "authenticated";
GRANT ALL ON TABLE "public"."direction_options" TO "service_role";



GRANT ALL ON TABLE "public"."direction_votes" TO "anon";
GRANT ALL ON TABLE "public"."direction_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."direction_votes" TO "service_role";



GRANT ALL ON TABLE "public"."feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";



GRANT ALL ON TABLE "public"."votes" TO "anon";
GRANT ALL ON TABLE "public"."votes" TO "authenticated";
GRANT ALL ON TABLE "public"."votes" TO "service_role";



GRANT ALL ON TABLE "public"."flagged_votes_summary" TO "anon";
GRANT ALL ON TABLE "public"."flagged_votes_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."flagged_votes_summary" TO "service_role";



GRANT ALL ON TABLE "public"."followers" TO "anon";
GRANT ALL ON TABLE "public"."followers" TO "authenticated";
GRANT ALL ON TABLE "public"."followers" TO "service_role";



GRANT ALL ON TABLE "public"."genre_votes" TO "anon";
GRANT ALL ON TABLE "public"."genre_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."genre_votes" TO "service_role";



GRANT ALL ON TABLE "public"."model_prompt_patterns" TO "anon";
GRANT ALL ON TABLE "public"."model_prompt_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."model_prompt_patterns" TO "service_role";



GRANT ALL ON TABLE "public"."model_patterns_scored" TO "anon";
GRANT ALL ON TABLE "public"."model_patterns_scored" TO "authenticated";
GRANT ALL ON TABLE "public"."model_patterns_scored" TO "service_role";



GRANT ALL ON TABLE "public"."model_pricing" TO "anon";
GRANT ALL ON TABLE "public"."model_pricing" TO "authenticated";
GRANT ALL ON TABLE "public"."model_pricing" TO "service_role";



GRANT ALL ON TABLE "public"."movie_access" TO "anon";
GRANT ALL ON TABLE "public"."movie_access" TO "authenticated";
GRANT ALL ON TABLE "public"."movie_access" TO "service_role";



GRANT ALL ON TABLE "public"."movie_projects" TO "anon";
GRANT ALL ON TABLE "public"."movie_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."movie_projects" TO "service_role";



GRANT ALL ON TABLE "public"."movie_scenes" TO "anon";
GRANT ALL ON TABLE "public"."movie_scenes" TO "authenticated";
GRANT ALL ON TABLE "public"."movie_scenes" TO "service_role";



GRANT ALL ON TABLE "public"."mv_clip_distribution_stats" TO "anon";
GRANT ALL ON TABLE "public"."mv_clip_distribution_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_clip_distribution_stats" TO "service_role";



GRANT ALL ON TABLE "public"."mv_user_vote_counts" TO "anon";
GRANT ALL ON TABLE "public"."mv_user_vote_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_user_vote_counts" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."pinned_characters" TO "anon";
GRANT ALL ON TABLE "public"."pinned_characters" TO "authenticated";
GRANT ALL ON TABLE "public"."pinned_characters" TO "service_role";



GRANT ALL ON TABLE "public"."pricing_alerts" TO "anon";
GRANT ALL ON TABLE "public"."pricing_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."pricing_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."prompt_history" TO "anon";
GRANT ALL ON TABLE "public"."prompt_history" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_history" TO "service_role";



GRANT ALL ON TABLE "public"."prompt_visual_correlation" TO "anon";
GRANT ALL ON TABLE "public"."prompt_visual_correlation" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_visual_correlation" TO "service_role";



GRANT ALL ON TABLE "public"."referrals" TO "anon";
GRANT ALL ON TABLE "public"."referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."referrals" TO "service_role";



GRANT ALL ON TABLE "public"."scene_vocabulary" TO "anon";
GRANT ALL ON TABLE "public"."scene_vocabulary" TO "authenticated";
GRANT ALL ON TABLE "public"."scene_vocabulary" TO "service_role";



GRANT ALL ON TABLE "public"."scene_vocabulary_scored" TO "anon";
GRANT ALL ON TABLE "public"."scene_vocabulary_scored" TO "authenticated";
GRANT ALL ON TABLE "public"."scene_vocabulary_scored" TO "service_role";



GRANT ALL ON TABLE "public"."seasons" TO "anon";
GRANT ALL ON TABLE "public"."seasons" TO "authenticated";
GRANT ALL ON TABLE "public"."seasons" TO "service_role";



GRANT ALL ON TABLE "public"."slot_briefs" TO "anon";
GRANT ALL ON TABLE "public"."slot_briefs" TO "authenticated";
GRANT ALL ON TABLE "public"."slot_briefs" TO "service_role";



GRANT ALL ON TABLE "public"."story_analyses" TO "anon";
GRANT ALL ON TABLE "public"."story_analyses" TO "authenticated";
GRANT ALL ON TABLE "public"."story_analyses" TO "service_role";



GRANT ALL ON TABLE "public"."story_slots" TO "anon";
GRANT ALL ON TABLE "public"."story_slots" TO "authenticated";
GRANT ALL ON TABLE "public"."story_slots" TO "service_role";



GRANT ALL ON TABLE "public"."system_cache" TO "anon";
GRANT ALL ON TABLE "public"."system_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."system_cache" TO "service_role";



GRANT ALL ON TABLE "public"."team_invites" TO "anon";
GRANT ALL ON TABLE "public"."team_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."team_invites" TO "service_role";



GRANT ALL ON TABLE "public"."team_members" TO "anon";
GRANT ALL ON TABLE "public"."team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."team_members" TO "service_role";



GRANT ALL ON TABLE "public"."team_messages" TO "anon";
GRANT ALL ON TABLE "public"."team_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."team_messages" TO "service_role";



GRANT ALL ON TABLE "public"."team_vote_coordination" TO "anon";
GRANT ALL ON TABLE "public"."team_vote_coordination" TO "authenticated";
GRANT ALL ON TABLE "public"."team_vote_coordination" TO "service_role";



GRANT ALL ON TABLE "public"."teams" TO "anon";
GRANT ALL ON TABLE "public"."teams" TO "authenticated";
GRANT ALL ON TABLE "public"."teams" TO "service_role";



GRANT ALL ON TABLE "public"."user_blocks" TO "anon";
GRANT ALL ON TABLE "public"."user_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."user_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."visual_vocabulary" TO "anon";
GRANT ALL ON TABLE "public"."visual_vocabulary" TO "authenticated";
GRANT ALL ON TABLE "public"."visual_vocabulary" TO "service_role";



GRANT ALL ON TABLE "public"."visual_vocabulary_scored" TO "anon";
GRANT ALL ON TABLE "public"."visual_vocabulary_scored" TO "authenticated";
GRANT ALL ON TABLE "public"."visual_vocabulary_scored" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







