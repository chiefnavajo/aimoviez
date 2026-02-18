# Queue-Based Slot Unlock (Planned — Not Yet Implemented)

## Summary

When an admin unlocks a locked slot while another slot is already voting,
the unlocked slot goes to `waiting_for_clips` (queued). The current voting
slot finishes normally. Then the unlocked slot becomes the next voting slot.

Winner clip → `pending`. No clips are moved or disrupted.

## Behavior

```
Before (unlock slot 3):
  Slot 1: locked ✓   Slot 2: locked ✓   Slot 3: locked ✓   Slot 4: locked ✓   Slot 5: voting

After:
  Slot 1: locked ✓   Slot 2: locked ✓   Slot 3: waiting_for_clips   Slot 4: locked ✓   Slot 5: voting
                                          ↑ queued (winner → pending)           ↑ uninterrupted

When slot 5 finishes:
  Slot 1: locked ✓   Slot 2: locked ✓   Slot 3: voting   Slot 4: locked ✓   Slot 5: locked ✓
                                          ↑ now active                         ↑ just locked

When slot 3 finishes:
  → normal forward advance resumes (slot 6, 7, etc.)
```

## Changes

### 1. Unlock logic — `src/app/api/admin/slots/route.ts` (PATCH handler)

**Current:** If unlocked slot is at lower position than voting slot, it takes over voting
and deactivates the current voting slot.

**New:** If a voting slot already exists, the unlocked slot goes to `waiting_for_clips`
regardless of position. No clips are moved. No slot is deactivated.

```
if (existingVotingSlot) {
  newStatus = 'waiting_for_clips';  // queue it
  // Don't move clips, don't deactivate existing voting slot
} else {
  newStatus = 'voting';  // no competition, start voting immediately
}
```

Always: winner clip → `pending`, `winner_tournament_clip_id` → null.

### 2. Auto-advance cron — `src/app/api/cron/auto-advance/route.ts`

After locking a slot's winner, before activating the next sequential slot,
check if any `waiting_for_clips` slot exists at a LOWER position.

**Current flow:**
1. Lock expired slot → pick winner
2. Move losing clips to `slot_position + 1`
3. Activate `slot_position + 1`

**New flow:**
1. Lock expired slot → pick winner
2. Move losing clips to `slot_position + 1`
3. **Check:** any `waiting_for_clips` slots in this season?
4. If yes → activate the **lowest** `waiting_for_clips` slot instead
5. If no → activate `slot_position + 1` as before

Losing clips still move to `slot_position + 1` (forward) — they don't go to the
queued slot since those clips were for a different story position.

### 3. Admin UI — `src/app/admin/page.tsx`

- Remove the `revert_clip_to_pending` choice (always pending now)
- Update confirmation message: "This will queue slot X for voting after the current round finishes."
- If no voting slot exists: "This will start voting on slot X immediately."

## Edge Cases

| Scenario | Result |
|----------|--------|
| Unlock while no voting slot exists | Slot becomes `voting` immediately (24h timer) |
| Unlock multiple slots while one is voting | All go to `waiting_for_clips`. After current finishes, lowest position activates first. |
| Unlock slot that's already `waiting_for_clips` | No-op or error (slot not locked) |
| Auto-advance finds 2 waiting slots (3 and 7) | Activates slot 3 (lowest position first) |

## Files to Modify

| File | Change |
|------|--------|
| `src/app/api/admin/slots/route.ts` | Simplify unlock: if voting slot exists → `waiting_for_clips`, else → `voting`. Remove clip-moving logic. |
| `src/app/api/cron/auto-advance/route.ts` | After locking winner, check for `waiting_for_clips` slots before activating next sequential slot. |
| `src/app/admin/page.tsx` | Update unlock confirmation dialog. Remove `revert_clip_to_pending` choice. |

## Verification

1. **Build:** `npx next build` — no errors
2. **Unlock while voting:** Unlock slot 3 while slot 5 votes → slot 3 becomes `waiting_for_clips`, slot 5 unaffected
3. **Auto-advance picks up queue:** Let slot 5 expire → slot 3 activates (not slot 6)
4. **Unlock with no voting:** Unlock slot 3 with no voting slot → slot 3 becomes `voting` immediately
5. **Multiple unlocks:** Unlock slots 2 and 4 → both queue → lowest (2) activates first after current finishes
