# AiMoviez — Full Infrastructure Cost Audit

**Date:** 2026-02-03
**Time:** Current session
**Source:** Codebase analysis of `/Users/wojtek/Desktop/aimoviez-app`

---

## 1. All Paid Services

### 1.1 Vercel (Hosting Platform) — $20/mo (Pro plan)

| Component | Details |
|-----------|---------|
| Hosting | Next.js app, serverless functions, edge middleware |
| Analytics | `@vercel/analytics` in layout.tsx |
| Speed Insights | `@vercel/speed-insights` in layout.tsx |

**8 Cron Jobs:**

| Cron Job | Schedule | Invocations/day |
|----------|----------|-----------------|
| `/api/cron/auto-advance` | Every 1 min | 1,440 |
| `/api/cron/process-vote-queue` | Every 1 min | 1,440 |
| `/api/cron/sync-vote-counters` | Every 1 min | 1,440 |
| `/api/cron/process-comment-queue` | Every 1 min | 1,440 |
| `/api/cron/sync-leaderboards` | Every 1 min | 1,440 |
| `/api/cron/ai-generation-timeout` | Every 5 min | 288 |
| `/api/cron/cleanup-videos` | Every 6 hours | 4 |
| `/api/cron/extract-missing-frames` | Every 1 hour | 24 |
| **Total cron invocations** | | **7,516/day = ~225,480/month** |

**Cost risk:** 5 cron jobs at 1-minute intervals dominate invocation count. Vercel Pro includes limited function invocations; overages could add cost.

---

### 1.2 Supabase (Database + Realtime + Storage) — $0-25/mo

**~21 database tables:**
`users`, `followers`, `feature_flags`, `referrals`, `notifications`, `ai_generations`, `ai_generation_limits`, `comments`, `comment_likes`, `genre_votes`, `contact_submissions`, `content_reports`, `user_blocks`, `audit_logs`, `push_subscriptions`, `clip_views`, `tournament_clips`, `votes`, `story_slots`, `seasons`, `cron_locks`

**40+ RPC functions** (atomic operations for votes, credits, leaderboards, admin actions)

**7 Realtime channels:**
- `votes`, `clips-realtime`, `slots-realtime`, `votes-realtime`, `story-updates`, `comments:{clipId}`, `leaderboard`
- postgres_changes on: `tournament_clips`, `story_slots`, `votes`
- Broadcast events: vote-update, winner-selected, season-reset, new-comment, comment-liked, comment-deleted, leaderboard-updated

**3 pg_cron jobs (database-level):**
- `refresh-vote-counts` — every 5 min
- `refresh-clip-stats` — every 5 min
- `cleanup-old-views` — daily at 3 AM UTC

**Storage bucket:** `clips` (video files, when R2 is disabled)

**Cost risk:** Realtime concurrent connections bill at scale. Each connected user holds a WebSocket. At 1K+ concurrent users, Supabase Pro ($25/mo) may not be enough.

---

### 1.3 Upstash Redis — $0-10+/mo (pay-per-command)

**9 modules using Redis:**

| Module | Purpose | Command Volume |
|--------|---------|----------------|
| Rate limiting (`rate-limit.ts`) | Sliding window on all API routes | High — every API call |
| Session store (`session-store.ts`) | Session caching (30 min TTL) | High — every auth check |
| Vote event queue (`vote-event-queue.ts`) | Async vote processing via Redis lists | High — every vote |
| Comment event queue (`comment-event-queue.ts`) | Async comment processing | Moderate |
| Leaderboard sorted sets (`leaderboard-redis.ts`) | ZADD/ZRANGE for instant rankings | Moderate |
| Seen tracking (`seen-tracking.ts`) | SADD/SISMEMBER for clip dedup | High — every clip view |
| Vote count cache (`vote-count-cache.ts`) | 15s TTL cache for vote counts | High — every page load |
| CRDT vote counter (`crdt-vote-counter.ts`) | Distributed PN-counter for votes | High — every vote |
| Vote validation (`vote-validation-redis.ts`) | Fast vote dedup/daily limit checks | High — every vote |

**Cost risk:** Linear scaling with users. 5 cron jobs also hit Redis every minute. At 10K DAU with active voting, could reach millions of commands/month.

---

### 1.4 Cloudflare R2 (Video Storage + CDN) — $0-5/mo

