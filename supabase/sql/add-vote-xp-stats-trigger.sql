-- Trigger: Increment user stats and XP when a vote is cast
-- - Increments total_votes_cast for the voter (if authenticated)
-- - Increments total_votes_received for the clip owner
-- - Awards 10 XP to the voter per vote cast

CREATE OR REPLACE FUNCTION update_user_stats_on_vote()
RETURNS TRIGGER AS $$
DECLARE
  v_voter_uuid UUID;
  v_clip_owner_id UUID;
BEGIN
  -- 1. Update voter stats (only for authenticated users with user_id)
  IF NEW.user_id IS NOT NULL AND NEW.user_id != '' THEN
    BEGIN
      v_voter_uuid := NEW.user_id::UUID;

      -- Increment total_votes_cast
      UPDATE users
      SET total_votes_cast = COALESCE(total_votes_cast, 0) + 1,
          updated_at = NOW()
      WHERE id = v_voter_uuid;

      -- Award XP (10 per vote)
      PERFORM add_user_xp(v_voter_uuid, 10);
    EXCEPTION WHEN OTHERS THEN
      -- Non-fatal: log and continue if user_id is invalid
      RAISE WARNING '[update_user_stats_on_vote] Failed to update voter stats for user_id=%: %', NEW.user_id, SQLERRM;
    END;
  END IF;

  -- 2. Update clip owner's total_votes_received
  BEGIN
    SELECT user_id INTO v_clip_owner_id
    FROM tournament_clips
    WHERE id = NEW.clip_id;

    IF v_clip_owner_id IS NOT NULL THEN
      UPDATE users
      SET total_votes_received = COALESCE(total_votes_received, 0) + 1,
          updated_at = NOW()
      WHERE id = v_clip_owner_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[update_user_stats_on_vote] Failed to update clip owner stats for clip_id=%: %', NEW.clip_id, SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS on_vote_update_user_stats ON votes;

-- Create the trigger
CREATE TRIGGER on_vote_update_user_stats
AFTER INSERT ON votes
FOR EACH ROW
EXECUTE FUNCTION update_user_stats_on_vote();

-- Also handle vote deletion: decrement stats
CREATE OR REPLACE FUNCTION update_user_stats_on_vote_delete()
RETURNS TRIGGER AS $$
DECLARE
  v_voter_uuid UUID;
  v_clip_owner_id UUID;
BEGIN
  -- 1. Decrement voter stats
  IF OLD.user_id IS NOT NULL AND OLD.user_id != '' THEN
    BEGIN
      v_voter_uuid := OLD.user_id::UUID;

      UPDATE users
      SET total_votes_cast = GREATEST(0, COALESCE(total_votes_cast, 0) - 1),
          updated_at = NOW()
      WHERE id = v_voter_uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[update_user_stats_on_vote_delete] Failed for user_id=%: %', OLD.user_id, SQLERRM;
    END;
  END IF;

  -- 2. Decrement clip owner's total_votes_received
  BEGIN
    SELECT user_id INTO v_clip_owner_id
    FROM tournament_clips
    WHERE id = OLD.clip_id;

    IF v_clip_owner_id IS NOT NULL THEN
      UPDATE users
      SET total_votes_received = GREATEST(0, COALESCE(total_votes_received, 0) - 1),
          updated_at = NOW()
      WHERE id = v_clip_owner_id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[update_user_stats_on_vote_delete] Failed for clip_id=%: %', OLD.clip_id, SQLERRM;
  END;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_vote_delete_update_user_stats ON votes;

CREATE TRIGGER on_vote_delete_update_user_stats
AFTER DELETE ON votes
FOR EACH ROW
EXECUTE FUNCTION update_user_stats_on_vote_delete();
