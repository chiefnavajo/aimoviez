# Codebase Improvements Plan — 6 Opus Agents, 2 Runs

## Context

Full codebase audit with 6 Opus agents across 2 runs found ~100 findings. This plan organizes them into 5 priority tiers by severity and effort. Findings are deduplicated across agents.

---

## Tier 1: CRITICAL Security — RPC Permissions (5 min, 1 SQL file)

Direct database manipulation bypassing all API protections. Anyone with the public anon key can insert/delete votes and reorganize slots.

### 1a. Revoke anon access from vote RPCs
- `supabase/sql/fix-7-security-vulnerabilities.sql:395-396` — `insert_vote_atomic` granted to anon
- `supabase/sql/fix-vote-delete-race-condition.sql:105-106` — `delete_vote_atomic` granted to anon

**Fix:** New SQL migration:
```sql
REVOKE EXECUTE ON FUNCTION insert_vote_atomic FROM anon;
REVOKE EXECUTE ON FUNCTION delete_vote_atomic FROM anon;
```

### 1b. Restrict slot reorganization RPCs
- `supabase/sql/slot-reorganization-rpc.sql` — no GRANT/REVOKE at all (defaults to public)

**Fix:** Add to same migration:
```sql
REVOKE EXECUTE ON FUNCTION reorganize_slots_delete_and_shift FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION reorganize_slots_swap FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION reorganize_slots_delete_and_shift TO service_role;
GRANT EXECUTE ON FUNCTION reorganize_slots_swap TO service_role;
```

### 1c. Tighten RLS INSERT policies
- `supabase/sql/enable-rls-policies.sql` — votes, clips, comments, users all have `WITH CHECK (true)`

**Fix:** Change INSERT policies to require `authenticated` or `service_role` role.

---

## Tier 2: HIGH Security — CSRF + Auth Gaps (30 min, ~18 files)

### 2a. Add CSRF to all mutation routes missing it

| Route | File |
|-------|------|
| `/api/vote` POST, DELETE | `src/app/api/vote/route.ts` |
| `/api/comments` POST, PATCH, DELETE | `src/app/api/comments/route.ts` |
| `/api/genre-vote` POST, DELETE | `src/app/api/genre-vote/route.ts` |
| `/api/contact` POST | `src/app/api/contact/route.ts` |
| `/api/report` POST | `src/app/api/report/route.ts` |
| `/api/user/create-profile` POST | `src/app/api/user/create-profile/route.ts` |
| `/api/user/follow` POST, DELETE | `src/app/api/user/follow/route.ts` |
| `/api/user/block` POST, DELETE | `src/app/api/user/block/route.ts` |
| `/api/upload` POST | `src/app/api/upload/route.ts` |
| `/api/upload/register` POST | `src/app/api/upload/register/route.ts` |
| `/api/upload/signed-url` POST | `src/app/api/upload/signed-url/route.ts` |
| `/api/referral` POST | `src/app/api/referral/route.ts` |
| `/api/notifications` PATCH, DELETE | `src/app/api/notifications/route.ts` |
| `/api/notifications/subscribe` POST | `src/app/api/notifications/subscribe/route.ts` |
| `/api/clip/record-prompt` POST | `src/app/api/clip/record-prompt/route.ts` |

**Fix:** Add `const csrfError = requireCsrf(req); if (csrfError) return csrfError;` to each handler.

### 2b. Replace Math.random() with crypto
- `src/app/api/teams/[id]/invites/route.ts:250` — invite codes
- `src/app/api/upload/signed-url/route.ts:79` — storage filenames
- `src/app/api/ai/complete/route.ts:225` — storage filenames

**Fix:** Use `crypto.randomBytes(8).toString('hex')` or `crypto.randomUUID()`.

### 2c. Remove genres route key fallback
- `src/app/api/genres/route.ts:14-16` — falls back to ANON_KEY silently

**Fix:** Fail loudly if `SUPABASE_SERVICE_ROLE_KEY` is missing.

