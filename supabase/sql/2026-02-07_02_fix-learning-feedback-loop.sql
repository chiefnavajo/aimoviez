-- ============================================================================
-- FIX LEARNING FEEDBACK LOOP (2 of 3)
-- Syncs vote_count and is_winner from tournament_clips to prompt_history
-- ============================================================================
-- Created: 2026-02-07 19:45:00 UTC
-- Version: 1.0.0
-- Run this in Supabase SQL Editor AFTER migration-prompt-learning.sql
-- Order: Run this SECOND
-- ============================================================================

-- ============================================================================
-- 1. SYNC FUNCTION: Update prompt_history when tournament_clips changes
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_prompt_learning_from_clip()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. CREATE TRIGGER ON tournament_clips
-- ============================================================================

DROP TRIGGER IF EXISTS trg_sync_prompt_learning ON tournament_clips;
CREATE TRIGGER trg_sync_prompt_learning
  AFTER UPDATE OF vote_count, status ON tournament_clips
  FOR EACH ROW
  EXECUTE FUNCTION sync_prompt_learning_from_clip();

-- ============================================================================
-- 3. FUNCTION: Bulk sync all existing data
-- Run this once to fix historical data
-- ============================================================================

CREATE OR REPLACE FUNCTION bulk_sync_prompt_learning()
RETURNS TABLE(synced INTEGER, errors INTEGER) AS $$
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. FUNCTION: Recalculate vocabulary scores from synced data
-- ============================================================================

CREATE OR REPLACE FUNCTION recalculate_vocabulary_scores()
RETURNS TABLE(vocabulary_updated INTEGER, patterns_updated INTEGER) AS $$
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. SYNC VISUAL LEARNING: Update clip_visuals when clips change
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_visual_learning_from_clip()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_visual_learning ON tournament_clips;
CREATE TRIGGER trg_sync_visual_learning
  AFTER UPDATE OF vote_count, status ON tournament_clips
  FOR EACH ROW
  EXECUTE FUNCTION sync_visual_learning_from_clip();

-- ============================================================================
-- 6. ADD MISSING INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index for finding unprocessed prompts
CREATE INDEX IF NOT EXISTS idx_prompt_history_unprocessed
  ON prompt_history(created_at DESC)
  WHERE scene_elements IS NULL;

-- Composite index for winning prompts query
CREATE INDEX IF NOT EXISTS idx_prompt_history_winning_by_season
  ON prompt_history(season_id, vote_count DESC)
  WHERE is_winner = TRUE;

-- Composite index for clip_visuals
CREATE INDEX IF NOT EXISTS idx_clip_visuals_season_winner_votes
  ON clip_visuals(season_id, is_winner, vote_count DESC);

-- Index for visual vocabulary scores
CREATE INDEX IF NOT EXISTS idx_visual_vocab_score
  ON visual_vocabulary(avg_vote_score DESC)
  WHERE avg_vote_score > 0;

-- GIN index for JSONB scene_elements queries
CREATE INDEX IF NOT EXISTS idx_prompt_history_scene_elements
  ON prompt_history USING GIN (scene_elements);

-- ============================================================================
-- 7. RUN INITIAL SYNC
-- Execute these after creating the functions:
-- ============================================================================

-- SELECT * FROM bulk_sync_prompt_learning();
-- SELECT * FROM recalculate_vocabulary_scores();

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
