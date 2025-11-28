-- ============================================
-- AUTO-ADVANCE TIMER & CLIP SAMPLING
-- AiMoviez · 8SEC MADNESS
-- ============================================

-- 1. Add timer fields to story_slots
ALTER TABLE story_slots
  ADD COLUMN IF NOT EXISTS voting_duration_hours integer DEFAULT 24,
  ADD COLUMN IF NOT EXISTS voting_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS voting_ends_at timestamptz;

-- 2. Add view tracking to clips for fair sampling
ALTER TABLE tournament_clips
  ADD COLUMN IF NOT EXISTS view_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_shown_at timestamptz;

-- 3. Create clip_views table to track which users saw which clips
CREATE TABLE IF NOT EXISTS clip_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL,
  voter_key text NOT NULL,
  viewed_at timestamptz DEFAULT now(),
  voted boolean DEFAULT false
);

-- 4. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_clip_views_voter ON clip_views(voter_key, clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_views_clip ON clip_views(clip_id);
CREATE INDEX IF NOT EXISTS idx_clips_view_count ON tournament_clips(view_count, slot_position);
CREATE INDEX IF NOT EXISTS idx_slots_voting_ends ON story_slots(voting_ends_at) WHERE status = 'voting';

-- 5. Update existing voting slot to have end time (24h from now)
UPDATE story_slots
SET 
  voting_started_at = COALESCE(voting_started_at, now()),
  voting_ends_at = COALESCE(voting_ends_at, now() + interval '24 hours'),
  voting_duration_hours = COALESCE(voting_duration_hours, 24)
WHERE status = 'voting';

-- ============================================
-- VERIFICATION
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns 
-- WHERE table_name = 'story_slots' AND column_name LIKE 'voting%';
