-- Reset Season 1 for Clean Voting Test
-- Run this in Supabase SQL Editor
-- This will: Reset to segment 1/75, clear votes, set all clips to pending

-- Step 1: Reset all story_slots for the active season
-- Set all slots back to 'upcoming' and clear winners
UPDATE story_slots
SET
  status = 'upcoming',
  winner_tournament_clip_id = NULL,
  voting_started_at = NULL,
  voting_ends_at = NULL
WHERE season_id = (SELECT id FROM seasons WHERE status = 'active' LIMIT 1);

-- Step 2: Set slot 1 to 'voting' status with 24h timer
UPDATE story_slots
SET
  status = 'voting',
  voting_started_at = NOW(),
  voting_ends_at = NOW() + INTERVAL '24 hours',
  voting_duration_hours = 24
WHERE season_id = (SELECT id FROM seasons WHERE status = 'active' LIMIT 1)
  AND slot_position = 1;

-- Step 3: Set ALL clips to 'pending' status and reset vote counts
UPDATE tournament_clips
SET
  status = 'pending',
  vote_count = 0,
  weighted_score = 0;

-- Step 4: Clear all votes for fresh start
DELETE FROM votes;

-- Step 5: Verify the reset - show slot status
SELECT
  ss.slot_position,
  ss.status,
  ss.voting_started_at,
  ss.voting_ends_at
FROM story_slots ss
JOIN seasons s ON ss.season_id = s.id
WHERE s.status = 'active'
ORDER BY ss.slot_position
LIMIT 5;

-- Step 6: Show clip counts by status
SELECT status, COUNT(*) as count
FROM tournament_clips
GROUP BY status;
