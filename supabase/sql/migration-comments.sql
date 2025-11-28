-- Comments Table Migration
-- Stores comments on clips

-- Create comments table
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_url TEXT,
  comment_text TEXT NOT NULL,
  likes_count INTEGER DEFAULT 0,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE,
  
  -- Ensure comment is not empty
  CONSTRAINT comment_not_empty CHECK (length(trim(comment_text)) > 0),
  
  -- Ensure reasonable length
  CONSTRAINT comment_max_length CHECK (length(comment_text) <= 500)
);

-- Create indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_comments_clip_id ON comments(clip_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_key ON comments(user_key);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_likes ON comments(likes_count DESC);

-- Create comment_likes table for tracking who liked what
CREATE TABLE IF NOT EXISTS comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- One like per user per comment
  UNIQUE(comment_id, user_key)
);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user_key ON comment_likes(user_key);

-- Add comments
COMMENT ON TABLE comments IS 'Stores comments on clips';
COMMENT ON COLUMN comments.clip_id IS 'ID of the clip being commented on';
COMMENT ON COLUMN comments.user_key IS 'Hashed device identifier or user ID';
COMMENT ON COLUMN comments.username IS 'Display name of commenter';
COMMENT ON COLUMN comments.comment_text IS 'The comment content';
COMMENT ON COLUMN comments.likes_count IS 'Number of likes on this comment';
COMMENT ON COLUMN comments.parent_comment_id IS 'For replies - ID of parent comment';
COMMENT ON COLUMN comments.is_deleted IS 'Soft delete flag';

COMMENT ON TABLE comment_likes IS 'Tracks which users liked which comments';

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER comments_updated_at_trigger
  BEFORE UPDATE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION update_comments_updated_at();

-- Function to update likes_count when comment_likes changes
CREATE OR REPLACE FUNCTION update_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE comments SET likes_count = likes_count - 1 WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update likes_count
CREATE TRIGGER comment_likes_count_trigger
  AFTER INSERT OR DELETE ON comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_comment_likes_count();

-- Grant permissions (adjust as needed)
-- ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

-- Example RLS policies:
-- CREATE POLICY "Anyone can view comments" ON comments
--   FOR SELECT
--   USING (NOT is_deleted);

-- CREATE POLICY "Users can insert their own comments" ON comments
--   FOR INSERT
--   WITH CHECK (user_key = current_setting('request.jwt.claim.user_key', true));

-- CREATE POLICY "Users can update their own comments" ON comments
--   FOR UPDATE
--   USING (user_key = current_setting('request.jwt.claim.user_key', true));

-- CREATE POLICY "Users can delete their own comments" ON comments
--   FOR DELETE
--   USING (user_key = current_setting('request.jwt.claim.user_key', true));
