# AiMoviez - Complete Technical Documentation

**Version:** 1.0
**Last Updated:** January 25, 2026
**Status:** Production

---

## Table of Contents

1. [Project Vision](#1-project-vision)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Stack](#3-technology-stack)
4. [Database Design](#4-database-design)
5. [Authentication System](#5-authentication-system)
6. [Voting System](#6-voting-system)
7. [Content Management](#7-content-management)
8. [Admin Dashboard](#8-admin-dashboard)
9. [API Reference](#9-api-reference)
10. [Security Features](#10-security-features)
11. [Performance & Caching](#11-performance--caching)
12. [File Storage](#12-file-storage)
13. [Real-time Features](#13-real-time-features)
14. [Deployment](#14-deployment)
15. [Development Guide](#15-development-guide)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Project Vision

### 1.1 What is AiMoviez?

AiMoviez is a **collaborative AI movie creation platform** where communities build movies together, one 8-second clip at a time. It combines AI-generated content with user creativity through a democratic voting system.

### 1.2 The Core Concept

```
┌─────────────────────────────────────────────────────────────────────┐
│                        8SEC MADNESS                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   1. AI generates 8-second opening scene (Slot 1)                   │
│                          ↓                                           │
│   2. Community uploads continuation clips                            │
│                          ↓                                           │
│   3. Users vote on best continuation                                 │
│                          ↓                                           │
│   4. Winner gets "locked" into the story                            │
│                          ↓                                           │
│   5. Repeat for 75 slots = Complete 10-minute movie                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.3 Multi-Genre Support

Multiple movies can be built simultaneously, each with a different genre:
- **Action** - Explosions, chases, fights
- **Comedy** - Humor, funny situations
- **Horror** - Scary, suspenseful
- **Drama** - Emotional, character-driven
- **Sci-Fi** - Futuristic, technology
- **Romance** - Love stories

Each genre runs as a separate "Season" with its own 75 slots.

---

## 2. Architecture Overview

### 2.1 High-Level Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│   Vercel     │────▶│   Supabase   │
│   (React)    │     │  (Next.js)   │     │ (PostgreSQL) │
└──────────────┘     └──────────────┘     └──────────────┘
                            │                     │
                            ▼                     ▼
                     ┌──────────────┐     ┌──────────────┐
                     │   Upstash    │     │   Supabase   │
                     │   (Redis)    │     │   Storage    │
                     └──────────────┘     └──────────────┘
```

### 2.2 Request Flow

```
User Request
     │
     ▼
┌─────────────────┐
│   Middleware    │ ← Rate limiting, Auth check
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   API Route     │ ← Business logic
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Supabase      │ ← Database operations
└────────┬────────┘
         │
         ▼
    Response
```

### 2.3 Directory Structure

```
aimoviez-app/
├── src/
│   ├── app/                      # Next.js 15 App Router
│   │   ├── api/                  # API Routes (serverless functions)
│   │   │   ├── vote/            # Voting endpoints
│   │   │   ├── story/           # Storyboard data
│   │   │   ├── upload/          # Video upload
│   │   │   ├── admin/           # Admin operations
│   │   │   ├── leaderboard/     # Rankings
│   │   │   ├── comments/        # Comment system
│   │   │   ├── user/            # User management
│   │   │   └── auth/            # Authentication
│   │   ├── admin/               # Admin dashboard page
│   │   ├── story/               # Storyboard viewer
│   │   ├── watch/               # Voting interface
│   │   ├── profile/             # User profiles
│   │   ├── leaderboard/         # Rankings page
│   │   ├── upload/              # Upload interface
│   │   └── ...                  # Other pages
│   │
│   ├── components/              # Reusable React components
│   │   ├── VideoCard.tsx        # Video display card
│   │   ├── VoteButton.tsx       # Voting button
│   │   ├── Navbar.tsx           # Navigation
│   │   ├── BottomNavigation.tsx # Mobile nav
│   │   └── ...
│   │
│   ├── hooks/                   # Custom React hooks
│   │   ├── useAuth.tsx          # Authentication hook
│   │   ├── useRealtimeClips.ts  # Real-time updates
│   │   ├── useCsrf.ts           # CSRF protection
│   │   └── ...
│   │
│   └── lib/                     # Utility libraries
│       ├── device-fingerprint.ts # Vote fraud detection
│       ├── rate-limit.ts         # Rate limiting
│       ├── validations.ts        # Input validation (Zod)
│       ├── api-utils.ts          # API helpers
│       ├── supabase-client.ts    # Database client
│       └── ...
│
├── supabase/
│   └── sql/                     # Database migrations
│       ├── fix-vote-insert-race-condition.sql
│       ├── fix-vote-delete-race-condition.sql
│       ├── optimize-for-scale.sql
│       └── ...
│
├── public/                      # Static assets
│   ├── sounds/                  # UI sound effects
│   └── ...
│
├── Dokumentacja/                # Documentation & screenshots
│
└── Configuration files
    ├── package.json
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── next.config.ts
    └── ...
```

---

## 3. Technology Stack

### 3.1 Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 15.5.7 | React framework with App Router |
| **React** | 19.2.0 | UI library |
| **TypeScript** | 5.x | Type safety |
| **Tailwind CSS** | 4.x | Styling |
| **Framer Motion** | 12.x | Animations |
| **React Query** | 5.x | Data fetching & caching |
| **Lucide React** | 0.553.0 | Icons |

### 3.2 Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js API Routes** | 15.5.7 | Serverless functions |
| **Supabase** | 2.84.0 | PostgreSQL database |
| **NextAuth.js** | 4.24.13 | Authentication |
| **Zod** | 4.1.13 | Input validation |
| **Upstash Redis** | 1.35.7 | Rate limiting & caching |

### 3.3 Infrastructure

| Service | Purpose |
|---------|---------|
| **Vercel** | Hosting & serverless |
| **Supabase** | Database & storage |
| **Upstash** | Redis (rate limiting) |
| **Sentry** | Error monitoring |

### 3.4 Dependencies Deep Dive

```json
{
  "dependencies": {
    // Core Framework
    "next": "^15.5.7",
    "react": "19.2.0",
    "react-dom": "19.2.0",

    // Database & Auth
    "@supabase/supabase-js": "^2.84.0",
    "next-auth": "^4.24.13",

    // Rate Limiting
    "@upstash/ratelimit": "^2.0.7",
    "@upstash/redis": "^1.35.7",

    // UI & Animations
    "framer-motion": "^12.23.24",
    "lucide-react": "^0.553.0",
    "canvas-confetti": "^1.9.4",
    "react-hot-toast": "^2.6.0",

    // Utilities
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.4.0",
    "zod": "^4.1.13",

    // Security
    "@hcaptcha/react-hcaptcha": "^1.16.0",

    // Monitoring
    "@sentry/nextjs": "^10.28.0"
  }
}
```

---

## 4. Database Design

### 4.1 Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────────┐
│   seasons   │       │ story_slots │       │tournament_clips │
├─────────────┤       ├─────────────┤       ├─────────────────┤
│ id (PK)     │───┐   │ id (PK)     │   ┌───│ id (PK)         │
│ label       │   │   │ season_id(FK)│───┘   │ season_id (FK)  │
│ status      │   └───│ slot_position│       │ user_id (FK)    │
│ genre       │       │ status      │       │ slot_position   │
│ total_slots │       │ winner_id(FK)│───────│ video_url       │
└─────────────┘       │ voting_ends │       │ status          │
                      └─────────────┘       │ vote_count      │
                                            └────────┬────────┘
                                                     │
                      ┌─────────────┐               │
                      │    votes    │               │
                      ├─────────────┤               │
                      │ id (PK)     │               │
                      │ clip_id(FK) │───────────────┘
                      │ voter_key   │
                      │ user_id(FK) │───────┐
                      │ vote_weight │       │
                      └─────────────┘       │
                                            │
                      ┌─────────────┐       │
                      │    users    │       │
                      ├─────────────┤       │
                      │ id (PK)     │───────┘
                      │ email       │
                      │ username    │
                      │ xp          │
                      │ level       │
                      └─────────────┘
```

### 4.2 Table Definitions

#### `seasons`
Represents a movie being built (one per genre).

```sql
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,                    -- "Action Season 1"
  status TEXT DEFAULT 'upcoming',         -- upcoming, active, finished
  genre TEXT,                             -- ACTION, COMEDY, HORROR, etc.
  total_slots INT DEFAULT 75,             -- Scenes per movie
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Status Values:**
- `upcoming` - Not started yet
- `active` - Currently accepting clips and votes
- `finished` - All 75 slots completed

#### `story_slots`
75 slots per season - each slot = one scene in the movie.

```sql
CREATE TABLE story_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES seasons(id),
  slot_position INT NOT NULL,             -- 1-75
  status TEXT DEFAULT 'upcoming',         -- upcoming, voting, locked, waiting_for_clips
  genre TEXT,                             -- Can override season genre
  winner_tournament_clip_id UUID,         -- FK to winning clip
  voting_started_at TIMESTAMPTZ,
  voting_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(season_id, slot_position)
);
```

**Status Values:**
- `upcoming` - Future slot, not yet active
- `voting` - Currently accepting votes
- `locked` - Winner selected, slot complete
- `waiting_for_clips` - No clips available to vote on

#### `tournament_clips`
User-uploaded video clips competing for slots.

```sql
CREATE TABLE tournament_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),      -- Uploader
  season_id UUID REFERENCES seasons(id),
  slot_position INT,                      -- NULL until clip wins

  -- Media
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  title TEXT,
  description TEXT,

  -- Creator info (denormalized for performance)
  username TEXT,
  avatar_url TEXT,

  -- Voting stats
  vote_count INT DEFAULT 0,
  weighted_score INT DEFAULT 0,
  hype_score NUMERIC DEFAULT 0,
  view_count INT DEFAULT 0,

  -- Metadata
  status TEXT DEFAULT 'pending',          -- pending, active, locked, rejected, eliminated
  genre TEXT,
  track TEXT DEFAULT 'track-main',
  duration NUMERIC,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Status Values:**
- `pending` - Uploaded, waiting for admin approval
- `active` - Approved, competing in voting
- `locked` - Won a slot, part of the story
- `eliminated` - Lost voting (didn't win)
- `rejected` - Admin rejected the clip

#### `votes`
Individual votes cast by users.

```sql
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID REFERENCES tournament_clips(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,                -- Device fingerprint or user ID
  user_id UUID REFERENCES users(id),      -- If logged in

  vote_weight INT DEFAULT 1,              -- Can be > 1 for power votes
  vote_type TEXT DEFAULT 'standard',      -- standard, power, bonus
  slot_position INT,                      -- Which slot this vote was for
  flagged BOOLEAN DEFAULT FALSE,          -- Suspicious vote flag

  created_at TIMESTAMPTZ DEFAULT NOW(),
  vote_date DATE,                         -- For daily tracking (set by trigger)

  -- Prevent duplicate votes
  UNIQUE(clip_id, voter_key)
);
```

#### `users`
User accounts (via OAuth).

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',               -- user, admin, moderator

  -- Gamification
  xp INT DEFAULT 0,
  level INT DEFAULT 1,
  total_votes_cast INT DEFAULT 0,
  votes_today INT DEFAULT 0,
  last_vote_reset DATE,

  -- Streaks
  current_streak INT DEFAULT 0,
  longest_streak INT DEFAULT 0,
  last_vote_date DATE,

  -- Status
  is_banned BOOLEAN DEFAULT FALSE,
  ban_reason TEXT,
  onboarding_complete BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.3 Key Indexes

```sql
-- Vote performance
CREATE INDEX idx_votes_clip_id ON votes(clip_id);
CREATE INDEX idx_votes_voter_key ON votes(voter_key);
CREATE INDEX idx_votes_created_at ON votes(created_at);
CREATE INDEX idx_votes_date_voter ON votes(vote_date, voter_key);

-- Clip queries
CREATE INDEX idx_clips_status ON tournament_clips(status);
CREATE INDEX idx_clips_season ON tournament_clips(season_id);
CREATE INDEX idx_clips_slot ON tournament_clips(slot_position);
CREATE INDEX idx_clips_vote_count ON tournament_clips(vote_count DESC);

-- Slot queries
CREATE INDEX idx_slots_season_status ON story_slots(season_id, status);
CREATE INDEX idx_slots_position ON story_slots(slot_position);
```

### 4.4 Database Triggers

#### Vote Count Trigger (INSERT)
Automatically updates clip vote counts when a vote is inserted.

```sql
CREATE OR REPLACE FUNCTION update_clip_vote_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tournament_clips
  SET
    vote_count = COALESCE(vote_count, 0) + COALESCE(NEW.vote_weight, 1),
    weighted_score = COALESCE(weighted_score, 0) + COALESCE(NEW.vote_weight, 1)
  WHERE id = NEW.clip_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_vote_insert
AFTER INSERT ON votes
FOR EACH ROW
EXECUTE FUNCTION update_clip_vote_count();
```

#### Vote Count Trigger (DELETE)
Automatically decrements vote counts when a vote is removed.

```sql
CREATE OR REPLACE FUNCTION update_clip_vote_count_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tournament_clips
  SET
    vote_count = GREATEST(0, COALESCE(vote_count, 0) - 1),
    weighted_score = GREATEST(0, COALESCE(weighted_score, 0) - COALESCE(OLD.vote_weight, 1))
  WHERE id = OLD.clip_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_vote_delete
AFTER DELETE ON votes
FOR EACH ROW
EXECUTE FUNCTION update_clip_vote_count_on_delete();
```

#### User Stats Trigger
Updates user XP, level, and streaks when they vote.

```sql
CREATE OR REPLACE FUNCTION update_user_vote_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE users SET
    total_votes_cast = total_votes_cast + 1,
    xp = xp + COALESCE(NEW.vote_weight, 1),
    level = calculate_level(xp + COALESCE(NEW.vote_weight, 1)),
    -- ... streak logic
  WHERE id = NEW.user_id::UUID;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Authentication System

### 5.1 Overview

Authentication is handled by **NextAuth.js** with Google OAuth provider.

### 5.2 Configuration

```typescript
// src/lib/auth-options.ts
import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // Create/update user in Supabase
      const supabase = createSupabaseClient();
      await supabase.from('users').upsert({
        email: user.email,
        username: user.name,
        avatar_url: user.image,
      });
      return true;
    },
    async session({ session, token }) {
      // Add user ID to session
      if (session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
```

### 5.3 Auth Flow

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  User   │────▶│ Sign In │────▶│ Google  │────▶│Callback │
│ Clicks  │     │ Button  │     │  OAuth  │     │  Route  │
└─────────┘     └─────────┘     └─────────┘     └────┬────┘
                                                      │
                                                      ▼
                                               ┌─────────────┐
                                               │ Create/Get  │
                                               │    User     │
                                               └──────┬──────┘
                                                      │
                                                      ▼
                                               ┌─────────────┐
                                               │   Session   │
                                               │   Cookie    │
                                               └─────────────┘
```

### 5.4 Protected Routes

```typescript
// Using getServerSession in API routes
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // User is authenticated
  const userId = session.user.id;
}
```

### 5.5 Admin Authentication

```typescript
// src/lib/admin-auth.ts
export async function requireAdmin(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return { error: 'Unauthorized', status: 401 };
  }

  // Check if user is admin in database
  const { data: user } = await supabase
    .from('users')
    .select('role')
    .eq('email', session.user.email)
    .single();

  if (user?.role !== 'admin') {
    return { error: 'Forbidden', status: 403 };
  }

  return { user, session };
}
```

---

## 6. Voting System

### 6.1 Overview

The voting system is the core feature of AiMoviez. It's designed to be:
- **Fair** - One vote per user per clip (with daily limits)
- **Secure** - Device fingerprinting + rate limiting
- **Atomic** - Race-condition free with PostgreSQL RPC
- **Scalable** - Handles thousands of concurrent users

### 6.2 Daily Voting Limits

```typescript
const DAILY_VOTE_LIMIT = 200;  // Max votes per user per day
```

Users can vote up to 200 times per day across all clips. This encourages engagement while preventing abuse.

### 6.3 Vote Identification

Votes are tracked by a **voter_key** which is either:
1. **Authenticated user**: `user_${userId}`
2. **Anonymous user**: Device fingerprint hash

```typescript
function getVoterKey(req: NextRequest): string {
  // If logged in, use user ID
  const session = await getServerSession(authOptions);
  if (session?.user?.id) {
    return `user_${session.user.id}`;
  }

  // Otherwise, use device fingerprint
  return generateDeviceFingerprint(extractDeviceSignals(req));
}
```

### 6.4 Device Fingerprinting

```typescript
interface DeviceSignals {
  ip: string;
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
  secChUa: string | null;        // Browser info
  secChUaPlatform: string | null; // Platform
  secChUaMobile: string | null;   // Mobile flag
}

function generateDeviceFingerprint(signals: DeviceSignals): string {
  const data = [
    signals.ip,
    signals.userAgent,
    signals.acceptLanguage,
    signals.secChUa || '',
    signals.secChUaPlatform || '',
    signals.secChUaMobile || '',
    signals.acceptEncoding,
  ].join('|');

  return crypto.createHash('sha256').update(data).digest('hex');
}
```

### 6.5 Atomic Vote Operations

To prevent race conditions, voting uses PostgreSQL RPC functions.

#### Insert Vote (Atomic)

```sql
CREATE OR REPLACE FUNCTION insert_vote_atomic(
  p_clip_id TEXT,
  p_voter_key TEXT,
  p_user_id TEXT DEFAULT NULL,
  p_vote_weight INTEGER DEFAULT 1,
  p_vote_type TEXT DEFAULT 'standard',
  p_slot_position INTEGER DEFAULT 1,
  p_flagged BOOLEAN DEFAULT FALSE,
  p_multi_vote_mode BOOLEAN DEFAULT FALSE,
  p_is_power_vote BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  vote_id UUID,
  was_new_vote BOOLEAN,
  final_vote_weight INTEGER,
  new_vote_count INTEGER,
  new_weighted_score INTEGER,
  error_code TEXT
)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clip_uuid UUID := p_clip_id::UUID;
  v_vote_id UUID;
  -- ... variables
BEGIN
  -- For multi-vote mode, check if vote exists
  IF p_multi_vote_mode THEN
    SELECT id, vote_weight INTO v_vote_id, v_existing_weight
    FROM votes
    WHERE clip_id = v_clip_uuid AND voter_key = p_voter_key
    FOR UPDATE;  -- Lock the row

    IF v_vote_id IS NOT NULL THEN
      -- Update existing vote weight
      UPDATE votes SET vote_weight = v_existing_weight + p_vote_weight
      WHERE id = v_vote_id;
      -- Update clip counts...
      RETURN;
    END IF;
  END IF;

  -- Insert new vote
  INSERT INTO votes (clip_id, voter_key, user_id, vote_weight, ...)
  VALUES (v_clip_uuid, p_voter_key, v_user_uuid, p_vote_weight, ...)
  RETURNING id INTO v_vote_id;

  -- Return result
  RETURN QUERY SELECT ...;

EXCEPTION
  WHEN unique_violation THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 0, 0, 0, 'ALREADY_VOTED'::TEXT;
END;
$$ LANGUAGE plpgsql;
```

### 6.6 Vote API Endpoint

#### GET /api/vote - Get clips to vote on

```typescript
export async function GET(req: NextRequest) {
  // 1. Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  // 2. Get voter identification
  const voterKey = getVoterKey(req);

  // 3. Get user's votes today
  const { count: totalVotesToday } = await getUserVotesToday(supabase, voterKey);
  const dailyRemaining = DAILY_VOTE_LIMIT - totalVotesToday;

  // 4. Get active season
  const { data: season } = await supabase
    .from('seasons')
    .select('*')
    .eq('status', 'active')
    .single();

  // 5. Get active slot (status = 'voting')
  const { data: activeSlot } = await supabase
    .from('story_slots')
    .select('*')
    .eq('season_id', season.id)
    .eq('status', 'voting')
    .single();

  // 6. Get clips for voting
  const { data: clips } = await supabase
    .from('tournament_clips')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(8);

  // 7. Get user's voted clip IDs
  const { data: votes } = await supabase
    .from('votes')
    .select('clip_id')
    .eq('voter_key', voterKey);

  return NextResponse.json({
    clips,
    totalVotesToday,
    remainingVotes: { standard: dailyRemaining },
    votedClipIds: votes.map(v => v.clip_id),
    currentSlot: activeSlot.slot_position,
    // ... more data
  });
}
```

#### POST /api/vote - Cast a vote

```typescript
export async function POST(req: NextRequest) {
  // 1. Rate limiting
  const rateLimitResponse = await rateLimit(req, 'vote');
  if (rateLimitResponse) return rateLimitResponse;

  // 2. Parse and validate input
  const body = await parseBody(req, VoteRequestSchema);
  const { clipId, weight = 1 } = body;

  // 3. Check daily limit
  const { count: totalVotesToday } = await getUserVotesToday(supabase, voterKey);
  if (totalVotesToday >= DAILY_VOTE_LIMIT) {
    return NextResponse.json({ error: 'Daily limit reached' }, { status: 429 });
  }

  // 4. Verify clip exists and is active
  const { data: clip } = await supabase
    .from('tournament_clips')
    .select('*')
    .eq('id', clipId)
    .eq('status', 'active')
    .single();

  if (!clip) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
  }

  // 5. Insert vote atomically
  const { data: result, error } = await supabase.rpc('insert_vote_atomic', {
    p_clip_id: String(clipId),
    p_voter_key: String(voterKey),
    p_user_id: userId ? String(userId) : null,
    p_vote_weight: weight,
    p_multi_vote_mode: true,  // Allow multiple votes on same clip
  });

  if (error) {
    return NextResponse.json({ error: 'Failed to vote' }, { status: 500 });
  }

  // 6. Return updated state
  return NextResponse.json({
    success: true,
    clipId,
    newScore: result[0].new_weighted_score,
    totalVotesToday: totalVotesToday + weight,
    remainingVotes: { standard: DAILY_VOTE_LIMIT - totalVotesToday - weight },
  });
}
```

### 6.7 Vote Flow Diagram

```
User clicks vote
       │
       ▼
┌──────────────┐
│ Rate Limit   │──▶ 429 if exceeded
│   Check      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Validate    │──▶ 400 if invalid
│   Input      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Daily Limit  │──▶ 429 if exceeded
│   Check      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Verify Clip  │──▶ 404 if not found
│   Exists     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Atomic     │──▶ 409 if already voted
│    Vote      │    (in non-multi mode)
│    RPC       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Return     │
│   Success    │
└──────────────┘
```

---

## 7. Content Management

### 7.1 Clip Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Upload  │────▶│ Pending  │────▶│  Active  │────▶│  Locked  │
│          │     │ (Review) │     │ (Voting) │     │ (Winner) │
└──────────┘     └────┬─────┘     └────┬─────┘     └──────────┘
                      │                │
                      │ Reject         │ Lose
                      ▼                ▼
                ┌──────────┐     ┌───────────┐
                │ Rejected │     │ Eliminated │
                └──────────┘     └───────────┘
```

### 7.2 Upload Flow

```typescript
// 1. Get signed upload URL
POST /api/upload/signed-url
{
  "filename": "myclip.mp4",
  "contentType": "video/mp4"
}

// Response:
{
  "signedUrl": "https://...",
  "path": "clips/user123/abc123.mp4"
}

// 2. Upload directly to Supabase Storage
PUT {signedUrl}
Content-Type: video/mp4
Body: <video file>

// 3. Register clip in database
POST /api/upload/register
{
  "path": "clips/user123/abc123.mp4",
  "title": "My awesome clip",
  "genre": "ACTION"
}
```

### 7.3 Slot Management

#### Advancing to Next Slot

When voting ends for a slot:

```typescript
// POST /api/admin/advance-slot
export async function POST(req: NextRequest) {
  // 1. Get current voting slot
  const { data: currentSlot } = await supabase
    .from('story_slots')
    .select('*')
    .eq('status', 'voting')
    .single();

  // 2. Find winner (highest vote count)
  const { data: winner } = await supabase
    .from('tournament_clips')
    .select('*')
    .eq('status', 'active')
    .order('weighted_score', { ascending: false })
    .limit(1)
    .single();

  // 3. Lock the winner
  await supabase
    .from('tournament_clips')
    .update({ status: 'locked', slot_position: currentSlot.slot_position })
    .eq('id', winner.id);

  // 4. Update slot with winner
  await supabase
    .from('story_slots')
    .update({
      status: 'locked',
      winner_tournament_clip_id: winner.id
    })
    .eq('id', currentSlot.id);

  // 5. Activate next slot
  await supabase
    .from('story_slots')
    .update({ status: 'voting', voting_started_at: new Date() })
    .eq('slot_position', currentSlot.slot_position + 1);

  // 6. Eliminate losing clips (optional)
  await supabase
    .from('tournament_clips')
    .update({ status: 'eliminated' })
    .eq('status', 'active')
    .neq('id', winner.id);
}
```

---

## 8. Admin Dashboard

### 8.1 Features

- **Clip Management**: View, approve, reject, edit clips
- **Slot Control**: Advance slots, assign winners
- **User Management**: View users, ban/unban
- **Statistics**: Vote counts, active users
- **Feature Flags**: Toggle app features

### 8.2 Access Control

```typescript
// Only users with role='admin' can access
const ADMIN_ROLES = ['admin', 'moderator'];

export async function requireAdmin(req: NextRequest) {
  const session = await getServerSession(authOptions);

  const { data: user } = await supabase
    .from('users')
    .select('role')
    .eq('email', session.user.email)
    .single();

  if (!ADMIN_ROLES.includes(user.role)) {
    throw new Error('Forbidden');
  }
}
```

### 8.3 Admin Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/clips` | GET | List all clips with filters |
| `/api/admin/clips/[id]` | PATCH | Update clip |
| `/api/admin/approve` | POST | Approve pending clip |
| `/api/admin/reject` | POST | Reject pending clip |
| `/api/admin/advance-slot` | POST | Advance to next slot |
| `/api/admin/assign-winner` | POST | Manually assign winner |
| `/api/admin/users` | GET | List all users |
| `/api/admin/users/[id]` | PATCH | Update user (ban, role) |
| `/api/admin/feature-flags` | GET/POST | Manage feature flags |
| `/api/admin/stats` | GET | Dashboard statistics |

---

## 9. API Reference

### 9.1 Public Endpoints

#### Voting
| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/vote` | Get clips + voting state | 120/min |
| POST | `/api/vote` | Cast vote | 30/min |
| DELETE | `/api/vote` | Remove vote | 30/min |

#### Story
| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/story` | Get all seasons + slots | 120/min |

#### Leaderboard
| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/leaderboard` | Top clips | 120/min |
| GET | `/api/leaderboard/clips` | Top clips (detailed) | 120/min |
| GET | `/api/leaderboard/creators` | Top creators | 120/min |
| GET | `/api/leaderboard/voters` | Top voters | 120/min |
| GET | `/api/leaderboard/live` | Live dashboard | 120/min |

#### Upload (Authenticated)
| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| POST | `/api/upload/signed-url` | Get upload URL | 5/min |
| POST | `/api/upload/register` | Register uploaded clip | 5/min |

#### Comments
| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/comments?clipId=X` | Get comments | 120/min |
| POST | `/api/comments` | Add comment | 15/min |
| DELETE | `/api/comments?id=X` | Delete comment | 15/min |

### 9.2 Response Formats

#### Success Response
```json
{
  "success": true,
  "data": { ... }
}
```

#### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

#### Common Error Codes
| Code | HTTP | Description |
|------|------|-------------|
| `UNAUTHORIZED` | 401 | Not logged in |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `ALREADY_VOTED` | 409 | Already voted on clip |
| `RATE_LIMITED` | 429 | Too many requests |
| `DAILY_LIMIT` | 429 | Daily vote limit reached |
| `VALIDATION_ERROR` | 400 | Invalid input |

---

## 10. Security Features

### 10.1 Rate Limiting

```typescript
const RATE_LIMITS = {
  vote: { requests: 30, window: '1m' },
  upload: { requests: 5, window: '1m' },
  comment: { requests: 15, window: '1m' },
  api: { requests: 60, window: '1m' },
  admin: { requests: 30, window: '1m' },
  read: { requests: 120, window: '1m' },
  auth: { requests: 5, window: '1m' },
  contact: { requests: 3, window: '1m' },
};
```

### 10.2 CSRF Protection

```typescript
// Generate CSRF token
export async function GET(req: NextRequest) {
  const token = crypto.randomBytes(32).toString('hex');

  // Store in session/cookie
  const response = NextResponse.json({ token });
  response.cookies.set('csrf_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
  });

  return response;
}

// Validate on mutations
export async function POST(req: NextRequest) {
  const csrfToken = req.headers.get('x-csrf-token');
  const cookieToken = req.cookies.get('csrf_token');

  if (!csrfToken || csrfToken !== cookieToken) {
    return NextResponse.json({ error: 'Invalid CSRF' }, { status: 403 });
  }
}
```

### 10.3 Input Validation

All inputs are validated with Zod schemas:

```typescript
import { z } from 'zod';

export const VoteRequestSchema = z.object({
  clipId: z.string().uuid(),
  weight: z.number().int().min(1).max(10).optional().default(1),
  captchaToken: z.string().optional(),
});

export const CommentSchema = z.object({
  clipId: z.string().uuid(),
  content: z.string().min(1).max(500),
});
```

### 10.4 Vote Fraud Detection

```typescript
interface VoteRisk {
  score: number;       // 0-100
  flagged: boolean;    // Should flag for review
  reasons: string[];   // Why it's risky
}

function assessDeviceRisk(signals: DeviceSignals): VoteRisk {
  const reasons: string[] = [];
  let score = 0;

  // Suspicious signals
  if (signals.userAgent.includes('bot')) {
    score += 50;
    reasons.push('Bot-like user agent');
  }
  if (signals.ip === 'unknown') {
    score += 30;
    reasons.push('Unknown IP');
  }
  // ... more checks

  return {
    score,
    flagged: score >= 50,
    reasons,
  };
}
```

### 10.5 Row Level Security (RLS)

```sql
-- Users can only update their own data
CREATE POLICY "Users can update own profile"
ON users FOR UPDATE
USING (auth.uid() = id);

-- Anyone can read active clips
CREATE POLICY "Public clips are viewable"
ON tournament_clips FOR SELECT
USING (status = 'active');

-- Only admins can modify clips
CREATE POLICY "Admins can modify clips"
ON tournament_clips FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND role = 'admin'
  )
);
```

---

## 11. Performance & Caching

### 11.1 In-Memory Cache

```typescript
const cache = {
  activeSeason: null as CacheEntry | null,
  activeSlot: null as CacheEntry | null,
  clips: new Map<string, CacheEntry>(),
};

const CACHE_TTL = {
  season: 5 * 60 * 1000,      // 5 minutes
  slot: 60 * 1000,            // 1 minute
  clips: 2 * 60 * 1000,       // 2 minutes
  featureFlags: 10 * 60 * 1000, // 10 minutes
};
```

### 11.2 HTTP Cache Headers

```typescript
return NextResponse.json(data, {
  headers: {
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
  },
});
```

| Endpoint | s-maxage | stale-while-revalidate |
|----------|----------|------------------------|
| GET /api/vote | 30s | 120s |
| GET /api/leaderboard/* | 60s | 300s |
| GET /api/story | 30s | 60s |

### 11.3 Database Query Optimization

- Use indexes for frequent queries
- Limit results with pagination
- Use `select()` to fetch only needed columns
- Denormalize for read-heavy data (username, avatar on clips)

### 11.4 Capacity Estimates

| Metric | Free Tier | Pro Tier ($25/mo) |
|--------|-----------|-------------------|
| Concurrent users | 200-500 | 1,000-5,000 |
| Daily active users | 3,000-8,000 | 10,000-50,000 |
| Votes per day | 50,000-100,000 | 500,000-1,000,000 |
| Clips in database | 10,000-50,000 | 100,000-500,000 |

---

## 12. File Storage

### 12.1 Supabase Storage Structure

```
videos/
├── clips/
│   ├── {user_id}/
│   │   ├── {clip_id}.mp4
│   │   └── {clip_id}_thumb.jpg
│   └── ...
└── avatars/
    └── {user_id}.jpg
```

### 12.2 Upload Flow

```typescript
// 1. Generate signed URL (server-side)
const { data: signedUrl } = await supabase.storage
  .from('videos')
  .createSignedUploadUrl(`clips/${userId}/${clipId}.mp4`);

// 2. Upload directly (client-side)
await fetch(signedUrl, {
  method: 'PUT',
  body: videoFile,
  headers: { 'Content-Type': 'video/mp4' },
});

// 3. Get public URL
const publicUrl = supabase.storage
  .from('videos')
  .getPublicUrl(`clips/${userId}/${clipId}.mp4`);
```

### 12.3 Video Requirements

- **Duration**: 8 seconds max
- **Format**: MP4, WebM
- **Size**: 50MB max
- **Resolution**: Up to 1080p recommended

---

## 13. Real-time Features

### 13.1 Supabase Realtime

```typescript
// Subscribe to vote changes
const channel = supabase
  .channel('votes')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'votes',
      filter: `clip_id=eq.${clipId}`,
    },
    (payload) => {
      // Update UI with new vote
      setVoteCount(prev => prev + payload.new.vote_weight);
    }
  )
  .subscribe();
```

### 13.2 useRealtimeClips Hook

```typescript
export function useRealtimeClips(initialClips: Clip[]) {
  const [clips, setClips] = useState(initialClips);

  useEffect(() => {
    const channel = supabase
      .channel('clip-updates')
      .on('postgres_changes', { event: '*', table: 'tournament_clips' },
        (payload) => {
          // Handle insert, update, delete
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return clips;
}
```

---

## 14. Deployment

### 14.1 Vercel Configuration

```json
// vercel.json
{
  "framework": "nextjs",
  "regions": ["iad1"],
  "env": {
    "NEXT_PUBLIC_SUPABASE_URL": "@supabase-url",
    "SUPABASE_SERVICE_ROLE_KEY": "@supabase-key"
  }
}
```

### 14.2 Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

# Auth
NEXTAUTH_URL=https://your-domain.com
NEXTAUTH_SECRET=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# Redis
UPSTASH_REDIS_REST_URL=xxx
UPSTASH_REDIS_REST_TOKEN=xxx

# Optional
SENTRY_DSN=xxx
HCAPTCHA_SECRET=xxx
```

### 14.3 Database Migrations

Migrations are run manually via Supabase SQL Editor:

```bash
# List migrations
ls supabase/sql/

# Run a migration
# Copy contents of .sql file to Supabase SQL Editor
# Execute
```

### 14.4 Deployment Checklist

- [ ] Environment variables set in Vercel
- [ ] Database migrations applied
- [ ] RLS policies enabled
- [ ] Indexes created
- [ ] DNS configured
- [ ] SSL enabled (automatic with Vercel)

---

## 15. Development Guide

### 15.1 Local Setup

```bash
# Clone repository
git clone https://github.com/chiefnavajo/aimoviez.git
cd aimoviez-app

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your values

# Run development server
npm run dev

# Open http://localhost:3000
```

### 15.2 Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### 15.3 Code Style

- Use TypeScript strict mode
- Follow ESLint rules
- Use Prettier for formatting
- Write meaningful commit messages

### 15.4 Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes and commit
git add .
git commit -m "feat: Add new feature"

# Push and create PR
git push origin feature/my-feature
```

### 15.5 Commit Message Format

```
type: subject

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting
- refactor: Code restructuring
- test: Tests
- perf: Performance improvement
```

---

## 16. Troubleshooting

### 16.1 Common Issues

#### "Vote system not configured"
- RPC function `insert_vote_atomic` not found
- Solution: Run `fix-vote-insert-race-condition.sql` migration

#### Clips not showing in voting
- Check clip status is `active`
- Check slot status is `voting`
- Clear cache and refresh

#### 429 Too Many Requests
- Rate limit exceeded
- Wait 1 minute and retry

#### Duplicate function error
- Multiple versions of RPC function exist
- Solution: Drop old versions first

```sql
DROP FUNCTION IF EXISTS insert_vote_atomic(UUID, TEXT, UUID, ...);
NOTIFY pgrst, 'reload schema';
```

### 16.2 Useful SQL Queries

```sql
-- Check current voting state
SELECT slot_position, status
FROM story_slots
ORDER BY slot_position;

-- Check all clips
SELECT id, username, slot_position, status, vote_count
FROM tournament_clips
ORDER BY vote_count DESC;

-- Check today's votes
SELECT COUNT(*), SUM(vote_weight)
FROM votes
WHERE created_at > CURRENT_DATE;

-- Find locked winners
SELECT s.slot_position, c.username, c.vote_count
FROM story_slots s
JOIN tournament_clips c ON s.winner_tournament_clip_id = c.id
WHERE s.status = 'locked'
ORDER BY s.slot_position;

-- Reset cache (PostgREST)
NOTIFY pgrst, 'reload schema';
```

### 16.3 Logs

- **Vercel**: Function logs in Vercel Dashboard
- **Supabase**: Database logs in Supabase Dashboard
- **Browser**: Console for client errors
- **Sentry**: Error tracking (if configured)

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| **Clip** | An 8-second video uploaded by a user |
| **Slot** | A position in the story (1-75) |
| **Season** | A complete movie being built (75 slots) |
| **Locked** | A clip that won its slot and is part of the story |
| **Voter Key** | Unique identifier for a voter (user ID or device fingerprint) |
| **RPC** | Remote Procedure Call - PostgreSQL function called from API |
| **RLS** | Row Level Security - Database access control |

---

## Appendix B: Contact

- **GitHub**: https://github.com/chiefnavajo/aimoviez
- **Documentation**: `/Dokumentacja` folder

---

*This documentation is maintained by the AiMoviez team. Last updated: January 25, 2026.*
