# AiMoviez - Complete Project Documentation

## Overview

**AiMoviez** is a collaborative AI-powered video creation platform where users vote on 8-second clips to create global movie "seasons". The platform combines social voting, AI video generation, team competitions, and gamification into an immersive movie-making experience.

**Tech Stack:** Next.js 14, TypeScript, Supabase (PostgreSQL + Realtime), Upstash Redis, Cloudflare R2, fal.ai, ElevenLabs TTS, NextAuth (Google OAuth)

---

## Table of Contents

1. [User Flows & Pages](#1-user-flows--pages)
2. [Tournament & Voting System](#2-tournament--voting-system)
3. [AI Video Generation](#3-ai-video-generation)
4. [Story Mode & Collaborative Storytelling](#4-story-mode--collaborative-storytelling)
5. [Team Features](#5-team-features)
6. [Gamification & Progression](#6-gamification--progression)
7. [Admin Panel](#7-admin-panel)
8. [API Reference](#8-api-reference)
9. [Database Schema](#9-database-schema)
10. [External Integrations](#10-external-integrations)
11. [Security & Rate Limiting](#11-security--rate-limiting)
12. [Feature Flags](#12-feature-flags)

---

## 1. User Flows & Pages

### Authentication Flow
```
Landing (/) → Google OAuth → Onboarding (/onboarding) → Dashboard (/dashboard)
```

| Route | Purpose |
|-------|---------|
| `/` | Landing page with animated intro, Google OAuth login |
| `/onboarding` | Create username (3-20 chars), display name, bio, auto-generated avatar |

### Core Pages

| Route | Purpose | Key Features |
|-------|---------|--------------|
| `/dashboard` | **Voting Arena** | Vote on clips, swipe navigation, double-tap voting, genre filtering, real-time vote counts, comments |
| `/story` | **Active Season** | Watch in-progress clips, TikTok-style split view, swipe segments, season progress |
| `/watch` | **Finished Movies** | Browse completed seasons, full video player with playlist |
| `/upload` | **Manual Upload** | 3-step flow: select video (max 8.5s, 50MB), choose genre, submit |
| `/create` | **AI Generation** | Text-to-video with fal.ai, character pinning, narration |
| `/leaderboard` | **Rankings** | Top Clips, Top Voters, Top Creators tabs with medals |
| `/profile` | **My Profile** | Stats, badges, clips, vote history, settings |
| `/profile/[id]` | **Creator Profile** | View others' stats, follow/unfollow, share, report |
| `/team` | **Team Dashboard** | Create/join teams, team stats, invite members |
| `/teams` | **Team Leaderboards** | Team rankings and competitions |

### Navigation Structure
- **Mobile:** Bottom navigation bar (Vote, Story, Watch, Upload, Create, Ranks, Team, Profile)
- **Desktop:** Left sidebar with same navigation
- Cyberpunk color theme (fuchsia active, cyan inactive)

### Key Interactions
- **Double-tap:** Vote on video with heart animation
- **Swipe up/down:** Navigate between clips
- **Pull-to-refresh:** Reload voting data
- **Landscape mode:** Full-screen video with minimal controls

---

## 2. Tournament & Voting System

### Season Structure
- **75 slots per season** - each slot features one winning clip
- **Season statuses:** draft → active → finished → archived
- **Slot statuses:** upcoming → voting → locked → archived

### Voting Mechanics
- **Daily limit:** 200 votes per user
- **1 vote per clip** per user (enforced by unique constraint)
- **Vote weights:**
  - Standard: 1x (unlimited)
  - Super: 3x (1 per slot)
  - Mega: 10x (1 per slot)

### Scoring
- **vote_count:** Direct count of votes received
- **weighted_score:** Score with vote weight consideration
- **hype_score:** Combination of votes + views + time decay

### Winner Determination
- Highest vote count wins the slot
- Admin can manually assign winners
- Auto-advance via cron job (configurable timing)

### Real-time Updates
- Vote counts broadcast via Supabase Realtime
- 30-second polling for new clips/winners
- Optimistic UI updates for instant feedback

---

## 3. AI Video Generation

### Generation Pipeline
```
POST /api/ai/generate → fal.ai queue → Webhook callback → Video ready
     ↓                                                        ↓
User polls status ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
     ↓
POST /api/ai/complete → Download + optional merge → Upload to R2
     ↓
POST /api/ai/register → Create tournament clip
```

### Available Models
| Model | Cost | Duration | Resolution |
|-------|------|----------|------------|
| Kling 2.6 | 35¢ | 5s | 720p portrait |
| Veo3 Fast | 80¢ | 8s | 720p portrait |
| Hailuo 2.3 | 49¢ | 6s | 1080p landscape |
| Sora 2 | 80¢ | 8s | 720p portrait |
| Kling O1 (Reference) | 56¢ | 5s | 720p portrait |

### Style Prefixes
- Cinematic, Anime, Realistic, Abstract, Noir, Retro, Neon

### Character Pinning System
- Admin pins up to 4 characters per season from winning clips
- Auto-detects and switches to `kling-o1-ref` model
- Injects `@Element1 @Element2...` tags into prompts
- Maintains character consistency across clips
- Users can preview pinned characters via tap-to-preview modal

### ElevenLabs Narration
- Optional TTS voice-over for generated clips
- 200 character limit (configurable)
- 10 generations per day per user
- Server-side ffmpeg merge with video

### Cost Controls
- Daily limit: 3 free generations per user
- Global daily cap: $50 (configurable)
- Global monthly cap: $1,000 (configurable)
- Keyword blocklist for NSFW filtering

---

## 4. Story Mode & Collaborative Storytelling

### How It Works
1. **Season starts** with AI Co-Director generating a brief
2. **Creators submit clips** following the brief's direction
3. **Community votes** on submitted clips
4. **Winner locked** into the slot
5. **Next brief generated** based on story progression
6. **Repeat for 75 slots** to complete the movie

### AI Co-Director
- **Story Analysis:** Extracts characters, plot threads, setting, tone
- **Direction Voting:** Community votes on 3+ creative directions
- **Brief Generation:** Scene description, visual requirements, do's & don'ts, example prompts

### Story Viewer Features
- Split-view: video (55%) + season list (45%)
- Swipe between segments
- Real-time vote updates
- Comments per clip
- Contributors panel showing winning creators

---

## 5. Team Features

### Team Structure
- **Roles:** Leader (creator), Officer (manager), Member
- **Team stats:** XP, level, streaks, win count
- **Max size:** Configurable per team

### Team Competitions
- Combined votes from all members' clips
- Team streaks (maintained by member activity)
- Team leaderboard rankings

### Team Actions
- Create team with name, description, logo
- Generate invite codes/links
- Join via code at `/join/[code]`
- Team chat for coordination

---

## 6. Gamification & Progression

### XP & Levels
- **XP earned from:** Voting, uploading, winning clips/slots
- **Level thresholds:** Progressive XP requirements
- **Level badges:** Displayed on profile

### Badges & Achievements
- Creator badges for clip performance
- Voter badges for engagement
- Streak badges for consistency
- Unlock progress displayed in profile

### Leaderboards
1. **Top Clips:** Ranked by votes with % of total
2. **Top Creators:** Total votes received, clips uploaded
3. **Top Voters:** Total votes cast, streak, participation
4. **Teams:** Combined XP and performance

### Streaks
- **Voting streaks:** Daily voting maintains streak
- **Team streaks:** Collective team activity
- Displayed prominently in profile and leaderboards

---

## 7. Admin Panel

### Dashboard (`/admin`)
- Clip management and moderation
- Season/slot management
- User administration
- Feature flag controls
- Real-time stats

### Clip Moderation
- Filter: pending, active, rejected, locked
- Actions: approve, reject, lock, delete, assign winner
- Bulk operations for efficiency
- Edit metadata (title, description, genre)

### User Management (`/admin/users`)
- Search by username/email
- Ban/unban users
- Reset vote limits
- View stats (XP, clips, votes)

### Season Management
- Create seasons with slot counts
- Multi-genre support
- Archive/delete seasons
- Slot reorganization

### Character Pinning (`/admin/characters`)
- Pin characters from winning clips
- Extract frames at timestamps
- Manage reference images
- Toggle active/inactive

### Co-Director (`/admin/co-director`)
- Generate story analysis
- Create direction options
- Publish creative briefs
- View analytics

### Comment Moderation
- Queue: pending, flagged
- Approve/reject/delete
- Bulk moderation

### Audit Logging
- All admin actions tracked
- IP address, user agent captured
- Searchable history

---

## 8. API Reference

### AI Generation (8 endpoints)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ai/generate` | POST | Submit generation request |
| `/api/ai/status/[id]` | GET | Poll generation status |
| `/api/ai/complete` | POST | Prepare video for submission |
| `/api/ai/register` | POST | Register as tournament clip |
| `/api/ai/narrate` | POST | Generate TTS narration |
| `/api/ai/webhook` | POST | fal.ai completion webhook |
| `/api/ai/cancel` | POST | Cancel pending generation |
| `/api/ai/history` | GET | List user's generations |

### Core Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/vote` | POST | Cast vote on clip |
| `/api/story` | GET | Get season/slot data |
| `/api/upload/signed-url` | POST | Get upload URL |
| `/api/upload/register` | POST | Register uploaded clip |
| `/api/comments` | GET/POST | Read/write comments |
| `/api/leaderboard/*` | GET | Rankings data |
| `/api/teams/*` | CRUD | Team operations |
| `/api/user/profile` | GET/PUT | User profile |

### Admin Endpoints (35+ routes)
- `/api/admin/clips/*` - Clip CRUD
- `/api/admin/users/*` - User management
- `/api/admin/feature-flags/*` - Feature toggles
- `/api/admin/seasons/*` - Season management
- `/api/admin/co-director/*` - AI Co-Director
- `/api/admin/pinned-characters/*` - Character pinning

### Cron Jobs (8 scheduled)
| Job | Schedule | Purpose |
|-----|----------|---------|
| `ai-generation-timeout` | 5 min | Expire stale generations |
| `auto-advance` | 1 min | Advance voting slots |
| `cleanup-videos` | Daily | Delete orphaned files |
| `extract-missing-frames` | Hourly | Generate thumbnails |
| `process-comment-queue` | 30 sec | Batch comment moderation |
| `process-vote-queue` | 30 sec | Sync vote counts |
| `sync-leaderboards` | 5 min | Update rankings |
| `sync-vote-counters` | 1 min | Sync CRDT state |

---

## 9. Database Schema

### Core Tables
```sql
users (id, email, username, display_name, bio, avatar_url, xp, level,
       total_votes_cast, total_votes_received, streak, is_admin, is_banned)

seasons (id, label, status, total_slots, genre, created_at)

story_slots (id, season_id, slot_position, status, winner_tournament_clip_id,
             voting_started_at, voting_ends_at, genre)

tournament_clips (id, user_id, title, description, genre, video_url,
                  status, vote_count, weighted_score, hype_score,
                  is_ai_generated, ai_prompt, ai_model)

votes (id, voter_key, clip_id, weight, created_at)

teams (id, name, leader_id, level, total_xp, current_streak, member_count)

team_members (id, team_id, user_id, role, contribution_xp)

comments (id, clip_id, user_id, content, status, likes_count)

ai_generations (id, user_id, fal_request_id, status, prompt, model,
                video_url, cost_cents, narration_text)

pinned_characters (id, season_id, element_index, label, frontal_image_url,
                   reference_image_urls[], usage_count, is_active)

feature_flags (key, name, enabled, config)
```

---

## 10. External Integrations

### fal.ai (Video Generation)
- Models: Kling, Veo3, Hailuo, Sora
- Queue-based async processing
- ED25519 webhook signature verification
- 7-day video URL TTL

### Cloudflare R2 (Storage)
- S3-compatible API
- Signed upload URLs (15 min expiry)
- CDN URL: `https://cdn.aimoviez.app`
- Fallback to Supabase Storage

### ElevenLabs (TTS)
- Model: `eleven_multilingual_v2`
- Format: MP3 44.1kHz 128kbps
- Configurable voice settings

### Supabase
- PostgreSQL database
- Realtime subscriptions
- Row Level Security
- Storage for legacy uploads

### Upstash Redis
- Sliding window rate limiting
- Vote count caching
- Leaderboard caching
- Session data

### Sentry
- Error monitoring
- Performance tracing
- Source maps (production)

---

## 11. Security & Rate Limiting

### Rate Limits
| Endpoint | Limit | Window |
|----------|-------|--------|
| vote | 30 req | 1 min |
| upload | 5 req | 1 min |
| comment | 15 req | 1 min |
| ai_generate | 3 req | 1 min |
| ai_narrate | 5 req | 1 min |
| admin_write | 15 req | 1 min |

### Security Measures
- **CSRF protection:** Token-based, required on mutations
- **Authentication:** NextAuth with Google OAuth
- **Webhook verification:** ED25519 signatures
- **Input validation:** Zod schemas
- **Prompt sanitization:** Unicode normalization, keyword blocklist
- **Cost caps:** Daily/monthly limits prevent abuse
- **IP hashing:** Privacy-preserving rate limiting

---

## 12. Feature Flags

### Voting
- `multi_vote_mode` - Multiple votes per clip
- `async_voting` - Redis-first voting path
- `require_auth_voting` - Auth required
- `require_captcha_voting` - Bot protection

### AI Features
- `ai_video_generation` - Enable AI generation
- `character_pinning` - Character consistency
- `elevenlabs_narration` - TTS narration
- `ai_co_director` - Story analysis
- `prompt_learning` - Learn from prompts

### Performance
- `redis_leaderboards` - Redis-based rankings
- `vote_count_cache` - Vote caching
- `r2_storage` - Cloudflare R2

### UI/UX
- `spotlight_tour` - Onboarding tutorial
- `vote_button_progress` - Progress ring
- `multi_genre_enabled` - Genre support

---

## Key File Locations

| Category | Path |
|----------|------|
| Pages | `/src/app/*/page.tsx` |
| API Routes | `/src/app/api/*/route.ts` |
| Components | `/src/components/*.tsx` |
| Hooks | `/src/hooks/*.ts` |
| Libraries | `/src/lib/*.ts` |
| Types | `/src/types/index.ts` |
| Migrations | `/supabase/sql/*.sql` |
| Middleware | `/src/middleware.ts` |
| Config | `/next.config.ts` |

---

## Summary

AiMoviez delivers a sophisticated platform combining:

1. **Social Voting** - TikTok-like 8-second clip battles
2. **AI Creation** - Text-to-video with character consistency
3. **Collaborative Storytelling** - 75-slot seasons with briefs
4. **Gamification** - XP, levels, badges, streaks
5. **Teams** - Collaborative competitions
6. **Real-time** - Live vote counts, instant updates
7. **Mobile-first** - PWA with gesture controls

The platform is designed for scale with Redis caching, cost controls, comprehensive rate limiting, and robust security measures.

---

*Documentation generated: 2026-02-08*
