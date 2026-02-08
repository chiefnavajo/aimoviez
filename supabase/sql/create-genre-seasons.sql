-- Create initial genre seasons (run AFTER add-genre-to-seasons.sql)
-- Creates one active season per launch genre with 75 story slots each

-- Step 1: Create seasons for launch genres (Action, Comedy, Horror, Animation)
-- Note: The existing active season should already have genre='action' from the migration
INSERT INTO seasons (label, genre, status, total_slots, created_at) VALUES
  ('Comedy Season 1', 'comedy', 'active', 75, NOW()),
  ('Horror Season 1', 'horror', 'active', 75, NOW()),
  ('Animation Season 1', 'animation', 'active', 75, NOW())
ON CONFLICT DO NOTHING;

-- Step 2: Create 75 story slots for each new season
-- Function to create slots for a season
CREATE OR REPLACE FUNCTION create_season_slots_for_genre(p_genre TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_season_id UUID;
  v_count INTEGER;
BEGIN
  -- Get the season ID for this genre
  SELECT id INTO v_season_id
  FROM seasons
  WHERE genre = p_genre AND status = 'active'
  LIMIT 1;

  IF v_season_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Check if slots already exist
  SELECT COUNT(*) INTO v_count
  FROM story_slots
  WHERE season_id = v_season_id;

  IF v_count > 0 THEN
    RETURN v_count; -- Already has slots
  END IF;

  -- Create 75 slots
  INSERT INTO story_slots (season_id, slot_position, status, genre, created_at)
  SELECT
    v_season_id,
    pos,
    CASE WHEN pos = 1 THEN 'waiting_for_clips' ELSE 'upcoming' END,
    p_genre,
    NOW()
  FROM generate_series(1, 75) AS pos;

  RETURN 75;
END;
$$ LANGUAGE plpgsql;

-- Create slots for each genre
SELECT create_season_slots_for_genre('comedy');
SELECT create_season_slots_for_genre('horror');
SELECT create_season_slots_for_genre('animation');

-- Clean up function (optional)
-- DROP FUNCTION IF EXISTS create_season_slots_for_genre(TEXT);

-- Verification:
-- SELECT s.label, s.genre, COUNT(ss.id) as slot_count
-- FROM seasons s
-- LEFT JOIN story_slots ss ON ss.season_id = s.id
-- WHERE s.status = 'active'
-- GROUP BY s.id, s.label, s.genre;
