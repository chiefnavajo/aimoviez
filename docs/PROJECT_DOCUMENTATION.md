# AiMoviez - Complete Project Documentation

> **Version:** 1.0.0
> **Last Updated:** December 2024
> **Platform:** Next.js 16 Full-Stack Application

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Getting Started](#4-getting-started)
5. [Authentication](#5-authentication)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
8. [Components](#8-components)
9. [Custom Hooks](#9-custom-hooks)
10. [Utilities & Libraries](#10-utilities--libraries)
11. [Features](#11-features)
12. [Security](#12-security)
13. [Deployment](#13-deployment)
14. [Environment Variables](#14-environment-variables)
15. [Database Migrations](#15-database-migrations)
16. [Testing](#16-testing)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. Overview

AiMoviez is a competitive video clip voting platform where creators upload 8-second clips that compete for slots in a collaborative "movie." Users vote on clips to determine winners, with a gamified XP/leveling system.

### Core Concept
- **75-Slot Movie System**: Each season consists of 75 voting slots
- **Hybrid Voting**: Standard (1x), Super (3x), and Mega (10x) votes
- **Creator Competition**: Clips compete for the winning spot in each slot
- **XP & Leveling**: Users earn XP for voting, level up, and climb leaderboards

### Key Metrics
- Daily vote limit: 200 votes per user
- Super votes: 1 per round
- Mega votes: 1 per round
- Video length: 8 seconds max
- File size: 100MB max

---

## 2. Tech Stack

### Core Framework
| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.0.1 | React framework with SSR/SSG |
| React | 19.2.0 | UI library |
| TypeScript | 5.x | Type safety |
| Node.js | 18+ | Runtime environment |

### Authentication & Security
| Technology | Version | Purpose |
|------------|---------|---------|
| NextAuth | 4.24.13 | OAuth2/JWT authentication |
| hCaptcha | 1.16.0 | Bot prevention |
| Sentry | 10.28.0 | Error tracking |

### Database & Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| Supabase | 2.84.0 | PostgreSQL cloud database |
| Upstash Redis | 1.35.7 | Caching & rate limiting |

### UI & Animations
| Technology | Version | Purpose |
|------------|---------|---------|
| Tailwind CSS | 4.x | Utility-first CSS |
| Framer Motion | 12.23.24 | Animations |
| Lucide React | 0.553.0 | Icons |
| Canvas Confetti | 1.9.4 | Celebrations |

### Data & Real-Time
| Technology | Version | Purpose |
|------------|---------|---------|
| TanStack React Query | 5.90.10 | Server state management |
| Zod | 4.1.13 | Schema validation |
| Pusher JS | 8.4.0 | WebSocket real-time |

---

## 3. Project Structure

```
aimoviez-app/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API routes (54 endpoints)
│   │   │   ├── auth/          # NextAuth handlers
│   │   │   ├── vote/          # Voting system
│   │   │   ├── upload/        # Video uploads
│   │   │   ├── comments/      # Comments system
│   │   │   ├── admin/         # Admin endpoints
│   │   │   ├── leaderboard/   # Rankings
│   │   │   ├── profile/       # User profiles
│   │   │   └── ...
│   │   ├── dashboard/         # Main voting interface
│   │   ├── profile/           # User profiles
│   │   ├── upload/            # Upload wizard
│   │   ├── leaderboard/       # Rankings page
│   │   ├── admin/             # Admin dashboard
│   │   ├── clip/[id]/         # Clip detail pages
│   │   ├── watch/             # Movie playback
│   │   ├── story/             # Timeline view
│   │   └── ...
│   ├── components/            # React components (21)
│   ├── hooks/                 # Custom hooks (7)
│   ├── lib/                   # Utilities (20)
│   ├── types/                 # TypeScript definitions
│   └── __tests__/             # Test files
├── supabase/
│   └── sql/                   # Database migrations (32)
├── public/                    # Static assets
├── docs/                      # Documentation
└── package.json
```

---

## 4. Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase account
- Google OAuth credentials
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

# Run database migrations (see Section 15)

# Start development server
npm run dev
```

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test         # Run Jest tests
npm run test:watch   # Watch mode testing
npm run test:coverage # Coverage report
```

---

## 5. Authentication

### Overview
Authentication uses NextAuth with Google OAuth provider and JWT sessions.

### Flow
1. User clicks "Sign in with Google"
2. Google OAuth redirect and consent
3. Email validated against `ALLOWED_EMAILS` whitelist
4. JWT token created with user info
5. Session stored in secure httpOnly cookie

### Session Data
```typescript
interface Session {
  user: {
    email: string;      // Google email
    username: string;   // Display name
    userId: string;     // Database user ID
    hasProfile: boolean; // Profile completion status
  }
}
```

### Configuration
Located in `src/lib/auth-options.ts`:

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
  // ... callbacks
};
```

### Protected Routes
Routes requiring authentication:
- `/dashboard`
- `/profile`
- `/upload`
- `/settings`
- `/admin/*` (admin only)

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
  device_key TEXT,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  total_votes_cast INTEGER DEFAULT 0,
  total_votes_received INTEGER DEFAULT 0,
  clips_uploaded INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  is_banned BOOLEAN DEFAULT false,
  role TEXT DEFAULT 'user',
  followers_count INTEGER DEFAULT 0,
  following_count INTEGER DEFAULT 0,
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### tournament_clips
```sql
CREATE TABLE tournament_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  season_id UUID REFERENCES seasons(id),
  slot_position INTEGER,
  title TEXT,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  genre TEXT,
  status TEXT DEFAULT 'pending',
  vote_count INTEGER DEFAULT 0,
  weighted_score INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### votes
```sql
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID REFERENCES tournament_clips(id),
  voter_key TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  vote_weight INTEGER DEFAULT 1,
  vote_type TEXT DEFAULT 'standard',
  slot_position INTEGER,
  flagged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(voter_key, clip_id)
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### seasons
```sql
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT,
  status TEXT DEFAULT 'draft',
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
  status TEXT DEFAULT 'upcoming',
  genre TEXT,
  winner_tournament_clip_id UUID,
  voting_started_at TIMESTAMPTZ,
  voting_ends_at TIMESTAMPTZ,
  UNIQUE(season_id, slot_position)
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Key Relationships
```
users (1) ──< (N) tournament_clips
users (1) ──< (N) votes
users (1) ──< (N) comments
seasons (1) ──< (N) story_slots
seasons (1) ──< (N) tournament_clips
tournament_clips (1) ──< (N) votes
tournament_clips (1) ──< (N) comments
```

---

## 7. API Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth handler |

### Voting System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vote` | Get voting state & clips |
| POST | `/api/vote` | Cast vote (standard/super/mega) |
| DELETE | `/api/vote` | Revoke vote |
| POST | `/api/genre-vote` | Vote on genre preference |

#### Vote Request Body
```typescript
{
  clipId: string;
  voteType: 'standard' | 'super' | 'mega';
  captchaToken?: string;
}
```

### Upload
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload video file |
| POST | `/api/upload/register` | Register clip metadata |
| POST | `/api/upload/signed-url` | Get signed upload URL |

### Comments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/comments?clipId=` | Get comments for clip |
| POST | `/api/comments` | Create comment |
| DELETE | `/api/comments` | Delete comment |
| POST | `/api/comments/like` | Like/unlike comment |

### Leaderboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/leaderboard/live` | Real-time leaderboard |
| GET | `/api/leaderboard/voters` | Top voters |
| GET | `/api/leaderboard/clips` | Top clips |
| GET | `/api/leaderboard/creators` | Top creators |

### User Profile
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/user/profile` | Get current user |
| POST | `/api/user/create-profile` | Create profile |
| POST | `/api/user/check-username` | Check availability |
| GET | `/api/profile/stats` | User statistics |
| GET | `/api/profile/clips` | User's clips |

### Admin (Requires Admin Role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/admin/approve` | Approve clip |
| POST | `/api/admin/reject` | Reject clip |
| POST | `/api/admin/assign-winner` | Set slot winner |
| POST | `/api/admin/advance-slot` | Advance to next slot |
| GET | `/api/admin/clips` | List all clips |
| GET | `/api/admin/users` | List users |
| POST | `/api/admin/feature-flags` | Update flags |
| GET | `/api/admin/stats` | Analytics |

### Other
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/contact` | Contact form |
| POST | `/api/report` | Report content |
| POST | `/api/account/delete` | Delete account |
| POST | `/api/account/export` | Export data |

---

## 8. Components

### Major Components

#### CommentsSection
Full-featured comments panel with threading, likes, and moderation.

```tsx
<CommentsSection
  clipId={clipId}
  isOpen={showComments}
  onClose={() => setShowComments(false)}
  clipUsername={creatorUsername}
/>
```

#### EnhancedUploadArea
Drag-and-drop video upload with validation.

```tsx
<EnhancedUploadArea
  onFileSelect={(file) => handleFile(file)}
  onError={(error) => showError(error)}
  maxSize={100 * 1024 * 1024} // 100MB
  acceptedFormats={['video/mp4', 'video/quicktime', 'video/webm']}
/>
```

#### MiniLeaderboard
Real-time ranking display.

```tsx
<MiniLeaderboard
  currentClipId={clipId}
  onClipSelect={(id) => navigateToClip(id)}
  isCollapsed={collapsed}
  onToggleCollapse={() => setCollapsed(!collapsed)}
/>
```

#### CaptchaVerification
hCaptcha integration for bot protection.

```tsx
<CaptchaVerification
  onVerify={(token) => handleVerify(token)}
  onExpire={() => resetToken()}
  theme="dark"
  size="invisible"
/>
```

### All Components
| Component | File | Description |
|-----------|------|-------------|
| Navbar | Navbar.tsx | Top navigation |
| CommentsSection | CommentsSection.tsx | Comments panel |
| EnhancedUploadArea | EnhancedUploadArea.tsx | Upload interface |
| MiniLeaderboard | MiniLeaderboard.tsx | Rankings widget |
| UploadPanel | UploadPanel.tsx | Upload workflow |
| Leaderboard | Leaderboard.tsx | Full rankings |
| StoryProgressBar | StoryProgressBar.tsx | Slot progress |
| StoryTimeline | StoryTimeline.tsx | Timeline view |
| VideoCard | VideoCard.tsx | Clip preview |
| CaptchaVerification | CaptchaVerification.tsx | CAPTCHA widget |
| ReportModal | ReportModal.tsx | Report interface |
| NotificationSettings | NotificationSettings.tsx | Push settings |
| ReferralSection | ReferralSection.tsx | Referral system |
| OnboardingTour | OnboardingTour.tsx | User tutorial |
| CookieConsent | CookieConsent.tsx | GDPR consent |
| HypeMeter | HypeMeter.tsx | Activity gauge |
| ErrorBoundary | ErrorBoundary.tsx | Error handling |
| Skeletons | Skeletons.tsx | Loading states |
| BottomNavigation | BottomNavigation.tsx | Mobile nav |

---

## 9. Custom Hooks

### useAuth
Authentication state management.

```tsx
const { isLoading, isAuthenticated, hasProfile, user, session } = useAuth();

if (isLoading) return <Spinner />;
if (!isAuthenticated) return <LoginPrompt />;
if (!hasProfile) return <CreateProfile />;
```

### useFeatureFlags
Feature flag checking.

```tsx
const { enabled, loading } = useFeature('referral_system');

if (enabled) {
  return <ReferralSection />;
}
```

### useCsrf
CSRF token management.

```tsx
const { post, put, del } = useCsrf();

// Automatically includes CSRF token
await post('/api/vote', { clipId, voteType });
```

### useCountdown
Timer functionality.

```tsx
const { timeRemaining, isExpired } = useCountdown(votingEndsAt);

return <span>{timeRemaining} seconds left</span>;
```

### useFocusTrap
Accessibility focus management.

```tsx
const modalRef = useFocusTrap(isOpen);

return <div ref={modalRef}>{/* Modal content */}</div>;
```

### useAdminAuth
Admin authentication check.

```tsx
const { isAdmin, isLoading } = useAdminAuth();

if (!isAdmin) return <AccessDenied />;
```

---

## 10. Utilities & Libraries

### Rate Limiting (`src/lib/rate-limit.ts`)
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

### CSRF Protection (`src/lib/csrf.ts`)
```typescript
import { validateCsrfToken, generateCsrfToken } from '@/lib/csrf';

// Generate token
const token = generateCsrfToken();

// Validate token
const isValid = validateCsrfToken(token, req);
```

### Device Fingerprinting (`src/lib/device-fingerprint.ts`)
```typescript
import { generateDeviceKey, assessDeviceRisk } from '@/lib/device-fingerprint';

const deviceKey = generateDeviceKey(req);
const risk = assessDeviceRisk(signals);

if (risk.score > 70) {
  // High risk - flag for review
}
```

### Validation (`src/lib/validations.ts`)
```typescript
import { VoteRequestSchema, parseBody } from '@/lib/validations';

const validation = parseBody(VoteRequestSchema, body);
if (!validation.success) {
  return error(validation.error);
}
```

### Logging (`src/lib/logger.ts`)
```typescript
import { createRequestLogger, logAudit } from '@/lib/logger';

const logger = createRequestLogger('vote', req);
logger.info('Vote cast', { clipId, voteType });

logAudit(logger, {
  action: 'vote_cast',
  userId,
  resourceType: 'clip',
  resourceId: clipId,
});
```

---

## 11. Features

### 1. Hybrid Voting System

**Vote Types:**
| Type | Weight | Limit |
|------|--------|-------|
| Standard | 1x | 200/day |
| Super | 3x | 1/round |
| Mega | 10x | 1/round |

**Implementation:**
- One vote per clip per user
- Daily limit resets at UTC midnight
- Duplicate prevention via unique constraint
- Device fingerprinting for anonymous users

### 2. 75-Slot Movie System

Each season contains 75 slots representing clips in the final movie.

**Slot Lifecycle:**
1. `upcoming` - Not yet open for voting
2. `voting` - Active voting period
3. `locked` - Voting closed, winner determined

**Genre Rotation:**
Genres rotate through slots: Comedy → Action → Thriller → Animation → etc.

### 3. XP & Leveling

**XP Awards:**
| Action | XP |
|--------|-----|
| Standard vote | 10 |
| Super vote | 30 |
| Mega vote | 100 |
| Receive vote | 5 |
| Upload clip | 50 |

**Level Formula:**
```
level = floor(sqrt(xp / 100)) + 1
```

### 4. Leaderboards

**Categories:**
- Top Creators (by votes received)
- Top Voters (by votes cast)
- Top Clips (by weighted score)
- Daily/Weekly/All-time filters

### 5. Comments System

- Thread replies (one level deep)
- Like/unlike with optimistic updates
- Soft delete with moderation
- Real-time updates via React Query

### 6. Video Upload

**Validation:**
- Max duration: 8 seconds
- Max size: 100MB
- Formats: MP4, MOV, WebM
- Magic byte verification

**Flow:**
1. Client validates file
2. Get signed URL from API
3. Upload directly to Supabase Storage
4. Register metadata with API

### 7. Admin Dashboard

**Capabilities:**
- Approve/reject clips
- Assign slot winners
- Manage seasons/slots
- Ban/unban users
- View audit logs
- Toggle feature flags

### 8. Feature Flags

**Available Flags:**
| Key | Description |
|-----|-------------|
| `referral_system` | Enable referrals |
| `follow_system` | Enable following |
| `daily_challenges` | Daily vote challenges |
| `combo_voting` | Vote streaks |
| `push_notifications` | Push alerts |
| `require_captcha_voting` | Bot protection |
| `require_auth_voting` | Require login to vote |

---

## 12. Security

### Authentication & Authorization
- JWT-based sessions (24-hour expiry)
- Google OAuth with email whitelist
- Role-based access (user/admin)
- Protected routes via middleware

### CSRF Protection
- Double-submit cookie pattern
- Token format: `timestamp.randomBytes.signature`
- 1-hour expiry
- Timing-safe comparison

### Rate Limiting
- Per-endpoint limits
- Redis-backed (Upstash)
- In-memory fallback
- Returns standard headers

### Input Validation
- Zod schemas for all inputs
- XSS sanitization
- SQL injection prevention (Supabase client)

### Bot Protection
- hCaptcha integration
- Device fingerprinting
- Risk scoring
- Flagged vote tracking

### Security Headers
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

### File Upload Security
- Magic byte verification
- Polyglot detection
- Size limits
- Format whitelist

---

## 13. Deployment

### Vercel Deployment

1. Connect GitHub repository to Vercel
2. Configure environment variables
3. Deploy

### Environment Setup
See [Section 14](#14-environment-variables) for all required variables.

### Database Setup
1. Create Supabase project
2. Run migrations (see [Section 15](#15-database-migrations))
3. Configure RLS policies
4. Set up storage bucket

### Post-Deployment Checklist
- [ ] Verify all environment variables
- [ ] Run database migrations
- [ ] Test authentication flow
- [ ] Verify file uploads
- [ ] Check rate limiting
- [ ] Enable Sentry monitoring
- [ ] Set up uptime monitoring

---

## 14. Environment Variables

### Required Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Access Control
ALLOWED_EMAILS=admin@example.com,user@example.com

# Security
CSRF_SECRET=your-csrf-secret
```

### Optional Variables

```env
# hCaptcha (Bot Protection)
NEXT_PUBLIC_HCAPTCHA_SITE_KEY=xxx
HCAPTCHA_SECRET_KEY=xxx

# Upstash Redis (Rate Limiting)
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# Pusher (Real-time)
NEXT_PUBLIC_PUSHER_KEY=xxx
NEXT_PUBLIC_PUSHER_CLUSTER=xxx
PUSHER_SECRET=xxx

# Sentry (Monitoring)
SENTRY_DSN=https://xxx@sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_ORG=your-org
SENTRY_PROJECT=aimoviez
SENTRY_AUTH_TOKEN=xxx

# Site
NEXT_PUBLIC_SITE_URL=https://aimoviez.com
```

---

## 15. Database Migrations

### Migration Files

Located in `supabase/sql/`:

| File | Description |
|------|-------------|
| `fix-vote-delete-race-condition.sql` | Atomic vote deletion |
| `fix-profile-stats-n-plus-1.sql` | Optimized profile queries |
| `additional-indexes-from-audit.sql` | Performance indexes |
| `fix-admin-winner-transaction.sql` | Atomic winner assignment |
| `migration-contact-reports-blocks.sql` | Contact/report tables |
| `migration-comment-moderation.sql` | Comment moderation |
| `enable-rls-policies.sql` | Row-level security |

### Running Migrations

**Via Supabase Dashboard:**
1. Go to SQL Editor
2. Open migration file
3. Execute query

**Via CLI:**
```bash
# Install Supabase CLI
npm install -g supabase

# Link project
supabase link --project-ref your-project-ref

# Run migration
supabase db push
```

### Creating Feature Flag

```sql
INSERT INTO feature_flags (key, enabled, description)
VALUES ('require_captcha_voting', false, 'Require CAPTCHA for voting')
ON CONFLICT (key) DO NOTHING;
```

---

## 16. Testing

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
│   └── formatNumber.test.ts
└── components/
    └── BottomNavigation.test.tsx
```

### Writing Tests

```typescript
// Component test
import { render, screen } from '@testing-library/react';
import { BottomNavigation } from '@/components/BottomNavigation';

describe('BottomNavigation', () => {
  it('renders navigation items', () => {
    render(<BottomNavigation currentPath="/dashboard" />);
    expect(screen.getByText('Story')).toBeInTheDocument();
  });
});
```

### Mock Data

Use `useMockData` hook for development:

```typescript
const { clips, users, votes } = useMockData();
```

---

## 17. Troubleshooting

### Common Issues

#### "Unauthorized" on API routes
- Check `ALLOWED_EMAILS` includes your email
- Verify NextAuth session is valid
- Check JWT token expiry

#### Rate limit errors
- Verify Upstash credentials
- Check rate limit configuration
- Monitor Redis usage

#### File upload fails
- Verify Supabase Storage bucket exists
- Check file size (max 100MB)
- Verify file format (MP4/MOV/WebM)

#### CSRF validation fails
- Ensure `CSRF_SECRET` is set
- Check cookie settings
- Verify token header is sent

#### CAPTCHA not working
- Verify hCaptcha keys
- Check feature flag is enabled
- Test with hCaptcha test keys

### Debug Mode

Enable detailed logging:

```typescript
// In API route
const logger = createRequestLogger('debug', req);
logger.debug('Detailed info', { data });
```

### Health Check

```bash
curl https://your-domain.com/api/health
# Expected: { "status": "ok", "timestamp": "..." }
```

### Support

- GitHub Issues: [repository-url]/issues
- Documentation: `/docs` folder
- Contact: Use `/contact` form

---

## Appendix

### A. Keyboard Shortcuts (Dashboard)

| Key | Action |
|-----|--------|
| ↑ / ← | Previous clip |
| ↓ / → | Next clip |
| Space | Play/Pause |

### B. Vote Weighting Formula

```
weighted_score = SUM(vote_weight)
where vote_weight = 1 (standard), 3 (super), 10 (mega)
```

### C. Level Progression

| Level | XP Required |
|-------|-------------|
| 1 | 0 |
| 2 | 100 |
| 3 | 400 |
| 4 | 900 |
| 5 | 1,600 |
| 10 | 8,100 |
| 20 | 36,100 |

### D. API Response Format

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

*Documentation generated December 2024*
