# Voting System Improvements V2: Advanced Patterns

## Executive Summary

This document presents advanced improvements and new ideas for the AiMoviez voting system, building on the TikTok-style architecture with cutting-edge distributed systems patterns.

**New Technologies Explored:**
- CRDT Counters (conflict-free distributed counting)
- Cloudflare Durable Objects (edge-native stateful computing)
- HyperLogLog (probabilistic unique counting)
- Write-Behind Cache with Redis
- Token Bucket rate limiting
- Bloom Filters for duplicate detection

---

## Improvement 1: CRDT PN-Counter (Better Than Sharded Counters)

### The Problem with Sharded Counters

Sharded counters work, but have limitations:
- Need to aggregate all shards for total (100 Redis calls)
- No built-in support for decrement (vote removal)
- Manual conflict resolution needed

### CRDT PN-Counter Solution

A **PN-Counter** (Positive-Negative Counter) is a mathematically proven data structure that:
- Handles both increments AND decrements
- Automatically converges across distributed systems
- Never has conflicts — guaranteed by math

```
PN-Counter = Two G-Counters (Grow-only Counters)

P-Counter (Positive/Increments):
  node_1: 500
  node_2: 300
  node_3: 450
  Total P = 1,250

N-Counter (Negative/Decrements):
  node_1: 10
  node_2: 5
  node_3: 8
  Total N = 23

Final Value = P - N = 1,250 - 23 = 1,227 votes
```

### Implementation

```typescript
// src/lib/crdt-vote-counter.ts

interface PNCounter {
  p: Map<string, number>;  // Increments per node
  n: Map<string, number>;  // Decrements per node
}

const NODE_ID = process.env.VERCEL_REGION || 'default';

class CRDTVoteCounter {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  private pKey(clipId: string) { return `crdt:${clipId}:p`; }
  private nKey(clipId: string) { return `crdt:${clipId}:n`; }

  /**
   * Increment vote count (add vote)
   */
  async increment(clipId: string): Promise<void> {
    await this.redis.hincrby(this.pKey(clipId), NODE_ID, 1);
  }

  /**
   * Decrement vote count (remove vote)
   */
  async decrement(clipId: string): Promise<void> {
    await this.redis.hincrby(this.nKey(clipId), NODE_ID, 1);
  }

  /**
   * Get current value (P - N)
   */
  async getValue(clipId: string): Promise<number> {
    const [pValues, nValues] = await Promise.all([
      this.redis.hgetall(this.pKey(clipId)),
      this.redis.hgetall(this.nKey(clipId)),
    ]);

    const pSum = Object.values(pValues || {}).reduce((a, b) => a + Number(b), 0);
    const nSum = Object.values(nValues || {}).reduce((a, b) => a + Number(b), 0);

    return pSum - nSum;
  }

  /**
   * Merge two counters (for replication/sync)
   * CRDT property: merge is commutative, associative, idempotent
   */
  async merge(clipId: string, otherP: Map<string, number>, otherN: Map<string, number>): Promise<void> {
    // For each node, take the MAX value (CRDT merge rule)
    for (const [node, value] of otherP) {
      const current = await this.redis.hget(this.pKey(clipId), node) || 0;
      if (value > Number(current)) {
        await this.redis.hset(this.pKey(clipId), node, value);
      }
    }
    for (const [node, value] of otherN) {
      const current = await this.redis.hget(this.nKey(clipId), node) || 0;
      if (value > Number(current)) {
        await this.redis.hset(this.nKey(clipId), node, value);
      }
    }
  }
}
```

### Why CRDT is Better

| Aspect | Sharded Counter | CRDT PN-Counter |
|--------|-----------------|-----------------|
| Decrement support | Manual, error-prone | Built-in |
| Multi-region sync | Complex | Automatic merge |
| Conflict resolution | Manual | Mathematically guaranteed |
| Network partition | Can diverge | Always converges |
| Code complexity | Medium | Low |

