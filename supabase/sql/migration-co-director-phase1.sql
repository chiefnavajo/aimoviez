-- ============================================================================
-- AI CO-DIRECTOR PHASE 1 MIGRATION
-- Story Analysis, Direction Voting, and Creative Briefs
-- ============================================================================
-- Run this in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. STORY ANALYSES TABLE
-- Cached AI analysis of story-so-far for each slot
-- ============================================================================
CREATE TABLE IF NOT EXISTS story_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  slot_position INTEGER NOT NULL,
  analysis JSONB NOT NULL,  -- { characters, plot_threads, setting, tone, themes, visual_style, act_structure }
  model_used VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514',
  input_token_count INTEGER,
  output_token_count INTEGER,
  cost_cents INTEGER,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, slot_position)
);

CREATE INDEX IF NOT EXISTS idx_story_analyses_season ON story_analyses(season_id);

-- ============================================================================
-- 2. DIRECTION OPTIONS TABLE
-- 3-5 AI-generated direction options per slot for community voting
-- ============================================================================
CREATE TABLE IF NOT EXISTS direction_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  slot_position INTEGER NOT NULL,
  option_number INTEGER NOT NULL CHECK (option_number BETWEEN 1 AND 5),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  mood VARCHAR(100),
  suggested_genre VARCHAR(50),
  visual_hints TEXT,
  narrative_hooks TEXT,
  vote_count INTEGER DEFAULT 0 CHECK (vote_count >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, slot_position, option_number)
);

CREATE INDEX IF NOT EXISTS idx_direction_options_slot ON direction_options(season_id, slot_position);

-- ============================================================================
-- 3. DIRECTION VOTES TABLE
-- One vote per user per slot (not per direction option)
-- ============================================================================
CREATE TABLE IF NOT EXISTS direction_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction_option_id UUID NOT NULL REFERENCES direction_options(id) ON DELETE CASCADE,
  voter_key VARCHAR(100) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  slot_position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- CRITICAL: This constraint ensures ONE vote per user per slot (not per option)
  UNIQUE(season_id, slot_position, voter_key)
);

CREATE INDEX IF NOT EXISTS idx_direction_votes_voter ON direction_votes(voter_key, season_id, slot_position);
CREATE INDEX IF NOT EXISTS idx_direction_votes_option ON direction_votes(direction_option_id);

-- ============================================================================
-- 4. DIRECTION VOTE COUNT TRIGGER
-- Atomically update vote_count when votes are inserted/deleted
-- Prevents race conditions on concurrent votes
-- ============================================================================
CREATE OR REPLACE FUNCTION update_direction_vote_count()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_direction_vote_count ON direction_votes;
CREATE TRIGGER trg_direction_vote_count
AFTER INSERT OR DELETE ON direction_votes
FOR EACH ROW EXECUTE FUNCTION update_direction_vote_count();

-- ============================================================================
-- 5. SLOT BRIEFS TABLE
-- Creative brief per slot, generated from winning direction
-- ============================================================================
CREATE TABLE IF NOT EXISTS slot_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  slot_position INTEGER NOT NULL,
  winning_direction_id UUID REFERENCES direction_options(id) ON DELETE SET NULL,
  brief_title VARCHAR(200) NOT NULL,
  scene_description TEXT NOT NULL,
  visual_requirements TEXT NOT NULL,
  tone_guidance TEXT NOT NULL,
  continuity_notes TEXT,
  do_list TEXT,
  dont_list TEXT,
  example_prompts TEXT[],
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  model_used VARCHAR(100),
  input_token_count INTEGER,
  output_token_count INTEGER,
  cost_cents INTEGER,
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, slot_position)
);

CREATE INDEX IF NOT EXISTS idx_slot_briefs_slot ON slot_briefs(season_id, slot_position);
CREATE INDEX IF NOT EXISTS idx_slot_briefs_published ON slot_briefs(status) WHERE status = 'published';

-- ============================================================================
-- 6. UPDATED_AT TRIGGERS
-- Automatically update updated_at column on row changes
-- ============================================================================
-- Create the function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS story_analyses_updated_at ON story_analyses;
CREATE TRIGGER story_analyses_updated_at
  BEFORE UPDATE ON story_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS direction_options_updated_at ON direction_options;
CREATE TRIGGER direction_options_updated_at
  BEFORE UPDATE ON direction_options
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS slot_briefs_updated_at ON slot_briefs;
CREATE TRIGGER slot_briefs_updated_at
  BEFORE UPDATE ON slot_briefs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. ADD DIRECTION VOTING COLUMNS TO STORY_SLOTS
-- ============================================================================
ALTER TABLE story_slots
  ADD COLUMN IF NOT EXISTS direction_voting_status VARCHAR(20) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS direction_voting_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS winning_direction_id UUID,
  ADD COLUMN IF NOT EXISTS brief_id UUID;

-- Add foreign keys (separate statements for IF NOT EXISTS behavior)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'story_slots_winning_direction_id_fkey'
  ) THEN
    ALTER TABLE story_slots
      ADD CONSTRAINT story_slots_winning_direction_id_fkey
      FOREIGN KEY (winning_direction_id) REFERENCES direction_options(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'story_slots_brief_id_fkey'
  ) THEN
    ALTER TABLE story_slots
      ADD CONSTRAINT story_slots_brief_id_fkey
      FOREIGN KEY (brief_id) REFERENCES slot_briefs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================================
-- 8. ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Story Analyses
ALTER TABLE story_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_analyses_select_all" ON story_analyses;
CREATE POLICY "story_analyses_select_all" ON story_analyses
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "story_analyses_modify_service" ON story_analyses;
CREATE POLICY "story_analyses_modify_service" ON story_analyses
  FOR ALL USING (auth.role() = 'service_role');

-- Direction Options
ALTER TABLE direction_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "direction_options_select_all" ON direction_options;
CREATE POLICY "direction_options_select_all" ON direction_options
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "direction_options_modify_service" ON direction_options;
CREATE POLICY "direction_options_modify_service" ON direction_options
  FOR ALL USING (auth.role() = 'service_role');

-- Direction Votes
ALTER TABLE direction_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "direction_votes_select_all" ON direction_votes;
CREATE POLICY "direction_votes_select_all" ON direction_votes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "direction_votes_insert_any" ON direction_votes;
CREATE POLICY "direction_votes_insert_any" ON direction_votes
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "direction_votes_delete_service" ON direction_votes;
CREATE POLICY "direction_votes_delete_service" ON direction_votes
  FOR DELETE USING (auth.role() = 'service_role');

-- Slot Briefs
ALTER TABLE slot_briefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "slot_briefs_select_all" ON slot_briefs;
CREATE POLICY "slot_briefs_select_all" ON slot_briefs
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "slot_briefs_modify_service" ON slot_briefs;
CREATE POLICY "slot_briefs_modify_service" ON slot_briefs
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- 9. FEATURE FLAG
-- ============================================================================
INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('ai_co_director', 'AI Co-Director', 'AI-powered story analysis, direction voting, and creative briefs', 'ai', FALSE,
   '{"claude_model": "claude-sonnet-4-20250514", "max_directions": 3, "direction_voting_hours": 48, "auto_publish_brief": false}')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  config = EXCLUDED.config;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Uncomment to verify installation:

-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('story_analyses', 'direction_options', 'direction_votes', 'slot_briefs');

-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'story_slots' AND column_name LIKE '%direction%' OR column_name = 'brief_id';

-- SELECT * FROM feature_flags WHERE key = 'ai_co_director';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
