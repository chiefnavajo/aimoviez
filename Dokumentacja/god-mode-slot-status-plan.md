# God Mode — Add Slot Status Control Plan

## Goal

Add a third tab to the God Mode modal: **"Change Slot Status"** — allowing the admin to change any slot's status directly with automatic cleanup (unlock winners, set/clear voting timers).

Current tabs: `[ Assign to Slot ] [ Change Clip Status ]`
New tabs: `[ Assign to Slot ] [ Change Clip Status ] [ Change Slot Status ]`

---

## Slot Status System Overview

**Valid slot statuses** (DB constraint):
- `upcoming` — Not yet active
- `voting` — Actively accepting votes (24h timer)
- `locked` — Winner selected, slot complete
- `waiting_for_clips` — Paused, no clips available
- `archived` — Historical (unused in current system)

**Key columns on `story_slots` table:**
- `id`, `season_id`, `slot_position` (1-75)
- `status` (one of 5 above)
- `winner_tournament_clip_id` (UUID, null unless locked)
- `voting_started_at`, `voting_ends_at` (timestamps, null unless voting)
- `voting_duration_hours` (default 24)

**System rules:**
- Only ONE slot should be `voting` at a time (implicit)
- When locked, `winner_tournament_clip_id` → clip with `status = 'locked'`
- Auto-advance cron runs every minute, processes expired voting slots
- Vote endpoint checks: slot must be `voting`, not expired, clip must be `active`
- Clip approval into `waiting_for_clips` slot auto-resumes to `voting`

---

## New API: `POST /api/admin/update-slot-status`

**File:** `src/app/api/admin/update-slot-status/route.ts` (new)

**Input:**
```json
{ "slotPosition": 5, "newStatus": "voting" | "waiting_for_clips" | "upcoming" }
```

**Why `locked` excluded:** Locking requires a winner clip — use "Assign to Slot" tab for that.
**Why `archived` excluded:** Not used in current system.

### Algorithm

1. Auth + rate limit (`admin_write` — 15 req/min)
2. Validate `slotPosition` (positive integer) and `newStatus` (one of 3 allowed)
3. Fetch active season — validate `slotPosition ≤ total_slots`
4. Fetch slot by `season_id + slot_position` — 404 if not found
5. **No-op check:** if `slot.status === newStatus` → return early
6. **If slot currently `locked`** (unlocking):
   - If `winner_tournament_clip_id` exists:
     - Revert winner clip to `active` (already approved, not `pending`)
     - Clear `winner_tournament_clip_id = null` on slot
7. **If newStatus === `voting`:**
   - Count active clips (`status='active'`, `season_id`, `slot_position`)
   - If 0 → return 400 "No active clips in slot — cannot start voting"
   - Check for other voting slots in season → include warning in response (but proceed — God Mode)
   - Set `voting_started_at = now()`, `voting_ends_at = now + 24h`, `voting_duration_hours = 24`
8. **If newStatus === `waiting_for_clips` or `upcoming`:**
   - Clear `voting_started_at = null`, `voting_ends_at = null`, `voting_duration_hours = null`
9. Update slot status
10. Broadcast `winner-selected` on `story-updates` channel (triggers story/dashboard refetch)
11. Audit log: action `god_mode_slot_status_change`, resourceType `slot`
12. Return response with details

### Edge Cases Table

| From → To | Side Effects |
|-----------|-------------|
| locked → voting | Clear winner, revert winner clip to active, set 24h timer. **Requires active clips.** |
| locked → waiting_for_clips | Clear winner, revert winner clip to active, clear timers |
| locked → upcoming | Clear winner, revert winner clip to active, clear timers |
| voting → waiting_for_clips | Clear timers (pauses voting) |
| voting → upcoming | Clear timers (resets slot) |
| waiting_for_clips → voting | Set 24h timer. **Requires active clips.** |
| waiting_for_clips → upcoming | Status change only (timers already null) |
| upcoming → voting | Set 24h timer. **Requires active clips.** |
| upcoming → waiting_for_clips | Status change only |
| any → same status | No-op, return success |
| locked → voting (winner is only clip) | Winner reverted to active (count=1), voting starts normally |

### API Response

**Success (200):**
```json
{
  "ok": true,
  "message": "Slot 5 changed from locked to voting",
  "slotPosition": 5,
  "previousStatus": "locked",
  "newStatus": "voting",
  "winnerClipReverted": "uuid-or-null",
  "activeClipCount": 3,
  "warning": "Slot 2 is also voting in this season"
}
```

**No-op (200):**
```json
{
  "ok": true,
  "message": "Slot 5 is already voting",
  "noOp": true
}
```

**Errors:**

| Status | Error | Cause |
|--------|-------|-------|
| 400 | "slotPosition must be a positive integer" | Invalid input |
| 400 | "newStatus must be one of: voting, waiting_for_clips, upcoming" | Invalid status |
| 400 | "slotPosition X exceeds season total of Y" | Out of range |
| 400 | "No active clips in slot N — cannot start voting" | No clips to vote on |
| 404 | "No active season found" | No active season |
| 404 | "Slot N not found in active season" | Slot doesn't exist |

