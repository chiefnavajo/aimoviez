# Deep Dive Bug Audit — 2026-02-16 19:33

## Summary
3 parallel Opus agents audited the full codebase. ALL COMPLETE.

**Grand Total: 44 bugs (7 HIGH, 22 MEDIUM, 15 LOW)**

---

## Audit 1: Data Flow & Business Logic (COMPLETE)

### HIGH

#### BUG DF-4: Vote queue deletes processing queue before failure handling
- **File:** `src/app/api/cron/process-vote-queue/route.ts:195` + `src/lib/vote-event-queue.ts:114`
- **Category:** Data Loss / Queue Safety
- **Issue:** `acknowledgeEvents(successfulEvents)` calls `r.del(QUEUE_KEYS.processing)` which deletes the ENTIRE processing queue. If an error occurs during the subsequent failure-handling loop, failed events are permanently lost.
- **Fix:** Move `acknowledgeEvents` to AFTER the failure-handling loop completes.

#### BUG DF-8: Admin advance-slot doesn't update Redis state
- **File:** `src/app/api/admin/advance-slot/route.ts` (entire file)
- **Category:** Cache Invalidation
- **Issue:** Unlike auto-advance cron, the admin manual advance does NOT call `setSlotState()`, `clearVotingFrozen()`, `clearClips()`, or `forceSyncCounters()`. With async_voting enabled, Redis still points to old slot — all votes rejected with WRONG_SLOT.
- **Fix:** Add same Redis cleanup/update logic from auto-advance to admin advance-slot.

### MEDIUM

#### BUG DF-1: Account deletion uses wrong column for notifications
- **File:** `src/app/api/account/delete/route.ts:189`
- **Category:** Data Consistency / GDPR
- **Issue:** Notifications deleted by `.eq('user_id', userId)` but notifications table uses `user_key` (format `user_{uuid}`). Deletes zero rows.
- **Fix:** Change to `.eq('user_key', userKey)` where `userKey = user_${userId}`.

#### BUG DF-2: Season reset clear_votes uses wrong column
- **File:** `src/app/api/admin/reset-season/route.ts:235`
- **Category:** Dead Code Path
- **Issue:** Filters on `tournament_clip_id` but votes table uses `clip_id`. Silently deletes nothing.
- **Fix:** Change `tournament_clip_id` to `clip_id`.

#### BUG DF-3: Movie cancel misses script_generating/script_ready statuses
- **File:** `src/app/api/movie/projects/[id]/cancel/route.ts:80-81`
- **Category:** State Machine Violation
- **Issue:** Validation allows cancelling from `script_generating`/`script_ready`, but the DB update only transitions from `generating`/`paused`. Project stuck in old status with skipped scenes.
- **Fix:** Add `script_generating` and `script_ready` to the `.in('status', [...])` update filter.

#### BUG DF-6: clips_active Redis set grows unboundedly
- **File:** `src/app/api/cron/sync-vote-counters/route.ts:96`
- **Category:** Resource Growth
- **Issue:** `clips_active` set is populated on every vote but never cleaned. Cron reads ALL members via `smembers` and gets slower over time.
- **Fix:** Remove synced clip IDs from the set after processing, or filter against active clips.

#### BUG DF-7: Non-atomic read-modify-write on spent_credits/completed_scenes
- **File:** `src/app/api/cron/process-movie-scenes/route.ts:222,515`
- **Category:** Concurrency
- **Issue:** Uses stale `project` object from start of cron run for `(project.spent_credits || 0) + creditCost`. If lock expires and another cron overlaps, counts drift.
- **Fix:** Use SQL increment (RPC) instead of read-modify-write.

#### BUG DF-10: Comment queue same processing queue deletion risk
- **File:** `src/app/api/cron/process-comment-queue/route.ts:231`
- **Category:** Data Loss Risk
- **Issue:** Same pattern as DF-4 — `acknowledgeCommentEvents` deletes entire processing queue before failure handling.
- **Fix:** Same as DF-4.

### LOW

#### BUG DF-5: Leaderboard percentage calculated per-page
- **File:** `src/app/api/leaderboard/route.ts:175,244`
- **Issue:** Vote percentages sum to 100% per page, not globally. Misleading to users.
- **Fix:** Use total vote count across all clips.

#### BUG DF-9: Account deletion misses user's clip_views as viewer
- **File:** `src/app/api/account/delete/route.ts`
- **Category:** GDPR gap
- **Issue:** Deletes views OF user's clips but not views BY the user of other clips.
- **Fix:** Add `.eq('voter_key', userKey)` deletion step.

---

## Audit 2: Hooks, State & Realtime Subscriptions (COMPLETE)

### HIGH

