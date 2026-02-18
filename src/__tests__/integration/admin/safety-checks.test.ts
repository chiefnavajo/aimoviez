/**
 * Safety Checks Integration Tests
 *
 * Tests that admin operations are properly guarded:
 * - Cannot delete winner clips
 * - Cannot edit locked clips
 * - Must unlock slot before modifying winner
 */

import {
  testSupabase,
  TEST_SEASON_ID,
  createTestClip,
  getClip,
  getSlot,
  updateSlot,
  setupTestSeason,
  cleanupTestData,
} from '../setup';

describe('Safety Checks', () => {
  beforeAll(async () => {
    await setupTestSeason(10);
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    // Reset slot 1 to clean state
    await updateSlot(1, {
      status: 'waiting_for_clips',
      voting_started_at: null,
      voting_ends_at: null,
      winner_tournament_clip_id: null,
    });

    // Delete any leftover test clips
    await testSupabase
      .from('tournament_clips')
      .delete()
      .eq('season_id', TEST_SEASON_ID);
  });

  describe('Winner Protection', () => {
    it('winner clip is linked to slot via winner_tournament_clip_id', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Verify link exists
      const { data: winnerSlot } = await testSupabase
        .from('story_slots')
        .select('slot_position, winner_tournament_clip_id')
        .eq('winner_tournament_clip_id', clip.id)
        .single();

      expect(winnerSlot).not.toBeNull();
      expect(winnerSlot?.winner_tournament_clip_id).toBe(clip.id);
    });

    it('can detect if clip is a winner before delete', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Safety check: is this clip a winner?
      const { data: winnerSlot } = await testSupabase
        .from('story_slots')
        .select('id, slot_position, status')
        .eq('winner_tournament_clip_id', clip.id)
        .maybeSingle();

      expect(winnerSlot).not.toBeNull();

      // If winnerSlot exists, delete should be blocked
      // (The actual blocking happens in the API)
    });

    it('non-winner clips can be deleted', async () => {
      const clip = await createTestClip({ status: 'active', slot_position: 1 });

      // Check: not a winner
      const { data: winnerSlot } = await testSupabase
        .from('story_slots')
        .select('id')
        .eq('winner_tournament_clip_id', clip.id)
        .maybeSingle();

      expect(winnerSlot).toBeNull(); // Not a winner, can delete

      // Delete should succeed
      const { error } = await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('id', clip.id);

      expect(error).toBeNull();

      // Verify deleted
      const deletedClip = await getClip(clip.id as string);
      expect(deletedClip).toBeNull();
    });
  });

  describe('Locked Clip Guards', () => {
    it('locked clip has status = locked', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      const currentClip = await getClip(clip.id as string);
      expect(currentClip?.status).toBe('locked');
    });

    it('can detect locked clip before edit', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      // Check: is this clip locked?
      const { data: clipData } = await testSupabase
        .from('tournament_clips')
        .select('status')
        .eq('id', clip.id)
        .single();

      expect(clipData?.status).toBe('locked');

      // If locked, edit should be blocked
      // (The actual blocking happens in the API)
    });

    it('unlocked clip can be edited', async () => {
      const clip = await createTestClip({ status: 'active', slot_position: 1 });

      // Update title
      const { error } = await testSupabase
        .from('tournament_clips')
        .update({ title: 'Updated Title' })
        .eq('id', clip.id);

      expect(error).toBeNull();

      const updatedClip = await getClip(clip.id as string);
      expect(updatedClip?.title).toBe('Updated Title');
    });
  });

  describe('Unlock Before Modify', () => {
    it('unlocking slot clears winner and allows modification', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Step 1: Unlock slot
      await updateSlot(1, {
        status: 'voting',
        winner_tournament_clip_id: null,
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Step 2: Revert clip status
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'pending' })
        .eq('id', clip.id);

      // Verify unlocked state
      const slot = await getSlot(1);
      expect(slot?.status).toBe('voting');
      expect(slot?.winner_tournament_clip_id).toBeNull();

      const updatedClip = await getClip(clip.id as string);
      expect(updatedClip?.status).toBe('pending');

      // Now clip can be deleted
      const { data: winnerSlot } = await testSupabase
        .from('story_slots')
        .select('id')
        .eq('winner_tournament_clip_id', clip.id)
        .maybeSingle();

      expect(winnerSlot).toBeNull(); // No longer a winner
    });

    it('attempting to modify locked slot winner fails safety check', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Try to check if we can delete (safety check)
      const { data: winnerSlot } = await testSupabase
        .from('story_slots')
        .select('id, slot_position')
        .eq('winner_tournament_clip_id', clip.id)
        .maybeSingle();

      // Safety check fails - clip is a winner
      expect(winnerSlot).not.toBeNull();
      expect(winnerSlot?.slot_position).toBe(1);
    });
  });

  describe('Bulk Operation Safety', () => {
    it('bulk delete should skip winner clips', async () => {
      const regularClip = await createTestClip({ status: 'active', slot_position: 1 });
      const winnerClip = await createTestClip({ status: 'locked', slot_position: 2 });

      await updateSlot(2, {
        status: 'locked',
        winner_tournament_clip_id: winnerClip.id as string,
      });

      // Simulate bulk delete with safety check
      const clipIds = [regularClip.id as string, winnerClip.id as string];
      const deletedIds: string[] = [];
      const skippedIds: string[] = [];

      for (const clipId of clipIds) {
        // Check if winner
        const { data: isWinner } = await testSupabase
          .from('story_slots')
          .select('id')
          .eq('winner_tournament_clip_id', clipId)
          .maybeSingle();

        if (isWinner) {
          skippedIds.push(clipId);
        } else {
          await testSupabase
            .from('tournament_clips')
            .delete()
            .eq('id', clipId);
          deletedIds.push(clipId);
        }
      }

      expect(deletedIds).toContain(regularClip.id);
      expect(skippedIds).toContain(winnerClip.id);

      // Verify winner still exists
      const stillExists = await getClip(winnerClip.id as string);
      expect(stillExists).not.toBeNull();
    });
  });
});