---

## UI Changes: `src/app/admin/page.tsx`

### New state variables (after line 190)
```typescript
const [godModeSlotPosition, setGodModeSlotPosition] = useState<number>(1);
const [godModeSlotNewStatus, setGodModeSlotNewStatus] = useState<'voting' | 'waiting_for_clips' | 'upcoming'>('voting');
```

### Update GodModeAction type (line 188)
```typescript
type GodModeAction = 'assign' | 'change_status' | 'change_slot_status';
```

### Update allSlots type (line 186) — add clip_count
```typescript
{ ..., clip_count?: number }
```
And in `openFreeAssignModal` (line 1149), also map `clip_count: s.clip_count`.

### Update closeFreeAssignModal (line 1162)
Add resets:
```typescript
setGodModeSlotPosition(1);
setGodModeSlotNewStatus('voting');
```

### New handler: handleChangeSlotStatus (after handleChangeStatus, ~line 1260)
```
POST /api/admin/update-slot-status with { slotPosition, newStatus }
On success: show message (include warning if present), fetchSlotInfo() + fetchClips(), auto-close 2.5s
```

### Tab bar (line 3332) — add third tab
```
[ Assign to Slot ] [ Change Clip Status ] [ Change Slot Status ]
```

### Clip selector (lines 3280-3330) — conditionally hide for slot tab
```tsx
{godModeAction !== 'change_slot_status' && ( ... existing clip selector ... )}
```
The "Change Slot Status" tab operates on slots, not clips — showing the clip selector would be confusing.

### New "Change Slot Status" panel (after line 3475)
When `godModeAction === 'change_slot_status'`:
- **Slot number input** (1 to totalSlots) using `godModeSlotPosition`
- **Slot info preview** from `allSlots` — status badge, winner username, ~clip count
- **Three status buttons:** Voting (blue), Waiting for Clips (yellow), Upcoming (gray)
- **Warnings:**
  - If slot is locked with winner: "Slot X has winner @username — winner will be reverted to active"
  - If target is voting and another slot is already voting: "Slot Y is also voting — proceed with caution"
  - If same status: "Slot is already [status]"

### Action buttons (lines 3503-3555) — expand to three-way conditional
```tsx
{godModeAction === 'assign' ? (
  /* existing Assign button */
) : godModeAction === 'change_status' ? (
  /* existing Change Status button */
) : (
  /* NEW: Change Slot Status button — icon: Layers (already imported), disabled if !godModeSlotPosition */
)}
```

---

## Audit Log: `src/lib/audit-log.ts`

Add `'god_mode_slot_status_change'` to `AuditAction` type union (after `'god_mode_status_change'`).

---

## Documentation: `Dokumentacja/god-mode-docs.md`

Add new section **"Tab 3: Change Slot Status"** with:
- How to use, status options, warnings
- Status change behaviors table (all from → to transitions)
- Slot cleanup details (when unlocking)
- API reference for `POST /api/admin/update-slot-status`

---

## Files Summary

| File | Change |
|------|--------|
| `src/app/api/admin/update-slot-status/route.ts` | NEW — slot status change endpoint with unlock cleanup |
| `src/app/admin/page.tsx` | Add third tab, new state/handler, hide clip selector for slot tab |
| `src/lib/audit-log.ts` | Add `'god_mode_slot_status_change'` to AuditAction |
| `Dokumentacja/god-mode-docs.md` | Add Tab 3 docs + API reference |

---

## Known Interactions & Considerations

- **Auto-advance cron:** If admin sets a slot to `voting` with a 24h timer, the cron will auto-advance it when the timer expires. This is expected behavior.
- **Multiple voting slots:** The system assumes one voting slot at a time. Setting a second slot to `voting` will trigger a warning but is allowed in God Mode. The cron will process whichever expires first.
- **Clip approval:** If an approved clip enters a `waiting_for_clips` slot, it auto-resumes to `voting` via the approval endpoint. This could override a manual status change.
- **Race with cron:** If the cron processes a slot at the same moment admin changes its status, operations could conflict. If this happens, re-run the action.
- **Winner revert:** Displaced winners are reverted to `active` (not `pending`) since they were already approved.

---

## Verification

1. **Build:** `npx next build` — no errors
2. **locked → voting** (has active clips): Winner reverted to active, 24h timer set
3. **locked → waiting_for_clips**: Winner reverted, timers cleared
4. **voting → waiting_for_clips**: Timers cleared, voting paused
5. **waiting_for_clips → voting** (has clips): 24h timer set
6. **waiting_for_clips → voting** (no clips): Returns 400 error
7. **upcoming → voting** (no clips): Returns 400 error
8. **No-op:** Same status → returns success, no changes
9. **Assign to Slot / Change Clip Status tabs:** Unchanged behavior
10. **Clip selector:** Hidden on "Change Slot Status" tab, visible on others
11. **Audit trail:** Check for `god_mode_slot_status_change` entries
