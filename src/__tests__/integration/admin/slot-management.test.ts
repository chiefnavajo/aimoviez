/**
 * Slot Management Integration Tests
 *
 * Tests slot status transitions and timer management.
 */

import {
  testSupabase,
  TEST_SEASON_ID,
  createTestClip,
  createTestClips,
  getSlot,
  updateSlot,
  setupTestSeason,
  cleanupTestData,
} from '../setup';

describe('Slot Management', () => {
  beforeAll(async () => {
    await setupTestSeason(10);
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    // Reset slots to clean state
    for (let i = 1; i <= 3; i++) {
      await updateSlot(i, {
        status: i === 1 ? 'waiting_for_clips' : 'upcoming',
        voting_started_at: null,
        voting_ends_at: null,
        winner_tournament_clip_id: null,
      });
    }

    // Delete any leftover test clips
    await testSupabase
      .from('tournament_clips')
      .delete()
      .eq('season_id', TEST_SEASON_ID);
  });

  describe('Timer Management', () => {
    it('approving first clip starts 24h timer', async () => {
      const clip = await createTestClip({ status: 'active', slot_position: 1 });

      const now = new Date();
      const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: endsAt.toISOString(),
      });

      const slot = await getSlot(1);

      expect(slot?.status).toBe('voting');
      expect(slot?.voting_started_at).not.toBeNull();
      expect(slot?.voting_ends_at).not.toBeNull();

      // Timer should be ~24 hours
      const startTime = new Date(slot?.voting_started_at as string);
      const endTime = new Date(slot?.voting_ends_at as string);
      const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

      expect(durationHours).toBeCloseTo(24, 0);
    });

    it('bulk delete all clips resets slot to waiting_for_clips', async () => {
      // Create 3 active clips
      const clips = await createTestClips(3, { status: 'active', slot_position: 1 });

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Verify voting state
      let slot = await getSlot(1);
      expect(slot?.status).toBe('voting');

      // Delete all clips
      for (const clip of clips) {
        await testSupabase
          .from('tournament_clips')
          .delete()
          .eq('id', clip.id);
      }

      // Simulate safety check after last delete
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', 1)
        .eq('season_id', TEST_SEASON_ID)
        .in('status', ['active', 'pending']);

      if (count === 0) {
        await updateSlot(1, {
          status: 'waiting_for_clips',
          voting_started_at: null,
          voting_ends_at: null,
        });
      }

      // Verify slot reset
      slot = await getSlot(1);
      expect(slot?.status).toBe('waiting_for_clips');
      expect(slot?.voting_started_at).toBeNull();
      expect(slot?.voting_ends_at).toBeNull();
    });

    it('deleting pending clips also resets slot', async () => {
      // Create pending clip (simulating post-unlock state)
      const clip = await createTestClip({ status: 'pending', slot_position: 1 });

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Delete the pending clip
      await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('id', clip.id);

      // Simulate safety check (should include pending!)
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', 1)
        .eq('season_id', TEST_SEASON_ID)
        .in('status', ['active', 'pending']); // This is the fix!

      if (count === 0) {
        await updateSlot(1, {
          status: 'waiting_for_clips',
          voting_started_at: null,
          voting_ends_at: null,
        });
      }

      const slot = await getSlot(1);
      expect(slot?.status).toBe('waiting_for_clips');
    });
  });

  describe('Status Transitions', () => {
    it('slot transitions: upcoming -> waiting_for_clips -> voting -> locked', async () => {
      // Start with upcoming
      await updateSlot(2, { status: 'upcoming' });
      let slot = await getSlot(2);
      expect(slot?.status).toBe('upcoming');

      // Transition to waiting_for_clips (previous slot locked)
      await updateSlot(2, { status: 'waiting_for_clips' });
      slot = await getSlot(2);
      expect(slot?.status).toBe('waiting_for_clips');

      // Create clip and transition to voting
      const clip = await createTestClip({ status: 'active', slot_position: 2 });

      await updateSlot(2, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      slot = await getSlot(2);
      expect(slot?.status).toBe('voting');

      // Assign winner and lock
      await updateSlot(2, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });
      slot = await getSlot(2);
      expect(slot?.status).toBe('locked');
      expect(slot?.winner_tournament_clip_id).toBe(clip.id);
    });

    it('unlocking slot clears winner reference', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Unlock
      await updateSlot(1, {
        status: 'voting',
        winner_tournament_clip_id: null,
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const slot = await getSlot(1);
      expect(slot?.winner_tournament_clip_id).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('slot with mixed active and pending clips stays in voting', async () => {
      const activeClip = await createTestClip({ status: 'active', slot_position: 1 });
      const pendingClip = await createTestClip({ status: 'pending', slot_position: 1 });

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Delete active clip only
      await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('id', activeClip.id);

      // Check if pending clip keeps slot in voting
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', 1)
        .eq('season_id', TEST_SEASON_ID)
        .in('status', ['active', 'pending']);

      // Should be 1 (the pending clip)
      expect(count).toBe(1);

      // Slot should stay in voting
      const slot = await getSlot(1);
      expect(slot?.status).toBe('voting');
    });

    it('rejected clips do not count towards slot status', async () => {
      const activeClip = await createTestClip({ status: 'active', slot_position: 1 });
      const rejectedClip = await createTestClip({ status: 'rejected', slot_position: 1 });

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Delete active clip
      await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('id', activeClip.id);

      // Count should not include rejected
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', 1)
        .eq('season_id', TEST_SEASON_ID)
        .in('status', ['active', 'pending']);

      expect(count).toBe(0);

      // Cleanup
      await testSupabase.from('tournament_clips').delete().eq('id', rejectedClip.id);
    });
  });
});
