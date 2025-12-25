# AiMoviez - Complete Technical Documentation

> **Version:** 2.0.0
> **Last Updated:** December 2025
> **Platform:** Next.js 15 Full-Stack Application
> **Live URL:** https://aimoviez.vercel.app

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Project Structure](#4-project-structure)
5. [Getting Started](#5-getting-started)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
8. [Components](#8-components)
9. [Custom Hooks](#9-custom-hooks)
10. [Utilities & Libraries](#10-utilities--libraries)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [Real-time Features](#12-real-time-features)
13. [Security](#13-security)
14. [Feature Flags](#14-feature-flags)
15. [Deployment](#15-deployment)
16. [Environment Variables](#16-environment-variables)
17. [Database Migrations](#17-database-migrations)
18. [Testing](#18-testing)
19. [Performance](#19-performance)
20. [Troubleshooting](#20-troubleshooting)

---

## 1. Project Overview

### What is AiMoviez?

AiMoviez is a collaborative, community-driven voting platform where users collectively create an **8-second global movie** by voting on short video clips submitted by creators. The application combines democratic content selection, competitive clip submission, and real-time social engagement.

### Core Concept

- **75-Slot Movie System**: Each season consists of 75 voting slots, each representing 1 second of the final movie
- **Hybrid Voting**: Standard (1x), Super (3x), and Mega (10x) vote multipliers
- **Genre Rotation**: Comedy, Thriller, Action, and Animation cycle through slots
- **Creator Competition**: Clips compete for the winning spot in each slot
- **XP & Leveling**: Users earn XP for voting and climb leaderboards

### Key Metrics

| Metric | Value |
|--------|-------|
| Daily vote limit | 200 votes per user |
| Super votes | 1 per round (3x weight) |
| Mega votes | 1 per round (10x weight) |
| Video max length | 8 seconds |
| File size limit | 100MB |
| Total slots per season | 75 |
| Genres | 4 (Comedy, Thriller, Action, Animation) |

### User Flow

```
New User → Landing Page → Sign In (Google) → Dashboard (Voting Arena)
                                                    ↓
                              Vote on Clips ← → Upload Clip → Story Timeline
                                    ↓
                            Leaderboard ← → Profile → Watch Full Movie
```

---

## 2. Tech Stack

### Core Framework

| Technology | Version | Purpose |
|------------|---------|---------|
| **Next.js** | 15.5.7 | React framework with App Router |
| **React** | 19.2.0 | UI library |
| **TypeScript** | 5.x | Type safety |
| **Node.js** | 18+ | Runtime environment |

### Database & Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Supabase** | 2.84.0 | PostgreSQL database + Auth + Storage |
| **Upstash Redis** | 1.35.7 | Rate limiting & caching |
| **Upstash Ratelimit** | 2.0.7 | Request rate limiting |

### Authentication & Security

| Technology | Version | Purpose |
|------------|---------|---------|
| **NextAuth** | 4.24.13 | OAuth2/JWT authentication |
| **hCaptcha** | 1.16.0 | Bot prevention |
| **Sentry** | 10.28.0 | Error tracking |
| **Zod** | 4.1.13 | Runtime schema validation |

### UI & Styling

| Technology | Version | Purpose |
|------------|---------|---------|
| **Tailwind CSS** | 4.x | Utility-first CSS |
| **Framer Motion** | 12.23.24 | Animations |
| **Lucide React** | 0.553.0 | Icon library |
| **Canvas Confetti** | 1.9.4 | Celebration effects |
| **React Hot Toast** | 2.6.0 | Toast notifications |
| **CLSX** | 2.1.1 | Conditional classnames |
| **Tailwind Merge** | 3.4.0 | Merge Tailwind classes |

### State Management

| Technology | Version | Purpose |
|------------|---------|---------|
| **TanStack React Query** | 5.90.10 | Server state management |
| **React Context** | (built-in) | Auth state |
| **Supabase Realtime** | (built-in) | WebSocket subscriptions |

---

## 3. Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                         │
├─────────────────────────────────────────────────────────────────┤
│  Next.js App Router │ React 19 │ TanStack Query │ Framer Motion │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NEXT.JS API ROUTES                          │
├─────────────────────────────────────────────────────────────────┤
│  Authentication │ Validation │ Rate Limiting │ CSRF Protection  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    SUPABASE     │  │  UPSTASH REDIS  │  │   EXTERNAL      │
│  (PostgreSQL)   │  │  (Rate Limit)   │  │   SERVICES      │
├─────────────────┤  ├─────────────────┤  ├─────────────────┤
│ • Database      │  │ • Rate limiting │  │ • Google OAuth  │
│ • Realtime      │  │ • Caching       │  │ • hCaptcha      │
│ • Storage       │  │ • Session data  │  │ • Sentry        │
│ • Auth (unused) │  │                 │  │ • DiceBear      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Data Flow

```
User Action → React Component → TanStack Query → API Route
                                                     │
                    ┌────────────────────────────────┤
                    │                                │
                    ▼                                ▼
             Rate Limiter ───► Validation ───► Database Operation
                    │                                │
                    │                                ▼
                    │                         Supabase Realtime
                    │                                │
                    ▼                                ▼
              Response ◄─────────────────── Broadcast to Clients
```

### Season Management Flow

```
Admin Creates Season ──► Season Status: 'active'
         │
         ▼
   First Clip Uploaded ──► Timer Starts (24h countdown)
         │
         ▼
   Voting Period Active ──► Users vote on clips
         │
         ▼
   Timer Expires ──► Auto-advance to next slot OR Admin assigns winner
         │
         ▼
   Slot 75 Complete ──► Season ends ──► Admin creates new season
```

---

## 4. Project Structure

```
aimoviez-app/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/                      # API routes (27 directories)
│   │   │   ├── admin/                # Admin endpoints (18 routes)
│   │   │   │   ├── advance-slot/     # Move to next slot
│   │   │   │   ├── approve/          # Approve pending clips
│   │   │   │   ├── assign-winner/    # Set slot winner
│   │   │   │   ├── audit-logs/       # View admin actions
│   │   │   │   ├── bulk/             # Bulk operations
│   │   │   │   ├── clips/            # Clip management
│   │   │   │   ├── comments/         # Comment moderation
│   │   │   │   ├── feature-flags/    # Toggle features
│   │   │   │   ├── moderation/       # Content moderation
│   │   │   │   ├── reject/           # Reject clips
│   │   │   │   ├── reset-season/     # Reset season data
│   │   │   │   ├── reset-user-votes/ # Reset user votes
│   │   │   │   ├── seasons/          # Season CRUD
│   │   │   │   ├── slots/            # Slot management
│   │   │   │   ├── stats/            # Analytics
│   │   │   │   └── users/            # User management
│   │   │   ├── auth/[...nextauth]/   # NextAuth handler
│   │   │   ├── account/              # Account management
│   │   │   ├── captcha/              # CAPTCHA verification
│   │   │   ├── clip/[id]/            # Clip details
│   │   │   ├── comments/             # Comments CRUD
│   │   │   ├── contact/              # Contact form
│   │   │   ├── creator/              # Creator profiles
│   │   │   ├── cron/                 # Scheduled tasks
│   │   │   ├── csrf/                 # CSRF token
│   │   │   ├── discover/             # Search & discovery
│   │   │   ├── features/             # Feature flags
│   │   │   ├── genre-vote/           # Genre voting
│   │   │   ├── genres/               # Genre data
│   │   │   ├── health/               # Health check
│   │   │   ├── leaderboard/          # Rankings (4 endpoints)
│   │   │   ├── notifications/        # User notifications
│   │   │   ├── profile/              # User profile
│   │   │   ├── referral/             # Referral system
│   │   │   ├── report/               # Content reporting
│   │   │   ├── story/                # Season/slot data
│   │   │   ├── upload/               # Video upload (3 endpoints)
│   │   │   ├── user/                 # User operations
│   │   │   ├── vote/                 # Voting system
│   │   │   └── watch/                # Movie playback
│   │   │
│   │   ├── about/                    # About page
│   │   ├── admin/                    # Admin dashboard
│   │   ├── clip/[id]/                # Clip detail page
│   │   ├── contact/                  # Contact form
│   │   ├── dashboard/                # Main voting arena
│   │   ├── join/[code]/              # Referral join
│   │   ├── leaderboard/              # Rankings page
│   │   ├── onboarding/               # First-time user guide
│   │   ├── privacy/                  # Privacy policy
│   │   ├── profile/                  # User profile
│   │   ├── search/                   # Search page
│   │   ├── settings/                 # User settings
│   │   ├── story/                    # Season timeline
│   │   ├── terms/                    # Terms of service
│   │   ├── upload/                   # Upload page
│   │   ├── watch/                    # Watch full movie
│   │   ├── page.tsx                  # Landing page
│   │   ├── layout.tsx                # Root layout
│   │   ├── providers.tsx             # Client providers
│   │   ├── globals.css               # Global styles
│   │   ├── global-error.tsx          # Error fallback
│   │   └── template.tsx              # Page template
│   │
│   ├── components/                   # React components (22)
│   │   ├── BottomNavigation.tsx      # Mobile tab bar
│   │   ├── CaptchaVerification.tsx   # hCaptcha wrapper
│   │   ├── CommentsSection.tsx       # Comments panel
│   │   ├── CookieConsent.tsx         # GDPR consent
│   │   ├── EnhancedUploadArea.tsx    # Drag-drop upload
│   │   ├── ErrorBoundary.tsx         # Error catching
│   │   ├── HypeMeter.tsx             # Activity gauge
│   │   ├── Leaderboard.tsx           # Full rankings
│   │   ├── MiniLeaderboard.tsx       # Compact rankings
│   │   ├── Navbar.tsx                # Top navigation
│   │   ├── NotificationSettings.tsx  # Push settings
│   │   ├── OnboardingTour.tsx        # New user guide
│   │   ├── PageTransition.tsx        # Page animations
│   │   ├── ReferralSection.tsx       # Referral UI
│   │   ├── ReportModal.tsx           # Report dialog
│   │   ├── ServiceWorkerRegistration # PWA support
│   │   ├── Skeletons.tsx             # Loading states
│   │   ├── StoryProgressBar.tsx      # Progress indicator
│   │   ├── StoryTimeline.tsx         # Timeline view
│   │   ├── UploadPanel.tsx           # Upload workflow
│   │   ├── VideoCard.tsx             # Clip preview
│   │   └── ui/                       # Base UI components
│   │
│   ├── hooks/                        # Custom hooks (8)
│   │   ├── useAdminAuth.ts           # Admin auth check
│   │   ├── useAuth.tsx               # Auth state
│   │   ├── useCountdown.ts           # Timer logic
│   │   ├── useCsrf.ts                # CSRF tokens
│   │   ├── useFeatureFlags.ts        # Feature toggles
│   │   ├── useFocusTrap.ts           # A11y focus
│   │   ├── useMockData.ts            # Dev mock data
│   │   └── useRealtimeClips.ts       # Supabase realtime
│   │
│   ├── lib/                          # Utilities (20)
│   │   ├── admin-auth.ts             # Admin verification
│   │   ├── api-errors.ts             # Error handling
│   │   ├── api-utils.ts              # API helpers
│   │   ├── audit-log.ts              # Audit logging
│   │   ├── auth-options.ts           # NextAuth config
│   │   ├── captcha.ts                # hCaptcha verify
│   │   ├── csrf.ts                   # CSRF protection
│   │   ├── device-fingerprint.ts     # Device ID
│   │   ├── genre.tsx                 # Genre utilities
│   │   ├── logger.ts                 # Request logging
│   │   ├── monitoring.ts             # Performance
│   │   ├── notifications.ts          # Notification helpers
│   │   ├── push-notifications.ts     # Push API
│   │   ├── rate-limit.ts             # Rate limiting
│   │   ├── sanitize.ts               # Input sanitization
│   │   ├── sounds.ts                 # Audio management
│   │   ├── supabase-client.ts        # Supabase factory
│   │   ├── utils.ts                  # General utilities
│   │   ├── validations.ts            # Zod schemas
│   │   └── video-storage.ts          # Storage operations
│   │
│   ├── types/                        # TypeScript definitions
│   │   └── index.ts                  # All shared types
│   │
│   └── __tests__/                    # Unit tests
│
├── supabase/
│   └── sql/                          # Database migrations (40+ files)
│
├── public/                           # Static assets
│   ├── videos/                       # Sample videos
│   └── ...                           # Icons, images
│
├── docs/                             # Documentation
│   ├── PROJECT_DOCUMENTATION.md
│   ├── SEASON_MANAGEMENT_RECOVERY.md
│   ├── HYBRID-VOTING-SYSTEM.md
│   └── ...
│
├── .env.local                        # Development env
├── .env.production                   # Production env
├── next.config.ts                    # Next.js config
├── tsconfig.json                     # TypeScript config
├── jest.config.js                    # Jest config
├── middleware.ts                     # Next.js middleware
└── package.json                      # Dependencies
```

---

## 5. Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account
- Google Cloud Console (OAuth credentials)
- Upstash Redis account (optional, for rate limiting)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd aimoviez-app

# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Configure environment variables (see Section 16)

# Run database migrations (see Section 17)

# Start development server
npm run dev
```

### Available Scripts

```bash
npm run dev           # Start development server (http://localhost:3000)
npm run build         # Production build
npm run start         # Start production server
npm run lint          # Run ESLint
npm run test          # Run Jest tests
npm run test:watch    # Watch mode testing
npm run test:coverage # Coverage report
```

### First Run Checklist

1. [ ] Configure Supabase project and get credentials
2. [ ] Set up Google OAuth in Google Cloud Console
3. [ ] Create `.env.local` with required variables
4. [ ] Run database migrations via Supabase SQL Editor
5. [ ] Create first season via admin panel or SQL
6. [ ] Add your email to `ALLOWED_EMAILS`
7. [ ] Start dev server and sign in
8. [ ] Access admin panel at `/admin`

---

## 6. Database Schema

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────────────┐
│   seasons   │──1:N──│ story_slots │──1:N──│  tournament_clips   │
└─────────────┘       └─────────────┘       └─────────────────────┘
                             │                        │
                             │                        │
                      winner_clip_id              user_id
                             │                        │
                             ▼                        ▼
                      ┌─────────────────────┐  ┌─────────────┐
                      │  tournament_clips   │  │    users    │
                      └─────────────────────┘  └─────────────┘
                                                      │
                      ┌───────────────────────────────┼───────────────────────────────┐
                      │                               │                               │
                      ▼                               ▼                               ▼
               ┌─────────────┐               ┌─────────────┐               ┌─────────────┐
               │    votes    │               │  comments   │               │  followers  │
               └─────────────┘               └─────────────┘               └─────────────┘
```

### Core Tables

#### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  device_key TEXT,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  total_votes_cast INTEGER DEFAULT 0,
  total_votes_received INTEGER DEFAULT 0,
  clips_uploaded INTEGER DEFAULT 0,
  clips_locked INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  is_banned BOOLEAN DEFAULT false,
  role TEXT DEFAULT 'user',  -- 'user' | 'admin'
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### seasons
```sql
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  label TEXT,
  status TEXT DEFAULT 'draft',  -- 'draft' | 'active' | 'finished'
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  total_slots INTEGER DEFAULT 75,
  current_slot INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### story_slots
```sql
CREATE TABLE story_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES seasons(id),
  slot_position INTEGER NOT NULL,
  genre TEXT,  -- 'COMEDY' | 'THRILLER' | 'ACTION' | 'ANIMATION'
  status TEXT DEFAULT 'upcoming',  -- 'upcoming' | 'voting' | 'locked'
  winner_tournament_clip_id UUID REFERENCES tournament_clips(id),
  voting_started_at TIMESTAMPTZ,
  voting_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, slot_position)
);
```

#### tournament_clips
```sql
CREATE TABLE tournament_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  season_id UUID REFERENCES seasons(id),
  slot_id UUID REFERENCES story_slots(id),
  slot_position INTEGER,
  title TEXT,
  description TEXT,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  genre TEXT,
  duration FLOAT,
  status TEXT DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  vote_count INTEGER DEFAULT 0,
  weighted_score INTEGER DEFAULT 0,
  hype_score FLOAT DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### votes
```sql
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID REFERENCES tournament_clips(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,  -- device fingerprint or user_id
  user_id UUID REFERENCES users(id),
  vote_weight INTEGER DEFAULT 1,  -- 1, 3, or 10
  vote_type TEXT DEFAULT 'standard',  -- 'standard' | 'super' | 'mega'
  slot_position INTEGER,
  flagged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(voter_key, clip_id)  -- One vote per clip per user
);
```

#### comments
```sql
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id TEXT NOT NULL,
  user_key TEXT NOT NULL,
  username TEXT NOT NULL,
  avatar_url TEXT,
  comment_text TEXT NOT NULL CHECK (char_length(comment_text) <= 500),
  likes_count INTEGER DEFAULT 0,
  parent_comment_id UUID REFERENCES comments(id),
  is_deleted BOOLEAN DEFAULT false,
  moderation_status TEXT DEFAULT 'approved',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### comment_likes
```sql
CREATE TABLE comment_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comment_id, user_key)
);
```

#### genre_votes
```sql
CREATE TABLE genre_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_number INTEGER NOT NULL,
  genre_code TEXT NOT NULL,
  voter_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### feature_flags
```sql
CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT,
  description TEXT,
  enabled BOOLEAN DEFAULT false,
  category TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### audit_logs
```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users(id),
  admin_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  changes JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### notifications
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_key TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_url TEXT,
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### followers
```sql
CREATE TABLE followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);
```

### Key Indexes

```sql
-- Vote performance
CREATE INDEX idx_votes_voter_key_date ON votes(voter_key, DATE(created_at));
CREATE INDEX idx_votes_clip_id ON votes(clip_id);
CREATE INDEX idx_votes_user_id ON votes(user_id);

-- Clip queries
CREATE INDEX idx_clips_slot_votes ON tournament_clips(slot_id, weighted_score DESC);
CREATE INDEX idx_clips_weighted_score ON tournament_clips(weighted_score DESC);
CREATE INDEX idx_clips_user_id ON tournament_clips(user_id);
CREATE INDEX idx_clips_status ON tournament_clips(status);

-- Slot queries
CREATE INDEX idx_slots_season_status ON story_slots(season_id, status);
CREATE INDEX idx_slots_voting ON story_slots(status) WHERE status = 'voting';

-- Comment queries
CREATE INDEX idx_comments_clip_id ON comments(clip_id, created_at DESC);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);

-- User queries
CREATE INDEX idx_users_xp ON users(xp DESC);
CREATE INDEX idx_users_level ON users(level DESC);
CREATE INDEX idx_users_email ON users(email);
```

### Database Triggers

```sql
-- Auto-update follower counts
CREATE OR REPLACE FUNCTION update_follower_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET followers_count = followers_count - 1 WHERE id = OLD.following_id;
    UPDATE users SET following_count = following_count - 1 WHERE id = OLD.follower_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER followers_count_trigger
AFTER INSERT OR DELETE ON followers
FOR EACH ROW EXECUTE FUNCTION update_follower_counts();
```

---

## 7. API Reference

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth handler | - |
| GET | `/api/csrf` | Generate CSRF token | - |

### Voting System

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/vote` | Get voting state & clips | 30/min |
| POST | `/api/vote` | Cast vote | 30/min |
| DELETE | `/api/vote` | Revoke vote | 30/min |
| POST | `/api/genre-vote` | Vote on genre preference | 30/min |

**POST /api/vote Request:**
```typescript
{
  clipId: string;
  voteType: 'standard' | 'super' | 'mega';
  captchaToken?: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  clipId: string;
  voteType: string;
  newScore: number;
  totalVotesToday?: number;
  remainingVotes?: {
    standard: number;  // out of 200
    super: number;     // 0 or 1
    mega: number;      // 0 or 1
  };
  error?: string;
  code?: 'ALREADY_VOTED' | 'DAILY_LIMIT' | 'SUPER_LIMIT' | 'MEGA_LIMIT';
}
```

### Story/Season

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/story` | Get season & slots data | 120/min |
| GET | `/api/genres` | Get genre voting results | 120/min |
| POST | `/api/genres` | Submit genre vote | 30/min |

### Upload

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| POST | `/api/upload/signed-url` | Get signed upload URL | 5/min |
| POST | `/api/upload/register` | Register clip metadata | 5/min |

### Comments

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/comments?clipId=` | Get comments for clip | 120/min |
| POST | `/api/comments` | Create comment | 15/min |
| DELETE | `/api/comments` | Delete comment | 15/min |
| POST | `/api/comments/like` | Like/unlike comment | 60/min |

### Leaderboard

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/leaderboard/creators` | Top creators | 120/min |
| GET | `/api/leaderboard/voters` | Top voters | 120/min |
| GET | `/api/leaderboard/clips` | Top clips | 120/min |
| GET | `/api/leaderboard/live` | Real-time data | 120/min |

### User Profile

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/profile` | Get current user profile | 120/min |
| GET | `/api/profile/stats` | User statistics | 120/min |
| GET | `/api/profile/clips` | User's clips | 120/min |
| POST | `/api/user/create-profile` | Create profile | 5/min |
| POST | `/api/user/check-username` | Check availability | 60/min |

### Discovery

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/discover?q=` | Search clips & creators | 120/min |
| GET | `/api/clip/[id]` | Get clip details | 120/min |
| GET | `/api/creator/[id]` | Get creator profile | 120/min |

### Notifications

| Method | Endpoint | Description | Rate Limit |
|--------|----------|-------------|------------|
| GET | `/api/notifications` | Get notifications | 120/min |
| POST | `/api/notifications/read` | Mark as read | 60/min |

### Admin Endpoints (Require Admin Role)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Analytics & metrics |
| GET/POST | `/api/admin/seasons` | Season CRUD |
| GET/PUT | `/api/admin/slots` | Slot management |
| GET/DELETE | `/api/admin/clips` | Clip management |
| POST | `/api/admin/approve` | Approve clip |
| POST | `/api/admin/reject` | Reject clip |
| POST | `/api/admin/assign-winner` | Set slot winner |
| POST | `/api/admin/advance-slot` | Advance to next slot |
| GET/PUT/DELETE | `/api/admin/users` | User management |
| GET/DELETE | `/api/admin/comments` | Comment moderation |
| GET | `/api/admin/audit-logs` | View audit trail |
| GET/POST/PUT | `/api/admin/feature-flags` | Feature toggles |
| POST | `/api/admin/reset-season` | Reset season |
| POST | `/api/admin/reset-user-votes` | Reset user votes |
| POST | `/api/admin/bulk` | Bulk operations |

### Utility Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/features` | Feature flags |
| POST | `/api/contact` | Contact form |
| POST | `/api/report` | Report content |
| POST | `/api/account/delete` | Delete account |
| POST | `/api/account/export` | Export data (GDPR) |
| GET | `/api/watch` | Full movie data |

### API Response Format

**Success:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

---

## 8. Components

### Core Components

#### CommentsSection
Full-featured comments panel with threading, likes, and moderation.

**File:** `src/components/CommentsSection.tsx`

```tsx
<CommentsSection
  clipId={clipId}
  isOpen={showComments}
  onClose={() => setShowComments(false)}
  clipUsername={creatorUsername}
/>
```

**Features:**
- Nested replies (one level)
- Like/unlike with optimistic updates
- Real-time loading
- Delete own comments
- TikTok-style slide-up on mobile

#### EnhancedUploadArea
Drag-and-drop video upload with validation.

**File:** `src/components/EnhancedUploadArea.tsx`

```tsx
<EnhancedUploadArea
  onFileSelect={(file) => handleFile(file)}
  onError={(error) => showError(error)}
  maxSize={100 * 1024 * 1024}
  acceptedFormats={['video/mp4', 'video/quicktime', 'video/webm']}
/>
```

**Features:**
- Drag & drop support
- File type validation
- Size limit enforcement
- Duration validation
- Magic byte verification
- Progress indication

#### MiniLeaderboard
Compact real-time ranking display.

**File:** `src/components/MiniLeaderboard.tsx`

```tsx
<MiniLeaderboard
  currentClipId={clipId}
  onClipSelect={(id) => navigateToClip(id)}
  isCollapsed={collapsed}
  onToggleCollapse={() => setCollapsed(!collapsed)}
/>
```

#### Navbar
Top navigation with scene info and countdown.

**File:** `src/components/Navbar.tsx`

```tsx
<Navbar currentSlot={5} totalSlots={75} votingEndsAt={endsAt} />
```

#### BottomNavigation
Mobile tab bar navigation.

**File:** `src/components/BottomNavigation.tsx`

```tsx
<BottomNavigation currentPath="/dashboard" />
```

**Tabs:**
- Story - Season timeline
- Watch - Full movie
- Upload - Upload clip
- Ranks - Leaderboard
- Profile - User profile

### All Components Reference

| Component | File | Purpose |
|-----------|------|---------|
| BottomNavigation | BottomNavigation.tsx | Mobile tab bar |
| CaptchaVerification | CaptchaVerification.tsx | hCaptcha wrapper |
| CommentsSection | CommentsSection.tsx | Comments panel |
| CookieConsent | CookieConsent.tsx | GDPR consent banner |
| EnhancedUploadArea | EnhancedUploadArea.tsx | Upload interface |
| ErrorBoundary | ErrorBoundary.tsx | Error catching |
| HypeMeter | HypeMeter.tsx | Activity gauge |
| Leaderboard | Leaderboard.tsx | Full rankings |
| MiniLeaderboard | MiniLeaderboard.tsx | Compact rankings |
| Navbar | Navbar.tsx | Top navigation |
| NotificationSettings | NotificationSettings.tsx | Push settings |
| OnboardingTour | OnboardingTour.tsx | New user guide |
| PageTransition | PageTransition.tsx | Page animations |
| ReferralSection | ReferralSection.tsx | Referral UI |
| ReportModal | ReportModal.tsx | Report dialog |
| ServiceWorkerRegistration | ServiceWorkerRegistration.tsx | PWA support |
| Skeletons | Skeletons.tsx | Loading states |
| StoryProgressBar | StoryProgressBar.tsx | Progress bar |
| StoryTimeline | StoryTimeline.tsx | Timeline view |
| UploadPanel | UploadPanel.tsx | Upload workflow |
| VideoCard | VideoCard.tsx | Clip preview card |

---

## 9. Custom Hooks

### useAuth
Authentication state management with profile checking.

**File:** `src/hooks/useAuth.tsx`

```tsx
const {
  isLoading,
  isAuthenticated,
  hasProfile,
  user,
  session,
  signIn,
  signOut
} = useAuth();

if (isLoading) return <Spinner />;
if (!isAuthenticated) return <LoginPrompt />;
if (!hasProfile) return <CreateProfile />;
```

### useRealtimeClips
Supabase realtime subscription for clip updates.

**File:** `src/hooks/useRealtimeClips.ts`

```tsx
const { clips, isConnected, error } = useRealtimeClips(slotId, {
  onUpdate: (clip) => console.log('Clip updated:', clip),
  onWinner: (clipId) => console.log('Winner selected:', clipId),
});
```

**Features:**
- Automatic reconnection with exponential backoff
- Visibility change handling
- Error recovery
- Callback refs to prevent re-subscription

### useCountdown
Timer functionality for voting countdowns.

**File:** `src/hooks/useCountdown.ts`

```tsx
const { timeRemaining, isExpired, formatted } = useCountdown(votingEndsAt);

return <span>{formatted.hours}:{formatted.minutes}:{formatted.seconds}</span>;
```

### useCsrf
CSRF token management for secure requests.

**File:** `src/hooks/useCsrf.ts`

```tsx
const { post, put, del, token, isLoading } = useCsrf();

// Automatically includes CSRF token
await post('/api/vote', { clipId, voteType });
```

### useFeatureFlags
Feature flag checking and caching.

**File:** `src/hooks/useFeatureFlags.ts`

```tsx
const { enabled, loading, error } = useFeature('referral_system');

if (enabled) {
  return <ReferralSection />;
}
```

### useAdminAuth
Admin authentication verification.

**File:** `src/hooks/useAdminAuth.ts`

```tsx
const { isAdmin, isLoading, error } = useAdminAuth();

if (!isAdmin) return <AccessDenied />;
```

### useFocusTrap
Accessibility focus management for modals.

**File:** `src/hooks/useFocusTrap.ts`

```tsx
const modalRef = useFocusTrap(isOpen);

return <div ref={modalRef}>{/* Modal content */}</div>;
```

### useMockData
Development mock data generation.

**File:** `src/hooks/useMockData.ts`

```tsx
const { clips, users, votes, seasons } = useMockData();
```

---

## 10. Utilities & Libraries

### Rate Limiting
**File:** `src/lib/rate-limit.ts`

```typescript
import { rateLimit } from '@/lib/rate-limit';

// In API route
const rateLimitResponse = await rateLimit(req, 'vote');
if (rateLimitResponse) return rateLimitResponse;
```

**Limits by Type:**
| Type | Requests | Window |
|------|----------|--------|
| vote | 30 | 1 minute |
| upload | 5 | 1 minute |
| comment | 15 | 1 minute |
| api | 60 | 1 minute |
| admin | 50 | 1 minute |
| read | 120 | 1 minute |
| auth | 5 | 1 minute |

### CSRF Protection
**File:** `src/lib/csrf.ts`

```typescript
import { validateCsrfToken, generateCsrfToken } from '@/lib/csrf';

const token = generateCsrfToken();
const isValid = validateCsrfToken(token, req);
```

### Device Fingerprinting
**File:** `src/lib/device-fingerprint.ts`

```typescript
import { generateDeviceKey, assessDeviceRisk } from '@/lib/device-fingerprint';

const deviceKey = generateDeviceKey(req);
const risk = assessDeviceRisk(signals);

if (risk.score > 70) {
  // High risk - flag for review
}
```

### Validation
**File:** `src/lib/validations.ts`

```typescript
import { VoteRequestSchema, parseBody } from '@/lib/validations';

const validation = parseBody(VoteRequestSchema, body);
if (!validation.success) {
  return errorResponse(validation.error);
}
```

**Available Schemas:**
- `VoteRequestSchema`
- `CommentSchema`
- `UploadMetadataSchema`
- `ProfileUpdateSchema`
- `ReportSchema`

### Logging
**File:** `src/lib/logger.ts`

```typescript
import { createRequestLogger, logAudit } from '@/lib/logger';

const logger = createRequestLogger('vote', req);
logger.info('Vote cast', { clipId, voteType });
logger.error('Vote failed', { error });

logAudit(logger, {
  action: 'vote_cast',
  userId,
  resourceType: 'clip',
  resourceId: clipId,
});
```

### API Utilities
**File:** `src/lib/api-utils.ts`

```typescript
import {
  successResponse,
  errorResponse,
  validateRequest,
  withAuth,
  withAdmin,
} from '@/lib/api-utils';

// Success response
return successResponse({ clip });

// Error response
return errorResponse('Not found', 404);

// Validate request body
const body = await validateRequest(req, VoteSchema);

// Require authentication
const session = await withAuth(req);

// Require admin role
const admin = await withAdmin(req);
```

### Supabase Client
**File:** `src/lib/supabase-client.ts`

```typescript
import { createClient, createServiceClient } from '@/lib/supabase-client';

// Public client (RLS enforced)
const supabase = createClient();

// Service client (bypasses RLS - server only)
const adminSupabase = createServiceClient();
```

### Video Storage
**File:** `src/lib/video-storage.ts`

```typescript
import {
  getSignedUploadUrl,
  getPublicUrl,
  deleteVideo,
  validateVideoSignature,
} from '@/lib/video-storage';

const { url, path } = await getSignedUploadUrl(filename);
const publicUrl = getPublicUrl(path);
```

---

## 11. Authentication & Authorization

### Authentication Flow

```
User clicks "Sign in with Google"
         │
         ▼
Google OAuth consent screen
         │
         ▼
Callback to /api/auth/callback/google
         │
         ▼
NextAuth validates token + checks ALLOWED_EMAILS
         │
         ├── Email not allowed ──► Access denied
         │
         ▼
Check if user exists in Supabase
         │
         ├── New user ──► Create user record ──► Redirect to onboarding
         │
         ▼
Create JWT session (24-hour expiry)
         │
         ▼
Set secure httpOnly cookie
         │
         ▼
Redirect to /dashboard
```

### Session Data

```typescript
interface Session {
  user: {
    id: string;           // Supabase user ID
    email: string;        // Google email
    name: string;         // Display name
    image?: string;       // Avatar URL
  };
  userId: string;         // Supabase user ID
  hasProfile: boolean;    // Profile completion status
  expires: string;        // Session expiry
}
```

### NextAuth Configuration
**File:** `src/lib/auth-options.ts`

```typescript
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  callbacks: {
    async signIn({ user }) {
      // Check email whitelist
      const allowedEmails = process.env.ALLOWED_EMAILS?.split(',') || [];
      return allowedEmails.includes(user.email || '');
    },
    async jwt({ token, user }) {
      // Add user ID to token
      if (user) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      // Add user ID to session
      session.userId = token.userId;
      return session;
    },
  },
};
```

### Authorization Levels

| Level | Access | Routes |
|-------|--------|--------|
| Public | Anyone | `/`, `/about`, `/privacy`, `/terms` |
| Authenticated | Logged in users | `/dashboard`, `/upload`, `/profile`, `/watch` |
| Admin | Admin role users | `/admin/*`, `/api/admin/*` |

### Admin Authentication
**File:** `src/lib/admin-auth.ts`

```typescript
import { verifyAdmin } from '@/lib/admin-auth';

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Admin logic here
}
```

---

## 12. Real-time Features

### Supabase Realtime Subscriptions

#### Clip Updates
**File:** `src/hooks/useRealtimeClips.ts`

```typescript
// Subscribe to clip updates for current slot
const channel = supabase
  .channel('clips-realtime')
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'tournament_clips',
      filter: `slot_id=eq.${slotId}`,
    },
    (payload) => {
      if (payload.eventType === 'UPDATE') {
        // Update clip vote count
        updateClip(payload.new);
      }
    }
  )
  .subscribe();
```

#### Broadcast Events

```typescript
// Server-side broadcast (in API route)
await supabase
  .channel('story-updates')
  .send({
    type: 'broadcast',
    event: 'winner:selected',
    payload: { slotId, clipId, clipTitle },
  });

// Client-side listener
supabase
  .channel('story-updates')
  .on('broadcast', { event: 'winner:selected' }, (payload) => {
    showWinnerNotification(payload);
  })
  .subscribe();
```

### Reconnection Logic

```typescript
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff

function reconnect(attempt: number) {
  if (attempt >= MAX_RECONNECT_ATTEMPTS) {
    // Fall back to polling
    startPolling();
    return;
  }

  const delay = RECONNECT_DELAYS[attempt] || 16000;
  setTimeout(() => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        resetAttempts();
      } else if (status === 'CHANNEL_ERROR') {
        reconnect(attempt + 1);
      }
    });
  }, delay);
}
```

### Visibility Change Handling

```typescript
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      // Reconnect when tab becomes visible
      channel.subscribe();
      // Fetch fresh data
      refetch();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, []);
```

### Cache Timing Strategy

| Layer | TTL | Purpose |
|-------|-----|---------|
| API cache | 15 seconds | Server-side response cache |
| React Query staleTime | 30 seconds | Client considers data fresh |
| React Query refetchInterval | 30 seconds | Background refresh |
| Realtime | Instant | Live updates via WebSocket |

**Worst case update delay:** ~30 seconds (if realtime fails)

---

## 13. Security

### Authentication & Session Security

- **JWT-based sessions** with 24-hour expiry
- **Secure httpOnly cookies** (SameSite: Lax)
- **Email whitelist** for access control
- **Google OAuth 2.0** for identity verification

### CSRF Protection

**Implementation:**
- Double-submit cookie pattern
- Token format: `timestamp.randomBytes.signature`
- 1-hour token expiry
- Timing-safe comparison

```typescript
// Token generation
const timestamp = Date.now();
const random = crypto.randomBytes(16).toString('hex');
const signature = hmac(secret, `${timestamp}.${random}`);
const token = `${timestamp}.${random}.${signature}`;

// Token validation
const [ts, rand, sig] = token.split('.');
const expectedSig = hmac(secret, `${ts}.${rand}`);
const isValid = timingSafeEqual(sig, expectedSig);
const isNotExpired = Date.now() - ts < 3600000;
```

### Rate Limiting

**Implementation:** Upstash Redis with sliding window

```typescript
const limiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  analytics: true,
});

const { success, remaining, reset } = await limiter.limit(identifier);
```

**Response Headers:**
```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 25
X-RateLimit-Reset: 1703520000
```

### Input Validation

**Zod Runtime Validation:**
```typescript
const VoteSchema = z.object({
  clipId: z.string().uuid(),
  voteType: z.enum(['standard', 'super', 'mega']),
  captchaToken: z.string().optional(),
});

const result = VoteSchema.safeParse(body);
if (!result.success) {
  return errorResponse(result.error.message, 400);
}
```

**XSS Prevention:**
```typescript
import { sanitizeHtml, escapeHtml } from '@/lib/sanitize';

const safeComment = sanitizeHtml(userInput);
const safeDisplay = escapeHtml(userInput);
```

### Bot Protection

- **hCaptcha integration** for high-risk actions
- **Device fingerprinting** (IP + User-Agent hash)
- **Vote flagging** for suspicious patterns
- **Rate limiting** per endpoint

### File Upload Security

```typescript
const ALLOWED_SIGNATURES = {
  'video/mp4': [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70],
  'video/webm': [0x1A, 0x45, 0xDF, 0xA3],
  'video/quicktime': [0x00, 0x00, 0x00, null, 0x66, 0x74, 0x79, 0x70],
};

function validateFileSignature(buffer: Buffer, mimeType: string): boolean {
  const signature = ALLOWED_SIGNATURES[mimeType];
  if (!signature) return false;

  for (let i = 0; i < signature.length; i++) {
    if (signature[i] !== null && buffer[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}
```

### Security Headers

```typescript
// next.config.ts
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];
```

### Row Level Security (RLS)

```sql
-- Users can only read their own private data
CREATE POLICY "Users read own data" ON users
  FOR SELECT USING (auth.uid() = id);

-- Anyone can read public clip data
CREATE POLICY "Public clips readable" ON tournament_clips
  FOR SELECT USING (status = 'approved');

-- Only clip owner can delete
CREATE POLICY "Owners delete clips" ON tournament_clips
  FOR DELETE USING (auth.uid() = user_id);
```

---

## 14. Feature Flags

### Available Flags

| Key | Description | Default |
|-----|-------------|---------|
| `referral_system` | Enable referral codes | false |
| `follow_system` | Enable user following | false |
| `daily_challenges` | Daily vote challenges | false |
| `combo_voting` | Vote streak bonuses | false |
| `push_notifications` | Push notification alerts | false |
| `require_captcha_voting` | CAPTCHA on every vote | false |
| `require_auth_voting` | Require login to vote | false |
| `show_hype_meter` | Display activity gauge | true |
| `enable_comments` | Allow comments | true |

### Usage

**Client-side:**
```tsx
const { enabled, loading } = useFeature('referral_system');

if (loading) return <Spinner />;
if (enabled) return <ReferralSection />;
return null;
```

**Server-side:**
```typescript
const flags = await getFeatureFlags();

if (flags.require_captcha_voting) {
  const captchaValid = await verifyCaptcha(token);
  if (!captchaValid) return errorResponse('CAPTCHA required');
}
```

### Admin Management

```typescript
// Toggle flag
POST /api/admin/feature-flags
{
  "key": "referral_system",
  "enabled": true
}

// Get all flags
GET /api/admin/feature-flags
```

---

## 15. Deployment

### Vercel Deployment

1. **Connect Repository**
   - Link GitHub repo to Vercel
   - Select `main` branch

2. **Configure Build**
   ```
   Build Command: next build
   Output Directory: .next
   Install Command: npm install
   ```

3. **Environment Variables**
   - Add all variables from Section 16
   - Use Vercel's encrypted secrets

4. **Deploy**
   - Push to main triggers automatic deployment
   - Preview deployments for PRs

### Production Checklist

- [ ] All environment variables set
- [ ] Database migrations run
- [ ] RLS policies enabled
- [ ] Storage bucket created and configured
- [ ] Google OAuth redirect URIs updated
- [ ] ALLOWED_EMAILS configured
- [ ] Sentry DSN configured
- [ ] Rate limiting Redis configured
- [ ] CSRF secret set
- [ ] Domain configured and SSL active

### Monitoring Setup

**Sentry Integration:**
```typescript
// sentry.client.config.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
});
```

**Health Check:**
```bash
curl https://aimoviez.vercel.app/api/health
# Expected: { "status": "ok", "timestamp": "..." }
```

---

## 16. Environment Variables

### Required Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx

# NextAuth
NEXTAUTH_URL=https://aimoviez.vercel.app
NEXTAUTH_SECRET=your-32-char-secret

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx

# Access Control
ALLOWED_EMAILS=admin@example.com,user@example.com

# Security
CSRF_SECRET=your-32-char-secret
```

### Optional Variables

```env
# hCaptcha (Bot Protection)
NEXT_PUBLIC_HCAPTCHA_SITE_KEY=xxx
HCAPTCHA_SECRET_KEY=0x...

# Upstash Redis (Rate Limiting)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AZxxxx

# Sentry (Error Tracking)
NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_ORG=your-org
SENTRY_PROJECT=aimoviez
SENTRY_AUTH_TOKEN=sntrys_xxx

# Admin
ADMIN_TOKENS_ENABLED=false
ADMIN_VALID_TOKENS=token1,token2

# Site
NEXT_PUBLIC_SITE_URL=https://aimoviez.vercel.app
```

### Development vs Production

| Variable | Development | Production |
|----------|-------------|------------|
| `NEXTAUTH_URL` | `http://localhost:3000` | `https://aimoviez.vercel.app` |
| `NODE_ENV` | `development` | `production` |
| Rate limiting | In-memory fallback | Upstash Redis |
| CSRF | Relaxed validation | Strict validation |

---

## 17. Database Migrations

### Migration Files

Located in `supabase/sql/`:

| File | Description |
|------|-------------|
| `migration-users.sql` | Users table + indexes |
| `migration-comments.sql` | Comments + likes tables |
| `migration-hybrid-voting.sql` | Voting system tables |
| `migration-feature-flags.sql` | Feature flags table |
| `migration-notifications.sql` | Notifications table |
| `migration-leaderboard-views.sql` | Leaderboard materialized views |
| `enable-rls-policies.sql` | Row-level security |
| `add-performance-indexes.sql` | Query optimization |
| `fix-vote-insert-race-condition.sql` | Atomic vote operations |
| `add-audit-log-table.sql` | Admin audit trail |

### Running Migrations

**Via Supabase Dashboard:**
1. Go to SQL Editor
2. Open migration file
3. Execute query
4. Verify with table browser

**Via Supabase CLI:**
```bash
# Install CLI
npm install -g supabase

# Link project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

### Creating a New Season

```sql
-- Create new season
INSERT INTO seasons (name, status, total_slots)
VALUES ('Season 2', 'active', 75);

-- Create 75 slots with genre rotation
DO $$
DECLARE
  season_id UUID := (SELECT id FROM seasons WHERE name = 'Season 2');
  genres TEXT[] := ARRAY['COMEDY', 'THRILLER', 'ACTION', 'ANIMATION'];
BEGIN
  FOR i IN 1..75 LOOP
    INSERT INTO story_slots (season_id, slot_position, genre, status)
    VALUES (
      season_id,
      i,
      genres[((i - 1) % 4) + 1],
      CASE WHEN i = 1 THEN 'voting' ELSE 'upcoming' END
    );
  END LOOP;
END $$;
```

---

## 18. Testing

### Setup

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Test Structure

```
src/__tests__/
├── lib/
│   ├── sounds.test.ts
│   ├── formatNumber.test.ts
│   └── validations.test.ts
└── components/
    ├── BottomNavigation.test.tsx
    └── ErrorBoundary.test.tsx
```

### Writing Tests

**Component Test:**
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomNavigation } from '@/components/BottomNavigation';

describe('BottomNavigation', () => {
  it('renders navigation items', () => {
    render(<BottomNavigation currentPath="/dashboard" />);

    expect(screen.getByText('Story')).toBeInTheDocument();
    expect(screen.getByText('Watch')).toBeInTheDocument();
    expect(screen.getByText('Upload')).toBeInTheDocument();
  });

  it('highlights current page', () => {
    render(<BottomNavigation currentPath="/story" />);

    const storyLink = screen.getByText('Story').closest('a');
    expect(storyLink).toHaveClass('text-purple-500');
  });
});
```

**Utility Test:**
```typescript
import { formatNumber } from '@/lib/utils';

describe('formatNumber', () => {
  it('formats thousands', () => {
    expect(formatNumber(1500)).toBe('1.5K');
  });

  it('formats millions', () => {
    expect(formatNumber(2500000)).toBe('2.5M');
  });
});
```

### Mock Data

```typescript
import { useMockData } from '@/hooks/useMockData';

function TestComponent() {
  const { clips, users, votes } = useMockData();

  return (
    <div>
      {clips.map(clip => (
        <VideoCard key={clip.id} clip={clip} />
      ))}
    </div>
  );
}
```

---

## 19. Performance

### Optimization Strategies

#### Code Splitting
```typescript
// Dynamic imports for heavy components
const CommentsSection = dynamic(
  () => import('@/components/CommentsSection'),
  { loading: () => <CommentsSkeleton /> }
);

const Confetti = dynamic(() => import('canvas-confetti'), { ssr: false });
```

#### React Query Caching
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,      // 1 minute
      gcTime: 5 * 60 * 1000,     // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});
```

#### Image Optimization
```tsx
<Image
  src={thumbnailUrl}
  alt={title}
  width={320}
  height={180}
  loading="lazy"
  unoptimized={url?.includes('dicebear') || url?.endsWith('.svg')}
/>
```

#### Database Query Optimization
```sql
-- Composite index for voting queries
CREATE INDEX idx_clips_slot_votes
ON tournament_clips(slot_id, weighted_score DESC);

-- Partial index for active slots
CREATE INDEX idx_slots_voting
ON story_slots(status)
WHERE status = 'voting';
```

### Performance Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| First Contentful Paint | < 1.5s | Lighthouse |
| Time to Interactive | < 3s | Lighthouse |
| API Response Time | < 200ms | Server logs |
| Database Query Time | < 50ms | Supabase dashboard |
| Realtime Latency | < 100ms | Network tab |

---

## 20. Troubleshooting

### Common Issues

#### "Unauthorized" on API routes
- Check `ALLOWED_EMAILS` includes your email
- Verify NextAuth session is valid
- Check JWT token expiry (24 hours)
- Clear cookies and sign in again

#### Rate limit errors (429)
- Verify Upstash credentials
- Check rate limit configuration
- Wait for window to reset
- Monitor Redis usage in Upstash dashboard

#### File upload fails
- Verify Supabase Storage bucket exists
- Check file size (max 100MB)
- Verify file format (MP4/MOV/WebM only)
- Check magic byte signature
- Verify storage bucket policies

#### CSRF validation fails
- Ensure `CSRF_SECRET` is set
- Check cookie settings
- Verify token header is sent
- Token may be expired (1 hour)

#### Realtime not updating
- Check WebSocket connection in Network tab
- Verify Supabase realtime is enabled
- Check channel subscription status
- Look for CHANNEL_ERROR events

#### DiceBear avatar 400 errors
- Add `unoptimized` prop to Image component
- SVGs from external domains need unoptimized

#### Video thumbnails showing as broken
- Check if thumbnail_url is actually a video URL
- Add check: `!thumbnail_url.match(/\.(mp4|webm|mov)$/i)`

### Debug Mode

```typescript
// Enable detailed logging
const logger = createRequestLogger('debug', req);
logger.debug('Detailed info', {
  body,
  headers: req.headers,
  session,
});
```

### Health Check

```bash
# API health
curl https://aimoviez.vercel.app/api/health

# Database check
curl https://aimoviez.vercel.app/api/admin/stats

# Expected response
{
  "status": "ok",
  "timestamp": "2025-12-25T00:00:00.000Z",
  "database": "connected",
  "redis": "connected"
}
```

### Useful Commands

```bash
# Check build locally
npm run build

# Run type checking
npx tsc --noEmit

# Lint code
npm run lint

# Check for circular dependencies
npx madge --circular src/

# Analyze bundle size
npx @next/bundle-analyzer
```

### Support Resources

- **Documentation:** `/docs` folder
- **Recent Changes:** `RECENT_CHANGES.md`
- **Recovery Docs:** `docs/SEASON_MANAGEMENT_RECOVERY.md`
- **GitHub Issues:** Report bugs and feature requests

---

## Appendix

### A. Vote Weighting Formula

```
weighted_score = SUM(vote_weight)

where:
  vote_weight = 1  (standard vote)
  vote_weight = 3  (super vote)
  vote_weight = 10 (mega vote)
```

### B. XP & Level System

```typescript
// Level calculation
function calculateLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

// XP for next level
function xpForLevel(level: number): number {
  return Math.pow(level - 1, 2) * 100;
}
```

| Level | XP Required |
|-------|-------------|
| 1 | 0 |
| 2 | 100 |
| 3 | 400 |
| 4 | 900 |
| 5 | 1,600 |
| 10 | 8,100 |
| 20 | 36,100 |

**XP Awards:**
| Action | XP |
|--------|-----|
| Standard vote | 10 |
| Super vote | 30 |
| Mega vote | 100 |
| Receive vote | 5 |
| Upload clip | 50 |
| Win slot | 500 |

### C. Genre Rotation

```
Slot 1:  COMEDY
Slot 2:  THRILLER
Slot 3:  ACTION
Slot 4:  ANIMATION
Slot 5:  COMEDY
...
Slot 75: ACTION
```

Formula: `genre = GENRES[(slot - 1) % 4]`

### D. Keyboard Shortcuts (Dashboard)

| Key | Action |
|-----|--------|
| ↑ / ← | Previous clip |
| ↓ / → | Next clip |
| Space | Play/Pause video |
| M | Mute/Unmute |
| C | Toggle comments |

---

**Documentation Version:** 2.0.0
**Last Updated:** December 25, 2025
**Maintainer:** AiMoviez Team
