# Season Management System - Recovery Documentation

**Last Updated:** 2025-12-25
**Commit:** `c468368` - Implement admin-controlled season creation (hybrid approach)

---

## Overview

This document describes the admin-controlled season management system implemented to replace automatic season creation. Use this for recovery if changes are lost or need to be recreated.

---

## Architecture

### Before (Auto-Create)
```
Season Ends → Auto-create Season N+1 → Infinite loop if no clips
```

### After (Admin-Controlled)
```
Season Ends → Show "Coming Soon" → Admin creates new season → Timer starts on first upload
```

---

## Files Modified

### 1. `/src/app/api/admin/advance-slot/route.ts`
**Purpose:** Advances to next slot when admin clicks "Advance"

**Changes:**
- REMOVED: `createNextSeason()` function (lines 24-95 in old file)
- REMOVED: All calls to `createNextSeason()`
- UPDATED: Response messages to say "Create a new season from the admin panel"

**Key code that should NOT exist:**
```typescript
// This should NOT be in the file:
async function createNextSeason(...) { ... }
await createNextSeason(supabase, seasonRow.id);
```

---

### 2. `/src/app/api/admin/assign-winner/route.ts`
**Purpose:** Manually assigns a winner clip

**Changes:**
- REMOVED: `createNextSeason()` function
- REMOVED: All calls to `createNextSeason()`

**Key code that should NOT exist:**
```typescript
// This should NOT be in the file:
const nextSeasonResult = await createNextSeason(supabase, season.id);
```

---

### 3. `/src/app/api/cron/auto-advance/route.ts`
**Purpose:** Cron job that auto-advances expired voting slots

**Changes:**
- REMOVED: `createNextSeason()` function
- REMOVED: All calls to `createNextSeason()`
- UPDATED: Result messages to include "Admin needs to create new season"

**Key code that should NOT exist:**
```typescript
// This should NOT be in the file:
const nextSeasonResult = await createNextSeason(supabase, slot.season_id);
```

---

### 4. `/src/app/api/admin/seasons/route.ts`
**Purpose:** API for creating/managing seasons

**Changes:**
- UPDATED: POST endpoint to set first slot to 'voting' when `auto_activate: true`
- UPDATED: First slot created with `voting_started_at: null` (timer starts on first upload)

**Key code (around line 155-164):**
```typescript
// Create slots for this season
// If auto_activate, set first slot to 'voting' (timer starts when first clip is uploaded)
const slots = Array.from({ length: total_slots }, (_, i) => ({
  season_id: season.id,
  slot_position: i + 1,
  status: (auto_activate && i === 0) ? 'voting' : 'upcoming',
  voting_started_at: null, // Timer starts when first clip is uploaded
  voting_ends_at: null,
  voting_duration_hours: 24,
  created_at: new Date().toISOString(),
}));
```

---

### 5. `/src/app/api/upload/register/route.ts`
**Purpose:** Registers uploaded clips to database

**Changes:**
- ADDED: Check for `isFirstClipInSlot` (line ~133)
- ADDED: Start voting timer when first clip is uploaded (lines ~172-194)

**Key code:**
```typescript
const isFirstClipInSlot = !votingSlot.voting_started_at;

// After clip insert success:
if (isFirstClipInSlot) {
  const durationHours = votingSlot.voting_duration_hours || 24;
  const now = new Date();
  const votingEndsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

  await supabase
    .from('story_slots')
    .update({
      voting_started_at: now.toISOString(),
      voting_ends_at: votingEndsAt.toISOString(),
    })
    .eq('id', votingSlot.id);
}
```

---

### 6. `/src/app/admin/page.tsx`
**Purpose:** Admin dashboard UI

**Changes:**
- ADDED: State variables for create season modal (lines ~208-212)
- ADDED: `handleCreateSeason()` function (lines ~246-292)
- ADDED: "New Season" button in Season Filter section (lines ~1708-1716)
- ADDED: Create Season Modal (lines ~2497-2608)

**Key state variables:**
```typescript
const [showCreateSeason, setShowCreateSeason] = useState(false);
const [creatingSeason, setCreatingSeason] = useState(false);
const [newSeasonLabel, setNewSeasonLabel] = useState('');
const [newSeasonSlots, setNewSeasonSlots] = useState(75);
```