### 2d. Require auth for notification mutations
- `src/app/api/notifications/route.ts` — PATCH/DELETE uses spoofable device fingerprint

**Fix:** Require `getServerSession()` for PATCH and DELETE.

---

## Tier 3: HIGH Reliability — Race Conditions & Data Loss (45 min, ~8 files)

### 3a. Fix queue acknowledgeEvent LPOP bug (votes silently lost)
- `src/lib/vote-event-queue.ts:122-126` — LPOP removes wrong events from processing queue
- `src/app/api/cron/process-vote-queue/route.ts:193-213`

**Fix:** Don't LPOP individual failed events. Instead: re-push failed events to main queue, then DEL the entire processing queue. Same fix for comment queue.

### 3b. Fix sync-vote-counters SREM race (vote counts drift)
- `src/app/api/cron/sync-vote-counters/route.ts:112-118` — SREM races with incoming SADD

**Fix:** Use Lua script to atomically SMEMBERS + SREM the same set of IDs. Or use SPOP to dequeue clips for syncing.

### 3c. Fix lost votes on Redis pipeline failure
- `src/lib/vote-validation-redis.ts:220-235` — dedup key set but vote never queued

**Fix:** Wrap pipeline in try/catch. On failure, delete the dedup key to allow retry.

### 3d. Fix advance-slot partial completion
- `src/app/api/admin/advance-slot/route.ts:252-531` — multi-step non-transactional

**Fix:** Add `.eq('status', 'voting')` guard to slot update (prevents double-advance). Consider RPC for atomicity.

### 3e. Fix season reset racing with auto-advance
- `src/app/api/admin/reset-season/route.ts` — no distributed lock

**Fix:** Acquire `auto-advance` cron lock at start of reset, release in finally block.

### 3f. Fix spent_credits/completed_scenes read-modify-write
- `src/app/api/cron/process-movie-scenes/route.ts:221-230, 521-530`

**Fix:** Use SQL atomic increment: `SET spent_credits = spent_credits + $cost`.

### 3g. Fix cancel route not refunding credits
- `src/app/api/ai/cancel/route.ts:123-131`

**Fix:** Call `refund_credits` RPC after marking generation as failed.

### 3h. Add self-healing time guard
- `src/app/api/cron/auto-advance/route.ts:112-139` — resets freshly-activated slots

**Fix:** Only self-heal slots in `voting` status for >5 minutes with zero clips.

---

## Tier 4: HIGH Performance & Cost (~$576/month savings, 30 min, ~10 files)

### 4a. Update deprecated Claude model
- `src/lib/prompt-learning.ts:21` — `claude-3-haiku-20240307` (deprecated)
- `src/lib/visual-learning.ts:14` — same

**Fix:** Update to `claude-haiku-4-5-20251001`.

### 4b. Use Haiku for movie scripts and co-director (saves ~$540/month)
- `src/lib/movie-script-generator.ts:22` — Sonnet for JSON script generation
- `src/lib/claude-director.ts:23` — Sonnet for directions + brief generation

**Fix:** Use Haiku for `generateMovieScript`, `generateDirections`. Keep Sonnet only for `writeBrief` and `analyzeStory`.

### 4c. Reuse module-level Anthropic client
- `src/lib/claude-director.ts:485` — creates new client per `generateQuickStoryBeat` call

**Fix:** Use existing module-level `anthropic` client or `callClaude` helper.

### 4d. Add timeouts to Anthropic clients
- `src/lib/prompt-learning.ts:28` — no timeout
- `src/lib/visual-learning.ts:22` — no timeout

**Fix:** Add `timeout: 30_000`.

### 4e. Reduce visual learning from 5 frames to 1 for non-winners (saves ~$36/month)
- `src/lib/visual-learning.ts:415-420` — 5 concurrent Vision calls per video

**Fix:** Sample 1 frame (middle) for routine analysis, 3 frames for winners only.

### 4f. Replace getUserVotesToday with DB aggregate
- `src/app/api/vote/route.ts:293-328` — fetches all vote rows, sums in JS

