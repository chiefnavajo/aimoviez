-- ============================================================================
-- PROMPT LEARNING MIGRATION (1 of 3)
-- AI learns from ALL prompts to suggest better prompts
-- ============================================================================
-- Created: 2026-02-07 19:45:00 UTC
-- Version: 1.1.0
-- Run this in Supabase SQL Editor
-- Order: Run this FIRST
-- ============================================================================

-- ============================================================================
-- 1. PROMPT HISTORY TABLE
-- Stores ALL prompts for learning (existing + new)
-- ============================================================================

CREATE TABLE IF NOT EXISTS prompt_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  clip_id UUID REFERENCES tournament_clips(id) ON DELETE SET NULL,
  slot_id UUID REFERENCES story_slots(id) ON DELETE SET NULL,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  user_prompt TEXT NOT NULL,
  ai_model VARCHAR(50) NOT NULL,
  brief_id UUID REFERENCES slot_briefs(id) ON DELETE SET NULL,
  vote_count INTEGER DEFAULT 0,
  is_winner BOOLEAN DEFAULT FALSE,
  scene_elements JSONB DEFAULT NULL,  -- Extracted lighting, location, camera, etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_prompt_history_season_model
  ON prompt_history(season_id, ai_model);
CREATE INDEX IF NOT EXISTS idx_prompt_history_winner
  ON prompt_history(is_winner) WHERE is_winner = TRUE;
CREATE INDEX IF NOT EXISTS idx_prompt_history_vote_count
  ON prompt_history(vote_count DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_prompt_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prompt_history_updated_at ON prompt_history;
CREATE TRIGGER trg_prompt_history_updated_at
  BEFORE UPDATE ON prompt_history
  FOR EACH ROW EXECUTE FUNCTION update_prompt_history_updated_at();

-- ============================================================================
-- 2. SCENE VOCABULARY TABLE
-- Learned visual terms from all prompts
-- ============================================================================

CREATE TABLE IF NOT EXISTS scene_vocabulary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  term VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,  -- 'lighting', 'location', 'camera', 'atmosphere', 'object', 'color', 'time'
  frequency INTEGER DEFAULT 1,
  total_votes INTEGER DEFAULT 0,
  avg_vote_score FLOAT DEFAULT 0,
  winner_count INTEGER DEFAULT 0,  -- How many times used in winning prompts
  example_prompts TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, term, category)
);

-- Index for vocabulary lookups
CREATE INDEX IF NOT EXISTS idx_scene_vocab_season_cat
  ON scene_vocabulary(season_id, category);
CREATE INDEX IF NOT EXISTS idx_scene_vocab_frequency
  ON scene_vocabulary(frequency DESC);
CREATE INDEX IF NOT EXISTS idx_scene_vocab_avg_score
  ON scene_vocabulary(avg_vote_score DESC) WHERE avg_vote_score > 0;

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_scene_vocab_updated_at ON scene_vocabulary;
CREATE TRIGGER trg_scene_vocab_updated_at
  BEFORE UPDATE ON scene_vocabulary
  FOR EACH ROW EXECUTE FUNCTION update_prompt_history_updated_at();

-- ============================================================================
-- 3. MODEL PROMPT PATTERNS TABLE
-- Track which patterns work best per AI model
-- ============================================================================

CREATE TABLE IF NOT EXISTS model_prompt_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_model VARCHAR(50) NOT NULL,
  pattern_type VARCHAR(50) NOT NULL,  -- 'shot_prefix', 'lighting', 'motion', 'style'
  pattern_text VARCHAR(200) NOT NULL,
  usage_count INTEGER DEFAULT 1,
  total_votes INTEGER DEFAULT 0,
  avg_vote_score FLOAT DEFAULT 0,
  winner_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(ai_model, pattern_type, pattern_text)
);

CREATE INDEX IF NOT EXISTS idx_model_patterns_model
  ON model_prompt_patterns(ai_model);
CREATE INDEX IF NOT EXISTS idx_model_patterns_score
  ON model_prompt_patterns(avg_vote_score DESC) WHERE usage_count >= 3;

-- ============================================================================
-- 4. MIGRATE EXISTING PROMPTS
-- Import ALL existing ai_prompts from tournament_clips
-- ============================================================================

