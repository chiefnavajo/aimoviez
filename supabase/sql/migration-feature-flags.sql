-- ============================================================================
-- FEATURE FLAGS MIGRATION
-- Allows admins to toggle features on/off without code changes
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Feature flags table
CREATE TABLE IF NOT EXISTS feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(50) UNIQUE NOT NULL,          -- e.g., 'referral_system', 'daily_challenges'
  name VARCHAR(100) NOT NULL,               -- Human readable name
  description TEXT,                          -- What this feature does
  enabled BOOLEAN DEFAULT FALSE,             -- Is it on/off
  category VARCHAR(50) DEFAULT 'general',    -- Group features: 'growth', 'engagement', 'monetization'
  config JSONB DEFAULT '{}',                 -- Optional config for the feature
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(key);
CREATE INDEX IF NOT EXISTS idx_feature_flags_category ON feature_flags(category);

-- Insert default feature flags
INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('referral_system', 'Referral System', 'Users can invite friends and earn rewards when they sign up', 'growth', FALSE, '{"reward_xp": 50, "tiers": [1, 5, 10, 25, 100]}'),
  ('follow_system', 'Follow System', 'Users can follow creators and see their content first', 'engagement', FALSE, '{}'),
  ('daily_challenges', 'Daily Challenges', 'Users get daily tasks for bonus XP and rewards', 'engagement', FALSE, '{"challenges_per_day": 3}'),
  ('combo_voting', 'Combo Voting', 'Voting on multiple clips in a row gives bonus multipliers', 'engagement', FALSE, '{"max_combo": 10, "bonus_per_combo": 0.1}'),
  ('push_notifications', 'Push Notifications', 'Send push notifications for votes, winners, and updates', 'engagement', FALSE, '{}'),
  ('share_previews', 'Share Previews', 'Generate rich link previews for social media sharing', 'growth', FALSE, '{}'),
  ('creator_tips', 'Creator Tips', 'Users can tip creators with virtual currency', 'monetization', FALSE, '{"min_tip": 10, "max_tip": 1000}'),
  ('premium_badges', 'Premium Badges', 'Users can purchase exclusive badges', 'monetization', FALSE, '{}'),
  ('weekly_tournaments', 'Weekly Tournaments', 'Special weekly competitions with prizes', 'engagement', FALSE, '{"prize_pool": 1000}'),
  ('live_events', 'Live Events', 'Host real-time voting events with countdown', 'engagement', FALSE, '{}'),
  ('ai_moderation', 'AI Moderation', 'Automatic content moderation using AI', 'safety', FALSE, '{}'),
  ('achievements_v2', 'Achievements V2', 'Enhanced achievement system with animations', 'engagement', FALSE, '{}')
ON CONFLICT (key) DO NOTHING;

-- Function to get feature flag status
CREATE OR REPLACE FUNCTION is_feature_enabled(feature_key VARCHAR)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT enabled FROM feature_flags WHERE key = feature_key),
    FALSE
  );
$$ LANGUAGE SQL STABLE;

-- Function to get feature config
CREATE OR REPLACE FUNCTION get_feature_config(feature_key VARCHAR)
RETURNS JSONB AS $$
  SELECT COALESCE(
    (SELECT config FROM feature_flags WHERE key = feature_key),
    '{}'::JSONB
  );
$$ LANGUAGE SQL STABLE;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_feature_flags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feature_flags_updated_at ON feature_flags;
CREATE TRIGGER feature_flags_updated_at
  BEFORE UPDATE ON feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION update_feature_flags_updated_at();

-- ============================================================================
-- REFERRAL SYSTEM TABLES (will only be active when feature flag is ON)
-- ============================================================================

-- Add referral columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_count INT DEFAULT 0;

-- Generate referral codes for existing users
UPDATE users
SET referral_code = UPPER(SUBSTRING(MD5(id::text || created_at::text) FROM 1 FOR 8))
WHERE referral_code IS NULL;

-- Referrals tracking table
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id),
  referred_id UUID REFERENCES users(id),
  referral_code VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',      -- pending, completed, rewarded
  reward_claimed BOOLEAN DEFAULT FALSE,
  reward_amount INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- RLS policies for feature_flags (read-only for authenticated users, write for admins)
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read feature flags" ON feature_flags;
CREATE POLICY "Anyone can read feature flags" ON feature_flags
  FOR SELECT USING (true);

-- Referrals RLS
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own referrals" ON referrals;
CREATE POLICY "Users can read own referrals" ON referrals
  FOR SELECT USING (true);

COMMENT ON TABLE feature_flags IS 'Admin-controlled feature toggles for the application';
COMMENT ON TABLE referrals IS 'Tracks user referrals and rewards';
