-- migration-character-pinning.sql
-- ============================================================================
-- CHARACTER PINNING — Pin character references for consistent AI generation
-- Uses Kling O1 Reference-to-Video via fal.ai
-- ============================================================================

-- 1. PINNED CHARACTERS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pinned_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  element_index INTEGER NOT NULL DEFAULT 1,
  label VARCHAR(100),
  frontal_image_url TEXT NOT NULL,
  reference_image_urls TEXT[] DEFAULT '{}',
  source_clip_id UUID REFERENCES tournament_clips(id),
  source_frame_timestamp FLOAT,
  pinned_by UUID,
  usage_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, element_index),
  CONSTRAINT valid_element_index CHECK (element_index BETWEEN 1 AND 4)
);

CREATE INDEX IF NOT EXISTS idx_pinned_chars_season
  ON pinned_characters(season_id) WHERE is_active = true;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_pinned_chars_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pinned_chars_updated_at
  BEFORE UPDATE ON pinned_characters
  FOR EACH ROW EXECUTE FUNCTION update_pinned_chars_updated_at();

-- RLS
ALTER TABLE pinned_characters ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read active pinned characters
CREATE POLICY pinned_chars_select ON pinned_characters
  FOR SELECT USING (true);

-- Only service role can insert/update/delete (admin API uses service role key)

-- 2. AI_GENERATIONS COLUMNS FOR TRACKING
-- ============================================================================

ALTER TABLE ai_generations
  ADD COLUMN IF NOT EXISTS pinned_character_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS generation_mode VARCHAR(30) DEFAULT 'text-to-video';

-- 3. FEATURE FLAG
-- ============================================================================

INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('character_pinning', 'Character Pinning', 'Pin character references for consistent AI generation via Kling O1 Reference-to-Video', 'ai', FALSE,
   '{"max_elements_per_season": 4, "auto_switch_model": true, "cost_premium_warning": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;
