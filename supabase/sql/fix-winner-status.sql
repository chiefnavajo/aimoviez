-- ============================================================================
-- FIX WINNER STATUS
-- This script fixes clips that are marked as winners in story_slots
-- but don't have the correct 'locked' status in tournament_clips
-- ============================================================================

-- First, let's see the problem clips
SELECT
  tc.id,
  tc.title,
  tc.status as clip_status,
  tc.slot_position as current_slot_position,
  ss.slot_position as winning_slot_position,
  ss.status as slot_status
FROM tournament_clips tc
JOIN story_slots ss ON ss.winner_tournament_clip_id = tc.id
WHERE tc.status != 'locked'
   OR tc.slot_position != ss.slot_position;

-- Fix 1: Update winning clips to have 'locked' status
UPDATE tournament_clips
SET status = 'locked'
WHERE id IN (
  SELECT winner_tournament_clip_id
  FROM story_slots
  WHERE winner_tournament_clip_id IS NOT NULL
)
AND status != 'locked';

-- Fix 2: Update winning clips to have correct slot_position (their winning slot)
UPDATE tournament_clips tc
SET slot_position = ss.slot_position
FROM story_slots ss
WHERE ss.winner_tournament_clip_id = tc.id
  AND tc.slot_position != ss.slot_position;

-- Verify the fix
SELECT
  tc.id,
  tc.title,
  tc.status as clip_status,
  tc.slot_position as current_slot_position,
  ss.slot_position as winning_slot_position,
  ss.status as slot_status
FROM tournament_clips tc
JOIN story_slots ss ON ss.winner_tournament_clip_id = tc.id;
