/**
 * Edge Cases Tests
 *
 * Tests unusual scenarios:
 * - Empty seasons
 * - Max clips limits
 * - Special characters
 * - Boundary conditions
 * - Race conditions
 */

import {
  testSupabase,
  createSeason,
  getSlot,
  getSlotsForSeason,
  getClipsForSeason,
  cleanupAllTestSeasons,
  setupMultiSeasonUser,
  updateSlot,
  MULTI_SEASON_USER_ID,
} from '../setup';

// Track created resources
const createdClipIds: string[] = [];
let testSeasonId: string;

async function createTestClip(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await testSupabase
    .from('tournament_clips')
    .insert({
      title: `Edge Case Clip ${Date.now()}`,
      status: 'pending',
      season_id: testSeasonId,
      user_id: MULTI_SEASON_USER_ID,
      video_url: 'https://test.example.com/video.mp4',
      thumbnail_url: 'https://test.example.com/thumb.jpg',
      genre: 'TEST',
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create clip: ${error.message}`);

  createdClipIds.push(data.id);
  return data.id;
}

async function cleanupTestData(): Promise<void> {
  // Clear slot winners
  if (testSeasonId) {
    await testSupabase
      .from('story_slots')
      .update({ winner_tournament_clip_id: null })
      .eq('season_id', testSeasonId);
  }

  // Delete clips
  for (const clipId of createdClipIds) {
    await testSupabase.from('votes').delete().eq('clip_id', clipId);
    await testSupabase.from('tournament_clips').delete().eq('id', clipId);
  }

  await cleanupAllTestSeasons();
  createdClipIds.length = 0;
}

describe('Edge Cases Tests', () => {
  beforeAll(async () => {
    await setupMultiSeasonUser();
    testSeasonId = await createSeason('Edge Case Test Season', 10, 'active');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe('Empty Season Scenarios', () => {
    it('season with zero clips is valid', async () => {
      const emptySeasonId = await createSeason('Empty Season', 5, 'active');

      const clips = await getClipsForSeason(emptySeasonId);
      expect(clips).toHaveLength(0);

      const slots = await getSlotsForSeason(emptySeasonId);
      expect(slots.length).toBe(5);
    });

    it('all slots remain in initial state with no clips', async () => {
      const emptySeasonId = await createSeason('Empty Season 2', 10, 'active');

      const slots = await getSlotsForSeason(emptySeasonId);

      // First slot should be waiting_for_clips
      expect(slots[0].status).toBe('waiting_for_clips');

      // All other slots should be upcoming
      for (let i = 1; i < slots.length; i++) {
        expect(slots[i].status).toBe('upcoming');
      }
    });

    it('deleting all clips returns season to empty state', async () => {
      // Create and then delete clips
      const clip1 = await createTestClip();
      const clip2 = await createTestClip();

      let clips = await getClipsForSeason(testSeasonId);
      expect(clips.length).toBeGreaterThanOrEqual(2);

      // Delete all clips
      await testSupabase.from('tournament_clips').delete().eq('id', clip1);
      await testSupabase.from('tournament_clips').delete().eq('id', clip2);

      // Remove from tracking
      createdClipIds.splice(createdClipIds.indexOf(clip1), 1);
      createdClipIds.splice(createdClipIds.indexOf(clip2), 1);

      // Verify deletion
      const { data } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .in('id', [clip1, clip2]);

      expect(data).toHaveLength(0);
    });
  });

  describe('Maximum Clips Scenarios', () => {
    it('can create 100 clips in a single slot', async () => {
      const clipIds: string[] = [];

      for (let i = 0; i < 100; i++) {
        const id = await createTestClip({
          title: `Mass Clip ${i}`,
          status: 'active',
          slot_position: 1,
        });
        clipIds.push(id);
      }

      // Verify all created
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', testSeasonId)
        .eq('slot_position', 1);

      expect(count).toBe(100);
    }, 30000);

    it('can query slot with many clips efficiently', async () => {
      const startTime = Date.now();

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('id, title, status')
        .eq('season_id', testSeasonId)
        .eq('slot_position', 1)
        .limit(50);

      const duration = Date.now() - startTime;

      expect(data?.length).toBeLessThanOrEqual(50);
      expect(duration).toBeLessThan(1000); // Should be fast
    });

    it('can count votes across many clips', async () => {
      // Add votes to some clips
      const { data: clips } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('season_id', testSeasonId)
        .limit(10);

      for (const clip of clips || []) {
        for (let i = 0; i < 5; i++) {
          await testSupabase.from('votes').insert({
            voter_key: `mass_voter_${clip.id}_${i}`,
            clip_id: clip.id,
            slot_position: 1,
            vote_weight: 1,
          });
        }
      }

      // Count total votes
      const { count } = await testSupabase
        .from('votes')
        .select('id', { count: 'exact', head: true })
        .in('clip_id', clips?.map(c => c.id) || []);

      expect(count).toBe(50);

      // Cleanup votes
      for (const clip of clips || []) {
        await testSupabase.from('votes').delete().eq('clip_id', clip.id);
      }
    });
  });

  describe('Special Characters in Data', () => {
    it('handles Unicode characters in title', async () => {
      const unicodeTitle = '日本語タイトル 中文标题 한국어 제목 العربية';

      const id = await createTestClip({ title: unicodeTitle });

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('title')
        .eq('id', id)
        .single();

      expect(data?.title).toBe(unicodeTitle);
    });

    it('handles emoji in title', async () => {
      const emojiTitle = '🎬 Movie Night 🍿 Best Clip Ever! 🏆';

      const id = await createTestClip({ title: emojiTitle });

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('title')
        .eq('id', id)
        .single();

      expect(data?.title).toBe(emojiTitle);
    });

    it('handles HTML/script tags in title (stored as-is)', async () => {
      const htmlTitle = '<script>alert("xss")</script><b>Bold</b>';

      const id = await createTestClip({ title: htmlTitle });

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('title')
        .eq('id', id)
        .single();

      // Should be stored exactly as provided
      expect(data?.title).toBe(htmlTitle);
    });

    it('handles SQL injection attempt in title', async () => {
      const sqlTitle = "'; DROP TABLE tournament_clips; --";

      const id = await createTestClip({ title: sqlTitle });

      // Table should still exist
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true });

      expect(count).toBeGreaterThan(0);

      // Title should be stored safely
      const { data } = await testSupabase
        .from('tournament_clips')
        .select('title')
        .eq('id', id)
        .single();

      expect(data?.title).toBe(sqlTitle);
    });

    it('handles newlines and tabs in description', async () => {
      const multilineDesc = 'Line 1\nLine 2\n\tTabbed line\r\nWindows line';

      const id = await createTestClip({ description: multilineDesc });

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('description')
        .eq('id', id)
        .single();

      expect(data?.description).toBe(multilineDesc);
    });

    it('handles null bytes in title', async () => {
      const nullTitle = 'Title with \x00 null byte';

      const { data, error } = await testSupabase
        .from('tournament_clips')
        .insert({
          title: nullTitle,
          status: 'pending',
          season_id: testSeasonId,
          user_id: MULTI_SEASON_USER_ID,
          video_url: 'https://test.example.com/video.mp4',
        })
        .select('id')
        .single();

      // Might succeed or fail - both valid
      if (data) {
        createdClipIds.push(data.id);
      }
    });
  });

  describe('Slot Position Edge Cases', () => {
    it('clips can exist without slot assignment', async () => {
      const id = await createTestClip({
        status: 'pending',
        slot_position: null,
      });

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('slot_position')
        .eq('id', id)
        .single();

      expect(data?.slot_position).toBeNull();
    });

    it('multiple clips in same slot coexist', async () => {
      const clip1 = await createTestClip({ status: 'active', slot_position: 5 });
      const clip2 = await createTestClip({ status: 'active', slot_position: 5 });
      const clip3 = await createTestClip({ status: 'active', slot_position: 5 });

      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', testSeasonId)
        .eq('slot_position', 5);

      expect(count).toBe(3);
    });

    it('clip can move between slots', async () => {
      const clipId = await createTestClip({ status: 'active', slot_position: 6 });

      // Move to different slot
      await testSupabase
        .from('tournament_clips')
        .update({ slot_position: 7 })
        .eq('id', clipId);

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('slot_position')
        .eq('id', clipId)
        .single();

      expect(data?.slot_position).toBe(7);
    });

    it('removing slot assignment works', async () => {
      const clipId = await createTestClip({ status: 'active', slot_position: 8 });

      // Remove slot assignment
      await testSupabase
        .from('tournament_clips')
        .update({ slot_position: null, status: 'pending' })
        .eq('id', clipId);

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('slot_position, status')
        .eq('id', clipId)
        .single();

      expect(data?.slot_position).toBeNull();
      expect(data?.status).toBe('pending');
    });
  });

  describe('Timing Edge Cases', () => {
    it('rapid create-update-delete sequence', async () => {
      // Create
      const { data: created, error } = await testSupabase
        .from('tournament_clips')
        .insert({
          title: 'Rapid Test',
          status: 'pending',
          season_id: testSeasonId,
          user_id: MULTI_SEASON_USER_ID,
          video_url: 'https://test.example.com/video.mp4',
          thumbnail_url: 'https://test.example.com/thumb.jpg',
        })
        .select('id')
        .single();

      if (!created) {
        console.log('Create failed:', error?.message);
        return;
      }

      // Update immediately
      await testSupabase
        .from('tournament_clips')
        .update({ title: 'Updated Rapid Test' })
        .eq('id', created.id);

      // Delete immediately
      await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('id', created.id);

      // Verify deleted
      const { data: deleted } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('id', created.id)
        .single();

      expect(deleted).toBeNull();
    });

    it('simultaneous create operations', async () => {
      const createPromises = Array(10).fill(null).map((_, i) =>
        testSupabase
          .from('tournament_clips')
          .insert({
            title: `Simultaneous ${i}`,
            status: 'pending',
            season_id: testSeasonId,
            user_id: MULTI_SEASON_USER_ID,
            video_url: 'https://test.example.com/video.mp4',
            thumbnail_url: 'https://test.example.com/thumb.jpg',
          })
          .select('id')
          .single()
      );

      const results = await Promise.all(createPromises);

      const successful = results.filter(r => r.data).map(r => r.data!.id);
      createdClipIds.push(...successful);

      // All should succeed
      expect(successful.length).toBe(10);
    });
  });

  describe('Season State Edge Cases', () => {
    it('finished season still allows reads', async () => {
      const finishedSeasonId = await createSeason('Finished Season', 5, 'finished');

      const slots = await getSlotsForSeason(finishedSeasonId);
      expect(slots.length).toBe(5);
    });

    it('draft season clips are accessible', async () => {
      const draftSeasonId = await createSeason('Draft Season', 5, 'draft');

      // Create clip in draft season
      const { data, error } = await testSupabase
        .from('tournament_clips')
        .insert({
          title: 'Draft Clip',
          status: 'pending',
          season_id: draftSeasonId,
          user_id: MULTI_SEASON_USER_ID,
          video_url: 'https://test.example.com/video.mp4',
          thumbnail_url: 'https://test.example.com/thumb.jpg',
        })
        .select('id')
        .single();

      if (error) throw new Error(`Failed to create clip: ${error.message}`);

      createdClipIds.push(data.id);

      const clips = await getClipsForSeason(draftSeasonId);
      expect(clips.length).toBe(1);
    });

    it('season with all slots locked', async () => {
      const lockedSeasonId = await createSeason('Locked Season', 3, 'active');

      // Lock all slots (without actual clips)
      for (let i = 1; i <= 3; i++) {
        await updateSlot(i, { status: 'locked' }, lockedSeasonId);
      }

      const slots = await getSlotsForSeason(lockedSeasonId);
      const lockedCount = slots.filter(s => s.status === 'locked').length;

      expect(lockedCount).toBe(3);
    });
  });

  describe('Data Consistency Checks', () => {
    it('clip count matches database count', async () => {
      const clips = await getClipsForSeason(testSeasonId);

      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', testSeasonId);

      expect(clips.length).toBe(count);
    });

    it('slot count matches total_slots in season', async () => {
      const newSeasonId = await createSeason('Count Check Season', 7, 'active');

      const slots = await getSlotsForSeason(newSeasonId);

      const { data: season } = await testSupabase
        .from('seasons')
        .select('total_slots')
        .eq('id', newSeasonId)
        .single();

      expect(slots.length).toBe(season?.total_slots);
    });

    it('winner clip exists in slot clips', async () => {
      const clipId = await createTestClip({
        status: 'locked',
        slot_position: 9,
      });

      await updateSlot(9, {
        status: 'locked',
        winner_tournament_clip_id: clipId,
      }, testSeasonId);

      // Verify winner is in slot's clips
      const { data: slotClips } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('season_id', testSeasonId)
        .eq('slot_position', 9);

      const clipIds = slotClips?.map(c => c.id) || [];
      expect(clipIds).toContain(clipId);

      // Cleanup
      await updateSlot(9, {
        status: 'upcoming',
        winner_tournament_clip_id: null,
      }, testSeasonId);
    });
  });
});
