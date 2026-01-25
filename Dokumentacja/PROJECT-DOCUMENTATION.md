# AiMoviez - 8SEC MADNESS

## Project Overview

AiMoviez is a collaborative AI movie creation platform where communities build movies together, one 8-second clip at a time.

### The Concept
1. Each **genre** (Action, Comedy, Horror, etc.) starts with an **AI-generated 8-second opening clip**
2. The **community uploads clips** that continue the story
3. Users **vote** on which clip best continues the narrative
4. The **winning clip** gets locked into the story
5. Repeat until **75 slots = complete 10-minute movie**

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React, TypeScript |
| Styling | Tailwind CSS |
| Backend | Next.js API Routes (serverless) |
| Database | Supabase (PostgreSQL) |
| Auth | NextAuth.js (Google OAuth) |
| Storage | Supabase Storage (videos/thumbnails) |
| Caching | In-memory + Redis (Upstash) |
| Hosting | Vercel |
| Rate Limiting | Upstash Redis |

---

## Project Structure

```
aimoviez-app/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API routes
│   │   │   ├── vote/           # Voting system
│   │   │   ├── story/          # Story/storyboard API
│   │   │   ├── leaderboard/    # Leaderboard APIs
│   │   │   ├── admin/          # Admin APIs
│   │   │   └── upload/         # Video upload
│   │   ├── admin/              # Admin dashboard page
│   │   ├── story/              # Storyboard page
│   │   ├── watch/              # Voting/watch page
│   │   └── ...
│   ├── components/             # React components
│   ├── hooks/                  # Custom React hooks
│   └── lib/                    # Utilities and helpers
├── supabase/
│   └── sql/                    # Database migrations
└── Dokumentacja/               # Documentation and screenshots
```

---

## Database Schema

### Core Tables

#### `seasons`
Represents a movie being built (one per genre).
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| label | TEXT | Season name (e.g., "Action Season 1") |
| status | TEXT | `active`, `finished`, `upcoming` |
| total_slots | INT | Number of slots (default: 75) |
| genre | TEXT | Genre of this season |

#### `story_slots`
75 slots per season - each slot = one scene in the movie.
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| season_id | UUID | FK to seasons |
| slot_position | INT | 1-75 |
| status | TEXT | `upcoming`, `voting`, `locked`, `waiting_for_clips` |
| winner_tournament_clip_id | UUID | FK to winning clip |
| voting_ends_at | TIMESTAMP | When voting ends |
| genre | TEXT | Genre for this slot |

#### `tournament_clips`
User-uploaded video clips competing for slots.
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK to users (uploader) |
| season_id | UUID | FK to seasons |
| slot_position | INT | NULL until clip wins (then assigned slot) |
| video_url | TEXT | Supabase storage URL |
| thumbnail_url | TEXT | Thumbnail image URL |
| username | TEXT | Creator's display name |
| avatar_url | TEXT | Creator's avatar |
| vote_count | INT | Total votes received |
| weighted_score | INT | Weighted vote score |
| status | TEXT | `pending`, `active`, `locked`, `rejected`, `eliminated` |
| genre | TEXT | Clip genre |

#### `votes`
Individual votes cast by users.
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| clip_id | UUID | FK to tournament_clips |
| voter_key | TEXT | Device fingerprint or user ID |
| user_id | UUID | FK to users (if logged in) |
| vote_weight | INT | Vote weight (default: 1) |
| slot_position | INT | Which slot this vote was for |
| created_at | TIMESTAMP | Vote timestamp |

#### `users`
User accounts (via OAuth).
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| email | TEXT | User email |
| username | TEXT | Display name |
| avatar_url | TEXT | Profile picture |
| xp | INT | Experience points |
| level | INT | User level |
| total_votes_cast | INT | Lifetime votes |
| current_streak | INT | Consecutive voting days |

---

## Clip Status Lifecycle

```
┌─────────┐     Admin      ┌─────────┐     Voting     ┌─────────┐
│ pending │ ──────────────▶│ active  │ ──────────────▶│ locked  │
└─────────┘    Approve     └─────────┘     Wins       └─────────┘
     │                          │
     │ Admin                    │ Loses
     │ Reject                   ▼
     ▼                    ┌────────────┐
┌──────────┐              │ eliminated │
│ rejected │              └────────────┘
└──────────┘
```