#### BUG HS-1: Circular useCallback in useStoryBroadcast
- **File:** `src/hooks/useRealtimeClips.ts:365-459`
- **Category:** Stale Closure
- **Issue:** `subscribe` and `scheduleReconnect` have circular `useCallback` dependencies. After toggling `enabled`, reconnection captures stale `subscribe` — broken reconnect chain.
- **Fix:** Make `scheduleReconnect` a ref-based function or combine into single callback.

### MEDIUM

#### BUG HS-2: clipIds changes don't trigger resubscription
- **File:** `src/hooks/useRealtimeClips.ts:239-314`
- **Category:** State Sync
- **Issue:** `useRealtimeVotes` subscribes with initial clipIds but never resubscribes when clips change. New clips miss realtime vote updates.
- **Fix:** Add serialized `clipIds` to useEffect dependency array.

#### BUG HS-3: ThemeProvider context value recreated every render
- **File:** `src/components/ui/ThemeToggle.tsx:65`
- **Category:** Performance
- **Issue:** New object reference every render triggers cascading re-renders of all `useTheme()` consumers app-wide.
- **Fix:** Wrap `setTheme` in `useCallback`, memoize context value with `useMemo`.

#### BUG HS-5: useGenreSwiper no fetch abort
- **File:** `src/hooks/useGenreSwiper.ts:59-97`
- **Category:** Race Condition
- **Issue:** No AbortController for `/api/seasons/active` fetch. Rapid refresh or unmount causes stale data or state updates on unmounted component.
- **Fix:** Add AbortController with cleanup.

#### BUG HS-6: Profile page double-fetch on first load
- **File:** `src/app/profile/page.tsx:229`
- **Category:** Unnecessary Refetch
- **Issue:** `username` in useEffect deps causes re-fetch when username is set from API response. Always makes 2 API calls instead of 1.
- **Fix:** Remove `username` from dependency array.

#### BUG HS-11: seasonIdRef stale on season switch
- **File:** `src/hooks/useRealtimeClips.ts:157-230`
- **Category:** Realtime Subscription
- **Issue:** `seasonIdRef` updated in separate useEffect that may run after subscription effect. Subscription created with wrong season filter.
- **Fix:** Use `seasonId` directly instead of ref inside subscription effect.

### LOW

#### BUG HS-4: ToastProvider context value recreated every render
- **File:** `src/components/ui/Toast.tsx:98`
- **Fix:** Wrap value in `useMemo`.

#### BUG HS-7: useTeamChat sendMessage unstable reference
- **File:** `src/hooks/useTeamChat.ts:230-236`
- **Fix:** Use `mutateAsync` ref instead of mutation object in deps.

#### BUG HS-8: No abort controller for captcha fetch
- **File:** `src/components/CaptchaVerification.tsx:167-191`
- **Fix:** Add AbortController with cleanup.

#### BUG HS-9: Realtime comments channel ref set too late
- **File:** `src/hooks/useRealtimeComments.ts:98-127`
- **Fix:** Set `channelRef.current` before `.subscribe()`.

#### BUG HS-10: TypewriterIntro onComplete restarts animation
- **File:** `src/app/story/page.tsx:148-163`
- **Fix:** Store `onComplete` in ref, remove from deps.

#### BUG HS-12: unsubscribe() instead of removeChannel() leaks refs
- **File:** `src/hooks/useRealtimeClips.ts:53-59`
- **Fix:** Use `client.removeChannel(channelRef.current)` for proper cleanup.

---

## Audit 3: API Routes (COMPLETE)

### HIGH

#### BUG API-1: Referral POST accepts arbitrary new_user_id — referral fraud
- **File:** `src/app/api/referral/route.ts:186,212-266`
- **Category:** Broken Access Control
- **Issue:** POST accepts `new_user_id` from request body without verifying it matches authenticated user. Any user can submit referrals for arbitrary users, awarding XP to referrers fraudulently.
- **Fix:** Use `session.user.userId` instead of body-provided `new_user_id`.

#### BUG API-2: Referral count race condition (read-then-write)
- **File:** `src/app/api/referral/route.ts:230,254-259`
- **Category:** TOCTOU Race Condition
- **Issue:** Referral count read, incremented in JS, written back. Two concurrent requests lose one increment, causing incorrect tier calculations.
- **Fix:** Use atomic SQL increment (`referral_count = referral_count + 1`).

#### BUG API-3: Notifications subscribe — no auth + anon key
- **File:** `src/app/api/notifications/subscribe/route.ts:10`
- **Category:** Broken Access Control
- **Issue:** No authentication check + uses anon key. Anyone can flood `push_subscriptions` table with fake records.
- **Fix:** Add auth check, use service role key.

#### BUG API-4: Direction vote change is non-atomic (delete-then-insert)
- **File:** `src/app/api/co-director/direction-vote/route.ts:222-266`
- **Category:** Race Condition / Data Loss
- **Issue:** Vote change deletes old vote, then inserts new one. Crash between = permanent vote loss. Restoration attempt may also fail.
- **Fix:** Use upsert with `onConflict` instead of delete-then-insert.

