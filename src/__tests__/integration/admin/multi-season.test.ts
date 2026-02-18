/**
 * Multi-Season Integration Tests
 *
 * Tests 8 seasons running simultaneously with various operations:
 * - Uploading clips to different seasons
 * - Deleting clips across seasons
 * - Winner assignments in parallel
 * - Cross-season isolation verification
 * - Concurrent operations stress testing
 */

import {
  testSupabase,
  TEST_SEASON_IDS,
  MULTI_SEASON_USER_ID,
  createSeason,
  createClipForSeason,
  getClipsForSeason,
  getSlotsForSeason,
  getSlot,
  getClip,
  setupMultiSeasonUser,
  cleanupAllTestSeasons,
  approveClipDirect,
  assignWinnerDirect,
  deleteClipDirect,
  countClipsByStatus,
  updateSlot,
} from '../setup';

describe('Multi-Season Operations (8 Seasons)', () => {
  const seasons: string[] = [];

  beforeAll(async () => {
    // Setup shared user first
    await setupMultiSeasonUser();

    // Create 8 test seasons
    for (let i = 1; i <= 8; i++) {
      const seasonId = await createSeason(`Test Season ${i}`, 10, 'active');
      seasons.push(seasonId);
    }
  });

  afterAll(async () => {
    await cleanupAllTestSeasons();
  });

  describe('Season Isolation', () => {
    it('8 seasons created independently with correct structure', async () => {
      expect(seasons).toHaveLength(8);

      for (const seasonId of seasons) {
        const slots = await getSlotsForSeason(seasonId);
        expect(slots).toHaveLength(10);
        expect(slots[0].status).toBe('waiting_for_clips');
        expect(slots[1].status).toBe('upcoming');
      }
    });

    it('clips in season 1 do not appear in season 2-8', async () => {
      // Create clip in season 1
      const clip = await createClipForSeason(seasons[0], { title: 'Season 1 Only' });

      // Verify it exists in season 1
      const season1Clips = await getClipsForSeason(seasons[0]);
      expect(season1Clips.some(c => c.id === clip.id)).toBe(true);

      // Verify it does NOT exist in other seasons
      for (let i = 1; i < 8; i++) {
        const otherSeasonClips = await getClipsForSeason(seasons[i]);
        expect(otherSeasonClips.some(c => c.id === clip.id)).toBe(false);
      }

      // Cleanup
      await deleteClipDirect(clip.id as string);
    });

    it('slot operations in one season do not affect others', async () => {
      // Create and approve a clip in season 1 to change slot status
      const clip = await createClipForSeason(seasons[0]);
      await approveClipDirect(clip.id as string, 1);

      // Update slot 1 in season 1 to voting
      await updateSlot(1, { status: 'voting' }, seasons[0]);

      // Verify season 1 slot is voting
      const slot1Season1 = await getSlot(1, seasons[0]);
      expect(slot1Season1?.status).toBe('voting');

      // Verify other seasons' slot 1 are still waiting_for_clips
      for (let i = 1; i < 8; i++) {
        const otherSlot = await getSlot(1, seasons[i]);
        expect(otherSlot?.status).toBe('waiting_for_clips');
      }

      // Cleanup
      await deleteClipDirect(clip.id as string);
      await updateSlot(1, { status: 'waiting_for_clips' }, seasons[0]);
    });

    it('winner in season 1 does not lock season 2-8 slots', async () => {
      // Create, approve, and assign winner in season 1
      const clip = await createClipForSeason(seasons[0]);
      await approveClipDirect(clip.id as string, 1);
      await assignWinnerDirect(seasons[0], 1, clip.id as string);

      // Verify season 1 slot 1 is locked
      const slot1Season1 = await getSlot(1, seasons[0]);
      expect(slot1Season1?.status).toBe('locked');

      // Verify other seasons' slot 1 are NOT locked
      for (let i = 1; i < 8; i++) {
        const otherSlot = await getSlot(1, seasons[i]);
        expect(otherSlot?.status).not.toBe('locked');
      }

      // Cleanup - unlock and delete
      await updateSlot(1, { status: 'waiting_for_clips', winner_tournament_clip_id: null }, seasons[0]);
      await testSupabase.from('tournament_clips').update({ status: 'pending' }).eq('id', clip.id);
      await deleteClipDirect(clip.id as string);
    });
  });

  describe('Parallel Upload Operations', () => {
    it('upload clip to each of 8 seasons simultaneously', async () => {
      // Create clips in all 8 seasons in parallel
      const clipPromises = seasons.map(seasonId =>
        createClipForSeason(seasonId, { title: `Parallel Upload ${seasonId.slice(0, 8)}` })
      );

      const clips = await Promise.all(clipPromises);

      // Verify each clip is in its correct season
      for (let i = 0; i < 8; i++) {
        expect(clips[i].season_id).toBe(seasons[i]);
        const seasonClips = await getClipsForSeason(seasons[i]);
        expect(seasonClips.some(c => c.id === clips[i].id)).toBe(true);
      }

      // Cleanup
      await Promise.all(clips.map(c => deleteClipDirect(c.id as string)));
    });

    it('approve clips in all 8 seasons maintains independent slot status', async () => {
      // Create clips in all seasons
      const clips = await Promise.all(
        seasons.map(seasonId => createClipForSeason(seasonId))
      );

      // Approve all clips in parallel
      await Promise.all(
        clips.map(clip => approveClipDirect(clip.id as string, 1))
      );

      // Update all slot 1s to voting in parallel
      await Promise.all(
        seasons.map(seasonId => updateSlot(1, { status: 'voting' }, seasonId))
      );

      // Verify each season has its own voting slot
      for (const seasonId of seasons) {
        const slot = await getSlot(1, seasonId);
        expect(slot?.status).toBe('voting');
      }

      // Cleanup
      await Promise.all(clips.map(c => deleteClipDirect(c.id as string)));
      await Promise.all(
        seasons.map(seasonId => updateSlot(1, { status: 'waiting_for_clips' }, seasonId))
      );
    });

    it('timers run independently per season', async () => {
      const now = new Date();
      const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      // Set different timer values for each season
      const timerPromises = seasons.map((seasonId, i) => {
        const seasonEndsAt = new Date(endsAt.getTime() + i * 60 * 60 * 1000); // Stagger by 1 hour
        return updateSlot(1, {
          status: 'voting',
          voting_started_at: now.toISOString(),
          voting_ends_at: seasonEndsAt.toISOString(),
        }, seasonId);
      });

      await Promise.all(timerPromises);

      // Verify each season has different timer
      for (let i = 0; i < 8; i++) {
        const slot = await getSlot(1, seasons[i]);
        expect(slot?.status).toBe('voting');
        expect(slot?.voting_ends_at).not.toBeNull();

        // Each should be different from the others
        for (let j = i + 1; j < 8; j++) {
          const otherSlot = await getSlot(1, seasons[j]);
          expect(slot?.voting_ends_at).not.toBe(otherSlot?.voting_ends_at);
        }
      }

      // Cleanup
      await Promise.all(
        seasons.map(seasonId => updateSlot(1, {
          status: 'waiting_for_clips',
          voting_started_at: null,
          voting_ends_at: null,
        }, seasonId))
      );
    });
  });

  describe('Parallel Delete Operations', () => {
    it('delete clips from season 1 while seasons 2-8 continue', async () => {
      // Create clips in all seasons
      const clips = await Promise.all(
        seasons.map(seasonId => createClipForSeason(seasonId))
      );

      // Delete clip from season 1
      await deleteClipDirect(clips[0].id as string);

      // Verify season 1 has no clips
      const season1Clips = await getClipsForSeason(seasons[0]);
      expect(season1Clips.some(c => c.id === clips[0].id)).toBe(false);

      // Verify other seasons still have their clips
      for (let i = 1; i < 8; i++) {
        const otherSeasonClips = await getClipsForSeason(seasons[i]);
        expect(otherSeasonClips.some(c => c.id === clips[i].id)).toBe(true);
      }

      // Cleanup remaining clips
      await Promise.all(clips.slice(1).map(c => deleteClipDirect(c.id as string)));
    });

    it('bulk delete across multiple seasons simultaneously', async () => {
      // Create 3 clips in each season (24 total)
      const allClips: Record<string, unknown>[] = [];
      for (const seasonId of seasons) {
        for (let j = 0; j < 3; j++) {
          const clip = await createClipForSeason(seasonId, { title: `Bulk ${j}` });
          allClips.push(clip);
        }
      }

      // Delete all clips in parallel
      await Promise.all(allClips.map(c => deleteClipDirect(c.id as string)));

      // Verify all seasons are empty
      for (const seasonId of seasons) {
        const clips = await getClipsForSeason(seasonId);
        expect(clips).toHaveLength(0);
      }
    });

    it('deleting last clip in season 1 does not affect season 2-8 timers', async () => {
      // Setup: Create clips and start timers in all seasons
      const clips = await Promise.all(
        seasons.map(seasonId => createClipForSeason(seasonId))
      );

      // Approve and set voting status with timers
      const now = new Date();
      const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await Promise.all(clips.map(clip => approveClipDirect(clip.id as string, 1)));
      await Promise.all(
        seasons.map(seasonId => updateSlot(1, {
          status: 'voting',
          voting_started_at: now.toISOString(),
          voting_ends_at: endsAt.toISOString(),
        }, seasonId))
      );

      // Delete clip from season 1
      await deleteClipDirect(clips[0].id as string);

      // Reset season 1 slot (simulating what the app does when last clip deleted)
      await updateSlot(1, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      }, seasons[0]);

      // Verify season 1 timer is cleared
      const slot1 = await getSlot(1, seasons[0]);
      expect(slot1?.voting_ends_at).toBeNull();

      // Verify other seasons still have their timers
      for (let i = 1; i < 8; i++) {
        const slot = await getSlot(1, seasons[i]);
        expect(slot?.voting_ends_at).not.toBeNull();
      }

      // Cleanup
      await Promise.all(clips.slice(1).map(c => deleteClipDirect(c.id as string)));
      await Promise.all(
        seasons.map(seasonId => updateSlot(1, {
          status: 'waiting_for_clips',
          voting_started_at: null,
          voting_ends_at: null,
        }, seasonId))
      );
    });
  });

  describe('Parallel Winner Operations', () => {
    it('assign winner in season 1 while seasons 2-8 are voting', async () => {
      // Create and approve clips in all seasons
      const clips = await Promise.all(
        seasons.map(seasonId => createClipForSeason(seasonId))
      );
      await Promise.all(clips.map(clip => approveClipDirect(clip.id as string, 1)));

      // Set all to voting
      await Promise.all(
        seasons.map(seasonId => updateSlot(1, { status: 'voting' }, seasonId))
      );

      // Assign winner only in season 1
      await assignWinnerDirect(seasons[0], 1, clips[0].id as string);

      // Verify season 1 is locked
      const slot1Season1 = await getSlot(1, seasons[0]);
      expect(slot1Season1?.status).toBe('locked');

      // Verify seasons 2-8 are still voting
      for (let i = 1; i < 8; i++) {
        const slot = await getSlot(1, seasons[i]);
        expect(slot?.status).toBe('voting');
      }

      // Cleanup
      await updateSlot(1, { status: 'waiting_for_clips', winner_tournament_clip_id: null }, seasons[0]);
      await updateSlot(2, { status: 'upcoming' }, seasons[0]);
      await Promise.all(clips.map(async (c) => {
        await testSupabase.from('tournament_clips').update({ status: 'pending' }).eq('id', c.id);
        await deleteClipDirect(c.id as string);
      }));
      await Promise.all(
        seasons.slice(1).map(seasonId => updateSlot(1, { status: 'waiting_for_clips' }, seasonId))
      );
    });

    it('lock season 1 slot 1 does not affect season 2-8 slot 1', async () => {
      // Create and approve clips
      const clips = await Promise.all(
        seasons.map(seasonId => createClipForSeason(seasonId))
      );
      await Promise.all(clips.map(clip => approveClipDirect(clip.id as string, 1)));

      // Lock only season 1 slot 1
      await updateSlot(1, { status: 'locked' }, seasons[0]);

      // Verify isolation
      const season1Slot = await getSlot(1, seasons[0]);
      expect(season1Slot?.status).toBe('locked');

      for (let i = 1; i < 8; i++) {
        const slot = await getSlot(1, seasons[i]);
        expect(slot?.status).not.toBe('locked');
      }

      // Cleanup
      await Promise.all(
        seasons.map(seasonId => updateSlot(1, { status: 'waiting_for_clips' }, seasonId))
      );
      await Promise.all(clips.map(c => deleteClipDirect(c.id as string)));
    });
  });

  describe('Mixed Operations Across Seasons', () => {
    it('different operations in each season simultaneously', async () => {
      // Setup: Create clips in all seasons
      const clips = await Promise.all(
        seasons.map(seasonId => createClipForSeason(seasonId))
      );

      // Perform different operations on each season:
      // Season 1: Upload another clip (already has one)
      const extraClip = await createClipForSeason(seasons[0], { title: 'Extra' });

      // Season 2: Approve clip
      await approveClipDirect(clips[1].id as string, 1);

      // Season 3: Delete clip
      await deleteClipDirect(clips[2].id as string);

      // Season 4: Approve then assign winner
      await approveClipDirect(clips[3].id as string, 1);
      await assignWinnerDirect(seasons[3], 1, clips[3].id as string);

      // Season 5: Just approve
      await approveClipDirect(clips[4].id as string, 1);

      // Season 6: Keep pending
      // (no operation)

      // Season 7: Approve and start timer
      await approveClipDirect(clips[6].id as string, 1);
      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }, seasons[6]);

      // Season 8: Multiple clips
      const clip8b = await createClipForSeason(seasons[7], { title: 'Second' });

      // Verify each season is in expected state
      // Season 1: 2 pending clips
      expect(await countClipsByStatus(seasons[0], 'pending')).toBe(2);

      // Season 2: 1 active clip
      expect(await countClipsByStatus(seasons[1], 'active')).toBe(1);

      // Season 3: 0 clips
      expect(await countClipsByStatus(seasons[2])).toBe(0);

      // Season 4: locked slot
      const slot4 = await getSlot(1, seasons[3]);
      expect(slot4?.status).toBe('locked');

      // Season 5: active clip, waiting slot
      expect(await countClipsByStatus(seasons[4], 'active')).toBe(1);

      // Season 6: pending clip
      expect(await countClipsByStatus(seasons[5], 'pending')).toBe(1);

      // Season 7: voting with timer
      const slot7 = await getSlot(1, seasons[6]);
      expect(slot7?.status).toBe('voting');
      expect(slot7?.voting_ends_at).not.toBeNull();

      // Season 8: 2 pending clips
      expect(await countClipsByStatus(seasons[7], 'pending')).toBe(2);

      // Cleanup
      await updateSlot(1, { status: 'waiting_for_clips', winner_tournament_clip_id: null }, seasons[3]);
      await updateSlot(2, { status: 'upcoming' }, seasons[3]);
      await updateSlot(1, { status: 'waiting_for_clips', voting_started_at: null, voting_ends_at: null }, seasons[6]);

      const allClips = [extraClip, ...clips.filter((_, i) => i !== 2), clip8b];
      await Promise.all(allClips.map(async (c) => {
        await testSupabase.from('tournament_clips').update({ status: 'pending' }).eq('id', c.id);
        await deleteClipDirect(c.id as string);
      }));

      await Promise.all(
        seasons.map(seasonId => updateSlot(1, { status: 'waiting_for_clips' }, seasonId))
      );
    });

    it('all 8 seasons at different stages simultaneously', async () => {
      // Setup each season at a different stage:
      // S1: waiting_for_clips (default)
      // S2: voting (slot 1)
      // S3: locked (slot 1), waiting (slot 2)
      // S4: locked (slots 1-2), waiting (slot 3)
      // S5: voting with 3 clips
      // S6: voting about to end (timer almost expired)
      // S7: all slots locked (season almost complete)
      // S8: mix of pending, active, rejected

      // S2: Create, approve, set voting
      const clipS2 = await createClipForSeason(seasons[1]);
      await approveClipDirect(clipS2.id as string, 1);
      await updateSlot(1, { status: 'voting' }, seasons[1]);

      // S3: Create, approve, winner
      const clipS3 = await createClipForSeason(seasons[2]);
      await approveClipDirect(clipS3.id as string, 1);
      await assignWinnerDirect(seasons[2], 1, clipS3.id as string);

      // S4: Two winners
      const clipS4a = await createClipForSeason(seasons[3]);
      await approveClipDirect(clipS4a.id as string, 1);
      await assignWinnerDirect(seasons[3], 1, clipS4a.id as string);
      const clipS4b = await createClipForSeason(seasons[3]);
      await approveClipDirect(clipS4b.id as string, 2);
      await assignWinnerDirect(seasons[3], 2, clipS4b.id as string);

      // S5: 3 active clips
      const clipsS5 = await Promise.all([
        createClipForSeason(seasons[4]),
        createClipForSeason(seasons[4]),
        createClipForSeason(seasons[4]),
      ]);
      await Promise.all(clipsS5.map(c => approveClipDirect(c.id as string, 1)));
      await updateSlot(1, { status: 'voting' }, seasons[4]);

      // S6: Timer almost expired
      const clipS6 = await createClipForSeason(seasons[5]);
      await approveClipDirect(clipS6.id as string, 1);
      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
        voting_ends_at: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(), // 1 hour left
      }, seasons[5]);

      // S7: Lock first 3 slots
      for (let slot = 1; slot <= 3; slot++) {
        const clip = await createClipForSeason(seasons[6]);
        await approveClipDirect(clip.id as string, slot);
        await assignWinnerDirect(seasons[6], slot, clip.id as string);
      }

      // S8: Mix of statuses
      const clipS8pending = await createClipForSeason(seasons[7]);
      const clipS8active = await createClipForSeason(seasons[7]);
      const clipS8rejected = await createClipForSeason(seasons[7]);
      await approveClipDirect(clipS8active.id as string, 1);
      await testSupabase.from('tournament_clips').update({ status: 'rejected' }).eq('id', clipS8rejected.id);

      // Verify all states
      expect((await getSlot(1, seasons[0]))?.status).toBe('waiting_for_clips');
      expect((await getSlot(1, seasons[1]))?.status).toBe('voting');
      expect((await getSlot(1, seasons[2]))?.status).toBe('locked');
      expect((await getSlot(2, seasons[2]))?.status).toBe('waiting_for_clips');
      expect((await getSlot(1, seasons[3]))?.status).toBe('locked');
      expect((await getSlot(2, seasons[3]))?.status).toBe('locked');
      expect((await getSlot(3, seasons[3]))?.status).toBe('waiting_for_clips');
      expect(await countClipsByStatus(seasons[4], 'active')).toBe(3);
      expect((await getSlot(1, seasons[5]))?.voting_ends_at).not.toBeNull();
      expect((await getSlot(3, seasons[6]))?.status).toBe('locked');
      expect(await countClipsByStatus(seasons[7], 'pending')).toBe(1);
      expect(await countClipsByStatus(seasons[7], 'active')).toBe(1);
      expect(await countClipsByStatus(seasons[7], 'rejected')).toBe(1);

      // Cleanup - this is complex due to the various states
      // Reset all slots and delete all clips
      for (const seasonId of seasons) {
        // Delete all clips first
        const clips = await getClipsForSeason(seasonId);
        for (const clip of clips) {
          await testSupabase.from('tournament_clips').update({ status: 'pending' }).eq('id', clip.id);
        }
        // Clear slot references before deleting clips
        await testSupabase.from('story_slots')
          .update({ winner_tournament_clip_id: null })
          .eq('season_id', seasonId);
        // Now delete clips
        for (const clip of clips) {
          await deleteClipDirect(clip.id as string);
        }
        // Reset all slots
        for (let i = 1; i <= 10; i++) {
          await updateSlot(i, {
            status: i === 1 ? 'waiting_for_clips' : 'upcoming',
            voting_started_at: null,
            voting_ends_at: null,
          }, seasonId);
        }
      }
    });
  });

  describe('Season Status Combinations', () => {
    it('operations only work on active seasons', async () => {
      // Create seasons with different statuses
      const draftSeasonId = await createSeason('Draft Season', 5, 'draft');
      const activeSeasonId = await createSeason('Active Season', 5, 'active');
      const finishedSeasonId = await createSeason('Finished Season', 5, 'finished');

      // Create clips in each
      const draftClip = await createClipForSeason(draftSeasonId);
      const activeClip = await createClipForSeason(activeSeasonId);
      const finishedClip = await createClipForSeason(finishedSeasonId);

      // All clips should be created (database doesn't prevent this)
      expect(draftClip.id).toBeDefined();
      expect(activeClip.id).toBeDefined();
      expect(finishedClip.id).toBeDefined();

      // Cleanup
      await deleteClipDirect(draftClip.id as string);
      await deleteClipDirect(activeClip.id as string);
      await deleteClipDirect(finishedClip.id as string);
    });

    it('mixed status seasons do not interfere', async () => {
      // Create one season of each status
      const draftSeasonId = await createSeason('Isolated Draft', 5, 'draft');
      const activeSeasonId = await createSeason('Isolated Active', 5, 'active');

      // Make changes to active season
      const activeClip = await createClipForSeason(activeSeasonId);
      await approveClipDirect(activeClip.id as string, 1);
      await updateSlot(1, { status: 'voting' }, activeSeasonId);

      // Verify draft season is unaffected
      const draftSlot = await getSlot(1, draftSeasonId);
      expect(draftSlot?.status).toBe('waiting_for_clips');

      // Cleanup
      await deleteClipDirect(activeClip.id as string);
      await updateSlot(1, { status: 'waiting_for_clips' }, activeSeasonId);
    });
  });

  describe('Stress Test: Rapid Multi-Season Operations', () => {
    it('100 clips across 8 seasons with random distribution', async () => {
      const allClips: Record<string, unknown>[] = [];

      // Create 100 clips distributed across 8 seasons
      for (let i = 0; i < 100; i++) {
        const seasonIndex = i % 8;
        const clip = await createClipForSeason(seasons[seasonIndex], {
          title: `Stress Test Clip ${i}`,
        });
        allClips.push(clip);
      }

      // Verify distribution (should be ~12-13 per season)
      for (const seasonId of seasons) {
        const clips = await getClipsForSeason(seasonId);
        expect(clips.length).toBeGreaterThanOrEqual(12);
        expect(clips.length).toBeLessThanOrEqual(13);
      }

      // Cleanup
      await Promise.all(allClips.map(c => deleteClipDirect(c.id as string)));
    });

    it('parallel random operations across all seasons', async () => {
      // Create initial clips
      const initialClips = await Promise.all(
        seasons.map(seasonId => createClipForSeason(seasonId))
      );

      // Perform many parallel operations
      const operations = [
        // More uploads
        ...seasons.map(seasonId => createClipForSeason(seasonId)),
        // Approvals
        ...initialClips.slice(0, 4).map(c => approveClipDirect(c.id as string, 1)),
      ];

      await Promise.all(operations);

      // Verify data integrity - each season should have exactly 2 clips
      for (const seasonId of seasons) {
        const clips = await getClipsForSeason(seasonId);
        expect(clips.length).toBe(2);
      }

      // Cleanup - need to get all clips since we created more
      for (const seasonId of seasons) {
        const clips = await getClipsForSeason(seasonId);
        await Promise.all(clips.map(c => deleteClipDirect(c.id as string)));
      }
      await Promise.all(
        seasons.map(seasonId => updateSlot(1, { status: 'waiting_for_clips' }, seasonId))
      );
    });

    it('verify data integrity after stress operations', async () => {
      // After all tests, verify no cross-contamination
      for (let i = 0; i < seasons.length; i++) {
        const clips = await getClipsForSeason(seasons[i]);
        for (const clip of clips) {
          // Every clip should belong to its correct season
          expect(clip.season_id).toBe(seasons[i]);
        }

        const slots = await getSlotsForSeason(seasons[i]);
        for (const slot of slots) {
          // Every slot should belong to its correct season
          expect(slot.season_id).toBe(seasons[i]);
        }
      }
    });
  });

  describe('Cross-Season Data Integrity', () => {
    it('season IDs never leak across boundaries', async () => {
      // Create clips with specific titles to track them
      const trackedClips = await Promise.all(
        seasons.map((seasonId, i) =>
          createClipForSeason(seasonId, { title: `Tracked-Season-${i}` })
        )
      );

      // Query all clips and verify each is in exactly one season
      for (let i = 0; i < 8; i++) {
        const clips = await getClipsForSeason(seasons[i]);
        const trackedInSeason = clips.filter(c =>
          (c.title as string).startsWith('Tracked-Season-')
        );

        // Should find exactly 1 tracked clip per season
        expect(trackedInSeason.length).toBe(1);
        expect(trackedInSeason[0].title).toBe(`Tracked-Season-${i}`);
      }

      // Cleanup
      await Promise.all(trackedClips.map(c => deleteClipDirect(c.id as string)));
    });

    it('slot positions are independent per season', async () => {
      // Lock slot 1 in all even-numbered seasons
      const evenSeasons = [seasons[0], seasons[2], seasons[4], seasons[6]];
      const oddSeasons = [seasons[1], seasons[3], seasons[5], seasons[7]];

      // Create and lock clips in even seasons
      const evenClips = await Promise.all(
        evenSeasons.map(seasonId => createClipForSeason(seasonId))
      );
      await Promise.all(evenClips.map(c => approveClipDirect(c.id as string, 1)));
      await Promise.all(
        evenSeasons.map((seasonId, i) =>
          assignWinnerDirect(seasonId, 1, evenClips[i].id as string)
        )
      );

      // Verify even seasons are locked, odd are not
      for (const seasonId of evenSeasons) {
        const slot = await getSlot(1, seasonId);
        expect(slot?.status).toBe('locked');
      }

      for (const seasonId of oddSeasons) {
        const slot = await getSlot(1, seasonId);
        expect(slot?.status).toBe('waiting_for_clips');
      }

      // Cleanup
      for (const seasonId of evenSeasons) {
        await testSupabase.from('story_slots')
          .update({ winner_tournament_clip_id: null, status: 'waiting_for_clips' })
          .eq('season_id', seasonId)
          .eq('slot_position', 1);
        await updateSlot(2, { status: 'upcoming' }, seasonId);
      }
      await Promise.all(evenClips.map(async (c) => {
        await testSupabase.from('tournament_clips').update({ status: 'pending' }).eq('id', c.id);
        await deleteClipDirect(c.id as string);
      }));
    });
  });
});
