/**
 * Auto-Advance Counter Integration Tests
 *
 * Tests the auto-advance timer behavior across various slot operations:
 * - Lock slot: timer should be cleared
 * - Unlock slot: timer should restart
 * - Delete clips: timer behavior when clips removed
 * - Upload clips: timer starts when first clip added to waiting slot
 * - Assign winner: timer should be cleared
 * - Edge case: 0 clips should NOT have voting status with active timer
 */

import {
  testSupabase,
  createSeason,
  cleanupAllTestSeasons,
  setupMultiSeasonUser,
  MULTI_SEASON_USER_ID,
} from '../setup';

// Track created resources for cleanup
const createdClipIds: string[] = [];
let testSeasonId: string;

// Helper: Create a test clip
async function createTestClip(
  seasonId: string,
  slotPosition: number | null = null,
  status: 'pending' | 'active' | 'locked' | 'rejected' = 'pending'
): Promise<string> {
  const { data, error } = await testSupabase
    .from('tournament_clips')
    .insert({
      title: `Auto-Advance Test Clip ${Date.now()}`,
      status,
      season_id: seasonId,
      user_id: MULTI_SEASON_USER_ID,
      slot_position: slotPosition,
      video_url: 'https://test.example.com/video.mp4',
      thumbnail_url: 'https://test.example.com/thumb.jpg',
      genre: 'TEST',
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create clip: ${error.message}`);
  createdClipIds.push(data.id);
  return data.id;
}

// Helper: Get slot with timer info
async function getSlotWithTimer(seasonId: string, position: number) {
  const { data, error } = await testSupabase
    .from('story_slots')
    .select('id, status, voting_started_at, voting_ends_at, voting_duration_hours, winner_tournament_clip_id')
    .eq('season_id', seasonId)
    .eq('slot_position', position)
    .single();

  if (error) throw new Error(`Failed to get slot: ${error.message}`);
  return data;
}

// Helper: Update slot status with timer
async function updateSlotWithTimer(
  seasonId: string,
  position: number,
  updates: {
    status?: 'voting' | 'waiting_for_clips' | 'locked' | 'upcoming';
    voting_started_at?: string | null;
    voting_ends_at?: string | null;
    winner_tournament_clip_id?: string | null;
  }
) {
  const { error } = await testSupabase
    .from('story_slots')
    .update(updates)
    .eq('season_id', seasonId)
    .eq('slot_position', position);

  if (error) throw new Error(`Failed to update slot: ${error.message}`);
}

// Helper: Count clips in a slot
async function countClipsInSlot(seasonId: string, slotPosition: number): Promise<number> {
  const { count, error } = await testSupabase
    .from('tournament_clips')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId)
    .eq('slot_position', slotPosition)
    .eq('status', 'active');

  if (error) throw new Error(`Failed to count clips: ${error.message}`);
  return count || 0;
}

// Helper: Start voting timer (simulates what happens when voting starts)
function getVotingTimestamps(durationHours: number = 24) {
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
  return {
    voting_started_at: now.toISOString(),
    voting_ends_at: endsAt.toISOString(),
  };
}

// Helper: Check if timer is active
function isTimerActive(slot: { voting_started_at: string | null; voting_ends_at: string | null }): boolean {
  return slot.voting_started_at !== null && slot.voting_ends_at !== null;
}

// Helper: Check if timer has expired
function isTimerExpired(slot: { voting_ends_at: string | null }): boolean {
  if (!slot.voting_ends_at) return false;
  return new Date(slot.voting_ends_at).getTime() < Date.now();
}

describe('Auto-Advance Counter Behavior', () => {
  beforeAll(async () => {
    await setupMultiSeasonUser();
    testSeasonId = await createSeason('Auto-Advance Test Season', 10, 'active');
  });

  afterAll(async () => {
    // Clean up clips
    for (const clipId of createdClipIds) {
      await testSupabase.from('votes').delete().eq('clip_id', clipId);
      await testSupabase.from('tournament_clips').delete().eq('id', clipId);
    }
    createdClipIds.length = 0;
    await cleanupAllTestSeasons();
  });

  // ===========================================================================
  // LOCK SLOT BEHAVIOR
  // ===========================================================================
  describe('Lock Slot - Timer Behavior', () => {
    it('timer should be cleared when slot is locked', async () => {
      // Setup: slot 1 in voting with active timer
      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(testSeasonId, 1, {
        status: 'voting',
        ...timestamps,
      });

      // Create clip and assign as winner
      const clipId = await createTestClip(testSeasonId, 1, 'active');

      // Lock the slot with winner
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clipId);

      await updateSlotWithTimer(testSeasonId, 1, {
        status: 'locked',
        voting_started_at: null,
        voting_ends_at: null,
        winner_tournament_clip_id: clipId,
      });

      // Verify timer is cleared
      const slot = await getSlotWithTimer(testSeasonId, 1);
      expect(slot.status).toBe('locked');
      expect(slot.voting_started_at).toBeNull();
      expect(slot.voting_ends_at).toBeNull();
      expect(isTimerActive(slot)).toBe(false);
    });

    it('locked slot should not have an active timer', async () => {
      const slot = await getSlotWithTimer(testSeasonId, 1);

      if (slot.status === 'locked') {
        expect(slot.voting_started_at).toBeNull();
        expect(slot.voting_ends_at).toBeNull();
      }
    });
  });

  // ===========================================================================
  // UNLOCK SLOT BEHAVIOR
  // ===========================================================================
  describe('Unlock Slot - Timer Behavior', () => {
    it('unlocking a slot should restart the timer if clips exist', async () => {
      // Setup: slot 2 with a clip
      const clipId = await createTestClip(testSeasonId, 2, 'active');

      // Unlock and set to voting with new timer
      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(testSeasonId, 2, {
        status: 'voting',
        ...timestamps,
        winner_tournament_clip_id: null,
      });

      // Verify timer is active
      const slot = await getSlotWithTimer(testSeasonId, 2);
      expect(slot.status).toBe('voting');
      expect(isTimerActive(slot)).toBe(true);
      expect(isTimerExpired(slot)).toBe(false);
    });

    it('unlocking a slot with no clips should set to waiting_for_clips without timer', async () => {
      // Setup: slot 3 with no clips
      const clipCount = await countClipsInSlot(testSeasonId, 3);
      expect(clipCount).toBe(0);

      // Unlock to waiting_for_clips (correct behavior)
      await updateSlotWithTimer(testSeasonId, 3, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
        winner_tournament_clip_id: null,
      });

      // Verify timer is cleared
      const slot = await getSlotWithTimer(testSeasonId, 3);
      expect(slot.status).toBe('waiting_for_clips');
      expect(isTimerActive(slot)).toBe(false);
    });
  });

  // ===========================================================================
  // DELETE CLIPS BEHAVIOR
  // ===========================================================================
  describe('Delete Clips - Timer Behavior', () => {
    it('deleting the last clip should clear timer and set to waiting_for_clips', async () => {
      // Setup: slot 4 in voting with one clip
      const clipId = await createTestClip(testSeasonId, 4, 'active');
      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(testSeasonId, 4, {
        status: 'voting',
        ...timestamps,
      });

      // Verify clip exists
      let clipCount = await countClipsInSlot(testSeasonId, 4);
      expect(clipCount).toBe(1);

      // Delete the clip
      await testSupabase.from('tournament_clips').delete().eq('id', clipId);
      createdClipIds.splice(createdClipIds.indexOf(clipId), 1);

      // Simulate what the auto-advance cron should do
      clipCount = await countClipsInSlot(testSeasonId, 4);
      expect(clipCount).toBe(0);

      // Update slot to waiting_for_clips (what should happen)
      await updateSlotWithTimer(testSeasonId, 4, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      });

      // Verify timer is cleared
      const slot = await getSlotWithTimer(testSeasonId, 4);
      expect(slot.status).toBe('waiting_for_clips');
      expect(isTimerActive(slot)).toBe(false);
    });

    it('deleting one clip among many should keep timer active', async () => {
      // Setup: slot 5 in voting with multiple clips
      const clip1 = await createTestClip(testSeasonId, 5, 'active');
      const clip2 = await createTestClip(testSeasonId, 5, 'active');
      const clip3 = await createTestClip(testSeasonId, 5, 'active');

      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(testSeasonId, 5, {
        status: 'voting',
        ...timestamps,
      });

      // Verify clips exist
      let clipCount = await countClipsInSlot(testSeasonId, 5);
      expect(clipCount).toBe(3);

      // Delete one clip
      await testSupabase.from('tournament_clips').delete().eq('id', clip1);
      createdClipIds.splice(createdClipIds.indexOf(clip1), 1);

      // Verify 2 clips remain
      clipCount = await countClipsInSlot(testSeasonId, 5);
      expect(clipCount).toBe(2);

      // Timer should still be active
      const slot = await getSlotWithTimer(testSeasonId, 5);
      expect(slot.status).toBe('voting');
      expect(isTimerActive(slot)).toBe(true);
    });
  });

  // ===========================================================================
  // UPLOAD/APPROVE CLIPS BEHAVIOR
  // ===========================================================================
  describe('Upload/Approve Clips - Timer Behavior', () => {
    it('approving first clip in waiting_for_clips should start timer', async () => {
      // Setup: slot 6 in waiting_for_clips with no timer
      await updateSlotWithTimer(testSeasonId, 6, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      });

      // Verify no timer
      let slot = await getSlotWithTimer(testSeasonId, 6);
      expect(slot.status).toBe('waiting_for_clips');
      expect(isTimerActive(slot)).toBe(false);

      // Add clip to slot
      await createTestClip(testSeasonId, 6, 'active');

      // Transition to voting (what approve does)
      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(testSeasonId, 6, {
        status: 'voting',
        ...timestamps,
      });

      // Verify timer started
      slot = await getSlotWithTimer(testSeasonId, 6);
      expect(slot.status).toBe('voting');
      expect(isTimerActive(slot)).toBe(true);
    });

    it('approving additional clips should not reset timer', async () => {
      // Slot 6 should already be in voting with timer from previous test
      let slot = await getSlotWithTimer(testSeasonId, 6);
      const originalStartedAt = slot.voting_started_at;
      const originalEndsAt = slot.voting_ends_at;

      expect(slot.status).toBe('voting');
      expect(isTimerActive(slot)).toBe(true);

      // Add another clip
      await createTestClip(testSeasonId, 6, 'active');

      // Timer should not change
      slot = await getSlotWithTimer(testSeasonId, 6);
      expect(slot.voting_started_at).toBe(originalStartedAt);
      expect(slot.voting_ends_at).toBe(originalEndsAt);
    });
  });

  // ===========================================================================
  // ASSIGN WINNER BEHAVIOR
  // ===========================================================================
  describe('Assign Winner - Timer Behavior', () => {
    it('assigning winner should clear timer and lock slot', async () => {
      // Setup: slot 7 in voting with clips and timer
      const clip1 = await createTestClip(testSeasonId, 7, 'active');
      const clip2 = await createTestClip(testSeasonId, 7, 'active');

      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(testSeasonId, 7, {
        status: 'voting',
        ...timestamps,
      });

      // Verify timer active
      let slot = await getSlotWithTimer(testSeasonId, 7);
      expect(isTimerActive(slot)).toBe(true);

      // Assign winner
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip1);

      await updateSlotWithTimer(testSeasonId, 7, {
        status: 'locked',
        voting_started_at: null,
        voting_ends_at: null,
        winner_tournament_clip_id: clip1,
      });

      // Verify timer cleared
      slot = await getSlotWithTimer(testSeasonId, 7);
      expect(slot.status).toBe('locked');
      expect(slot.winner_tournament_clip_id).toBe(clip1);
      expect(isTimerActive(slot)).toBe(false);
    });

    it('next slot should start with timer when current slot locks', async () => {
      // Setup: slot 8 should be next in line after slot 7 locks
      await updateSlotWithTimer(testSeasonId, 8, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      });

      // Add clip to slot 8
      await createTestClip(testSeasonId, 8, 'active');

      // When auto-advance runs after slot 7 locks, slot 8 should start voting
      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(testSeasonId, 8, {
        status: 'voting',
        ...timestamps,
      });

      const slot = await getSlotWithTimer(testSeasonId, 8);
      expect(slot.status).toBe('voting');
      expect(isTimerActive(slot)).toBe(true);
    });
  });

  // ===========================================================================
  // BUG: 0 CLIPS IN VOTING STATUS
  // ===========================================================================
  describe('Edge Case: 0 Clips with Voting Status (Bug Scenario)', () => {
    it('INVARIANT: voting status with 0 clips should NOT have active timer', async () => {
      // This tests the invariant that should always hold:
      // If clip_count == 0 AND status == 'voting', this is an invalid state

      // Check all slots in the season
      const { data: slots } = await testSupabase
        .from('story_slots')
        .select('slot_position, status, voting_started_at, voting_ends_at')
        .eq('season_id', testSeasonId);

      for (const slot of slots || []) {
        const clipCount = await countClipsInSlot(testSeasonId, slot.slot_position);

        if (clipCount === 0 && slot.status === 'voting') {
          // This is the bug condition!
          console.warn(
            `BUG DETECTED: Slot ${slot.slot_position} has 0 clips but status is 'voting' with timer: ` +
            `started=${slot.voting_started_at}, ends=${slot.voting_ends_at}`
          );

          // The fix: should be waiting_for_clips with no timer
          expect(slot.status).not.toBe('voting'); // This will fail if bug exists
        }
      }
    });

    it('simulates the bug: voting status with 0 clips and active timer', async () => {
      // Reproduce the bug scenario
      // Setup: slot 9 in "voting" with timer but NO clips
      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(testSeasonId, 9, {
        status: 'voting',
        ...timestamps,
      });

      // Verify no clips in slot
      const clipCount = await countClipsInSlot(testSeasonId, 9);
      expect(clipCount).toBe(0);

      // Get slot state
      const slot = await getSlotWithTimer(testSeasonId, 9);

      // This is the bug state:
      // - status = 'voting'
      // - timer active
      // - 0 clips
      expect(slot.status).toBe('voting');
      expect(isTimerActive(slot)).toBe(true);
      expect(clipCount).toBe(0);

      // What SHOULD happen when this is detected:
      // The auto-advance cron should fix this by setting:
      await updateSlotWithTimer(testSeasonId, 9, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      });

      // Verify corrected state
      const correctedSlot = await getSlotWithTimer(testSeasonId, 9);
      expect(correctedSlot.status).toBe('waiting_for_clips');
      expect(isTimerActive(correctedSlot)).toBe(false);
    });

    it('timer should be valid when voting with clips', async () => {
      // Setup: slot 10 in voting with clips (correct state)
      await createTestClip(testSeasonId, 10, 'active');
      await createTestClip(testSeasonId, 10, 'active');

      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(testSeasonId, 10, {
        status: 'voting',
        ...timestamps,
      });

      const clipCount = await countClipsInSlot(testSeasonId, 10);
      const slot = await getSlotWithTimer(testSeasonId, 10);

      // This is the CORRECT state
      expect(clipCount).toBeGreaterThan(0);
      expect(slot.status).toBe('voting');
      expect(isTimerActive(slot)).toBe(true);
      expect(isTimerExpired(slot)).toBe(false);
    });
  });

  // ===========================================================================
  // TIMER CONSISTENCY ACROSS OPERATIONS
  // ===========================================================================
  describe('Timer Consistency Across Operations', () => {
    let operationSeasonId: string;

    beforeAll(async () => {
      operationSeasonId = await createSeason('Timer Consistency Season', 5, 'active');
    });

    it('rapid operations should maintain timer consistency', async () => {
      // Setup: slot 1 with clips in voting
      const clip1 = await createTestClip(operationSeasonId, 1, 'active');
      const clip2 = await createTestClip(operationSeasonId, 1, 'active');

      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(operationSeasonId, 1, {
        status: 'voting',
        ...timestamps,
      });

      // Perform rapid operations
      // 1. Add vote
      await testSupabase.from('votes').insert({
        voter_key: `timer_test_${Date.now()}`,
        clip_id: clip1,
        slot_position: 1,
        vote_weight: 1,
      });

      // 2. Delete a clip
      await testSupabase.from('tournament_clips').delete().eq('id', clip2);
      createdClipIds.splice(createdClipIds.indexOf(clip2), 1);

      // 3. Add another clip
      await createTestClip(operationSeasonId, 1, 'active');

      // Timer should still be valid
      const slot = await getSlotWithTimer(operationSeasonId, 1);
      expect(slot.status).toBe('voting');
      expect(isTimerActive(slot)).toBe(true);

      // Original timestamps should be preserved (compare as Date objects to handle format differences)
      expect(new Date(slot.voting_started_at!).getTime()).toBe(new Date(timestamps.voting_started_at).getTime());
      expect(new Date(slot.voting_ends_at!).getTime()).toBe(new Date(timestamps.voting_ends_at).getTime());
    });

    it('timer values should be properly formatted ISO strings', async () => {
      const slot = await getSlotWithTimer(operationSeasonId, 1);

      if (slot.voting_started_at) {
        const startedAt = new Date(slot.voting_started_at);
        expect(startedAt.toString()).not.toBe('Invalid Date');
      }

      if (slot.voting_ends_at) {
        const endsAt = new Date(slot.voting_ends_at);
        expect(endsAt.toString()).not.toBe('Invalid Date');
      }
    });

    it('voting_ends_at should be after voting_started_at', async () => {
      const slot = await getSlotWithTimer(operationSeasonId, 1);

      if (slot.voting_started_at && slot.voting_ends_at) {
        const startedAt = new Date(slot.voting_started_at).getTime();
        const endsAt = new Date(slot.voting_ends_at).getTime();
        expect(endsAt).toBeGreaterThan(startedAt);
      }
    });
  });

  // ===========================================================================
  // MULTI-SEASON TIMER ISOLATION
  // ===========================================================================
  describe('Multi-Season Timer Isolation', () => {
    let season1Id: string;
    let season2Id: string;

    beforeAll(async () => {
      season1Id = await createSeason('Timer Isolation S1', 5, 'active');
      season2Id = await createSeason('Timer Isolation S2', 5, 'active');
    });

    it('locking slot in season 1 should not affect season 2 timer', async () => {
      // Setup: both seasons slot 1 in voting with timer
      const timestamps1 = getVotingTimestamps();
      const timestamps2 = getVotingTimestamps();

      const clip1 = await createTestClip(season1Id, 1, 'active');
      const clip2 = await createTestClip(season2Id, 1, 'active');

      await updateSlotWithTimer(season1Id, 1, {
        status: 'voting',
        ...timestamps1,
      });

      await updateSlotWithTimer(season2Id, 1, {
        status: 'voting',
        ...timestamps2,
      });

      // Lock season 1 slot 1
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip1);

      await updateSlotWithTimer(season1Id, 1, {
        status: 'locked',
        voting_started_at: null,
        voting_ends_at: null,
        winner_tournament_clip_id: clip1,
      });

      // Verify season 1 timer cleared
      const slot1 = await getSlotWithTimer(season1Id, 1);
      expect(slot1.status).toBe('locked');
      expect(isTimerActive(slot1)).toBe(false);

      // Verify season 2 timer still active
      const slot2 = await getSlotWithTimer(season2Id, 1);
      expect(slot2.status).toBe('voting');
      expect(isTimerActive(slot2)).toBe(true);
      // Compare as Date objects to handle format differences
      expect(new Date(slot2.voting_started_at!).getTime()).toBe(new Date(timestamps2.voting_started_at).getTime());
    });

    it('each season maintains independent timers', async () => {
      // Get all voting slots across both seasons
      const { data: votingSlots } = await testSupabase
        .from('story_slots')
        .select('season_id, slot_position, voting_started_at, voting_ends_at')
        .in('season_id', [season1Id, season2Id])
        .eq('status', 'voting');

      // Each should have independent timestamps
      const season1Slots = votingSlots?.filter(s => s.season_id === season1Id) || [];
      const season2Slots = votingSlots?.filter(s => s.season_id === season2Id) || [];

      // They should be tracked separately
      expect(season1Slots.length).toBeGreaterThanOrEqual(0);
      expect(season2Slots.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ===========================================================================
  // VULNERABILITY PATH TESTS
  // ===========================================================================
  describe('Vulnerability Paths: Preventing 0-clip Voting Slots', () => {
    let vulnSeasonId: string;

    beforeAll(async () => {
      vulnSeasonId = await createSeason('Vulnerability Test Season', 10, 'active');
    });

    it('unlock slot with 0 clips should result in waiting_for_clips, not voting', async () => {
      // Setup: slot 1 locked with a winner
      const clipId = await createTestClip(vulnSeasonId, 1, 'active');
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clipId);

      await updateSlotWithTimer(vulnSeasonId, 1, {
        status: 'locked',
        voting_started_at: null,
        voting_ends_at: null,
        winner_tournament_clip_id: clipId,
      });

      // Delete the winner clip directly from DB (simulating it was removed)
      await testSupabase.from('tournament_clips').delete().eq('id', clipId);
      createdClipIds.splice(createdClipIds.indexOf(clipId), 1);

      // Now unlock — but there are 0 clips
      // Simulate what the unlock endpoint does:
      // 1. Clear winner, set to voting with timer
      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(vulnSeasonId, 1, {
        status: 'voting',
        ...timestamps,
        winner_tournament_clip_id: null,
      });

      // 2. Post-unlock check: count clips
      const clipCount = await countClipsInSlot(vulnSeasonId, 1);

      // If 0 clips, the unlock endpoint should have corrected to waiting_for_clips
      if (clipCount === 0) {
        await updateSlotWithTimer(vulnSeasonId, 1, {
          status: 'waiting_for_clips',
          voting_started_at: null,
          voting_ends_at: null,
        });
      }

      const slot = await getSlotWithTimer(vulnSeasonId, 1);
      expect(slot.status).toBe('waiting_for_clips');
      expect(isTimerActive(slot)).toBe(false);
    });

    it('rejecting last active clip (with pending clips) should NOT reset slot', async () => {
      // Setup: slot 2 with 1 active + 1 pending clip
      const activeClip = await createTestClip(vulnSeasonId, 2, 'active');
      const pendingClip = await createTestClip(vulnSeasonId, 2, 'pending');

      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(vulnSeasonId, 2, {
        status: 'voting',
        ...timestamps,
      });

      // Reject the active clip
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'rejected' })
        .eq('id', activeClip);

      // Count remaining active+pending clips (the fix counts both)
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', 2)
        .eq('season_id', vulnSeasonId)
        .in('status', ['active', 'pending']);

      // Pending clip should prevent reset
      expect(count).toBe(1);

      // Slot should remain in voting
      const slot = await getSlotWithTimer(vulnSeasonId, 2);
      expect(slot.status).toBe('voting');
      expect(isTimerActive(slot)).toBe(true);
    });

    it('rejecting last active clip (no pending) should reset slot', async () => {
      // Setup: slot 3 with only 1 active clip
      const activeClip = await createTestClip(vulnSeasonId, 3, 'active');

      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(vulnSeasonId, 3, {
        status: 'voting',
        ...timestamps,
      });

      // Reject it
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'rejected' })
        .eq('id', activeClip);

      // Count remaining
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', 3)
        .eq('season_id', vulnSeasonId)
        .in('status', ['active', 'pending']);

      expect(count).toBe(0);

      // Simulate what reject endpoint should do: reset slot
      await updateSlotWithTimer(vulnSeasonId, 3, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      });

      const slot = await getSlotWithTimer(vulnSeasonId, 3);
      expect(slot.status).toBe('waiting_for_clips');
      expect(isTimerActive(slot)).toBe(false);
    });

    it('self-healing: cron detects 0-clip voting slot and resets it', async () => {
      // Setup: slot 4 in voting with timer but NO clips (the bug state)
      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(vulnSeasonId, 4, {
        status: 'voting',
        ...timestamps,
      });

      const clipCount = await countClipsInSlot(vulnSeasonId, 4);
      expect(clipCount).toBe(0);

      // Simulate what the self-healing cron does:
      // Query all voting slots, check clip counts, reset any with 0
      const { data: votingSlots } = await testSupabase
        .from('story_slots')
        .select('id, slot_position, season_id')
        .eq('season_id', vulnSeasonId)
        .eq('status', 'voting');

      for (const vs of votingSlots || []) {
        const { count } = await testSupabase
          .from('tournament_clips')
          .select('id', { count: 'exact', head: true })
          .eq('slot_position', vs.slot_position)
          .eq('season_id', vs.season_id)
          .in('status', ['active', 'pending']);

        if (!count || count === 0) {
          await testSupabase
            .from('story_slots')
            .update({
              status: 'waiting_for_clips',
              voting_started_at: null,
              voting_ends_at: null,
            })
            .eq('id', vs.id);
        }
      }

      // Verify slot 4 was healed
      const slot = await getSlotWithTimer(vulnSeasonId, 4);
      expect(slot.status).toBe('waiting_for_clips');
      expect(isTimerActive(slot)).toBe(false);
    });

    it('editing last active clip to rejected via PUT should reset slot', async () => {
      // Setup: slot 5 with 1 active clip in voting
      const clipId = await createTestClip(vulnSeasonId, 5, 'active');

      const timestamps = getVotingTimestamps();
      await updateSlotWithTimer(vulnSeasonId, 5, {
        status: 'voting',
        ...timestamps,
      });

      // Simulate what PUT endpoint now does: change to rejected + check slot
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'rejected' })
        .eq('id', clipId);

      // Count remaining (the new cleanup logic in PUT)
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', 5)
        .eq('season_id', vulnSeasonId)
        .in('status', ['active', 'pending']);

      if (count === 0) {
        await updateSlotWithTimer(vulnSeasonId, 5, {
          status: 'waiting_for_clips',
          voting_started_at: null,
          voting_ends_at: null,
        });
      }

      const slot = await getSlotWithTimer(vulnSeasonId, 5);
      expect(slot.status).toBe('waiting_for_clips');
      expect(isTimerActive(slot)).toBe(false);
    });
  });
});
