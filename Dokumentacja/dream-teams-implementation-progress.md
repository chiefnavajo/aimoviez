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
