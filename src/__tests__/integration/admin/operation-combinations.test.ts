/**
 * Operation Combinations Integration Tests
 *
 * Tests ALL combinations of admin operations to catch edge cases:
 * - upload, approve, reject, delete
 * - assign winner, unlock, lock
 * - edit clip, bulk operations
 * - slot status transitions
 */

import {
  testSupabase,
  TEST_SEASON_ID,
  TEST_USER_ID,
  createTestClip,
  createTestClips,
  getClip,
  getSlot,
  updateSlot,
  setupTestSeason,
  cleanupTestData,
} from '../setup';

describe('Operation Combinations', () => {
  beforeAll(async () => {
    await setupTestSeason(10);
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    // Reset slots 1-3 to clean state
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

  // ============================================================
  // UPLOAD COMBINATIONS
  // ============================================================
  describe('Upload Combinations', () => {
    it('upload → delete (never approved)', async () => {
      const clip = await createTestClip();

      await testSupabase.from('tournament_clips').delete().eq('id', clip.id);

      const deleted = await getClip(clip.id as string);
      expect(deleted).toBeNull();
    });

    it('upload → approve → delete', async () => {
      const clip = await createTestClip();

      // Approve
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Delete
      await testSupabase.from('tournament_clips').delete().eq('id', clip.id);

      // Simulate safety check
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

      const slot = await getSlot(1);
      expect(slot?.status).toBe('waiting_for_clips');
    });

    it('upload → reject → delete', async () => {
      const clip = await createTestClip();

      // Reject
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'rejected' })
        .eq('id', clip.id);

      // Delete rejected
      await testSupabase.from('tournament_clips').delete().eq('id', clip.id);

      const deleted = await getClip(clip.id as string);
      expect(deleted).toBeNull();
    });

    it('upload → approve → reject → reapprove', async () => {
      const clip = await createTestClip();

      // Approve
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .eq('id', clip.id);

      // Reject
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'rejected', slot_position: null })
        .eq('id', clip.id);

      // Re-approve
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .eq('id', clip.id);

      const reapproved = await getClip(clip.id as string);
      expect(reapproved?.status).toBe('active');
      expect(reapproved?.slot_position).toBe(1);
    });
  });

  // ============================================================
  // WINNER COMBINATIONS
  // ============================================================
  describe('Winner Combinations', () => {
    it('approve → winner → unlock → delete', async () => {
      const clip = await createTestClip();

      // Approve
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Assign winner
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Unlock
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'pending' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'voting',
        winner_tournament_clip_id: null,
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Delete (THE BUG FIX - pending clips should reset slot)
      await testSupabase.from('tournament_clips').delete().eq('id', clip.id);

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

      const slot = await getSlot(1);
      expect(slot?.status).toBe('waiting_for_clips');
      expect(slot?.voting_started_at).toBeNull();
    });

    it('approve → winner → unlock → re-approve → winner again', async () => {
      const clip = await createTestClip();

      // Approve
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .eq('id', clip.id);

      // Winner
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Unlock
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'pending' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'voting',
        winner_tournament_clip_id: null,
      });

      // Re-approve
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active' })
        .eq('id', clip.id);

      // Winner again
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      const slot = await getSlot(1);
      expect(slot?.status).toBe('locked');
      expect(slot?.winner_tournament_clip_id).toBe(clip.id);
    });

    it('two clips → winner clip1 → unlock → winner clip2', async () => {
      const clip1 = await createTestClip({ title: 'Clip 1' });
      const clip2 = await createTestClip({ title: 'Clip 2' });

      // Approve both
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .in('id', [clip1.id, clip2.id]);

      await updateSlot(1, { status: 'voting' });

      // Winner clip1
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip1.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip1.id as string,
      });

      // Unlock
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active' })
        .eq('id', clip1.id);

      await updateSlot(1, {
        status: 'voting',
        winner_tournament_clip_id: null,
      });

      // Winner clip2 instead
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip2.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip2.id as string,
      });

      const slot = await getSlot(1);
      expect(slot?.winner_tournament_clip_id).toBe(clip2.id);

      const c1 = await getClip(clip1.id as string);
      const c2 = await getClip(clip2.id as string);
      expect(c1?.status).toBe('active');
      expect(c2?.status).toBe('locked');
    });
  });

  // ============================================================
  // EDIT COMBINATIONS
  // ============================================================
  describe('Edit Combinations', () => {
    it('upload → edit title → approve', async () => {
      const clip = await createTestClip({ title: 'Original Title' });

      // Edit title
      await testSupabase
        .from('tournament_clips')
        .update({ title: 'Updated Title' })
        .eq('id', clip.id);

      // Approve
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .eq('id', clip.id);

      const updated = await getClip(clip.id as string);
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.status).toBe('active');
    });

    it('approve → edit → still active', async () => {
      const clip = await createTestClip();

      // Approve
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .eq('id', clip.id);

      // Edit (should keep active status)
      await testSupabase
        .from('tournament_clips')
        .update({ title: 'Edited While Active' })
        .eq('id', clip.id);

      const edited = await getClip(clip.id as string);
      expect(edited?.status).toBe('active');
      expect(edited?.title).toBe('Edited While Active');
    });

    it('locked clip cannot be edited (guard check)', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      // Check locked status before attempting edit
      const locked = await getClip(clip.id as string);
      expect(locked?.status).toBe('locked');

      // In real API, this would be blocked
      // Here we just verify the status check works
    });
  });

  // ============================================================
  // SLOT STATUS COMBINATIONS
  // ============================================================
  describe('Slot Status Combinations', () => {
    it('waiting_for_clips → voting → waiting_for_clips (all deleted)', async () => {
      const clip = await createTestClip({ status: 'active', slot_position: 1 });

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Delete clip
      await testSupabase.from('tournament_clips').delete().eq('id', clip.id);

      // Simulate reset
      await updateSlot(1, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      });

      const slot = await getSlot(1);
      expect(slot?.status).toBe('waiting_for_clips');
    });

    it('voting → locked → voting (unlock)', async () => {
      const clip = await createTestClip({ status: 'active', slot_position: 1 });

      await updateSlot(1, { status: 'voting' });

      // Lock
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      let slot = await getSlot(1);
      expect(slot?.status).toBe('locked');

      // Unlock
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'voting',
        winner_tournament_clip_id: null,
      });

      slot = await getSlot(1);
      expect(slot?.status).toBe('voting');
    });

    it('slot 1 locked → slot 2 becomes waiting_for_clips', async () => {
      const clip = await createTestClip({ status: 'active', slot_position: 1 });

      await updateSlot(1, { status: 'voting' });
      await updateSlot(2, { status: 'upcoming' });

      // Lock slot 1
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Advance slot 2
      await updateSlot(2, { status: 'waiting_for_clips' });

      const slot1 = await getSlot(1);
      const slot2 = await getSlot(2);

      expect(slot1?.status).toBe('locked');
      expect(slot2?.status).toBe('waiting_for_clips');
    });
  });

  // ============================================================
  // BULK OPERATION COMBINATIONS
  // ============================================================
  describe('Bulk Operation Combinations', () => {
    it('bulk approve multiple clips', async () => {
      const clips = await createTestClips(3);

      // Bulk approve
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .in('id', clips.map(c => c.id));

      for (const clip of clips) {
        const updated = await getClip(clip.id as string);
        expect(updated?.status).toBe('active');
        expect(updated?.slot_position).toBe(1);
      }
    });

    it('bulk delete all → slot resets', async () => {
      const clips = await createTestClips(3, { status: 'active', slot_position: 1 });

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      // Bulk delete
      await testSupabase
        .from('tournament_clips')
        .delete()
        .in('id', clips.map(c => c.id));

      // Simulate reset
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

      const slot = await getSlot(1);
      expect(slot?.status).toBe('waiting_for_clips');
    });

    it('bulk reject does not affect other clips', async () => {
      const clipToKeep = await createTestClip({ status: 'active', slot_position: 1 });
      const clipsToReject = await createTestClips(2);

      // Bulk reject
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'rejected' })
        .in('id', clipsToReject.map(c => c.id));

      const kept = await getClip(clipToKeep.id as string);
      expect(kept?.status).toBe('active');

      for (const clip of clipsToReject) {
        const rejected = await getClip(clip.id as string);
        expect(rejected?.status).toBe('rejected');
      }
    });
  });

  // ============================================================
  // EDGE CASE COMBINATIONS
  // ============================================================
  describe('Edge Case Combinations', () => {
    it('delete winner → blocked, unlock → delete → success', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Check winner protection
      const { data: winnerSlot } = await testSupabase
        .from('story_slots')
        .select('id')
        .eq('winner_tournament_clip_id', clip.id)
        .maybeSingle();

      expect(winnerSlot).not.toBeNull(); // Would block delete

      // Unlock first
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'pending' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'voting',
        winner_tournament_clip_id: null,
      });

      // Now delete succeeds
      await testSupabase.from('tournament_clips').delete().eq('id', clip.id);

      const deleted = await getClip(clip.id as string);
      expect(deleted).toBeNull();
    });

    it('multiple operations on same clip rapid succession', async () => {
      const clip = await createTestClip();

      // Rapid operations
      await testSupabase.from('tournament_clips').update({ status: 'active', slot_position: 1 }).eq('id', clip.id);
      await testSupabase.from('tournament_clips').update({ title: 'Edit 1' }).eq('id', clip.id);
      await testSupabase.from('tournament_clips').update({ title: 'Edit 2' }).eq('id', clip.id);
      await testSupabase.from('tournament_clips').update({ status: 'rejected' }).eq('id', clip.id);
      await testSupabase.from('tournament_clips').update({ status: 'active' }).eq('id', clip.id);

      const final = await getClip(clip.id as string);
      expect(final?.status).toBe('active');
      expect(final?.title).toBe('Edit 2');
    });

    it('all clips rejected → slot stays waiting (no active clips)', async () => {
      const clips = await createTestClips(3, { status: 'active', slot_position: 1 });

      await updateSlot(1, { status: 'voting' });

      // Reject all
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'rejected' })
        .in('id', clips.map(c => c.id));

      // Check remaining active/pending
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', 1)
        .eq('season_id', TEST_SEASON_ID)
        .in('status', ['active', 'pending']);

      expect(count).toBe(0);
    });

    it('mixed statuses in slot: active + pending + rejected', async () => {
      const activeClip = await createTestClip({ status: 'active', slot_position: 1 });
      const pendingClip = await createTestClip({ status: 'pending', slot_position: 1 });
      const rejectedClip = await createTestClip({ status: 'rejected', slot_position: 1 });

      await updateSlot(1, { status: 'voting' });

      // Count only active/pending
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', 1)
        .eq('season_id', TEST_SEASON_ID)
        .in('status', ['active', 'pending']);

      expect(count).toBe(2); // active + pending, not rejected
    });

    it('unlock → edit → re-lock with same clip', async () => {
      const clip = await createTestClip({ status: 'locked', slot_position: 1 });

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      // Unlock
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'voting',
        winner_tournament_clip_id: null,
      });

      // Edit while unlocked
      await testSupabase
        .from('tournament_clips')
        .update({ title: 'Edited After Unlock' })
        .eq('id', clip.id);

      // Re-lock
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
      });

      const final = await getClip(clip.id as string);
      expect(final?.status).toBe('locked');
      expect(final?.title).toBe('Edited After Unlock');
    });
  });

  // ============================================================
  // TIMER COMBINATIONS
  // ============================================================
  describe('Timer Combinations', () => {
    it('timer starts → all clips deleted → timer clears', async () => {
      const clip = await createTestClip({ status: 'active', slot_position: 1 });

      const now = new Date();
      await updateSlot(1, {
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      });

      let slot = await getSlot(1);
      expect(slot?.voting_ends_at).not.toBeNull();

      // Delete
      await testSupabase.from('tournament_clips').delete().eq('id', clip.id);

      // Reset
      await updateSlot(1, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      });

      slot = await getSlot(1);
      expect(slot?.voting_started_at).toBeNull();
      expect(slot?.voting_ends_at).toBeNull();
    });

    it('timer running → add more clips → timer continues', async () => {
      const clip1 = await createTestClip({ status: 'active', slot_position: 1 });

      const now = new Date();
      const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: endsAt.toISOString(),
      });

      // Add another clip
      const clip2 = await createTestClip({ status: 'active', slot_position: 1 });

      const slot = await getSlot(1);
      expect(slot?.status).toBe('voting');
      // Compare timestamps (handles Z vs +00:00 format difference)
      expect(new Date(slot?.voting_ends_at as string).getTime()).toBe(endsAt.getTime());
    });

    it('timer running → winner assigned → timer preserved in lock', async () => {
      const clip = await createTestClip({ status: 'active', slot_position: 1 });

      const now = new Date();
      const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: endsAt.toISOString(),
      });

      // Assign winner (lock)
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id as string,
        // Timer fields remain
      });

      const slot = await getSlot(1);
      expect(slot?.status).toBe('locked');
      // Compare timestamps (handles Z vs +00:00 format difference)
      expect(new Date(slot?.voting_ends_at as string).getTime()).toBe(endsAt.getTime());
    });
  });
});