INSERT INTO prompt_history (
  user_id,
  clip_id,
  slot_id,
  season_id,
  user_prompt,
  ai_model,
  vote_count,
  is_winner,
  created_at
)
SELECT
  tc.user_id,
  tc.id,
  NULL,  -- slot_id not directly available in tournament_clips
  tc.season_id,
  tc.ai_prompt,
  COALESCE(tc.ai_model, 'unknown'),
  COALESCE(tc.vote_count, 0),
  (tc.status = 'winner'),
  tc.created_at
FROM tournament_clips tc
WHERE tc.ai_prompt IS NOT NULL
  AND tc.ai_prompt != ''
  AND tc.season_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 5. UPSERT FUNCTION FOR VOCABULARY
-- Atomically update vocabulary when processing prompts
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
    avg_vote_score, winner_count, example_prompts
  ) VALUES (
    p_season_id,
    p_term,
    p_category,
    1,
    p_vote_count,
    p_vote_count::FLOAT,
    CASE WHEN p_is_winner THEN 1 ELSE 0 END,
    ARRAY[p_example_prompt]
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
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. UPSERT FUNCTION FOR MODEL PATTERNS
-- Track patterns per AI model
-- ============================================================================

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
    total_votes, avg_vote_score, winner_count
  ) VALUES (
    p_ai_model,
    p_pattern_type,
    p_pattern_text,
    1,
    p_vote_count,
    p_vote_count::FLOAT,
    CASE WHEN p_is_winner THEN 1 ELSE 0 END
  )
  ON CONFLICT (ai_model, pattern_type, pattern_text) DO UPDATE SET
    usage_count = model_prompt_patterns.usage_count + 1,
    total_votes = model_prompt_patterns.total_votes + p_vote_count,
    avg_vote_score = (model_prompt_patterns.total_votes + p_vote_count)::FLOAT /
                     (model_prompt_patterns.usage_count + 1),
    winner_count = model_prompt_patterns.winner_count +
                   CASE WHEN p_is_winner THEN 1 ELSE 0 END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE prompt_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE scene_vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_prompt_patterns ENABLE ROW LEVEL SECURITY;

-- Public read for all learning tables (needed for suggestions)
DROP POLICY IF EXISTS "prompt_history_select_all" ON prompt_history;
CREATE POLICY "prompt_history_select_all" ON prompt_history
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "prompt_history_modify_service" ON prompt_history;
CREATE POLICY "prompt_history_modify_service" ON prompt_history
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "scene_vocab_select_all" ON scene_vocabulary;
CREATE POLICY "scene_vocab_select_all" ON scene_vocabulary
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "scene_vocab_modify_service" ON scene_vocabulary;
CREATE POLICY "scene_vocab_modify_service" ON scene_vocabulary
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "model_patterns_select_all" ON model_prompt_patterns;
CREATE POLICY "model_patterns_select_all" ON model_prompt_patterns
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "model_patterns_modify_service" ON model_prompt_patterns;
CREATE POLICY "model_patterns_modify_service" ON model_prompt_patterns
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- 8. CLIP VISUALS TABLE
-- Store visual features extracted from clip thumbnails/frames
-- ============================================================================

CREATE TABLE IF NOT EXISTS clip_visuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID NOT NULL REFERENCES tournament_clips(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  thumbnail_url TEXT NOT NULL,
  features JSONB NOT NULL,  -- VisualFeatures object
  prompt_used TEXT,
  vote_count INTEGER DEFAULT 0,
  is_winner BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(clip_id)
);

CREATE INDEX IF NOT EXISTS idx_clip_visuals_season
  ON clip_visuals(season_id);
CREATE INDEX IF NOT EXISTS idx_clip_visuals_winner
  ON clip_visuals(is_winner) WHERE is_winner = TRUE;

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_clip_visuals_updated_at ON clip_visuals;
CREATE TRIGGER trg_clip_visuals_updated_at
  BEFORE UPDATE ON clip_visuals
  FOR EACH ROW EXECUTE FUNCTION update_prompt_history_updated_at();

-- ============================================================================
-- 9. VISUAL VOCABULARY TABLE
-- Learned visual terms from analyzed frames
-- ============================================================================

