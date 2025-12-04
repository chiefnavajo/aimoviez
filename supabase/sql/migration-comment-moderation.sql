-- Comment Moderation Migration
-- Adds moderation status and review workflow to comments

-- Add moderation columns to comments table
ALTER TABLE comments
ADD COLUMN IF NOT EXISTS moderation_status TEXT DEFAULT 'approved'
  CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'flagged'));

ALTER TABLE comments
ADD COLUMN IF NOT EXISTS moderated_by UUID REFERENCES users(id);

ALTER TABLE comments
ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE comments
ADD COLUMN IF NOT EXISTS moderation_reason TEXT;

-- Index for efficient moderation queue queries
CREATE INDEX IF NOT EXISTS idx_comments_moderation_status
  ON comments(moderation_status)
  WHERE moderation_status != 'approved';

CREATE INDEX IF NOT EXISTS idx_comments_pending_moderation
  ON comments(created_at DESC)
  WHERE moderation_status = 'pending';

-- Comment moderation settings (enable/disable auto-approve)
INSERT INTO feature_flags (key, value, description)
VALUES (
  'comment_moderation_enabled',
  'false',
  'When enabled, new comments require admin approval before being visible'
) ON CONFLICT (key) DO NOTHING;

-- View for moderation queue
CREATE OR REPLACE VIEW comment_moderation_queue AS
SELECT
  c.id,
  c.clip_id,
  c.username,
  c.avatar_url,
  c.comment_text,
  c.likes_count,
  c.parent_comment_id,
  c.created_at,
  c.moderation_status,
  c.moderation_reason,
  tc.title as clip_title,
  tc.thumbnail_url as clip_thumbnail
FROM comments c
LEFT JOIN tournament_clips tc ON c.clip_id = tc.id::text
WHERE c.moderation_status IN ('pending', 'flagged')
  AND c.is_deleted = false
ORDER BY
  CASE c.moderation_status
    WHEN 'flagged' THEN 1
    WHEN 'pending' THEN 2
  END,
  c.created_at DESC;

-- Function to approve comment
CREATE OR REPLACE FUNCTION approve_comment(
  p_comment_id UUID,
  p_admin_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE comments
  SET
    moderation_status = 'approved',
    moderated_by = p_admin_id,
    moderated_at = NOW()
  WHERE id = p_comment_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to reject comment
CREATE OR REPLACE FUNCTION reject_comment(
  p_comment_id UUID,
  p_admin_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE comments
  SET
    moderation_status = 'rejected',
    moderated_by = p_admin_id,
    moderated_at = NOW(),
    moderation_reason = p_reason,
    is_deleted = true  -- Also soft-delete rejected comments
  WHERE id = p_comment_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to flag comment for review
CREATE OR REPLACE FUNCTION flag_comment(
  p_comment_id UUID,
  p_reason TEXT DEFAULT 'User reported'
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE comments
  SET
    moderation_status = 'flagged',
    moderation_reason = p_reason
  WHERE id = p_comment_id
    AND moderation_status = 'approved';

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION approve_comment(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_comment(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION flag_comment(UUID, TEXT) TO authenticated;

COMMENT ON COLUMN comments.moderation_status IS 'pending=awaiting review, approved=visible, rejected=hidden, flagged=reported by users';
