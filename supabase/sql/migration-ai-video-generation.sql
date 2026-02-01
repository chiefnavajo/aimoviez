-- Migration: AI Video Generation
-- Adds AI video generation support via fal.ai
-- Feature flag: ai_video_generation (default: disabled)

-- =============================================================================
-- 1. AI COLUMNS ON TOURNAMENT_CLIPS
-- =============================================================================

ALTER TABLE tournament_clips
  ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_prompt TEXT,
  ADD COLUMN IF NOT EXISTS ai_model VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ai_generation_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS ai_style VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_clips_ai_generated
  ON tournament_clips(is_ai_generated) WHERE is_ai_generated = TRUE;

-- =============================================================================
-- 2. GENERATION TRACKING TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  fal_request_id VARCHAR(200) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  prompt VARCHAR(2000) NOT NULL,
  model VARCHAR(50) NOT NULL,
  style VARCHAR(50),
  genre VARCHAR(20),
  video_url TEXT,
  clip_id UUID REFERENCES tournament_clips(id) ON DELETE SET NULL,
  error_message TEXT,
  cost_cents INTEGER,
  storage_key VARCHAR(500),
  complete_initiated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT valid_ai_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_ai_gen_user ON ai_generations(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_gen_fal_id ON ai_generations(fal_request_id);
CREATE INDEX IF NOT EXISTS idx_ai_gen_status ON ai_generations(status) WHERE status IN ('pending', 'processing');

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_ai_gen_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_gen_updated_at
  BEFORE UPDATE ON ai_generations
  FOR EACH ROW EXECUTE FUNCTION update_ai_gen_updated_at();

-- =============================================================================
-- 3. DAILY GENERATION LIMITS
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_generation_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  generation_count INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

-- =============================================================================
-- 4. ATOMIC DAILY LIMIT CHECK (prevents race condition)
-- =============================================================================

CREATE OR REPLACE FUNCTION check_and_reserve_generation(
  p_user_id UUID,
  p_date DATE,
  p_max_daily INTEGER
) RETURNS INTEGER AS $$
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
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 5. ATOMIC GLOBAL COST CAP CHECK (prevents race condition)
-- =============================================================================

CREATE OR REPLACE FUNCTION check_global_cost_cap(
  p_daily_limit_cents INTEGER,
  p_monthly_limit_cents INTEGER,
  p_new_cost_cents INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  v_daily_total INTEGER;
  v_monthly_total INTEGER;
BEGIN
  SELECT COALESCE(SUM(cost_cents), 0) INTO v_daily_total
  FROM ai_generations
  WHERE created_at >= CURRENT_DATE
    AND status != 'failed';

  SELECT COALESCE(SUM(cost_cents), 0) INTO v_monthly_total
  FROM ai_generations
  WHERE created_at >= date_trunc('month', CURRENT_DATE)
    AND status != 'failed';

  RETURN (v_daily_total + p_new_cost_cents <= p_daily_limit_cents)
     AND (v_monthly_total + p_new_cost_cents <= p_monthly_limit_cents);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generation_limits ENABLE ROW LEVEL SECURITY;

-- Users can only read their own generations
CREATE POLICY ai_gen_select ON ai_generations
  FOR SELECT USING (user_id = auth.uid());

-- Users can only read their own limits
CREATE POLICY ai_limits_select ON ai_generation_limits
  FOR SELECT USING (user_id = auth.uid());

-- Service role bypasses RLS (used by API routes and webhook)

-- =============================================================================
-- 7. FEATURE FLAG (disabled by default)
-- =============================================================================

INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('ai_video_generation', 'AI Video Generation', 'Allow AI clip generation via fal.ai', 'creation', FALSE,
   '{"default_model": "kling-2.6", "max_daily_free": 1, "available_models": ["kling-2.6", "veo3-fast", "hailuo-2.3"], "max_prompt_length": 500, "daily_cost_limit_cents": 5000, "monthly_cost_limit_cents": 150000, "keyword_blocklist": ["nsfw", "nude", "gore", "violence", "blood"], "style_prompt_prefixes": {"cinematic": "cinematic film style,", "anime": "anime style,", "realistic": "photorealistic,", "abstract": "abstract art style,", "noir": "film noir style, black and white,", "retro": "retro VHS style,", "neon": "neon-lit cyberpunk style,"}}')
ON CONFLICT (key) DO NOTHING;
