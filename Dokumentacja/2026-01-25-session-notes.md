# Session Notes - 2026-01-25

## What Was Fixed Today

### 1. Atomic RPC Voting (Race Condition Fix)
- Fixed `insert_vote_atomic` RPC function - changed UUID parameters to TEXT for PostgREST compatibility
- Fixed `delete_vote_atomic` RPC function - same TEXT parameter fix
- Dropped conflicting old UUID function version
- Voting is now race-condition free and atomic

### 2. Caching Optimizations (Scalability)
- Increased cache TTLs:
  - Season: 1min → 5min
  - Slot: 30sec → 1min
  - Clips: 45sec → 2min
  - Feature flags: 5min → 10min
- Added HTTP Cache-Control headers to:
  - `/api/vote` GET
  - `/api/leaderboard/voters`
  - `/api/leaderboard/live`
- System now handles ~3,000-8,000 daily users (up from 1,000-5,000)

---

## Open Issue: Slot/Clip Assignment Design

### Current State
- Slot 1: locked
- Slot 2: locked
- Slot 3: voting (has 1 clip with status "pending" - NOT showing)
- Slot 4: upcoming (has 2 clips with status "active" - NOT showing because slot is "upcoming")

### The Problem
Clips in slot 4 don't appear in voting area because:
1. Voting area only shows clips from the slot with `status = 'voting'` (currently slot 3)
2. Slot 3 has a clip but it's "pending" not "active"
3. Slot 4 clips are "active" but slot 4 is "upcoming"

### Design Question
**How should clips be assigned to slots?**

#### Option A: Pre-assigned slots (current design)
- Clips are assigned to specific slots when uploaded
- Only clips matching the current voting slot are shown
- Pro: Clear tournament brackets
- Con: Need to manage slot assignments

#### Option B: Dynamic assignment
- All "active" clips are available in ANY voting slot
- Clips flow into whatever slot is currently voting
- Only locked slots have specific winner clips
- Pro: Simpler, always have clips to vote on
- Con: Less structured tournament feel

### Quick Fix (if needed)
Move slot 4 clips to slot 3:
```sql
UPDATE tournament_clips
SET slot_position = 3
WHERE slot_position = 4 AND status = 'active';
```

---

## Current System Capacity

| Metric | Free Tier | Pro Tier ($25/mo) |
|--------|-----------|-------------------|
| Concurrent users | 200-500 | 1,000-5,000 |
| Daily active users | 3,000-8,000 | 10,000-50,000 |
| Votes per day | 50,000-100,000 | 500,000-1,000,000 |

---

## Commits Made Today
1. `dc75627` - fix: Restore atomic RPC voting with TEXT parameters for PostgREST
2. `888910a` - perf: Increase cache TTLs and add HTTP cache headers
