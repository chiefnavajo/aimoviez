-- Migration: Clip Elimination Lifecycle
-- Adds columns for tracking clip elimination, pinning, and video cleanup.
-- Also adds a feature flag for admin-configurable grace period.

-- New columns on tournament_clips
ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS eliminated_at TIMESTAMPTZ;
ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS elimination_reason TEXT;
ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS video_deleted_at TIMESTAMPTZ;

-- Backfill: eliminate orphaned active clips in finished seasons
UPDATE tournament_clips tc
SET status = 'eliminated', eliminated_at = NOW(), elimination_reason = 'season_ended'
FROM seasons s
WHERE tc.season_id = s.id AND s.status = 'finished' AND tc.status = 'active';

-- Indexes for cleanup queries
CREATE INDEX IF NOT EXISTS idx_clips_elimination_cleanup
  ON tournament_clips(status, eliminated_at)
  WHERE status IN ('eliminated', 'rejected') AND is_pinned = FALSE;
CREATE INDEX IF NOT EXISTS idx_clips_pinned
  ON tournament_clips(user_id) WHERE is_pinned = TRUE;

-- Feature flag for configurable grace period (default 14 days)
INSERT INTO feature_flags (key, name, description, enabled, category, config)
VALUES (
  'clip_elimination',
  'Clip Elimination Settings',
  'Controls grace period before eliminated clip videos are deleted from storage',
  true,
  'engagement',
  '{"grace_period_days": 14}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
