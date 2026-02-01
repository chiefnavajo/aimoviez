# God Mode — Admin Control Panel Documentation

## Overview

God Mode is the admin's full control panel for managing clips and slots. It combines two powerful features:

1. **Assign to Slot** — Place any clip into any slot in the story
2. **Change Status** — Change any clip's status with automatic slot cleanup

---

## How to Access

1. Go to the **Admin Dashboard**
2. In the **Slot Management** toolbar, click the purple **God Mode** button (Crown icon)
3. The God Mode modal opens

---

## Selecting a Clip

Both actions require selecting a clip first:

- Use the **search box** to filter clips by title or username
- The list shows all clips in the current season with their status badge:
  - `pending` (yellow) — awaiting approval
  - `active` (green) — approved and eligible for voting
  - `rejected` (red) — declined
  - `locked` (blue) — winner of a slot
- Click a clip to select it (highlighted in purple)

---

## Tab 1: Assign to Slot

### What It Does

Places any clip into any slot, making it the winner of that slot. Works regardless of clip status or slot state.

### How to Use

1. Select a clip
2. Click the **Assign to Slot** tab
3. Enter the **slot number** (1 to total slots in season)
4. The modal shows the current status of that slot:
   - **locked** (green) — already has a winner
   - **voting** (blue) — currently in a voting round
   - **waiting_for_clips** (yellow) — no clips yet
   - **upcoming** (gray) — not yet active
5. Review any warnings that appear
6. Click **Confirm Assignment**

### Warnings

| Warning | What It Means |
|---------|---------------|
| "Slot X has winner Y — will be reverted to active" | The current winner of the target slot will lose its locked status and become `active` |
| "Clip is winner of slot X — that slot will be cleared" | The clip you're assigning is already a winner elsewhere; that slot will lose its winner |
| "Slot X is currently voting — voting will stop" | Active voting in the target slot will be halted |

### What Happens Behind the Scenes

| Action | Detail |
|--------|--------|
| **Clip status** | Set to `locked` regardless of previous status |
| **Clip slot_position** | Updated to the target slot number |
| **Target slot** | Set to `locked` with clip as winner, voting timers cleared |
| **Source slot** (if clip was winner elsewhere) | Winner cleared; becomes `voting` (if active clips exist) or `waiting_for_clips` (if empty) |
| **Displaced winner** (if target slot had one) | Status reverted to `active` (not `pending` — it was already approved) |
| **Vote counts** | Preserved on the assigned clip |
| **Story page** | Updates immediately via realtime broadcast |
| **Audit log** | Action: `free_assign_clip` |

### Common Scenarios

**Assign a clip to an empty slot:**
Select clip → Enter slot number → Confirm. Clip becomes `locked`, slot becomes `locked`.

**Replace a winner:**
Select new clip → Enter slot number of existing winner → Warning about displaced winner → Confirm. Old winner reverts to `active`, new clip takes the slot.

**Move a winner between slots:**
Select the locked clip → Enter new slot number → Warning about source slot being cleared → Confirm. Source slot loses winner, clip moves to new slot.

---

## Tab 2: Change Status

### What It Does

Changes any clip's status to `pending`, `active`, or `rejected`. When unlocking a locked clip (winner of a slot), automatically handles slot cleanup.

### How to Use

1. Select a clip
2. Click the **Change Status** tab
3. The clip's current status is shown prominently
4. Click one of the three status buttons: **Pending**, **Active**, or **Rejected**
   - The selected status is highlighted (current status shows a ring indicator)
5. Review any warnings that appear
6. Click **Confirm Status Change**

### Warnings

| Warning | What It Means |
|---------|---------------|
| "This clip is currently locked as winner of Slot X. Changing status will remove it as winner and the slot will need a new winner." | The clip is a slot winner — changing its status will clear the slot |
| "Clip is already [status]" | No change needed — selecting confirm will be a no-op |

### Status Change Behaviors

| From → To | What Happens |
|-----------|-------------|
| **locked → active** | Slot winner cleared. Slot becomes `voting` (if other active clips exist) or `waiting_for_clips` (if empty). Clip becomes `active`. |
| **locked → pending** | Same slot cleanup as above. Clip goes back to `pending`. |
| **locked → rejected** | Same slot cleanup as above. Clip is `rejected`. |
| **active → rejected** | Clip rejected. No slot changes. |
| **active → pending** | Clip moves back to pending. No slot changes. |
| **pending → active** | Clip becomes active. No automatic slot assignment — use "Assign to Slot" for that. |
| **pending → rejected** | Clip rejected. No slot changes. |
| **rejected → active** | Clip becomes active again. |
| **rejected → pending** | Clip goes back to pending. |
| **Any → same status** | No-op. Returns success without making changes. |

