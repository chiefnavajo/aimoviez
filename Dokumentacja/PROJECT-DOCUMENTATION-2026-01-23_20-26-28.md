# AiMoviez - Complete Project Documentation

**Generated:** 2026-01-23 20:26:28 UTC
**Version:** 1.0.0
**Status:** Production Ready

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Features](#4-features)
5. [API Reference](#5-api-reference)
6. [Database Schema](#6-database-schema)
7. [Authentication](#7-authentication)
8. [Security](#8-security)
9. [Environment Variables](#9-environment-variables)
10. [Deployment](#10-deployment)

---

## 1. Project Overview

**AiMoviez** is an 8-second video voting tournament platform where users compete by uploading short video clips. The platform features a gamified voting system with weighted votes, leaderboards, and seasonal competitions.

### Key Concepts

- **8SEC MADNESS**: The core voting game where users vote on 8-second clips
- **Seasons**: Competition periods with 75 slots each
- **Slots**: Individual voting rounds within a season
- **Tournament Clips**: User-uploaded videos competing for votes
- **Weighted Votes**: Standard (1x), Super (3x), and Mega (10x) votes

---

## 2. Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 15.5.7 | React framework (App Router) |
| React | 19.2.0 | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Styling |
| Framer Motion | 12.23.24 | Animations |
| TanStack Query | 5.90.10 | Data fetching |
| Lucide React | 0.553.0 | Icons |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js API Routes | 15.5.7 | REST API |
| NextAuth.js | 4.24.13 | Authentication |
| Zod | 4.1.13 | Validation |
| Supabase | 2.84.0 | Database & Storage |

### Infrastructure
| Service | Purpose |
|---------|---------|
| Vercel | Hosting & Deployment |
| Supabase | PostgreSQL + Auth + Storage |
| Upstash Redis | Rate Limiting |
| Cloudflare R2 | Video Storage (optional) |
| Sentry | Error Monitoring |

---

## 3. Project Structure

```
aimoviez-app/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API routes
│   │   │   ├── admin/         # Admin endpoints
│   │   │   ├── auth/          # NextAuth endpoints
│   │   │   ├── clip/          # Clip endpoints
│   │   │   ├── comments/      # Comment endpoints
│   │   │   ├── cron/          # Cron job endpoints
│   │   │   ├── vote/          # Voting endpoints
│   │   │   └── ...
│   │   ├── admin/             # Admin dashboard page
│   │   ├── clip/[id]/         # Clip detail page
│   │   ├── dashboard/         # Main voting page
│   │   ├── leaderboard/       # Rankings page
│   │   ├── profile/           # User profile page
│   │   ├── settings/          # User settings page
│   │   ├── upload/            # Upload wizard page
│   │   └── ...
│   ├── components/            # React components (26 files)
│   │   ├── AdminDashboard.tsx
│   │   ├── CommentsSection.tsx
│   │   ├── Leaderboard.tsx
│   │   ├── UploadPanel.tsx
│   │   ├── VideoCard.tsx
│   │   └── ...
│   ├── hooks/                 # Custom React hooks (12 files)
│   │   ├── useAuth.ts
│   │   ├── useVoting.ts
│   │   └── ...
│   ├── lib/                   # Utilities (22 files)
│   │   ├── auth-options.ts    # NextAuth config
│   │   ├── rate-limit.ts      # Rate limiting
│   │   ├── sanitize.ts        # Input sanitization
│   │   ├── audit-log.ts       # Admin audit logging
│   │   └── ...
│   ├── types/                 # TypeScript definitions
│   └── middleware.ts          # Auth & security middleware
├── supabase/sql/              # Database migrations (43+ files)
├── public/                    # Static assets
├── Dokumentacja/              # Documentation
├── package.json
├── vercel.json                # Vercel config & cron jobs
└── tsconfig.json
```

---

## 4. Features

### 4.1 Voting System (8SEC MADNESS)

**Vote Types:**
| Type | Weight | Limit |
|------|--------|-------|
| Standard | 1x | 200/day |
| Super | 3x | 1/round |
| Mega | 10x | 1/round |

**Features:**
- Smart weighted random clip sampling
- Multi-vote mode (upgrade existing votes)
- Device fingerprinting for anonymous voting
- Race condition protection (atomic RPC functions)
- Vote flagging for fraud detection

### 4.2 Video Upload

- **Duration:** 8 seconds max
- **Formats:** MP4, MOV, WebM
- **Max Size:** 50MB
- **Security:** File signature verification, polyglot detection
- **Workflow:** Upload → Pending → Admin Approval → Active

**Storage Providers:**
- Supabase Storage (default)
- Cloudflare R2 (recommended for scale)
- AWS S3
- Cloudinary

### 4.3 Comments & Engagement

- Nested comments (up to 5 replies per comment)
- Like/unlike comments
- Soft delete support
- XSS sanitization
- Rate limited (15 req/min)

### 4.4 Leaderboards

- **Global Rankings:** By XP, level
- **Creator Rankings:** By votes received, clips uploaded
- **Clip Rankings:** By vote count, weighted score
- **Voter Rankings:** By votes cast, streak
- 5-minute cache TTL

### 4.5 User Profiles

- Username, avatar, bio
- XP and level system: `level = floor(sqrt(xp/100)) + 1`
- Follow/unfollow system
- Verification badges
- Profile stats

### 4.6 Admin Dashboard

- Approve/reject pending clips
- Batch operations
- User management (ban/unban)
- Season management
- Feature flags
- Audit logs

### 4.7 Seasons & Slots

- 75 slots per season
- Slot statuses: `upcoming`, `voting`, `locked`, `waiting_for_clips`
- Configurable voting duration
- Auto-advance via cron job

---

## 5. API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/[...nextauth]` | NextAuth callbacks |
| GET | `/api/csrf` | Get CSRF token |

### Voting
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vote` | Get clips for voting |
| POST | `/api/vote` | Cast vote |
| DELETE | `/api/vote` | Revoke vote |

### Clips
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clip/[id]` | Get clip details |
| POST | `/api/upload` | Upload video |
| POST | `/api/upload/register` | Register clip metadata |
| POST | `/api/upload/signed-url` | Get upload URL |

### Comments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/comments` | Get comments (paginated) |
| POST | `/api/comments` | Create comment |
| PATCH | `/api/comments` | Like/unlike |
| DELETE | `/api/comments` | Delete comment |

### Leaderboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leaderboard` | Global rankings |
| GET | `/api/leaderboard/creators` | Creator rankings |
| GET | `/api/leaderboard/clips` | Clip rankings |
| GET | `/api/leaderboard/voters` | Voter rankings |

### User
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user/profile` | Get profile |
| POST | `/api/user/create-profile` | Create profile |
| POST | `/api/user/check-username` | Check availability |
| POST | `/api/user/block` | Block user |

### Account
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/account/delete` | Delete account |
| GET | `/api/account/export` | Export data (GDPR) |

### Admin (Requires admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/moderation` | List pending clips |
| POST | `/api/admin/moderation` | Approve clip |
| DELETE | `/api/admin/moderation` | Reject clip |
| GET | `/api/admin/users` | List users |
| PUT | `/api/admin/users/[id]` | Update user |
| POST | `/api/admin/seasons` | Manage seasons |
| POST | `/api/admin/feature-flags` | Toggle features |
| POST | `/api/admin/reset-user-votes` | Reset votes |
| POST | `/api/admin/advance-slot` | Advance slot |
| POST | `/api/admin/assign-winner` | Assign winner |

### Cron
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/cron/auto-advance` | Auto-advance slots |

---

## 6. Database Schema

### Core Tables

#### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  display_name TEXT,
  bio TEXT CHECK (length(bio) <= 150),
  avatar_url TEXT,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  total_votes_cast INTEGER DEFAULT 0,
  total_votes_received INTEGER DEFAULT 0,
  clips_uploaded INTEGER DEFAULT 0,
  clips_locked INTEGER DEFAULT 0,
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  is_banned BOOLEAN DEFAULT FALSE,
  banned_at TIMESTAMPTZ,
  ban_reason TEXT,
  referral_code TEXT UNIQUE,
  referral_count INTEGER DEFAULT 0,
  referred_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### tournament_clips
```sql
CREATE TABLE tournament_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES seasons(id),
  slot_position INTEGER NOT NULL,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  username TEXT NOT NULL,
  avatar_url TEXT,
  genre TEXT,
  title TEXT,
  description TEXT,
  vote_count INTEGER DEFAULT 0,
  weighted_score NUMERIC DEFAULT 0,
  hype_score NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending', -- pending, active, rejected, locked
  moderation_status TEXT DEFAULT 'pending',
  uploader_key TEXT,
  user_id UUID REFERENCES users(id),
  duration_seconds NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### votes
```sql
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID REFERENCES tournament_clips(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  vote_weight INTEGER DEFAULT 1, -- 1, 3, or 10
  vote_type TEXT DEFAULT 'standard', -- standard, super, mega
  slot_position INTEGER,
  flagged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(voter_key, clip_id, DATE(created_at))
);
```

#### seasons
```sql
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  status TEXT DEFAULT 'draft', -- draft, active, finished
  total_slots INTEGER DEFAULT 75,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### story_slots
```sql
CREATE TABLE story_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES seasons(id),
  slot_position INTEGER NOT NULL,
  status TEXT DEFAULT 'upcoming', -- upcoming, voting, locked, waiting_for_clips
  genre TEXT,
  winner_tournament_clip_id UUID REFERENCES tournament_clips(id),
  voting_started_at TIMESTAMPTZ,
  voting_ends_at TIMESTAMPTZ,
  voting_duration_hours INTEGER DEFAULT 24,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, slot_position)
);
```

#### comments
```sql
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID REFERENCES tournament_clips(id) ON DELETE CASCADE,
  user_key TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  username TEXT NOT NULL,
  avatar_url TEXT,
  comment_text TEXT NOT NULL,
  likes_count INTEGER DEFAULT 0,
  parent_comment_id UUID REFERENCES comments(id),
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Supporting Tables

- `comment_likes` - Comment like tracking
- `followers` - Follow relationships
- `genre_votes` - Genre preference voting
- `feature_flags` - Feature toggles
- `referrals` - Referral tracking
- `contact_submissions` - Contact form
- `content_reports` - Content reports
- `user_blocks` - Block relationships
- `notifications` - User notifications
- `push_subscriptions` - Push notification subscriptions
- `clip_views` - View tracking
- `audit_logs` - Admin action logs
- `cron_locks` - Distributed lock for cron jobs

---

## 7. Authentication

### Strategy
- **Provider:** Google OAuth via NextAuth.js
- **Session:** JWT-based (not database sessions)
- **Max Age:** 24 hours
- **Update Age:** 1 hour

### Session Structure
```typescript
interface Session {
  user: {
    email: string;
    name: string;
    image: string;
    hasProfile: boolean;
    userId: string | null;
    username: string | null;
  }
}
```

### Protected Routes
| Route | Requirement |
|-------|-------------|
| `/dashboard` | Authenticated |
| `/profile` | Authenticated |
| `/upload` | Authenticated |
| `/settings` | Authenticated |
| `/admin/*` | Admin role |

### Cookie Configuration
```typescript
{
  name: '__Secure-next-auth.session-token', // production
  httpOnly: true,
  sameSite: 'lax',
  secure: true, // production only
  path: '/'
}
```

---

## 8. Security

### Authentication & Authorization
- Google OAuth with email allowlist
- JWT sessions with 24-hour expiry
- Admin role verification via database
- Device fingerprinting for anonymous actions

### Rate Limiting
| Endpoint Type | Limit |
|---------------|-------|
| Vote | 30 req/min |
| Upload | 5 req/min |
| Comment | 15 req/min |
| Admin Read | 30 req/min |
| Admin Write | 15 req/min |
| Admin Sensitive | 5 req/min |
| Auth | 5 req/min |
| Contact | 3 req/min |
| Read | 120 req/min |

### Security Headers
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Strict-Transport-Security: max-age=31536000; includeSubDomains
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: [comprehensive policy]
```

### Input Validation
- Zod schemas for all API inputs
- File signature verification (magic bytes)
- Polyglot file detection
- XSS sanitization with HTML entity encoding
- SQL injection prevention via parameterized queries

### CSRF Protection
- Double-submit cookie pattern
- HMAC-SHA256 token signature
- 1-hour token expiry

### Audit Logging
- All admin actions logged
- Sensitive fields redacted (hashed)
- IP addresses hashed for privacy

---

## 9. Environment Variables

### Required
```env
# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# NextAuth
NEXTAUTH_URL=
NEXTAUTH_SECRET=

# App
NEXT_PUBLIC_APP_URL=
```

### Rate Limiting (Recommended)
```env
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

### Security
```env
CRON_SECRET=           # Required in production
CSRF_SECRET=           # Optional, falls back to NEXTAUTH_SECRET
ALLOWED_EMAILS=        # Comma-separated email allowlist
```

### Optional Storage
```env
# Cloudflare R2 (recommended)
CLOUDFLARE_R2_ENDPOINT=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET=
CLOUDFLARE_R2_PUBLIC_URL=

# AWS S3
AWS_REGION=
AWS_S3_BUCKET=

# Cloudinary
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

### Bot Protection
```env
NEXT_PUBLIC_HCAPTCHA_SITE_KEY=
HCAPTCHA_SECRET_KEY=
```

---

## 10. Deployment

### Vercel Deployment

1. Connect GitHub repository to Vercel
2. Configure environment variables
3. Deploy

### Cron Jobs (vercel.json)
```json
{
  "crons": [
    {
      "path": "/api/cron/auto-advance",
      "schedule": "* * * * *"
    }
  ]
}
```

### Database Setup

1. Create Supabase project
2. Run migrations from `supabase/sql/` in order
3. Enable Row Level Security (RLS)
4. Create necessary indexes

### Production Checklist

- [ ] Set all required environment variables
- [ ] Configure `CRON_SECRET`
- [ ] Set `ALLOWED_EMAILS` for user allowlist
- [ ] Enable HTTPS (automatic on Vercel)
- [ ] Configure domain in NextAuth
- [ ] Set up error monitoring (Sentry)
- [ ] Configure rate limiting (Upstash)
- [ ] Review RLS policies in Supabase

---

## Changelog

### 2026-01-23
- Security audit completed
- 12 vulnerabilities fixed
- Rate limiting improved
- Audit logging enhanced
- CSP and HSTS headers added

---

*Documentation generated by Claude Opus 4.5*
*Last updated: 2026-01-23 20:26:28 UTC*
