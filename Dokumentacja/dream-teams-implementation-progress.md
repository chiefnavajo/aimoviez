# Dream Teams Implementation Progress

**Last Updated:** 2026-02-03
**Status:** Phase 1 & 2 Complete, Phases 3-5 Pending

---

## Overview

Competitive team system where 3-5 users form teams, share XP, get vote multipliers when coordinating, and compete on team leaderboards.

---

## Completed

### Phase 1: Database & Core API

**SQL Migration:** `supabase/sql/migration-teams.sql`

Tables created:
- `teams` - Team info, level, XP, streaks
- `team_members` - Membership with roles (leader/officer/member)
- `team_invites` - Invite codes with expiration and max uses
- `team_messages` - Team chat messages
- `team_vote_coordination` - Track coordinated votes for multiplier

RPC Functions:
- `create_team` - Create team and set creator as leader
- `join_team_via_code` - Join team via invite code
- `leave_team` - Leave team (disbands if leader)
- `track_team_vote` - Track votes for multiplier calculation
- `get_team_with_stats` - Get team details with aggregated stats
- `get_team_leaderboard` - Ranked teams list
- `update_all_team_streaks` - Daily cron job for streak updates
- `generate_invite_code` - Generate unique invite codes

**API Endpoints:**

| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api/teams` | GET, POST | List teams / Create team |
| `/api/teams/[id]` | GET, PATCH, DELETE | Team details / Update / Disband |
| `/api/teams/[id]/members` | GET, DELETE, PATCH | List / Kick / Promote members |
| `/api/teams/[id]/invites` | GET, POST, DELETE | List / Create / Revoke invites |
| `/api/teams/[id]/messages` | GET, POST | Get / Send chat messages |
| `/api/teams/join` | POST | Join team via invite code |

### Phase 2: Frontend Components & Pages

**Types:** `src/types/index.ts`
- `TeamRole`, `TeamMember`, `Team`, `TeamWithStats`
- `TeamInvite`, `TeamMessage`, `TeamLeaderboardEntry`

**Hooks:** `src/hooks/`
- `useTeam.ts` - All team queries and mutations
- `useTeamChat.ts` - Real-time chat with Supabase Realtime

**Components:** `src/components/team/`
- `TeamStreakBadge.tsx` - Animated streak display with fire icon
- `TeamMemberCard.tsx` - Member card with role icons and actions
- `TeamMemberList.tsx` - Full member list with kick/promote
- `TeamChat.tsx` - Real-time chat with message bubbles
- `TeamCard.tsx` - Team card for leaderboard display
- `TeamCreateModal.tsx` - Create team form
- `TeamJoinModal.tsx` - Join via code input
- `TeamInviteModal.tsx` - Generate and share invite links
- `TeamDashboard.tsx` - Main team view with stats, tabs

**Pages:** `src/app/`
- `/team` - Team dashboard (if in team) or create/join options
- `/team/join` - Handle invite links with `?code=XXX`
- `/teams` - Team leaderboard

**Navigation:**
- Added "Team" tab to `BottomNavigation.tsx`

---

## Pending

### Phase 3: Testing & Polish
- [ ] Run SQL migration in Supabase
- [ ] Test team creation flow
- [ ] Test invite code generation and joining
- [ ] Test member management (kick, promote)
- [ ] Test team chat real-time updates
- [ ] Test leaderboard display

### Phase 4: Vote Integration
- [ ] Modify `/api/vote/route.ts` to check team membership
- [ ] Call `track_team_vote` RPC on each vote
- [ ] Apply 1.5x multiplier when 3+ members vote same clip
- [ ] Add visual feedback for coordinated votes

### Phase 5: Streaks & Cron
- [ ] Set up daily cron job for `update_all_team_streaks`
- [ ] Add streak notifications
- [ ] Add streak milestone rewards (optional)

---

## Key Features

### Vote Multiplier
When 3+ team members vote for the same clip in the same slot, each vote counts as 1.5x. This encourages coordination and team play.

### Team Streaks
- Streak increments when ALL members are active in a day
- Streak resets to 0 if ANY member misses a day
- Creates social obligation to stay active

### Roles
- **Leader:** Full control, can disband team
- **Officer:** Can kick members, manage invites
- **Member:** Basic participation

### Limits
- Max 5 members per team
- User can only be in ONE team at a time
- Invite codes expire after 7 days, max 5 uses each

---

## Files Reference

```
src/
├── app/
│   ├── api/teams/
│   │   ├── route.ts
│   │   ├── join/route.ts
│   │   └── [id]/
│   │       ├── route.ts
│   │       ├── members/route.ts
│   │       ├── invites/route.ts
│   │       └── messages/route.ts
│   ├── team/
│   │   ├── page.tsx
│   │   └── join/page.tsx
│   └── teams/
│       └── page.tsx
├── components/
│   └── team/
│       ├── index.ts
│       ├── TeamCard.tsx
│       ├── TeamChat.tsx
│       ├── TeamCreateModal.tsx
│       ├── TeamDashboard.tsx
│       ├── TeamInviteModal.tsx
│       ├── TeamJoinModal.tsx
│       ├── TeamMemberCard.tsx
│       ├── TeamMemberList.tsx
│       └── TeamStreakBadge.tsx
├── hooks/
│   ├── useTeam.ts
│   └── useTeamChat.ts
└── types/
    └── index.ts (Team types added)

