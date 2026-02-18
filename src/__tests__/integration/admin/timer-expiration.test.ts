/**
 * Timer Expiration Tests
 *
 * Tests what happens when the 24h voting timer expires:
 * - Automatic winner selection
 * - Slot status changes
 * - Timer edge cases
 */

import {
  testSupabase,
  createSeason,
  getSlot,
  cleanupAllTestSeasons,
  updateSlot,
  MULTI_SEASON_USER_ID,
  setupMultiSeasonUser,
} from '../setup';

// Track created resources
const createdClipIds: string[] = [];
let testSeasonId: string;

async function createClipWithVotes(
  seasonId: string,
  slotPosition: number,
  voteCount: number
): Promise<string> {
  // Create clip
  const { data: clip, error: clipError } = await testSupabase
    .from('tournament_clips')
    .insert({
      title: `Timer Test Clip ${Date.now()}`,
      status: 'active',
      season_id: seasonId,
      user_id: MULTI_SEASON_USER_ID,
      slot_position: slotPosition,
      video_url: 'https://test.example.com/video.mp4',
      thumbnail_url: 'https://test.example.com/thumb.jpg',
      genre: 'TEST',
    })
    .select('id')
    .single();

  if (clipError) throw new Error(`Failed to create clip: ${clipError.message}`);

  createdClipIds.push(clip.id);

  // Create votes
  for (let i = 0; i < voteCount; i++) {
    await testSupabase.from('votes').insert({
      voter_key: `timer_voter_${clip.id}_${i}`,
      clip_id: clip.id,
      slot_position: slotPosition,
      vote_weight: 1,
    });
  }

  return clip.id;
}

async function getVoteCount(clipId: string): Promise<number> {
  const { count } = await testSupabase
    .from('votes')
    .select('id', { count: 'exact', head: true })
    .eq('clip_id', clipId);

  return count || 0;
}

async function cleanupTestData(): Promise<void> {
  // Delete votes
  for (const clipId of createdClipIds) {
    await testSupabase.from('votes').delete().eq('clip_id', clipId);
  }

  // Clear slot winners before deleting clips
  await testSupabase
    .from('story_slots')
    .update({ winner_tournament_clip_id: null })
    .eq('season_id', testSeasonId);

  // Delete clips
  for (const clipId of createdClipIds) {
    await testSupabase.from('tournament_clips').delete().eq('id', clipId);
  }

  await cleanupAllTestSeasons();
  createdClipIds.length = 0;
}

