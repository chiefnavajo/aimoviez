-- =============================================================================
-- MIGRATION: User Characters (Personal Character Upload)
-- Allows users to upload their own face photos for AI video generation
-- =============================================================================

-- 1. Create user_characters table
CREATE TABLE IF NOT EXISTS user_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(100) NOT NULL,
  frontal_image_url TEXT NOT NULL,
  reference_image_urls TEXT[] DEFAULT '{}',
  appearance_description VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup of active characters per user
CREATE INDEX IF NOT EXISTS idx_user_chars_user_active
  ON user_characters(user_id) WHERE is_active = true;

-- 2. Trigger: Max 10 active characters per user
CREATE OR REPLACE FUNCTION check_max_user_characters()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    SELECT COUNT(*) FROM user_characters
    WHERE user_id = NEW.user_id AND is_active = true
  ) >= 10 THEN
    RAISE EXCEPTION 'Maximum 10 active characters per user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_max_user_characters ON user_characters;
CREATE TRIGGER trg_max_user_characters
  BEFORE INSERT ON user_characters
  FOR EACH ROW
  WHEN (NEW.is_active = true)
  EXECUTE FUNCTION check_max_user_characters();

-- 3. RPC: Atomic append reference angle (with ownership check)
CREATE OR REPLACE FUNCTION append_user_character_angle(
  p_id UUID,
  p_user_id UUID,
  p_url TEXT,
  p_max_refs INTEGER DEFAULT 6
)
RETURNS TABLE(id UUID, reference_image_urls TEXT[]) AS $$
BEGIN
  RETURN QUERY
  UPDATE user_characters
  SET
    reference_image_urls = array_append(reference_image_urls, p_url),
    updated_at = NOW()
  WHERE user_characters.id = p_id
    AND user_characters.user_id = p_user_id
    AND user_characters.is_active = true
    AND array_length(reference_image_urls, 1) IS DISTINCT FROM p_max_refs
    AND (array_length(reference_image_urls, 1) IS NULL OR array_length(reference_image_urls, 1) < p_max_refs)
  RETURNING user_characters.id, user_characters.reference_image_urls;
END;
$$ LANGUAGE plpgsql;

-- 4. RPC: Increment usage count for user characters (batch)
CREATE OR REPLACE FUNCTION increment_user_char_usage(p_ids UUID[])
RETURNS VOID AS $$
BEGIN
  UPDATE user_characters
  SET usage_count = usage_count + 1, updated_at = NOW()
  WHERE id = ANY(p_ids);
END;
$$ LANGUAGE plpgsql;

-- 5. Add user_character_ids column to ai_generations
ALTER TABLE ai_generations
  ADD COLUMN IF NOT EXISTS user_character_ids UUID[];

-- 6. Feature flag
INSERT INTO feature_flags (key, name, description, category, enabled)
VALUES (
  'user_characters',
  'User Characters',
  'Allow users to upload personal character photos for AI video generation',
  'ai',
  false
)
ON CONFLICT (key) DO NOTHING;

-- 7. RLS policies
ALTER TABLE user_characters ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by API routes)
CREATE POLICY "Service role full access on user_characters"
  ON user_characters
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Users can read their own characters
CREATE POLICY "Users can read own characters"
  ON user_characters
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON user_characters TO service_role;
GRANT EXECUTE ON FUNCTION append_user_character_angle TO service_role;
GRANT EXECUTE ON FUNCTION increment_user_char_usage TO service_role;
