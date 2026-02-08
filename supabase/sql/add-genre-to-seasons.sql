-- Migration: Add genre support to seasons table
-- This enables multi-genre seasons running in parallel

-- Step 1: Add genre column to seasons table
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS genre TEXT;

-- Step 2: Create indexes for fast genre lookups
CREATE INDEX IF NOT EXISTS idx_seasons_genre ON seasons(genre);
CREATE INDEX IF NOT EXISTS idx_seasons_status_genre ON seasons(status, genre);

-- Step 3: Add unique constraint (one active season per genre)
-- This prevents duplicate active seasons for same genre
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_active_genre
ON seasons(genre)
WHERE status = 'active';

-- Step 4: Update existing active season to have a default genre
-- This preserves backward compatibility with existing data
UPDATE seasons
SET genre = 'action'
WHERE genre IS NULL AND status = 'active';

-- Step 5: Add feature flag for multi-genre (disabled by default)
INSERT INTO feature_flags (key, name, enabled, description)
VALUES ('multi_genre_enabled', 'Multi-Genre Seasons', false, 'Enable multi-genre seasons with horizontal swipe')
ON CONFLICT (key) DO NOTHING;

-- Verification queries:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'seasons' AND column_name = 'genre';
-- SELECT id, label, genre, status FROM seasons WHERE status = 'active';
