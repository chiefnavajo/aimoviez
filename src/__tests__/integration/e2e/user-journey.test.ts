/**
 * E2E User Journey Tests
 *
 * Tests complete user flows from start to finish:
 * - Upload → Approve → Vote → Win journey
 * - Credit purchase → AI generation → Submit flow
 * - Comment interaction flow
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

let testSeasonId: string;

describe('E2E: Complete User Journeys', () => {
  beforeAll(async () => {
    await setupMultiSeasonUser();
    testSeasonId = await createSeason('E2E Journey Season', 10, 'active');
  });

  afterAll(async () => {
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
    trackedResources.clips.length = 0;
    trackedResources.comments.length = 0;
    trackedResources.votes.length = 0;
    trackedResources.users.length = 0;
    trackedResources.generations.length = 0;
    await cleanupAllTestSeasons();
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
      await updateSlot(1, { status: 'voting' }, testSeasonId);

      // STEP 4: Users vote on the clip
      await createVoteBatch(clip.id, 50, { slotPosition: 1 });
      const voteCount = await getVoteCount(clip.id);
      expect(voteCount).toBe(50);

      // STEP 5: Timer expires, clip wins (admin assigns winner)
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip.id);

      await updateSlot(1, {
        status: 'locked',
        winner_tournament_clip_id: clip.id,
      }, testSeasonId);

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
      await updateSlot(2, { status: 'voting' }, testSeasonId);

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

      // Assign winner
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', winnerId);

      await updateSlot(2, {
        status: 'locked',
        winner_tournament_clip_id: winnerId,
      }, testSeasonId);

      // Verify
      const { data: slot } = await testSupabase
        .from('story_slots')
        .select('winner_tournament_clip_id')
        .eq('season_id', testSeasonId)
        .eq('slot_position', 2)
        .single();

      expect(slot?.winner_tournament_clip_id).toBe(clips[1].id);
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
    it('completes comment thread creation', async () => {
      // Create a clip to comment on
      const clip = await createClip(testSeasonId, { status: 'active', slotPosition: 3 });

      // STEP 1: User posts a comment
      const comment1 = await createComment(clip.id, {
        text: 'Great clip!',
        userKey: 'user_1',
        username: 'Alice',
      });

      // STEP 2: Another user replies
      const reply1 = await createComment(clip.id, {
        text: 'I agree!',
        userKey: 'user_2',
        username: 'Bob',
        parentId: comment1.id,
      });

      // STEP 3: Original user replies back
      const reply2 = await createComment(clip.id, {
        text: 'Thanks!',
        userKey: 'user_1',
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
      await testSupabase.from('comment_likes').insert({
        comment_id: comment.id,
        user_key: 'liker_1',
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
        .eq('user_key', 'liker_1');

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
    it('progresses through multiple slots in a season', async () => {
      // Start with slot 1
      await updateSlot(1, { status: 'waiting_for_clips' }, testSeasonId);

      // Create and approve clip for slot 1
      const clip1 = await createClip(testSeasonId, { status: 'active', slotPosition: 1 });
      await updateSlot(1, { status: 'voting' }, testSeasonId);

      // Vote and assign winner
      await createVoteBatch(clip1.id, 10, { slotPosition: 1 });
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip1.id);
      await updateSlot(1, { status: 'locked', winner_tournament_clip_id: clip1.id }, testSeasonId);

      // Progress to slot 2
      await updateSlot(2, { status: 'waiting_for_clips' }, testSeasonId);

      const clip2 = await createClip(testSeasonId, { status: 'active', slotPosition: 2 });
      await updateSlot(2, { status: 'voting' }, testSeasonId);

      await createVoteBatch(clip2.id, 15, { slotPosition: 2 });
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip2.id);
      await updateSlot(2, { status: 'locked', winner_tournament_clip_id: clip2.id }, testSeasonId);

      // Verify both slots locked
      const { data: slots } = await testSupabase
        .from('story_slots')
        .select('slot_position, status, winner_tournament_clip_id')
        .eq('season_id', testSeasonId)
        .in('slot_position', [1, 2])
        .order('slot_position');

      expect(slots?.length).toBe(2);
      expect(slots?.[0].status).toBe('locked');
      expect(slots?.[0].winner_tournament_clip_id).toBe(clip1.id);
      expect(slots?.[1].status).toBe('locked');
      expect(slots?.[1].winner_tournament_clip_id).toBe(clip2.id);
    });
  });
});