**Sources:** [CRDT Dictionary](https://www.iankduncan.com/engineering/2025-11-27-crdt-dictionary/), [Building Distributed Counters](https://dev.to/fedekau/crdts-and-distributed-consistency-part-1-building-a-distributed-counter-22d3)

---

## Improvement 2: Cloudflare Durable Objects (Edge-Native Voting)

### The Problem

Current architecture:
```
User (Tokyo) → Vercel (US-East) → Redis (US-East) → Response
               ↑
         ~200ms latency
```

### Durable Objects Solution

Run vote counters **at the edge**, close to users:

```
User (Tokyo) → Cloudflare Edge (Tokyo) → Durable Object (auto-migrates) → Response
               ↑
         ~20ms latency
```

Each **clip gets its own Durable Object** with:
- Built-in SQLite database
- WebSocket support for real-time updates
- Strong consistency within the object
- Automatic geographic migration

### Implementation

```typescript
// cloudflare-worker/vote-counter.ts

export class VoteCounterDO implements DurableObject {
  private state: DurableObjectState;
  private votes: Map<string, number> = new Map();
  private totalVotes: number = 0;
  private totalWeighted: number = 0;
  private connections: Set<WebSocket> = new Set();

  constructor(state: DurableObjectState) {
    this.state = state;
    // Load persisted state
    this.state.blockConcurrencyWhile(async () => {
      this.totalVotes = await this.state.storage.get('totalVotes') || 0;
      this.totalWeighted = await this.state.storage.get('totalWeighted') || 0;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade for real-time updates
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.handleWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    switch (url.pathname) {
      case '/vote':
        return this.handleVote(request);
      case '/unvote':
        return this.handleUnvote(request);
      case '/count':
        return this.handleGetCount();
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  private async handleVote(request: Request): Promise<Response> {
    const { voterKey, weight = 1 } = await request.json();

    // Check duplicate
    if (this.votes.has(voterKey)) {
      return Response.json({ error: 'ALREADY_VOTED' }, { status: 409 });
    }

    // Record vote
    this.votes.set(voterKey, weight);
    this.totalVotes++;
    this.totalWeighted += weight;

    // Persist to SQLite (async, doesn't block response)
    this.state.storage.put('totalVotes', this.totalVotes);
    this.state.storage.put('totalWeighted', this.totalWeighted);
    this.state.storage.put(`vote:${voterKey}`, weight);

    // Broadcast to all connected clients
    this.broadcast({
      type: 'vote_update',
      totalVotes: this.totalVotes,
      totalWeighted: this.totalWeighted,
    });

    return Response.json({
      success: true,
      totalVotes: this.totalVotes,
      totalWeighted: this.totalWeighted,
    });
  }

  private async handleUnvote(request: Request): Promise<Response> {
    const { voterKey } = await request.json();

    const weight = this.votes.get(voterKey);
    if (!weight) {
      return Response.json({ error: 'NOT_VOTED' }, { status: 404 });
    }

    this.votes.delete(voterKey);
    this.totalVotes--;
    this.totalWeighted -= weight;

    this.state.storage.put('totalVotes', this.totalVotes);
    this.state.storage.put('totalWeighted', this.totalWeighted);
    this.state.storage.delete(`vote:${voterKey}`);

    this.broadcast({
      type: 'vote_update',
      totalVotes: this.totalVotes,
      totalWeighted: this.totalWeighted,
    });

    return Response.json({
      success: true,
      totalVotes: this.totalVotes,
      totalWeighted: this.totalWeighted,
    });
  }

  private handleGetCount(): Response {
    return Response.json({
      totalVotes: this.totalVotes,
      totalWeighted: this.totalWeighted,
    });
  }

  private handleWebSocket(ws: WebSocket) {
    ws.accept();
    this.connections.add(ws);

    // Send current state
    ws.send(JSON.stringify({
      type: 'init',
      totalVotes: this.totalVotes,
      totalWeighted: this.totalWeighted,
    }));

    ws.addEventListener('close', () => {
      this.connections.delete(ws);
    });
  }

  private broadcast(message: object) {
    const json = JSON.stringify(message);
    for (const ws of this.connections) {
      try {
        ws.send(json);
      } catch {
        this.connections.delete(ws);
      }
    }
  }
}

// Worker that routes to Durable Objects
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const clipId = url.searchParams.get('clipId');

    if (!clipId) {
      return new Response('Missing clipId', { status: 400 });
    }

    // Get or create Durable Object for this clip
    const id = env.VOTE_COUNTER.idFromName(clipId);
    const stub = env.VOTE_COUNTER.get(id);

    // Forward request to Durable Object
    return stub.fetch(request);
  },
};
```

### Why Durable Objects are Better

| Aspect | Redis + Vercel | Durable Objects |
|--------|----------------|-----------------|
| Latency (global) | 100-200ms | 20-50ms |
| WebSocket support | External (Pusher) | Built-in |
| Consistency | Eventually | Strong per-clip |
| State persistence | Separate DB | Built-in SQLite |
| Cost | Redis + Vercel | Single bill |
| Scaling | Manual sharding | Automatic |

**Sources:** [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/), [Workers Chat Demo](https://github.com/cloudflare/workers-chat-demo)

---

## Improvement 3: HyperLogLog for Unique Voter Tracking

### The Problem

Tracking unique voters per clip requires storing all voter keys:
- 1M voters × 32 bytes per key = 32MB per clip
- 1000 clips = 32GB just for voter tracking

### HyperLogLog Solution

HyperLogLog provides:
- **12KB memory** regardless of cardinality
- Counts up to **2^64 unique items**
- **0.81% standard error** (acceptable for voting)

```
Traditional Set:
  100,000 voters = 3.2MB memory

HyperLogLog:
  100,000 voters = 12KB memory (99.6% reduction)
  Estimated count: 99,562 (0.44% error)
```

### Implementation

```typescript
// src/lib/hyperloglog-voters.ts

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Track unique voters using HyperLogLog.
 * Uses 12KB per clip regardless of voter count.
 */
export class UniqueVoterTracker {
  private hllKey(clipId: string) {
    return `hll:voters:${clipId}`;
  }

  /**
   * Add voter to HyperLogLog
   */
  async addVoter(clipId: string, voterKey: string): Promise<boolean> {
    // PFADD returns 1 if the HLL was modified (likely new voter)
    const result = await redis.pfadd(this.hllKey(clipId), voterKey);
    return result === 1;
  }

  /**
   * Get estimated unique voter count
   */
  async getUniqueVoterCount(clipId: string): Promise<number> {
    return await redis.pfcount(this.hllKey(clipId));
  }

  /**
   * Merge multiple clips' voter HLLs (for leaderboards)
   */
  async mergeVoterCounts(destKey: string, clipIds: string[]): Promise<number> {
    const sourceKeys = clipIds.map(id => this.hllKey(id));
    await redis.pfmerge(destKey, ...sourceKeys);
    return await redis.pfcount(destKey);
  }

  /**
   * Get total unique voters across all active clips
   */
  async getTotalUniqueVoters(clipIds: string[]): Promise<number> {
    const tempKey = `hll:temp:${Date.now()}`;
    const count = await this.mergeVoterCounts(tempKey, clipIds);
    await redis.del(tempKey);
    return count;
  }
}

// Usage in vote API
const tracker = new UniqueVoterTracker();

// Track voter (12KB memory regardless of count)
await tracker.addVoter(clipId, voterKey);

// Get unique voter count (estimate with 0.81% error)
const uniqueVoters = await tracker.getUniqueVoterCount(clipId);
```

### Use Cases for HyperLogLog

| Use Case | Traditional | HyperLogLog |
|----------|-------------|-------------|
| Unique voters per clip | 32MB / 1M voters | 12KB |
| Unique voters per slot | Store all keys | 12KB (merged) |
| Unique voters per season | Massive | 12KB |
| Analytics dashboards | Expensive queries | Instant |

**Note:** HyperLogLog cannot tell you IF a specific voter voted — only the count. Use it alongside Bloom Filters for that.

**Sources:** [Redis HyperLogLog](https://redis.io/docs/latest/develop/data-types/probabilistic/hyperloglogs/), [HyperLogLog Deep Dive](https://redis.io/resources/redis-hyperloglog-deep-dive/)

---

## Improvement 4: Bloom Filter for Fast Duplicate Detection

### The Problem

Checking if a voter already voted:
```typescript
// Current: Redis key per vote (32 bytes × millions)
const hasVoted = await redis.exists(`voted:${voterKey}:${clipId}`);
```

### Bloom Filter Solution

A Bloom Filter is a probabilistic data structure that can tell you:
- **Definitely NOT in set** (100% accurate)
- **Probably in set** (configurable false positive rate)

```
Traditional Set:
  1M votes = 32MB memory
  Lookup: O(1) but large memory

Bloom Filter:
  1M votes = ~1.2MB memory (10x smaller)
  Lookup: O(k) where k = number of hash functions
  False positive rate: 1% (configurable)
```

### Implementation

```typescript
// src/lib/bloom-filter-votes.ts

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Bloom Filter for vote deduplication.
 * False positives possible (says "voted" when they didn't).
 * False negatives impossible (never says "not voted" when they did).
 */
export class VoteBloomFilter {
  private key: string;
  private size: number;
  private hashCount: number;

  constructor(clipId: string, expectedVotes: number = 100000, falsePositiveRate: number = 0.01) {
    this.key = `bloom:votes:${clipId}`;
    // Calculate optimal size and hash count
    this.size = this.optimalSize(expectedVotes, falsePositiveRate);
    this.hashCount = this.optimalHashCount(this.size, expectedVotes);
  }

  private optimalSize(n: number, p: number): number {
    return Math.ceil(-n * Math.log(p) / (Math.log(2) ** 2));
  }

  private optimalHashCount(m: number, n: number): number {
    return Math.round((m / n) * Math.log(2));
  }

  private hash(value: string, seed: number): number {
    let h = seed;
    for (let i = 0; i < value.length; i++) {
      h = Math.imul(31, h) + value.charCodeAt(i) | 0;
    }
    return Math.abs(h) % this.size;
  }

  /**
   * Add voter to Bloom Filter
   */
  async add(voterKey: string): Promise<void> {
    const pipeline = redis.pipeline();
    for (let i = 0; i < this.hashCount; i++) {
      const bit = this.hash(voterKey, i);
      pipeline.setbit(this.key, bit, 1);
    }
    await pipeline.exec();
  }

  /**
   * Check if voter might have voted.
   * Returns false = definitely NOT voted
   * Returns true = probably voted (check DB to confirm)
   */
  async mightContain(voterKey: string): Promise<boolean> {
    const pipeline = redis.pipeline();
    for (let i = 0; i < this.hashCount; i++) {
      const bit = this.hash(voterKey, i);
      pipeline.getbit(this.key, bit);
    }
    const results = await pipeline.exec();
    return results.every(r => r === 1);
  }
}

// Usage in vote API
async function checkAndRecordVote(clipId: string, voterKey: string): Promise<boolean> {
  const bloom = new VoteBloomFilter(clipId);

  // Fast check with Bloom Filter
  const mightHaveVoted = await bloom.mightContain(voterKey);

  if (mightHaveVoted) {
    // Bloom says "probably voted" - verify with Redis Set (authoritative)
    const definitelyVoted = await redis.sismember(`votes:${clipId}`, voterKey);
    if (definitelyVoted) {
      return false; // Already voted
    }
    // False positive from Bloom Filter - continue with vote
  }

  // Record vote
  await Promise.all([
    bloom.add(voterKey),
    redis.sadd(`votes:${clipId}`, voterKey),
  ]);

  return true; // Vote recorded
}
```

### Bloom Filter + HyperLogLog Combo

```typescript
// Optimal combination:
// - Bloom Filter: Fast "has voted" check (O(k), 1% false positive)
// - HyperLogLog: Unique voter count (12KB, 0.81% error)
// - Redis Set: Authoritative vote records (only queried on Bloom positive)

async function optimizedVoteCheck(clipId: string, voterKey: string) {
  const bloom = new VoteBloomFilter(clipId);
  const hll = new UniqueVoterTracker();

  // Step 1: Bloom Filter check (0.1ms, 99% of duplicates caught)
  if (await bloom.mightContain(voterKey)) {
    // Step 2: Verify with authoritative source (only 1% of requests reach here)
    if (await redis.sismember(`votes:${clipId}`, voterKey)) {
      return { allowed: false, reason: 'ALREADY_VOTED' };
    }
  }

  // Record vote in all three structures
  await Promise.all([
    bloom.add(voterKey),              // For future duplicate checks
    hll.addVoter(clipId, voterKey),   // For unique count
    redis.sadd(`votes:${clipId}`, voterKey),  // Authoritative record
  ]);

  return { allowed: true };
}
```

---

## Improvement 5: Write-Behind Cache Pattern

### The Problem

Current approaches:
- **Write-through**: Write to Redis AND DB on every vote (slow)
- **Write-back with queue**: Queue votes, batch insert (complexity)

### Write-Behind Pattern

Redis as the **primary data store**, PostgreSQL synced asynchronously:

```
Write Path:
  Vote → Redis (primary) → Return success
              ↓
         [Async every 5s]
              ↓
         PostgreSQL (replica)

Read Path:
  Request → Redis → Return (never hits DB for hot data)
```

### Implementation with Redis Triggers

```typescript
// src/lib/write-behind-votes.ts

import { Redis } from '@upstash/redis';
import { createClient } from '@supabase/supabase-js';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/**
 * Write-behind cache for votes.
 * Redis is the source of truth for active voting.
 * PostgreSQL is synced asynchronously for persistence/analytics.
 */
export class WriteBehindVoteCache {
  private dirtySetKey = 'dirty:clips';  // Clips with unsynced changes

  /**
   * Record vote (Redis only, instant)
   */
  async recordVote(
    clipId: string,
    voterKey: string,
    weight: number = 1
  ): Promise<{ voteCount: number; weightedScore: number }> {
    const voteKey = `vote:${clipId}:${voterKey}`;
    const countKey = `count:${clipId}`;
    const weightedKey = `weighted:${clipId}`;

    // Check duplicate
    const exists = await redis.exists(voteKey);
    if (exists) {
      throw new Error('ALREADY_VOTED');
    }

    // Record vote and update counts (atomic pipeline)
    await redis.pipeline()
      .set(voteKey, weight, { ex: 604800 })  // 7 days
      .incr(countKey)
      .incrby(weightedKey, weight)
      .sadd(this.dirtySetKey, clipId)        // Mark as dirty
      .exec();

    // Return updated counts
    const [voteCount, weightedScore] = await Promise.all([
      redis.get<number>(countKey),
      redis.get<number>(weightedKey),
    ]);

    return {
      voteCount: voteCount || 0,
      weightedScore: weightedScore || 0,
    };
  }

  /**
   * Remove vote (Redis only, instant)
   */
  async removeVote(clipId: string, voterKey: string): Promise<void> {
    const voteKey = `vote:${clipId}:${voterKey}`;
    const weight = await redis.get<number>(voteKey);

    if (!weight) {
      throw new Error('NOT_VOTED');
    }

    await redis.pipeline()
      .del(voteKey)
      .decr(`count:${clipId}`)
      .decrby(`weighted:${clipId}`, weight)
      .sadd(this.dirtySetKey, clipId)
      .exec();
  }

  /**
   * Get vote count (Redis only, instant)
   */
  async getVoteCount(clipId: string): Promise<{ voteCount: number; weightedScore: number }> {
    const [voteCount, weightedScore] = await Promise.all([
      redis.get<number>(`count:${clipId}`),
      redis.get<number>(`weighted:${clipId}`),
    ]);

    return {
      voteCount: voteCount || 0,
      weightedScore: weightedScore || 0,
    };
  }

  /**
   * Sync dirty clips to PostgreSQL (run every 5 seconds)
   */
  async syncToDatabase(supabase: any): Promise<number> {
    // Get all dirty clips
    const dirtyClips = await redis.smembers(this.dirtySetKey);

    if (dirtyClips.length === 0) {
      return 0;
    }

    // Get current counts from Redis
    const updates = await Promise.all(
      dirtyClips.map(async (clipId) => {
        const { voteCount, weightedScore } = await this.getVoteCount(clipId as string);
        return { clipId, voteCount, weightedScore };
      })
    );

    // Batch update PostgreSQL
    for (const { clipId, voteCount, weightedScore } of updates) {
      await supabase
        .from('tournament_clips')
        .update({ vote_count: voteCount, weighted_score: weightedScore })
        .eq('id', clipId);
    }

    // Clear dirty set
    await redis.del(this.dirtySetKey);

    return updates.length;
  }
}
```

### Why Write-Behind is Better

| Aspect | Write-Through | Event Queue | Write-Behind |
|--------|---------------|-------------|--------------|
| Latency | Slow (DB wait) | Fast | Fast |
| Complexity | Low | High | Medium |
| Data in Redis | Cache only | Queue only | Full state |
| DB load | Every write | Batch | Batch |
| Recovery | DB is source | Queue replay | Redis + DB |

**Sources:** [Redis Write-Behind](https://redis.io/learn/howtos/solutions/caching-architecture/write-behind), [Caching Strategies](https://redis.io/blog/why-your-caching-strategies-might-be-holding-you-back-and-what-to-consider-next/)

---

## Improvement 6: Token Bucket Rate Limiting

### The Problem

Current sliding window rate limiting:
- Smooth but doesn't allow bursts
- Users can't vote rapidly even if under daily limit

### Token Bucket Solution

Token Bucket allows **controlled bursts** while maintaining average rate:

```
Bucket Configuration:
  - Capacity: 10 tokens (max burst)
  - Refill rate: 1 token/second
  - Each vote costs 1 token

User behavior:
  - Idle for 10 seconds → bucket full (10 tokens)
  - Rapid 10 votes → all succeed (burst)
  - 11th vote → wait 1 second for refill
```

### Implementation

```typescript
// src/lib/token-bucket-rate-limit.ts

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

interface TokenBucketConfig {
  capacity: number;      // Max tokens (max burst size)
  refillRate: number;    // Tokens added per second
  costPerVote: number;   // Tokens consumed per vote
}

const VOTE_BUCKET: TokenBucketConfig = {
  capacity: 10,        // Allow burst of 10 votes
  refillRate: 0.5,     // 1 token every 2 seconds = 30/min average
  costPerVote: 1,
};

export class TokenBucketRateLimiter {
  private config: TokenBucketConfig;

  constructor(config: TokenBucketConfig = VOTE_BUCKET) {
    this.config = config;
  }

  private bucketKey(identifier: string) {
    return `bucket:${identifier}`;
  }

  /**
   * Try to consume tokens for a vote.
   * Returns { allowed, tokensRemaining, retryAfter }
   */
  async tryConsume(identifier: string, tokens: number = 1): Promise<{
    allowed: boolean;
    tokensRemaining: number;
    retryAfter: number | null;
  }> {
    const key = this.bucketKey(identifier);
    const now = Date.now();

    // Get current bucket state
    const bucket = await redis.hgetall(key);
    let currentTokens = parseFloat(bucket?.tokens as string) || this.config.capacity;
    let lastRefill = parseInt(bucket?.lastRefill as string) || now;

    // Calculate tokens to add since last refill
    const elapsed = (now - lastRefill) / 1000;
    const tokensToAdd = elapsed * this.config.refillRate;
    currentTokens = Math.min(this.config.capacity, currentTokens + tokensToAdd);

    // Check if enough tokens
    if (currentTokens >= tokens) {
      // Consume tokens
      currentTokens -= tokens;
      await redis.hset(key, {
        tokens: currentTokens.toString(),
        lastRefill: now.toString(),
      });
      await redis.expire(key, 3600); // 1 hour TTL

      return {
        allowed: true,
        tokensRemaining: Math.floor(currentTokens),
        retryAfter: null,
      };
    }

    // Not enough tokens - calculate wait time
    const tokensNeeded = tokens - currentTokens;
    const waitSeconds = tokensNeeded / this.config.refillRate;

    return {
      allowed: false,
      tokensRemaining: Math.floor(currentTokens),
      retryAfter: Math.ceil(waitSeconds),
    };
  }

  /**
   * Get current bucket state without consuming
   */
  async getState(identifier: string): Promise<{
    tokens: number;
    capacity: number;
  }> {
    const key = this.bucketKey(identifier);
    const now = Date.now();

    const bucket = await redis.hgetall(key);
    let currentTokens = parseFloat(bucket?.tokens as string) || this.config.capacity;
    const lastRefill = parseInt(bucket?.lastRefill as string) || now;

    const elapsed = (now - lastRefill) / 1000;
    const tokensToAdd = elapsed * this.config.refillRate;
    currentTokens = Math.min(this.config.capacity, currentTokens + tokensToAdd);

    return {
      tokens: Math.floor(currentTokens),
      capacity: this.config.capacity,
    };
  }
}

// Usage in vote API
const rateLimiter = new TokenBucketRateLimiter();

export async function checkRateLimit(voterKey: string): Promise<{
  allowed: boolean;
  retryAfter?: number;
}> {
  const result = await rateLimiter.tryConsume(voterKey);

  if (!result.allowed) {
    return {
      allowed: false,
      retryAfter: result.retryAfter!,
    };
  }

  return { allowed: true };
}
```

### Comparison

| Algorithm | Burst Handling | Smoothness | Complexity |
|-----------|----------------|------------|------------|
| Fixed Window | Allows 2x burst at boundary | Poor | Low |
| Sliding Window | No burst | Excellent | Medium |
| **Token Bucket** | Controlled burst | Good | Medium |
| Leaky Bucket | No burst | Excellent | Medium |

**Sources:** [Token Bucket vs Leaky Bucket](https://www.geeksforgeeks.org/system-design/token-bucket-vs-leaky-bucket-algorithm-system-design/), [Rate Limiting Algorithms](https://www.eraser.io/decision-node/api-rate-limiting-strategies-token-bucket-vs-leaky-bucket)

---

## Improvement 7: Read-Your-Writes Consistency

### The Problem

With eventual consistency, user votes and might not see it reflected:
```
User votes → "Vote accepted!"
User refreshes → Still shows old count (their vote not visible)
User confused: "Did my vote count?"
```

### Solution: Session-Aware Consistency

Track user's recent votes and merge with cached data:

```typescript
// src/lib/read-your-writes.ts

/**
 * Ensure users see their own votes immediately,
 * even when reading from eventually consistent cache.
 */
export class ReadYourWritesConsistency {
  private redis: Redis;
  private sessionVotesKey = (sessionId: string) => `session_votes:${sessionId}`;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Record that user voted (call after successful vote)
   */
  async recordUserVote(
    sessionId: string,
    clipId: string,
    voteCount: number
  ): Promise<void> {
    await this.redis.hset(this.sessionVotesKey(sessionId), clipId, voteCount);
    await this.redis.expire(this.sessionVotesKey(sessionId), 300); // 5 min
  }

  /**
   * Merge cached clip data with user's session votes
   */
  async mergeWithSessionVotes(
    sessionId: string,
    clips: Clip[]
  ): Promise<Clip[]> {
    const sessionVotes = await this.redis.hgetall(this.sessionVotesKey(sessionId));

    return clips.map(clip => {
      const sessionCount = sessionVotes?.[clip.id];
      if (sessionCount !== undefined) {
        // User voted on this clip - use their known count
        return {
          ...clip,
          vote_count: Math.max(clip.vote_count, parseInt(sessionCount as string)),
          user_voted: true,
        };
      }
      return clip;
    });
  }
}

// Usage in API
const ryw = new ReadYourWritesConsistency(redis);

// After successful vote:
await ryw.recordUserVote(sessionId, clipId, newVoteCount);

// When fetching clips:
let clips = await getCachedClips(slotPosition);
clips = await ryw.mergeWithSessionVotes(sessionId, clips);
```

---

## Improvement 8: Pre-Aggregated Leaderboards

### The Problem

Computing leaderboards on the fly is expensive:
```sql
SELECT user_id, SUM(vote_weight) as total
FROM votes
GROUP BY user_id
ORDER BY total DESC
LIMIT 100;
-- Scans millions of rows
```

### Solution: Sorted Set Leaderboard

Maintain leaderboard in Redis Sorted Set:

```typescript
// src/lib/realtime-leaderboard.ts

const LEADERBOARD_KEY = 'leaderboard:voters';

export class RealtimeLeaderboard {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Update user's score (call after each vote)
   */
  async incrementScore(userId: string, points: number = 1): Promise<number> {
    return await this.redis.zincrby(LEADERBOARD_KEY, points, userId);
  }

  /**
   * Get top N users (instant, no computation)
   */
  async getTopVoters(limit: number = 100): Promise<Array<{
    userId: string;
    score: number;
    rank: number;
  }>> {
    const results = await this.redis.zrevrange(LEADERBOARD_KEY, 0, limit - 1, {
      withScores: true,
    });

    return results.map((item, index) => ({
      userId: item.member as string,
      score: item.score,
      rank: index + 1,
    }));
  }

  /**
   * Get user's rank (O(log N))
   */
  async getUserRank(userId: string): Promise<{
    rank: number | null;
    score: number;
  }> {
    const [rank, score] = await Promise.all([
      this.redis.zrevrank(LEADERBOARD_KEY, userId),
      this.redis.zscore(LEADERBOARD_KEY, userId),
    ]);

    return {
      rank: rank !== null ? rank + 1 : null,
      score: score || 0,
    };
  }

  /**
   * Get users around a specific user (for "Your Position" UI)
   */
  async getSurroundingUsers(userId: string, range: number = 5): Promise<Array<{
    userId: string;
    score: number;
    rank: number;
  }>> {
    const rank = await this.redis.zrevrank(LEADERBOARD_KEY, userId);
    if (rank === null) return [];

    const start = Math.max(0, rank - range);
    const end = rank + range;

    const results = await this.redis.zrevrange(LEADERBOARD_KEY, start, end, {
      withScores: true,
    });

    return results.map((item, index) => ({
      userId: item.member as string,
      score: item.score,
      rank: start + index + 1,
    }));
  }
}
```

---

## Summary: Combined Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                              EDGE LAYER                                │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ Cloudflare Worker                                                │  │
│  │ ├─ Token Bucket Rate Limit (burst-friendly)                     │  │
│  │ ├─ JWT Validation (stateless)                                   │  │
│  │ └─ Route to Durable Object or Origin                            │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────────┐    ┌───────────────────┐    ┌───────────────────┐
│ Durable Object    │    │ Durable Object    │    │ Durable Object    │
│ (Clip A)          │    │ (Clip B)          │    │ (Clip C)          │
│ ├─ Vote state     │    │ ├─ Vote state     │    │ ├─ Vote state     │
│ ├─ WebSocket hub  │    │ ├─ WebSocket hub  │    │ ├─ WebSocket hub  │
│ └─ SQLite DB      │    │ └─ SQLite DB      │    │ └─ SQLite DB      │
└───────────────────┘    └───────────────────┘    └───────────────────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                              ┌─────▼─────┐
                              │   Redis   │
                              │ ├─ CRDT   │
                              │ ├─ HLL    │
                              │ ├─ Bloom  │
                              │ └─ Sorted │
                              │   Sets    │
                              └─────┬─────┘
                                    │
                              [Write-Behind]
                                    │
                              ┌─────▼─────┐
                              │PostgreSQL │
                              │(Persistent│
                              │ Storage)  │
                              └───────────┘
```

---

## Implementation Priority

| # | Improvement | Impact | Effort | Priority |
|---|-------------|--------|--------|----------|
| 1 | Write-Behind Cache | High | Low | **Do First** |
| 2 | Token Bucket Rate Limit | Medium | Low | **Do First** |
| 3 | Pre-Aggregated Leaderboard | High | Low | **Do First** |
| 4 | Bloom Filter + HLL | Medium | Medium | Phase 2 |
| 5 | Read-Your-Writes | Medium | Low | Phase 2 |
| 6 | CRDT Counters | High | Medium | Phase 3 |
| 7 | Durable Objects | Very High | High | Phase 4 |

---

## Cost Comparison

| Solution | Infrastructure | Monthly Cost |
|----------|----------------|--------------|
| Current + Improvements 1-3 | Supabase Pro + Upstash | ~$50 |
| + Improvements 4-6 | + More Redis | ~$80 |
| Full Durable Objects | Cloudflare Workers Paid | ~$25 + usage |

---

## Conclusion

These improvements build on the TikTok-style architecture with:

1. **CRDT Counters** — Mathematically guaranteed consistency
2. **Durable Objects** — Edge-native voting with 20ms latency
3. **HyperLogLog** — 12KB to track millions of unique voters
4. **Bloom Filters** — 99% of duplicate checks without DB
5. **Write-Behind** — Redis as primary, DB as replica
6. **Token Bucket** — User-friendly burst handling
7. **Read-Your-Writes** — Users always see their own votes
8. **Pre-Aggregated Leaderboards** — Instant rankings

Combined with the TikTok patterns (sharded counters, event queues, eventual consistency), this creates a voting system capable of handling **millions of concurrent votes** with **sub-20ms latency** globally.

---

*Document created: January 2026*
*Author: AiMoviez Engineering Team*