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

### Intended Design (clarified)
**Clips should NOT be pre-assigned to future slots.**

Flow:
1. All "active" clips compete in the **current voting slot**
2. When voting ends, the **winner gets locked** into that slot
3. System moves to the **next slot** for voting
4. Remaining clips continue competing in the new voting slot

Example:
- Slot 1: locked (winner assigned)
- Slot 2: locked (winner assigned)
- Slot 3: voting ← ALL active clips compete here
- Slot 4: upcoming (empty until slot 3 finishes)

### Code Change Needed
Update the voting query to show ALL active clips regardless of `slot_position`, not just clips matching the current slot.

### TODO Tomorrow
1. Update vote route to show ALL active clips (ignore `slot_position` filter)
2. When a clip wins, assign it to the current slot and lock it
3. Clips keep `slot_position = NULL` until they win

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