**Key handler:**
```typescript
const handleCreateSeason = async () => {
  // Calls POST /api/admin/seasons with:
  // { label, total_slots, auto_activate: true }
};
```

---

### 7. `/src/app/dashboard/page.tsx`
**Purpose:** Main voting dashboard for users

**Changes:**
- ADDED: `votingStartedAt` to VotingState interface (line ~153)
- ADDED: Transform includes `votingStartedAt` (line ~195)
- ADDED: `noSeason` check for 'none' status (line ~1237)
- ADDED: "New Season Coming Soon" UI block (lines ~1271-1296)
- UPDATED: "Season Complete" message includes "New season coming soon!" (line ~1254)

**Key empty state logic:**
```typescript
const seasonEnded = votingData?.seasonStatus === 'finished';
const noSeason = votingData?.seasonStatus === 'none';
const waitingForUploads = (votingData?.currentSlot ?? 0) > 0 && !votingData?.votingStartedAt;

// Order of checks:
// 1. seasonEnded → "Season Complete!"
// 2. noSeason → "New Season Coming Soon"
// 3. waitingForUploads → "Waiting for Uploads"
// 4. default → "No clips yet"
```

---

## Database State Reference

### Seasons Table
| status | Description |
|--------|-------------|
| `draft` | Created but not active |
| `active` | Current active season |
| `finished` | Season completed |

### Story Slots Table
| status | Description |
|--------|-------------|
| `upcoming` | Not yet available for voting |
| `voting` | Currently accepting votes |
| `locked` | Voting completed, winner assigned |

### Key Fields for Timer
| Field | Description |
|-------|-------------|
| `voting_started_at` | NULL = timer not started, DATE = timer running |
| `voting_ends_at` | NULL = no deadline, DATE = voting deadline |
| `voting_duration_hours` | Default 24 hours |

---

## Recovery Steps

### If changes are lost, recreate by:

1. **Remove createNextSeason from 3 files:**
   ```bash
   # Check current state
   grep -r "createNextSeason" src/app/api/

   # Should return 0 results for:
   # - advance-slot/route.ts
   # - assign-winner/route.ts
   # - auto-advance/route.ts
   ```

2. **Update seasons API (POST):**
   - Set first slot to 'voting' when auto_activate
   - Set voting_started_at and voting_ends_at to null

3. **Update upload/register:**
   - Check if `votingSlot.voting_started_at` is null
   - If null, start timer after clip insert

4. **Add Create Season UI to admin:**
   - Button next to season filter
   - Modal with label and slots input
   - Calls POST /api/admin/seasons with auto_activate: true

5. **Update dashboard empty states:**
   - Add 'none' status handling
   - Add 'waitingForUploads' check (currentSlot > 0 && !votingStartedAt)

---

## Testing Checklist

- [ ] Season ends → No auto-create of new season
- [ ] Dashboard shows "Season Complete" when finished
- [ ] Dashboard shows "New Season Coming Soon" when no active season
- [ ] Upload page blocks when no active season
- [ ] Admin can create new season from panel
- [ ] New season slot 1 has null timer
- [ ] First clip upload starts the timer
- [ ] Dashboard shows "Waiting for Uploads" before first clip

---

## Rollback

To restore auto-create behavior, revert commit:
```bash
git revert c468368
```

Or restore from before this change:
```bash
git checkout c468368~1 -- src/app/api/admin/advance-slot/route.ts
git checkout c468368~1 -- src/app/api/admin/assign-winner/route.ts
git checkout c468368~1 -- src/app/api/cron/auto-advance/route.ts
```

---

## Related Commits

| Commit | Description |
|--------|-------------|
| `c468368` | Implement admin-controlled season creation |
| `f7835cd` | Add RECENT_CHANGES.md documenting session fixes |
| `b3b90fb` | Move desktop navigation arrows |

---

## Contact

For issues with this implementation, check:
1. Console logs with `[advance-slot]`, `[assign-winner]`, `[auto-advance]`, `[REGISTER]` prefixes
2. Supabase logs for database errors
3. Network tab for API response errors
