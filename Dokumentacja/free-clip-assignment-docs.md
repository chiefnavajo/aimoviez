# Free Clip Assignment — Admin Documentation

## What It Does

The Free Assign feature lets you place **any clip** into **any slot** in the story, regardless of clip status or slot state. Use it to fix mistakes, rebuild the story, or manually curate which clips appear in which positions.

---

## How to Use It

### Step 1: Open the Modal

1. Go to the **Admin Dashboard**
2. In the **Slot Management** toolbar, click the purple **Free Assign** button
3. The Free Clip Assignment modal opens

### Step 2: Select a Clip

- Use the **search box** to filter clips by title or username
- The list shows all clips in the current season with their status (`pending`, `active`, `rejected`, `locked`)
- Click a clip to select it (highlighted in purple)

### Step 3: Choose the Target Slot

- Enter the **slot number** (1 to 75)
- The modal shows the current status of that slot:
  - **locked** (green) — already has a winner
  - **voting** (blue) — currently in a voting round
  - **waiting_for_clips** (yellow) — no clips yet
  - **upcoming** (gray) — not yet active

### Step 4: Review Warnings

If the assignment will cause side effects, warnings appear:

| Warning | What It Means |
|---------|---------------|
| "Slot X has winner Y — will be reverted to active" | The current winner of the target slot will lose its locked status and become available for future voting |
| "Clip is winner of slot X — that slot will be cleared" | The clip you're assigning is already a winner elsewhere; that slot will lose its winner |
| "Slot X is currently voting — voting will stop" | Active voting in the target slot will be halted |

### Step 5: Confirm

Click **Confirm Assignment**. The system will:
1. Move the clip to the target slot
2. Lock the slot with the clip as winner
3. Handle all cleanup automatically
4. Show a success message with details

---

## Common Scenarios

### Assign a new clip to an empty slot

**Situation:** Slot 5 is `waiting_for_clips` and you want to place a specific clip there.

1. Open Free Assign
2. Select the clip (any status works — pending, active, rejected)
3. Enter slot 5
4. Confirm

**Result:** Clip becomes `locked`, slot 5 becomes `locked` with that clip as winner.

### Replace a winner in an existing slot

**Situation:** Slot 3 has the wrong clip as winner. You want clip X there instead.

1. Open Free Assign
2. Select clip X
3. Enter slot 3
4. Warning appears: "Slot 3 has winner Y — will be reverted to active"
5. Confirm

**Result:** Old winner Y becomes `active` (can participate in future voting). Clip X is now the winner of slot 3.

### Move a winner from one slot to another

**Situation:** Clip X won slot 3 but should be in slot 7.

1. Open Free Assign
2. Select clip X (status: `locked`, slot: 3)
3. Enter slot 7
4. Warnings appear:
   - "Clip is winner of slot 3 — that slot will be cleared"
   - (If slot 7 has a winner) "Slot 7 has winner Z — will be reverted to active"
5. Confirm

**Result:** Slot 3 loses its winner (becomes `waiting_for_clips`). Clip X is now winner of slot 7. You can then assign a different clip to slot 3.

### Rebuild the entire story

To reassign all slots from scratch:

1. Assign clip A to slot 1
2. Assign clip B to slot 2
3. Assign clip C to slot 3
4. ... and so on

Each assignment is independent — no cascading side effects.

---

## What Happens Behind the Scenes

| Action | Detail |
|--------|--------|
| **Clip status** | Set to `locked` regardless of previous status |
| **Clip slot_position** | Updated to the target slot number |
| **Target slot** | Set to `locked` with clip as winner, voting timers cleared |
| **Source slot** (if clip was winner elsewhere) | Winner cleared; becomes `voting` (if active clips exist) or `waiting_for_clips` (if empty) |
| **Displaced winner** (if target slot had one) | Status reverted to `active` (not `pending` — it was already approved) |
| **Vote counts** | Preserved on the assigned clip (historical data) |
| **Active clips in target slot** | Stay in place but become invisible (slot is locked, so no more voting). Count shown in response |
| **Story page** | Updates immediately via realtime broadcast |
| **Audit log** | Records full details: who, what, previous state, all changes |

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

## Important Notes

- **No cascading side effects.** Unlike the regular assign-winner flow, Free Assign does NOT move other clips to the next slot. This is intentional — it prevents the bugs that the original system had.
- **Any clip status works.** You can assign `pending`, `active`, `rejected`, or `locked` clips. They all become `locked` on assignment.
- **Idempotent.** Assigning a clip that's already the winner of the target slot returns success without making changes.
- **Audit trail.** Every free assignment is logged in `audit_logs` with action `free_assign_clip`. Check the audit log for a full history of changes.
- **Auto-advance interaction.** If you assign to a slot that has an expiring voting timer, the auto-advance cron might process it at the same time. If that happens, just re-run the free assignment.
