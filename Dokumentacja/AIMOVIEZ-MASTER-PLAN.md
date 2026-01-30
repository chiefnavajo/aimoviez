# AiMoviez Master Plan: Millions of Users, Millions of Videos

## Vision

Transform AiMoviez from a single-server app handling ~100 concurrent users into a globally distributed platform capable of serving **millions of users**, processing **millions of votes per day**, hosting **millions of videos**, and delivering content worldwide with sub-50ms latency.

This is the **single source of truth**. It unifies and supersedes all previous scaling analyses.

---

## Table of Contents

1. [Where We Stand Today](#1-where-we-stand-today)
2. [The Target Architecture](#2-the-target-architecture)
3. [System 1: Voting Engine](#3-system-1-voting-engine)
4. [System 2: Authentication & Identity](#4-system-2-authentication--identity)
5. [System 3: Video Pipeline & Storage at Scale](#5-system-3-video-pipeline--storage-at-scale)
6. [System 4: Real-Time Layer](#6-system-4-real-time-layer)
7. [System 5: Comments at Scale](#7-system-5-comments-at-scale)
8. [System 6: Leaderboards & Analytics](#8-system-6-leaderboards--analytics)
9. [System 7: Notifications at Scale](#9-system-7-notifications-at-scale)
10. [System 8: Social Graph](#10-system-8-social-graph)
11. [System 9: Anti-Fraud & Moderation](#11-system-9-anti-fraud--moderation)
12. [System 10: Smart Content Distribution](#12-system-10-smart-content-distribution)
13. [System 11: Search & Discovery at Scale](#13-system-11-search--discovery-at-scale)
14. [System 12: Creator Economy at Scale](#14-system-12-creator-economy-at-scale)
15. [System 13: Database Evolution](#15-system-13-database-evolution)
16. [System 14: Offline-First & Mobile](#16-system-14-offline-first--mobile)
17. [System 15: Resilience & Circuit Breakers](#17-system-15-resilience--circuit-breakers)
18. [Implementation Roadmap](#18-implementation-roadmap)
19. [Zero-Downtime Migration](#19-zero-downtime-migration)
20. [File-Level Migration Map](#20-file-level-migration-map)
21. [Load Testing Strategy](#21-load-testing-strategy)
22. [Infrastructure Map](#22-infrastructure-map)
23. [Cost Model](#23-cost-model)
24. [Monitoring & Observability](#24-monitoring--observability)
25. [Disaster Recovery & Rollback](#25-disaster-recovery--rollback)
26. [Redis Memory Budget](#26-redis-memory-budget)
27. [API Versioning Strategy](#27-api-versioning-strategy)
28. [GDPR & Data Privacy](#28-gdpr--data-privacy)
29. [CI/CD & Deployment Safety](#29-cicd--deployment-safety)
30. [Appendix: Decision Log](#30-appendix-decision-log)

---

## 1. Where We Stand Today

### 1.1 What We Have (Complete Inventory)

**51 API routes** across 7 domains:

| Domain | Routes | Key Endpoints |
|--------|--------|--------------|
| Voting | 2 | `/api/vote` (GET/POST/DELETE), `/api/genre-vote` |
| Clips | 5 | `/api/clip/[id]`, `/api/discover`, `/api/watch`, `/api/upload`, `/api/upload/signed-url` |
| Users | 5 | `/api/user/profile`, `/api/user/follow`, `/api/user/block`, `/api/user/create-profile` |
| Social | 4 | `/api/comments` (CRUD), `/api/notifications` (CRUD+subscribe) |
| Leaderboard | 5 | `/api/leaderboard`, `/api/leaderboard/clips`, `/voters`, `/creators`, `/live` |
| Admin | 17 | `/api/admin/clips`, `/approve`, `/reject`, `/users`, `/audit-logs`, `/feature-flags` |
| System | 13 | `/api/auth`, `/api/health`, `/api/cron/auto-advance`, `/api/referral`, `/api/story` |

**18 database tables:**

| Table | Rows at Scale | Hot Path? |
|-------|--------------|-----------|
| `users` | Millions | Auth, profiles |
| `seasons` | ~10-50 | Low traffic |
| `story_slots` | ~75 per season | Slot transitions |
| `tournament_clips` | Millions | **HOT** — vote counts |
| `votes` | Hundreds of millions | **HOTTEST** — inserts + triggers |
| `comments` | Tens of millions | Inserts per clip |
| `comment_likes` | Hundreds of millions | Like per comment |
| `notifications` | Hundreds of millions | Per-user writes |
| `followers` | Tens of millions | Social graph |
| `genre_votes` | Millions | One per user |
| `clip_views` | Hundreds of millions | View tracking |
| `feature_flags` | ~20 | Admin only |
| `referrals` | Millions | Growth tracking |
| `contact_submissions` | Thousands | Support |
| `content_reports` | Thousands | Moderation |
| `user_blocks` | Thousands | Safety |
| `push_subscriptions` | Millions | Push delivery |
| `audit_logs` | Millions | Compliance |

### 1.2 Frontend (TikTok-Ready)

| Pattern | Implementation | File |
|---------|---------------|------|
| Optimistic UI | React Query `onMutate` instant +1 | Dashboard components |
| Haptic feedback | `navigator.vibrate(50)` on vote | Vote button handler |
| Sound effects | `sounds.play('vote')` + milestones | Sound system |
| Rollback on failure | `onError` reverts UI silently | React Query config |
| Vote toggle | Vote + revoke mutations | `/api/vote` POST/DELETE |
| Smart distribution | `get_clips_randomized()` RPC | `/api/vote` GET handler |
| Device fingerprint | SHA256(IP + UA + browser hints) | `src/lib/device-fingerprint.ts` |
| CDN caching | `s-maxage=30, stale-while-revalidate=120` | API response headers |
| Confetti | Canvas confetti at 1, 50, 100, 200 | Client-side milestones |
| Comments | Threaded, likes, pagination | `/api/comments` |
| Follow/block | Social graph with counts | `/api/user/follow`, `/api/user/block` |
| Notifications | 10 event types, push-ready | `/api/notifications` |
| XP/levels | Formula: `FLOOR(SQRT(xp/100))+1` | `users.level`, `users.xp` |
| Real-time hooks | 4 hooks (clips, slots, votes, broadcast) | `src/hooks/useRealtimeClips.ts` |

**The frontend is production-ready for the current feature set.** Most scaling work is backend, but new capabilities (search UI, discovery pages, video quality selector, Pusher WebSocket listeners, offline indicators, connection-aware preloading) will require targeted frontend additions in Phases 2-3.

### 1.3 Current Bottlenecks

```
BOTTLENECK #1: Hot Row Lock (Voting)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Current flow (src/app/api/vote/route.ts):
  POST → rate limit (30/min) → device fingerprint → daily limit check (DB query)
  → clip validation (DB query) → slot validation (DB query) → risk assessment
  → insert_vote_atomic() RPC → SELECT FOR UPDATE lock → INSERT vote
  → TRIGGER: UPDATE tournament_clips.vote_count → return
All votes for same clip SERIALIZE on row-level exclusive lock
Max throughput: ~100 concurrent votes

BOTTLENECK #2: Database-Bound Auth
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
src/lib/auth-options.ts: jwt callback queries DB every 5 min
  SELECT id, username FROM users WHERE email = $1
Admin checks in /api/admin/* routes query DB every request
10,000 users × 288 auth queries/day = 2,880,000 auth queries/day

BOTTLENECK #3: Single DB, 3 Connections
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Supabase Free tier: 3 connections
All 51 API routes compete for 3 connections
Vote reads, writes, auth, comments, leaderboards — all same pool

BOTTLENECK #4: No Real-Time for Other Users
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
src/hooks/useRealtimeClips.ts exists but Supabase Realtime has
  postgres_changes binding issues
useStoryBroadcast uses broadcast channel (works for slot events)
Vote count updates only on page reload

BOTTLENECK #5: Video Delivery Not Scalable
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Currently: AWS S3 via signed URLs (src/app/api/upload/signed-url/)
Single region, no CDN, no adaptive bitrate, no thumbnails
At millions of videos: storage costs explode, delivery slow globally

BOTTLENECK #6: Comments & Social (Sync Writes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Comments: INSERT synchronously to DB, no push delivery
Follows: TRIGGER updates users.followers_count (hot row at scale)
Notifications: sync INSERT, user must visit page to see

BOTTLENECK #7: No Video Search/Discovery
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No full-text search on clip titles/descriptions
No tag/category filtering beyond genre
At millions of clips: browsing becomes impossible
```

### 1.4 Current Capacity

| Resource | Current | Limit |
|----------|---------|-------|
| DB connections | 3 (Free) | Saturated at ~10 DAU |
| Concurrent votes | ~100 | Row lock serialization |
| Auth queries/day (10K users) | 2,880,000 | DB can't handle |
| Rate limit throughput | 33/sec (Upstash Free) | 0 when Redis down |
| Video storage | AWS S3, single region | No CDN, high egress cost |
| Video search | None | Linear scan only |
| Real-time updates | Partially disabled | Broadcast works, changes don't |
| Comment delivery | Polling | No push |

### 1.5 Completed Work (January 2026)

**Security Hardening (4 audit rounds):**
- CSRF double-submit cookie pattern on all state-changing components (ClipPageClient, settings, contact, join, ReportModal, admin pages)
- CSP: removed `unsafe-eval` in production, kept for dev HMR
- Timing-safe CSRF signature comparison (constant-time XOR in Edge Runtime)
- Input sanitization on create-profile (display_name, bio, avatar_url)
- Video URL validation (HTTPS only, restricted to supabase.co / r2.dev / cdn.aimoviez.app)
- Push notification endpoint validation (known push service domains only)
- Rate limiting on user/block, notifications/subscribe endpoints
- Crypto-secure filenames (crypto.randomBytes instead of Math.random)
- UUID validation on clipId in comments
- Error detail leak fixes across API routes (no internal messages exposed)
- HSTS preload directive
- Email masking in auth logs
- Dev-only console.log guards on realtime hooks
- Notification action_url sanitization
- excludeIds capped at 200 in vote API
- TOCTOU race handling in create-profile (PostgreSQL 23505)

**Slot Advancement Safeguards:**
- Admin clip deletion: winner clips blocked (HTTP 409), last active clip in voting slot triggers auto-reset to `waiting_for_clips`
- Manual advance (`/api/admin/advance-slot`): verifies active clips exist in next slot before starting voting timer
- Auto-advance cron (`/api/cron/auto-advance`): same safeguard — zero clips → `waiting_for_clips`, not `voting`

**UX Fixes:**
- Daily vote limit toast on dashboard and clip detail page
- Clip approval auto-starts voting on `waiting_for_clips` slots (approve endpoint)

**Infrastructure:**
- Video CDN: `cdn.aimoviez.app` (Cloudflare R2)
- Monitoring: Sentry error tracking
- Domain: `aimoviez.app` with Cloudflare DNS

---

## 2. The Target Architecture

### 2.1 The Big Picture

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                          AIMOVIEZ TARGET ARCHITECTURE                       ║
║                    Millions of Users • Millions of Videos                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                             ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │                     CDN + EDGE LAYER                                │    ║
║  │  Cloudflare (200+ PoPs)                                             │    ║
║  │  ├── Token Bucket rate limiting (per-IP, burst-friendly)            │    ║
║  │  ├── JWT signature validation (stateless, 0.1ms)                    │    ║
║  │  ├── Video delivery via R2 CDN (global edge cache)                  │    ║
║  │  ├── Bot detection + JS challenge                                   │    ║
║  │  ├── Search index API (Meilisearch/Typesense)                       │    ║
║  │  └── Geographic routing to nearest origin                           │    ║
║  └─────────────────────────────────────────────────────────────────────┘    ║
║                                    │                                        ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │                   APPLICATION LAYER (Vercel Edge)                   │    ║
║  │  ├── Vote API      (6-8ms, Redis-only hot path)                     │    ║
║  │  ├── Auth API      (0.1ms JWT, zero DB)                             │    ║
║  │  ├── Clips API     (Redis-cached, DB fallback)                      │    ║
║  │  ├── Comments API  (Redis cache + Pusher push)                      │    ║
║  │  ├── Social API    (Redis counters, async DB)                       │    ║
║  │  ├── Search API    (search index, sub-50ms)                         │    ║
║  │  ├── Upload API    (signed URL → R2 direct)                         │    ║
║  │  └── Admin API     (JWT permission checks)                          │    ║
║  └─────────────────────────────────────────────────────────────────────┘    ║
║                                    │                                        ║
║          ┌─────────────────────────┼─────────────────────────┐              ║
║          ▼                         ▼                         ▼              ║
║  ┌────────────────┐   ┌──────────────────┐   ┌────────────────────┐        ║
║  │  REDIS         │   │  REAL-TIME       │   │  QUEUE LAYER       │        ║
║  │  (Upstash)     │   │  (Pusher)        │   │  (Redis Lists)     │        ║
║  │                │   │                  │   │                    │        ║
║  │ CRDT Counters  │   │ Vote broadcasts  │   │ vote_queue         │        ║
║  │ Daily limits   │   │ Comment push     │   │ comment_queue      │        ║
║  │ Dedup sets     │   │ Leaderboard live │   │ notification_queue │        ║
║  │ Bloom filters  │   │ Notifications    │   │ analytics_queue    │        ║
║  │ Session cache  │   │ Presence         │   │ follow_queue       │        ║
║  │ Sorted Sets    │   │                  │   │ xp_queue           │        ║
║  │ HyperLogLog    │   │                  │   │ transcode_queue    │        ║
║  │ Comment cache  │   │                  │   │ search_index_queue │        ║
║  └────────────────┘   └──────────────────┘   └────────────────────┘        ║
║          │                                           │                      ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │                   BACKGROUND WORKERS (QStash / Cron)                │    ║
║  │  ├── Vote batch processor        (every 1-5 sec)                    │    ║
║  │  ├── Counter sync                (every 5-10 sec)                   │    ║
║  │  ├── Comment batch processor     (every 5 sec)                      │    ║
║  │  ├── Notification dispatcher     (every 5 sec)                      │    ║
║  │  ├── Leaderboard rebuild         (every 30 sec)                     │    ║
║  │  ├── Auto-advance slots          (every 1 min) [existing]           │    ║
║  │  ├── Analytics aggregator        (every 5 min)                      │    ║
║  │  ├── XP/Achievement processor    (every 10 sec)                     │    ║
║  │  ├── Clip pool rebuild            (every 30 sec)                     │    ║
║  │  ├── View count sync             (every 30 sec)                     │    ║
║  │  ├── Search index sync           (every 30 sec)                     │    ║
║  │  ├── Video transcode pipeline    (event-driven)                     │    ║
║  │  └── Fraud detection sweep       (every 5 min)                      │    ║
║  └─────────────────────────────────────────────────────────────────────┘    ║
║                                    │                                        ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │                   DATA LAYER                                        │    ║
║  │                                                                     │    ║
║  │  PostgreSQL (Supabase Pro)                                          │    ║
║  │  ├── Primary: Batch writes only (no triggers on votes)              │    ║
║  │  ├── Read Replica: Leaderboards, analytics, profiles                │    ║
║  │  ├── PgBouncer: 200+ pooled connections                             │    ║
║  │  ├── Table partitioning: votes by month, clips by season            │    ║
║  │  └── Optimized for batch operations                                 │    ║
║  │                                                                     │    ║
║  │  Cloudflare R2: Video storage + global CDN                          │    ║
║  │  ├── Millions of videos, content-addressed (SHA256)                 │    ║
║  │  ├── Adaptive bitrate variants: 720p/480p/360p (~64TB at 1M clips)  │    ║
║  │  ├── Auto-generated thumbnails + 5sec previews                      │    ║
║  │  └── $0 egress (free), $0.015/GB/mo storage (~$960/mo at 1M clips) │    ║
║  │                                                                     │    ║
║  │  Search Index (Meilisearch Cloud / Typesense Cloud)                 │    ║
║  │  ├── Millions of clips indexed: title, description, genre, creator  │    ║
║  │  ├── Typo-tolerant, instant results (<50ms)                         │    ║
║  │  ├── Faceted filtering: genre, season, status, date range           │    ║
║  │  └── Synced from DB via background worker                           │    ║
║  └─────────────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### 2.2 Design Principles

1. **Redis is the runtime brain** — All hot-path operations hit Redis, never PostgreSQL
2. **PostgreSQL is the persistent memory** — Batch-synced, never in the hot path
3. **Edge-first** — Rate limiting, JWT validation, video delivery at CDN edge
4. **Async by default** — User gets instant response, heavy work in background queues
5. **Frontend already TikTok-quality** — Optimistic UI, haptics, sounds stay; new pages added for search, discovery, offline
6. **Fail-closed, recover-fast** — Reject when Redis fails, recover from PostgreSQL
7. **Every write is an event** — Vote, comment, follow, XP gain → all queued
8. **Graceful degradation** — Circuit breakers prevent cascade failures
9. **Videos are first-class** — CDN-native, content-addressed, globally cached
10. **Search everything** — Millions of clips discoverable in <50ms

---

## 3. System 1: Voting Engine

The voting engine is the heart of AiMoviez. It processes millions of concurrent votes with sub-15ms server response.

### 3.1 Current Flow (What Changes)

```
CURRENT (src/app/api/vote/route.ts POST handler):
  1. rateLimit(req, 'vote')                    → 30/min Upstash sliding window
  2. verifyHCaptcha(captchaToken)               → optional hCaptcha check
  3. generateDeviceKey(req)                     → SHA256(IP+UA)
  4. getUserVotesToday(voterKey, supabase)       → DB: SELECT SUM(vote_weight)
  5. fetchClip(clipId, supabase)                → DB: SELECT from tournament_clips
  6. fetchActiveSlot(seasonId, supabase)         → DB: SELECT from story_slots
  7. assessDeviceRisk(signals)                   → Risk score calculation
  8. supabase.rpc('insert_vote_atomic', {...})   → DB: SELECT FOR UPDATE + INSERT + TRIGGER
  9. Return { success, newScore, remainingVotes }

  Total DB queries: 5 (4 reads + 1 RPC with lock)
  Total time: 100-500ms
  Bottleneck: Step 8 — row lock on tournament_clips
```

### 3.2 Target Flow (6-Layer Pipeline)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: Edge Gate (Cloudflare Worker)                          <1ms    │
│ Token Bucket: 10 burst, 0.5/sec refill (30/min avg)                    │
│ Block bots, invalid requests never reach origin                         │
│ ─────────────────────────────────────────────────────────────────────── │
│ LAYER 2: Redis Validation                                       3ms     │
│ ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                      │
│ │ Daily Limit │→ │ Dedup Check │→ │ Slot Valid? │                      │
│ │ GET daily:  │  │ EXISTS voted│  │ GET slot:   │                      │
│ │ {date}:     │  │ :{voter}:   │  │ {season}    │                      │
│ │ {voter}     │  │ {clip}      │  │ voting?     │                      │
│ │ < 200?      │  │ = 0?        │  │             │                      │
│ └─────────────┘  └─────────────┘  └─────────────┘                      │
│      0.5ms           0.5ms             0.5ms                            │
│ ─────────────────────────────────────────────────────────────────────── │
│ LAYER 3: CRDT Counter Update                                    1ms     │
│ HINCRBY crdt:{clipId}:p {nodeId} 1      (P-counter increment)         │
│ HINCRBY crdt:{clipId}:pw {nodeId} W     (weighted score)               │
│ SADD clips_active {clipId}               (track for sync)              │
│ ─────────────────────────────────────────────────────────────────────── │
│ LAYER 4: Record & Queue (atomic pipeline)                       2ms     │
│ SET voted:{voter}:{clip} 1 EX 604800    (7-day dedup)                  │
│ INCRBY daily:{date}:{voter} 1           (daily counter)                │
│ LPUSH vote_queue {eventJSON}             (persistence queue)           │
│ ZINCRBY leaderboard:voters {voter} 1     (live leaderboard)            │
│ PFADD hll:voters:{clip} {voter}          (unique voter HLL)            │
│ LPUSH xp_queue {xpEvent}                 (XP gain event)              │
│ ─────────────────────────────────────────────────────────────────────── │
│ LAYER 5: Response                                               1ms     │
│ Read CRDT → sum P - N → return vote count                               │
│ { success, voteCount, remaining, responseTime: 8ms }                    │
│ ─────────────────────────────────────────────────────────────────────── │
│ LAYER 6: Async Broadcast                                        async   │
│ Pusher trigger('clip-{id}', 'vote', { count, weighted })               │
│ All connected viewers see update within 1-2 seconds                    │
└──────────────────────────────────────────────────────────────────────────┘

                 ═══ ASYNC BOUNDARY (user doesn't wait) ═══

┌──────────────────────────────────────────────────────────────────────────┐
│ BACKGROUND: Vote Queue Processor (every 1-5 sec)                        │
│ 1. RPOPLPUSH vote_queue → processing_queue (crash-safe)                │
│ 2. Group by clip_id → batch INSERT (500 per transaction)               │
│ 3. No triggers (DISABLED) → no row locks                               │
│ 4. Acknowledge processed events                                         │
│ 5. On failure: votes stay in processing_queue → recovery retries       │
├──────────────────────────────────────────────────────────────────────────┤
│ BACKGROUND: Counter Sync (every 5-10 sec)                               │
│ 1. SMEMBERS clips_active → clips with recent votes                     │
│ 2. Read CRDT P - N → accurate count per clip                           │
│ 3. UPDATE tournament_clips SET vote_count = X                          │
│ 4. PostgreSQL stays consistent for slot advancement + analytics        │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Why CRDT PN-Counter (Not Sharded Counters)

| Property | Sharded Counters (100 keys) | CRDT PN-Counter (4 hashes) |
|----------|---------------------------|---------------------------|
| Vote removal | Manual, error-prone | Built-in N-counter |
| Read cost | SUM 100 shards (100 calls) | HGETALL 2 hashes (2 calls for count) |
| Multi-region sync | Requires coordination | Automatic merge (math) |
| Network partition | Can diverge permanently | Always converges |
| Negative count risk | Possible with race conditions | Impossible by design |
| Memory per clip | 100 keys | 4 hashes (p, n, pw, nw) |

```
Redis data model per clip:
  crdt:{clipId}:p   = Hash { nodeId → increment_count }
  crdt:{clipId}:n   = Hash { nodeId → decrement_count }
  crdt:{clipId}:pw  = Hash { nodeId → weighted_increment }
  crdt:{clipId}:nw  = Hash { nodeId → weighted_decrement }

  Total votes = SUM(p values) - SUM(n values)
  Merge rule: MAX(local, remote) per node → guaranteed convergence
```

### 3.4 Vote Removal (4ms)

```
User taps "remove vote" → DELETE /api/vote
1. EXISTS voted:{voter}:{clip}         0.5ms  (verify vote exists)
2. HINCRBY crdt:{clip}:n {nodeId} 1   1ms    (N-counter increment)
3. Pipeline:                           1ms
   DEL voted:{voter}:{clip}
   DECRBY daily:{date}:{voter} 1
   LPUSH vote_queue {removeEvent}
   ZINCRBY leaderboard:voters {voter} -1
4. Read CRDT → return new total        1ms
```

### 3.5 Slot Transition Safety

```
SLOT TRANSITION PROTOCOL (modifies src/app/api/cron/auto-advance/route.ts):

PROBLEM: If we sync counters then drain the queue, votes arriving between
sync start and drain completion are lost. Need a freeze window.

1. Auto-advance cron detects slot expiry approaching (voting_ends_at - 60s)
2. VOTING FREEZE (60 seconds before slot ends — longer at 500K clips):
   a. SET slot_frozen:{seasonId}:{slotPos} 1 EX 300
   b. Vote API checks: EXISTS slot_frozen:{seasonId}:{slotPos}
      If frozen → reject with "Voting closing, results being tallied"
      (frontend shows countdown: "Voting closes in 60s...")
   c. This guarantees no new votes enter the pipeline

3. AFTER voting_ends_at:
   a. Wait 5s for any in-flight queue items to settle
   b. Drain remaining vote_queue entries (process all)
   c. Force counter sync (all clips: Redis CRDT → PostgreSQL)
   d. Counter sync: batch 500K clips in chunks of 5K = 100 batches × ~100ms = ~10s
   e. Verification: COUNT(*) FROM votes WHERE slot_position = X
      Must match Redis CRDT total (within ±0 after full drain)

4. Select winner from PostgreSQL (now provably accurate)
5. Advance slot via existing admin/advance-slot logic
6. Clear Redis state for old clips:
   DEL slot_frozen:{seasonId}:{slotPos}
   DEL crdt:{clipId}:* for all clips in old slot
7. Broadcast slot change via Pusher and useStoryBroadcast channel

INVARIANT: Zero votes lost. The 60-second freeze ensures complete drain.
Users see a countdown — this is standard for competition/voting platforms.
At 500K active clips, total transition time after freeze: ~30-60 seconds.
6. Also clear distribution pools:
   DEL pool:cold:{seasonId}:{slotPos}
   DEL pool:warm:{seasonId}:{slotPos}
   DEL pool:hot:{seasonId}:{slotPos}
```

### 3.6 Queue Failure & Dead Letter Strategy

```
ALL QUEUES (vote_queue, comment_queue, notification_queue, etc.)
share the same retry/dead-letter pattern:

PROCESSING FLOW:
  1. RPOPLPUSH {queue} → {queue}:processing    (atomic move)
  2. Attempt batch INSERT to PostgreSQL
  3. SUCCESS → LREM {queue}:processing {event}
  4. FAILURE → increment retry counter in event JSON

RETRY POLICY:
  Attempt 1: immediate retry
  Attempt 2: wait 1s  (exponential backoff)
  Attempt 3: wait 5s
  Attempt 4: wait 30s
  Attempt 5: wait 5min
  After 5 failures: move to dead letter queue

DEAD LETTER QUEUE:
  LPUSH {queue}:dead_letter {event + error + timestamp}
  Alert: dead_letter depth > 0 → immediate page to on-call

  Dead letter events are:
  - Logged with full error context
  - Kept in Redis for 7 days (TTL on each entry)
  - Overflow: if dead_letter depth > 1000, batch-copy oldest to
    PostgreSQL table dead_letter_archive (permanent storage, not in Redis)
  - Manually reviewable via admin endpoint:
    GET /api/admin/dead-letters?queue=vote_queue
  - Replayable: POST /api/admin/dead-letters/replay?queue=vote_queue

POISON MESSAGE DETECTION:
  If same event fails 3x with same error → likely malformed data
  Skip processing, move directly to dead letter
  Continue processing remaining events (don't block queue)

CRASH RECOVERY:
  On processor startup: check {queue}:processing for orphaned events
  (Events that were being processed when previous processor crashed)
  Move back to head of main queue for reprocessing
```

### 3.7 Bloom Filter Optimization (Phase 3+)

```
At 1M votes per clip, dedup keys = 32MB per clip.
Two-tier dedup saves 96% memory:

1. Bloom Filter: mightContain(voter, clip)?
   "Definitely not voted" → proceed (99% of checks stop here)
   "Probably voted" → check Redis Set (1% reach here)
2. Redis Set: SISMEMBER votes:{clip} {voter}
   Authoritative answer

Memory: 1M votes × Set = 32MB → 1M votes × Bloom (1% FP) = 1.2MB
```

### 3.8 Performance Targets

| Metric | Current | Target | How |
|--------|---------|--------|-----|
| Vote server latency | 100-500ms | 6-8ms | Redis-only hot path |
| Vote perceived latency | ~0ms | ~0ms | Optimistic UI (unchanged) |
| Concurrent votes | ~100 | 1,000,000+ | CRDT + async writes |
| Daily limit check | 50ms (DB) | 0.5ms | Redis counter |
| Duplicate check | 50ms (DB) | 0.5ms | Redis EXISTS + Bloom |
| DB writes per vote | 2 (insert + trigger) | 0.002 (batched) | Queue + batch INSERT |

---

## 4. System 2: Authentication & Identity

### 4.1 Current State

```
src/lib/auth-options.ts:
  Strategy: JWT, maxAge: 24 hours, updateAge: 1 hour
  Provider: Google OAuth
  jwt callback: queries DB every 5 minutes (profile cache TTL)
    SELECT id, username FROM users WHERE email = $1
  session callback: passes hasProfile, username, userId

Admin check pattern (in every /api/admin/* route):
  const session = await getServerSession(authOptions)
  const { data: user } = await supabase.from('users')
    .select('is_admin').eq('email', session.user.email).single()
  → 1 DB query per admin request
```

### 4.2 Stateless JWT Architecture

```
LOGIN (once per session):
  User → Google OAuth → NextAuth → Query DB ONCE
  Build JWT: { sub, email, username, displayName, avatarUrl,
               level, xp, isVerified, isBanned,
               roles: ["user","creator","admin"],
               permissions: ["vote","comment","upload","moderate_clips",...],
               jti, exp: +1hr }
  Store refresh token: SET refresh:{jti} {userId} EX 604800 (7 days)

API REQUEST (zero DB):
  1. Extract JWT from header/cookie
  2. Verify signature (crypto, 0.1ms)
  3. Read claims directly (no DB)
  Admin check: token.roles.includes('admin')
  Was: SELECT is_admin FROM users WHERE email = $1

TOKEN REFRESH (every 55 min, 1 DB query):
  POST /api/auth/refresh → verify refresh token → Redis check →
  DB: SELECT fresh data → issue new access token
```

### 4.3 Edge JWT Validation

```
Request → Cloudflare Edge (200+ locations)
  ├── Has JWT? → Verify signature (0.1ms)
  │   ├── Valid → Forward with X-User-Id, X-User-Roles headers
  │   └── Invalid → 401 immediately (never reaches origin)
  └── No JWT → Forward (anonymous allowed for some routes)
```

### 4.4 Instant Ban Enforcement

```
Admin bans user (via /api/admin/users/[id]):
1. SET banned:{userId} 1              (Redis, permanent)
2. DEL refresh:{jti}                  (revoke refresh token)
3. Next API request: EXISTS banned:{userId} → blocked (0.1ms)
```

### 4.5 Impact

| Metric | Current | Target |
|--------|---------|--------|
| DB queries per auth | 1 every 5 min | 0 |
| Admin check | DB query every request | JWT claim (0ms) |
| Validation latency | ~50ms | ~0.1ms |
| Daily auth queries (10K users) | 2,880,000 | 250,000 (-91.3%) |

---

## 5. System 3: Video Pipeline & Storage at Scale

**This is critical for millions of videos.** Current: AWS S3 via signed URLs, single region, no CDN.

### 5.1 The Millions-of-Videos Problem

```
At current scale:
  ~100 clips × ~30MB avg = 3GB storage
  Single S3 region, signed URLs, no CDN

At millions of videos:
  1,000,000 clips × 30MB avg original = 30TB (originals only)
  + Adaptive bitrate variants (lower resolutions are smaller):
      720p ≈ 60% of original = 18MB avg
      480p ≈ 30% of original = 9MB avg
      360p ≈ 15% of original = 4.5MB avg
    Subtotal variants: 31.5MB per clip × 1M = ~32TB
  + Thumbnails + previews: ~2TB
  = ~64TB total storage (not 160TB — lower resolutions are much smaller)

  Monthly egress (10M views × 30MB avg): 300TB
  S3 egress at $0.09/GB: $27,000/month ← UNACCEPTABLE
  R2 egress: $0 (free via Workers or public bucket — R2 has NO egress fees)
```

### 5.2 R2 Migration Architecture

```
UPLOAD (replaces src/app/api/upload/ and src/app/api/upload/signed-url/):
  Creator → POST /api/upload/signed-url
    → Generate R2 presigned PUT URL (no server-side upload)
    → Creator browser uploads directly to R2
    → POST /api/upload/register with R2 key
    → Background: transcode pipeline starts

POST-UPLOAD PIPELINE (async, event-driven):
  1. Transcode to adaptive bitrate:
     - Original → 1080p (if source ≥ 1080p)
     - → 720p (default quality)
     - → 480p (mobile-friendly)
     - → 360p (low bandwidth)
  2. Generate thumbnail:
     - First frame
     - 3 keyframes at 25%, 50%, 75%
     - Social share preview (1200×630)
  3. Generate 5-second preview clip (compressed, autoplay)
  4. SHA256 hash → content-addressed filename
  5. Store all variants in R2 under:
     videos/{hash}/original.mp4
     videos/{hash}/1080p.mp4
     videos/{hash}/720p.mp4
     videos/{hash}/480p.mp4
     videos/{hash}/360p.mp4
     videos/{hash}/thumb-{n}.webp
     videos/{hash}/preview.mp4
  6. Update tournament_clips with R2 URLs
  7. Push to search index
  8. Notify admin for moderation

DELIVERY:
  Viewer → R2 CDN → serve from nearest edge PoP (<50ms globally)
  URLs: https://videos.aimoviez.com/videos/{hash}/720p.mp4
  Cache-Control: public, immutable, max-age=31536000
  (Content-addressed URLs never change → cache forever)
```

### 5.3 Smart Preloading (Connection-Aware)

```
WiFi:    current slot fully loaded + next 2 slots fully
4G:      current slot fully + next slot previews (5sec clips)
3G:      current slot fully + next slot thumbnails only
Offline: show cached thumbnails, queue votes in Service Worker

Implementation: Navigator.connection API + IntersectionObserver
```

### 5.4 Deduplication at Scale

```
1M uploads/year → many will be duplicates (re-uploads, reposts)

Content-addressed storage:
  SHA256(video bytes) → deterministic filename
  Same video uploaded twice = same hash = no duplicate storage
  DB stores hash: tournament_clips.content_hash = '{sha256}'
  Before upload: check if hash already exists → instant "upload"

Savings at 1M clips with 20% duplication:
  200K dupes × ~64MB per clip (original + variants) = 12.8TB saved
  12.8TB × $0.015/GB = $192/month saved on storage
```

### 5.5 Video Cleanup Pipeline

```
When a clip is deleted or a season ends:
  1. Soft delete: tournament_clips.status = 'archived'
  2. After 30 days: check if any other clip references same hash
  3. If no other references: delete R2 objects
  4. If referenced: keep (shared content-addressed storage)

This prevents orphaned videos while enabling dedup.
```

---

## 6. System 4: Real-Time Layer

### 6.1 Three-Tier Strategy

```
TIER 1: Pusher WebSocket (primary, 100-500ms latency)
  ├── Subscribe to clip channels on slot load
  ├── vote_update events → update React Query cache directly
  ├── comment events → append to comment list
  └── notification events → toast + badge update

TIER 2: Polling fallback (when WebSocket drops, up to 10s)
  ├── React Query: refetchInterval = 10000
  ├── Auto-reconnect Pusher with exponential backoff
  └── Seamless switch — existing useStoryBroadcast already does this

TIER 3: Optimistic UI (self, 0ms — already implemented)
  ├── Own votes/comments reflect instantly via onMutate
  └── Rollback on error via onError
```

### 6.2 Channel Design

```
clip-{clipId}              Vote updates, new comments, comment likes
slot-{seasonId}-{pos}      New clips added, slot status changes
leaderboard-{type}         Live rank changes (top 10 only)
user-{userId}              Personal notifications, achievement unlocks
season-{seasonId}          New slot, winner announced, season events
story-updates              Existing broadcast channel (keep)
presence-voting            Who's currently voting (optional, engagement)
```

### 6.3 Replaces Disabled Supabase Realtime

```
Current hooks in src/hooks/useRealtimeClips.ts:
  useRealtimeClips   → Replace with Pusher clip-{clipId} channel
  useRealtimeSlots   → Replace with Pusher slot-{seasonId}-{pos} channel
  useRealtimeVotes   → Replace with Pusher clip-{clipId} channel
  useStoryBroadcast  → Keep (already uses Supabase broadcast, works fine)
```

### 6.4 Scaling

| Users | Concurrent WS | Pusher Plan | Cost | Note |
|-------|--------------|------------|------|------|
| <10K | ~200 | Free | $0 | 200 conn limit |
| 10-50K | ~500 | Startup ($49) | $49 | 500 conn limit |
| 50-200K | ~2,000 | Pro ($99) | $99 | 2K conn limit |
| 200K-500K | ~5,000 | Business ($299) | $299 | 10K conn limit |
| 500K-1M | ~10-20K | Max ($499) or custom | $499+ | Business limit exceeded |

1M users ≈ 5-10% DAU ≈ 1-2% concurrent ≈ 10-20K WebSocket connections.
⚠ Business plan caps at 10K connections. At 500K+ users, need Max plan ($499)
or migrate to self-hosted WebSocket server (Soketi, ws on Fly.io/Railway).

---

## 7. System 5: Comments at Scale

### 7.1 Current State

```
src/app/api/comments/route.ts:
  POST: INSERT into comments table (synchronous)
  GET: SELECT with pagination + batch reply fetch (avoids N+1)
  PATCH: comment_likes insert/delete (triggers update likes_count)
  DELETE: soft delete (is_deleted = true)

Rate limit: 15 comments/minute
XSS: DOMPurify sanitization
```

### 7.2 TikTok-Style Comment Flow

```
USER POSTS COMMENT
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. Redis: LPUSH comments:{clipId}:recent {commentJSON}    1ms  │
│    LTRIM to keep last 100 comments in hot cache                 │
│                                                                  │
│ 2. Redis: INCR comments:{clipId}:count                    0.5ms │
│                                                                  │
│ 3. Pusher: trigger('clip-{clipId}', 'new_comment', data)  async │
│    All viewers see comment appear instantly                      │
│                                                                  │
│ 4. Redis: LPUSH comment_queue {commentEvent}              0.5ms │
│    Queued for async DB persistence                              │
│                                                                  │
│ Total to user: ~5ms                                              │
│ All viewers see comment: 1-2 seconds (Pusher)                   │
└──────────────────────────────────────────────────────────────────┘

BACKGROUND: Comment Processor (every 5 sec)
  Dequeue → batch INSERT into comments table → acknowledge
```

### 7.3 Comment Likes (Same Pattern as Votes)

```
Like a comment:
1. Redis: INCR comment_likes:{commentId}       (instant count)
2. Redis: SET liked:{userId}:{commentId} 1      (dedup)
3. Pusher: broadcast like event                  (async)
4. Queue for DB persistence                      (async)
```

### 7.4 Thread/Reply Support

```
Redis structure:
  comments:{clipId}:recent            → Top-level comments (hot cache)
  comments:{clipId}:thread:{parentId} → Replies to a comment

Current DB already supports parent_comment_id (foreign key).
Redis caching adds speed; existing threaded query pattern stays for deep loads.
```

---

## 8. System 6: Leaderboards & Analytics

### 8.1 Redis Sorted Set Leaderboards

```
REPLACES: src/app/api/leaderboard/*.ts DB queries
  Current: SELECT user_id, SUM(vote_weight) GROUP BY ... ORDER BY ... (500-2000ms)
  Target: ZREVRANGE leaderboard:voters 0 99 (1ms)

LEADERBOARD TYPES:
  leaderboard:voters                → Top voters (total votes cast)
  leaderboard:creators              → Top creators (votes received)
  leaderboard:clips:{slot}          → Top clips in current slot
  leaderboard:xp                    → Top users by XP
  leaderboard:streaks               → Longest voting streaks
  leaderboard:voters:daily:{date}   → Daily (48hr TTL)
  leaderboard:voters:weekly:{week}  → Weekly (14d TTL)
  leaderboard:voters:season:{id}    → Seasonal (persist until season ends)

OPERATIONS (all 1ms):
  ZINCRBY leaderboard:voters {userId} 1       (on each vote)
  ZREVRANGE leaderboard:voters 0 99           (top 100)
  ZREVRANK leaderboard:voters {userId}        (user's rank)
```

### 8.2 Analytics Pipeline

```
Every event → LPUSH analytics_queue {event}

Aggregator (every 5 min):
1. Dequeue events
2. Write to pre-aggregated tables:
   votes_per_hour (clip, hour, count)
   active_users_daily (date, HLL count)
   engagement_metrics (slot, avg_votes, completion_rate)
   genre_popularity (genre, date, vote_count)
3. Admin dashboard reads pre-computed data (instant)
```

---

## 9. System 7: Notifications at Scale

### 9.1 Current State

```
src/app/api/notifications/route.ts:
  10 notification types defined
  Sync INSERT into notifications table
  No push delivery — user must visit the page
  Push subscription table exists (push_subscriptions)
  Web Push API library exists (src/lib/push-notifications.ts)
```

### 9.2 Event-Driven Pipeline

```
Event occurs → LPUSH notification_queue {event}

Dispatcher (every 5 sec):
1. Dequeue events
2. Build notification message
3. Group similar: "50 people voted on your clip" (instead of 50 individual notifs)
4. Push via Pusher to user-{userId} channel (instant if online)
5. Store in Redis: LPUSH notifications:{userId}:recent (hot cache)
6. Batch INSERT into notifications table (persistence)
7. Web Push for offline users (existing push_subscriptions infrastructure)
```

### 9.3 Notification Grouping

```
Redis Hash: notif_batch:{userId}:{type}:{targetId}
  count: 50
  first_at: timestamp
  last_actor: "username"

On dispatch: if count > 3 → send grouped notification
TTL: 1 hour (reset grouping window)
```

### 9.4 Unread Badge (Real-Time)

```
Redis: INCR unread:{userId}                   (on new notification)
Read:  GET unread:{userId}                    (0.5ms)
Clear: SET unread:{userId} 0                  (user opens page)
Push:  Pusher trigger(user-{userId}, 'badge', { count })
```

---

## 10. System 8: Social Graph

### 10.1 Current State

```
src/app/api/user/follow/route.ts:
  POST: INSERT into followers + DB trigger updates users.followers_count
  DELETE: DELETE from followers + trigger updates count
  Hot row problem at scale (same as votes)
```

### 10.2 Async Social Actions

```
FOLLOW:
1. Redis: SADD following:{userId} {targetId}           (instant)
2. Redis: SADD followers:{targetId} {userId}           (instant)
3. Redis: INCR follower_count:{targetId}               (instant)
4. Redis: LPUSH follow_queue {event}                   (async DB)
5. Pusher: trigger user-{targetId} 'new_follower'      (notification)

CHECK "AM I FOLLOWING?":
  SISMEMBER following:{userId} {targetId}  (0.5ms, no DB)

GET FOLLOWER COUNT:
  GET follower_count:{userId}  (0.5ms)

MUTUAL FOLLOW CHECK:
  SINTER following:{userA} followers:{userA}  (instant)
```

### 10.3 Feed Generation (Future — When Millions of Creators)

```
When followed creator uploads:
1. SMEMBERS followers:{creatorId} → all followers
2. For each: LPUSH feed:{followerId} {clipEvent}
3. Fan-out on write (<10K followers), fan-out on read (>10K)

Feed read: LRANGE feed:{userId} 0 19 (instant)
```

---

## 11. System 9: Anti-Fraud & Moderation

### 11.1 Multi-Layer Defense

```
LAYER 1: Edge (Cloudflare)
├── Token Bucket rate limit per IP
├── Known bot IP blocklist
├── Browser integrity check (TLS fingerprint, JS challenge)
└── Missing headers = bot signal

LAYER 2: Application (Vercel)
├── Device fingerprint + risk score (existing src/lib/device-fingerprint.ts)
├── hCaptcha when risk > 70 (existing, feature-flagged)
├── Daily limit enforcement (Redis)
└── Behavioral analysis:
    ├── Vote timing (human: 2-5s between, bot: <100ms)
    ├── Vote diversity (human: different clips, bot: same)
    └── Session patterns

LAYER 3: Background (Async)
├── Coordinated voting detection (multiple keys → same clip)
├── Statistical anomaly (velocity spike >3σ)
└── Actions: flag → captcha → shadow-ban
```

### 11.2 Shadow Banning

```
SET shadow_ban:{voterKey} 1

Vote API checks: EXISTS shadow_ban:{voterKey}
If shadow-banned:
  ✓ Accept vote (return success)
  ✓ Update THEIR UI (optimistic +1)
  ✗ Do NOT increment CRDT counter
  ✗ Do NOT enqueue to vote_queue
  Result: user thinks they're voting; system ignores
```

### 11.3 Content Moderation at Scale

```
Current: /api/admin/moderation queue + /api/admin/approve|reject
At millions of uploads, admin can't review every clip manually.

Auto-moderation pipeline:
1. Video upload → transcode_queue
2. During transcode: run basic checks
   - Duration within limits (tournament_clips.duration)
   - File format validation (already exists)
   - Duplicate hash check (content-addressed)
   - Audio detection (optional: explicit content)
3. Pass auto-checks → status: 'pending' (human review)
4. Fail auto-checks → status: 'flagged' (priority review)
5. Community reporting feeds into content_reports table (existing)
```

### 11.4 Auto-Approval Pipeline (Replaces Manual Admin Gating)

```
PROBLEM: At millions of users, 1-5% are creators.
  1M users × 5% = 50K clips uploaded per slot (24 hours)
  5M users × 5% = 250K clips per slot
  10M users × 5% = 500K clips per slot

  A human admin reviewing 1 clip/minute = 480 clips/8-hour shift.
  500K clips ÷ 480 = 1,042 admin-days. IMPOSSIBLE.

SOLUTION: Auto-approve by default, flag exceptions for human review.
  Enable via feature flag: auto_approval (replaces ai_moderation flag)
  Admin can toggle back to manual mode instantly.
```

```
THREE-TIER APPROVAL MODEL:

┌─────────────────────────────────────────────────────────────┐
│ TIER 1: AUTO-APPROVE (95% of uploads)              instant  │
│                                                             │
│ Clips that pass ALL checks → status: 'active' immediately  │
│                                                             │
│ Existing checks (already implemented):                      │
│   ✓ File signature verification (magic bytes)               │
│   ✓ Polyglot file detection (5 checkpoints)                 │
│   ✓ MIME type validation (mp4/quicktime/webm)               │
│   ✓ File size limit (50MB)                                  │
│   ✓ Season/slot validity check                              │
│   ✓ Rate limit (5 uploads/min per user)                     │
│   ✓ Duration constraint (8.5s app / 10s DB)                 │
│                                                             │
│ New automated checks (to add):                              │
│   □ Duplicate hash check (SHA256 from Section 5.4)          │
│     → Same video already exists → instant "upload"          │
│   □ Creator reputation score:                               │
│     reputation = (approved clips) / (total uploads)         │
│     If reputation > 0.9 AND uploads > 5 → auto-approve     │
│   □ Upload velocity check:                                  │
│     > 3 clips/hour from same user → flag for review         │
│                                                             │
│ Result: clip.status = 'active', visible in voting arena     │
│ No admin action needed. Clip enters competition instantly.  │
├─────────────────────────────────────────────────────────────┤
│ TIER 2: FLAGGED FOR REVIEW (4% of uploads)         pending  │
│                                                             │
│ Clips that trigger soft warnings:                           │
│   ⚠ New creator (first 3 uploads always reviewed)           │
│   ⚠ Upload velocity > 3 clips/hour from same user          │
│   ⚠ Creator has prior rejected clips (reputation < 0.7)    │
│   ⚠ Creator has active community reports                    │
│   ⚠ Duration exactly at limit (potential evasion signal)    │
│                                                             │
│ Status: 'pending' (existing behavior — not visible)         │
│ Admin reviews flagged queue only:                           │
│   4% × 500K = 20K clips/day at worst                       │
│   With batch approve (existing, max 50) = 400 batches       │
│   Manageable for small admin team                           │
│                                                             │
│ Existing tooling covers this:                               │
│   GET /api/admin/moderation (pagination, filtering)         │
│   PATCH /api/admin/moderation (batch approve/reject, max 50)│
│   POST /api/admin/bulk (bulk operations)                    │
├─────────────────────────────────────────────────────────────┤
│ TIER 3: AUTO-REJECT (<1% of uploads)              rejected  │
│                                                             │
│ Clips that fail hard checks:                                │
│   ✗ File signature invalid (already implemented)            │
│   ✗ Polyglot detection positive (already implemented)       │
│   ✗ Exact duplicate hash (same video already in this slot)  │
│   ✗ Creator is banned (existing ban system)                 │
│   ✗ Creator is shadow-banned (existing shadow ban)          │
│                                                             │
│ Status: 'rejected' automatically                            │
│ Logged in audit_logs (existing audit system)                │
│ Creator notified: "Upload could not be processed"           │
│ (Vague message — don't reveal detection method)             │
└─────────────────────────────────────────────────────────────┘
```

```
SAFETY NET — Community-Driven Correction:

Auto-approved clip gets community reports (existing content_reports table):
  1 report:   no action (noise)
  2 reports:  clip flagged internally
  3+ reports: auto-revert to 'pending', removed from voting arena
              Admin notified via flagged queue
              Creator notified: "Your clip is under review"

This creates a feedback loop:
  Auto-approve → community catches bad content → admin reviews exceptions
  → admin decision feeds back into creator reputation score
  → future uploads from that creator may be flagged (Tier 2)

ADMIN ROLE CHANGE:
  Before: Gatekeeper (reviews ALL clips before they enter voting)
  After:  Exception handler (reviews ~4% flagged clips)
          + Community report moderator
          + Creator reputation manager
          + Policy enforcement (ban repeat offenders)
```

```
CREATOR REPUTATION SCORE:

  reputation = approved_clips / total_uploads
  (computed from audit_logs: count approve_clip vs reject_clip per user)

  Redis: HSET creator_rep:{userId} approved {n} total {n}
  Updated on every approve/reject action

  Score thresholds:
    > 0.9 (excellent): full auto-approve
    0.7-0.9 (good):    auto-approve with monitoring
    0.5-0.7 (mixed):   flag for review (Tier 2)
    < 0.5 (poor):      flag ALL uploads for review
    Banned:            auto-reject (Tier 3)

  New creators (< 3 uploads): always Tier 2 (reviewed)
  After 3 approved uploads: earns auto-approve status
```

---

## 12. System 10: Smart Content Distribution

### 12.1 The Distribution Problem at Scale

```
CURRENT SYSTEM:
  get_clips_randomized() RPC:
    ORDER BY view_count + (RANDOM() * 50)
    Works at ~100 clips per slot

AT MILLIONS OF USERS:
  1M users × 5% creators = 50K clips per slot (24 hours)
  10M users × 5% = 500K clips per slot
  1M DAU × 50 clips viewed per session = 50M views/day
  50M views / 500K clips = 100 views per clip average

  ORDER BY on 500K rows = full-table sort = ~500ms per request
  × 50M requests/day = database crushed

NEED: Redis-based distribution that serves clips in ~3ms, not 500ms.
```

### 12.2 Redis-Based Tiered Pool Distribution

```
Replaces: get_clips_randomized() RPC
Three pre-computed pools in Redis, rebuilt every 30 seconds:

┌────────────────────────────────────────────────────────────────────┐
│ COLD POOL — clips with < threshold views (cold start guarantee)    │
│                                                                    │
│ Redis Set: pool:cold:{seasonId}:{slotPos}                          │
│ Contains: clipIds that haven't reached cold-start view minimum     │
│ Purpose: Every clip gets initial fair exposure before ranking      │
│ Selection: SRANDMEMBER (O(1), truly random, no sort needed)        │
│ Mix ratio: 40% of clips in each response come from cold pool      │
│                                                                    │
│ At 500K clips: up to 500K entries in set = ~20MB                   │
│ Shrinks over time as clips graduate to warm pool                   │
├────────────────────────────────────────────────────────────────────┤
│ WARM POOL — clips with threshold-500 views (signal building)       │
│                                                                    │
│ Redis ZSet: pool:warm:{seasonId}:{slotPos}                         │
│ Score: engagement_rate = vote_count / view_count                   │
│ Purpose: Surface clips that are gaining traction                   │
│ Selection: ZRANDMEMBER (random from ranked set)                    │
│ Mix ratio: 35% of clips in each response                          │
│                                                                    │
│ Higher-engagement clips have higher scores but selection is        │
│ still random — avoids snowball effect of always showing top clips  │
├────────────────────────────────────────────────────────────────────┤
│ HOT POOL — clips with 500+ views (proven performers)               │
│                                                                    │
│ Redis ZSet: pool:hot:{seasonId}:{slotPos}                          │
│ Score: engagement_rate = vote_count / view_count                   │
│ Purpose: Show clips the community has validated                    │
│ Selection: ZRANDMEMBER (random from ranked set)                    │
│ Mix ratio: 25% of clips in each response                          │
│                                                                    │
│ These are the clips most likely to win the slot.                   │
│ Voters need to see them to make an informed choice.                │
└────────────────────────────────────────────────────────────────────┘

ENGAGEMENT RATE FORMULA:
  engagement_rate = (vote_count / view_count) × freshness_multiplier
  freshness_multiplier = 1.0 + max(0, (2 - hours_since_upload) × 0.25)
  (Clips < 2 hours old get up to 1.5× boost — matches existing FRESH_CLIP_HOURS)

DYNAMIC THRESHOLDS (scale-adaptive):
  Total clips in slot | Cold threshold | Warm→Hot threshold
  < 1,000             | < 50 views     | ≥ 200 views
  1,000–50,000        | < 30 views     | ≥ 300 views
  50,000–500,000      | < 20 views     | ≥ 500 views

  Thresholds computed during pool rebuild based on SCARD pool:cold + ZCARD pool:warm + ZCARD pool:hot
```

### 12.3 Serving a Request (8 clips, ~3ms)

```
Voter opens voting arena → GET /api/vote?limit=8

1. Determine pools:   pool:cold:{key}, pool:warm:{key}, pool:hot:{key}
2. Pick 3 from cold:  SRANDMEMBER pool:cold:{key} 3          0.5ms
3. Pick 3 from warm:  ZRANDMEMBER pool:warm:{key} 3          0.5ms
4. Pick 2 from hot:   ZRANDMEMBER pool:hot:{key} 2           0.5ms
5. Session dedup:     SISMEMBER cursor:{sessionId} for each   1ms
   If already shown → draw replacement from same pool
6. Record shown:      SADD cursor:{sessionId} {8 clipIds}     0.5ms
7. Shuffle (position bias): Fisher-Yates with hash seed       <1ms
8. Fetch clip metadata from Redis cache or DB fallback
9. Return 8 clips + hasMore flag

Total Redis: ~3ms (was ~100-500ms PostgreSQL full-table sort)

PAGINATION (next page):
  Same flow, cursor prevents re-showing clips from current session
  Client passes X-Session-Cursor header (received on first request)
```

### 12.4 Pool Rebuild Worker (every 30 seconds)

```
Background job: /api/cron/rebuild-clip-pools

1. Query: SELECT id, vote_count, view_count, created_at
   FROM tournament_clips
   WHERE status = 'active'
     AND slot_position = {current}
     AND season_id = {current}
   (Reads from read replica if available)

2. For each clip:
   view_count = HGET clip_stats:{clipId} views  (Redis, fast)
   vote_count = Read from CRDT counter (Redis)
   Compute engagement_rate

3. Assign to pool based on view_count thresholds:
   tmp:cold:{key} → SADD for cold clips
   tmp:warm:{key} → ZADD with engagement_rate score
   tmp:hot:{key}  → ZADD with engagement_rate score

4. Atomic swap:
   RENAME tmp:cold:{key} → pool:cold:{key}
   RENAME tmp:warm:{key} → pool:warm:{key}
   RENAME tmp:hot:{key}  → pool:hot:{key}
   (Atomic — no moment where pool is empty)

5. Set TTL 120s on all pools (safety: expire if rebuild stops)

At 500K clips: rebuild takes ~2-5 seconds (background, non-blocking)
Voters always read from the live pool (30 seconds stale max)
```

### 12.5 Session Cursor (Replaces excludeIds)

```
PROBLEM: Current system passes excludeIds as comma-separated URL param.
  After 500+ clips seen: URL is ~18KB, SQL != ALL(array) is slow.

SOLUTION: Server-side session cursor in Redis.

  First request:
    Server generates sessionId (UUID)
    SET cursor:{sessionId} as Redis Set (empty)
    TTL: 1 hour (session length)
    Return: X-Session-Cursor: {sessionId} header

  Subsequent requests:
    Client sends X-Session-Cursor header
    Server: SRANDMEMBER from pool → SISMEMBER cursor:{sessionId}
    If already shown → draw another from same pool
    After serving: SADD cursor:{sessionId} {shown clipIds}

  Memory per session: 500 clips × 36 bytes (UUID) = 18KB
  At 200K concurrent sessions: 200K × 18KB = 3.6GB

  OPTIMIZATION:
    Cold pool: skip cursor check (fresh clips OK to re-show)
    Only cursor-check warm and hot pools (repeat avoidance matters more)
    Reduces cursor checks by 40%

  FALLBACK:
    If Redis unavailable → fall back to client excludeIds (existing)
    Graceful degradation, slightly worse UX but functional
```

### 12.6 Cold Start Guarantee (Scale-Adaptive)

```
Every clip gets a minimum number of views before engagement ranking:

  Total clips in slot | Guaranteed views | Math
  < 1,000             | 50 views         | 50K views / 50M daily = <1%
  1,000–50,000        | 30 views         | 1.5M / 50M = 3%
  50,000–500,000      | 20 views         | 10M / 50M = 20%

  Clips in cold pool are served until they reach the threshold.
  40% of all served clips come from cold pool → cold start absorbs
  up to 40% of total views, matching the 20% math at max scale.

  After reaching threshold: clip graduates to warm pool.
  Engagement rate begins to differentiate strong vs weak clips.
```

### 12.7 Position Bias Correction

```
Problem: clips shown first in the list get more votes (primacy effect)

Solution: Fisher-Yates shuffle each response with deterministic seed
  Seed: hash(voterKey + slotPosition + Math.floor(Date.now() / 300000))
  (Changes every 5 minutes — same user sees different order on refresh)

  Each voter gets different clip order.
  Analytics track position-normalized vote rates.
  Position bias doesn't accumulate because order is random per request.
```

### 12.8 View Count Scaling

```
PROBLEM: 50M views/day = ~580 views/second.
  Current: INSERT into clip_views → trigger updates view_count.
  Same hot-row problem as votes at scale.

SOLUTION: Same Redis-first pattern as voting engine (Section 3):

  View recorded (on clip serve, not on explicit user action):
    HINCRBY clip_stats:{clipId} views 1       (Redis, 0.5ms)
    LPUSH view_queue {viewEvent}               (async DB persistence)

  Background sync (every 30 seconds):
    Read clip_stats:{clipId} views for all active clips
    Batch UPDATE tournament_clips SET view_count = X
    (Same counter-sync pattern as vote counts)

  Pool rebuild reads view_count from Redis clip_stats (not DB).
  No DB trigger needed. No hot row. No lock contention.

  clip_views table still populated async for analytics/history.
  view_count column in tournament_clips synced for DB queries (admin, etc).
```

---

## 13. System 11: Search & Discovery at Scale

**Critical for millions of videos. Currently: no search at all.**

### 13.1 Why Search Matters at Scale

```
Current: ~100 clips, manual browsing works
At 1M clips: users can't find what they want

Need:
  - Full-text search on titles and descriptions
  - Filter by genre (COMEDY|THRILLER|ACTION|ANIMATION + future genres)
  - Filter by season, slot, status
  - Sort by votes, date, trending
  - Creator search (find specific creators)
  - Typo-tolerant instant results (<50ms)
```

### 13.2 Search Index Architecture

```
Service: Meilisearch Cloud or Typesense Cloud
  Both: sub-50ms search, typo-tolerant, faceted filters
  Cost: $0 (self-hosted) to $50/month (cloud, <1M docs)

INDEX: clips
  Fields:
    id, title, description, genre, username, season_name,
    slot_position, vote_count, view_count, status,
    created_at, duration

  Searchable: title, description, username
  Filterable: genre, status, season_id, slot_position
  Sortable: vote_count, view_count, created_at
  Ranking: custom relevance + vote_count boost

SYNC PIPELINE:
  On clip create/update → LPUSH search_index_queue {clipEvent}
  Background worker (every 30 sec):
    Dequeue → batch upsert to search index
    Handles creates, updates, deletes

API: GET /api/search?q=space+adventure&genre=ACTION&sort=votes
  → Forward to search index → return ranked results (<50ms)
```

### 13.3 Discovery Features

```
TRENDING:
  Redis ZSet: trending:clips (updated every 30s from engagement scorer)
  Shows clips with highest vote velocity in last hour

GENRES:
  Extends existing genre_votes system
  Genre pages with top clips per genre
  Redis cached: genre:{genre}:top → ZSet of top clips

CREATORS:
  Creator profiles already exist (/api/creator/[id])
  Add search index for creators: username, display_name
  Creator discover page with follower-count ranking

RELATED CLIPS:
  Simple: same genre + same season
  Advanced: collaborative filtering (users who voted for X also voted for Y)
  Redis: related:{clipId} → List of clip IDs (pre-computed hourly)
```

---

## 14. System 12: Creator Economy at Scale

**Supporting millions of creators uploading millions of videos.**

### 14.1 Current Upload Flow

```
src/app/api/upload/signed-url/route.ts:
  Generate AWS S3 presigned URL → client uploads directly
src/app/api/upload/register/route.ts:
  Register uploaded clip in tournament_clips table
```

### 14.2 Scaled Creator Pipeline

```
UPLOAD AT SCALE:
  1. Creator → POST /api/upload/signed-url
     → R2 presigned PUT URL (replaces S3)
     → Client uploads directly to R2 (no server bottleneck)
     → Even 100K simultaneous uploads: R2 handles it natively

  2. POST /api/upload/register
     → INSERT tournament_clips (status: 'processing')
     → LPUSH transcode_queue {clipId, r2Key}
     → Return immediately

  3. BACKGROUND: Transcode Worker
     → Download from R2, transcode (Cloudflare Media or FFmpeg worker)
     → Upload variants back to R2
     → Generate thumbnails + preview
     → Update tournament_clips (status: 'pending', add URLs)
     → Add to search index
     → Notify creator ("Clip processed, awaiting review")
     → Notify admin ("New clip for moderation")

CREATOR DASHBOARD DATA (all Redis, instant):
  Total votes today:      ZSCORE creator_votes_today {userId}
  Rank among creators:    ZREVRANK leaderboard:creators {userId}
  Unique viewers (HLL):   PFCOUNT hll:viewers:{clipId}
  Vote velocity:          GET velocity:{clipId}
  Engagement rate:        Pre-computed in analytics pipeline
```

### 14.3 Upload Limits at Scale

```
Per-creator rate limits:
  Free users:    5 uploads/day, 60sec max, 100MB max
  Verified:     20 uploads/day, 120sec max, 500MB max
  Premium:      50 uploads/day, 300sec max, 2GB max

Enforcement:
  Redis: INCR uploads_today:{userId}:{date}
  Check before generating signed URL
```

---

## 15. System 13: Database Evolution

**Scaling the existing 18 tables from thousands to hundreds of millions of rows.**

### 15.1 Table Partitioning Strategy

```
PARTITION BY RANGE (created_at) — Monthly:

  votes (hundreds of millions)
    votes_2026_01, votes_2026_02, votes_2026_03, ...
    Index on: (clip_id, voter_key), (voter_key, created_at), (slot_position)
    Old partitions: detach + archive to cold storage

  clip_views (hundreds of millions)
    clip_views_2026_01, clip_views_2026_02, ...

  notifications (hundreds of millions)
    notifications_2026_01, notifications_2026_02, ...
    Old: archive after 90 days

  audit_logs (millions)
    audit_logs_2026_01, ...
    Old: archive after 1 year

PARTITION BY LIST (season_id):

  tournament_clips
    tournament_clips_season_1, tournament_clips_season_2, ...
    Each season is independent — queries only hit relevant partition

UNPARTITIONED (reasonable row counts):
  users, seasons, story_slots, feature_flags, genre_votes,
  contact_submissions, content_reports, user_blocks, referrals,
  push_subscriptions, followers, comments, comment_likes
```

### 15.2 Connection Pooling

```
Current: 3 connections (Supabase Free)
Target:  200+ connections (Supabase Pro + PgBouncer)

PgBouncer mode: transaction (best for serverless)
  Each Vercel function borrows connection for query duration only
  50 physical connections → 200+ concurrent logical sessions

Update: Use Supabase pooler endpoint (port 6543 instead of 5432)
  DATABASE_URL=postgresql://...@pooler.supabase.com:6543/postgres?pgbouncer=true
```

### 15.3 Read Replica

```
Route heavy-read queries to read replica:
  - Leaderboard queries (src/app/api/leaderboard/*.ts)
  - Profile stats (src/app/api/profile/stats/route.ts)
  - Admin analytics (src/app/api/admin/stats/route.ts)
  - Discover/browse (src/app/api/discover/route.ts)
  - Search fallback queries

Primary only:
  - Vote batch inserts
  - Comment inserts
  - User updates
  - Admin mutations
```

### 15.4 Index Optimization

```
Critical indexes for scale:

votes:
  CREATE INDEX idx_votes_clip_voter ON votes(clip_id, voter_key);
  CREATE INDEX idx_votes_voter_date ON votes(voter_key, created_at);
  CREATE INDEX idx_votes_slot ON votes(slot_position, season_id);

tournament_clips:
  CREATE INDEX idx_clips_season_slot ON tournament_clips(season_id, slot_position);
  CREATE INDEX idx_clips_status ON tournament_clips(status) WHERE status = 'active';
  CREATE INDEX idx_clips_user ON tournament_clips(user_id);
  CREATE INDEX idx_clips_genre ON tournament_clips(genre);
  CREATE INDEX idx_clips_hash ON tournament_clips(content_hash);

comments:
  CREATE INDEX idx_comments_clip ON comments(clip_id, created_at DESC);
  CREATE INDEX idx_comments_user ON comments(user_key);

notifications:
  CREATE INDEX idx_notif_user_read ON notifications(user_key, is_read, created_at DESC);
```

---

## 16. System 14: Offline-First & Mobile

### 16.1 Service Worker Vote Queue

```
When user votes offline:
1. Service Worker intercepts failed POST /api/vote
2. Stores in IndexedDB: pending_votes queue
3. Shows success (optimistic, same as online)
4. On reconnect: drain queue → POST each to server
5. Handle 409 (already voted): silently skip
```

### 16.2 Battery & Bandwidth Optimization

```
document.visibilityState === 'hidden':
  → Pause all polling
  → Disconnect Pusher WebSocket
  → Reconnect on visibilitychange → 'visible'

Navigator.connection API:
  → Select video quality based on effectiveType
  → Reduce prefetch on slow connections
```

---

## 17. System 15: Resilience & Circuit Breakers

### 17.1 Circuit Breaker Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│ CIRCUIT BREAKER per dependency:                                   │
│                                                                  │
│ CLOSED (normal): All requests go through. Track failure rate.   │
│ OPEN (>50% failures in 30s): Reject immediately. 503.           │
│ HALF-OPEN (after 30s): Send 1 test. Success → CLOSED.           │
│                                     Fail → OPEN.                 │
└─────────────────────────────────────────────────────────────────┘

BREAKERS FOR:
  Redis         → fallback to synchronous DB path (async_voting=false)
                  Auth unaffected (JWT is stateless, no Redis needed)
  PostgreSQL    → queues absorb (votes queue in Redis)
  Pusher        → automatic polling fallback
  Cloudflare    → DNS failover to direct Vercel
  Upstash QStash → Vercel cron as backup scheduler
  Search index  → fallback to DB query
  R2            → serve from S3 fallback or cached CDN
```

### 17.2 Graceful Degradation

```
LEVEL 0: Full operation — all systems nominal
LEVEL 1: Real-time degraded — Pusher down → polling fallback (10s)
LEVEL 2: Analytics degraded — skip analytics events, stale leaderboards
LEVEL 3: Voting degraded — Redis slow → increase timeouts, retry button
LEVEL 4: Read-only mode — PostgreSQL down → serve cached data only
LEVEL 5: Maintenance mode — static page from Cloudflare cache
```

---

## 18. Implementation Roadmap

### Phase 0: Foundation ($0)

```
Goal: Prepare codebase for scaling, no cost increase

□ Fail-closed rate limiting
  MODIFY: src/lib/rate-limit.ts — reject when Redis unavailable

□ Redis health check
  CREATE: src/app/api/health/redis/route.ts

□ Batch counter SQL
  CREATE: supabase/sql/batch-update-vote-counts.sql

□ Vote queue types
  CREATE: src/types/vote-queue.ts

□ Feature flag: 'async_voting'
  MODIFY: feature_flags table — toggle sync/async vote path

□ Circuit breaker utility
  CREATE: src/lib/circuit-breaker.ts

Capacity: ~100 concurrent (more resilient)
```

### Phase 1: Redis-First Voting ($60/mo)

```
Goal: 100x voting capacity

□ Upgrade Supabase Pro ($25) + Upstash Pro ($10)
□ Enable PgBouncer (50 → 200+ connections)
□ Implement CRDT PN-Counter
  CREATE: src/lib/crdt-vote-counter.ts
□ Implement Redis vote validation
  CREATE: src/lib/vote-validation-redis.ts
□ Implement vote event queue
  CREATE: src/lib/vote-event-queue.ts
□ Modify vote API to Redis-first (behind feature flag)
  MODIFY: src/app/api/vote/route.ts
□ Create queue processor
  CREATE: src/app/api/cron/process-vote-queue/route.ts
□ Create counter sync job
  CREATE: src/app/api/cron/sync-vote-counters/route.ts
□ Disable vote triggers
  CREATE: supabase/sql/disable-vote-triggers.sql
□ Set up QStash (5s queue, 10s sync)
□ Update slot transition for sync-before-select
  MODIFY: src/app/api/cron/auto-advance/route.ts
□ Load test: validate 10K concurrent votes

Capacity: ~10,000 concurrent votes
```

### Phase 2: Auth + Real-Time + Comments ($170/mo)

```
Goal: Zero-DB auth. Live updates. Async comments.

AUTH:
□ Extend JWT with full claims
  MODIFY: src/lib/auth-options.ts
□ Stateless auth helper
  CREATE: src/lib/stateless-auth.ts
□ Refresh token endpoint
  CREATE: src/app/api/auth/refresh/route.ts
□ Migrate API routes to validateAuth()
  MODIFY: 51 API route files (incremental)
□ Redis session store (ban/revocation)
  CREATE: src/lib/session-store.ts
□ Client token refresh hook
  MODIFY: Auth provider component

REAL-TIME:
□ Pusher for vote broadcasts
  CREATE: src/lib/realtime-broadcast.ts
□ WebSocket listeners in dashboard
  MODIFY: Dashboard page + voting components
□ Update React Query cache on WebSocket events

COMMENTS:
□ Redis comment cache
  CREATE: src/lib/realtime-comments.ts
□ Pusher comment broadcasting
  MODIFY: src/app/api/comments/route.ts
□ Comment queue processor
  CREATE: src/app/api/cron/process-comments/route.ts
□ Comment count in Redis

LEADERBOARDS:
□ Redis Sorted Set leaderboards
  CREATE: src/lib/realtime-leaderboard.ts
□ Daily/weekly time-windowed boards
□ Creator analytics from Redis
  MODIFY: src/app/api/leaderboard/*.ts

Capacity: ~50,000 concurrent, unlimited auth
```

### Phase 3: Video + Search + Edge ($500/mo)

```
Goal: Global video CDN. Search millions of clips. Edge protection.

VIDEO PIPELINE:
□ Set up Cloudflare R2 bucket
□ R2 upload (signed URLs)
  MODIFY: src/app/api/upload/signed-url/route.ts
□ Migrate existing videos from S3 to R2
  CREATE: scripts/migrate-videos-to-r2.ts
□ Content-addressed URLs
□ Transcode pipeline (background)
  CREATE: src/app/api/cron/process-transcode/route.ts
□ Thumbnail + preview generation

SEARCH:
□ Set up Meilisearch Cloud / Typesense Cloud
□ Search index sync worker
  CREATE: src/app/api/cron/sync-search-index/route.ts
□ Search API endpoint
  CREATE: src/app/api/search/route.ts
□ Trending + genre discovery
□ Creator search

EDGE:
□ Cloudflare Worker: Token Bucket rate limiting
  CREATE: cloudflare-worker/rate-limit.js
□ Cloudflare Worker: edge JWT validation
  CREATE: cloudflare-worker/jwt-validator.js
□ DNS routing through workers

ADVANCED DATA:
□ Bloom Filters for vote dedup
  CREATE: src/lib/bloom-filter-votes.ts
□ HyperLogLog for unique voters
  CREATE: src/lib/hyperloglog-voters.ts
□ Read-Your-Writes consistency
  CREATE: src/lib/read-your-writes.ts

DISTRIBUTION:
□ Engagement-weighted clip scoring
□ Cold start guarantee (50 views)
□ Position bias correction

NOTIFICATIONS:
□ Event-driven notification pipeline
□ Notification grouping
□ Real-time unread badge

SOCIAL:
□ Async follow/unfollow (Redis + queue)
□ Redis follower counts
□ Following check without DB

Capacity: ~500,000 concurrent
```

### Phase 4: Horizontal Scale ($1,500-5,000/mo)

```
Goal: 1M+ concurrent users, millions of videos

□ Database read replica
□ Table partitioning (votes by month, clips by season)
□ Regional Redis instances (US-East, EU-West, APAC)
□ Dedicated vote processor worker (Railway/Fly.io)
□ Database sharding by season (if needed)
□ Cloudflare Durable Objects (optional: per-clip edge state)
□ Shadow banning system
□ Multi-region deployment
□ Offline-first Service Worker
□ Advanced fraud detection pipeline
□ Video cleanup pipeline
□ Auto-moderation pipeline

Capacity: 1,000,000+ concurrent
```

### Roadmap Visual

```
PHASE 0 ──→ PHASE 1 ──→ PHASE 2 ──→ PHASE 3 ──→ PHASE 4
 $0/mo       $60/mo      $170/mo     $500/mo     $1.5-5K/mo
  100         10,000       50,000      500,000     1,000,000+
concurrent   concurrent   concurrent  concurrent   concurrent
  ~100        ~100         ~100         1M+          1M+
 clips        clips        clips       videos       videos
```

---

## 19. Zero-Downtime Migration

### Phase 1: Sync → Async Voting

```
DAY 1: Deploy new code (dual-write mode)
  ├── Vote API writes to BOTH Redis AND DB (existing trigger path)
  ├── Counter reads from Redis with DB fallback
  ├── Feature flag: async_voting = false (still synchronous)
  └── Verify: Redis counts match DB counts

DAY 2: Enable async voting
  ├── Feature flag: async_voting = true
  ├── Vote API writes to Redis + queue (skip trigger)
  ├── Queue processor batch-writes to DB
  └── Monitor: queue depth, processing latency, counter drift

DAY 3: Disable triggers
  ├── ALTER TABLE votes DISABLE TRIGGER on_vote_insert
  ├── ALTER TABLE votes DISABLE TRIGGER on_vote_delete
  └── All counter updates via sync job

DAY 4: Remove legacy code
  ├── Remove insert_vote_atomic() RPC calls
  ├── Remove trigger-based code paths
  └── Clean up feature flag
```

### Rollback at Any Point

```
Emergency rollback (< 5 minutes):
  1. Feature flag: async_voting = false
  2. ALTER TABLE votes ENABLE TRIGGER on_vote_insert
  3. ALTER TABLE votes ENABLE TRIGGER on_vote_delete
  4. SELECT full_recount_vote_counts()
  5. System returns to current behavior
```

### Phase 2: Auth Migration

```
STEP 1: Add new JWT claims alongside existing (no breaking change)
STEP 2: Deploy validateAuth() (not yet used)
STEP 3: Migrate routes one-by-one (old and new auth coexist)
STEP 4: Remove getServerSession() calls after all migrated
```

### Phase 3: Video Migration

```
STEP 1: New uploads go to R2 (S3 still serves existing)
STEP 2: Background script copies S3 → R2
STEP 3: Update DB URLs from S3 to R2
STEP 4: Verify all videos accessible via R2
STEP 5: Remove S3 access
```

---

## 20. File-Level Migration Map

### Files Created

```
PHASE 0:
  src/lib/circuit-breaker.ts
  src/types/vote-queue.ts
  src/app/api/health/redis/route.ts
  supabase/sql/batch-update-vote-counts.sql

PHASE 1:
  src/lib/crdt-vote-counter.ts
  src/lib/vote-validation-redis.ts
  src/lib/vote-event-queue.ts
  src/app/api/cron/process-vote-queue/route.ts
  src/app/api/cron/sync-vote-counters/route.ts
  supabase/sql/disable-vote-triggers.sql
  supabase/sql/batch-insert-votes.sql

PHASE 2:
  src/lib/stateless-auth.ts
  src/lib/session-store.ts
  src/lib/realtime-broadcast.ts
  src/lib/realtime-comments.ts
  src/lib/realtime-leaderboard.ts
  src/app/api/auth/refresh/route.ts
  src/app/api/cron/process-comments/route.ts

PHASE 2 (Distribution):
  src/lib/clip-pool-builder.ts             (tiered pool rebuild logic)
  src/lib/clip-distribution.ts             (serve clips from Redis pools)
  src/lib/session-cursor.ts                (session cursor management)
  src/lib/view-counter.ts                  (Redis-first view counting)
  src/lib/auto-approval.ts                 (3-tier approval pipeline)
  src/lib/creator-reputation.ts            (reputation score computation)
  src/app/api/cron/rebuild-clip-pools/route.ts  (pool rebuild worker)
  src/app/api/cron/sync-view-counts/route.ts    (view count sync worker)

PHASE 3:
  src/lib/bloom-filter-votes.ts
  src/lib/hyperloglog-voters.ts
  src/lib/read-your-writes.ts
  src/lib/video-storage-r2.ts
  src/app/api/search/route.ts
  src/app/api/cron/sync-search-index/route.ts
  src/app/api/cron/process-transcode/route.ts
  cloudflare-worker/rate-limit.js
  cloudflare-worker/jwt-validator.js
  cloudflare-worker/wrangler.toml
  scripts/migrate-videos-to-r2.ts
```

### Files Modified

```
PHASE 0:
  src/lib/rate-limit.ts              (fail-closed fallback)

PHASE 1:
  src/app/api/vote/route.ts          (Redis-first flow, behind flag)
  src/app/api/cron/auto-advance/route.ts  (sync-before-select)
  vercel.json                        (new cron entries)

PHASE 2:
  src/lib/auth-options.ts            (extended JWT claims)
  src/app/api/vote/route.ts          (Redis pools instead of get_clips_randomized)
  src/app/api/upload/route.ts        (auto-approval pipeline)
  src/app/api/comments/route.ts      (Redis cache + Pusher)
  src/app/api/leaderboard/*.ts       (Redis Sorted Sets)
  src/app/api/notifications/route.ts (event queue)
  src/app/api/user/follow/route.ts   (async Redis)
  src/hooks/useRealtimeClips.ts      (Pusher channels)
  All 51 API routes                  (validateAuth migration, incremental)

PHASE 3:
  src/app/api/upload/signed-url/route.ts  (S3 → R2)
  src/app/api/upload/register/route.ts    (add content hash)
  .env.production                         (R2 credentials)
```

### Files Unchanged

```
Existing vote/comment/follow UI logic (optimistic UI already TikTok-quality)
src/lib/device-fingerprint.ts (device fingerprinting stays)
All styling/layout files
```

### Frontend Additions (Phases 2-3)

```
New frontend work required for new capabilities:
  src/app/search/page.tsx                    (search UI)
  src/app/discover/page.tsx                  (discovery/trending page)
  src/components/VideoQualitySelector.tsx     (adaptive bitrate picker)
  src/components/OfflineIndicator.tsx         (offline status banner)
  src/hooks/usePusherChannel.ts              (Pusher WebSocket hook)
  src/hooks/useConnectionAwarePreload.ts     (Navigator.connection preloading)
  src/hooks/useServiceWorkerSync.ts          (offline vote queue)
  src/components/UnreadBadge.tsx             (real-time notification badge)
  Service Worker: sw.js                      (offline vote queue + caching)

Existing frontend files modified:
  src/hooks/useRealtimeClips.ts              (Supabase → Pusher)
  Dashboard voting components                (Pusher live updates)
  Admin dashboard                            (new analytics views)
```

---

## 21. Load Testing Strategy

### k6 Script (Phase 1 Validation)

```javascript
// load-test-votes.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '3m', target: 1000 },
    { duration: '5m', target: 10000 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<100'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function() {
  const clipIds = ['clip-1', 'clip-2', 'clip-3'];
  const clipId = clipIds[Math.floor(Math.random() * clipIds.length)];

  const res = http.post('https://aimoviez.com/api/vote',
    JSON.stringify({ clipId }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 50ms': (r) => r.timings.duration < 50,
  });

  sleep(Math.random() * 3);
}
```

### Validation Criteria

| Phase | Target VUs | p95 Latency | Error Rate | Duration |
|-------|-----------|-------------|------------|----------|
| 1 | 10,000 | <100ms | <1% | 10 min |
| 2 | 50,000 | <100ms | <0.5% | 10 min |
| 3 | 500,000 | <200ms | <0.1% | 30 min |
| 4 | 1,000,000 | <500ms | <0.1% | 60 min |

---

## 22. Infrastructure Map

### Services & Roles

| Service | Role | Phase | Monthly Cost |
|---------|------|-------|-------------|
| **Vercel** | App hosting, edge/serverless functions, cron | Existing | $20-400 (scales with invocations) |
| **Supabase** | PostgreSQL, PgBouncer, Auth | Phase 1 | $25-200 (Pro → Team) |
| **Upstash Redis** | CRDT, queues, dedup, sessions, leaderboards | Phase 1 | $10-200 (see memory budget) |
| **Upstash QStash** | Sub-minute cron scheduling | Phase 1 | $0-5 |
| **Pusher** | WebSocket real-time broadcasts | Phase 2 | $0-499 (see connection limits) |
| **Cloudflare** | Edge rate limiting, JWT validation | Phase 3 | $0-20 |
| **Cloudflare R2** | Video storage + global CDN | Phase 3 | $5-1,000 (scales with storage, $0 egress) |
| **Meilisearch Cloud** | Full-text search index | Phase 3 | $0-50 |
| **Sentry** | Error tracking, performance | Existing | Existing |
| **Grafana Cloud** | Metrics, dashboards, alerting | Phase 1 | $0-200 (see observability) |
| **AWS S3** | Legacy video storage (migrated Phase 3) | Existing | Phase out |

### Redis Key Space Design

```
VOTING:
  crdt:{clipId}:p              Hash   CRDT P-counter
  crdt:{clipId}:n              Hash   CRDT N-counter
  crdt:{clipId}:pw             Hash   Weighted P
  crdt:{clipId}:nw             Hash   Weighted N
  voted:{voterKey}:{clipId}    String Dedup (7-day TTL)
  daily:{date}:{voterKey}      String Daily counter (25-hr TTL)
  vote_queue                   List   Pending events
  vote_queue:processing        List   Currently processing events
  vote_queue:dead_letter       List   Failed events (7-day TTL per entry)
  clips_active                 Set    Unsynced clips
  bloom:votes:{clipId}         String Bloom filter bits
  hll:voters:{clipId}          HLL    Unique voters
  slot_frozen:{seasonId}:{pos} String Voting freeze flag (120s TTL)

AUTH:
  refresh:{jti}                String userId (7-day TTL)
  banned:{userId}              String Ban flag
  shadow_ban:{voterKey}        String Shadow ban

COMMENTS:
  comments:{clipId}:recent     List   Hot cache (100 items, 1hr TTL)
  comments:{clipId}:count      String Comment count
  comment_likes:{commentId}    String Like count
  liked:{userId}:{commentId}   String Like dedup
  comment_queue                List   Pending events
  comment_queue:processing     List   Currently processing
  comment_queue:dead_letter    List   Failed events (7-day TTL)

LEADERBOARDS:
  leaderboard:voters           ZSet   All-time top voters
  leaderboard:creators         ZSet   All-time top creators
  leaderboard:clips:{slot}     ZSet   Current slot top clips
  leaderboard:xp               ZSet   Top XP
  leaderboard:voters:daily:{d} ZSet   Daily (48hr TTL)
  leaderboard:voters:weekly:{w}ZSet   Weekly (14d TTL)
  leaderboard:voters:season:{s}ZSet   Seasonal

SOCIAL:
  following:{userId}           Set    Who I follow
  followers:{userId}           Set    Who follows me
  follower_count:{userId}      String Follower count
  follow_queue                 List   Pending events
  follow_queue:processing      List   Currently processing
  follow_queue:dead_letter     List   Failed events (7-day TTL)

NOTIFICATIONS:
  notifications:{userId}:recent List  Hot cache
  unread:{userId}              String Unread count
  notif_batch:{userId}:{type}  Hash   Grouping window
  notification_queue           List   Pending events
  notification_queue:processing List  Currently processing
  notification_queue:dead_letter List Failed events (7-day TTL)

VIDEO:
  transcode_queue              List   Pending transcode jobs
  clip_hash:{hash}             String clipId (dedup lookup)

SEARCH:
  search_index_queue           List   Pending index updates
  trending:clips               ZSet   Trending clips (30s TTL)

DISTRIBUTION:
  pool:cold:{seasonId}:{slot}  Set    Cold pool clip IDs (120s TTL)
  pool:warm:{seasonId}:{slot}  ZSet   Warm pool (engagement scored, 120s TTL)
  pool:hot:{seasonId}:{slot}   ZSet   Hot pool (engagement scored, 120s TTL)
  clip_stats:{clipId}          Hash   views, vote_count, engagement_rate
  cursor:{sessionId}           Set    Shown clip IDs per session (1hr TTL)
  creator_rep:{userId}         Hash   approved, total, reputation score
  view_queue                   List   Pending view events for DB persistence
  view_queue:processing        List   Currently processing view events
  view_queue:dead_letter       List   Failed view events (7-day TTL)

CACHING:
  slot:{seasonId}              String Active slot (1-min TTL)
  season:{seasonId}            String Season data (5-min TTL)
  genre:{genre}:top            ZSet   Top clips per genre

RATE LIMITING:
  bucket:{identifier}          Hash   Token bucket state

XP/ACHIEVEMENTS:
  xp_queue                     List   Pending XP events

CREATOR:
  uploads_today:{userId}:{date}String Upload count (25hr TTL)
```

---

## 23. Cost Model

### Scale-Linked Costs (Revised — includes compute)

```
0-1,000 users:       $0/month      (free tiers everywhere)
1,000-10,000:        $60/month     (Phase 1: Supabase Pro $25 + Upstash Pro $10
                                     + Vercel Pro $20 + QStash $5)
10,000-50,000:       $170/month    (Phase 2: + Pusher Startup $49
                                     + Vercel function invocations ~$30)
50,000-500,000:      $500/month    (Phase 3: + R2 ~$100 + Search ~$50
                                     + Cloudflare $20 + Vercel compute ~$100)
500,000-1,000,000:   $1,500/month  (Phase 4: + Read Replica $200
                                     + Pusher Business $299 + regional Redis ~$100
                                     + Vercel Enterprise ~$400)
1,000,000+:          $3,000-5,000  (Full horizontal: dedicated workers,
                                     multi-region, Pusher Max or custom WS)

Note: Previous estimates didn't account for:
  - Vercel compute costs ($0.18/100K Edge, $0.60/100K Serverless invocations)
  - Pusher plan limits (Business = 10K connections; 1M users at 2% concurrent
    = 20K connections → need Max plan or custom WebSocket server)
  - Redis memory costs at scale (see Section 26: Redis Memory Budget)
```

### Video Storage Costs (R2)

```
Storage: $0.015/GB/month
Egress from Workers: $0 (free!)
Egress from public: $0.36/million Class A, $0.036/million Class B

At 1M videos (~64TB total):
  Storage: 64TB × $0.015/GB = $960/month
  Egress: $0 (free via Workers — R2 has no egress fees)
  Operations: ~$50/month (Class A/B at scale)
  Total: ~$1,010/month

At 100K videos (~6.4TB):
  Storage: 6.4TB × $0.015/GB = $96/month
  Egress: $0

Compare: AWS S3 for 6.4TB storage + 30TB/month egress = ~$3,000/month
R2 saves 95%+ on video delivery costs.
```

### Per-User Economics (Revised)

| Scale | Monthly Cost | Cost/User/Month |
|-------|-------------|----------------|
| 10K users, 1K videos | $60 | $0.006 |
| 100K users, 50K videos | $400 | $0.004 |
| 1M users, 1M videos | $3,500 | $0.0035 |

For reference: TikTok spends ~$0.10-0.50 per user per month.
AiMoviez at ~$0.004/user is 25-125x more efficient (short clips, no recommendation ML infra, free R2 egress).

---

## 24. Monitoring & Observability

### Tooling Stack

```
CHOSEN STACK:
  Metrics & Dashboards:  Grafana Cloud (free tier: 10K metrics, 50GB logs)
  Error Tracking:        Sentry (existing — keep)
  Uptime Monitoring:     Vercel Analytics (existing) + Grafana Synthetic
  Log Aggregation:       Grafana Loki (structured JSON logs)
  Alerting:              Grafana Alerting → PagerDuty / Slack / Email

WHY GRAFANA CLOUD:
  - Generous free tier covers Phase 0-2
  - Native Vercel integration (import serverless metrics)
  - Native Upstash integration (Redis metrics)
  - Native Supabase integration (PostgreSQL metrics)
  - OTLP-compatible (custom app metrics via OpenTelemetry push)
  - Cost: $0 (free) → $29/mo (Pro) → $199/mo (Advanced)

ALTERNATIVES CONSIDERED:
  Datadog: More powerful but $15/host/month, expensive at scale
  New Relic: Good free tier but vendor lock-in on queries
  Self-hosted Grafana: More control but operational burden

IMPLEMENTATION:
  Phase 0: Sentry (existing) + Vercel Analytics (existing)
  Phase 1: Add Grafana Cloud free tier
           - Import Upstash Redis metrics
           - Import Supabase PostgreSQL metrics
           - Custom dashboard for queue depths
  Phase 2: Add custom app metrics via OpenTelemetry OTLP push
           (NOT prom-client — prom-client is pull-based and incompatible
            with Vercel's ephemeral serverless functions. Use OTLP push
            to send metrics directly to Grafana Cloud on each invocation.)
           - Vote latency histogram
           - Queue depth gauges
           - Circuit breaker state
           - Structured logging via Grafana Loki
  Phase 3: Grafana Pro
           - Synthetic monitoring (global latency checks)
           - SLO tracking (99.9% vote success rate)
           - Alerting escalation policies

STRUCTURED LOGGING FORMAT:
  {
    "level": "info|warn|error",
    "service": "vote-api|queue-processor|auth",
    "traceId": "{uuid}",
    "userId": "{id}",
    "action": "vote|comment|follow",
    "duration_ms": 8,
    "queue_depth": 150,
    "error": null
  }
  Ship to Grafana Loki via Vercel Log Drain
```

### Dashboards

```
VOTING:
  vote_queue depth            (alert > 50,000)
  processing latency          (alert > 30s)
  CRDT counter drift          (alert > 1000 vs DB)
  votes/second                (baseline + anomaly)
  duplicate rejection rate    (normal: <5%)

AUTH:
  JWT validation failures/min (alert on spike)
  refresh token errors/min    (alert > 10%)
  active sessions (HLL)       (capacity planning)

DATABASE:
  connection pool utilization (alert > 80%)
  batch insert throughput     (votes/sec processed)
  counter sync lag            (alert > 15s behind Redis)
  partition size              (alert > 100GB per partition)

VIDEO:
  transcode queue depth       (alert > 1000)
  R2 storage growth           (capacity planning)
  CDN cache hit ratio         (target: >90%)
  upload success rate         (alert < 95%)

SEARCH:
  index sync lag              (alert > 60s behind DB)
  search latency p99          (alert > 200ms)
  index size                  (capacity planning)

COMMENTS:
  comment_queue depth         (alert > 10,000)
  Redis cache hit rate        (target: >80%)
  comment broadcast latency   (target: <2s)

REAL-TIME:
  Pusher active connections   (capacity planning)
  broadcast latency p99       (target: <2s)
  WebSocket reconnect rate    (alert > 5%)

EDGE:
  rate limit blocks/min       (informational)
  edge validation failures    (alert on spike)
  global latency by region    (p50, p99)
```

### Alert Rules

| Alert | Condition | Action |
|-------|-----------|--------|
| Queue overflow | depth > 50K | Increase processor concurrency |
| DB exhaustion | pool > 90% | Scale pool, investigate |
| Auth spike | >100 failures in 5 min | Check JWT secret, Redis |
| Counter drift | delta > 1000 | Force sync |
| Rate limit surge | >10K blocks in 1 min | Check DDoS |
| Processor failure | success < 95% | Check DB, dead letters |
| Video transcode stuck | queue > 1K for > 10 min | Check worker, R2 access |
| Search stale | lag > 5 min | Check sync worker |

---

## 25. Disaster Recovery & Rollback

### Recovery Matrix

| Scenario | Recovery | Estimated Time |
|----------|----------|----------------|
| **Redis crash** | Rebuild from PostgreSQL (see below) | 10min–2hr (depends on data volume) |
| **Queue processor dies** | Votes safe in Redis list. Restart processor | <1 min (auto-restart) |
| **DB down** | Votes queue in Redis. Sync when recovered | Minutes–hours (depends on outage) |
| **Cloudflare outage** | DNS failover direct to Vercel | 2-5 min (DNS propagation) |
| **Pusher outage** | Automatic polling fallback | 0 (instant degradation) |
| **R2 outage** | S3 fallback (during migration period), CDN cache serves | 0 (CDN cache) or 5 min (DNS) |
| **Search index down** | Fallback to DB queries (slower but functional) | 0 (instant degradation) |
| **Counter drift** | Force recount from votes table | 1-30 min |
| **Data corruption** | PostgreSQL PITR (point-in-time recovery) | 30 min–2hr |

### Redis Crash Recovery (Detailed)

```
PROBLEM: At hundreds of millions of votes, rebuilding Redis from PostgreSQL
is not instant. COUNT(*) GROUP BY clip_id on 100M rows = 5-30 minutes.

RECOVERY PROCEDURE:
1. Detect: health check fails → circuit breaker opens (automatic)
2. INTERIM MODE (immediate, 0 downtime):
   - Vote API falls back to synchronous DB path (feature flag: async_voting=false)
   - Leaderboards serve stale data from last DB snapshot
   - Comment cache misses fall through to DB
   - Auth continues working (JWT is stateless, no Redis needed)
   - Dedup checks fall back to DB query (slower, ~50ms)
   Result: Service continues at reduced performance, no data loss

3. REBUILD (background, while interim mode serves traffic):
   Phase A: Critical counters (5-15 min)
     SELECT clip_id, COUNT(*) FROM votes
       WHERE slot_position = {current_slot}
       GROUP BY clip_id;
     → Rebuild CRDT counters for ACTIVE clips only
     → ~1000 active clips, fast query

   Phase B: Dedup sets (10-30 min)
     SELECT DISTINCT voter_key, clip_id FROM votes
       WHERE created_at > NOW() - INTERVAL '7 days';
     → Rebuild voted:{voter}:{clip} keys
     → Only last 7 days needed (keys have 7-day TTL anyway)

   Phase C: Leaderboards (5-10 min)
     Rebuild from pre-aggregated tables (not raw votes)

   Phase D: Social graph, notifications (10-20 min)
     Rebuild from followers, notifications tables

4. SWITCH BACK: feature flag: async_voting=true → Redis hot path resumes

TOTAL RECOVERY: ~30-60 min for full rebuild
SERVICE IMPACT: Degraded performance for 30-60 min, zero data loss, zero downtime
```

### Source of Truth Hierarchy

```
1. PostgreSQL votes table    → ultimate truth for vote records
2. Redis CRDT counters       → real-time truth for vote counts
3. Redis dedup sets          → real-time truth for "has voted"
4. R2 storage                → truth for video files
5. Search index              → derived from PostgreSQL (rebuild any time)

Sync direction:
  Redis ──(counter sync)──→ PostgreSQL vote_count column
  Redis ──(queue processor)──→ PostgreSQL votes table
  PostgreSQL ──(recovery only)──→ Redis
  PostgreSQL ──(sync worker)──→ Search index

Invariant: Redis may be AHEAD of PostgreSQL (async lag)
           but never permanently BEHIND (sync catches up)
```

### Phase 1 Rollback (< 5 minutes)

```sql
-- Re-enable triggers
ALTER TABLE votes ENABLE TRIGGER on_vote_insert;
ALTER TABLE votes ENABLE TRIGGER on_vote_delete;
-- Full recount
SELECT full_recount_vote_counts();
```
```
Feature flag: async_voting = false → instant rollback to sync path
```

---

## 26. Redis Memory Budget

**Every Redis key costs memory. At scale, this must be calculated upfront.**

### 26.1 Memory per System (at 1M users, 1M clips, 100M votes)

```
VOTING (heaviest consumer):
  CRDT counters (4 hashes per active clip):
    At millions of users, 50K-500K clips compete per slot.
    500K active clips × 4 hashes × ~500 bytes = 1GB
    (Only active clips; archived clips cleared after slot ends)

  Dedup keys (voted:{voter}:{clip}, 7-day TTL):
    Worst case: 10M votes/week × 50 bytes = 500MB
    With Bloom Filters (Phase 3): 10M × 1.5 bytes = 15MB + 500MB/100 = 20MB

  Daily counters (daily:{date}:{voter}, 25hr TTL):
    200K DAU × 50 bytes = 10MB

  Vote queue (transit, ideally near-zero):
    Steady state: ~1000 events × 200 bytes = 200KB
    Spike: 50,000 events × 200 bytes = 10MB

  Active clips set: <1KB

  Bloom filters: Not practical at 500K active clips (too much memory).
    Use session cursor for dedup instead (see Section 12.5).
    Only enable Bloom for top 1K clips with >100K votes: 1K × 1.2MB = 1.2GB

  HyperLogLog (per clip):
    500K active × 12KB = 6GB ← TOO EXPENSIVE at 500K clips
    Optimization: HLL only for top 10K clips (warm+hot): 10K × 12KB = 120MB
    Cold pool clips: approximate from view_count (close enough)

  Subtotal voting: ~1.7GB (CRDT 1GB + dedup 500MB + daily 10MB + HLL 120MB + queue 10MB)

AUTH:
  Refresh tokens (refresh:{jti}, 7-day TTL):
    200K active sessions × 80 bytes = 16MB
  Ban flags: negligible (<1MB)
  Subtotal auth: ~17MB

COMMENTS:
  Hot cache (100 comments × top 1000 clips):
    1,000 × 100 × 500 bytes = 50MB
  Comment counts: 1M × 20 bytes = 20MB
  Like counts + dedup: ~30MB
  Comment queue: ~1MB steady state
  Subtotal comments: ~100MB

LEADERBOARDS:
  7 ZSets × ~200K entries × 50 bytes = 70MB
  Time-windowed (daily/weekly): × 3 = 210MB
  Subtotal leaderboards: ~210MB

SOCIAL:
  Following/followers sets:
    Each follow creates 2 entries: SADD following:{A} B + SADD followers:{B} A
    1M users × avg 50 follows = 50M relationships × 2 entries × 20 bytes = 2GB
    (This is the most expensive system at scale)
  Follower counts: 1M × 20 bytes = 20MB
  Follow queue: ~1MB
  Subtotal social: ~2GB

NOTIFICATIONS:
  Hot cache (20 recent × 200K active users):
    200K × 20 × 300 bytes = 1.2GB
    (Optimize: only cache for users active in last hour)
    Active-hour users: ~20K × 20 × 300 = 120MB
  Unread counts: 1M × 10 bytes = 10MB
  Grouping hashes: ~5MB
  Subtotal notifications: ~135MB (optimized)

DISTRIBUTION:
  Pool sets (cold/warm/hot per slot):
    Cold set: 500K entries × 40 bytes = 20MB
    Warm ZSet: 200K entries × 50 bytes = 10MB
    Hot ZSet: 50K entries × 50 bytes = 2.5MB
    Subtotal pools: ~33MB

  Clip stats hashes: 500K × 100 bytes = 50MB
  View queue: ~5MB steady state

  Session cursors (biggest consumer):
    200K concurrent sessions × 18KB avg = 3.6GB
    (TTL: 1 hour — auto-expire inactive sessions)
    Optimization: only cursor warm+hot pools = 60% of entries = 2.2GB

  Creator reputation: 50K creators × 50 bytes = 2.5MB

  Subtotal distribution: ~2.3GB (dominated by session cursors)

CACHING:
  Slot/season/genre caches: ~5MB
  Subtotal caching: ~5MB

VIDEO:
  Transcode queue: ~1MB
  Hash dedup lookup: 1M × 80 bytes = 80MB
  Subtotal video: ~80MB

SEARCH:
  Search index queue: ~1MB
  Trending ZSet: ~50KB
  Subtotal search: ~1MB
```

### 26.2 Total Memory Requirements

```
PHASE 1 (10K users, 1K clips):
  Voting: ~15MB
  Auth: ~2MB
  Total: ~20MB
  Upstash Pro (10GB): ✅ abundant headroom

PHASE 2 (100K users, 50K clips):
  Voting: ~80MB
  Auth: ~5MB
  Comments: ~30MB
  Leaderboards: ~50MB
  Social: ~100MB
  Notifications: ~30MB
  Total: ~300MB
  Upstash Pro (10GB): ✅ sufficient

PHASE 3 (500K users, 500K clips):
  Voting: ~300MB (with Bloom)
  Auth: ~10MB
  Comments: ~70MB
  Leaderboards: ~150MB
  Social: ~1GB (following + followers mirror)
  Notifications: ~80MB
  Video: ~40MB
  Total: ~1.7GB
  Upstash Pro (10GB): ✅ sufficient

PHASE 4 (1M users, 500K clips per slot, 1M total clips):
  Voting: ~1.7GB (500K active clips with CRDT counters)
  Auth: ~17MB
  Comments: ~100MB
  Leaderboards: ~210MB
  Social: ~2GB (following + followers mirror)
  Notifications: ~135MB
  Distribution: ~2.3GB (session cursors + pools + stats)
  Video: ~80MB
  Search: ~1MB
  Caching: ~5MB
  Total: ~6.5GB
  Upstash Pro (10GB): ✅ fits but tight

  With 5M+ users (500K clips per slot):
    Session cursors alone: ~3.6GB
    CRDT counters: ~1GB
    Social: ~2GB
    Total could reach 8-9GB → approaching 10GB limit
    Action: Upstash Enterprise or split Redis into 2 instances
      Instance 1: voting + distribution (4-5GB)
      Instance 2: social + notifications + auth (3-4GB)

COST IMPACT:
  Upstash Pro 10GB:  $120/month (pay-as-you-go beyond free tier)
  Upstash 25GB:      $280/month
  Note: The $10/month estimate in earlier versions was for the base plan.
  At Phase 3+, budget $120-280/month for Redis.
```

### 26.3 Memory Optimization Strategies

```
1. TTL everything: No key without an expiration
   - Dedup keys: 7 days
   - Daily counters: 25 hours
   - Comment cache: 1 hour
   - Notification cache: 1 hour (active users only)
   - Session votes: 5 minutes
   - Leaderboard daily: 48 hours

2. Lazy-load social graph: Don't cache followers for inactive users
   Only populate following:{userId} on login, TTL 24hr

3. Bloom Filters for dedup: 96% memory savings (Phase 3)

4. Archive old leaderboards: seasonal boards → PostgreSQL after season ends

5. Notification cache only for active users:
   Only cache for users who opened the app in last hour
   Reduces 1.2GB → 120MB

6. Compress large values: comment JSON → MessagePack (30-50% smaller)
```

---

## 27. API Versioning Strategy

**At millions of active clients, breaking API changes cause outages.**

### 27.1 Versioning Approach

```
CHOSEN: URL path versioning
  /api/v1/vote
  /api/v1/comments
  /api/v1/leaderboard

WHY NOT header versioning (Accept: application/vnd.aimoviez.v1+json)?
  - Harder to debug, harder to route at edge, harder for CDN caching
  - URL versioning is simpler, works with every tool, cacheable

WHY NOT query parameter (?version=1)?
  - Easy to forget, messy cache keys

WHEN TO INTRODUCE:
  Phase 1: No versioning needed yet (< 10K users, rapid iteration OK)
  Phase 2: Introduce /api/v1/ prefix before auth migration
           (51 routes changing auth = potential breakage)
  Phase 3+: All new routes use /api/v1/

MIGRATION PATTERN:
  /api/vote         → keep working (v0, unversioned)
  /api/v1/vote      → new Redis-first flow
  Both coexist until v0 traffic drops to <1%
  Then: /api/vote redirects 301 → /api/v1/vote
  Finally: remove v0 handlers
```

### 27.2 Breaking Change Protocol

```
1. New version: /api/v2/vote (deploy alongside v1)
2. Announce deprecation: X-API-Deprecation header on v1 responses
3. Monitor: track v1 vs v2 request counts
4. Grace period: 90 days minimum for migration
5. Sunset: v1 returns 410 Gone with migration guide URL
6. Remove: delete v1 handlers after sunset confirmed

CLIENT COMPATIBILITY:
  - Mobile apps (future): enforce minimum version via app store
  - Web: auto-updates (no version pinning issue)
  - Third-party API consumers (future): API key tracks version preference
```

### 27.3 Implementation in Next.js

```
Current structure:
  src/app/api/vote/route.ts
  src/app/api/comments/route.ts

Versioned structure:
  src/app/api/v1/vote/route.ts          (new Redis-first)
  src/app/api/vote/route.ts             (legacy, forwards to v1 or serves v0)

  Shared logic stays in src/lib/* (both versions import same utilities)
  Only the route handler and validation layer differs per version
```

---

## 28. GDPR & Data Privacy

**Required for EU users. Non-compliance fines: up to 4% of global revenue.**

### 28.1 Data Subject Rights

```
RIGHT TO ACCESS (DSAR — Data Subject Access Request):
  GET /api/user/data-export
  Must return within 30 days:
  - Profile data (users table)
  - All votes cast (votes table)
  - All comments (comments table)
  - All notifications (notifications table)
  - Follow relationships (followers table)
  - Uploaded clips metadata (tournament_clips table)
  - Login history (audit_logs table)
  - Device fingerprints collected

  Format: JSON export + optional CSV
  Implementation: Background job, email download link when ready

RIGHT TO DELETION ("Right to be Forgotten"):
  DELETE /api/user/account
  Must cascade across ALL storage:

  PostgreSQL:
    DELETE FROM votes WHERE voter_key = {key}
    DELETE FROM comments WHERE user_key = {key}
    DELETE FROM comment_likes WHERE user_key = {key}
    DELETE FROM notifications WHERE user_key = {key}
    DELETE FROM followers WHERE follower_id = {id} OR followed_id = {id}
    DELETE FROM push_subscriptions WHERE user_id = {id}
    DELETE FROM referrals WHERE referrer_id = {id} OR referred_id = {id}
    UPDATE tournament_clips SET user_id = NULL, username = '[deleted]'
      WHERE user_id = {id}  (keep clips but anonymize creator)
    DELETE FROM users WHERE id = {id}

  Redis (all key patterns):
    DEL voted:{voterKey}:*
    DEL daily:*:{voterKey}
    DEL following:{userId}, followers:{userId}
    DEL follower_count:{userId}
    DEL notifications:{userId}:*
    DEL unread:{userId}
    DEL refresh:{*}  (where value = userId)
    ZREM from all leaderboards
    DEL feed:{userId}

  Cloudflare R2:
    Videos uploaded by user: check reference count
    If only uploader → delete video files
    If shared hash → keep (other users reference same content)

  Search Index:
    Remove user's clips from search index
    Remove user from creator search

  Audit Trail:
    Log the deletion request itself (GDPR allows this)
    Anonymize audit_logs: SET user_info = '[deleted]'

  Timeline: Complete within 30 days (GDPR requirement)
  Implementation: Background job with checklist, admin-visible progress

RIGHT TO RECTIFICATION:
  Existing: /api/user/profile already supports updates
  Ensure: display_name, username changes propagate to:
    - Denormalized clip records (tournament_clips.username)
    - Search index
    - Comment display names
    - Redis caches (TTL handles this naturally)

DATA PORTABILITY:
  Same as Right to Access but in machine-readable format (JSON)
  Include: profile, votes, comments, clips metadata, follows
```

### 28.2 Data Retention Policies

```
| Data Type | Retention | After Expiry |
|-----------|-----------|-------------|
| User profile | Until deletion | Anonymize |
| Votes | Permanent (game integrity) | Anonymize voter_key |
| Comments | Permanent (content record) | Show as "[deleted user]" |
| Notifications | 90 days | Delete (partition drop) |
| Audit logs | 1 year | Archive to cold storage |
| Device fingerprints | 30 days | Delete |
| Push subscriptions | Until unsubscribe | Delete |
| Session tokens | 7 days (TTL) | Auto-expire |
| Analytics events | 1 year aggregated | Delete raw, keep aggregates |
| Uploaded videos | Until clip deleted | Deferred R2 cleanup |

AUTOMATED CLEANUP:
  Cron job (weekly): /api/cron/data-retention
    - Drop notification partitions older than 90 days
    - Archive audit_log partitions older than 1 year
    - Clear expired device fingerprints
    - Purge anonymous analytics older than 1 year
```

### 28.3 Consent Management

```
TRACKING CONSENT (cookie banner):
  - Essential cookies: always (session, auth) — no consent needed
  - Analytics cookies: opt-in required
  - Device fingerprinting: disclosed in privacy policy
    (used for anti-fraud, legitimate interest basis)

DATA PROCESSING:
  - Vote data: legitimate interest (core platform function)
  - Comments: legitimate interest (core platform function)
  - Email: consent (newsletter, optional)
  - Push notifications: explicit opt-in (existing push_subscriptions)
  - Analytics: consent (opt-out available)

IMPLEMENTATION:
  Phase 1: Cookie consent banner (basic)
  Phase 2: Privacy dashboard (/settings/privacy)
           - Download my data
           - Delete my account
           - Manage notification preferences
           - Analytics opt-out toggle
  Phase 3: Automated DSAR processing
           - Self-service data export
           - Self-service account deletion (with 14-day grace period)
```

---

## 29. CI/CD & Deployment Safety

**At millions of users, every deploy is a risk. Need automated safety gates.**

### 29.1 Pipeline Architecture

```
CURRENT: Push to main → Vercel auto-deploys → hope it works
TARGET:

  Developer Branch
       │
       ▼
  ┌────────────────────────────────────────────────────┐
  │ CI: GitHub Actions                                  │
  │  1. Lint (ESLint)                           30s    │
  │  2. Type check (tsc --noEmit)               45s    │
  │  3. Unit tests (Vitest)                     60s    │
  │  4. Integration tests (API routes)          120s   │
  │  5. Build (next build)                      90s    │
  │  ALL MUST PASS → merge allowed                      │
  └────────────────────────────────────────────────────┘
       │
       ▼ (merge to main)
  ┌────────────────────────────────────────────────────┐
  │ STAGING DEPLOY (Vercel Preview)                     │
  │  1. Deploy to staging.aimoviez.com                  │
  │  2. Smoke tests against staging:                    │
  │     - Health check endpoints                        │
  │     - Vote API round-trip                           │
  │     - Auth flow (Google OAuth test account)         │
  │     - Leaderboard loads                             │
  │  3. Synthetic Grafana check (latency < thresholds)  │
  │  ALL MUST PASS → production deploy                  │
  └────────────────────────────────────────────────────┘
       │
       ▼
  ┌────────────────────────────────────────────────────┐
  │ PRODUCTION DEPLOY                                   │
  │  Strategy: Vercel Instant Rollback                  │
  │  1. Deploy new version                              │
  │  2. Vercel keeps previous version available          │
  │  3. Monitor for 10 minutes:                         │
  │     - Error rate (Sentry)                           │
  │     - Latency p99 (Grafana)                         │
  │     - Queue depths (Grafana)                        │
  │  4. If any alert fires → instant rollback (1 click) │
  └────────────────────────────────────────────────────┘
```

### 29.2 Feature Flag Discipline

```
EVERY scaling change is behind a feature flag:
  async_voting:      Redis-first vote pipeline
  stateless_auth:    JWT without DB queries
  pusher_realtime:   Pusher instead of Supabase Realtime
  redis_comments:    Comment cache in Redis
  redis_leaderboard: Sorted Set leaderboards
  r2_uploads:        R2 instead of S3
  search_enabled:    Meilisearch integration
  bloom_dedup:       Bloom filter vote dedup

Feature flags already exist: feature_flags table + /api/admin/feature-flags
Each flag enables gradual rollout:
  OFF → 1% → 10% → 50% → 100%

ROLLBACK: flip flag to OFF → instant revert, no redeploy needed
```

### 29.3 Database Migration Safety

```
TOOL: Supabase Migrations (SQL files in supabase/migrations/)

RULES:
  1. Every migration is forward-only (no DROP COLUMN without migration plan)
  2. Additive changes first: ADD COLUMN, CREATE INDEX CONCURRENTLY
  3. Backfill data in background job (not in migration)
  4. Remove old column only after all code paths updated
  5. Large table migrations: use pg_repack or CREATE INDEX CONCURRENTLY
     (never lock a table with 100M+ rows)

EXAMPLE (adding content_hash to tournament_clips):
  Migration 1: ALTER TABLE tournament_clips ADD COLUMN content_hash TEXT;
  Deploy 1:    Code writes content_hash on new uploads (NULL for old)
  Migration 2: Background: UPDATE tournament_clips SET content_hash = ...
  Deploy 2:    Code reads content_hash (with NULL fallback)
  Migration 3: ALTER TABLE tournament_clips ALTER COLUMN content_hash SET NOT NULL;
               (only after all rows populated)

TESTING:
  Run migrations against staging DB clone before production
  Supabase branching (if available) or pg_dump → restore → test
```

### 29.4 Rollback Playbook

```
LEVEL 1: Code rollback (Vercel instant rollback)
  When: Bug in application code
  How: Vercel dashboard → Deployments → Promote previous

LEVEL 2: Feature flag rollback (no deploy)
  When: New scaling feature causes issues
  How: /api/admin/feature-flags → toggle OFF
  Effect: Immediate, affects next request

LEVEL 3: Database rollback (manual)
  When: Migration caused data issues
  How: Supabase PITR (point-in-time recovery)
  Risk: Loses all data since recovery point
  Prefer: Forward-fix with corrective migration

LEVEL 4: Full infrastructure rollback
  When: Service provider outage (Redis, Pusher, R2)
  How: Circuit breakers activate, graceful degradation (see Section 17)
```

---

## 30. Appendix: Decision Log

### Why CRDT Over Sharded Counters?
CRDT PN-Counters use 2 hashes per clip vs 100 keys for sharded counters. Native vote removal via N-counter. Mathematical convergence guarantee. Simpler and more correct.

### Why Pusher Over Supabase Realtime?
Supabase Realtime has `postgres_changes` binding issues (hook exists but is effectively disabled). Pusher works independently of the database — when PostgreSQL is under load, Pusher still delivers.

### Why Cloudflare R2 Over AWS S3?
R2: global CDN from 200+ edge locations, $0.015/GB storage, free egress from Workers. S3: single-region, $0.09/GB egress. At scale, R2 saves 90%+ on video delivery. Migration path: both can coexist during transition.

### Why Meilisearch/Typesense Over PostgreSQL Full-Text Search?
At millions of clips, `pg_trgm` or `tsvector` queries become slow and resource-intensive on the primary DB. Dedicated search index: sub-50ms, typo-tolerant, faceted filtering, zero load on PostgreSQL.

### Why Token Bucket Over Sliding Window?
Current sliding window (src/lib/rate-limit.ts) blocks rapid legitimate voting. Token Bucket allows controlled bursts (10 rapid votes) while maintaining average rate (30/min). Matches human behavior.

### Why Event Queues for Everything?
Every write operation (vote, comment, follow, notification, XP, search index update) benefits from the same pattern: accept instantly in Redis, process in background batch. One pattern to learn, test, and monitor.

### Why Not Durable Objects From Day One?
Durable Objects are the most powerful option, but require full Cloudflare Workers architecture. Redis approach works within existing Vercel + Supabase stack. Durable Objects reserved for Phase 4.

### Why Table Partitioning?
At hundreds of millions of votes, unpartitioned tables become slow to query, vacuum, and backup. Monthly partitioning for time-series data (votes, views, notifications) keeps each partition manageable. Season-based partitioning for clips keeps season queries fast.

### Why Content-Addressed Video Storage?
SHA256 hash as filename: deduplication for free, immutable URLs for infinite CDN caching, integrity verification included. At millions of videos, even 10% dedup saves terabytes.

### Why a Dedicated Search Index?
No search = unusable at millions of clips. Users need instant, typo-tolerant discovery. Search is a read-heavy, specialized workload that shouldn't compete with transactional DB.

### Why Grafana Cloud Over Datadog?
Grafana Cloud has a generous free tier (10K metrics, 50GB logs) that covers Phases 0-2. Native integrations with Vercel, Upstash, and Supabase. Prometheus-compatible for custom metrics. Datadog is more powerful but costs $15/host/month — at AiMoviez's scale, Grafana covers the need at 1/5th the cost.

### Why URL Path API Versioning?
Simpler than header-based versioning, works with CDN caching, debuggable in browser. At millions of clients, the API contract must be stable. URL versioning is the most widely understood pattern and the easiest to route at the edge layer.

### Why a 30-Second Voting Freeze?
Without a freeze window, votes can arrive between counter sync and queue drain during slot transitions, causing a race condition. A 30-second freeze is standard for competition platforms (similar to auction closing). The UX impact is minimal — users see a countdown, which builds anticipation.

### Why Auto-Approve by Default?
At millions of users, 5% are creators = up to 500K clips per 24-hour slot. A human admin reviewing 1 clip/minute handles 480/day — you'd need 1,000+ admins. The existing upload pipeline already validates file integrity (signature, polyglot, MIME, size). Auto-approve clips that pass all checks, flag 4% for human review, auto-reject <1%. Admin becomes an exception handler, not a gatekeeper. Feature flag allows instant revert to manual mode.

### Why Tiered Pools Over Full-Table Sort?
`ORDER BY view_count + RANDOM() * 50` on 500K rows = ~500ms full-table sort per request. With 50M requests/day, this crushes the database. Three Redis pools (cold/warm/hot) pre-computed every 30 seconds serve clips via SRANDMEMBER/ZRANDMEMBER in ~3ms. 170× faster. Tiered pools also enforce fair exposure (40% cold) and surface engagement signals (warm/hot).

### Why Session Cursor Over excludeIds?
Client-side excludeIds grows unbounded (18KB URL after 500 clips) and SQL `!= ALL(array)` degrades. Server-side Redis Set per session: O(1) membership check, bounded memory (18KB per session, 1-hour TTL), no URL bloat. Falls back to excludeIds if Redis unavailable.

### Why Scale-Adaptive Cold Start Thresholds?
50 guaranteed views × 500K clips = 25M views = 50% of daily capacity consumed just on cold start. At 20 views: 10M = 20% — acceptable. Thresholds scale down as clip count grows, keeping cold start budget under 40% of total views.

### Why Feature Flags for Every Scaling Change?
At millions of users, deploying and reverting takes minutes. Feature flags allow instant rollback (next request reads new flag value) without redeployment. The feature_flags infrastructure already exists. Every Phase 1-4 change should be toggleable independently.

---

*This document supersedes: SCALING-TO-1M-USERS-PLAN.md, VOTING-SYSTEM-IMPROVEMENTS-V2.md, TIKTOK-STYLE-FULL-ANALYSIS.md, TIKTOK-VOTING-COMMENTS-SYSTEM-ANALYSIS.md, and TIKTOK-STYLE-AUTH-REDESIGN.md.*

*Document created: January 2026*
*Last updated: January 28, 2026 (v6 — added auto-approval pipeline, tiered pool distribution for 500K clips, session cursors, view count scaling, updated memory budget for 500K active clips)*
*Author: AiMoviez Engineering Team*
