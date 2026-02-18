# Shift-Left on Slot Unlock (Option — Not Implemented)

## Summary

When an admin unlocks a locked slot, all subsequent locked slots shift their winners
one position left to fill the gap. The last slot in the chain becomes the new open
voting slot. The removed winner goes to `pending` status.

## Current Behavior

Unlocking slot 2 out of 4 locked slots:
```
Before:  [1:locked A] [2:locked B] [3:locked C] [4:locked D] [5:voting]
After:   [1:locked A] [2:voting]   [3:locked C] [4:locked D] [5:voting]
                       ↑ gap in story
```

## Proposed New Behavior

```
Before:  [1:locked A] [2:locked B] [3:locked C] [4:locked D] [5:voting]
After:   [1:locked A] [2:locked C] [3:locked D] [4:voting]   [5:upcoming]
                       ↑ C shifted   ↑ D shifted  ↑ new open   ↑ deactivated
```

- Clip B → `pending` (removed from story)
- Clip C moves from slot 3 → slot 2
- Clip D moves from slot 4 → slot 3
- Slot 4 becomes `voting` (24h timer)
- Slot 5's active clips move to slot 4, slot 5 deactivated

## Algorithm

In the PATCH handler of `src/app/api/admin/slots/route.ts`, when `unlock: true`:

1. **Validate** — slot must be `locked`
2. **Save winner ID** — store `winner_tournament_clip_id` before clearing
3. **Revert winner** — set clip status to `pending`
4. **Find shift chain** — get all locked slots with `slot_position > P` in same season, ordered ascending. Take only the **contiguous** run starting from P+1 (stop at first non-locked gap).
5. **Shift winners left** — for each slot in the chain (ascending order):
   - Copy its `winner_tournament_clip_id` to the slot at position - 1
   - Update the winning clip's `slot_position` to position - 1
   - Keep clip status as `locked`
6. **Open last slot** — the last slot in the chain:
   - Clear `winner_tournament_clip_id`
   - Set status to `voting` with 24h timer
7. **Handle existing voting slot** — if there was a voting slot after the chain:
   - Move its active/pending clips to the newly opened slot
   - Deactivate it (status → `upcoming`, clear timers)
8. **No shift chain** — if no contiguous locked slots after P, the unlocked slot itself becomes `voting` (current behavior, unchanged)
9. **Audit log** the action with shift details
10. **Broadcast** update to connected clients

## Edge Cases

| Scenario | Result |
|----------|--------|
| Unlock last locked slot (no slots after) | No shift. Slot becomes voting. |
| Unlock slot with non-locked slot after it | No shift. Unlocked slot becomes voting. |
| Unlock slot 1 of [1:locked, 2:locked, 3:voting] | Slot 2's winner → slot 1. Slot 2 becomes voting. Slot 3 deactivated, clips move to slot 2. |
| All 4 slots locked, no voting slot | Shift left. Last slot becomes voting (waiting_for_clips if no clips). |

## Files to Modify

| File | Change |
|------|--------|
| `src/app/api/admin/slots/route.ts` | Replace unlock logic in PATCH handler (~lines 234-400) with shift-left algorithm |
| `src/app/admin/page.tsx` | Update unlock confirmation dialog to explain shift-left behavior. Remove the `revert_clip_to_pending` choice (always pending now). |

## DB Operations (in order)

```sql
-- 1. Revert winner clip to pending
UPDATE tournament_clips SET status = 'pending' WHERE id = <winner_id>;

-- 2. For each slot in shift chain (ascending):
UPDATE story_slots SET winner_tournament_clip_id = <next_winner_id> WHERE id = <slot_id>;
UPDATE tournament_clips SET slot_position = <new_pos> WHERE id = <next_winner_id>;

-- 3. Clear & open last slot in chain
UPDATE story_slots SET
  winner_tournament_clip_id = NULL,
  status = 'voting',
  voting_started_at = NOW(),
  voting_ends_at = NOW() + 24h
WHERE id = <last_slot_id>;

-- 4. Move clips from old voting slot (if exists)
UPDATE tournament_clips SET slot_position = <new_open_pos>
WHERE slot_position = <old_voting_pos> AND status IN ('active', 'pending');

-- 5. Deactivate old voting slot (if exists)
UPDATE story_slots SET status = 'upcoming', voting_started_at = NULL, voting_ends_at = NULL
WHERE id = <old_voting_slot_id>;
```

## Verification

1. **Build:** `npx next build` — no errors
2. **Test unlock middle slot:** Lock slots 1-4, unlock slot 2 → verify slots 3,4 shift left, slot 4 becomes voting
3. **Test unlock first slot:** Lock slots 1-3, unlock slot 1 → verify slots 2,3 shift left, slot 3 becomes voting
4. **Test unlock last slot:** Lock slots 1-4, unlock slot 4 → no shift, slot 4 becomes voting
5. **Test story page:** After shift, storyboard plays contiguously without gaps
6. **Test with voting slot:** Lock 1-3, voting on 4, unlock slot 2 → verify clips from 4 move to 3