supabase/
└── sql/
    └── migration-teams.sql
```

---

## Complete User Flow (How Dream Teams Works)

### 1. User Has No Team

When a user taps the **Team** tab in the bottom navigation:
- They land on `/team` and see a hero screen explaining Dream Teams
- Two options: **Create a Team** or **Join a Team**
- Benefits listed: vote multiplier, streaks, leaderboard, chat

### 2. Creating a Team

1. User taps "Create a Team" → `TeamCreateModal` opens
2. Enters team name (2-30 chars) and optional description (200 chars max)
3. Submits → `POST /api/teams` → calls `create_team` RPC
4. RPC creates the team row AND inserts the user as `leader` in `team_members`
5. User is redirected to their new Team Dashboard
6. They are now the **leader** with full control

### 3. Inviting Members

1. Leader (or any member) taps "Invite Members" → `TeamInviteModal` opens
2. Taps "Generate New Invite Link" → `POST /api/teams/[id]/invites`
3. Server generates a unique 8-character code (e.g. `K7XP3NVR`)
4. Creates an invite record with: max 5 uses, expires in 7 days
5. Returns a shareable link: `https://aimoviez.com/team/join?code=K7XP3NVR`
6. User can **copy** the link or use **native share** (mobile share sheet)
7. Multiple invites can be active simultaneously

### 4. Joining a Team via Invite

**Via Link:**
1. Friend clicks the invite link → lands on `/team/join?code=K7XP3NVR`
2. If not logged in → redirected to auth, then back
3. Page auto-calls `POST /api/teams/join` with the code
4. Server validates: code exists, not expired, not maxed out, team not full, user not already in a team
5. `join_team_via_code` RPC atomically: adds member, increments uses, increments member_count
6. Success → redirected to Team Dashboard with "Welcome to [team name]!" message

**Via Code Input:**
1. User taps "Join a Team" → `TeamJoinModal` opens
2. Manually types the 8-character code
3. Same flow as above

### 5. Team Dashboard (Daily Experience)

Once in a team, the `/team` page shows `TeamDashboard`:

**Header Section:**
- Team name, level, description
- Streak badge (fire icon, animated when hot)
- Stats grid: Members (X/5), Total XP, Combined Votes, Wins

**Action Buttons:**
- "Invite Members" (if < 5 members)
- "Team Settings" (leader only)
- "Leave Team" / "Disband Team" (leader sees disband)

