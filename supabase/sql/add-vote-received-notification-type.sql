-- Add 'vote_received' to the notifications type CHECK constraint
-- This allows the notification system to send vote milestone notifications

-- Drop the existing CHECK constraint and recreate with the new type
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'clip_approved',
  'clip_rejected',
  'clip_locked_in',
  'slot_voting_started',
  'achievement_unlocked',
  'daily_goal_reached',
  'new_follower',
  'comment_received',
  'vote_received',
  'system_announcement'
));
