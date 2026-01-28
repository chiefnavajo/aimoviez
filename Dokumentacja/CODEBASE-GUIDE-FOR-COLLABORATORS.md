# AiMoviez Codebase Guide for Collaborators

**Version:** 0.1.0 (Beta)
**Last Updated:** January 2026
**Document Purpose:** Comprehensive onboarding guide for new collaborators

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [UI Design System](#4-ui-design-system)
5. [Voting System](#5-voting-system)
6. [Comment System](#6-comment-system)
7. [Video Display System](#7-video-display-system)
8. [Content Distribution Algorithm](#8-content-distribution-algorithm)
9. [Database Schema](#9-database-schema)
10. [API Reference](#10-api-reference)
11. [Getting Started](#11-getting-started)

---

## 1. Project Overview

### What is AiMoviez?

**AiMoviez · 8SEC MADNESS** is a collaborative AI movie creation platform where users vote on 8-second video clips to collectively create a global film. Think of it as "TikTok meets democratic filmmaking."

### Core Concept

- Users upload 8-second video clips
- Community votes on clips in tournament-style rounds
- Winning clips are assembled into a collaborative movie
- Each "season" produces one complete film through collective voting

### Key Features

| Feature | Description |
|---------|-------------|
| **Voting Arena** | Tournament-style voting on video clips |
| **Story Mode** | Watch the completed movie with TikTok-style interface |
| **Upload System** | Submit 8-second clips with AWS S3 storage |
| **Leaderboard** | Rankings for clips, creators, and voters |
| **Comments** | TikTok-style comment threads with likes and replies |
| **Seasons** | Themed seasons with genre voting for next season |
| **Real-time Updates** | Live vote counts and winner announcements |

---

## 2. Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 19.2 | UI Framework |
| **Next.js** | 15.5.7 | Full-stack framework (App Router) |
| **TypeScript** | 5 | Type safety |
| **Tailwind CSS** | 4 | Styling |
| **Framer Motion** | 12.23 | Animations |
| **TanStack React Query** | 5.90 | Server state management |

### Backend & Database
| Technology | Purpose |
|------------|---------|
| **Next.js API Routes** | Backend endpoints |
| **Supabase** | PostgreSQL database + Auth + Realtime |
| **AWS S3** | Video file storage |
| **Upstash Redis** | Rate limiting |

### Security & Monitoring
| Technology | Purpose |
|------------|---------|
| **NextAuth** | OAuth authentication (Google) |
| **hCaptcha** | Bot prevention |
| **Sentry** | Error tracking |
| **CSRF Tokens** | Cross-site request forgery protection |

### Development
| Technology | Purpose |
|------------|---------|
| **Jest** | Testing |
| **Zod** | Schema validation |
| **Lucide React** | Icons |

---

## 3. Project Structure

```
aimoviez-app/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── page.tsx                  # Landing page (login)
│   │   ├── layout.tsx                # Root layout with providers
│   │   ├── providers.tsx             # React Query, Auth, Theme providers
│   │   ├── globals.css               # Design system & global styles
│   │   │
│   │   ├── dashboard/page.tsx        # Main voting arena (66KB)
│   │   ├── story/page.tsx            # Story/movie playback (81KB)
│   │   ├── upload/page.tsx           # Video upload wizard
│   │   ├── watch/page.tsx            # Previous seasons library
│   │   ├── profile/page.tsx          # User profile
│   │   ├── profile/[id]/page.tsx     # Creator profile
│   │   ├── leaderboard/page.tsx      # Rankings
│   │   ├── admin/page.tsx            # Admin dashboard
│   │   ├── clip/[id]/page.tsx        # Individual clip page
│   │   │
│   │   └── api/                      # 50+ API endpoints
│   │       ├── vote/route.ts         # Voting system (core)
│   │       ├── story/route.ts        # Season/story data
│   │       ├── comments/route.ts     # Comment CRUD
│   │       ├── upload/               # Upload pipeline
│   │       ├── admin/                # Admin operations (18 routes)
│   │       └── ...
│   │
│   ├── components/                   # 27 React components
│   │   ├── Navbar.tsx                # Top navigation
│   │   ├── BottomNavigation.tsx      # Mobile bottom nav
│   │   ├── VideoCard.tsx             # Clip card for voting
│   │   ├── CommentsSection.tsx       # Comments modal (29KB)
│   │   ├── StoryTimeline.tsx         # Season timeline
│   │   ├── OnboardingTour.tsx        # Tutorial system
│   │   ├── SpotlightTour.tsx         # Feature highlights
│   │   └── ui/                       # Base UI components
│   │       ├── Modal.tsx
│   │       ├── Toast.tsx
│   │       ├── Skeleton.tsx
│   │       └── ThemeToggle.tsx
│   │
│   ├── hooks/                        # Custom React hooks
│   │   ├── useAuth.tsx               # Authentication state
│   │   ├── useRealtimeClips.ts       # Real-time updates
│   │   ├── useLandscapeVideo.ts      # Mobile landscape mode
│   │   ├── useCsrf.ts                # CSRF token management
│   │   └── useFeatureFlags.ts        # Feature flag checking
│   │
│   ├── lib/                          # Utility modules
│   │   ├── api-utils.ts              # API helpers (564 lines)
│   │   ├── video-storage.ts          # S3/Supabase storage
│   │   ├── rate-limit.ts             # Rate limiting
│   │   ├── sanitize.ts               # Input sanitization
│   │   ├── validations.ts            # Zod schemas
│   │   ├── supabase-client.ts        # Database client
│   │   └── auth-options.ts           # NextAuth config
│   │
│   └── types/
│       └── index.ts                  # TypeScript definitions
│
├── supabase/sql/                     # Database migrations (15+)
├── public/                           # Static assets
└── Dokumentacja/                     # Project documentation
```

### Key Files by Importance

| File | Lines | Purpose |
|------|-------|---------|
| `src/app/dashboard/page.tsx` | ~1800 | Main voting interface |
| `src/app/story/page.tsx` | ~2000 | Story playback & video player |
| `src/app/api/vote/route.ts` | ~1400 | Voting logic & clip distribution |
| `src/components/CommentsSection.tsx` | ~830 | Comment system UI |
| `src/app/globals.css` | ~470 | Design system |
| `src/lib/api-utils.ts` | ~560 | API helper functions |

---

## 4. UI Design System

### Styling Approach

The app uses **Tailwind CSS v4** with custom design tokens defined in `globals.css`.

### Color System

```css
/* Dark Theme (Default) */
--background: #000000;
--foreground: #ffffff;
--card-bg: rgba(255, 255, 255, 0.05);
--card-border: rgba(255, 255, 255, 0.1);
--muted: rgba(255, 255, 255, 0.6);
--accent: #3CF2FF;  /* Primary cyan accent */

/* Premium Accent Colors */
Cyan:   #3CF2FF  /* Primary actions, vote buttons */
Purple: #A020F0  /* Gradients */
Pink:   #FF00C7  /* Gradients */
Gold:   #FFD700  /* Achievements, 1st place */
Silver: #9CA3AF  /* 2nd place */
Bronze: #D97706  /* 3rd place */
```

### Custom UI Components

Located in `src/components/ui/`:

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **Modal** | Dialogs | Focus trap, ARIA, keyboard nav |
| **Toast** | Notifications | Success/error/warning types |
| **Skeleton** | Loading states | Pre-built patterns |
| **ThemeToggle** | Theme switch | Dark/light/system modes |

### Animation System

**Framer Motion** for complex animations:
- Page transitions (fade + slide)
- Component entrance/exit
- Gesture interactions (tap, swipe)

**CSS Keyframes** for performance-critical animations:
```css
@keyframes shimmer    /* Loading shimmer */
@keyframes soft-pulse /* Breathing effect */
@keyframes fade-up    /* Entrance animation */
```

### Mobile Responsiveness

**Mobile-First Design:**
- Breakpoints: `sm` (640px), `md` (768px), `lg` (1024px)
- Safe area support for notched devices: `env(safe-area-inset-*)`
- Touch targets: minimum 44x44px
- Swipe gestures for navigation

**Key Responsive Patterns:**
```tsx
// Hide on mobile, show on desktop
<div className="hidden md:flex">...</div>

// Different sizes by breakpoint
<h1 className="text-xl md:text-3xl">...</h1>

// Full width mobile, fixed on desktop
<div className="w-full md:w-96">...</div>
```

### Navigation Structure

```
┌─────────────────────────────────────────┐
│  Navbar (desktop only)                   │
│  - Logo, Round info, User menu           │
├─────────────────────────────────────────┤
│                                          │
│           Page Content                   │
│                                          │
├─────────────────────────────────────────┤
│  BottomNavigation (mobile)               │
│  Vote | Watch | Upload | Ranks | Profile │
└─────────────────────────────────────────┘
```

---

## 5. Voting System

### Overview

The voting system is the heart of AiMoviez. Users vote on 8-second clips to determine which ones become part of the final movie.

### How Voting Works

1. **Seasons** contain multiple **slots** (positions in the movie)
2. Each slot has a **voting period** where users vote on clips
3. The clip with the most votes **wins** the slot
4. When all slots are filled, the season's movie is complete

### Vote Flow

```
User sees clips → Taps vote button → Vote recorded → Score updates
        ↓                                    ↓
   Clip cards          POST /api/vote     Real-time UI update
```

### Database Schema

```sql
-- Votes Table
votes {
  id UUID PRIMARY KEY
  clip_id UUID           -- Which clip received the vote
  voter_key TEXT         -- Device fingerprint (anonymous) or user_${id}
  user_id TEXT           -- Optional: authenticated user ID
  vote_weight INTEGER    -- Usually 1 (power votes could be higher)
  slot_position INTEGER  -- Which slot/round
  flagged BOOLEAN        -- Suspicious activity flag
  created_at TIMESTAMP
}

-- Constraints
UNIQUE(clip_id, voter_key)  -- One vote per user per clip
```

### Key Files

| File | Purpose |
|------|---------|
| `src/app/api/vote/route.ts` | Main voting API (GET, POST, DELETE) |
| `src/app/dashboard/page.tsx` | Voting UI |
| `src/components/VideoCard.tsx` | Vote button component |
| `supabase/sql/migration-vote-trigger.sql` | Auto-update vote counts |

### API Endpoints

**GET /api/vote**
- Returns clips available for voting
- Includes user's remaining votes
- Smart distribution (fair exposure for all clips)

**POST /api/vote**
```typescript
Request: { clipId: string }
Response: {
  success: boolean,
  newScore: number,
  remainingVotes: { standard: number }
}
```

**DELETE /api/vote**
- Revokes a vote
- Updates clip score atomically

### Rate Limiting

- **200 votes per day** per user
- Rate limiting via Upstash Redis
- Device fingerprinting for anonymous users

### Vote Aggregation

Votes are aggregated in the `tournament_clips` table:
```sql
tournament_clips {
  vote_count INTEGER      -- Total votes
  weighted_score INTEGER  -- Weighted sum (for power votes)
  view_count INTEGER      -- Times shown (for fair distribution)
}
```

Database triggers automatically update these counts on INSERT/DELETE.

---

## 6. Comment System

### Overview

TikTok-style comment system with threaded replies, likes, and emoji support.

### Features

- **Slide-up modal** on mobile, side panel on desktop
- **Threaded replies** (1 level deep)
- **Like/unlike** with optimistic updates
- **Emoji picker** (10 preset emojis)
- **Real-time count** updates
- **Character limit:** 500 characters
- **Soft delete** (preserves audit trail)

### Comment Flow

```
User opens comments → Fetches comments → Posts new comment
       ↓                    ↓                   ↓
  CommentsSection     GET /api/comments    POST /api/comments
       ↓                                        ↓
  Optimistic update ←──────────────────── Server response
```

### Database Schema

```sql
-- Comments Table
comments {
  id UUID PRIMARY KEY
  clip_id TEXT NOT NULL
  user_key TEXT NOT NULL       -- Device fingerprint or user_${id}
  username TEXT NOT NULL
  avatar_url TEXT
  comment_text TEXT NOT NULL   -- Max 500 chars
  likes_count INTEGER DEFAULT 0
  parent_comment_id UUID       -- For replies (NULL = top-level)
  is_deleted BOOLEAN DEFAULT FALSE
  created_at TIMESTAMP
  updated_at TIMESTAMP
}

-- Comment Likes Table
comment_likes {
  id UUID PRIMARY KEY
  comment_id UUID NOT NULL
  user_key TEXT NOT NULL
  UNIQUE(comment_id, user_key)  -- One like per user
}
```

### Key Files

| File | Purpose |
|------|---------|
| `src/components/CommentsSection.tsx` | Main comment UI (826 lines) |
| `src/app/api/comments/route.ts` | Comment CRUD API |
| `src/app/api/admin/comments/route.ts` | Admin moderation |
| `src/lib/sanitize.ts` | Comment text sanitization |

### API Endpoints

**GET /api/comments?clipId=xxx**
```typescript
Response: {
  comments: Comment[],
  total: number,
  has_more: boolean
}
```

**POST /api/comments**
```typescript
Request: {
  clipId: string,
  comment_text: string,
  parent_comment_id?: string  // For replies
}
```

**PATCH /api/comments** (Like/Unlike)
```typescript
Request: {
  comment_id: string,
  action: 'like' | 'unlike'
}
```

**DELETE /api/comments**
- Soft delete (sets `is_deleted = true`)
- Only comment owner can delete

### Performance Optimizations

- **Batch fetch replies** in single query (prevents N+1)
- **RPC function** for comment counts: `get_comment_counts(clip_ids[])`
- **Optimistic updates** for likes
- **Pagination:** 20 comments per page

---

## 7. Video Display System

### Three Viewing Interfaces

#### 1. Story Page (`/story`)
**TikTok-style vertical video player**

```
┌─────────────────────────────────┐
│                                 │
│    Full-screen Video Player     │
│    (55% of screen)              │
│                                 │
│    ┌─────┐                      │
│    │Vote │  Action buttons      │
│    │Cmnt │  (right side)        │
│    │Share│                      │
│    └─────┘                      │
├─────────────────────────────────┤
│  Season Strip (horizontal)      │
│  S1 • S2 • S3 ...               │
└─────────────────────────────────┘
```

**Features:**
- Vertical swipe to navigate clips
- Double-tap to toggle fullscreen
- Single-tap to play/pause
- Auto-play on load
- Blurred background video (fills aspect ratio gaps)

#### 2. Dashboard (`/dashboard`)
**Voting arena with card grid**

```
┌─────────────────────────────────┐
│  Round X of Y  │  Time: 23:45   │
├─────────────────────────────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐        │
│  │Card1│ │Card2│ │Card3│        │
│  │ 45▲ │ │ 32▲ │ │ 67▲ │        │
│  └─────┘ └─────┘ └─────┘        │
│  ┌─────┐ ┌─────┐ ┌─────┐        │
│  │Card4│ │Card5│ │Card6│        │
│  │ 12▲ │ │ 89▲ │ │ 23▲ │        │
│  └─────┘ └─────┘ └─────┘        │
└─────────────────────────────────┘
```

**Features:**
- Grid of video cards
- Tap to vote
- Shows vote counts with animations
- Remaining votes display

#### 3. Watch Page (`/watch`)
**Movie library and playback**

```
┌─────────────────────────────────┐
│  Season Library                  │
│  ┌────┐ ┌────┐ ┌────┐           │
│  │ S1 │ │ S2 │ │ S3 │           │
│  │ ▶  │ │ ▶  │ │ 🔒 │           │
│  └────┘ └────┘ └────┘           │
└─────────────────────────────────┘

         ↓ Select season ↓

┌─────────────────────────────────┐
│  ┌─────────────────┐  Playlist  │
│  │                 │  ┌──┐ S1   │
│  │  Video Player   │  │▶ │ S2   │
│  │                 │  │  │ S3   │
│  └─────────────────┘  └──┘      │
│  ◄◄  ▶  ►►    ▬▬▬▬▬▬▬▬▬  🔊    │
└─────────────────────────────────┘
```

**Features:**
- Library view of completed seasons
- Full video player with controls
- Playlist sidebar
- Video preloading (next 2 clips)

### Video Player Implementation

Located in `src/app/story/page.tsx` (lines 247-1056):

**Key State:**
```typescript
currentIndex: number    // Current clip playing
isPlaying: boolean      // Play/pause state
isMuted: boolean        // Mute state
videoLoaded: boolean    // Ready to play
```

**Gesture Detection:**
```typescript
// Vertical swipe (min 50px)
Swipe up   → Next clip
Swipe down → (reserved)

// Taps
Single tap  → Play/pause
Double tap  → Fullscreen toggle
```

### Key Files

| File | Purpose |
|------|---------|
| `src/app/story/page.tsx` | Main video player (~2000 lines) |
| `src/app/watch/page.tsx` | Movie library & player |
| `src/app/dashboard/page.tsx` | Voting card grid |
| `src/components/VideoCard.tsx` | Individual clip card |
| `src/hooks/useLandscapeVideo.ts` | Landscape mode handling |

---

## 8. Content Distribution Algorithm

### Fair Distribution Philosophy

Every clip gets **equal exposure** regardless of when it was uploaded or how popular the creator is.

### Algorithm Overview

```
1. Fetch unvoted clips first
2. Prioritize fresh clips (<2 hours old)
3. Lower view_count = higher priority
4. Add random jitter for variety
5. Shuffle final results
```

### Implementation Details

Located in `src/app/api/vote/route.ts` (lines 433-494):

```typescript
// Priority Order
1. Unvoted + Unseen clips (fresh content)
2. Unvoted + Seen clips (seen but not voted)
3. Voted clips (last resort)

// Within each category:
- Fresh clips (< 2 hours) prioritized
- Lower view_count = higher priority
- Random jitter (±50) added to view_count
- Final shuffle for variety
```

### Database-Side Randomization

**RPC Function:** `get_clips_randomized()`
```sql
Parameters:
  p_slot_position  -- Current voting slot
  p_season_id      -- Active season
  p_exclude_ids    -- Client-excluded clips
  p_limit          -- Max clips to return
  p_jitter         -- Random variance (default: 50)

Returns:
  Clips ordered by (view_count + random_jitter)
```

### Why No Per-User Tracking?

Traditional systems track what each user has seen. AiMoviez uses **view_count + random jitter** instead:

| Approach | Pros | Cons |
|----------|------|------|
| Per-user tracking | Precise | Expensive storage, doesn't scale |
| view_count + jitter | Scales infinitely, simple | Slightly less precise |

The current approach scales to millions of users without expensive per-user storage.

### Clip Scoring

```typescript
tournament_clips {
  vote_count: number      // Raw vote count
  weighted_score: number  // For power votes
  view_count: number      // Times shown to users
  hype_score: number      // Engagement metric
}
```

---

## 9. Database Schema

### Core Tables

```
┌─────────────────┐     ┌─────────────────┐
│     seasons     │     │   story_slots   │
├─────────────────┤     ├─────────────────┤
│ id              │────<│ season_id       │
│ name            │     │ slot_position   │
│ genre           │     │ status          │
│ status          │     │ winning_clip_id │
│ created_at      │     │ ends_at         │
└─────────────────┘     └─────────────────┘
                                │
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│tournament_clips │     │     votes       │     │    comments     │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id              │     │ id              │     │ id              │
│ season_id       │     │ clip_id         │────>│ clip_id         │
│ slot_position   │     │ voter_key       │     │ user_key        │
│ video_url       │     │ vote_weight     │     │ comment_text    │
│ vote_count      │     │ created_at      │     │ likes_count     │
│ weighted_score  │     └─────────────────┘     │ parent_comment_id│
│ view_count      │                             └─────────────────┘
│ creator_id      │
│ status          │
└─────────────────┘
        │
        │
        ▼
┌─────────────────┐
│     users       │
├─────────────────┤
│ id              │
│ email           │
│ username        │
│ avatar_url      │
│ is_admin        │
│ created_at      │
└─────────────────┘
```

### Table Descriptions

| Table | Purpose |
|-------|---------|
| `seasons` | Tournament seasons with genre themes |
| `story_slots` | Positions in the final movie (1-n) |
| `tournament_clips` | Uploaded video clips |
| `votes` | User votes on clips |
| `comments` | Comment threads |
| `comment_likes` | Comment likes |
| `users` | User profiles |
| `genre_votes` | Votes for next season's genre |
| `audit_logs` | Admin action audit trail |

### Key Indexes

```sql
idx_votes_voter_created(voter_key, created_at)  -- Daily vote counting
idx_votes_voter_slot(voter_key, slot_position)  -- Slot-specific votes
idx_clips_season_slot(season_id, slot_position) -- Clip queries
idx_comments_clip_id(clip_id)                   -- Comment lookups
```

---

## 10. API Reference

### Authentication

All API routes check authentication via NextAuth session. Some routes allow anonymous access with device fingerprinting.

### Core Endpoints

#### Voting
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/vote` | Get clips for voting + user stats |
| POST | `/api/vote` | Cast a vote |
| DELETE | `/api/vote` | Revoke a vote |
| POST | `/api/genre-vote` | Vote for next season's genre |

#### Content
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/story` | Get season/slot data |
| GET | `/api/clip/[id]` | Get single clip details |
| GET | `/api/discover` | Search/browse clips |

#### Comments
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/comments` | Fetch comments for a clip |
| POST | `/api/comments` | Post a new comment |
| PATCH | `/api/comments` | Like/unlike a comment |
| DELETE | `/api/comments` | Delete own comment |

#### Upload
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/upload/signed-url` | Get S3 signed URL |
| POST | `/api/upload/register` | Register uploaded video |

#### User
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/user/profile` | Get user profile |
| POST | `/api/user/create-profile` | Create profile |
| GET | `/api/user/check-username` | Check availability |
| POST | `/api/user/follow` | Follow a user |

#### Leaderboard
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/leaderboard/clips` | Top clips |
| GET | `/api/leaderboard/creators` | Top creators |
| GET | `/api/leaderboard/voters` | Top voters |

### Error Responses

```typescript
{
  error: string,       // Error message
  code?: string,       // Error code (e.g., 'RATE_LIMIT_EXCEEDED')
  details?: object     // Additional context
}
```

### Rate Limits

| Operation | Limit |
|-----------|-------|
| Votes | 200/day per user |
| Comments | Rate limited |
| API calls | Varies by endpoint |

---

## 11. Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account
- AWS S3 bucket (for video storage)

### Environment Variables

Create `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key

# NextAuth
NEXTAUTH_SECRET=your_secret
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Google OAuth
GOOGLE_ID=your_google_client_id
GOOGLE_SECRET=your_google_client_secret

# AWS S3
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=your_region
AWS_S3_BUCKET=your_bucket

# Rate Limiting
UPSTASH_REDIS_REST_URL=your_upstash_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_token

# Optional
HCAPTCHA_SECRET=your_hcaptcha_secret
SENTRY_DSN=your_sentry_dsn
```

### Installation

```bash
# Clone the repository
git clone [repository-url]
cd aimoviez-app

# Install dependencies
npm install

# Run database migrations
# (Apply SQL files in supabase/sql/ to your Supabase project)

# Start development server
npm run dev

# Open http://localhost:3000
```

### Development Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run lint     # Run ESLint
npm test         # Run tests
```

### Key Areas to Explore First

1. **`src/app/dashboard/page.tsx`** - Main voting interface
2. **`src/app/story/page.tsx`** - Video player & story view
3. **`src/app/api/vote/route.ts`** - Voting logic
4. **`src/components/`** - UI components
5. **`src/lib/`** - Utility functions

---

## Questions?

- Check existing documentation in `/Dokumentacja/`
- Review code comments (key functions are documented)
- Look at TypeScript types in `src/types/index.ts`

Welcome to the team! 🎬