### MEDIUM

#### BUG API-5: Download route potential open redirect
- **File:** `src/app/api/movie/projects/[id]/download/route.ts:77-80`
- **Issue:** Falls back to `project.final_video_url` for redirect. If URL is malicious, becomes open redirect.
- **Fix:** Validate URL hostname against allowed domains before redirect.

#### BUG API-6: Batch moderation clip_ids no size limit
- **File:** `src/app/api/admin/moderation/route.ts:306-308`
- **Issue:** No upper bound on `clip_ids` array. Massive IN clause can cause DB timeout.
- **Fix:** Limit to 100 clips per batch.

#### BUG API-7: Admin comments DELETE no array size limit
- **File:** `src/app/api/admin/comments/route.ts:250`
- **Issue:** Same as API-6 for comment IDs.
- **Fix:** Limit to 200 per bulk delete.

#### BUG API-8: Notifications DELETE no array size limit
- **File:** `src/app/api/notifications/route.ts:293-300`
- **Issue:** Same as API-6 for notification IDs.
- **Fix:** Limit to 500 per delete.

#### BUG API-9: Genre votes GET loads ALL rows into memory
- **File:** `src/app/api/genres/route.ts:95-98`
- **Issue:** Fetches all `genre_votes` for a season with no limit. Could be millions of rows.
- **Fix:** Use database-side aggregation (COUNT + GROUP BY).

#### BUG API-10: Leaderboard voters fallback loads 50,000 rows
- **File:** `src/app/api/leaderboard/voters/route.ts:246`
- **Issue:** Fallback path loads 50k votes into memory for JS aggregation.
- **Fix:** Reduce limit or use server-side aggregation.

#### BUG API-11: Leaderboard creators fallback loads 10,000 clips
- **File:** `src/app/api/leaderboard/creators/route.ts:290`
- **Issue:** Same pattern, 10k clips loaded for JS aggregation.
- **Fix:** Use server-side aggregation.

#### BUG API-12: Feature flags PUT accepts arbitrary JSON config
- **File:** `src/app/api/admin/feature-flags/route.ts:105`
- **Issue:** No validation on config shape or size. Could store huge or deeply nested payloads.
- **Fix:** Validate type is object and size < 10KB.

#### BUG API-13: Admin reset-user-votes uses ilike (supports wildcards)
- **File:** `src/app/api/admin/reset-user-votes/route.ts:65`
- **Issue:** `ilike` supports `%` and `_` wildcards. Admin typing `%admin%` matches unintended users.
- **Fix:** Use `eq` for exact match instead of `ilike`.

#### BUG API-14: Creator profile exposes all clip statuses
- **File:** `src/app/api/creator/[id]/route.ts:57-62`
- **Issue:** No status filter — returns pending, rejected, eliminated clips publicly.
- **Fix:** Add `.in('status', ['active', 'locked'])`.

#### BUG API-15: Discover route exposes clips without status filter
- **File:** `src/app/api/discover/route.ts:88-90`
- **Issue:** No status filter on clips query via anon key. Depends entirely on RLS.
- **Fix:** Add `.eq('status', 'active')`.

#### BUG API-16: Team member kick doesn't update member_count
- **File:** `src/app/api/teams/[id]/members/route.ts:161-165`
- **Issue:** Direct delete from `team_members` without decrementing `member_count` on teams table. Count becomes stale, affecting invite limits.
- **Fix:** Use RPC or manually decrement count after delete.

### LOW

#### BUG API-17: Profile clips returns 200 for unauthenticated users
- **File:** `src/app/api/profile/clips/route.ts:73-81`
- **Fix:** Return 401 instead of empty success.

#### BUG API-18: Clip record-prompt no mandatory auth
- **File:** `src/app/api/clip/record-prompt/route.ts:90-97`
- **Fix:** Require authentication for prompt recording.

#### BUG API-19: Story last-frame no authentication
- **File:** `src/app/api/story/last-frame/route.ts:21-123`
- **Fix:** Add auth check if data should be protected.

#### BUG API-20: Profile clips/pin POST missing CSRF
- **File:** `src/app/api/profile/clips/pin/route.ts:20-122`
- **Fix:** Add `requireCsrf(req)`.

#### BUG API-21: Genre votes route uses anon key for writes
- **File:** `src/app/api/genres/route.ts:12-16`
- **Fix:** Use service role key for server-side operations.

#### BUG API-22: Genre votes POST missing CSRF
- **File:** `src/app/api/genres/route.ts:162`
- **Fix:** Add CSRF protection.

---

## Previously Fixed (this session)
- 37 bugs fixed and committed in `9f282c7` + `cc4af4f`
- Build passes, SQL migrations applied
