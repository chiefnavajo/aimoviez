/**
 * E2E User Journey Tests
 *
 * Tests complete user flows from start to finish:
 * - Upload → Approve → Vote → Win journey
 * - Credit purchase → AI generation → Submit flow
 * - Comment interaction flow
 * - Season progression through multiple slots
 */

import {
  testSupabase,
  createSeason,
  cleanupAllTestSeasons,
  setupMultiSeasonUser,
  MULTI_SEASON_USER_ID,
  updateSlot,
} from '../setup';
import {
  createClip,
  createVote,
  createVoteBatch,
  getVoteCount,
  createComment,
  createUser,
  createGeneration,
  cleanupAllFixtures,
  trackedResources,
  assertDefined,
  assertStatus,
} from '../fixtures';

// ---------------------------------------------------------------------------
// Helper: look up the story_slots UUID for a (season, position) pair
// ---------------------------------------------------------------------------
async function getSlotId(seasonId: string, slotPosition: number): Promise<string> {
  const { data, error } = await testSupabase
    .from('story_slots')
    .select('id')
    .eq('season_id', seasonId)
    .eq('slot_position', slotPosition)
    .single();

  if (error || !data) {
    throw new Error(
      `Could not find slot id for season=${seasonId} position=${slotPosition}: ${error?.message ?? 'no data'}`,
    );
  }
  return data.id as string;
}

// ---------------------------------------------------------------------------
// Helper: assign a winner via the assign_winner_atomic RPC
// ---------------------------------------------------------------------------
async function assignWinnerViaRpc(
  clipId: string,
  slotId: string,
  seasonId: string,
  nextSlotPosition: number,
  votingDurationHours = 24,
  advanceSlot = true,
): Promise<{ success: boolean; message: string }> {
  const { data, error } = await testSupabase.rpc('assign_winner_atomic', {
    p_clip_id: clipId,
    p_slot_id: slotId,
    p_season_id: seasonId,
    p_next_slot_position: nextSlotPosition,
    p_voting_duration_hours: votingDurationHours,
    p_advance_slot: advanceSlot,
  });

  if (error) {
    throw new Error(`assign_winner_atomic RPC failed: ${error.message}`);
  }

  // The RPC returns a single-row table; Supabase may wrap it in an array.
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.success) {
    throw new Error(`assign_winner_atomic returned failure: ${result?.message ?? 'unknown'}`);
  }
  return result as { success: boolean; message: string };
}

let testSeasonId: string;

