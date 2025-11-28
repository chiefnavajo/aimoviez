# Auto-Advance Timer & Random Clip Sampling

## Overview

Two major features to handle thousands of clips and automate round progression.

---

## 1. Auto-Advance Timer

### How It Works

- Each slot has a `voting_ends_at` timestamp
- Background cron job checks every minute
- When time expires → winner auto-selected → next slot opens
- Admin can still manually advance at any time

### Configuration

**Default Duration:** 24 hours per slot

To change duration, update in database:
```sql
UPDATE story_slots 
SET voting_duration_hours = 48  -- 48 hours
WHERE status = 'voting';
```

### Vercel Cron Setup

The `vercel.json` configures a cron job:
```json
{
  "crons": [
    {
      "path": "/api/cron/auto-advance",
      "schedule": "* * * * *"
    }
  ]
}
```

**Note:** Vercel Hobby plan allows 2 cron jobs. Pro plan allows more.

### Manual Trigger

You can manually trigger auto-advance check:
```bash
curl -X POST https://your-site.vercel.app/api/cron/auto-advance
```

### Security (Optional)

Add `CRON_SECRET` to your environment variables:
```env
CRON_SECRET=your-secret-key
```

Then call with header:
```bash
curl -X POST https://your-site.vercel.app/api/cron/auto-advance \
  -H "Authorization: Bearer your-secret-key"
```

---

## 2. Random Clip Sampling

### How It Works

Instead of showing ALL clips (overwhelming with 1000+), we show **8 random clips** per session.

**Sampling Algorithm:**

1. **Priority 1:** Unvoted clips user hasn't seen
2. **Priority 2:** Unvoted clips user has seen (give another chance)
3. **Priority 3:** Already voted clips (fill remaining spots)

**Fairness Boosts:**

- Fresh clips (< 2 hours old) get priority
- Clips with fewer views get priority
- Every clip guaranteed exposure

### API Response Changes

```json
{
  "clips": [...],           // 8 sampled clips
  "totalClipsInSlot": 1000, // Total competing
  "clipsShown": 8,          // Shown this request
  "hasMoreClips": true,     // More to discover
  "votingEndsAt": "...",    // Timer countdown
  "timeRemainingSeconds": 3600
}
```

### View Tracking

New `clip_views` table tracks which users saw which clips:
- Prevents showing same clips repeatedly
- Ensures fair rotation
- Tracks engagement metrics

---

## Database Migration

Run this in Supabase SQL Editor:

```sql
-- 1. Timer fields for story_slots
ALTER TABLE story_slots
  ADD COLUMN IF NOT EXISTS voting_duration_hours integer DEFAULT 24,
  ADD COLUMN IF NOT EXISTS voting_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS voting_ends_at timestamptz;

-- 2. View tracking for clips
ALTER TABLE tournament_clips
  ADD COLUMN IF NOT EXISTS view_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_shown_at timestamptz;

-- 3. Clip views tracking table
CREATE TABLE IF NOT EXISTS clip_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL,
  voter_key text NOT NULL,
  viewed_at timestamptz DEFAULT now(),
  voted boolean DEFAULT false
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_clip_views_voter ON clip_views(voter_key, clip_id);
CREATE INDEX IF NOT EXISTS idx_clip_views_clip ON clip_views(clip_id);
CREATE INDEX IF NOT EXISTS idx_clips_view_count ON tournament_clips(view_count, slot_position);
CREATE INDEX IF NOT EXISTS idx_slots_voting_ends ON story_slots(voting_ends_at) WHERE status = 'voting';

-- 5. Set timer for current voting slot (24h from now)
UPDATE story_slots
SET 
  voting_started_at = COALESCE(voting_started_at, now()),
  voting_ends_at = COALESCE(voting_ends_at, now() + interval '24 hours'),
  voting_duration_hours = 24
WHERE status = 'voting';
```

---

## Frontend Integration

### Countdown Display

The admin panel now shows:
```
Slot 1 of 75 · 4 clips competing · Season: active
⏱️ Auto-advance in: 23h 45m 12s
```

### "Load More" Button (Optional Enhancement)

```tsx
const VotingPage = () => {
  const [clips, setClips] = useState([]);
  
  const loadMoreClips = async () => {
    const res = await fetch('/api/vote');
    const data = await res.json();
    setClips(data.clips);
  };

  return (
    <div>
      {clips.map(clip => <ClipCard key={clip.id} clip={clip} />)}
      
      {data.hasMoreClips && (
        <button onClick={loadMoreClips}>
          Show More Clips ({data.totalClipsInSlot - data.votedClipIds.length} remaining)
        </button>
      )}
    </div>
  );
};
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `src/app/api/vote/route.ts` | Random sampling, timer in response |
| `src/app/api/cron/auto-advance/route.ts` | NEW - cron job handler |
| `src/app/api/admin/slots/route.ts` | Timer info in response |
| `src/app/api/admin/advance-slot/route.ts` | Sets timer on next slot |
| `src/app/admin/page.tsx` | Countdown display |
| `vercel.json` | NEW - cron configuration |
| `supabase/sql/migration-auto-advance.sql` | NEW - DB migration |

---

## Testing

1. **Set short timer for testing:**
```sql
UPDATE story_slots
SET voting_ends_at = now() + interval '2 minutes'
WHERE status = 'voting';
```

2. **Watch admin panel countdown**

3. **Trigger cron manually:**
```bash
curl -X POST http://localhost:3000/api/cron/auto-advance
```

4. **Verify slot advanced and new timer set**
