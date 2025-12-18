# Recent Changes - December 18, 2025

## Session Summary

### 1. Thumbnail Handling Fix (commit 907c205)
**Problem:** Next.js Image component was trying to optimize `.mp4` video URLs, causing 400 Bad Request errors.

**Solution:**
- **API routes**: Removed `video_url` fallback for `thumbnail_url` field
  - `src/app/api/vote/route.ts`
  - `src/app/api/story/route.ts`
  - `src/app/api/clip/[id]/route.ts`
- **Frontend components**: Added check for actual image before using `<Image>`, fallback to `<video>` element
  - Pattern: `thumbnail_url && !thumbnail_url.match(/\.(mp4|webm|mov|quicktime)$/i)`
  - Files: MiniLeaderboard, story/page, search/page, admin/page, watch/page

### 2. DiceBear Avatar SVG Fix (commit d62c488)
**Problem:** Next.js Image optimization can't process SVG files from api.dicebear.com (400 errors).

**Solution:** Added `unoptimized` prop to Image components for avatars:
```jsx
unoptimized={avatar_url?.includes('dicebear') || avatar_url?.endsWith('.svg')}
```
- Files: admin/page.tsx, admin/users/page.tsx, search/page.tsx

### 3. Realtime Broadcast Reliability (commit 213e396)
**Problem:** Story board took ~2 minutes to update after winner selection (broadcasts being missed).

**Solution:**
- **useStoryBroadcast hook** (`src/hooks/useRealtimeClips.ts`):
  - Added reconnection logic with exponential backoff (1s, 2s, 4s, 8s, 16s)
  - Max 5 reconnect attempts before falling back to polling
  - Added visibility change handler to reconnect when tab becomes visible
  - Handles CHANNEL_ERROR, CLOSED, TIMED_OUT states

- **Story page** (`src/app/story/page.tsx`):
  - Added visibility change handler to fetch fresh data on tab focus
  - Reduced `staleTime`: 60s → 30s
  - Reduced `refetchInterval`: 60s → 30s

- **Story API** (`src/app/api/story/route.ts`):
  - Reduced cache TTL: 30s → 15s

- **Broadcast APIs** (`assign-winner`, `reset-season`):
  - Increased broadcast delay: 100ms → 250ms for better message propagation

### 4. Realtime Client Fix (commit 3a0817b)
**Problem:** Invalid `heartbeatIntervalMs` and `reconnectAfterMs` options in Supabase client caused white screen.

**Solution:** Removed invalid options from `src/lib/supabase-client.ts`

### 5. Desktop Arrow Position Fix (commit b3b90fb)
**Problem:** Navigation arrows on story page overlapped with "Profile" link on desktop.

**Solution:** Changed arrow position from `top-1/2` to `top-[60%]` in story/page.tsx

---

## Key Patterns to Remember

### Thumbnail Image Check
```javascript
const isActualImage = thumbnail_url &&
  !thumbnail_url.match(/\.(mp4|webm|mov|quicktime)$/i) &&
  thumbnail_url !== video_url;
```

### Avatar Unoptimized Check
```jsx
<Image
  src={avatar_url}
  unoptimized={avatar_url?.includes('dicebear') || avatar_url?.endsWith('.svg')}
/>
```

### Broadcast Reconnection Pattern
- Exponential backoff: `delay = BASE_DELAY * Math.pow(2, attempts)`
- Max attempts before falling back to polling
- Reset attempts on successful connection
- Handle visibility change to reconnect

### Cache Timing Strategy (Story)
- API cache: 15s
- React Query staleTime: 30s
- React Query refetchInterval: 30s
- Worst case update delay: ~30s (down from ~2 min)
