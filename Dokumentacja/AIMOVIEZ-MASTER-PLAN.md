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
26. [Appendix: Decision Log](#26-appendix-decision-log)

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

**The frontend is production-ready. The gap is entirely backend.**

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
10,000 users × 288 auth queries/day = 2.88M auth queries/day

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
| Auth queries/day (10K users) | 2,940,000 | DB can't handle |
| Rate limit throughput | 33/sec (Upstash Free) | 0 when Redis down |
| Video storage | AWS S3, single region | No CDN, high egress cost |
| Video search | None | Linear scan only |
| Real-time updates | Partially disabled | Broadcast works, changes don't |
| Comment delivery | Polling | No push |

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
║  │  ├── Adaptive bitrate variants: 1080p/720p/480p/360p                │    ║
║  │  ├── Auto-generated thumbnails + 5sec previews                      │    ║
║  │  └── $0.015/GB egress, $0.015/GB storage                           │    ║
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
5. **Frontend stays untouched** — Optimistic updates, haptics, sounds already TikTok-quality
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

| Property | Sharded Counters (100 keys) | CRDT PN-Counter (2 hashes) |
|----------|---------------------------|---------------------------|
| Vote removal | Manual, error-prone | Built-in N-counter |
| Read cost | SUM 100 shards (100 calls) | HGETALL 2 hashes (2 calls) |
| Multi-region sync | Requires coordination | Automatic merge (math) |
| Network partition | Can diverge permanently | Always converges |
| Negative count risk | Possible with race conditions | Impossible by design |
| Memory per clip | 100 keys | 4 hashes |

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
1. Auto-advance cron detects slot expiry (voting_ends_at passed)
2. BEFORE winner selection:
   a. Force counter sync (all clips: Redis CRDT → PostgreSQL)
   b. Drain remaining vote_queue entries
   c. Verification: COUNT(*) FROM votes WHERE slot_position = X
3. Select winner from PostgreSQL (now accurate)
4. Advance slot via existing admin/advance-slot logic
5. Clear Redis state for old clips
6. Broadcast slot change via Pusher and useStoryBroadcast channel
```

### 3.6 Bloom Filter Optimization (Phase 3+)

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

### 3.7 Performance Targets

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
| Daily auth queries (10K users) | 2,940,000 | 250,000 (-91.5%) |

---

## 5. System 3: Video Pipeline & Storage at Scale

**This is critical for millions of videos.** Current: AWS S3 via signed URLs, single region, no CDN.

### 5.1 The Millions-of-Videos Problem

```
At current scale:
  ~100 clips × ~30MB avg = 3GB storage
  Single S3 region, signed URLs, no CDN

At millions of videos:
  1,000,000 clips × 30MB = 30TB storage (just originals)
  + Adaptive bitrate variants: 30TB × 4 = 120TB total
  + Thumbnails + previews: +10TB
  = ~160TB total storage

  Monthly egress (10M views × 30MB avg): 300TB
  S3 egress at $0.09/GB: $27,000/month ← UNACCEPTABLE
  R2 egress: $0 (free from Workers) or $0.015/GB = $4,500/month
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

Savings at 1M clips with 20% duplication: 24TB saved = $360/month
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

| Users | Concurrent WS | Pusher Plan | Cost |
|-------|--------------|------------|------|
| <10K | ~200 | Free | $0 |
| 10-50K | ~500 | Startup ($49) | $49 |
| 50-200K | ~2,000 | Pro ($99) | $99 |
| 200K-1M | ~10,000 | Business ($299) | $299 |

1M users ≈ 5-10% DAU ≈ 1-2% concurrent ≈ 10-20K WebSocket connections.

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

---

## 12. System 10: Smart Content Distribution

### 12.1 Engagement-Weighted Algorithm

```
Replaces current: get_clips_randomized() RPC
  (view_count + RANDOM() * jitter ordering)

New scoring formula:
  Score = (vote_rate × 0.4) + (completion_rate × 0.3)
        + (freshness × 0.2) + (random × 0.1)

  vote_rate       = votes / views (from clip_views + CRDT counters)
  completion_rate = video completions / video starts
  freshness       = 1.0 - (hours_since_upload / 72)
  random          = deterministic hash(voterKey + clipId) for consistency

Background (every 30 sec):
  For each active clip:
    compute score → ZADD clip_scores:{slot} score clipId

Serve: ZREVRANGE clip_scores:{slot} 0 -1 (instant, already ranked)
```

### 12.2 Cold Start Guarantee

```
New clips get 50 guaranteed views before algorithm takes over:
  HINCRBY clip_stats:{clipId} guaranteed_views 1
  If guaranteed_views < 50: boost score by 10x

Every clip gets a fair chance. After 50 views, engagement signal is strong.
```

### 12.3 Position Bias Correction

```
Problem: clips shown first get more votes (primacy effect)

Solution: rotate clip positions on each page load
  Seed: hash(voterKey + slot + timestamp_bucket)
  Each user gets different order
  Analytics track position-normalized vote rates
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
  Redis         → fail-closed (reject votes, comments)
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

### Phase 1: Redis-First Voting ($40/mo)

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

### Phase 2: Auth + Real-Time + Comments ($90/mo)

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

### Phase 3: Video + Search + Edge ($200/mo)

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

### Phase 4: Horizontal Scale ($500-2,000/mo)

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
 $0/mo       $40/mo       $90/mo      $200/mo     $500-2K/mo
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
All frontend components (optimistic UI already TikTok-quality)
src/lib/device-fingerprint.ts (device fingerprinting stays)
All admin UI components
All styling/layout files
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
| **Vercel** | App hosting, edge functions, cron | Existing | $20 |
| **Supabase** | PostgreSQL, PgBouncer, Auth | Phase 1 | $25 |
| **Upstash Redis** | CRDT, queues, dedup, sessions, leaderboards | Phase 1 | $10 |
| **Upstash QStash** | Sub-minute cron scheduling | Phase 1 | $0-5 |
| **Pusher** | WebSocket real-time broadcasts | Phase 2 | $0-299 |
| **Cloudflare** | Edge rate limiting, JWT validation | Phase 3 | $0-20 |
| **Cloudflare R2** | Video storage + global CDN | Phase 3 | $5-500 |
| **Meilisearch Cloud** | Full-text search index | Phase 3 | $0-50 |
| **Sentry** | Error tracking, performance | Existing | Existing |
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
  processing_queue             List   Processing events
  clips_active                 Set    Unsynced clips
  bloom:votes:{clipId}         String Bloom filter bits
  hll:voters:{clipId}          HLL    Unique voters

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

NOTIFICATIONS:
  notifications:{userId}:recent List  Hot cache
  unread:{userId}              String Unread count
  notif_batch:{userId}:{type}  Hash   Grouping window
  notification_queue           List   Pending events

VIDEO:
  transcode_queue              List   Pending transcode jobs
  clip_hash:{hash}             String clipId (dedup lookup)

SEARCH:
  search_index_queue           List   Pending index updates
  trending:clips               ZSet   Trending clips (30s TTL)

DISTRIBUTION:
  clip_scores:{slot}           ZSet   Engagement scores
  clip_stats:{clipId}          Hash   Views, completions, guaranteed_views
  session_votes:{sessionId}    Hash   Read-your-writes (5-min TTL)

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

### Scale-Linked Costs

```
0-1,000 users:       $0/month      (free tiers everywhere)
1,000-10,000:        $40/month     (Phase 1: Supabase Pro + Upstash Pro)
10,000-50,000:       $90/month     (Phase 2: + Pusher Startup)
50,000-500,000:      $200/month    (Phase 3: + R2 + Search + Edge)
500,000-1,000,000:   $500/month    (Phase 4: + Read Replica + Workers)
1,000,000+:          $2,000/month  (Full horizontal scaling)
```

### Video Storage Costs (R2)

```
Storage: $0.015/GB/month
Egress from Workers: $0 (free!)
Egress from public: $0.36/million Class A, $0.036/million Class B

At 1M videos (160TB total):
  Storage: 160TB × $0.015 = $2,400/month
  Egress: mostly free via Workers

At 100K videos (16TB):
  Storage: 16TB × $0.015 = $240/month

Compare: AWS S3 for 16TB + 30TB/month egress = ~$3,000/month
R2 saves 90%+ on video delivery costs.
```

### Per-User Economics

| Scale | Monthly Cost | Cost/User/Month |
|-------|-------------|----------------|
| 10K users, 1K videos | $40 | $0.004 |
| 100K users, 50K videos | $200 | $0.002 |
| 1M users, 1M videos | $3,000 | $0.003 |

For reference: TikTok spends ~$0.10-0.50 per user per month.

---

## 24. Monitoring & Observability

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

| Scenario | Recovery |
|----------|----------|
| **Redis crash** | Rebuild counters from PostgreSQL: `COUNT(*) GROUP BY clip_id` |
| **Queue processor dies** | Votes safe in Redis list. Restart processor |
| **DB down** | Votes queue in Redis. Sync when recovered |
| **Cloudflare outage** | DNS failover direct to Vercel |
| **Pusher outage** | Automatic polling fallback |
| **R2 outage** | S3 fallback (during migration period), CDN cache serves |
| **Search index down** | Fallback to DB queries (slower but functional) |
| **Counter drift** | Force recount from votes table |
| **Data corruption** | PostgreSQL is ultimate source of truth |

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

## 26. Appendix: Decision Log

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

---

*This document supersedes: SCALING-TO-1M-USERS-PLAN.md, VOTING-SYSTEM-IMPROVEMENTS-V2.md, TIKTOK-STYLE-FULL-ANALYSIS.md, TIKTOK-VOTING-COMMENTS-SYSTEM-ANALYSIS.md, and TIKTOK-STYLE-AUTH-REDESIGN.md.*

*Document created: January 2026*
*Last updated: January 28, 2026*
*Author: AiMoviez Engineering Team*
