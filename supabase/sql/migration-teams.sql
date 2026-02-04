-- ============================================================================
-- DREAM TEAMS - Database Migration
-- Competitive team system with streaks, vote multipliers, and chat
-- ============================================================================

-- ============================================================================
-- TABLES
-- ============================================================================

-- Teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  logo_url TEXT,
  leader_id UUID NOT NULL REFERENCES users(id),
  level INTEGER DEFAULT 1,
  total_xp BIGINT DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_active_date DATE,
  member_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT team_name_length CHECK (char_length(name) >= 2 AND char_length(name) <= 30),
  CONSTRAINT team_description_length CHECK (description IS NULL OR char_length(description) <= 200)
);

-- Team members
CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'officer', 'member')),
  contribution_xp BIGINT DEFAULT 0,
  contribution_votes INTEGER DEFAULT 0,
  last_active_date DATE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, user_id),
  UNIQUE(user_id) -- User can only be in ONE team
);

-- Team invites
CREATE TABLE IF NOT EXISTS team_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES users(id),
  invite_code TEXT UNIQUE NOT NULL,
  max_uses INTEGER DEFAULT 5,
  uses INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team chat messages
CREATE TABLE IF NOT EXISTS team_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT message_length CHECK (char_length(message) >= 1 AND char_length(message) <= 500)
);

