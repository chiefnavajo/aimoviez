-- Fix story_slots status constraint to include 'waiting_for_clips'
-- This allows slots to be in a waiting state when no clips are available

-- Step 1: Drop the existing constraint
ALTER TABLE story_slots DROP CONSTRAINT IF EXISTS story_slots_status_check;

-- Step 2: Add new constraint with 'waiting_for_clips' included
ALTER TABLE story_slots ADD CONSTRAINT story_slots_status_check
CHECK (status IN ('upcoming', 'voting', 'locked', 'archived', 'waiting_for_clips'));

-- Step 3: Fix slot 5 to 'waiting_for_clips' status (current broken state)
UPDATE story_slots
SET status = 'waiting_for_clips'
WHERE slot_position = 5
  AND status = 'upcoming';

-- Verify the fix
SELECT slot_position, status
FROM story_slots
WHERE slot_position IN (4, 5, 6)
ORDER BY slot_position;