**Two Tabs:**
- **Members** - List of all members with roles, XP contribution, activity status
- **Team Chat** - Real-time messaging

### 6. Team Chat

1. User switches to Chat tab → `TeamChat` component loads
2. Fetches recent messages via `GET /api/teams/[id]/messages?limit=50`
3. Subscribes to Supabase Realtime channel `team-chat:{teamId}`
4. Messages appear in bubbles (own = purple right-aligned, others = gray left-aligned)
5. Grouped by date with separators (Today, Yesterday, etc.)
6. User types message (max 500 chars) → `POST /api/teams/[id]/messages`
7. Message saved to DB → Supabase Realtime broadcasts to all connected members
8. Sending a message also updates `team_members.last_active_date` (for streak tracking)

### 7. Vote Multiplier (How Coordination Works)

*(Phase 4 - not yet implemented)*

1. Team member votes on a clip in the tournament
2. After vote is recorded, system calls `track_team_vote` RPC
3. RPC checks: how many team members have voted for the same clip in the same slot?
4. If 3+ members voted the same clip → **1.5x multiplier** applied
5. Bonus votes added to the clip's score
6. Team members see a visual indicator when coordination is achieved

### 8. Team Streaks (Daily Tracking)

*(Phase 5 - not yet implemented)*

1. Daily cron job runs `update_all_team_streaks` RPC
2. For each team, checks: did ALL members have `last_active_date = TODAY`?
3. If yes → `current_streak += 1`, update `longest_streak` if new record
4. If any member missed → `current_streak = 0` (reset!)
5. This creates social pressure: if you don't vote today, your team's streak dies
6. Streak displayed prominently on Team Dashboard with fire animation

### 9. Member Management

**Promoting/Demoting (Leader only):**
1. Leader taps "..." on a member card → context menu
2. Can promote Member → Officer, or demote Officer → Member
3. `PATCH /api/teams/[id]/members` with `{ user_id, role }`

**Kicking (Leader or Officer):**
1. Leader/Officer taps "..." → "Kick from Team"
2. Confirmation dialog → `DELETE /api/teams/[id]/members?user_id=X`
3. Officers cannot kick other officers. Nobody can kick the leader.

**Leaving:**
1. User taps "Leave Team" → confirmation
2. `DELETE /api/teams/[id]/members` (no user_id = self-leave)
3. Calls `leave_team` RPC which handles cleanup

**Disbanding (Leader only):**
1. Leader taps "Disband Team" → serious confirmation
2. `DELETE /api/teams/[id]` → cascading delete removes all members, invites, messages

### 10. Team Leaderboard

1. Users browse `/teams` → `TeamsPage` with ranked list
2. `GET /api/teams?page=1&limit=50` → calls `get_team_leaderboard` RPC
3. Teams ranked by: total XP, combined votes, combined wins
4. Each card shows: rank, name, level, member count, streak, votes, wins, XP
5. Top 3 get trophy icons (gold, silver, bronze)
6. User's own team highlighted in purple if visible

### Role Permissions Summary

| Action | Leader | Officer | Member |
|--------|--------|---------|--------|
| Update team name/description | Yes | No | No |
| Disband team | Yes | No | No |
| Promote/demote members | Yes | No | No |
| Kick members | Yes | Yes* | No |
| Create invites | Yes | Yes | Yes |
| Revoke invites | Yes | Yes | No |
| Send chat messages | Yes | Yes | Yes |
| Leave team | Yes** | Yes | Yes |

*Officers cannot kick other officers
**Leader leaving = team disbanded

---

## Next Steps (Tomorrow)

1. **Run Migration**
   ```sql
   -- Execute in Supabase SQL Editor
   -- File: supabase/sql/migration-teams.sql
   ```

2. **Test End-to-End**
   - Create a team
   - Generate invite, join with another account
   - Test chat functionality
   - Verify leaderboard

3. **Integrate Vote Multiplier**
   - Update vote API to track team votes
   - Apply multiplier logic