### Slot Cleanup Details (when unlocking)

When a locked clip's status is changed:

1. The slot where this clip is winner has `winner_tournament_clip_id` set to `NULL`
2. System counts remaining active clips in that slot:
   - **If active clips exist:** Slot set to `voting` with a fresh 24-hour timer
   - **If no active clips:** Slot set to `waiting_for_clips`, all timers cleared
3. Story page updates immediately via realtime broadcast
4. Audit log records the full change with action `god_mode_status_change`

---

## API Reference

### `POST /api/admin/assign-clip-to-slot`

**Auth:** Admin required. Rate limit: 15 requests/minute.

**Request:**
```json
{
  "clipId": "uuid-of-the-clip",
  "targetSlotPosition": 7
}
```

**Success Response (200):**
```json
{
  "ok": true,
  "message": "Assigned \"Clip Title\" by username to slot 7",
  "clipId": "uuid",
  "clipTitle": "Clip Title",
  "clipUsername": "username",
  "targetSlotPosition": 7,
  "sourceSlotCleared": 3,
  "sourceSlotNewStatus": "waiting_for_clips",
  "previousWinnerReverted": "old-winner-uuid",
  "activeClipsRemaining": 0
}
```

**Error Responses:**

| Status | Error | Cause |
|--------|-------|-------|
| 400 | "clipId must be a valid UUID" | Invalid clip ID format |
| 400 | "targetSlotPosition must be a positive integer" | Invalid slot number |
| 400 | "targetSlotPosition X exceeds season total of 75" | Slot number too high |
| 400 | "Clip belongs to a different season" | Clip is from another season |
| 404 | "No active season found" | No season is currently active |
| 404 | "Clip not found" | Clip ID doesn't exist |
| 404 | "Slot X not found in active season" | Slot doesn't exist |

---

### `POST /api/admin/update-clip-status`

**Auth:** Admin required. Rate limit: 15 requests/minute.

**Request:**
```json
{
  "clipId": "uuid-of-the-clip",
  "newStatus": "active"
}
```

**Valid statuses:** `pending`, `active`, `rejected`

**Success Response (200):**
```json
{
  "ok": true,
  "message": "Changed \"Clip Title\" from locked to active",
  "clipId": "uuid",
  "clipTitle": "Clip Title",
  "previousStatus": "locked",
  "newStatus": "active",
  "slotCleared": 5,
  "slotNewStatus": "voting"
}
```

**No-op Response (200):**
```json
{
  "ok": true,
  "message": "Clip \"Clip Title\" is already active",
  "noOp": true
}
```

**Error Responses:**

| Status | Error | Cause |
|--------|-------|-------|
| 400 | "clipId must be a valid UUID" | Invalid clip ID format |
| 400 | "newStatus must be one of: pending, active, rejected" | Invalid status value |
| 400 | "Clip belongs to a different season" | Clip is from another season |
| 404 | "No active season found" | No season is currently active |
| 404 | "Clip not found" | Clip ID doesn't exist |

---

## Important Notes

- **No cascading side effects.** Assign to Slot does NOT move other clips to the next slot. This is intentional — it prevents cascade bugs.
- **Any clip status works for assignment.** You can assign `pending`, `active`, `rejected`, or `locked` clips. They all become `locked` on assignment.
- **Idempotent.** Assigning a clip that's already the winner of the target slot, or changing status to the current status, returns success without making changes.
- **Displaced winners revert to `active`.** When replacing a slot winner, the old winner goes to `active` (not `pending`) since it was already approved.
- **Audit trail.** Every action is logged in `audit_logs`:
  - Slot assignments: action `free_assign_clip`
  - Status changes: action `god_mode_status_change`
- **Auto-advance interaction.** If you change status on a slot that has an expiring voting timer, the auto-advance cron might process it simultaneously. If that happens, just re-run the action.
- **Vote counts preserved.** Changing a clip's status or assigning it to a slot preserves its historical vote count.