**Fix:** Use RPC: `SELECT COALESCE(SUM(vote_weight), 0) FROM votes WHERE voter_key=$1 AND created_at >= $2`.

### 4g. Merge duplicate clip queries in vote route
- `src/app/api/vote/route.ts:1215-1248, 1516-1574` — queries same clip twice

**Fix:** Add `user_id` to first SELECT, remove second query. Saves 1 DB round-trip per vote.

### 4h. Shared feature_flags cache
- 30+ separate `feature_flags` queries across all routes

**Fix:** Create `src/lib/feature-flags-cache.ts` with Redis-backed 60s TTL cache.

### 4i. Add TTL to CRDT Redis keys
- `src/lib/crdt-vote-counter.ts:38-43` — no TTL on crdt:* keys

**Fix:** `pipeline.expire(key, 30 * 24 * 3600)` after each hincrby.

### 4j. Cap dead letter queues
- `src/lib/vote-event-queue.ts:153` — unbounded growth
- `src/lib/comment-event-queue.ts:183`

**Fix:** `pipeline.ltrim(deadLetterKey, 0, 999)` after lpush.

---

## Tier 5: MEDIUM Quality & UX (20 min, ~10 files)

### 5a. Fix window.location.href → router.push
- `src/app/story/page.tsx:832, 874` — full-page reload instead of SPA navigation

### 5b. Add scroll lock + focus trap to DirectionVotingModal
- `src/components/DirectionVotingModal.tsx` — missing `useFocusTrap` and body scroll lock

### 5c. Move TeamDashboard modal to portal
- `src/components/team/TeamDashboard.tsx:155-205` — modal inside flex container

### 5d. Fix CommentsSection stopPropagation on all keys
- `src/components/CommentsSection.tsx:738-745` — should only stop Space, not all keys

### 5e. Dynamic import CommentsSection on story page
- `src/app/story/page.tsx:48` — static import, should be `next/dynamic`

### 5f. Fix MiniLeaderboard polling without visibility check
- `src/components/MiniLeaderboard.tsx:96-108` — polls in background tabs

### 5g. Fix story page preload effect dependency
- `src/app/story/page.tsx:417-438` — re-creates DOM on every data poll

### 5h. Remove 18 console.log statements
- `src/app/story/page.tsx` — 11 instances
- `src/app/dashboard/page.tsx` — 7 instances

### 5i. Remove dead code (underscore-prefixed)
- `src/app/story/page.tsx:63, 208-217` — `_Genre`, `_ActionButton`
- `src/app/dashboard/page.tsx:74` — `_VoteType`
- `src/app/upload/page.tsx:42` — `_generateFilename`

### 5j. Sanitize health endpoint error messages
- `src/app/api/health/route.ts:62,75` — leaks internal errors
- `src/app/api/health/redis/route.ts:59,93`

**Fix:** `message: process.env.NODE_ENV === 'production' ? 'Service unavailable' : error.message`

---

## Files Modified (total ~45 files)

| Tier | Files | Effort |
|------|-------|--------|
| 1 | 1 new SQL migration | 5 min |
| 2 | ~18 API routes | 30 min |
| 3 | ~8 lib/API files | 45 min |
| 4 | ~10 lib/API files | 30 min |
| 5 | ~10 component/page files | 20 min |

## Implementation Order

1. **Tier 1** — SQL migration for RPC permissions (highest impact, lowest effort)
2. **Tier 2** — CSRF + auth gaps
3. **Tier 3** — Race conditions and data integrity
4. **Tier 4** — Performance and cost optimization
5. **Tier 5** — UX and code quality
6. `npm run build` after each tier

## Verification

1. `npm run build` — clean after each tier
2. `npm run test:fixes` — existing 69 regression tests pass
3. Manual: vote cast → check Redis dedup key cleaned on failure
4. Manual: cron/auto-advance → verify no double-advance
5. Manual: check AI generation costs in admin dashboard after Tier 4
6. Manual: verify CSRF token required on vote/comment/upload via curl
