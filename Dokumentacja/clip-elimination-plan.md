# Losing Clips Lifecycle: Elimination, Download, Pin & Storage Cleanup

## Problem

- **Losing clips carry forward forever.** When a slot locks, ALL non-winning active clips move to the next slot with reset votes. They compete indefinitely through all 75 slots.
- **Carry-forward makes no narrative sense.** Slots have no themes/prompts — a clip that lost at Slot 3 has no relevance to Slot 4.
- **Videos never cleaned up.** Storage grows monotonically. Rejected clips, eliminated clips, deleted accounts — all leave orphaned video files.
- **Users lose their work.** No way to download or preserve a losing clip.

---

## Solution: Immediate Elimination + Download/Pin + Timed Cleanup

**Core changes:**
1. When a winner is selected, all other active clips in that slot are **immediately eliminated** — no carry-forward
2. Users get a **grace period** (default 14 days, admin-configurable) to **download** or **pin** their eliminated clip to their profile
3. Pinned clips are preserved indefinitely (video kept in storage)
4. Non-pinned, non-downloaded clips have their videos deleted after the grace period
5. Clip DB rows remain forever for profile history (just the video file gets cleaned up)

---

## Phase 1: Database Schema + Feature Flag

**File:** `supabase/sql/migration-clip-elimination.sql` (NEW)

```sql
-- New columns on tournament_clips
ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS eliminated_at TIMESTAMPTZ;
ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS elimination_reason TEXT;
ALTER TABLE tournament_clips ADD COLUMN IF NOT EXISTS video_deleted_at TIMESTAMPTZ;

-- Backfill: eliminate orphaned active clips in finished seasons
UPDATE tournament_clips tc
SET status = 'eliminated', eliminated_at = NOW(), elimination_reason = 'season_ended'
FROM seasons s
WHERE tc.season_id = s.id AND s.status = 'finished' AND tc.status = 'active';

-- Indexes for cleanup queries
CREATE INDEX IF NOT EXISTS idx_clips_elimination_cleanup
  ON tournament_clips(status, eliminated_at)
  WHERE status IN ('eliminated', 'rejected') AND is_pinned = FALSE;
CREATE INDEX IF NOT EXISTS idx_clips_pinned
  ON tournament_clips(user_id) WHERE is_pinned = TRUE;

-- Feature flag for configurable grace period
INSERT INTO feature_flags (key, name, description, enabled, category, config)
VALUES (
  'clip_elimination',
  'Clip Elimination Settings',
  'Controls grace period before eliminated clip videos are deleted from storage',
  true,
  'engagement',
  '{"grace_period_days": 14}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
```

---

## Phase 2: Eliminate Losing Clips Immediately (remove carry-forward)

All 3 advance paths currently move losing clips to the next slot. Change them to **eliminate** losing clips instead.

### `src/app/api/cron/auto-advance/route.ts` (~line 245-258)
Replace the carry-forward UPDATE with:
```typescript
// Eliminate losing clips — they don't carry forward
.update({
  status: 'eliminated',
  eliminated_at: new Date().toISOString(),
  elimination_reason: 'lost'
})
.eq('status', 'active')
.neq('id', winnerId)
```
Remove `movedClips` count from next-slot activation logic. Next slot always starts as `waiting_for_clips`.

### `src/app/api/admin/assign-winner/route.ts` (~line 228-240)
Same change: eliminate instead of move. Next slot → `waiting_for_clips`.

### `src/app/api/admin/advance-slot/route.ts` (~line 247-259)
Same change: eliminate instead of move.

### `supabase/sql/fix-admin-winner-transaction.sql`
Update `assign_winner_atomic` RPC:
- Replace `UPDATE ... SET slot_position = p_next_slot_position` with `SET status = 'eliminated', eliminated_at = NOW(), elimination_reason = 'lost'`
- Next slot always starts as `waiting_for_clips`
- Return `clips_eliminated` count in result

---

## Phase 3: Season-End Cleanup

In auto-advance, assign-winner, and advance-slot — when the season reaches its final slot:
```sql
UPDATE tournament_clips
SET status = 'eliminated', eliminated_at = NOW(), elimination_reason = 'season_ended'
WHERE season_id = :seasonId AND status = 'active';
```

---

## Phase 4: Elimination Notification

