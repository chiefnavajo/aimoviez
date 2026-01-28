# Full TikTok-Style Voting Analysis

## What You Already Have (TikTok-Like)

Analyzing the current codebase reveals you already have several TikTok-style patterns working:

### Already Implemented

| Pattern | TikTok | AiMoviez | Status |
|---------|--------|----------|--------|
| Optimistic UI updates | Instant +1 on tap | Instant +1 via React Query `onMutate` | **Done** |
| Haptic feedback | Vibration on like | `navigator.vibrate(50)` on vote | **Done** |
| Sound effects | Subtle tap sound | `sounds.play('vote')` + milestones | **Done** |
| Rollback on failure | Revert UI silently | `onError` restores previous state | **Done** |
| Vote toggle | Tap to like/unlike | Vote + revoke mutation | **Done** |
| Smart distribution | Algorithm-based feed | `view_count + jitter` randomization | **Done** |
| No per-user tracking | Device-level only | `voter_key` fingerprint | **Done** |
| CDN caching | Edge-cached counts | `s-maxage=30, stale-while-revalidate=120` | **Done** |
| Celebration effects | Heart animation | Confetti at milestones (1, 50, 100, 200) | **Done** |

**You're closer to TikTok than you think.** The frontend experience is already TikTok-like. The problem is entirely backend — the synchronous database write path.

---

## What's Missing (The Backend Gap)

### Gap 1: Synchronous Write Path

```
CURRENT (blocking):
Vote click → API → INSERT vote → TRIGGER fires → UPDATE clip row → Return
                                      ↑
                               ROW LOCK (serializes all votes for same clip)
                               100-500ms total

TIKTOK (non-blocking):
Like click → API → Redis INCR (1ms) → Queue event → Return
                         ↑
                  No lock, no DB
                  10-15ms total
```

**Impact:** The trigger-based synchronous counter update is the single bottleneck. Everything else is already TikTok-like.

### Gap 2: Real-Time Updates Disabled

```typescript
// src/hooks/useRealtimeClips.ts
useRealtimeClips({
  enabled: false,  // DISABLED due to postgres_changes binding issue
})
```

Other users cannot see vote count changes in real-time. They only see updated counts when they navigate away and return (React Query refetches on mount).

**TikTok behavior:** All viewers see like count update within 1-5 seconds.

### Gap 3: Database-Bound Counter

Vote counts live only in `tournament_clips.vote_count` (PostgreSQL). Every read requires a database query or stale cache.

**TikTok behavior:** Like counts live in Redis. Database is only for persistence. Reads never hit the database.

### Gap 4: No Distributed Rate Limiting

Rate limiting uses Upstash Redis with in-memory fallback. Serverless functions each get their own fallback instance — effectively no rate limiting when Redis is down.

**TikTok behavior:** Rate limiting at CDN edge. Abusive requests never reach origin.

---

