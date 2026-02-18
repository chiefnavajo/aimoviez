# Admin Free Clip Assignment — "God Mode Story Editor"

## Goal

Allow admin to assign ANY clip (any status) to ANY slot (including locked) to fix mistakes and rebuild the story.

---

## New API: `POST /api/admin/assign-clip-to-slot`

**File:** `src/app/api/admin/assign-clip-to-slot/route.ts` (new)

**Input:**
```json
{ "clipId": "uuid", "targetSlotPosition": 7 }
```

**Algorithm:**

1. Auth + rate limit (15/min admin_write)
2. Validate `clipId` (UUID) and `targetSlotPosition` (integer 1-75)
3. Fetch active season
4. Fetch clip — 404 if not found, 400 if wrong season
5. Fetch target slot — 404 if not found
6. **No-op check:** If clip is already the winner of target slot, return early
7. **Source slot cleanup:** If clip is currently a winner in a DIFFERENT slot:
   - Clear that slot's `winner_tournament_clip_id`
   - Check if other active clips exist in that slot:
     - Yes → set slot to `voting` with fresh 24h timer
     - No → set slot to `waiting_for_clips`, clear timer fields
8. **Target slot cleanup:** If target slot has a different winner:
   - Revert old winner clip's status to `pending`
9. **Assign:**
   - Update clip: `status = 'locked'`, `slot_position = targetSlotPosition`, `segment_index = targetSlotPosition`
   - Update target slot: `status = 'locked'`, `winner_tournament_clip_id = clipId`, clear timer fields
10. Broadcast `winner-selected` event on `story-updates` channel (reuse existing event)
11. Audit log with `action: 'free_assign_clip'`

**Edge cases:**

| Scenario | Behavior |
|----------|----------|
| Clip already winner of target slot | No-op, return success |
| Clip is winner of slot 3, assigning to slot 7 | Slot 3 loses winner, gets `waiting_for_clips` or `voting` |
| Target slot is currently voting | Voting stops, slot becomes locked |
| Assigning a rejected/pending clip | Status changes directly to `locked` |
| Target slot has existing winner | Old winner reverted to `pending` |

---

## Admin UI: Modal with Clip + Slot Selectors

**File:** `src/app/admin/page.tsx`

**Trigger:** New "Free Assign" button in the slot management toolbar area.

**Modal layout:**
```
+------------------------------------------+
|  Free Clip Assignment                     |
|  ----------------------------------------|
|                                           |
|  Select Clip:                             |
|  [Search input filtering clips list]      |
|  [Scrollable list: title, user, status]   |
|                                           |
|  Assign to Slot:                          |
|  [Number input 1-75]                      |
|  Shows: current slot status & winner name |
|                                           |
|  --- Warnings (if applicable) ---         |
|  [!] Slot 7 has winner "X" — will revert |
|  [!] Clip is winner of slot 3 — cleared  |
|  [!] Slot 7 is voting — will stop        |
|                                           |
|  [Cancel]  [Confirm Assignment]           |
+------------------------------------------+
```

**Data source:** Uses existing `clips` state array (already fetched). Fetches all slots when modal opens via `GET /api/admin/slots`.

**State to add:**
```typescript
const [showFreeAssign, setShowFreeAssign] = useState(false);
const [freeAssignClipId, setFreeAssignClipId] = useState<string>('');
const [freeAssignTargetSlot, setFreeAssignTargetSlot] = useState<number>(1);
const [freeAssigning, setFreeAssigning] = useState(false);
const [freeAssignResult, setFreeAssignResult] = useState<{success: boolean; message: string} | null>(null);
const [allSlots, setAllSlots] = useState<any[]>([]);
```

---

## Audit Log Update

**File:** `src/lib/audit-log.ts`

Add `'free_assign_clip'` to the `AuditAction` type union.

Log details: clip ID/title/username, previous status, previous slot, target slot, source slot cleared, previous winner reverted.

---

## Files Summary

| File | Change |
|------|--------|
| `src/app/api/admin/assign-clip-to-slot/route.ts` | NEW — core API endpoint (~250 lines) |
| `src/app/admin/page.tsx` | Add Free Assign button, modal, state, handler (~180 lines) |
| `src/lib/audit-log.ts` | Add `'free_assign_clip'` to AuditAction type |

---

## Verification

1. **Build:** `npx next build` — no errors
2. **Assign clip to empty slot:** Pick a pending clip, assign to upcoming slot → clip locked, slot locked
3. **Assign clip to slot with winner:** Old winner reverts to pending, new clip takes over
4. **Move winner between slots:** Clip is winner of slot 3, assign to slot 7 → slot 3 cleared, slot 7 locked
5. **Assign to voting slot:** Voting stops, slot becomes locked with assigned clip
6. **Assign rejected clip:** Works — clip becomes locked directly
7. **Self-assign (no-op):** Clip already winner of target → returns success, no changes
8. **Audit trail:** Check audit_logs table for `free_assign_clip` entries with correct details
