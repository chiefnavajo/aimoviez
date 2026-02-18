# Slot Reorganization Tool - Implementation Plan

**Date:** 2026-02-03 20:22
**Author:** Claude
**Status:** Draft

---

## Problem Statement

Currently, admins cannot easily reorganize slot positions. Operations like "delete slots 1 & 2 and shift remaining slots down" require manual SQL queries with complex constraint handling.

### Current Limitations
- No UI for reordering/moving slot positions
- No batch operations on multiple slots
- No "delete and shift" functionality
- Unique constraint on `(season_id, slot_position)` complicates bulk updates

---

## Proposed Solution

Build an admin tool for slot reorganization with three core operations:

### 1. Delete Slots & Shift
Delete one or more slots and automatically shift remaining slots down to fill gaps.

**Example:** Delete slots 1 & 2 → slots 3,4,5,6 become 1,2,3,4

### 2. Move Clip to Slot
Move a clip from one slot to another (swap or replace).

### 3. Swap Two Slots
Exchange positions of two slots (including their clips and status).

---

## Technical Design

### Database Changes

**No schema changes required.** Operations work with existing tables:
- `story_slots` (slot_position, status, winner_tournament_clip_id)
- `tournament_clips` (slot_position, status)

### New API Endpoint

**File:** `/src/app/api/admin/slots/reorganize/route.ts`

```typescript
// POST /api/admin/slots/reorganize
interface ReorganizeRequest {
  action: 'delete_and_shift' | 'move_clip' | 'swap_slots';
  season_id?: string; // defaults to active season

  // For delete_and_shift
  slot_positions_to_delete?: number[];

  // For move_clip
  clip_id?: string;
  target_slot_position?: number;

  // For swap_slots
  slot_a_position?: number;
  slot_b_position?: number;
}
```

### Implementation Details

#### Action 1: Delete & Shift

```
Input: slot_positions_to_delete = [1, 2]
Current: [1, 2, 3, 4, 5, 6, 7, ...]
Result:  [1, 2, 3, 4, 5, ...]  (old 3→1, 4→2, etc.)
```

**Steps:**
1. Validate all slots exist
2. Delete clips in target slots (or soft-delete)
3. Delete story_slots entries
4. Calculate shift amount (number of deleted slots)
5. Use "offset trick" to avoid unique constraint:
   - Add +10000 to all remaining slot positions
   - Subtract (10000 + shift_amount) to get final positions
6. Update both `story_slots` and `tournament_clips` tables
7. Log audit action

**SQL Pattern:**
```sql
-- Temporary offset to avoid constraint violation
UPDATE story_slots SET slot_position = slot_position + 10000 WHERE season_id = ?;
UPDATE tournament_clips SET slot_position = slot_position + 10000 WHERE season_id = ?;

-- Delete target slots
DELETE FROM tournament_clips WHERE slot_position IN (10001, 10002) AND season_id = ?;
DELETE FROM story_slots WHERE slot_position IN (10001, 10002) AND season_id = ?;

-- Shift back down
UPDATE story_slots SET slot_position = slot_position - 10002 WHERE season_id = ?;
UPDATE tournament_clips SET slot_position = slot_position - 10002 WHERE season_id = ?;
```

#### Action 2: Move Clip to Slot

**Steps:**
1. Get clip's current slot
2. Check target slot status (must be unlocked or waiting)
3. Update clip's slot_position
4. If target slot had a winner, handle replacement
5. Update source slot status if now empty

#### Action 3: Swap Slots

**Steps:**
1. Get both slots and their clips
2. Use offset trick:
   - Move slot A to position +10000
   - Move slot B to position A
   - Move slot A (at +10000) to position B
3. Swap winner references if locked

---

## Admin UI Changes

### File: `/src/app/admin/page.tsx`

Add new section: **"Slot Reorganization"**

#### UI Components

**1. Delete & Shift Panel**
```
┌─────────────────────────────────────────────┐
│  Delete Slots & Shift                       │
├─────────────────────────────────────────────┤
│  Select slots to delete:                    │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐            │
│  │1 │ │2 │ │3 │ │4 │ │5 │ │6 │ ...        │
│  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘            │
│  (click to select/deselect)                 │
│                                             │
│  Selected: 1, 2                             │
│  Preview: Slots 3-75 will shift to 1-73     │
│                                             │
│  [Cancel]  [Delete & Shift Selected]        │
└─────────────────────────────────────────────┘
```

**2. Quick Actions per Slot (in existing slot list)**
- Add "Move" button → opens modal to select target
- Add "Swap with..." button → opens slot picker
- Add "Delete" button → confirms and auto-shifts

**3. Confirmation Modal**
```
┌─────────────────────────────────────────────┐
│  ⚠️  Confirm Slot Deletion                  │
├─────────────────────────────────────────────┤
│  You are about to delete 2 slot(s):         │
│                                             │
│  • Slot 1: "Clip 1767316668502" (locked)   │
│  • Slot 2: "Clip 1767316402082" (locked)   │
│                                             │
│  This will:                                 │
│  ✓ Delete 2 clips permanently              │
│  ✓ Shift slots 3-75 → 1-73                 │
│  ✓ Update 4 locked clips' positions        │
│                                             │
│  This action cannot be undone.              │
│                                             │
│  [Cancel]  [Confirm Delete & Shift]         │
└─────────────────────────────────────────────┘
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/app/api/admin/slots/reorganize/route.ts` | CREATE | New API endpoint |
| `src/app/admin/page.tsx` | MODIFY | Add reorganization UI section |
| `src/lib/audit-log.ts` | MODIFY | Add new audit actions |
| `src/types/index.ts` | MODIFY | Add TypeScript interfaces (optional) |

---

## Audit Actions to Add

```typescript
| 'slot_delete_and_shift'    // Deleted slots and shifted remaining
| 'slot_swap'                // Swapped two slot positions
| 'slot_move_clip'           // Moved clip between slots
```

---

## Safety Considerations

1. **Confirmation required** for all destructive operations
2. **Preview changes** before execution
3. **Audit logging** for all reorganization actions
4. **Transaction safety** - all operations atomic (succeed or rollback)
5. **Prevent deleting active voting slot** without explicit confirmation

---

## Testing Checklist

- [ ] Delete single slot, verify shift works
- [ ] Delete multiple non-consecutive slots (e.g., 1 and 3)
- [ ] Delete slots with locked winners
- [ ] Delete slots with active clips (voting)
- [ ] Swap two locked slots
- [ ] Swap locked slot with empty slot
- [ ] Move clip from locked slot to empty slot
- [ ] Verify audit logs capture all actions
- [ ] Test constraint handling (no duplicate positions)
- [ ] Test with 75 slots (full season)

---

## Implementation Order

1. **Phase 1:** Create API endpoint with `delete_and_shift` action
2. **Phase 2:** Add basic UI button to trigger delete & shift
3. **Phase 3:** Add swap functionality
4. **Phase 4:** Add move clip functionality
5. **Phase 5:** Polish UI with previews and confirmations

---

## Estimated Scope

- **API endpoint:** ~150 lines
- **UI changes:** ~200 lines
- **Audit log updates:** ~10 lines
- **Total:** ~360 lines of code

---

## Questions to Resolve

1. Should deleted clips be soft-deleted or hard-deleted?
2. Should we allow deleting slots with active voting?
3. Should there be a "preview" dry-run mode?
4. Should we support undo functionality?
