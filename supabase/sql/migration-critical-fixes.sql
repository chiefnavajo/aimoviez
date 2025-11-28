-- ================================================
-- CRITICAL FIXES MIGRATION
-- Run this in Supabase SQL Editor
-- ================================================

-- FIX #1: Clean orphaned votes (votes pointing to deleted clips)
-- This must run BEFORE adding foreign key constraint
DELETE FROM votes
WHERE clip_id NOT IN (SELECT id FROM tournament_clips);

-- FIX #2: Add unique constraint to prevent duplicate daily votes
-- This ensures one user can only vote once per clip per day
ALTER TABLE votes 
ADD CONSTRAINT unique_daily_vote 
UNIQUE (voter_key, clip_id, DATE(created_at));

-- FIX #3: Add foreign key constraint
-- This ensures votes are deleted when clips are deleted (data integrity)
ALTER TABLE votes
ADD CONSTRAINT fk_votes_clip
FOREIGN KEY (clip_id) 
REFERENCES tournament_clips(id)
ON DELETE CASCADE;

-- Verify constraints were added successfully
SELECT 
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'votes'
ORDER BY tc.constraint_type;

-- Expected output:
-- unique_daily_vote | UNIQUE | voter_key, clip_id, created_at
-- fk_votes_clip | FOREIGN KEY | clip_id