CREATE TABLE IF NOT EXISTS visual_vocabulary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  term VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,  -- 'framing', 'lighting_mood', 'color', 'setting', etc.
  frequency INTEGER DEFAULT 1,
  total_votes INTEGER DEFAULT 0,
  avg_vote_score FLOAT DEFAULT 0,
  winner_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, term, category)
);

CREATE INDEX IF NOT EXISTS idx_visual_vocab_season_cat
  ON visual_vocabulary(season_id, category);
CREATE INDEX IF NOT EXISTS idx_visual_vocab_frequency
  ON visual_vocabulary(frequency DESC);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS trg_visual_vocab_updated_at ON visual_vocabulary;
CREATE TRIGGER trg_visual_vocab_updated_at
  BEFORE UPDATE ON visual_vocabulary
  FOR EACH ROW EXECUTE FUNCTION update_prompt_history_updated_at();

-- ============================================================================
-- 10. UPSERT FUNCTION FOR VISUAL VOCABULARY
-- ============================================================================

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
    avg_vote_score, winner_count
  ) VALUES (
    p_season_id,
    p_term,
    p_category,
    1,
    p_vote_count,
    p_vote_count::FLOAT,
    CASE WHEN p_is_winner THEN 1 ELSE 0 END
  )
  ON CONFLICT (season_id, term, category) DO UPDATE SET
    frequency = visual_vocabulary.frequency + 1,
    total_votes = visual_vocabulary.total_votes + p_vote_count,
    avg_vote_score = (visual_vocabulary.total_votes + p_vote_count)::FLOAT /
                     (visual_vocabulary.frequency + 1),
    winner_count = visual_vocabulary.winner_count +
                   CASE WHEN p_is_winner THEN 1 ELSE 0 END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 11. PROMPT-VISUAL CORRELATION TABLE
-- Links prompts to their visual outcomes for learning
-- ============================================================================

CREATE TABLE IF NOT EXISTS prompt_visual_correlation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id UUID REFERENCES prompt_history(id) ON DELETE CASCADE,
  clip_visual_id UUID REFERENCES clip_visuals(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  correlation_score FLOAT DEFAULT 1.0,  -- How well prompt matches visual
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(prompt_id, clip_visual_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_visual_season
  ON prompt_visual_correlation(season_id);

-- ============================================================================
-- 12. RLS FOR VISUAL TABLES
-- ============================================================================

ALTER TABLE clip_visuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_visual_correlation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clip_visuals_select_all" ON clip_visuals;
CREATE POLICY "clip_visuals_select_all" ON clip_visuals
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "clip_visuals_modify_service" ON clip_visuals;
CREATE POLICY "clip_visuals_modify_service" ON clip_visuals
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "visual_vocab_select_all" ON visual_vocabulary;
CREATE POLICY "visual_vocab_select_all" ON visual_vocabulary
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "visual_vocab_modify_service" ON visual_vocabulary;
CREATE POLICY "visual_vocab_modify_service" ON visual_vocabulary
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "prompt_visual_select_all" ON prompt_visual_correlation;
CREATE POLICY "prompt_visual_select_all" ON prompt_visual_correlation
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "prompt_visual_modify_service" ON prompt_visual_correlation;
CREATE POLICY "prompt_visual_modify_service" ON prompt_visual_correlation
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- 13. FEATURE FLAGS
-- ============================================================================

INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('prompt_learning', 'Prompt Learning', 'AI learns from all prompts to suggest better prompts', 'ai', FALSE,
   '{"auto_suggest_enabled": true, "min_prompts_for_learning": 10, "top_patterns_count": 5}'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  config = EXCLUDED.config;

INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('visual_learning', 'Visual Learning', 'AI learns from video visuals to understand style and quality', 'ai', FALSE,
   '{"auto_analyze_thumbnails": true, "similarity_threshold": 0.3}'::jsonb)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  config = EXCLUDED.config;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Uncomment to verify installation:

-- SELECT COUNT(*) as imported_prompts FROM prompt_history;

-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('prompt_history', 'scene_vocabulary', 'model_prompt_patterns');

-- SELECT * FROM feature_flags WHERE key = 'prompt_learning';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
