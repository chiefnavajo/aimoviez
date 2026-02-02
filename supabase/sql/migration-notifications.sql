-- Notifications Table Migration
-- Stores user notifications for various events

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
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
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_key ON notifications (user_key);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications (is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications (type);

-- Add comments
COMMENT ON TABLE notifications IS 'Stores user notifications for all events';
COMMENT ON COLUMN notifications.user_key IS 'Hashed device identifier or user ID';
COMMENT ON COLUMN notifications.type IS 'Type of notification event';
COMMENT ON COLUMN notifications.title IS 'Short notification title';
COMMENT ON COLUMN notifications.message IS 'Notification message body';
COMMENT ON COLUMN notifications.action_url IS 'Optional URL for user action';
COMMENT ON COLUMN notifications.metadata IS 'Additional JSON data for the notification';
COMMENT ON COLUMN notifications.is_read IS 'Whether user has read the notification';
COMMENT ON COLUMN notifications.read_at IS 'When notification was marked as read';

-- Function to auto-cleanup old notifications (older than 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS void AS $$
BEGIN
  DELETE FROM notifications
  WHERE created_at < NOW() - INTERVAL '30 days'
    AND is_read = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to run cleanup daily (requires pg_cron extension)
-- Uncomment if pg_cron is available:
-- SELECT cron.schedule('cleanup-notifications', '0 2 * * *', 'SELECT cleanup_old_notifications()');