-- Track coordinated votes for multiplier
CREATE TABLE IF NOT EXISTS team_vote_coordination (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  clip_id TEXT NOT NULL,
  slot_position INTEGER NOT NULL,
  member_votes INTEGER DEFAULT 1,
  bonus_applied BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, clip_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_teams_leader ON teams(leader_id);
CREATE INDEX IF NOT EXISTS idx_teams_level ON teams(level DESC);
CREATE INDEX IF NOT EXISTS idx_teams_streak ON teams(current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_messages_team ON team_messages(team_id);
CREATE INDEX IF NOT EXISTS idx_team_messages_created ON team_messages(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_team_invites_code ON team_invites(invite_code);
CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id);
CREATE INDEX IF NOT EXISTS idx_team_vote_coord ON team_vote_coordination(team_id, clip_id);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Generate unique invite code
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Update member count trigger
CREATE OR REPLACE FUNCTION update_team_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE teams SET member_count = member_count + 1, updated_at = NOW()
    WHERE id = NEW.team_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE teams SET member_count = member_count - 1, updated_at = NOW()
    WHERE id = OLD.team_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_team_member_count ON team_members;
CREATE TRIGGER trigger_team_member_count
AFTER INSERT OR DELETE ON team_members
FOR EACH ROW EXECUTE FUNCTION update_team_member_count();

-- Get team with full stats
CREATE OR REPLACE FUNCTION get_team_with_stats(p_team_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'id', t.id,
    'name', t.name,
    'description', t.description,
    'logo_url', t.logo_url,
    'leader_id', t.leader_id,
    'level', t.level,
    'total_xp', t.total_xp,
    'current_streak', t.current_streak,
    'longest_streak', t.longest_streak,
    'member_count', t.member_count,
    'created_at', t.created_at,
    'combined_votes', COALESCE(SUM(u.total_votes_cast), 0),
    'combined_wins', (
      SELECT COUNT(*)::INTEGER FROM story_slots ss
      JOIN tournament_clips tc ON ss.winner_tournament_clip_id = tc.id
      JOIN team_members tm2 ON tc.user_id = tm2.user_id
      WHERE tm2.team_id = t.id
    ),
    'members', (
      SELECT json_agg(json_build_object(
        'id', tm.id,
        'user_id', tm.user_id,
        'username', u2.username,
        'avatar_url', u2.avatar_url,
        'role', tm.role,
        'contribution_xp', tm.contribution_xp,
        'contribution_votes', tm.contribution_votes,
        'last_active_date', tm.last_active_date,
        'joined_at', tm.joined_at,
        'level', u2.level
      ) ORDER BY
        CASE tm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
        tm.joined_at
      )
      FROM team_members tm
      JOIN users u2 ON u2.id = tm.user_id
      WHERE tm.team_id = t.id
    )
  ) INTO result
  FROM teams t
  LEFT JOIN team_members tm ON tm.team_id = t.id
  LEFT JOIN users u ON u.id = tm.user_id
  WHERE t.id = p_team_id
  GROUP BY t.id;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Get user's team
CREATE OR REPLACE FUNCTION get_user_team(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  v_team_id UUID;
BEGIN
  SELECT team_id INTO v_team_id FROM team_members WHERE user_id = p_user_id;
  IF v_team_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN get_team_with_stats(v_team_id);
END;
$$ LANGUAGE plpgsql;

-- Create team (atomic)
CREATE OR REPLACE FUNCTION create_team(
  p_name TEXT,
  p_description TEXT,
  p_leader_id UUID
) RETURNS JSON AS $$
DECLARE
  v_team_id UUID;
  v_existing_team UUID;
BEGIN
  -- Check if user already in a team
  SELECT team_id INTO v_existing_team FROM team_members WHERE user_id = p_leader_id;
  IF v_existing_team IS NOT NULL THEN
    RAISE EXCEPTION 'User is already in a team';
  END IF;

  -- Create team
  INSERT INTO teams (name, description, leader_id, member_count)
  VALUES (p_name, p_description, p_leader_id, 0)
  RETURNING id INTO v_team_id;

  -- Add leader as member
  INSERT INTO team_members (team_id, user_id, role, last_active_date)
  VALUES (v_team_id, p_leader_id, 'leader', CURRENT_DATE);

  RETURN get_team_with_stats(v_team_id);
END;
$$ LANGUAGE plpgsql;

-- Join team via invite code
CREATE OR REPLACE FUNCTION join_team_via_code(
  p_user_id UUID,
  p_invite_code TEXT
) RETURNS JSON AS $$
DECLARE
  v_invite RECORD;
  v_existing_team UUID;
  v_member_count INTEGER;
BEGIN
  -- Check if user already in a team
  SELECT team_id INTO v_existing_team FROM team_members WHERE user_id = p_user_id;
  IF v_existing_team IS NOT NULL THEN
    RAISE EXCEPTION 'User is already in a team';
  END IF;

  -- Get invite (lock row to prevent concurrent over-use)
  SELECT * INTO v_invite FROM team_invites
  WHERE invite_code = UPPER(p_invite_code)
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_uses IS NULL OR uses < max_uses)
  FOR UPDATE;

  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invite code';
  END IF;

  -- Check team size (max 5) -- lock row to prevent concurrent over-join
  SELECT member_count INTO v_member_count FROM teams WHERE id = v_invite.team_id FOR UPDATE;
  IF v_member_count >= 5 THEN
    RAISE EXCEPTION 'Team is full (max 5 members)';
  END IF;

  -- Add member
  INSERT INTO team_members (team_id, user_id, role, last_active_date)
  VALUES (v_invite.team_id, p_user_id, 'member', CURRENT_DATE);

  -- Increment invite uses
  UPDATE team_invites SET uses = uses + 1 WHERE id = v_invite.id;

  RETURN get_team_with_stats(v_invite.team_id);
END;
$$ LANGUAGE plpgsql;

-- Leave team
CREATE OR REPLACE FUNCTION leave_team(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_membership RECORD;
  v_new_leader UUID;
BEGIN
  -- Get membership
  SELECT tm.*, t.id as team_id_check FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE tm.user_id = p_user_id
  INTO v_membership;

  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'User is not in a team';
  END IF;

  -- If leader, transfer or disband
  IF v_membership.role = 'leader' THEN
    -- Find new leader (oldest officer, then oldest member)
    SELECT user_id INTO v_new_leader
    FROM team_members
    WHERE team_id = v_membership.team_id AND user_id != p_user_id
    ORDER BY
      CASE role WHEN 'officer' THEN 0 ELSE 1 END,
      joined_at
    LIMIT 1;

    IF v_new_leader IS NOT NULL THEN
      -- Transfer leadership
      UPDATE team_members SET role = 'leader' WHERE user_id = v_new_leader;
      UPDATE teams SET leader_id = v_new_leader WHERE id = v_membership.team_id;
    ELSE
      -- Disband team (no other members)
      DELETE FROM teams WHERE id = v_membership.team_id;
      RETURN TRUE;
    END IF;
  END IF;

  -- Remove member
  DELETE FROM team_members WHERE user_id = p_user_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Check and track team vote coordination
CREATE OR REPLACE FUNCTION track_team_vote(
  p_user_id UUID,
  p_clip_id TEXT,
  p_slot_position INTEGER
) RETURNS JSON AS $$
DECLARE
  v_team_id UUID;
  v_member_count INTEGER;
  v_result JSON;
BEGIN
  -- Get user's team
  SELECT team_id INTO v_team_id FROM team_members WHERE user_id = p_user_id;
  IF v_team_id IS NULL THEN
    RETURN json_build_object('has_team', false, 'multiplier', 1.0);
  END IF;

  -- Upsert coordination record
  INSERT INTO team_vote_coordination (team_id, clip_id, slot_position, member_votes)
  VALUES (v_team_id, p_clip_id, p_slot_position, 1)
  ON CONFLICT (team_id, clip_id)
  DO UPDATE SET
    member_votes = team_vote_coordination.member_votes + 1,
    updated_at = NOW()
  RETURNING member_votes INTO v_member_count;

  -- Update member's activity and contribution
  UPDATE team_members
  SET last_active_date = CURRENT_DATE,
      contribution_votes = contribution_votes + 1
  WHERE user_id = p_user_id;

  -- Return coordination info
  RETURN json_build_object(
    'has_team', true,
    'team_id', v_team_id,
    'member_votes', v_member_count,
    'multiplier', CASE WHEN v_member_count >= 3 THEN 1.5 ELSE 1.0 END,
    'threshold_reached', v_member_count >= 3
  );
END;
$$ LANGUAGE plpgsql;

-- Get team leaderboard
CREATE OR REPLACE FUNCTION get_team_leaderboard(
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSON AS $$
BEGIN
  RETURN (
    SELECT json_agg(team_row)
    FROM (
      SELECT
        t.id,
        t.name,
        t.logo_url,
        t.level,
        t.total_xp,
        t.current_streak,
        t.member_count,
        COALESCE(SUM(u.total_votes_cast), 0)::INTEGER as combined_votes,
        (
          SELECT COUNT(*)::INTEGER FROM story_slots ss
          JOIN tournament_clips tc ON ss.winner_tournament_clip_id = tc.id
          JOIN team_members tm2 ON tc.user_id = tm2.user_id
          WHERE tm2.team_id = t.id
        ) as combined_wins,
        ROW_NUMBER() OVER (ORDER BY t.total_xp DESC, t.current_streak DESC) as rank
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN users u ON u.id = tm.user_id
      GROUP BY t.id
      ORDER BY t.total_xp DESC, t.current_streak DESC
      LIMIT p_limit OFFSET p_offset
    ) team_row
  );
END;
$$ LANGUAGE plpgsql;

-- Update team streaks (call from cron daily)
CREATE OR REPLACE FUNCTION update_all_team_streaks()
RETURNS void AS $$
DECLARE
  team_record RECORD;
  all_members_active BOOLEAN;
BEGIN
  FOR team_record IN SELECT id, current_streak, last_active_date FROM teams LOOP
    -- Check if ALL members were active yesterday or today
    SELECT bool_and(last_active_date >= CURRENT_DATE - INTERVAL '1 day')
    INTO all_members_active
    FROM team_members
    WHERE team_id = team_record.id;

    IF all_members_active AND (team_record.last_active_date IS NULL OR team_record.last_active_date < CURRENT_DATE) THEN
      -- Increment streak
      UPDATE teams SET
        current_streak = current_streak + 1,
        longest_streak = GREATEST(longest_streak, current_streak + 1),
        last_active_date = CURRENT_DATE,
        updated_at = NOW()
      WHERE id = team_record.id;
    ELSIF NOT COALESCE(all_members_active, FALSE) AND (team_record.last_active_date IS NULL OR team_record.last_active_date < CURRENT_DATE - INTERVAL '1 day') THEN
      -- Reset streak if any member missed more than 1 day
      UPDATE teams SET
        current_streak = 0,
        updated_at = NOW()
      WHERE id = team_record.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Add XP to team (and track contribution)
CREATE OR REPLACE FUNCTION add_team_xp(
  p_user_id UUID,
  p_xp_amount INTEGER
) RETURNS void AS $$
DECLARE
  v_team_id UUID;
BEGIN
  SELECT team_id INTO v_team_id FROM team_members WHERE user_id = p_user_id;
  IF v_team_id IS NULL THEN RETURN; END IF;

  -- Update team total XP
  UPDATE teams SET total_xp = total_xp + p_xp_amount, updated_at = NOW()
  WHERE id = v_team_id;

  -- Update member contribution
  UPDATE team_members SET contribution_xp = contribution_xp + p_xp_amount
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_vote_coordination ENABLE ROW LEVEL SECURITY;

-- Teams: Anyone can read, only leader can update
CREATE POLICY "Teams are viewable by everyone" ON teams FOR SELECT USING (true);
CREATE POLICY "Team leader can update" ON teams FOR UPDATE USING (auth.uid() = leader_id);

-- Team members: Anyone can read, system manages inserts/deletes
CREATE POLICY "Team members are viewable by everyone" ON team_members FOR SELECT USING (true);

-- Team invites: Only team members can view their team's invites
CREATE POLICY "Team invites viewable by team members" ON team_invites FOR SELECT
  USING (EXISTS (SELECT 1 FROM team_members WHERE team_id = team_invites.team_id AND user_id = auth.uid()));

-- Team messages: viewable for realtime subscriptions (API enforces membership checks)
CREATE POLICY "Team messages viewable by team members" ON team_messages FOR SELECT
  USING (true);
CREATE POLICY "Team members can send messages" ON team_messages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM team_members WHERE team_id = team_messages.team_id AND user_id = auth.uid()));

-- Vote coordination: System managed
CREATE POLICY "Vote coordination viewable by team members" ON team_vote_coordination FOR SELECT
  USING (EXISTS (SELECT 1 FROM team_members WHERE team_id = team_vote_coordination.team_id AND user_id = auth.uid()));

-- ============================================================================
-- ENABLE REALTIME
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE team_members;