| Component | Details |
|-----------|---------|
| Bucket | `aimoviez-videos` |
| CDN domain | `cdn.aimoviez.app` |
| Pricing | $0.015/GB storage, $4.50/M Class A ops, $0.36/M Class B ops, **free egress** |

Feature-flag-gated: Only active when `r2_storage` flag is enabled. Falls back to Supabase storage when disabled.

---

### 1.5 Cloudflare Worker (Edge Rate Limiting) — $0-5/mo

| Component | Details |
|-----------|---------|
| Worker name | `aimoviez-rate-limiter` |
| Routes | `aimoviez.app/api/*`, `www.aimoviez.app/api/*` |
| KV namespace | `d08a583ec7c14f27907474884a7ba894` (rate limit counters) |
| Free tier | 100K requests/day, 100K KV reads/day |

---

### 1.6 fal.ai (AI Video Generation) — Variable, $0.35-$0.80/generation

**Text-to-video models:**

| Model | fal.ai Model ID | Cost/Gen |
|-------|----------------|----------|
| Kling 2.6 | `fal-ai/kling-video/v2.6/pro/text-to-video` | $0.35 |
| Hailuo 2.3 | `fal-ai/minimax/hailuo-2.3/pro/text-to-video` | $0.49 |
| Veo3 Fast | `fal-ai/veo3/fast` | $0.80 |
| Sora 2 | `fal-ai/sora-2/text-to-video` | $0.80 |

**Image-to-video models:**

| Model | fal.ai Model ID | Cost/Gen |
|-------|----------------|----------|
| Kling 2.6 | `fal-ai/kling-video/v2.6/pro/image-to-video` | $0.35 |
| Hailuo 2.3 | `fal-ai/minimax/hailuo-2.3/pro/image-to-video` | $0.49 |
| Sora 2 | `fal-ai/sora-2/image-to-video` | $0.80 |

**fal.ai endpoints used:** queue submit, status polling, cancellation, JWKS verification, webhook receiver

**Cost risk:** Single largest variable cost. Free tier at 1 gen/day with 10K users = up to $10,395/month.

---

### 1.7 ElevenLabs (AI Narration TTS) — $0.05/narration

| Setting | Value |
|---------|-------|
| Model | `eleven_flash_v2_5` |
| Max chars | 200 |
| Daily limit | 10 per user |
| Voices | 6 (Rachel, Bella, Antoni, Josh, Arnold, Adam) |
| Output | MP3 44100Hz 128kbps |

Feature-flag-gated: Only active when `elevenlabs_narration` is enabled.

---

### 1.8 Sentry (Error Monitoring) — $0 (free tier)

| Config | Value |
|--------|-------|
| Client trace sampling | 10% |
| Server trace sampling | 10% |
| Edge trace sampling | 5% |
| Session replay | 10% (100% on error) |
| Free tier | 5K errors + 50 replays/month |

Conditionally enabled: Only activates when `SENTRY_DSN` is set.

---

### 1.9 Domain Registration — ~$18/year ($1.50/mo)

| Domain | `aimoviez.app` |
|--------|----------------|
| TLD | `.app` (~$14-20/year) |
| DNS | Cloudflare (free) |
| CDN subdomain | `cdn.aimoviez.app` |

---

## 2. Free Services (No Cost)

| Service | Purpose |
|---------|---------|
| Google OAuth | Authentication (2 allowlisted emails currently) |
| hCaptcha | Bot protection (free up to 1M verifications/mo, feature-flagged) |
| DiceBear | Fallback avatar generation via API |
| Google Fonts | Inter font |
| Web Push API | Browser native push notifications (not yet fully implemented) |

---

## 3. Services NOT Present (Confirmed Absent)

| Service | Status |
|---------|--------|
| Stripe | Not installed, no env vars, no payment processing |
| Pusher | Not used — realtime via Supabase only |
| SendGrid/Resend/Postmark | No email service |
| OpenAI/Anthropic | No LLM API usage |
| Cloudinary | Referenced but not configured |
| AWS S3 | Referenced but not configured |

---

## 4. Monthly Cost Estimates by Scale

### Beta (2 users, low traffic)

| Service | Estimated Cost |
|---------|---------------|
| Vercel Pro | $20.00 |
| Supabase Free | $0.00 |
| Upstash Redis | $0.00-$3.00 |
| Cloudflare R2 | $0.00 |
| Cloudflare Worker | $0.00 |
| fal.ai | $5.00-$20.00 |
| ElevenLabs | $0.00-$2.00 |
| Sentry | $0.00 |
| Domain | $1.50 |
| **Total** | **$27-$47/month** |