When clips are eliminated (in all 3 advance paths), fire a notification:
```typescript
import('@/lib/notifications').then(({ createNotification }) => {
  // For each eliminated clip's user_id:
  createNotification({
    user_key: `user_${clip.user_id}`,
    type: 'clip_rejected',  // reuse existing type
    title: 'Your clip was eliminated',
    message: `"${clip.title}" didn't win Slot ${slot}. Download or pin it within ${graceDays} days to keep the video.`,
    action_url: '/profile',
    metadata: { clipId: clip.id, graceDays },
  });
});
```

Read `grace_period_days` from `feature_flags` table (`key = 'clip_elimination'`, `config->'grace_period_days'`).

---

## Phase 5: Profile — Download + Pin

### `src/app/api/profile/clips/route.ts`
- Include `is_pinned`, `eliminated_at`, `elimination_reason`, `video_deleted_at` in response
- Compute `days_until_deletion` for eliminated clips: `grace_period_days - days_since_eliminated`

### `src/app/api/profile/clips/pin/route.ts` (NEW)
- POST: Toggle `is_pinned` on a clip owned by the authenticated user
- Only works on `status = 'eliminated'` clips where `video_deleted_at IS NULL`
- Limit: max 5 pinned clips per user (prevent abuse)

### `src/app/profile/page.tsx`
- **Download button** on eliminated clips (uses existing `video_url` with `<a download>`)
- **Pin button** — toggles `is_pinned`, shows pin icon when active
- **Countdown badge** — "X days left" on non-pinned eliminated clips
- **"Video deleted" state** — gray placeholder when `video_deleted_at` is set
- Show "Lost at Slot X" or "Season ended" status text

### `src/types/index.ts`
- Update `DbClip.status` to include `'eliminated'`
- Add `is_pinned`, `eliminated_at`, `elimination_reason`, `video_deleted_at`, `days_until_deletion` fields

---

## Phase 6: Storage Cleanup Cron

### `src/app/api/cron/cleanup-videos/route.ts` (NEW)
- Runs every 6 hours (`0 */6 * * *`)
- Reads `grace_period_days` from `feature_flags` config (`key = 'clip_elimination'`)
- Finds clips where:
  - `status IN ('eliminated', 'rejected')`
  - `is_pinned = FALSE`
  - `eliminated_at < NOW() - grace_period_days`
  - `video_deleted_at IS NULL`
- Extracts storage key from `video_url`
- Calls `deleteFiles()` from `src/lib/storage/index.ts`
- Sets `video_deleted_at = NOW()`, clears `video_url` and `thumbnail_url`
- Processes in batches of 50

### `src/lib/storage/index.ts`
- Add `extractStorageKey(videoUrl)` helper to parse storage path from full URL

### `vercel.json`
- Add `{ "path": "/api/cron/cleanup-videos", "schedule": "0 */6 * * *" }`

---

## Phase 7: Account Deletion Fix

### `src/app/api/account/delete/route.ts`
- Before deleting clip DB rows, call `deleteFiles()` for each clip's `video_url`
- Uses the same `extractStorageKey()` helper

---

## Phase 8: Admin Improvements

### `src/app/api/admin/clips/route.ts`
- Add pagination (page/limit query params, `.range()` on query)
- Currently fetches ALL clips with no limit

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/sql/migration-clip-elimination.sql` | NEW — schema + backfill + indexes + feature flag |
| `supabase/sql/fix-admin-winner-transaction.sql` | Update atomic RPC: eliminate instead of move |
| `src/app/api/cron/auto-advance/route.ts` | Eliminate losers instead of carry-forward |
| `src/app/api/admin/assign-winner/route.ts` | Eliminate losers instead of carry-forward |
| `src/app/api/admin/advance-slot/route.ts` | Eliminate losers instead of carry-forward |
| `src/app/api/profile/clips/route.ts` | Add elimination fields + days_until_deletion |
| `src/app/api/profile/clips/pin/route.ts` | NEW — toggle pin on eliminated clips |
| `src/app/profile/page.tsx` | Download button, pin button, countdown, deleted state |
| `src/types/index.ts` | Update DbClip with elimination + pin fields |
| `src/app/api/cron/cleanup-videos/route.ts` | NEW — storage cleanup cron |
| `src/lib/storage/index.ts` | Add extractStorageKey() helper |
| `src/app/api/account/delete/route.ts` | Add video storage deletion |
| `src/app/api/admin/clips/route.ts` | Add pagination |
| `vercel.json` | Add cleanup-videos cron |

## Verification

1. **Phase 2**: Trigger auto-advance. Losing clips get `status = 'eliminated'`, `elimination_reason = 'lost'`. Next slot starts empty.
2. **Phase 3**: Season reaches final slot. Remaining active clips → `eliminated` with `season_ended`.
3. **Phase 4**: Eliminated clip owner receives notification with grace period warning.
4. **Phase 5**: Profile shows download/pin buttons on eliminated clips. Pin toggles `is_pinned`. Countdown shows days remaining.
5. **Phase 6**: Set `eliminated_at` to 15 days ago, `is_pinned = false`. Trigger cleanup. Video deleted, `video_deleted_at` set. Repeat with `is_pinned = true` — video preserved.
6. **Phase 6b**: Admin changes `grace_period_days` to 7 via feature flags. Cleanup uses new value.
7. **Phase 7**: Delete test account. Video files removed from storage.
8. `npm run build` passes after each phase.
