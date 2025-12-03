-- Add vote flagging for fraud detection
-- This column tracks suspicious votes for later review

-- Add flagged column to votes table
ALTER TABLE votes ADD COLUMN IF NOT EXISTS flagged BOOLEAN DEFAULT FALSE;

-- Add index for querying flagged votes
CREATE INDEX IF NOT EXISTS idx_votes_flagged ON votes(flagged) WHERE flagged = TRUE;

-- Create a view for admin to review flagged votes
CREATE OR REPLACE VIEW flagged_votes_summary AS
SELECT
  v.id,
  v.clip_id,
  v.voter_key,
  v.vote_type,
  v.vote_weight,
  v.created_at,
  v.flagged,
  tc.username AS clip_owner,
  tc.video_url
FROM votes v
LEFT JOIN tournament_clips tc ON v.clip_id = tc.id
WHERE v.flagged = TRUE
ORDER BY v.created_at DESC;

-- Grant access to the view
GRANT SELECT ON flagged_votes_summary TO authenticated;