### 1,000 Users (early stage)

| Service | Estimated Cost |
|---------|---------------|
| Vercel Pro | $20.00 |
| Supabase Pro | $25.00 |
| Upstash Redis | $10.00 |
| Cloudflare R2 | $2.00 |
| Cloudflare Worker | $0.00 |
| fal.ai (free gens) | $1,040 (330 DAU × 30% × 30 days × $0.35) |
| fal.ai (paid gens) | $407 (50 payers × 15 gens × $0.54) |
| ElevenLabs | $8.00 |
| Sentry | $0.00 |
| Domain | $1.50 |
| **Total** | **~$1,514/month** |

### 5,000 Users (growth)

| Service | Estimated Cost |
|---------|---------------|
| Vercel Pro | $20.00 |
| Supabase Pro | $25.00 |
| Upstash Redis | $25.00-$50.00 |
| Cloudflare R2 | $5.00-$10.00 |
| Cloudflare Worker | $5.00 |
| fal.ai (free gens) | $5,198 |
| fal.ai (paid gens) | $2,034 |
| ElevenLabs | $38.00 |
| Sentry | $0.00-$26.00 |
| Domain | $1.50 |
| **Total** | **~$7,352-$7,407/month** |

### 10,000 Users (established)

| Service | Estimated Cost |
|---------|---------------|
| Vercel Pro | $20.00 |
| Supabase Pro | $25.00-$75.00 |
| Upstash Redis | $50.00-$100.00 |
| Cloudflare R2 | $10.00-$20.00 |
| Cloudflare Worker | $5.00-$10.00 |
| fal.ai (free gens) | $10,395 |
| fal.ai (paid gens) | $4,069 |
| ElevenLabs | $75.00 |
| Sentry | $26.00 |
| Domain | $1.50 |
| **Total** | **~$14,677-$14,791/month** |

---

## 5. Cost Dominance Analysis

At 10,000 users, cost breakdown by category:

| Category | Monthly Cost | % of Total |
|----------|-------------|-----------|
| **fal.ai (free generations)** | $10,395 | **70.5%** |
| **fal.ai (paid generations)** | $4,069 | **27.6%** |
| ElevenLabs narration | $75 | 0.5% |
| Infrastructure (Vercel+Supabase+Redis+R2+CF) | $225 | 1.5% |

**fal.ai accounts for 98% of total costs.** Infrastructure is negligible. The free tier is the dominant cost driver.

---

## 6. Environment Variables (Complete Inventory)

### In `.env.local` (22 vars)

| Variable | Service |
|----------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `NEXTAUTH_URL` | NextAuth |
| `NEXTAUTH_SECRET` | NextAuth |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis |
| `SUPABASE_URL` | Supabase |
| `SUPABASE_ANON_KEY` | Supabase |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| `CLOUDFLARE_R2_ENDPOINT` | Cloudflare R2 |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | Cloudflare R2 |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | Cloudflare R2 |
| `CLOUDFLARE_R2_BUCKET` | Cloudflare R2 |
| `CLOUDFLARE_R2_PUBLIC_URL` | Cloudflare R2 |
| `FAL_KEY` | fal.ai |
| `NEXT_PUBLIC_APP_URL` | Self |
| `ELEVENLABS_API_KEY` | ElevenLabs |
| `ADMIN_SECRET_KEY` | Internal |
| `ADMIN_VALID_TOKENS` | Internal |
| `ALLOWED_EMAILS` | Internal |

### In Vercel production (additional)

| Variable | Service |
|----------|---------|
| `SENTRY_DSN` | Sentry |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry |
| `SENTRY_ORG` | Sentry |
| `SENTRY_PROJECT` | Sentry |
| `SENTRY_AUTH_TOKEN` | Sentry |
| `CRON_SECRET` | Vercel Cron auth |
| `HCAPTCHA_SECRET_KEY` | hCaptcha |
| `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | hCaptcha |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push |
| `CSRF_SECRET` | Internal |
| `VOTE_INTEGRITY_SECRET` | Internal |
| `LOG_LEVEL` | Internal |
| `CRDT_NODE_ID` | Internal |

### Future (credit system, not yet added)

| Variable | Service |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe |
| `STRIPE_WEBHOOK_SECRET` | Stripe |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe |
