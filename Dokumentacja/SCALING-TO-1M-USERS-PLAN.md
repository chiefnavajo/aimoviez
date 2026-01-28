# AiMoviez Scaling Plan: 1,000,000 Users & Concurrent Votes

## Executive Summary

This document outlines the complete technical roadmap to scale AiMoviez from its current capacity (~100 concurrent voters) to 1,000,000 concurrent users and votes. The plan is organized into four phases, each unlocking a specific scale tier. Total estimated implementation time: 4-6 weeks.

**Current State:**
- ~100 concurrent votes sustainable
- 3 DB connections (Free tier)
- Synchronous write path with hot row locks
- Single-region deployment

**Target State:**
- 1,000,000 concurrent votes
- Distributed database with sharding
- Async write queue with batch processing
- Multi-region edge deployment
- Eventually consistent reads

---

## Phase 1: Foundation (10,000 Concurrent Votes)

**Timeline:** Week 1 (3-4 days)
**Cost increase:** ~$35/month

### 1.1 Enable PgBouncer Connection Pooling

**Problem:** Each serverless function creates a new DB connection. Free tier has 3 connections, Pro has 50.

**Solution:** Use Supabase's PgBouncer pooler endpoint.

**Implementation:**

1. Upgrade to Supabase Pro ($25/month)

2. Update environment variable:
```env
# .env.local
# Change from direct connection (port 5432) to pooler (port 6543)
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
```

3. Update Supabase client configuration:
```typescript
// src/lib/supabase-client.ts
import { createClient } from '@supabase/supabase-js';

// For API routes - use pooled connection
export function createPooledClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: {
        schema: 'public',
      },
      auth: {
        persistSession: false,
      },
    }
  );
}
```

**Files to modify:**
- `.env.local` / `.env.production`
- `src/lib/supabase-client.ts`
- `src/app/api/vote/route.ts`

**Impact:** 50 physical connections → 200+ logical sessions

---

### 1.2 Disable Per-Vote Trigger, Implement Batch Counter Updates

**Problem:** The `on_vote_insert` trigger updates `tournament_clips.vote_count` on every INSERT, creating a hot row that serializes all votes for the same clip.

**Solution:** Disable the trigger, run batch counter updates every 5-10 seconds via cron.

**Implementation:**

1. Create migration to disable triggers:
```sql
-- supabase/sql/phase1-disable-vote-triggers.sql

-- Disable the per-vote triggers
ALTER TABLE votes DISABLE TRIGGER on_vote_insert;
ALTER TABLE votes DISABLE TRIGGER on_vote_delete;

-- Create batch update function
CREATE OR REPLACE FUNCTION batch_update_vote_counts(p_interval_seconds INTEGER DEFAULT 30)
RETURNS TABLE (clips_updated INTEGER, execution_time_ms INTEGER) AS $$
DECLARE
  v_start TIMESTAMP := clock_timestamp();
  v_count INTEGER;
BEGIN
  -- Update vote counts for clips with recent activity
  WITH recent_clips AS (
    SELECT DISTINCT clip_id
    FROM votes
    WHERE created_at > NOW() - (p_interval_seconds || ' seconds')::INTERVAL
  ),
  vote_totals AS (
    SELECT
      v.clip_id,
      COUNT(*) as total_votes,
      COALESCE(SUM(v.vote_weight), 0) as total_weighted
    FROM votes v
    WHERE v.clip_id IN (SELECT clip_id FROM recent_clips)
    GROUP BY v.clip_id
  )
  UPDATE tournament_clips tc
  SET
    vote_count = vt.total_votes,
    weighted_score = vt.total_weighted
  FROM vote_totals vt
  WHERE tc.id = vt.clip_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN QUERY SELECT
    v_count,
    (EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start))::INTEGER;
END;
$$ LANGUAGE plpgsql;

-- Also create a full recount function for consistency checks
CREATE OR REPLACE FUNCTION full_recount_vote_counts()
RETURNS TABLE (clips_updated INTEGER) AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE tournament_clips tc
  SET
    vote_count = COALESCE(sub.cnt, 0),
    weighted_score = COALESCE(sub.ws, 0)
  FROM (
    SELECT
      clip_id,
      COUNT(*) as cnt,
      SUM(vote_weight) as ws
    FROM votes
    GROUP BY clip_id
  ) sub
  WHERE tc.id = sub.clip_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$ LANGUAGE plpgsql;
```

2. Create cron endpoint:
```typescript
// src/app/api/cron/update-vote-counts/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startTime = Date.now();

  const { data, error } = await supabase.rpc('batch_update_vote_counts', {
    p_interval_seconds: 30
  });

  if (error) {
    console.error('[cron/update-vote-counts] Error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }

  const duration = Date.now() - startTime;
  console.log(`[cron/update-vote-counts] Updated ${data?.[0]?.clips_updated || 0} clips in ${duration}ms`);

  return Response.json({
    success: true,
    clipsUpdated: data?.[0]?.clips_updated || 0,
    executionTimeMs: duration,
  });
}
```

3. Configure Vercel cron:
```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/update-vote-counts",
      "schedule": "*/10 * * * * *"
    }
  ]
}
```

Note: Vercel cron minimum is 1 minute. For 5-10 second intervals, use:
- Upstash QStash (recommended): https://upstash.com/docs/qstash
- Or external cron service (cron-job.org, EasyCron)

4. QStash implementation for 10-second intervals:
```typescript
// src/app/api/qstash/vote-counts/route.ts
import { verifySignatureAppRouter } from '@upstash/qstash/dist/nextjs';
import { createClient } from '@supabase/supabase-js';

async function handler() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await supabase.rpc('batch_update_vote_counts', { p_interval_seconds: 15 });

  return Response.json({ success: true });
}

export const POST = verifySignatureAppRouter(handler);
```

**Files to create:**
- `supabase/sql/phase1-disable-vote-triggers.sql`
- `src/app/api/cron/update-vote-counts/route.ts`
- `src/app/api/qstash/vote-counts/route.ts` (if using QStash)

**Files to modify:**
- `vercel.json`

**Impact:** Eliminates hot row serialization. 10,000 votes can insert in parallel.

---

### 1.3 Implement Fail-Closed Rate Limiting

**Problem:** When Redis is unavailable, the in-memory fallback is per-instance, providing no real rate limiting on serverless.

**Solution:** Reject requests when Redis is down instead of using broken fallback.

**Implementation:**

```typescript
// src/lib/rate-limit.ts

// Find the fallback logic (around line 145-175) and replace:

// OLD (fail-open):
if (!redis) {
  return checkInMemoryLimit(identifier, type);
}

// NEW (fail-closed):
if (!redis) {
  console.error('[rate-limit] Redis unavailable, rejecting request (fail-closed)');
  return {
    success: false,
    limit: RATE_LIMITS[type].requests,
    remaining: 0,
    reset: Date.now() + 60000,
    error: 'REDIS_UNAVAILABLE',
  };
}

// Also add a health check endpoint for monitoring:
// src/app/api/health/redis/route.ts
export async function GET() {
  try {
    const redis = getRedisClient();
    if (!redis) {
      return Response.json({ healthy: false, error: 'Not configured' }, { status: 503 });
    }
    await redis.ping();
    return Response.json({ healthy: true });
  } catch (error) {
    return Response.json({ healthy: false, error: String(error) }, { status: 503 });
  }
}
```

**Files to modify:**
- `src/lib/rate-limit.ts`

**Files to create:**
- `src/app/api/health/redis/route.ts`

**Impact:** Prevents unlimited bot voting during Redis downtime.

---

### 1.4 Upgrade Upstash Redis

**Problem:** Free tier: 100 commands/sec. With 3 commands per rate limit check, max ~33 checks/sec.

**Solution:** Upgrade to Upstash Pro ($10/month) for 1,000+ commands/sec.

**Implementation:**
1. Upgrade plan at https://console.upstash.com
2. No code changes required

**Impact:** 10x rate limiting throughput.

---

### Phase 1 Checklist

- [ ] Upgrade Supabase to Pro ($25/month)
- [ ] Enable PgBouncer connection pooling
- [ ] Create and run `phase1-disable-vote-triggers.sql`
- [ ] Create vote count update cron endpoint
- [ ] Set up QStash for 10-second intervals (or use Vercel cron)
- [ ] Implement fail-closed rate limiting
- [ ] Upgrade Upstash to Pro ($10/month)
- [ ] Test with load testing tool (k6, artillery)

**Phase 1 Total Cost:** ~$35/month additional
**Phase 1 Capacity:** ~10,000 concurrent votes

---

## Phase 2: Write Decoupling (100,000 Concurrent Votes)

**Timeline:** Week 2-3 (5-7 days)
**Cost increase:** ~$50-100/month additional

### 2.1 Implement Vote Queue (Redis-based)

**Problem:** Every vote is a synchronous database INSERT. Under burst traffic, the database becomes the bottleneck.

**Solution:** Accept votes into a Redis queue, return immediately, process in background.

**Implementation:**

1. Create vote queue types:
```typescript
// src/types/vote-queue.ts
export interface QueuedVote {
  clipId: string;
  voterKey: string;
  userId: string | null;
  voteWeight: number;
  voteType: 'standard' | 'super' | 'mega';
  slotPosition: number;
  seasonId: string;
  flagged: boolean;
  timestamp: number;
  requestId: string; // For deduplication
}

export interface VoteQueueStats {
  queueLength: number;
  processedLastMinute: number;
  failedLastMinute: number;
}
```

2. Create queue service:
```typescript
// src/lib/vote-queue.ts
import { Redis } from '@upstash/redis';
import { QueuedVote } from '@/types/vote-queue';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VOTE_QUEUE_KEY = 'vote_queue:pending';
const VOTE_PROCESSING_KEY = 'vote_queue:processing';
const VOTE_DEDUP_PREFIX = 'vote_dedup:';

export async function enqueueVote(vote: QueuedVote): Promise<{ queued: boolean; position: number }> {
  // Check for duplicate (same voter + clip within 60 seconds)
  const dedupKey = `${VOTE_DEDUP_PREFIX}${vote.voterKey}:${vote.clipId}`;
  const existing = await redis.get(dedupKey);

  if (existing) {
    return { queued: false, position: -1 };
  }

  // Set dedup key with 60-second expiry
  await redis.set(dedupKey, '1', { ex: 60 });

  // Add to queue
  const position = await redis.lpush(VOTE_QUEUE_KEY, JSON.stringify(vote));

  return { queued: true, position };
}

export async function dequeueVotes(batchSize: number = 100): Promise<QueuedVote[]> {
  const votes: QueuedVote[] = [];

  for (let i = 0; i < batchSize; i++) {
    // Move from pending to processing (atomic)
    const voteStr = await redis.rpoplpush(VOTE_QUEUE_KEY, VOTE_PROCESSING_KEY);
    if (!voteStr) break;

    try {
      votes.push(JSON.parse(voteStr as string));
    } catch (e) {
      console.error('[vote-queue] Failed to parse vote:', voteStr);
    }
  }

  return votes;
}

export async function acknowledgeVotes(votes: QueuedVote[]): Promise<void> {
  // Remove processed votes from processing queue
  for (const vote of votes) {
    await redis.lrem(VOTE_PROCESSING_KEY, 1, JSON.stringify(vote));
  }
}

export async function requeueFailedVotes(): Promise<number> {
  // Move any stuck votes from processing back to pending
  let count = 0;
  while (true) {
    const vote = await redis.rpoplpush(VOTE_PROCESSING_KEY, VOTE_QUEUE_KEY);
    if (!vote) break;
    count++;
  }
  return count;
}

export async function getQueueStats(): Promise<VoteQueueStats> {
  const [queueLength, processingLength] = await Promise.all([
    redis.llen(VOTE_QUEUE_KEY),
    redis.llen(VOTE_PROCESSING_KEY),
  ]);

  return {
    queueLength: queueLength + processingLength,
    processedLastMinute: 0, // TODO: implement counter
    failedLastMinute: 0,
  };
}
```

3. Modify vote API to use queue:
```typescript
// src/app/api/vote/route.ts (modifications to POST handler)

import { enqueueVote } from '@/lib/vote-queue';
import { nanoid } from 'nanoid';

// Inside POST handler, replace the insert_vote_atomic call:

// OLD:
// const { data: voteResult, error: voteError } = await supabase.rpc('insert_vote_atomic', { ... });

// NEW:
const { queued, position } = await enqueueVote({
  clipId,
  voterKey: effectiveVoterKey,
  userId: loggedInUserId,
  voteWeight: 1,
  voteType: 'standard',
  slotPosition: activeSlot.slot_position,
  seasonId: activeSlot.season_id,
  flagged: voteRisk.flagged,
  timestamp: Date.now(),
  requestId: nanoid(),
});

if (!queued) {
  return Response.json(
    { success: false, error: 'ALREADY_VOTED', message: 'Vote already submitted' },
    { status: 409 }
  );
}

// Return immediately - vote will be processed async
return Response.json({
  success: true,
  queued: true,
  queuePosition: position,
  clipId,
  message: 'Vote accepted and queued for processing',
  // Note: exact vote count not available immediately
  estimatedProcessingTime: '5-15 seconds',
});
```

4. Create queue processor:
```typescript
// src/app/api/cron/process-vote-queue/route.ts
import { createClient } from '@supabase/supabase-js';
import { dequeueVotes, acknowledgeVotes } from '@/lib/vote-queue';
import { QueuedVote } from '@/types/vote-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 60 second max execution

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalFailed = 0;

  // Process in batches until queue is empty or time limit approached
  while (Date.now() - startTime < 50000) { // 50s limit (leave 10s buffer)
    const votes = await dequeueVotes(100);

    if (votes.length === 0) {
      break; // Queue empty
    }

    const { inserted, failed } = await processBatch(supabase, votes);
    totalProcessed += inserted;
    totalFailed += failed;

    await acknowledgeVotes(votes);
  }

  return Response.json({
    success: true,
    processed: totalProcessed,
    failed: totalFailed,
    executionTimeMs: Date.now() - startTime,
  });
}

async function processBatch(
  supabase: ReturnType<typeof createClient>,
  votes: QueuedVote[]
): Promise<{ inserted: number; failed: number }> {
  // Use batch insert RPC
  const { data, error } = await supabase.rpc('batch_insert_votes', {
    p_votes: votes.map(v => ({
      clip_id: v.clipId,
      voter_key: v.voterKey,
      user_id: v.userId,
      vote_weight: v.voteWeight,
      vote_type: v.voteType,
      slot_position: v.slotPosition,
      flagged: v.flagged,
      created_at: new Date(v.timestamp).toISOString(),
    })),
  });

  if (error) {
    console.error('[process-vote-queue] Batch insert error:', error);
    return { inserted: 0, failed: votes.length };
  }

  return {
    inserted: data?.inserted || votes.length,
    failed: data?.duplicates || 0,
  };
}
```

5. Create batch insert RPC:
```sql
-- supabase/sql/phase2-batch-insert-votes.sql

CREATE OR REPLACE FUNCTION batch_insert_votes(p_votes JSONB)
RETURNS TABLE (inserted INTEGER, duplicates INTEGER) AS $$
DECLARE
  v JSONB;
  v_inserted INTEGER := 0;
  v_duplicates INTEGER := 0;
BEGIN
  FOR v IN SELECT * FROM jsonb_array_elements(p_votes)
  LOOP
    BEGIN
      INSERT INTO votes (
        clip_id,
        voter_key,
        user_id,
        vote_weight,
        vote_type,
        slot_position,
        flagged,
        created_at
      ) VALUES (
        (v->>'clip_id')::UUID,
        v->>'voter_key',
        NULLIF(v->>'user_id', '')::UUID,
        COALESCE((v->>'vote_weight')::INTEGER, 1),
        COALESCE(v->>'vote_type', 'standard'),
        (v->>'slot_position')::INTEGER,
        COALESCE((v->>'flagged')::BOOLEAN, FALSE),
        COALESCE((v->>'created_at')::TIMESTAMPTZ, NOW())
      );
      v_inserted := v_inserted + 1;
    EXCEPTION
      WHEN unique_violation THEN
        v_duplicates := v_duplicates + 1;
      WHEN OTHERS THEN
        RAISE WARNING 'Failed to insert vote: %', SQLERRM;
        v_duplicates := v_duplicates + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_duplicates;
END;
$$ LANGUAGE plpgsql;
```

**Files to create:**
- `src/types/vote-queue.ts`
- `src/lib/vote-queue.ts`
- `src/app/api/cron/process-vote-queue/route.ts`
- `supabase/sql/phase2-batch-insert-votes.sql`

**Files to modify:**
- `src/app/api/vote/route.ts`

**Impact:** API responds in ~10-20ms. Database writes happen in background. Can absorb 100K vote burst.

---

### 2.2 Cache Daily Vote Limits in Redis

**Problem:** `getUserVotesToday` query runs before every vote, hitting the database.

**Solution:** Track daily vote counts in Redis, only hit DB on cache miss.

**Implementation:**

```typescript
// src/lib/daily-vote-cache.ts
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const DAILY_VOTES_PREFIX = 'daily_votes:';
const DAILY_VOTE_LIMIT = 200;

function getDailyKey(voterKey: string): string {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `${DAILY_VOTES_PREFIX}${today}:${voterKey}`;
}

export async function getDailyVoteCount(voterKey: string): Promise<number> {
  const key = getDailyKey(voterKey);
  const count = await redis.get<number>(key);
  return count || 0;
}

export async function incrementDailyVoteCount(voterKey: string, weight: number = 1): Promise<number> {
  const key = getDailyKey(voterKey);

  // Increment and set expiry (25 hours to cover timezone edge cases)
  const newCount = await redis.incrby(key, weight);
  await redis.expire(key, 90000); // 25 hours

  return newCount;
}

export async function canVote(voterKey: string, weight: number = 1): Promise<{
  allowed: boolean;
  currentCount: number;
  remaining: number;
}> {
  const currentCount = await getDailyVoteCount(voterKey);
  const allowed = currentCount + weight <= DAILY_VOTE_LIMIT;

  return {
    allowed,
    currentCount,
    remaining: Math.max(0, DAILY_VOTE_LIMIT - currentCount),
  };
}

// Sync cache with DB (run periodically or on cache miss)
export async function syncDailyVoteCount(
  voterKey: string,
  supabase: any
): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('votes')
    .select('vote_weight')
    .eq('voter_key', voterKey)
    .gte('created_at', today.toISOString());

  if (error) {
    console.error('[daily-vote-cache] Sync error:', error);
    return 0;
  }

  const totalWeight = data.reduce((sum: number, v: any) => sum + (v.vote_weight || 1), 0);

  // Update cache
  const key = getDailyKey(voterKey);
  await redis.set(key, totalWeight, { ex: 90000 });

  return totalWeight;
}
```

Update vote API to use cache:
```typescript
// src/app/api/vote/route.ts (inside POST handler)

import { canVote, incrementDailyVoteCount, syncDailyVoteCount } from '@/lib/daily-vote-cache';

// Replace getUserVotesToday with:
let { allowed, currentCount, remaining } = await canVote(effectiveVoterKey, 1);

// On cache miss (currentCount === 0 for existing user), sync from DB
if (currentCount === 0) {
  const syncedCount = await syncDailyVoteCount(effectiveVoterKey, supabase);
  if (syncedCount > 0) {
    allowed = syncedCount + 1 <= 200;
    remaining = Math.max(0, 200 - syncedCount);
  }
}

if (!allowed) {
  return Response.json(
    { success: false, error: 'DAILY_LIMIT', remaining: 0 },
    { status: 429 }
  );
}

// After successful queue (not DB insert since it's async now):
await incrementDailyVoteCount(effectiveVoterKey, 1);
```

**Files to create:**
- `src/lib/daily-vote-cache.ts`

**Files to modify:**
- `src/app/api/vote/route.ts`

**Impact:** Removes daily limit query from hot path. Redis handles the load.

---

### 2.3 Read Replica for Heavy Queries

**Problem:** Leaderboard, profile stats, and clip fetching queries compete with writes on primary.

**Solution:** Route read-heavy queries to read replica.

**Implementation:**

1. Enable read replica on Supabase (Pro plan, additional cost)

2. Create read replica client:
```typescript
// src/lib/supabase-read-replica.ts
import { createClient } from '@supabase/supabase-js';

let readReplicaClient: ReturnType<typeof createClient> | null = null;

export function getReadReplicaClient() {
  if (!readReplicaClient) {
    const replicaUrl = process.env.SUPABASE_READ_REPLICA_URL;

    // Fall back to primary if replica not configured
    const url = replicaUrl || process.env.NEXT_PUBLIC_SUPABASE_URL!;

    readReplicaClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return readReplicaClient;
}
```

3. Use for read operations:
```typescript
// src/app/api/leaderboard/route.ts
import { getReadReplicaClient } from '@/lib/supabase-read-replica';

export async function GET(req: Request) {
  const supabase = getReadReplicaClient(); // Read from replica

  const { data } = await supabase.rpc('get_top_voters', { p_limit: 100 });
  // ...
}
```

**Files to create:**
- `src/lib/supabase-read-replica.ts`

**Files to modify:**
- `src/app/api/leaderboard/route.ts`
- `src/app/api/clips/route.ts`
- `src/app/api/profile/[userId]/stats/route.ts`

**Impact:** Read queries don't compete with writes. Effective 2x database capacity.

---

### Phase 2 Checklist

- [ ] Create vote queue types and service
- [ ] Create batch insert RPC (`phase2-batch-insert-votes.sql`)
- [ ] Modify vote API to use queue
- [ ] Create queue processor cron job
- [ ] Set up QStash for 5-second queue processing
- [ ] Implement Redis daily vote cache
- [ ] Configure read replica (if budget allows)
- [ ] Update read-heavy endpoints to use replica
- [ ] Load test with 10K-50K simulated votes

**Phase 2 Total Cost:** ~$50-100/month additional
**Phase 2 Capacity:** ~100,000 concurrent votes (burst), ~10,000 sustained

---

## Phase 3: Edge Distribution (500,000 Concurrent Votes)

**Timeline:** Week 3-4 (5-7 days)
**Cost increase:** ~$100-200/month additional

### 3.1 Cloudflare Edge Rate Limiting

**Problem:** Rate limiting at origin means 500K requests still hit your servers.

**Solution:** Move rate limiting to Cloudflare's edge network (200+ global locations).

**Implementation:**

1. Create Cloudflare Worker:
```javascript
// cloudflare-worker/rate-limit.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only rate limit vote endpoints
    if (url.pathname === '/api/vote' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const key = `rate:vote:${ip}`;

      // Use Cloudflare KV for distributed rate limiting
      const current = parseInt(await env.RATE_LIMITS.get(key) || '0');

      if (current >= 30) { // 30 votes per minute
        return new Response(JSON.stringify({
          error: 'RATE_LIMITED',
          message: 'Too many votes. Please wait.',
          retryAfter: 60,
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60',
            'X-RateLimit-Limit': '30',
            'X-RateLimit-Remaining': '0',
          },
        });
      }

      // Increment counter with 60-second expiry
      ctx.waitUntil(
        env.RATE_LIMITS.put(key, String(current + 1), { expirationTtl: 60 })
      );
    }

    // Forward to origin
    return fetch(request);
  },
};
```

2. Create wrangler.toml:
```toml
# cloudflare-worker/wrangler.toml
name = "aimoviez-rate-limiter"
main = "rate-limit.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "RATE_LIMITS"
id = "your-kv-namespace-id"
```

3. Deploy:
```bash
cd cloudflare-worker
npx wrangler publish
```

4. Configure Cloudflare DNS to route through worker.

**Files to create:**
- `cloudflare-worker/rate-limit.js`
- `cloudflare-worker/wrangler.toml`
- `cloudflare-worker/package.json`

**Impact:** Rate limiting happens at edge. Only valid requests reach origin.

---

### 3.2 Move Videos to Cloudflare R2 + CDN

**Problem:** Supabase Storage has limited bandwidth. Video delivery competes with API.

**Solution:** Use Cloudflare R2 (S3-compatible) with global CDN.

**Implementation:**

1. Create R2 bucket in Cloudflare dashboard

2. Update video storage provider:
```typescript
// src/lib/video-storage.ts (add R2 provider)
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export class R2StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor() {
    this.client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT!,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    this.bucket = process.env.R2_BUCKET!;
    this.publicUrl = process.env.R2_PUBLIC_URL!; // e.g., https://videos.aimoviez.com
  }

  async uploadVideo(file: Buffer, filename: string): Promise<string> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: `videos/${filename}`,
      Body: file,
      ContentType: 'video/mp4',
    }));

    return `${this.publicUrl}/videos/${filename}`;
  }

  async getSignedUploadUrl(filename: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: `videos/${filename}`,
      ContentType: 'video/mp4',
    });

    return getSignedUrl(this.client, command, { expiresIn: 3600 });
  }

  getPublicUrl(filename: string): string {
    return `${this.publicUrl}/videos/${filename}`;
  }
}
```

3. Configure R2 public access with custom domain

4. Migrate existing videos:
```typescript
// scripts/migrate-videos-to-r2.ts
// One-time migration script to copy videos from Supabase to R2
```

**Files to modify:**
- `src/lib/video-storage.ts`
- `.env.local` / `.env.production`

**Files to create:**
- `scripts/migrate-videos-to-r2.ts`

**Impact:** Unlimited video bandwidth at $0.015/GB. Global CDN delivery.

---

### 3.3 Multi-Region Vote Queues

**Problem:** Single Redis queue becomes a bottleneck at global scale.

**Solution:** Regional vote queues that aggregate to central processor.

**Implementation:**

```typescript
// src/lib/vote-queue-regional.ts
import { Redis } from '@upstash/redis';

// Create regional Redis instances
const regions = {
  'us-east': new Redis({ url: process.env.UPSTASH_REDIS_US_EAST!, token: process.env.UPSTASH_TOKEN_US_EAST! }),
  'eu-west': new Redis({ url: process.env.UPSTASH_REDIS_EU_WEST!, token: process.env.UPSTASH_TOKEN_EU_WEST! }),
  'apac': new Redis({ url: process.env.UPSTASH_REDIS_APAC!, token: process.env.UPSTASH_TOKEN_APAC! }),
};

function getRegion(req: Request): keyof typeof regions {
  const cf = (req as any).cf;
  if (cf?.continent === 'EU') return 'eu-west';
  if (cf?.continent === 'AS' || cf?.continent === 'OC') return 'apac';
  return 'us-east';
}

export async function enqueueVoteRegional(vote: QueuedVote, req: Request) {
  const region = getRegion(req);
  const redis = regions[region];

  await redis.lpush(`vote_queue:${region}`, JSON.stringify(vote));

  return { region };
}

// Central aggregator pulls from all regions
export async function dequeueVotesAllRegions(batchSize: number = 100): Promise<QueuedVote[]> {
  const votes: QueuedVote[] = [];
  const perRegion = Math.floor(batchSize / Object.keys(regions).length);

  for (const [regionName, redis] of Object.entries(regions)) {
    for (let i = 0; i < perRegion; i++) {
      const vote = await redis.rpop(`vote_queue:${regionName}`);
      if (!vote) break;
      votes.push(JSON.parse(vote as string));
    }
  }

  return votes;
}
```

**Files to create:**
- `src/lib/vote-queue-regional.ts`

**Files to modify:**
- `src/app/api/vote/route.ts`
- `src/app/api/cron/process-vote-queue/route.ts`

**Impact:** 3x vote acceptance capacity. Lower latency for global users.

---

### 3.4 Eventually Consistent Vote Display

**Problem:** Real-time vote counts require database queries on every page load.

**Solution:** Cache vote counts, update every 10-30 seconds. Display "~X votes" instead of exact counts.

**Implementation:**

```typescript
// src/lib/vote-count-cache.ts
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VOTE_COUNT_PREFIX = 'vote_count:';
const CACHE_TTL = 15; // 15 seconds

export async function getCachedVoteCount(clipId: string): Promise<number | null> {
  return redis.get<number>(`${VOTE_COUNT_PREFIX}${clipId}`);
}

export async function setCachedVoteCount(clipId: string, count: number): Promise<void> {
  await redis.set(`${VOTE_COUNT_PREFIX}${clipId}`, count, { ex: CACHE_TTL });
}

export async function getCachedVoteCounts(clipIds: string[]): Promise<Map<string, number>> {
  const keys = clipIds.map(id => `${VOTE_COUNT_PREFIX}${id}`);
  const values = await redis.mget<number[]>(...keys);

  const result = new Map<string, number>();
  clipIds.forEach((id, i) => {
    if (values[i] !== null) {
      result.set(id, values[i]);
    }
  });

  return result;
}

// Batch update cached counts from DB
export async function refreshVoteCounts(supabase: any, clipIds: string[]): Promise<void> {
  const { data } = await supabase
    .from('tournament_clips')
    .select('id, vote_count')
    .in('id', clipIds);

  if (data) {
    const pipeline = redis.pipeline();
    for (const clip of data) {
      pipeline.set(`${VOTE_COUNT_PREFIX}${clip.id}`, clip.vote_count, { ex: CACHE_TTL });
    }
    await pipeline.exec();
  }
}
```

Update clip fetching:
```typescript
// src/app/api/clips/route.ts
import { getCachedVoteCounts, refreshVoteCounts } from '@/lib/vote-count-cache';

export async function GET(req: Request) {
  // ... get clips from DB or cache ...

  const clipIds = clips.map(c => c.id);

  // Try cache first
  const cachedCounts = await getCachedVoteCounts(clipIds);

  // Find clips with missing cache
  const missingIds = clipIds.filter(id => !cachedCounts.has(id));

  if (missingIds.length > 0) {
    // Fetch and cache missing counts
    await refreshVoteCounts(supabase, missingIds);
    const newCounts = await getCachedVoteCounts(missingIds);
    newCounts.forEach((count, id) => cachedCounts.set(id, count));
  }

  // Merge cached counts into response
  const clipsWithCounts = clips.map(clip => ({
    ...clip,
    vote_count: cachedCounts.get(clip.id) ?? clip.vote_count,
    vote_count_approximate: true, // UI can show "~" prefix
  }));

  return Response.json(clipsWithCounts);
}
```

**Files to create:**
- `src/lib/vote-count-cache.ts`

**Files to modify:**
- `src/app/api/clips/route.ts`
- `src/app/api/vote/route.ts` (GET handler)
- UI components to show approximate counts

**Impact:** 90%+ reduction in database reads for vote counts.

---

### Phase 3 Checklist

- [ ] Create Cloudflare Worker for edge rate limiting
- [ ] Set up Cloudflare KV namespace
- [ ] Deploy worker and configure DNS routing
- [ ] Create R2 bucket and configure public access
- [ ] Implement R2 storage provider
- [ ] Migrate existing videos to R2
- [ ] Set up regional Upstash Redis instances
- [ ] Implement regional vote queue routing
- [ ] Create vote count caching layer
- [ ] Update UI to show approximate vote counts
- [ ] Load test with 100K-500K simulated requests

**Phase 3 Total Cost:** ~$100-200/month additional
**Phase 3 Capacity:** ~500,000 concurrent votes (burst), ~50,000 sustained

---

## Phase 4: Horizontal Scale (1,000,000+ Concurrent Votes)

**Timeline:** Week 5-6 (7-10 days)
**Cost increase:** ~$500-2,000/month additional

### 4.1 Database Sharding by Season

**Problem:** Single PostgreSQL instance can't handle 1M+ writes.

**Solution:** Shard database by season_id. Each shard handles ~100K concurrent votes.

**Implementation:**

1. Create shard routing logic:
```typescript
// src/lib/database-sharding.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface ShardConfig {
  url: string;
  seasonRange: [number, number]; // [start, end] season numbers
}

const SHARD_CONFIGS: ShardConfig[] = [
  { url: process.env.SHARD_1_URL!, seasonRange: [1, 50] },
  { url: process.env.SHARD_2_URL!, seasonRange: [51, 100] },
  { url: process.env.SHARD_3_URL!, seasonRange: [101, 150] },
  // Add more shards as needed
];

const shardClients: Map<string, SupabaseClient> = new Map();

function getShardClient(url: string): SupabaseClient {
  if (!shardClients.has(url)) {
    shardClients.set(url, createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!));
  }
  return shardClients.get(url)!;
}

export function getShardForSeason(seasonNumber: number): SupabaseClient {
  const config = SHARD_CONFIGS.find(
    s => seasonNumber >= s.seasonRange[0] && seasonNumber <= s.seasonRange[1]
  );

  if (!config) {
    // Default to first shard or throw error
    console.warn(`[sharding] No shard found for season ${seasonNumber}, using default`);
    return getShardClient(SHARD_CONFIGS[0].url);
  }

  return getShardClient(config.url);
}

export function getAllShards(): SupabaseClient[] {
  return SHARD_CONFIGS.map(c => getShardClient(c.url));
}

// For cross-shard queries (leaderboards, etc.)
export async function queryAllShards<T>(
  queryFn: (client: SupabaseClient) => Promise<T[]>
): Promise<T[]> {
  const results = await Promise.all(
    getAllShards().map(client => queryFn(client))
  );
  return results.flat();
}
```

2. Update vote processing to use shards:
```typescript
// src/app/api/cron/process-vote-queue/route.ts
import { getShardForSeason } from '@/lib/database-sharding';

async function processBatch(votes: QueuedVote[]): Promise<{ inserted: number; failed: number }> {
  // Group votes by season for shard routing
  const votesBySeason = new Map<string, QueuedVote[]>();

  for (const vote of votes) {
    const existing = votesBySeason.get(vote.seasonId) || [];
    existing.push(vote);
    votesBySeason.set(vote.seasonId, existing);
  }

  let totalInserted = 0;
  let totalFailed = 0;

  // Process each season's votes on its shard
  for (const [seasonId, seasonVotes] of votesBySeason) {
    const seasonNumber = extractSeasonNumber(seasonId); // Parse from ID
    const shard = getShardForSeason(seasonNumber);

    const { data, error } = await shard.rpc('batch_insert_votes', {
      p_votes: seasonVotes.map(v => ({
        clip_id: v.clipId,
        voter_key: v.voterKey,
        user_id: v.userId,
        vote_weight: v.voteWeight,
        vote_type: v.voteType,
        slot_position: v.slotPosition,
        flagged: v.flagged,
        created_at: new Date(v.timestamp).toISOString(),
      })),
    });

    if (error) {
      totalFailed += seasonVotes.length;
    } else {
      totalInserted += data?.inserted || seasonVotes.length;
      totalFailed += data?.duplicates || 0;
    }
  }

  return { inserted: totalInserted, failed: totalFailed };
}
```

3. Cross-shard leaderboard aggregation:
```typescript
// src/app/api/leaderboard/route.ts
import { queryAllShards } from '@/lib/database-sharding';

export async function GET(req: Request) {
  // Query all shards for top voters
  const allVoters = await queryAllShards(async (client) => {
    const { data } = await client.rpc('get_top_voters', { p_limit: 100 });
    return data || [];
  });

  // Merge and re-sort
  const merged = allVoters
    .reduce((acc, voter) => {
      const existing = acc.find(v => v.user_id === voter.user_id);
      if (existing) {
        existing.total_votes += voter.total_votes;
        existing.total_xp += voter.total_xp;
      } else {
        acc.push({ ...voter });
      }
      return acc;
    }, [] as typeof allVoters)
    .sort((a, b) => b.total_xp - a.total_xp)
    .slice(0, 100);

  return Response.json(merged);
}
```

**Files to create:**
- `src/lib/database-sharding.ts`

**Files to modify:**
- `src/app/api/cron/process-vote-queue/route.ts`
- `src/app/api/leaderboard/route.ts`
- All endpoints that query votes/clips tables

**Impact:** Linear scaling. 3 shards = 3x database capacity.

---

### 4.2 AWS SQS for Vote Queue

**Problem:** Redis lists have limits. Need proper message queue with guaranteed delivery.

**Solution:** Use AWS SQS for production vote queue.

**Implementation:**

```typescript
// src/lib/vote-queue-sqs.ts
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { QueuedVote } from '@/types/vote-queue';

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const QUEUE_URL = process.env.VOTE_QUEUE_SQS_URL!;

export async function enqueueVoteSQS(vote: QueuedVote): Promise<string> {
  const command = new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(vote),
    MessageGroupId: vote.seasonId, // FIFO grouping by season
    MessageDeduplicationId: `${vote.voterKey}:${vote.clipId}:${vote.timestamp}`,
  });

  const result = await sqs.send(command);
  return result.MessageId!;
}

export async function dequeueVotesSQS(maxMessages: number = 10): Promise<{
  votes: QueuedVote[];
  receiptHandles: string[];
}> {
  const command = new ReceiveMessageCommand({
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: Math.min(maxMessages, 10), // SQS max is 10
    WaitTimeSeconds: 5, // Long polling
    VisibilityTimeout: 60, // 60 seconds to process
  });

  const result = await sqs.send(command);

  const votes: QueuedVote[] = [];
  const receiptHandles: string[] = [];

  for (const message of result.Messages || []) {
    try {
      votes.push(JSON.parse(message.Body!));
      receiptHandles.push(message.ReceiptHandle!);
    } catch (e) {
      console.error('[sqs] Failed to parse message:', message.Body);
    }
  }

  return { votes, receiptHandles };
}

export async function acknowledgeVotesSQS(receiptHandles: string[]): Promise<void> {
  await Promise.all(
    receiptHandles.map(handle =>
      sqs.send(new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: handle,
      }))
    )
  );
}
```

**Files to create:**
- `src/lib/vote-queue-sqs.ts`

**Files to modify:**
- `src/app/api/vote/route.ts`
- `src/app/api/cron/process-vote-queue/route.ts`

**Impact:** Guaranteed delivery. Handles 1M+ messages. Auto-scales.

---

### 4.3 Dedicated Vote Processor Workers

**Problem:** Vercel cron has 60-second limit. Need continuous processing.

**Solution:** Deploy dedicated worker on Railway/Fly.io/AWS ECS.

**Implementation:**

```typescript
// worker/vote-processor.ts
import { dequeueVotesSQS, acknowledgeVotesSQS } from '../src/lib/vote-queue-sqs';
import { getShardForSeason } from '../src/lib/database-sharding';

const BATCH_SIZE = 100;
const POLL_INTERVAL = 1000; // 1 second

async function processVotes() {
  console.log('[worker] Starting vote processor...');

  while (true) {
    try {
      // Collect up to BATCH_SIZE votes
      const allVotes: QueuedVote[] = [];
      const allHandles: string[] = [];

      while (allVotes.length < BATCH_SIZE) {
        const { votes, receiptHandles } = await dequeueVotesSQS(10);
        if (votes.length === 0) break;

        allVotes.push(...votes);
        allHandles.push(...receiptHandles);
      }

      if (allVotes.length > 0) {
        console.log(`[worker] Processing ${allVotes.length} votes...`);

        // Process batch
        const { inserted, failed } = await processBatch(allVotes);

        // Acknowledge processed votes
        await acknowledgeVotesSQS(allHandles);

        console.log(`[worker] Processed: ${inserted} inserted, ${failed} failed`);
      } else {
        // No votes, wait before polling again
        await sleep(POLL_INTERVAL);
      }
    } catch (error) {
      console.error('[worker] Error processing votes:', error);
      await sleep(5000); // Wait 5s on error
    }
  }
}

async function processBatch(votes: QueuedVote[]): Promise<{ inserted: number; failed: number }> {
  // Same as Phase 4.1 implementation
  // Groups by season, routes to shards, batch inserts
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the worker
processVotes();
```

Create Dockerfile:
```dockerfile
# worker/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
CMD ["node", "dist/worker/vote-processor.js"]
```

**Files to create:**
- `worker/vote-processor.ts`
- `worker/Dockerfile`
- `worker/package.json`

**Impact:** Continuous vote processing. No cron limitations.

---

### 4.4 Global Load Balancing

**Problem:** Single origin for API requests.

**Solution:** Deploy API to multiple regions with global load balancer.

**Implementation options:**

1. **Vercel Edge Functions** - Already global
2. **Cloudflare Workers** - For custom routing
3. **AWS Global Accelerator** - For TCP-level routing

For Vercel (simplest):
```typescript
// src/app/api/vote/route.ts
export const runtime = 'edge'; // Deploy to all Vercel edge locations
```

For multi-region with custom routing:
```javascript
// cloudflare-worker/global-router.js
export default {
  async fetch(request, env) {
    const cf = request.cf;

    // Route to nearest origin based on continent
    const origins = {
      'NA': 'https://us-east.aimoviez.com',
      'SA': 'https://us-east.aimoviez.com',
      'EU': 'https://eu-west.aimoviez.com',
      'AF': 'https://eu-west.aimoviez.com',
      'AS': 'https://apac.aimoviez.com',
      'OC': 'https://apac.aimoviez.com',
    };

    const origin = origins[cf?.continent] || origins['NA'];

    const url = new URL(request.url);
    url.host = new URL(origin).host;

    return fetch(new Request(url, request));
  }
};
```

**Impact:** Lower latency globally. Regional failure isolation.

---

### Phase 4 Checklist

- [ ] Design sharding strategy (by season)
- [ ] Set up additional Supabase instances for shards
- [ ] Implement shard routing logic
- [ ] Update all database queries for sharding
- [ ] Create AWS SQS FIFO queue
- [ ] Implement SQS vote queue service
- [ ] Create dedicated vote processor worker
- [ ] Deploy worker to Railway/Fly.io/ECS
- [ ] Set up global load balancing
- [ ] Implement cross-shard aggregation for leaderboards
- [ ] Load test with 500K-1M simulated votes
- [ ] Set up monitoring and alerting
- [ ] Create runbook for operational procedures

**Phase 4 Total Cost:** ~$500-2,000/month additional
**Phase 4 Capacity:** ~1,000,000+ concurrent votes

---

## Summary: Complete Scaling Roadmap

```
Week 1: Phase 1 (Foundation)
├─ PgBouncer pooling
├─ Batch vote count updates
├─ Fail-closed rate limiting
└─ Upstash Pro
    → Capacity: 10,000 concurrent votes
    → Cost: +$35/month

Week 2-3: Phase 2 (Write Decoupling)
├─ Redis vote queue
├─ Batch insert RPC
├─ Daily vote cache
└─ Read replica
    → Capacity: 100,000 concurrent votes
    → Cost: +$50-100/month

Week 3-4: Phase 3 (Edge Distribution)
├─ Cloudflare edge rate limiting
├─ R2 video CDN
├─ Regional vote queues
└─ Eventually consistent reads
    → Capacity: 500,000 concurrent votes
    → Cost: +$100-200/month

Week 5-6: Phase 4 (Horizontal Scale)
├─ Database sharding
├─ AWS SQS queue
├─ Dedicated workers
└─ Global load balancing
    → Capacity: 1,000,000+ concurrent votes
    → Cost: +$500-2,000/month
```

---

## Monitoring & Observability

### Key Metrics to Track

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Vote queue depth | < 10,000 | > 50,000 |
| Vote processing latency | < 10s | > 30s |
| Database connections | < 80% | > 90% |
| Rate limit rejections | < 5% | > 20% |
| API p99 latency | < 500ms | > 2s |
| Error rate | < 0.1% | > 1% |

### Dashboards to Create

1. **Vote Pipeline Health**
   - Queue depth over time
   - Processing rate (votes/sec)
   - Insert success/failure ratio

2. **Database Performance**
   - Connection utilization per shard
   - Query latency percentiles
   - Lock wait times

3. **Rate Limiting**
   - Requests blocked at edge
   - Requests blocked at origin
   - Top blocked IPs

4. **User Experience**
   - Vote acceptance latency
   - Time to vote count update
   - Error rates by endpoint

---

## Rollback Procedures

### Phase 1 Rollback
```sql
-- Re-enable vote triggers
ALTER TABLE votes ENABLE TRIGGER on_vote_insert;
ALTER TABLE votes ENABLE TRIGGER on_vote_delete;

-- Run full recount
SELECT full_recount_vote_counts();
```

### Phase 2 Rollback
```typescript
// In vote API, revert to synchronous insert:
// Comment out queue logic, uncomment direct insert_vote_atomic call
```

### Phase 3-4 Rollback
- Cloudflare: Disable worker, route directly to origin
- Sharding: All queries default to primary shard
- SQS: Fall back to Redis queue

---

## Cost Projection

| Phase | Monthly Cost | Capacity |
|-------|-------------|----------|
| Current | ~$0 | ~100 |
| Phase 1 | +$35 | 10,000 |
| Phase 2 | +$50-100 | 100,000 |
| Phase 3 | +$100-200 | 500,000 |
| Phase 4 | +$500-2,000 | 1,000,000+ |
| **Total** | **$685-2,335/month** | **1,000,000+** |

---

*Document created: January 2026*
*Last updated: January 2026*
*Author: AiMoviez Engineering Team*