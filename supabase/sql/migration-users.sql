-- ============================================================================
-- USERS TABLE MIGRATION
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id TEXT UNIQUE,
  email TEXT UNIQUE,
  device_key TEXT,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  total_votes_cast INTEGER DEFAULT 0,
  total_votes_received INTEGER DEFAULT 0,
  clips_uploaded INTEGER DEFAULT 0,
  clips_locked INTEGER DEFAULT 0,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,
  is_banned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT username_length CHECK (length(username) >= 3 AND length(username) <= 20),
  CONSTRAINT username_format CHECK (username ~ '^[a-z0-9_]+$'),
  CONSTRAINT bio_length CHECK (bio IS NULL OR length(bio) <= 150)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_device_key ON users(device_key);
CREATE INDEX IF NOT EXISTS idx_users_level ON users(level DESC);
CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC);

-- Followers table
CREATE TABLE IF NOT EXISTS followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- One follow relationship per pair
  UNIQUE(follower_id, following_id),
  
  -- Can't follow yourself
  CONSTRAINT no_self_follow CHECK (follower_id != following_id)
);

CREATE INDEX IF NOT EXISTS idx_followers_follower ON followers(follower_id);
CREATE INDEX IF NOT EXISTS idx_followers_following ON followers(following_id);

-- Function to update followers count
CREATE OR REPLACE FUNCTION update_followers_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Increment follower's following_count
    UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    -- Increment target's followers_count
    UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Decrement follower's following_count
    UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = OLD.follower_id;
    -- Decrement target's followers_count
    UPDATE users SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = OLD.following_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger for followers count
DROP TRIGGER IF EXISTS followers_count_trigger ON followers;
CREATE TRIGGER followers_count_trigger
  AFTER INSERT OR DELETE ON followers
  FOR EACH ROW
  EXECUTE FUNCTION update_followers_count();

-- Function to update updated_at
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS users_updated_at_trigger ON users;
CREATE TRIGGER users_updated_at_trigger
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_users_updated_at();

-- XP and Level calculation function
-- Level formula: level = floor(sqrt(xp / 100)) + 1
CREATE OR REPLACE FUNCTION calculate_level(xp_amount INTEGER)
RETURNS INTEGER AS $$
BEGIN
  RETURN GREATEST(1, floor(sqrt(xp_amount / 100.0)) + 1);
END;
$$ LANGUAGE plpgsql;

-- Function to add XP and update level
CREATE OR REPLACE FUNCTION add_user_xp(user_id UUID, xp_to_add INTEGER)
RETURNS TABLE(new_xp INTEGER, new_level INTEGER, level_up BOOLEAN) AS $$
DECLARE
  old_level INTEGER;
  updated_xp INTEGER;
  updated_level INTEGER;
BEGIN
  -- Get current level
  SELECT level INTO old_level FROM users WHERE id = user_id;
  
  -- Update XP
  UPDATE users 
  SET xp = xp + xp_to_add,
      level = calculate_level(xp + xp_to_add)
  WHERE id = user_id
  RETURNING xp, level INTO updated_xp, updated_level;
  
  RETURN QUERY SELECT updated_xp, updated_level, updated_level > old_level;
END;
$$ LANGUAGE plpgsql;

-- Comments on tables
COMMENT ON TABLE users IS 'User profiles for the app';
COMMENT ON COLUMN users.device_key IS 'Hashed device identifier for anonymous users';
COMMENT ON COLUMN users.google_id IS 'Google OAuth ID for authenticated users';
COMMENT ON COLUMN users.xp IS 'Experience points earned from activities';
COMMENT ON COLUMN users.level IS 'User level calculated from XP';

COMMENT ON TABLE followers IS 'Follow relationships between users';
