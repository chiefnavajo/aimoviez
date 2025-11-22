ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS user_id text,
  ADD COLUMN IF NOT EXISTS voter_key text,
  ADD COLUMN IF NOT EXISTS vote_weight integer DEFAULT 1;

ALTER TABLE votes
  DROP CONSTRAINT IF EXISTS votes_clip_id_fkey;

DROP INDEX IF EXISTS idx_votes_voter_clip;