## The Complete TikTok-Style Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        WHAT STAYS THE SAME                              │
│                                                                         │
│  Frontend:                                                              │
│  ├── Optimistic updates (React Query onMutate)              ✓ Keep     │
│  ├── Haptic feedback + sounds                               ✓ Keep     │
│  ├── Confetti milestones                                    ✓ Keep     │
│  ├── Vote toggle (vote + revoke)                            ✓ Keep     │
│  └── Clip randomization (view_count + jitter)               ✓ Keep     │
│                                                                         │
│  Validation:                                                            │
│  ├── Device fingerprinting                                  ✓ Keep     │
│  ├── Risk assessment / flagging                             ✓ Keep     │
│  ├── Captcha support                                        ✓ Keep     │
│  └── Clip status / slot validation                          ✓ Keep     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                         WHAT CHANGES                                    │
│                                                                         │
│  Write Path:                                                            │
│  ├── Synchronous DB INSERT + trigger  →  Redis counter + event queue   │
│  ├── Row lock per vote                →  No locks (sharded/CRDT)       │
│  └── 100-500ms response              →  10-15ms response              │
│                                                                         │
│  Read Path:                                                             │
│  ├── vote_count from PostgreSQL       →  vote_count from Redis         │
│  ├── Disabled realtime                →  WebSocket/Pusher push         │
│  └── 30s CDN cache                   →  5s Redis cache + push         │
│                                                                         │
│  Rate Limiting:                                                         │
│  ├── Origin-level (Upstash)          →  Edge-level (Cloudflare)       │
│  └── Fail-open fallback             →  Fail-closed                    │
│                                                                         │
│  Daily Limit:                                                           │
│  ├── DB query per vote               →  Redis counter                  │
│  └── 50ms per check                 →  0.5ms per check               │
│                                                                         │
│  Duplicate Check:                                                       │
│  ├── DB unique constraint            →  Redis + Bloom Filter           │
│  └── Checked at INSERT time         →  Checked before queueing        │
└─────────────────────────────────────────────────────────────────────────┘
```

### New Data Flow: Cast Vote

```
USER TAPS VOTE BUTTON
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND (unchanged)                                            │
│                                                                  │
│  1. onMutate: Optimistic +1 on vote_count              (0ms)   │
│  2. navigator.vibrate(50)                                (0ms)   │
│  3. sounds.play('vote')                                  (0ms)   │
│  4. POST /api/vote { clipId }                            (async) │
│                                                                  │
│  User already sees +1 and feels haptic feedback                  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  EDGE: Cloudflare Worker                                         │
│                                                                  │
│  5. Token Bucket rate limit check                       (1ms)    │
│  6. JWT validation (stateless, no DB)                   (0.5ms)  │
│  7. Forward to origin if valid                                   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  ORIGIN: Vercel API                                              │
│                                                                  │
│  8. Redis: Check daily limit                            (0.5ms)  │
│     GET daily_votes:{date}:{voterKey}                            │
│     If >= 200 → return 429                                       │
│                                                                  │
│  9. Redis: Check duplicate vote                         (0.5ms)  │
│     EXISTS voted:{voterKey}:{clipId}                             │
│     If exists → return 409                                       │
│                                                                  │
│ 10. Redis: Validate active slot (cached)                (0.5ms)  │
│     GET active_slot:{seasonId}                                   │
│     Verify clip is in active slot                                │
│                                                                  │
│ 11. Redis: Update CRDT counter                          (1ms)    │
│     HINCRBY crdt:{clipId}:p {nodeId} 1                           │
│                                                                  │
│ 12. Redis: Record vote intent                           (1ms)    │
│     SET voted:{voterKey}:{clipId} 1 EX 604800                    │
│     INCRBY daily_votes:{date}:{voterKey} 1                       │
│                                                                  │
│ 13. Redis: Enqueue event for DB persistence             (1ms)    │
│     LPUSH vote_queue {eventJSON}                                 │
│                                                                  │
│ 14. Redis: Get updated count for response               (1ms)    │
│     HGETALL crdt:{clipId}:p → sum increments                     │
│     HGETALL crdt:{clipId}:n → sum decrements                     │
│     Total = P - N                                                │
│                                                                  │
│ 15. Pusher: Broadcast vote to viewers                   (async)  │
│     trigger('clip-{clipId}', 'vote', { count })                  │
│                                                                  │
│ Total server time: ~6-8ms                                        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  RESPONSE TO CLIENT                                              │
│                                                                  │
│  {                                                               │
│    success: true,                                                │
│    clipId: "abc123",                                             │
│    voteCount: 1234,           // From Redis CRDT                 │
│    weightedScore: 1234,       // From Redis CRDT                 │
│    totalVotesToday: 45,       // From Redis daily counter        │
│    remainingVotes: 155,       // 200 - 45                        │
│    responseTime: 8            // ms                              │
│  }                                                               │
│                                                                  │
│  Total round-trip: ~50-100ms (network) + 8ms (server) = ~60ms   │
└─────────────────────────────────────────────────────────────────┘

         ═══════════════ ASYNC (USER DOESN'T WAIT) ═══════════════

┌─────────────────────────────────────────────────────────────────┐
│  BACKGROUND: Queue Processor (every 1-5 seconds)                 │
│                                                                  │
│ 16. Dequeue 100-500 vote events from Redis                       │
│ 17. Batch INSERT into PostgreSQL votes table                     │
│     (triggers DISABLED, no row locks)                            │
│ 18. Track affected clip IDs                                      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKGROUND: Counter Sync (every 5-10 seconds)                   │
│                                                                  │
│ 19. For each affected clip:                                      │
│     Read CRDT counter from Redis                                 │
│     UPDATE tournament_clips SET vote_count = X                   │
│                                                                  │
│ Purpose: PostgreSQL stays consistent for leaderboards,           │
│          analytics, season advancement, and data persistence     │
└─────────────────────────────────────────────────────────────────┘
```

### New Data Flow: View Vote Counts (Other Users)

```
OTHER USER OPENS VOTING ARENA
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  GET /api/vote                                                   │
│                                                                  │
│  1. Fetch clips from DB or cache (unchanged)                     │
│  2. For each clip: GET vote count from Redis CRDT   (batch)      │
│  3. Merge Redis counts into clip data                            │
│  4. Return with fresh counts                                     │
│                                                                  │
│  Vote counts are 0-5 seconds stale (Redis CRDT update delay)    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  REAL-TIME UPDATES (while viewing)                               │
│                                                                  │
│  Option A: Pusher WebSocket (recommended)                        │
│  ├── Subscribe to 'clip-{clipId}' channel                        │
│  ├── On 'vote' event: update vote_count in React Query cache     │
│  └── All viewers see updates within 1-2 seconds                  │
│                                                                  │
│  Option B: Re-enable Supabase Realtime                           │
│  ├── Subscribe to postgres_changes on tournament_clips            │
│  ├── On UPDATE: merge new vote_count                             │
│  └── Depends on counter sync frequency (5-10s stale)             │
│                                                                  │
│  Option C: Polling (simplest)                                    │
│  ├── Refetch every 10 seconds while user is on voting page       │
│  ├── React Query: refetchInterval: 10000                         │
│  └── Simple but adds server load                                 │
└─────────────────────────────────────────────────────────────────┘
```

### New Data Flow: Remove Vote

```
USER TAPS REVOKE VOTE
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  FRONTEND                                                        │
│  1. onMutate: Optimistic -1 on vote_count              (0ms)    │
│  2. DELETE /api/vote { clipId }                        (async)   │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  ORIGIN                                                          │
│                                                                  │
│  3. Redis: Verify vote exists                          (0.5ms)   │
│     EXISTS voted:{voterKey}:{clipId}                             │
│                                                                  │
│  4. Redis: Decrement CRDT counter                      (1ms)     │
│     HINCRBY crdt:{clipId}:n {nodeId} 1                           │
│                                                                  │
│  5. Redis: Remove vote record                          (0.5ms)   │
│     DEL voted:{voterKey}:{clipId}                                │
│     DECRBY daily_votes:{date}:{voterKey} 1                       │
│                                                                  │
│  6. Redis: Enqueue removal event                       (1ms)     │
│     LPUSH vote_queue {removeEventJSON}                           │
│                                                                  │
│  7. Pusher: Broadcast count update                     (async)   │
│                                                                  │
│  Total: ~4ms                                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Consistency Model

### What Users See

| User Type | Action | Sees | Delay |
|-----------|--------|------|-------|
| **Voter** (self) | Casts vote | +1 immediately | 0ms (optimistic UI) |
| **Voter** (self) | Refreshes page | Correct count from Redis | ~50ms |
| **Other viewer** (WebSocket) | Someone votes | Count updates live | 1-2 seconds |
| **Other viewer** (no WebSocket) | Opens page | Count from Redis | 0-5 seconds stale |
| **Leaderboard** | Views rankings | Aggregated from DB | 5-10 seconds stale |
| **Admin** | Views analytics | Full DB data | 5-10 seconds stale |

### Consistency Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| No duplicate votes | Redis `voted:{voter}:{clip}` + DB `UNIQUE` constraint |
| No negative counts | CRDT PN-Counter (P always >= N by design) |
| Daily limit accuracy | Redis atomic `INCRBY` with TTL |
| Vote persistence | Queue → batch DB insert (eventual) |
| Counter accuracy | CRDT auto-converges + periodic DB sync |
| Crash recovery | Redis persistence + DB is source of truth for recovery |

### Recovery Scenarios

| Scenario | Recovery |
|----------|----------|
| Redis crashes | Rebuild counters from PostgreSQL votes table |
| Queue processor dies | Votes stay in Redis queue, processor restarts |
| DB down | Votes queue in Redis, sync when DB recovers |
| Vercel cold start | No state to lose (stateless functions) |
| Double vote attempt | Redis dedup + DB unique constraint |

---

## Component Breakdown

### Infrastructure Required

| Component | Service | Plan | Purpose |
|-----------|---------|------|---------|
| Database | Supabase | Pro ($25/mo) | Vote persistence, leaderboards, analytics |
| Connection Pooling | Supabase PgBouncer | Pro (included) | 200+ connections for batch processing |
| Redis (counters + queue) | Upstash | Pro ($10/mo) | CRDT counters, daily limits, dedup, queue |
| WebSocket | Pusher | Free (200 connections) | Real-time vote broadcasts |
| Edge Rate Limiting | Cloudflare Workers | Free (100K req/day) | Token bucket at edge |
| Cron/Queue Processing | QStash or Vercel Cron | $1-5/mo | Trigger batch processing |

**Total: ~$36-40/month** for TikTok-like experience

### Files to Create

```
src/lib/crdt-vote-counter.ts       # CRDT PN-Counter for vote counts
src/lib/vote-event-queue.ts        # Redis event queue (enqueue/dequeue)
src/lib/daily-vote-cache.ts        # Redis daily limit tracking
src/lib/vote-dedup.ts              # Redis duplicate vote detection
src/lib/realtime-vote-broadcast.ts # Pusher broadcasting
src/app/api/cron/process-votes/route.ts     # Queue processor
src/app/api/cron/sync-counters/route.ts     # Counter sync to DB
supabase/sql/disable-vote-triggers.sql      # Disable triggers
supabase/sql/batch-insert-votes.sql         # Batch insert RPC
cloudflare-worker/rate-limit.js             # Edge rate limiting
```

### Files to Modify

```
src/app/api/vote/route.ts           # New write path (Redis → queue)
src/app/api/vote/route.ts           # New read path (Redis counters)
src/app/dashboard/page.tsx          # Add WebSocket vote listener
src/lib/rate-limit.ts              # Fail-closed fallback
vercel.json                         # Add cron entries
```

### Files Unchanged

```
src/app/dashboard/page.tsx          # Optimistic updates (already TikTok-like)
src/lib/device-fingerprint.ts       # Device fingerprinting stays
src/hooks/useRealtimeClips.ts       # May re-enable or replace with Pusher
All UI components                    # Frontend experience unchanged
```

---

## Performance Expectations

### Response Times

| Operation | Current | TikTok-Style | Improvement |
|-----------|---------|--------------|-------------|
| Cast vote (server) | 100-500ms | 6-8ms | **94-98%** |
| Cast vote (user perceived) | ~0ms* | ~0ms* | Same (optimistic) |
| Remove vote (server) | 80-200ms | 4ms | **95-98%** |
| Get vote count | 50ms (DB) | 1ms (Redis) | **98%** |
| Daily limit check | 50ms (DB) | 0.5ms (Redis) | **99%** |
| Duplicate check | 50ms (DB) | 0.5ms (Redis) | **99%** |

*Both use optimistic updates, so perceived latency is 0ms for the voter.

### Throughput

| Metric | Current | TikTok-Style | Improvement |
|--------|---------|--------------|-------------|
| Concurrent votes | ~100 | 1,000,000+ | **10,000x** |
| Votes/second | ~50 | 100,000+ | **2,000x** |
| DB writes/second | 50 (one per vote) | 500 (batched) | **10x efficiency** |
| DB reads for counts | 50/sec | 0 (Redis) | **100%** |
| Connection usage | 3-4 per vote | 0.002 per vote (batched) | **99.95%** |

### Real-Time Update Latency

| Method | Latency | Reliability |
|--------|---------|-------------|
| Pusher WebSocket | 100-500ms | 99.9% |
| Supabase Realtime | 500-2000ms | Currently broken |
| Polling (10s) | Up to 10s | 100% |
| **Recommended: Pusher + polling fallback** | **100-500ms** | **99.99%** |

---

## Edge Cases Analyzed

### Edge Case 1: Vote During Redis Outage

```
Redis down → Fail-closed rate limiting blocks requests → 503 response
           → Frontend retries 3x → Shows "Vote failed, try again"
           → Queue processor pauses → Resumes when Redis recovers
           → No data loss (votes were never accepted)
```

### Edge Case 2: Queue Processor Lag

```
1M votes burst → Queue grows to 500,000 entries
              → Processor drains at 500/batch × 10 batches/sec = 5,000/sec
              → Queue drained in ~100 seconds
              → During this time: Redis counters accurate, DB 100s behind
              → Users see correct counts (from Redis), DB catches up
```

### Edge Case 3: Slot Transitions During Voting

```
Voting ends on Slot 3 → Auto-advance cron runs
                       → Winner selected based on DB vote_count
                       → But DB might be 5-10s behind Redis!

SOLUTION: Before slot transition, sync counters:
1. Cron signals "slot ending"
2. Force counter sync (Redis → DB)
3. Wait for sync confirmation
4. Then select winner based on accurate DB counts
```

### Edge Case 4: User Votes, Immediately Navigates Away, Returns

```
Vote cast → Redis records it → Queue pending
User leaves → Returns 2 minutes later
GET /api/vote → Check Redis voted:{voter}:{clip} → "yes"
             → Show as voted (has_voted: true)
             → Count from Redis CRDT (accurate)
             → Even if DB INSERT hasn't happened yet
```

### Edge Case 5: Server Crash Mid-Vote

```
Step 11 (Redis CRDT increment) succeeds
Step 13 (queue enqueue) fails (crash)

RESULT: Redis counter is +1, but no queue entry
       → Count shows correctly in Redis
       → DB never gets this vote
       → Counter sync will read Redis (correct) and write to DB

SOLUTION: Counter sync always makes DB match Redis, not the other way.
          Redis is source of truth during active voting.
```

### Edge Case 6: Exactly-Once Vote Processing

```
Queue processor crashes after dequeue but before DB insert

With RPOPLPUSH pattern:
1. RPOPLPUSH vote_queue → processing_queue (atomic)
2. Batch insert to DB
3. Remove from processing_queue (acknowledge)

If crash at step 2:
→ Vote still in processing_queue
→ Recovery job moves it back to vote_queue
→ Re-processed (DB unique constraint prevents duplicate)
```

---

## Migration Strategy

### Zero-Downtime Migration

```
Phase A: Deploy new code (dual-write mode)
├── New vote API writes to BOTH Redis AND DB (via trigger)
├── New GET reads from Redis with DB fallback
├── Both systems produce same results
└── Verify: Redis counts match DB counts

Phase B: Switch primary to Redis
├── Disable vote triggers
├── Votes go to Redis queue only
├── Queue processor writes to DB
├── Verify: Queue processing keeps up

Phase C: Enable real-time broadcasts
├── Enable Pusher broadcasting
├── Add WebSocket listener in frontend
├── Verify: All viewers see updates

Phase D: Remove legacy code
├── Remove trigger-related code paths
├── Remove direct DB write paths
├── Clean up unused caches
```

---

## Final Architecture Summary

```
┌──────────────────────────────────────────────────────────────────────┐
│                         USER DEVICE                                   │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ React Query + Optimistic Updates + WebSocket Listener          │  │
│  │ Vote: instant +1 → API call → Server confirms                 │  │
│  │ View: Redis count → WebSocket pushes live updates              │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE EDGE (200+ locations)                    │
│  Token Bucket Rate Limit + JWT Validation                             │
│  Blocks abuse before reaching origin                                  │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    VERCEL API (stateless)                              │
│  6-8ms total:                                                         │
│  Redis daily limit (0.5ms) → Redis dedup (0.5ms) → Validate (1ms)   │
│  → CRDT counter +1 (1ms) → Queue event (1ms) → Broadcast (async)    │
│  → Return response                                                    │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                        ┌───────────┼───────────┐
                        ▼           ▼           ▼
               ┌──────────────┐ ┌───────┐ ┌──────────┐
               │   UPSTASH    │ │PUSHER │ │  QUEUE   │
               │    REDIS     │ │       │ │          │
               │ ┌──────────┐ │ │Broad- │ │vote_queue│
               │ │CRDT Count│ │ │cast   │ │  (Redis) │
               │ │Daily Lmt │ │ │vote   │ │          │
               │ │Dedup Set │ │ │events │ │          │
               │ └──────────┘ │ └───────┘ └──────────┘
               └──────────────┘               │
                                              ▼
                                    ┌──────────────────┐
                                    │ QUEUE PROCESSOR   │
                                    │ (every 1-5 sec)   │
                                    │                   │
                                    │ Batch INSERT      │
                                    │ 100-500 votes     │
                                    │ per transaction   │
                                    └──────────────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │   POSTGRESQL     │
                                    │   (Supabase)     │
                                    │                  │
                                    │ votes table      │
                                    │ tournament_clips │
                                    │ leaderboards     │
                                    │ analytics        │
                                    └──────────────────┘
```

---

*Document created: January 2026*
*Author: AiMoviez Engineering Team*