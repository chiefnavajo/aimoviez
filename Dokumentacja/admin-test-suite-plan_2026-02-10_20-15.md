# Admin API Automated Test Suite

## Goal

Create an automated test program that runs all possible admin scenarios to catch bugs like the "pending clip not resetting timer" issue we just fixed.

---

## Approach: Integration Tests with Local Supabase

**Why integration tests over mocked tests:**
- The bug we just fixed (clip status `pending` vs `active`) would NOT be caught by mocked unit tests
- Integration tests verify actual database state changes
- Tests real Supabase RPC functions and triggers

**Test Database:** Local Supabase via `supabase start`

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/__tests__/integration/setup.ts` | Database setup/teardown, test helpers |
| `src/__tests__/integration/admin/clip-lifecycle.test.ts` | Upload → Approve → Winner → Unlock → Delete |
| `src/__tests__/integration/admin/slot-management.test.ts` | Slot status transitions, timer management |
| `src/__tests__/integration/admin/bulk-operations.test.ts` | Bulk approve/reject/delete |
| `src/__tests__/integration/admin/season-management.test.ts` | Create/reset/delete seasons |
| `src/__tests__/integration/admin/safety-checks.test.ts` | Winner protection, locked clip guards |
| `jest.integration.config.js` | Separate Jest config for integration tests |
| `.env.test` | Test database credentials |

---

## Test Scenarios

### 1. Clip Lifecycle (the bug we just fixed)
```
Upload → Approve → Assign Winner → Unlock → Delete
✓ Slot should reset to waiting_for_clips
✓ Timer should be cleared (voting_started_at = null)
```

### 2. Slot Timer Management
```
✓ Approve first clip → Timer starts (24h)
✓ Delete all active clips → Timer clears
✓ Delete all pending clips → Timer clears
✓ Bulk delete all clips → Slot resets to waiting_for_clips
```

### 3. Winner Protection
```
✓ Cannot delete clip that is slot winner
✓ Cannot edit locked clip status
✓ Must unlock slot before modifying winner
```

### 4. Bulk Operations
```
✓ Bulk approve assigns all to active slot
✓ Bulk delete skips winner clips
✓ Bulk reject changes status correctly
```

### 5. Slot Reorganization
```
✓ Delete & shift moves clips down
✓ Swap slots exchanges positions
✓ Cannot delete slot with locked winner (unless confirmed)
```

### 6. Season Management
```
✓ Create season generates slots
✓ Reset season clears votes and resets slots
✓ Cannot delete active season
✓ Deactivating season updates status
```

---

## Implementation

### Step 1: Create test setup file

```typescript
// src/__tests__/integration/setup.ts
import { createClient } from '@supabase/supabase-js';

export const testSupabase = createClient(
  process.env.TEST_SUPABASE_URL!,
  process.env.TEST_SUPABASE_SERVICE_KEY!
);

export const TEST_SEASON_ID = 'test-season-' + Date.now();

// Helper to create test clip
export async function createTestClip(overrides = {}) {
  const { data } = await testSupabase
    .from('tournament_clips')
    .insert({
      title: 'Test Clip',
      status: 'pending',
      season_id: TEST_SEASON_ID,
      user_id: 'test-user',
      video_url: 'https://test.com/video.mp4',
      ...overrides,
    })
    .select()
    .single();
  return data;
}

// Helper to call admin API
export async function callAdminAPI(method: string, path: string, body?: object) {
  const response = await fetch(`http://localhost:3000${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Cookie': 'admin-session=test-admin-token',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

// Verify slot state
export async function getSlot(position: number) {
  const { data } = await testSupabase
    .from('story_slots')
    .select('*')
    .eq('season_id', TEST_SEASON_ID)
    .eq('slot_position', position)
    .single();
  return data;
}
```

### Step 2: Create clip lifecycle test

```typescript
// src/__tests__/integration/admin/clip-lifecycle.test.ts
import { createTestClip, callAdminAPI, getSlot, testSupabase, TEST_SEASON_ID } from '../setup';

describe('Clip Lifecycle', () => {
  beforeAll(async () => {
    // Create test season with slots
    await testSupabase.from('seasons').insert({
      id: TEST_SEASON_ID,
      label: 'Test Season',
      status: 'active',
      total_slots: 10,
    });
    // Create slots
    for (let i = 1; i <= 10; i++) {
      await testSupabase.from('story_slots').insert({
        season_id: TEST_SEASON_ID,
        slot_position: i,
        status: i === 1 ? 'waiting_for_clips' : 'upcoming',
      });
    }
  });

  afterAll(async () => {
    // Cleanup
    await testSupabase.from('tournament_clips').delete().eq('season_id', TEST_SEASON_ID);
    await testSupabase.from('story_slots').delete().eq('season_id', TEST_SEASON_ID);
    await testSupabase.from('seasons').delete().eq('id', TEST_SEASON_ID);
  });

  it('deleting last clip after unlock resets slot timer', async () => {
    // 1. Create pending clip
    const clip = await createTestClip();

    // 2. Approve (assigns to slot 1, starts voting)
    await callAdminAPI('POST', '/api/admin/approve', { clipId: clip.id });

    // Verify timer started
    let slot = await getSlot(1);
    expect(slot.status).toBe('voting');
    expect(slot.voting_ends_at).not.toBeNull();

    // 3. Assign as winner
    await callAdminAPI('POST', '/api/admin/assign-winner', { clipId: clip.id });

    // 4. Unlock slot
    await callAdminAPI('POST', '/api/admin/update-slot-status', {
      slotPosition: 1,
      seasonId: TEST_SEASON_ID,
      newStatus: 'voting',
    });

    // 5. Delete the clip
    await callAdminAPI('DELETE', `/api/admin/clips/${clip.id}`);

    // 6. Verify slot reset
    slot = await getSlot(1);
    expect(slot.status).toBe('waiting_for_clips');
    expect(slot.voting_started_at).toBeNull();
    expect(slot.voting_ends_at).toBeNull();
  });
});
```

### Step 3: Add npm scripts

```json
{
  "scripts": {
    "test:integration": "jest --config jest.integration.config.js",
    "test:admin": "jest --config jest.integration.config.js --testPathPattern=admin"
  }
}
```

---

## Verification

1. Start local Supabase: `supabase start`
2. Start dev server: `npm run dev`
3. Run tests: `npm run test:integration`
4. All tests should pass
5. Intentionally break code (revert our fix) and verify test fails

---

## Summary

This creates a comprehensive integration test suite that:
- Tests real database operations
- Catches state transition bugs like the one we just fixed
- Covers all critical admin workflows
- Can run locally or in CI/CD
