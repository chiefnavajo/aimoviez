-- Genre Votes Table Migration
-- This table stores user votes for the next season's genre

-- Create genre_votes table
CREATE TABLE IF NOT EXISTS genre_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_key TEXT NOT NULL,
  genre TEXT NOT NULL CHECK (genre IN ('Thriller', 'Comedy', 'Action', 'Sci-Fi', 'Romance', 'Animation', 'Horror')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- One vote per voter_key (user can change their vote)
  UNIQUE(voter_key)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_genre_votes_voter_key ON genre_votes(voter_key);
CREATE INDEX IF NOT EXISTS idx_genre_votes_genre ON genre_votes(genre);
CREATE INDEX IF NOT EXISTS idx_genre_votes_created_at ON genre_votes(created_at DESC);

-- Add comments
COMMENT ON TABLE genre_votes IS 'Stores user votes for next season genre selection';
COMMENT ON COLUMN genre_votes.voter_key IS 'Hashed device identifier (IP + User-Agent)';
COMMENT ON COLUMN genre_votes.genre IS 'Selected genre for next season';
COMMENT ON COLUMN genre_votes.created_at IS 'When vote was first cast';
COMMENT ON COLUMN genre_votes.updated_at IS 'When vote was last changed';

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_genre_votes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER genre_votes_updated_at_trigger
  BEFORE UPDATE ON genre_votes
  FOR EACH ROW
  EXECUTE FUNCTION update_genre_votes_updated_at();

-- Grant permissions (adjust as needed for your setup)
-- ALTER TABLE genre_votes ENABLE ROW LEVEL SECURITY;

-- Example: Allow public read access (for showing results)
-- CREATE POLICY "Allow public read access" ON genre_votes
--   FOR SELECT
--   USING (true);

-- Example: Allow insert/update based on voter_key
-- CREATE POLICY "Allow users to manage their own votes" ON genre_votes
--   FOR ALL
--   USING (voter_key = current_setting('request.jwt.claim.voter_key', true));