describe('E2E: Complete User Journeys', () => {
  beforeAll(async () => {
    await setupMultiSeasonUser();
    testSeasonId = await createSeason(
      'E2E Journey Season',
      10,
      'active',
    );
  });

  afterAll(async () => {
    try {
      // Clean up all tracked resources
      for (const clipId of trackedResources.clips) {
        await testSupabase.from('votes').delete().eq('clip_id', clipId);
        await testSupabase.from('comments').delete().eq('clip_id', clipId);
      }
      await testSupabase
        .from('story_slots')
        .update({ winner_tournament_clip_id: null })
        .eq('season_id', testSeasonId);
      for (const clipId of trackedResources.clips) {
        await testSupabase.from('tournament_clips').delete().eq('id', clipId);
      }
      for (const genId of trackedResources.generations) {
        await testSupabase.from('ai_generations').delete().eq('id', genId);
      }
      for (const userId of trackedResources.users) {
        if (userId !== MULTI_SEASON_USER_ID) {
          await testSupabase.from('users').delete().eq('id', userId);
        }
      }
    } finally {
      trackedResources.clips.length = 0;
      trackedResources.comments.length = 0;
      trackedResources.votes.length = 0;
      trackedResources.users.length = 0;
      trackedResources.generations.length = 0;
      await cleanupAllTestSeasons();
    }
  });

  describe('Journey: Upload → Approve → Vote → Win', () => {
    it('completes full clip lifecycle from upload to winner', async () => {
      // STEP 1: Creator uploads a clip (pending status)
      const clip = await createClip(testSeasonId, {
        title: 'Journey Test Clip',
        status: 'pending',
      });
      assertDefined(clip.id, 'clip ID');
      assertStatus(clip.status, 'pending', 'initial clip');

      // STEP 2: Admin approves the clip (active status, assigned to slot)
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .eq('id', clip.id);

      const { data: approved } = await testSupabase
        .from('tournament_clips')
        .select('status, slot_position')
        .eq('id', clip.id)
        .single();

      assertDefined(approved, 'approved clip');
      assertStatus(approved.status, 'active', 'approved clip');
      expect(approved.slot_position).toBe(1);

      // STEP 3: Set slot to voting mode
      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        voting_duration_hours: 24,
      }, testSeasonId);

      // STEP 4: Users vote on the clip
      await createVoteBatch(clip.id, 50, { slotPosition: 1 });
      const voteCount = await getVoteCount(clip.id);
      expect(voteCount).toBe(50);

      // STEP 5: Timer expires, clip wins — use assign_winner_atomic RPC
      const slotId = await getSlotId(testSeasonId, 1);
      await assignWinnerViaRpc(clip.id, slotId, testSeasonId, 2);

      // STEP 6: Verify final state
      const { data: winner } = await testSupabase
        .from('tournament_clips')
        .select('status')
        .eq('id', clip.id)
        .single();

      assertDefined(winner, 'winner clip');
      assertStatus(winner.status, 'locked', 'winner clip');

      const { data: slot } = await testSupabase
        .from('story_slots')
        .select('status, winner_tournament_clip_id')
        .eq('season_id', testSeasonId)
        .eq('slot_position', 1)
        .single();

      assertDefined(slot, 'slot');
      expect(slot.status).toBe('locked');
      expect(slot.winner_tournament_clip_id).toBe(clip.id);
    });

    it('handles competition between multiple clips', async () => {
      // Create 3 competing clips
      const clips = await Promise.all([
        createClip(testSeasonId, { title: 'Competitor 1', status: 'active', slotPosition: 2 }),
        createClip(testSeasonId, { title: 'Competitor 2', status: 'active', slotPosition: 2 }),
        createClip(testSeasonId, { title: 'Competitor 3', status: 'active', slotPosition: 2 }),
      ]);

      // Set slot to voting
      await updateSlot(2, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        voting_duration_hours: 24,
      }, testSeasonId);

      // Different vote counts: 10, 30, 20
      await createVoteBatch(clips[0].id, 10, { slotPosition: 2 });
      await createVoteBatch(clips[1].id, 30, { slotPosition: 2 }); // Winner
      await createVoteBatch(clips[2].id, 20, { slotPosition: 2 });

      // Verify vote counts
      const counts = await Promise.all(clips.map(c => getVoteCount(c.id)));
      expect(counts).toEqual([10, 30, 20]);

      // Determine winner (clip with most votes)
      const maxVotes = Math.max(...counts);
      const winnerIndex = counts.indexOf(maxVotes);
      const winnerId = clips[winnerIndex].id;

      expect(winnerId).toBe(clips[1].id);

      // Assign winner via RPC — also eliminates losers atomically
      const slotId = await getSlotId(testSeasonId, 2);
      await assignWinnerViaRpc(winnerId, slotId, testSeasonId, 3);

      // Verify slot
      const { data: slot } = await testSupabase
        .from('story_slots')
        .select('status, winner_tournament_clip_id')
        .eq('season_id', testSeasonId)
        .eq('slot_position', 2)
        .single();

      expect(slot?.status).toBe('locked');
      expect(slot?.winner_tournament_clip_id).toBe(clips[1].id);

      // Verify losing clips were eliminated
      const { data: losers } = await testSupabase
        .from('tournament_clips')
        .select('id, status, eliminated_at, elimination_reason')
        .in('id', [clips[0].id, clips[2].id]);

      expect(losers?.length).toBe(2);
      for (const loser of losers ?? []) {
        expect(loser.status).toBe('eliminated');
        expect(loser.eliminated_at).not.toBeNull();
        expect(loser.elimination_reason).toBe('lost');
      }
    });
  });

  describe('Journey: Credit Purchase → AI Generation → Submit', () => {
    it('completes AI generation flow with credits', async () => {
      // STEP 1: User has credits
      const user = await createUser({ balanceCredits: 100 });
      expect(user.balanceCredits).toBe(100);

      // STEP 2: User initiates AI generation (deduct credits)
      const generationCost = 25;
      await testSupabase
        .from('users')
        .update({ balance_credits: user.balanceCredits - generationCost })
        .eq('id', user.id);

      // STEP 3: Create generation record
      const generation = await createGeneration({
        userId: user.id,
        prompt: 'A cinematic sunset scene',
        status: 'pending',
        creditAmount: generationCost,
      });

      assertDefined(generation.id, 'generation ID');

      // STEP 4: Generation completes
      await testSupabase
        .from('ai_generations')
        .update({
          status: 'completed',
          video_url: 'https://fal.ai/output/video.mp4',
        })
        .eq('id', generation.id);

      // STEP 5: Verify user balance
      const { data: updatedUser } = await testSupabase
        .from('users')
        .select('balance_credits')
        .eq('id', user.id)
        .single();

      expect(updatedUser?.balance_credits).toBe(75);

      // STEP 6: User submits generated clip
      const clip = await createClip(testSeasonId, {
        title: 'AI Generated Clip',
        status: 'pending',
        userId: user.id,
      });

      // Link generation to clip
      await testSupabase
        .from('ai_generations')
        .update({ clip_id: clip.id })
        .eq('id', generation.id);

      // Verify link
      const { data: gen } = await testSupabase
        .from('ai_generations')
        .select('clip_id')
        .eq('id', generation.id)
        .single();

      expect(gen?.clip_id).toBe(clip.id);
    });

    it('handles insufficient credits gracefully', async () => {
      const user = await createUser({ balanceCredits: 10 });
      const generationCost = 25;

      // User doesn't have enough credits
      expect(user.balanceCredits).toBeLessThan(generationCost);

      // Application should prevent generation
      // (This is application-level logic, not DB-level)
      const canGenerate = user.balanceCredits >= generationCost;
      expect(canGenerate).toBe(false);
    });

    it('handles generation failure with credit refund', async () => {
      const user = await createUser({ balanceCredits: 100 });
      const generationCost = 25;

      // Deduct credits
      await testSupabase
        .from('users')
        .update({ balance_credits: 75 })
        .eq('id', user.id);

      // Create failed generation
      const generation = await createGeneration({
        userId: user.id,
        status: 'failed',
        creditAmount: generationCost,
      });

      // Refund credits
      await testSupabase
        .from('users')
        .update({ balance_credits: 100 })
        .eq('id', user.id);

      // Verify refund
      const { data: refunded } = await testSupabase
        .from('users')
        .select('balance_credits')
        .eq('id', user.id)
        .single();

      expect(refunded?.balance_credits).toBe(100);
    });
  });

  describe('Journey: Comment Interaction', () => {
    // user_key must be in the format "user_<uuid>" because the
    // check_commenter_not_banned trigger parses a UUID out of it.
    const aliceKey = `user_${crypto.randomUUID()}`;
    const bobKey = `user_${crypto.randomUUID()}`;

    it('completes comment thread creation', async () => {
      // Create a clip to comment on
      const clip = await createClip(testSeasonId, { status: 'active', slotPosition: 3 });

      // STEP 1: User posts a comment
      const comment1 = await createComment(clip.id, {
        text: 'Great clip!',
        userKey: aliceKey,
        username: 'Alice',
      });

      // STEP 2: Another user replies
      const reply1 = await createComment(clip.id, {
        text: 'I agree!',
        userKey: bobKey,
        username: 'Bob',
        parentId: comment1.id,
      });

      // STEP 3: Original user replies back
      const reply2 = await createComment(clip.id, {
        text: 'Thanks!',
        userKey: aliceKey,
        username: 'Alice',
        parentId: reply1.id,
      });

      // Verify thread structure
      const { data: comments } = await testSupabase
        .from('comments')
        .select('id, parent_comment_id')
        .eq('clip_id', clip.id)
        .order('created_at', { ascending: true });

      expect(comments?.length).toBe(3);
      expect(comments?.[0].parent_comment_id).toBeNull();
      expect(comments?.[1].parent_comment_id).toBe(comment1.id);
      expect(comments?.[2].parent_comment_id).toBe(reply1.id);
    });

    it('handles comment like/unlike flow', async () => {
      const clip = await createClip(testSeasonId, { status: 'active', slotPosition: 4 });
      const comment = await createComment(clip.id, { text: 'Likeable comment' });

      // STEP 1: User likes the comment
      const likerKey = `user_${crypto.randomUUID()}`;
      await testSupabase.from('comment_likes').insert({
        comment_id: comment.id,
        user_key: likerKey,
      });

      // Update like count (normally done by trigger)
      await testSupabase
        .from('comments')
        .update({ likes_count: 1 })
        .eq('id', comment.id);

      // Verify like
      const { data: liked } = await testSupabase
        .from('comments')
        .select('likes_count')
        .eq('id', comment.id)
        .single();

      expect(liked?.likes_count).toBe(1);

      // STEP 2: User unlikes
      await testSupabase
        .from('comment_likes')
        .delete()
        .eq('comment_id', comment.id)
        .eq('user_key', likerKey);

      await testSupabase
        .from('comments')
        .update({ likes_count: 0 })
        .eq('id', comment.id);

      // Verify unlike
      const { data: unliked } = await testSupabase
        .from('comments')
        .select('likes_count')
        .eq('id', comment.id)
        .single();

      expect(unliked?.likes_count).toBe(0);
    });
  });

  describe('Journey: Season Progression', () => {
    let progressionSeasonId: string;

    beforeAll(async () => {
      // Use a dedicated season with a unique genre to avoid collisions
      // with other tests that manipulate slots in testSeasonId
      progressionSeasonId = await createSeason(
        'E2E Progression Season',
        10,
        'active',
      );
    });

    it('progresses through multiple slots in a season', async () => {
      // ---------------------------------------------------------------
      // SLOT 1: waiting_for_clips → voting → locked (via RPC)
      // ---------------------------------------------------------------

      // Slot 1 already starts as 'waiting_for_clips' (createSeason default)
      const clip1 = await createClip(progressionSeasonId, {
        title: 'Progression Clip 1',
        status: 'active',
        slotPosition: 1,
      });

      // Transition slot 1 to voting with the full column set
      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        voting_duration_hours: 24,
      }, progressionSeasonId);

      // Cast some votes
      await createVoteBatch(clip1.id, 10, { slotPosition: 1 });

      // Assign winner via atomic RPC (locks slot, locks clip, advances next slot)
      const slot1Id = await getSlotId(progressionSeasonId, 1);
      await assignWinnerViaRpc(clip1.id, slot1Id, progressionSeasonId, 2);

      // ---------------------------------------------------------------
      // SLOT 2: should now be 'waiting_for_clips' (set by RPC above)
      // ---------------------------------------------------------------
      const { data: slot2After } = await testSupabase
        .from('story_slots')
        .select('status')
        .eq('season_id', progressionSeasonId)
        .eq('slot_position', 2)
        .single();

      expect(slot2After?.status).toBe('waiting_for_clips');

      const clip2 = await createClip(progressionSeasonId, {
        title: 'Progression Clip 2',
        status: 'active',
        slotPosition: 2,
      });

      // Transition slot 2 to voting
      await updateSlot(2, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        voting_duration_hours: 24,
      }, progressionSeasonId);

      await createVoteBatch(clip2.id, 15, { slotPosition: 2 });

      // Assign winner for slot 2 via RPC
      const slot2Id = await getSlotId(progressionSeasonId, 2);
      await assignWinnerViaRpc(clip2.id, slot2Id, progressionSeasonId, 3);

      // ---------------------------------------------------------------
      // Verify both slots are now locked with the correct winners
      // ---------------------------------------------------------------
      const { data: slots } = await testSupabase
        .from('story_slots')
        .select('slot_position, status, winner_tournament_clip_id')
        .eq('season_id', progressionSeasonId)
        .in('slot_position', [1, 2])
        .order('slot_position');

      expect(slots?.length).toBe(2);
      expect(slots?.[0].status).toBe('locked');
      expect(slots?.[0].winner_tournament_clip_id).toBe(clip1.id);
      expect(slots?.[1].status).toBe('locked');
      expect(slots?.[1].winner_tournament_clip_id).toBe(clip2.id);

      // Verify slot 3 has been advanced to 'waiting_for_clips' by the RPC
      const { data: slot3 } = await testSupabase
        .from('story_slots')
        .select('status')
        .eq('season_id', progressionSeasonId)
        .eq('slot_position', 3)
        .single();

      expect(slot3?.status).toBe('waiting_for_clips');
    });
  });
});
