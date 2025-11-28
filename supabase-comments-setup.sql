-- ============================================================================
-- COMMENTS SYSTEM TABLES
-- Run this in Supabase SQL Editor if tables don't exist
-- ============================================================================

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID NOT NULL,
  user_key TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_url TEXT,
  comment_text TEXT NOT NULL,
  likes_count INTEGER DEFAULT 0,
  parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Comment likes table (tracks who liked what)
CREATE TABLE IF NOT EXISTS comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(comment_id, user_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_comments_clip_id ON comments(clip_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user_key ON comment_likes(user_key);

-- Enable RLS (Row Level Security)
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;

-- Policies for public read access
CREATE POLICY IF NOT EXISTS "Comments are viewable by everyone" 
  ON comments FOR SELECT 
  USING (true);

CREATE POLICY IF NOT EXISTS "Comment likes are viewable by everyone" 
  ON comment_likes FOR SELECT 
  USING (true);

-- Policies for authenticated insert/update/delete via service role
-- (Your API uses service role key, so these are just for safety)
CREATE POLICY IF NOT EXISTS "Service role can insert comments" 
  ON comments FOR INSERT 
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can update comments" 
  ON comments FOR UPDATE 
  USING (true);

CREATE POLICY IF NOT EXISTS "Service role can insert likes" 
  ON comment_likes FOR INSERT 
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Service role can delete likes" 
  ON comment_likes FOR DELETE 
  USING (true);
