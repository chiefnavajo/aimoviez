-- ============================================================================
-- ADD MISSING FOREIGN KEYS
-- Run this migration to fix orphaned data risks
-- ============================================================================

-- NOTE: Before running, check for orphaned records that would violate FK constraints:
--
-- Check for orphaned tournament_clips (no matching user):
-- SELECT tc.id, tc.username FROM tournament_clips tc
-- LEFT JOIN users u ON tc.user_id = u.id WHERE tc.user_id IS NOT NULL AND u.id IS NULL;
--
-- Check for orphaned tournament_clips (no matching season):
-- SELECT tc.id FROM tournament_clips tc
-- LEFT JOIN seasons s ON tc.season_id = s.id WHERE tc.season_id IS NOT NULL AND s.id IS NULL;
--
-- Check for orphaned comments:
-- SELECT c.id, c.clip_id FROM comments c
-- LEFT JOIN tournament_clips tc ON c.clip_id::uuid = tc.id WHERE tc.id IS NULL;
--
-- Check for orphaned clip_views:
-- SELECT cv.id, cv.clip_id FROM clip_views cv
-- LEFT JOIN tournament_clips tc ON cv.clip_id = tc.id WHERE tc.id IS NULL;

-- ============================================================================
-- 1. tournament_clips → users
-- ============================================================================

-- First, ensure user_id column exists and is UUID type
DO $$
BEGIN
  -- Add user_id column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tournament_clips' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE tournament_clips ADD COLUMN user_id UUID;
  END IF;
END $$;

-- Add FK constraint (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_tournament_clips_user'
    AND table_name = 'tournament_clips'
  ) THEN
    ALTER TABLE tournament_clips
    ADD CONSTRAINT fk_tournament_clips_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_tournament_clips_user_id ON tournament_clips(user_id);

-- ============================================================================
-- 2. tournament_clips → seasons
-- ============================================================================

-- Add FK constraint for season_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_tournament_clips_season'
    AND table_name = 'tournament_clips'
  ) THEN
    ALTER TABLE tournament_clips
    ADD CONSTRAINT fk_tournament_clips_season
    FOREIGN KEY (season_id) REFERENCES seasons(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_tournament_clips_season_id ON tournament_clips(season_id);

-- ============================================================================
-- 3. comments.clip_id → tournament_clips
-- Fix: clip_id should be UUID, not TEXT
-- ============================================================================

-- Check current type and migrate if needed
DO $$
DECLARE
  current_type text;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_name = 'comments' AND column_name = 'clip_id';

  -- If it's text/varchar, we need to convert
  IF current_type IN ('text', 'character varying') THEN
    -- Create a new UUID column
    ALTER TABLE comments ADD COLUMN clip_id_new UUID;

    -- Copy data (cast text to uuid)
    UPDATE comments SET clip_id_new = clip_id::uuid WHERE clip_id IS NOT NULL;

    -- Drop old column and rename new
    ALTER TABLE comments DROP COLUMN clip_id;
    ALTER TABLE comments RENAME COLUMN clip_id_new TO clip_id;
  END IF;
END $$;

-- Add FK constraint for comments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_comments_clip'
    AND table_name = 'comments'
  ) THEN
    ALTER TABLE comments
    ADD CONSTRAINT fk_comments_clip
    FOREIGN KEY (clip_id) REFERENCES tournament_clips(id)
    ON DELETE CASCADE;
  END IF;
END $$;

-- Create index
CREATE INDEX IF NOT EXISTS idx_comments_clip_id ON comments(clip_id);

-- ============================================================================
-- 4. clip_views → tournament_clips
-- ============================================================================

-- First, clean up orphaned clip_views (views for deleted clips)
DELETE FROM clip_views
WHERE clip_id NOT IN (SELECT id FROM tournament_clips);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_clip_views_clip'
    AND table_name = 'clip_views'
  ) THEN
    ALTER TABLE clip_views
    ADD CONSTRAINT fk_clip_views_clip
    FOREIGN KEY (clip_id) REFERENCES tournament_clips(id)
    ON DELETE CASCADE;

    RAISE NOTICE 'Added fk_clip_views_clip constraint';
  ELSE
    RAISE NOTICE 'fk_clip_views_clip already exists, skipping';
  END IF;
END $$;

-- Create index
CREATE INDEX IF NOT EXISTS idx_clip_views_clip_id ON clip_views(clip_id);

-- ============================================================================
-- 5. notifications → users
-- ============================================================================

-- Only run if notifications table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notifications') THEN
    -- Add user_id column if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'notifications' AND column_name = 'user_id'
    ) THEN
      ALTER TABLE notifications ADD COLUMN user_id UUID;
      RAISE NOTICE 'Added user_id column to notifications';
    END IF;

    -- Add FK constraint if missing
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'fk_notifications_user'
      AND table_name = 'notifications'
    ) THEN
      ALTER TABLE notifications
      ADD CONSTRAINT fk_notifications_user
      FOREIGN KEY (user_id) REFERENCES users(id)
      ON DELETE CASCADE;
      RAISE NOTICE 'Added fk_notifications_user constraint';
    END IF;

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_key ON notifications(user_key);
  ELSE
    RAISE NOTICE 'notifications table does not exist, skipping';
  END IF;
END $$;

-- ============================================================================
-- 6. votes → tournament_clips
-- NOTE: This should already exist from migration-critical-fixes.sql
-- Only runs if the constraint doesn't exist
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_votes_clip'
    AND table_name = 'votes'
  ) THEN
    -- Clean orphaned votes first
    DELETE FROM votes WHERE clip_id NOT IN (SELECT id FROM tournament_clips);

    ALTER TABLE votes
    ADD CONSTRAINT fk_votes_clip
    FOREIGN KEY (clip_id) REFERENCES tournament_clips(id)
    ON DELETE CASCADE;

    RAISE NOTICE 'Added fk_votes_clip constraint';
  ELSE
    RAISE NOTICE 'fk_votes_clip already exists, skipping';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION QUERIES
-- Run these after migration to verify:
-- ============================================================================

-- SELECT
--   tc.table_name,
--   kcu.column_name,
--   ccu.table_name AS foreign_table_name,
--   ccu.column_name AS foreign_column_name
-- FROM information_schema.table_constraints AS tc
-- JOIN information_schema.key_column_usage AS kcu
--   ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage AS ccu
--   ON ccu.constraint_name = tc.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY'
--   AND tc.table_name IN ('tournament_clips', 'comments', 'clip_views', 'notifications', 'votes');
