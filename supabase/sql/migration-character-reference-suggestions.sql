-- Migration: Character Reference Suggestions
-- Allows regular users to suggest reference angles for pinned characters.
-- Suggestions go through admin moderation before being applied.

-- =============================================================================
-- 1. SUGGESTIONS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS character_reference_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pinned_character_id UUID NOT NULL REFERENCES pinned_characters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,

  -- Source clip + timestamp for frame extraction
  source_clip_id UUID NOT NULL REFERENCES tournament_clips(id),
  frame_timestamp FLOAT,

  -- Resulting image (uploaded to storage at suggestion time)
  image_url TEXT NOT NULL,
  storage_key TEXT, -- for cleanup on rejection

  -- Moderation
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for queue + user lookups
CREATE INDEX IF NOT EXISTS idx_ref_suggestions_pending
  ON character_reference_suggestions(status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ref_suggestions_user
  ON character_reference_suggestions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ref_suggestions_character
  ON character_reference_suggestions(pinned_character_id);

-- RLS (service role handles all operations via API routes)
ALTER TABLE character_reference_suggestions ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. FEATURE FLAG
-- =============================================================================

INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('character_reference_suggestions', 'Character Reference Suggestions',
   'Allow users to suggest reference angles for pinned characters',
   'community', FALSE,
   '{"max_suggestions_per_user_per_day": 3}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 3. PERMISSIONS (service_role only)
-- =============================================================================

REVOKE ALL ON character_reference_suggestions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON character_reference_suggestions TO service_role;