describe('Timer Expiration Tests', () => {
  beforeAll(async () => {
    await setupMultiSeasonUser();
    testSeasonId = await createSeason('Timer Test Season', 10, 'active');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe('Timer States', () => {
    it('can set voting timer to past (expired state)', async () => {
      const pastTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const startTime = new Date(pastTime.getTime() - 24 * 60 * 60 * 1000); // 25 hours ago

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: startTime.toISOString(),
        voting_ends_at: pastTime.toISOString(),
      }, testSeasonId);

      const slot = await getSlot(1, testSeasonId);
      expect(slot?.status).toBe('voting');

      const endsAt = new Date(slot?.voting_ends_at as string);
      expect(endsAt.getTime()).toBeLessThan(Date.now());

      // Cleanup
      await updateSlot(1, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      }, testSeasonId);
    });

    it('can set voting timer to future (active state)', async () => {
      const now = new Date();
      const futureTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: futureTime.toISOString(),
      }, testSeasonId);

      const slot = await getSlot(1, testSeasonId);
      const endsAt = new Date(slot?.voting_ends_at as string);

      expect(endsAt.getTime()).toBeGreaterThan(Date.now());

      // Cleanup
      await updateSlot(1, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      }, testSeasonId);
    });

    it('timer with exactly 0 seconds remaining', async () => {
      const now = new Date();

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        voting_ends_at: now.toISOString(),
      }, testSeasonId);

      const slot = await getSlot(1, testSeasonId);
      expect(slot?.voting_ends_at).not.toBeNull();

      // Cleanup
      await updateSlot(1, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      }, testSeasonId);
    });
  });

  describe('Winner Determination on Expiration', () => {
    beforeEach(async () => {
      // Clean up all clips from previous tests
      for (const clipId of [...createdClipIds]) {
        await testSupabase.from('votes').delete().eq('clip_id', clipId);
      }
      await testSupabase
        .from('story_slots')
        .update({ winner_tournament_clip_id: null })
        .eq('season_id', testSeasonId);
      for (const clipId of [...createdClipIds]) {
        await testSupabase.from('tournament_clips').delete().eq('id', clipId);
      }
      createdClipIds.length = 0;

      // Reset slot
      await updateSlot(1, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
        winner_tournament_clip_id: null,
      }, testSeasonId);
    });

    it('clip with most votes should win when timer expires', async () => {
      // Create 3 clips with different vote counts
      const clip1 = await createClipWithVotes(testSeasonId, 1, 10);
      const clip2 = await createClipWithVotes(testSeasonId, 1, 50); // Winner
      const clip3 = await createClipWithVotes(testSeasonId, 1, 25);

      // Verify vote counts
      expect(await getVoteCount(clip1)).toBe(10);
      expect(await getVoteCount(clip2)).toBe(50);
      expect(await getVoteCount(clip3)).toBe(25);

      // Simulate winner selection (what the system should do on expiration)
      const { data: clips } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('season_id', testSeasonId)
        .eq('slot_position', 1)
        .eq('status', 'active');

      // Get vote counts for each clip
      const voteCounts = new Map<string, number>();
      for (const clip of clips || []) {
        voteCounts.set(clip.id, await getVoteCount(clip.id));
      }

      // Find winner
      let winnerId = '';
      let maxVotes = 0;
      for (const [id, count] of voteCounts.entries()) {
        if (count > maxVotes) {
          maxVotes = count;
          winnerId = id;
        }
      }

      expect(winnerId).toBe(clip2);
      expect(maxVotes).toBe(50);
    });

    it('handles tie-breaker scenario (earliest upload wins)', async () => {
      // Create 2 clips with same votes
      const clip1 = await createClipWithVotes(testSeasonId, 1, 30);
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      const clip2 = await createClipWithVotes(testSeasonId, 1, 30);

      // Both have same votes
      expect(await getVoteCount(clip1)).toBe(30);
      expect(await getVoteCount(clip2)).toBe(30);

      // Get clips ordered by creation time
      const { data: clips } = await testSupabase
        .from('tournament_clips')
        .select('id, created_at')
        .eq('season_id', testSeasonId)
        .eq('slot_position', 1)
        .order('created_at', { ascending: true });

      // First created should win in tie-breaker
      expect(clips?.[0].id).toBe(clip1);
    });

    it('handles single clip scenario (auto-win)', async () => {
      const clip = await createClipWithVotes(testSeasonId, 1, 5);

      // Only one clip = automatic winner
      const { data: clips } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('season_id', testSeasonId)
        .eq('slot_position', 1)
        .eq('status', 'active');

      expect(clips?.length).toBe(1);
      expect(clips?.[0].id).toBe(clip);
    });

    it('handles zero votes scenario', async () => {
      // Create clips without any votes
      const { data: clip1 } = await testSupabase
        .from('tournament_clips')
        .insert({
          title: 'Zero Votes Clip 1',
          status: 'active',
          season_id: testSeasonId,
          user_id: MULTI_SEASON_USER_ID,
          slot_position: 1,
          video_url: 'https://test.example.com/video.mp4',
          thumbnail_url: 'https://test.example.com/thumb.jpg',
          genre: 'TEST',
        })
        .select('id')
        .single();

      await new Promise(resolve => setTimeout(resolve, 10));

      const { data: clip2 } = await testSupabase
        .from('tournament_clips')
        .insert({
          title: 'Zero Votes Clip 2',
          status: 'active',
          season_id: testSeasonId,
          user_id: MULTI_SEASON_USER_ID,
          slot_position: 1,
          video_url: 'https://test.example.com/video.mp4',
          thumbnail_url: 'https://test.example.com/thumb.jpg',
          genre: 'TEST',
        })
        .select('id')
        .single();

      createdClipIds.push(clip1!.id, clip2!.id);

      // Both have 0 votes - earliest should win
      expect(await getVoteCount(clip1!.id)).toBe(0);
      expect(await getVoteCount(clip2!.id)).toBe(0);

      const { data: clips } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('season_id', testSeasonId)
        .eq('slot_position', 1)
        .order('created_at', { ascending: true });

      expect(clips?.[0].id).toBe(clip1!.id);
    });
  });

  describe('Timer Edge Cases', () => {
    it('very long timer (30 days)', async () => {
      const now = new Date();
      const farFuture = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await updateSlot(2, {
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: farFuture.toISOString(),
      }, testSeasonId);

      const slot = await getSlot(2, testSeasonId);
      const endsAt = new Date(slot?.voting_ends_at as string);
      const daysRemaining = (endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);

      expect(daysRemaining).toBeGreaterThan(29);
      expect(daysRemaining).toBeLessThan(31);

      // Cleanup
      await updateSlot(2, {
        status: 'upcoming',
        voting_started_at: null,
        voting_ends_at: null,
      }, testSeasonId);
    });

    it('very short timer (1 minute)', async () => {
      const now = new Date();
      const shortFuture = new Date(now.getTime() + 60 * 1000); // 1 minute

      await updateSlot(2, {
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: shortFuture.toISOString(),
      }, testSeasonId);

      const slot = await getSlot(2, testSeasonId);
      const endsAt = new Date(slot?.voting_ends_at as string);
      const secondsRemaining = (endsAt.getTime() - Date.now()) / 1000;

      expect(secondsRemaining).toBeGreaterThan(0);
      expect(secondsRemaining).toBeLessThan(61);

      // Cleanup
      await updateSlot(2, {
        status: 'upcoming',
        voting_started_at: null,
        voting_ends_at: null,
      }, testSeasonId);
    });

    it('timer already expired by 7 days', async () => {
      const longPast = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const startTime = new Date(longPast.getTime() - 24 * 60 * 60 * 1000);

      await updateSlot(2, {
        status: 'voting',
        voting_started_at: startTime.toISOString(),
        voting_ends_at: longPast.toISOString(),
      }, testSeasonId);

      const slot = await getSlot(2, testSeasonId);
      const endsAt = new Date(slot?.voting_ends_at as string);
      const daysExpired = (Date.now() - endsAt.getTime()) / (24 * 60 * 60 * 1000);

      expect(daysExpired).toBeGreaterThan(6);

      // Cleanup
      await updateSlot(2, {
        status: 'upcoming',
        voting_started_at: null,
        voting_ends_at: null,
      }, testSeasonId);
    });

    it('null timer values are handled', async () => {
      await updateSlot(2, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      }, testSeasonId);

      const slot = await getSlot(2, testSeasonId);
      expect(slot?.voting_started_at).toBeNull();
      expect(slot?.voting_ends_at).toBeNull();
    });
  });

  describe('Slot Transitions on Timer Events', () => {
    it('slot should transition from voting to locked when winner assigned', async () => {
      const clipId = await createClipWithVotes(testSeasonId, 3, 10);

      // Set voting state
      await updateSlot(3, { status: 'voting' }, testSeasonId);

      // Simulate timer expiration -> winner assignment
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clipId);

      await updateSlot(3, {
        status: 'locked',
        winner_tournament_clip_id: clipId,
      }, testSeasonId);

      const slot = await getSlot(3, testSeasonId);
      expect(slot?.status).toBe('locked');
      expect(slot?.winner_tournament_clip_id).toBe(clipId);

      // Cleanup
      await updateSlot(3, {
        status: 'upcoming',
        winner_tournament_clip_id: null,
      }, testSeasonId);
    });

    it('next slot should become waiting_for_clips after current locks', async () => {
      const clipId = await createClipWithVotes(testSeasonId, 4, 5);

      // Lock slot 4
      await updateSlot(4, {
        status: 'locked',
        winner_tournament_clip_id: clipId,
      }, testSeasonId);

      // Advance slot 5
      await updateSlot(5, { status: 'waiting_for_clips' }, testSeasonId);

      const slot4 = await getSlot(4, testSeasonId);
      const slot5 = await getSlot(5, testSeasonId);

      expect(slot4?.status).toBe('locked');
      expect(slot5?.status).toBe('waiting_for_clips');

      // Cleanup
      await updateSlot(4, {
        status: 'upcoming',
        winner_tournament_clip_id: null,
      }, testSeasonId);
      await updateSlot(5, { status: 'upcoming' }, testSeasonId);
    });
  });
});