- **pending**: Uploaded, waiting for admin approval
- **active**: Approved, competing in voting
- **locked**: Won a slot, part of the story
- **eliminated**: Lost voting (didn't win)
- **rejected**: Admin rejected

---

## Slot Status Lifecycle

```
┌──────────┐            ┌─────────┐            ┌─────────┐
│ upcoming │ ──────────▶│ voting  │ ──────────▶│ locked  │
└──────────┘            └─────────┘            └─────────┘
                             │
                             │ No clips
                             ▼
                    ┌─────────────────┐
                    │ waiting_for_clips│
                    └─────────────────┘
```

- **upcoming**: Future slot, not yet active
- **voting**: Currently accepting votes
- **locked**: Winner selected, slot complete
- **waiting_for_clips**: Waiting for uploads

---

## Voting System

### Daily Limits
- **200 votes per day** per user
- Can vote multiple times on the same clip
- Votes tracked by device fingerprint OR user ID (if logged in)

### Atomic Voting (Race-Condition Free)
Voting uses PostgreSQL RPC functions for atomic operations:

**`insert_vote_atomic`** - Handles vote insertion:
- Uses `SELECT FOR UPDATE` to lock rows
- Prevents duplicate vote race conditions
- Updates clip vote counts in same transaction

**`delete_vote_atomic`** - Handles vote removal:
- Atomic decrement of vote counts
- Prevents negative vote counts

### Vote Flow
1. User clicks vote button
2. API validates daily limit
3. Calls `insert_vote_atomic` RPC
4. Returns updated vote count
5. UI updates in real-time

---

## Key API Endpoints

### Voting
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vote` | Get clips to vote on + voting state |
| POST | `/api/vote` | Cast a vote |
| DELETE | `/api/vote` | Remove a vote |

### Story
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/story` | Get storyboard (all seasons + slots) |

### Leaderboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leaderboard` | Top clips overall |
| GET | `/api/leaderboard/clips` | Top clips by votes |
| GET | `/api/leaderboard/creators` | Top creators |
| GET | `/api/leaderboard/voters` | Top voters |
| GET | `/api/leaderboard/live` | Live dashboard data |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/clips` | Get all clips (with filters) |
| PATCH | `/api/admin/clips` | Update clip status |
| POST | `/api/admin/advance-slot` | Advance to next slot |

---

## Admin Dashboard

Located at `/admin` - requires admin privileges.

### Features
- View all clips (filter by status, slot, season)
- Approve/reject pending clips
- Edit clip metadata
- Advance voting slots
- View slot statistics
- Unlock slots (revert locked slots)

### Clip Management
- **Approve**: Changes `pending` → `active`
- **Reject**: Changes status → `rejected`
- **Edit**: Update title, description, genre

---

## Caching Strategy

### In-Memory Cache (Server-Side)
| Data | TTL | Purpose |
|------|-----|---------|
| Season | 5 min | Rarely changes |
| Active Slot | 1 min | Current voting slot |
| Clips | 2 min | Video list |
| Feature Flags | 10 min | App configuration |

### HTTP Cache Headers (CDN)
| Endpoint | Cache |
|----------|-------|
| GET /api/vote | 30s fresh, 2min stale |
| GET /api/leaderboard/* | 60s fresh, 5min stale |
| GET /api/story | 30s fresh, 1min stale |

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Auth
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# Redis (Upstash)
UPSTASH_REDIS_REST_URL=xxx
UPSTASH_REDIS_REST_TOKEN=xxx
```

---

## Current System Capacity

| Metric | Free Tier | Pro Tier |
|--------|-----------|----------|
| Concurrent users | 200-500 | 1,000-5,000 |
| Daily active users | 3,000-8,000 | 10,000-50,000 |
| Votes per day | 50,000-100,000 | 500,000-1,000,000 |

---

## Running Locally

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

---

## Deployment

The app is deployed on **Vercel** with automatic deployments from the `main` branch.

Database migrations are run manually via Supabase SQL Editor.

---

## TODO / Planned Features

### Task 1: Fix Slot/Clip Assignment
- Update vote route to show ALL active clips (ignore slot_position filter)
- Clips keep `slot_position = NULL` until they win

### Task 2: Multiple Genre Seasons
- Run multiple seasons simultaneously (Action, Comedy, Horror, etc.)
- Each genre starts with an AI-generated opening clip
- Users can switch between genres to vote

### Task 3: Admin Dashboard Improvements
- Show locked slot winners clearly
- Better slot management UI

---

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/app/api/vote/route.ts` | Main voting logic |
| `src/app/api/story/route.ts` | Storyboard data |
| `src/app/admin/page.tsx` | Admin dashboard UI |
| `src/lib/device-fingerprint.ts` | Vote fraud detection |
| `src/lib/rate-limit.ts` | API rate limiting |
| `supabase/sql/*.sql` | Database migrations |

---

## Useful SQL Queries

```sql
-- Check current slot status
SELECT slot_position, status, winner_tournament_clip_id
FROM story_slots
ORDER BY slot_position;

-- Check all clips
SELECT id, username, slot_position, status, vote_count
FROM tournament_clips
ORDER BY vote_count DESC;

-- Check votes today
SELECT COUNT(*), SUM(vote_weight)
FROM votes
WHERE created_at > CURRENT_DATE;
```

---

## Contact

For questions, check:
- `Dokumentacja/` folder for session notes
- GitHub issues for bug reports
- Slack/Discord for team communication
