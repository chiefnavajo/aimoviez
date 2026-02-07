-- ============================================================================
-- BAYESIAN SCORING AND TEMPORAL DECAY (3 of 3)
-- Improves learning quality with statistical soundness and recency weighting
-- ============================================================================
-- Created: 2026-02-07 19:45:00 UTC
-- Version: 1.0.0
-- Run this in Supabase SQL Editor AFTER fix-learning-feedback-loop.sql
-- Order: Run this THIRD
-- ============================================================================

-- ============================================================================
-- 1. ADD DECAY FACTOR COLUMN TO VOCABULARY TABLES
-- ============================================================================

-- Scene vocabulary decay
ALTER TABLE scene_vocabulary
ADD COLUMN IF NOT EXISTS decay_factor FLOAT DEFAULT 1.0;

-- Visual vocabulary decay
ALTER TABLE visual_vocabulary
ADD COLUMN IF NOT EXISTS decay_factor FLOAT DEFAULT 1.0;

-- Model patterns decay
ALTER TABLE model_prompt_patterns
ADD COLUMN IF NOT EXISTS decay_factor FLOAT DEFAULT 1.0;

-- ============================================================================
-- 2. CREATE BAYESIAN SCORING FUNCTION
-- Uses Bayesian average with configurable prior to handle low sample sizes
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_bayesian_score(
  p_total_votes INTEGER,
  p_frequency INTEGER,
  p_winner_count INTEGER,
  p_decay_factor FLOAT DEFAULT 1.0,
  p_prior_mean FLOAT DEFAULT 5.0,      -- Expected average votes
  p_prior_weight INTEGER DEFAULT 10    -- How much to trust the prior
) RETURNS FLOAT AS $$
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
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 3. CREATE VIEW FOR BAYESIAN-SCORED VOCABULARY
-- ============================================================================

CREATE OR REPLACE VIEW scene_vocabulary_scored AS
SELECT
  sv.*,
  calculate_bayesian_score(
    sv.total_votes,
    sv.frequency,
    sv.winner_count,
    sv.decay_factor
  ) AS bayesian_score
FROM scene_vocabulary sv
WHERE sv.frequency >= 1;

CREATE OR REPLACE VIEW visual_vocabulary_scored AS
SELECT
  vv.*,
  calculate_bayesian_score(
    vv.total_votes,
    vv.frequency,
    vv.winner_count,
    vv.decay_factor
  ) AS bayesian_score
FROM visual_vocabulary vv
WHERE vv.frequency >= 1;

CREATE OR REPLACE VIEW model_patterns_scored AS
SELECT
  mpp.*,
  calculate_bayesian_score(
    mpp.total_votes,
    mpp.usage_count,
    mpp.winner_count,
    mpp.decay_factor
  ) AS bayesian_score
FROM model_prompt_patterns mpp
WHERE mpp.usage_count >= 1;

-- ============================================================================
-- 4. CREATE DAILY DECAY FUNCTION
-- Run via cron job to decay old patterns
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_daily_decay(
  p_decay_rate FLOAT DEFAULT 0.995  -- ~50% value after 138 days
) RETURNS TABLE(
  scene_vocab_decayed INTEGER,
  visual_vocab_decayed INTEGER,
  patterns_decayed INTEGER,
  terms_pruned INTEGER
) AS $$
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. UPDATE UPSERT FUNCTIONS TO RESET DECAY ON ACTIVITY
-- When a term is used again, boost its decay factor
-- ============================================================================

CREATE OR REPLACE FUNCTION upsert_scene_vocabulary(
  p_season_id UUID,
  p_term VARCHAR(100),
  p_category VARCHAR(50),
  p_vote_count INTEGER,
  p_is_winner BOOLEAN,
  p_example_prompt TEXT
) RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION upsert_model_pattern(
  p_ai_model VARCHAR(50),
  p_pattern_type VARCHAR(50),
  p_pattern_text VARCHAR(200),
  p_vote_count INTEGER,
  p_is_winner BOOLEAN
) RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION upsert_visual_vocabulary(
  p_season_id UUID,
  p_term VARCHAR(100),
  p_category VARCHAR(50),
  p_vote_count INTEGER,
  p_is_winner BOOLEAN
) RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. INDEXES FOR BAYESIAN QUERIES
-- ============================================================================

-- Index for decay_factor queries (pruning)
CREATE INDEX IF NOT EXISTS idx_scene_vocab_decay
  ON scene_vocabulary(decay_factor)
  WHERE decay_factor < 0.5;

CREATE INDEX IF NOT EXISTS idx_visual_vocab_decay
  ON visual_vocabulary(decay_factor)
  WHERE decay_factor < 0.5;

CREATE INDEX IF NOT EXISTS idx_model_patterns_decay
  ON model_prompt_patterns(decay_factor)
  WHERE decay_factor < 0.5;

-- ============================================================================
-- 7. CRON JOB SETUP (run via pg_cron or external scheduler)
-- ============================================================================

-- To set up daily decay via pg_cron:
-- SELECT cron.schedule('daily-learning-decay', '0 4 * * *', 'SELECT * FROM apply_daily_decay()');

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
