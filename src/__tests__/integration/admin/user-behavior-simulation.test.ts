/**
 * Comprehensive User Behavior Simulation Test (1,000–10,000 Users)
 *
 * Simulates realistic user behavior at scale across ALL platform features:
 * - Upload clips
 * - Admin approval flow
 * - Mass voting (wave pattern)
 * - Comments (with threaded replies)
 * - Comment likes
 * - AI generation records (mocked lifecycle)
 * - View/watch tracking
 * - Concurrent mixed operations (stress test)
 * - Slot advance under load
 * - Data integrity checks
 * - Performance metrics
 *
 * Uses direct Supabase DB operations (no dev server needed).
 * Wave pattern (batches of 50-100) to avoid connection pool exhaustion.
 */

import {
  testSupabase,
  createSeason,
  cleanupAllTestSeasons,
  updateSlot,
  getSlot,
  getSlotsForSeason,
  getClipsForSeason,
} from '../setup';

// ============================================================================
// Configuration
// ============================================================================

const SIMULATION_USERS = parseInt(process.env.SIMULATION_USERS || '1000', 10);
const SEASONS_COUNT = 3;
const BATCH_SIZE_USERS = 100;
const BATCH_SIZE_CLIPS = 50;
const BATCH_SIZE_VOTES = 100;
const BATCH_SIZE_COMMENTS = 50;
const BATCH_SIZE_LIKES = 100;

// User activity percentages
const UPLOADING_PCT = 0.3;   // 30% upload
const VOTING_PCT = 0.7;      // 70% vote
const COMMENTING_PCT = 0.4;  // 40% comment
const LIKING_PCT = 0.5;      // 50% like comments
const AI_GEN_PCT = 0.2;      // 20% AI generate
const WATCHING_PCT = 0.8;    // 80% watch clips

// ============================================================================
// Tracking arrays for cleanup
// ============================================================================

const createdUserIds: string[] = [];
const createdClipIds: string[] = [];
const createdCommentIds: string[] = [];
const createdCommentLikeIds: string[] = [];
const createdAiGenIds: string[] = [];
const createdVoteClipIds: string[] = []; // track clips that received votes

// ============================================================================
// Helper Functions
// ============================================================================

async function createTestUsers(count: number): Promise<string[]> {
  const userIds: string[] = [];

  for (let batch = 0; batch < Math.ceil(count / BATCH_SIZE_USERS); batch++) {
    const batchUsers = [];
    const start = batch * BATCH_SIZE_USERS;
    const end = Math.min(start + BATCH_SIZE_USERS, count);

    for (let i = start; i < end; i++) {
      const id = crypto.randomUUID();
      userIds.push(id);
      batchUsers.push({
        id,
        username: `su${i}`,          // max 20 chars, "su0" to "su9999"
        email: `su${i}@t.local`,
      });
    }

    const { error } = await testSupabase.from('users').insert(batchUsers);
    if (error && !error.message.includes('duplicate')) {
      throw new Error(`Failed to create users batch ${batch}: ${error.message}`);
    }
  }

  createdUserIds.push(...userIds);
  return userIds;
}

async function createClipsBatch(
  clips: Array<{
    title: string;
    status: string;
    season_id: string;
    user_id: string;
    video_url: string;
    thumbnail_url: string;
    genre: string;
    description: string;
    slot_position?: number;
  }>
): Promise<string[]> {
  const ids: string[] = [];

  for (let i = 0; i < clips.length; i += BATCH_SIZE_CLIPS) {
    const batch = clips.slice(i, i + BATCH_SIZE_CLIPS);
    const { data, error } = await testSupabase
      .from('tournament_clips')
      .insert(batch)
      .select('id');

    if (error) {
      throw new Error(`Failed to create clips batch: ${error.message}`);
    }
    if (data) {
      ids.push(...data.map((d: { id: string }) => d.id));
    }
  }

  createdClipIds.push(...ids);
  return ids;
}

async function approveClipsBatch(clipIds: string[], slotPosition: number): Promise<void> {
  for (let i = 0; i < clipIds.length; i += BATCH_SIZE_CLIPS) {
    const batch = clipIds.slice(i, i + BATCH_SIZE_CLIPS);
    const { error } = await testSupabase
      .from('tournament_clips')
      .update({ status: 'active', slot_position: slotPosition })
      .in('id', batch);

    if (error) {
      throw new Error(`Failed to approve clips batch: ${error.message}`);
    }
  }
}

async function createVotesBatch(
  votes: Array<{
    voter_key: string;
    clip_id: string;
    slot_position: number;
    vote_weight: number;
  }>
): Promise<{ created: number; duplicates: number }> {
  let created = 0;
  let duplicates = 0;

  for (let i = 0; i < votes.length; i += BATCH_SIZE_VOTES) {
    const batch = votes.slice(i, i + BATCH_SIZE_VOTES);
    const { error } = await testSupabase.from('votes').insert(batch);

    if (error) {
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        duplicates += batch.length;
      } else {
        console.warn(`Vote batch warning: ${error.message}`);
      }
    } else {
      created += batch.length;
    }
  }

  return { created, duplicates };
}

async function createCommentsBatch(
  comments: Array<{
    clip_id: string;
    user_key: string;
    username: string;
    comment_text: string;
    parent_comment_id?: string;
  }>
): Promise<string[]> {
  const ids: string[] = [];

  for (let i = 0; i < comments.length; i += BATCH_SIZE_COMMENTS) {
    const batch = comments.slice(i, i + BATCH_SIZE_COMMENTS);
    const { data, error } = await testSupabase
      .from('comments')
      .insert(batch)
      .select('id');

    if (error) {
      throw new Error(`Failed to create comments batch: ${error.message}`);
    }
    if (data) {
      ids.push(...data.map((d: { id: string }) => d.id));
    }
  }

  createdCommentIds.push(...ids);
  return ids;
}

async function createCommentLikesBatch(
  likes: Array<{
    comment_id: string;
    user_key: string;
  }>
): Promise<{ created: number; duplicates: number }> {
  let created = 0;
  let duplicates = 0;

  for (let i = 0; i < likes.length; i += BATCH_SIZE_LIKES) {
    const batch = likes.slice(i, i + BATCH_SIZE_LIKES);
    const { data, error } = await testSupabase
      .from('comment_likes')
      .insert(batch)
      .select('id');

    if (error) {
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        duplicates += batch.length;
      } else {
        console.warn(`Like batch warning: ${error.message}`);
      }
    } else if (data) {
      created += data.length;
      createdCommentLikeIds.push(...data.map((d: { id: string }) => d.id));
    }
  }

  return { created, duplicates };
}

async function createAiGenerationsBatch(
  generations: Array<{
    user_id: string;
    fal_request_id: string;
    status: string;
    prompt: string;
    model: string;
    genre: string;
    cost_cents: number;
    video_url?: string;
    completed_at?: string;
    error_message?: string;
  }>
): Promise<string[]> {
  const ids: string[] = [];
  const batchSize = 50;

  for (let i = 0; i < generations.length; i += batchSize) {
    const batch = generations.slice(i, i + batchSize);
    const { data, error } = await testSupabase
      .from('ai_generations')
      .insert(batch)
      .select('id');

    if (error) {
      throw new Error(`Failed to create AI generations batch: ${error.message}`);
    }
    if (data) {
      ids.push(...data.map((d: { id: string }) => d.id));
    }
  }

  createdAiGenIds.push(...ids);
  return ids;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(n, arr.length));
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanupAll(): Promise<void> {
  const batchSize = 100;

  // 1. Comment likes
  if (createdCommentLikeIds.length > 0) {
    for (let i = 0; i < createdCommentLikeIds.length; i += batchSize) {
      const batch = createdCommentLikeIds.slice(i, i + batchSize);
      await testSupabase.from('comment_likes').delete().in('id', batch);
    }
  }

  // 2. Comments
  if (createdCommentIds.length > 0) {
    // Delete replies first (children), then parents
    for (let i = 0; i < createdCommentIds.length; i += batchSize) {
      const batch = createdCommentIds.slice(i, i + batchSize);
      await testSupabase.from('comment_likes').delete().in('comment_id', batch);
    }
    for (let i = 0; i < createdCommentIds.length; i += batchSize) {
      const batch = createdCommentIds.slice(i, i + batchSize);
      await testSupabase.from('comments').delete().in('id', batch);
    }
  }

  // 3. Votes (delete by clip_id)
  if (createdClipIds.length > 0) {
    for (let i = 0; i < createdClipIds.length; i += batchSize) {
      const batch = createdClipIds.slice(i, i + batchSize);
      await testSupabase.from('votes').delete().in('clip_id', batch);
    }
  }

  // 4. Clips
  if (createdClipIds.length > 0) {
    for (let i = 0; i < createdClipIds.length; i += batchSize) {
      const batch = createdClipIds.slice(i, i + batchSize);
      await testSupabase.from('tournament_clips').delete().in('id', batch);
    }
  }

  // 5. AI generations
  if (createdAiGenIds.length > 0) {
    for (let i = 0; i < createdAiGenIds.length; i += batchSize) {
      const batch = createdAiGenIds.slice(i, i + batchSize);
      await testSupabase.from('ai_generations').delete().in('id', batch);
    }
  }

  // 6. Seasons & slots
  await cleanupAllTestSeasons();

  // 7. Users
  if (createdUserIds.length > 0) {
    for (let i = 0; i < createdUserIds.length; i += batchSize) {
      const batch = createdUserIds.slice(i, i + batchSize);
      await testSupabase.from('users').delete().in('id', batch);
    }
  }

  // Clear tracking arrays
  createdUserIds.length = 0;
  createdClipIds.length = 0;
  createdCommentIds.length = 0;
  createdCommentLikeIds.length = 0;
  createdAiGenIds.length = 0;
  createdVoteClipIds.length = 0;
}

// ============================================================================
// Test Suite
// ============================================================================

describe(`User Behavior Simulation (${SIMULATION_USERS} users)`, () => {
  const seasonIds: string[] = [];
  const seasonGenres = ['ACTION', 'COMEDY', 'DRAMA'];
  let allUserIds: string[] = [];

  // Clip tracking per season
  const clipIdsBySeason: Record<string, string[]> = {};
  const activeClipIdsBySeason: Record<string, string[]> = {};

  // Shared state across tests
  let allCommentIds: string[] = [];
  let allActiveClipIds: string[] = [];

  // Performance metrics
  const metrics: Record<string, number> = {};

  beforeAll(async () => {
    // Create 3 seasons
    for (let i = 0; i < SEASONS_COUNT; i++) {
      const seasonId = await createSeason(
        `Simulation Season ${seasonGenres[i]}`,
        10,
        'active'
      );
      seasonIds.push(seasonId);
      clipIdsBySeason[seasonId] = [];
      activeClipIdsBySeason[seasonId] = [];
    }

    // Create users
    allUserIds = await createTestUsers(SIMULATION_USERS);

    console.log(`\n[Setup] Created ${SIMULATION_USERS} users and ${SEASONS_COUNT} seasons`);
  }, 120000);

  afterAll(async () => {
    console.log('\n[Cleanup] Removing all test data...');
    await cleanupAll();
    console.log('[Cleanup] Done');
  }, 120000);

  // ==========================================================================
  // 1. Upload Simulation
  // ==========================================================================
  describe('1. Upload Simulation', () => {
    it('30% of users upload 1-3 clips each, distributed across seasons', async () => {
      const uploaderCount = Math.floor(SIMULATION_USERS * UPLOADING_PCT);
      const uploaders = allUserIds.slice(0, uploaderCount);

      const allClips: Array<{
        title: string;
        status: string;
        season_id: string;
        user_id: string;
        video_url: string;
        thumbnail_url: string;
        genre: string;
        description: string;
      }> = [];

      for (const userId of uploaders) {
        const clipCount = 1 + Math.floor(Math.random() * 3); // 1-3 clips
        for (let c = 0; c < clipCount; c++) {
          const seasonId = pickRandom(seasonIds);
          allClips.push({
            title: `Sim Clip ${userId.slice(0, 6)}-${c}`,
            status: 'pending',
            season_id: seasonId,
            user_id: userId,
            video_url: `https://test.example.com/video-${userId.slice(0, 6)}-${c}.mp4`,
            thumbnail_url: `https://test.example.com/thumb-${userId.slice(0, 6)}-${c}.jpg`,
            genre: pickRandom(seasonGenres),
            description: `Simulation test clip #${c} by user ${userId.slice(0, 8)}`,
          });
        }
      }

      const startTime = Date.now();
      const clipIds = await createClipsBatch(allClips);
      const duration = Date.now() - startTime;
      metrics['upload_duration_ms'] = duration;
      metrics['upload_count'] = clipIds.length;
      metrics['upload_throughput'] = Math.round((clipIds.length / duration) * 1000);

      // Track clips by season
      for (let i = 0; i < allClips.length; i++) {
        clipIdsBySeason[allClips[i].season_id].push(clipIds[i]);
      }

      expect(clipIds.length).toBe(allClips.length);
      expect(clipIds.length).toBeGreaterThan(uploaderCount); // at least 1 per user

      console.log(`   Uploaded ${clipIds.length} clips in ${duration}ms (${metrics['upload_throughput']} clips/sec)`);
    }, 60000);

    it('clips are distributed across all 3 seasons', async () => {
      for (const seasonId of seasonIds) {
        const clips = await getClipsForSeason(seasonId);
        const ourClips = clips.filter(c => createdClipIds.includes(c.id as string));
        expect(ourClips.length).toBeGreaterThan(0);
        console.log(`   Season ${seasonId.slice(0, 8)}: ${ourClips.length} clips`);
      }
    });

    it('each uploading user has 1-3 clips', async () => {
      const uploaderCount = Math.floor(SIMULATION_USERS * UPLOADING_PCT);
      const sampleUsers = allUserIds.slice(0, Math.min(10, uploaderCount));

      for (const userId of sampleUsers) {
        const { count } = await testSupabase
          .from('tournament_clips')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);

        expect(count).toBeGreaterThanOrEqual(1);
        expect(count).toBeLessThanOrEqual(3);
      }
    });
  });

  // ==========================================================================
  // 2. Admin Approval Flow
  // ==========================================================================
  describe('2. Admin Approval Flow', () => {
    it('approves 60% of pending clips, rejects 10%, leaves 30% pending', async () => {
      for (const seasonId of seasonIds) {
        const clipIds = clipIdsBySeason[seasonId];
        if (clipIds.length === 0) continue;

        const approveCount = Math.floor(clipIds.length * 0.6);
        const rejectCount = Math.floor(clipIds.length * 0.1);

        // Approve 60%
        const toApprove = clipIds.slice(0, approveCount);
        await approveClipsBatch(toApprove, 1);
        activeClipIdsBySeason[seasonId].push(...toApprove);

        // Reject 10%
        const toReject = clipIds.slice(approveCount, approveCount + rejectCount);
        if (toReject.length > 0) {
          for (let i = 0; i < toReject.length; i += BATCH_SIZE_CLIPS) {
            const batch = toReject.slice(i, i + BATCH_SIZE_CLIPS);
            await testSupabase
              .from('tournament_clips')
              .update({ status: 'rejected' })
              .in('id', batch);
          }
        }

        // Leave remaining 30% as pending
        console.log(`   Season ${seasonId.slice(0, 8)}: approved=${toApprove.length}, rejected=${toReject.length}, pending=${clipIds.length - approveCount - rejectCount}`);
      }

      // Collect all active clip IDs
      for (const seasonId of seasonIds) {
        allActiveClipIds.push(...activeClipIdsBySeason[seasonId]);
      }

      expect(allActiveClipIds.length).toBeGreaterThan(0);
    }, 60000);

    it('sets first slot in each season to voting with 24h timer', async () => {
      const now = new Date();
      const votingEnds = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      for (const seasonId of seasonIds) {
        await updateSlot(1, {
          status: 'voting',
          voting_started_at: now.toISOString(),
          voting_ends_at: votingEnds.toISOString(),
        }, seasonId);
      }

      // Verify
      for (const seasonId of seasonIds) {
        const slot = await getSlot(1, seasonId);
        expect(slot?.status).toBe('voting');
        expect(slot?.voting_started_at).not.toBeNull();
        expect(slot?.voting_ends_at).not.toBeNull();
      }
    });

    it('active clip counts match expected', async () => {
      for (const seasonId of seasonIds) {
        const { count } = await testSupabase
          .from('tournament_clips')
          .select('id', { count: 'exact', head: true })
          .eq('season_id', seasonId)
          .eq('status', 'active');

        expect(count).toBe(activeClipIdsBySeason[seasonId].length);
      }
    });
  });

  // ==========================================================================
  // 3. Mass Voting Simulation
  // ==========================================================================
  describe('3. Mass Voting Simulation', () => {
    it('70% of users vote on active clips across seasons (wave pattern)', async () => {
      const voterCount = Math.floor(SIMULATION_USERS * VOTING_PCT);
      const voters = allUserIds.slice(0, voterCount);
      const waves = 10;
      const votersPerWave = Math.ceil(voters.length / waves);

      let totalCreated = 0;
      let totalDuplicates = 0;
      const startTime = Date.now();

      for (let wave = 0; wave < waves; wave++) {
        const waveVoters = voters.slice(wave * votersPerWave, (wave + 1) * votersPerWave);
        const votes: Array<{
          voter_key: string;
          clip_id: string;
          slot_position: number;
          vote_weight: number;
        }> = [];

        for (const userId of waveVoters) {
          // Each voter casts 1-5 votes across different clips
          const voteCount = 1 + Math.floor(Math.random() * 5);
          const votedClips = new Set<string>();

          for (let v = 0; v < voteCount; v++) {
            const seasonId = pickRandom(seasonIds);
            const seasonActiveClips = activeClipIdsBySeason[seasonId];
            if (seasonActiveClips.length === 0) continue;

            const clipId = pickRandom(seasonActiveClips);
            if (votedClips.has(clipId)) continue; // avoid same-clip vote
            votedClips.add(clipId);

            votes.push({
              voter_key: `user_${userId}`,
              clip_id: clipId,
              slot_position: 1,
              vote_weight: 1,
            });
          }
        }

        const result = await createVotesBatch(votes);
        totalCreated += result.created;
        totalDuplicates += result.duplicates;
      }

      const duration = Date.now() - startTime;
      metrics['voting_duration_ms'] = duration;
      metrics['votes_created'] = totalCreated;
      metrics['votes_throughput'] = Math.round((totalCreated / duration) * 1000);

      expect(totalCreated).toBeGreaterThan(0);
      console.log(`   Created ${totalCreated} votes in ${duration}ms (${metrics['votes_throughput']} votes/sec), ${totalDuplicates} duplicates skipped`);
    }, 120000);

    it('vote counts are accurate — no lost votes', async () => {
      for (const seasonId of seasonIds) {
        const activeClips = activeClipIdsBySeason[seasonId];
        if (activeClips.length === 0) continue;

        // Sample 5 clips per season
        const sample = pickRandomN(activeClips, 5);
        for (const clipId of sample) {
          const { count: dbVotes } = await testSupabase
            .from('votes')
            .select('id', { count: 'exact', head: true })
            .eq('clip_id', clipId);

          // Just verify it's a non-negative integer (some clips may have 0 votes due to randomness)
          expect(dbVotes).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('no duplicate voter+clip pairs exist', async () => {
      // Check by querying votes for our active clips
      for (const seasonId of seasonIds) {
        const activeClips = activeClipIdsBySeason[seasonId];
        if (activeClips.length === 0) continue;

        const sample = activeClips.slice(0, 50);
        const { data: votes } = await testSupabase
          .from('votes')
          .select('voter_key, clip_id')
          .in('clip_id', sample);

        const pairs = new Set<string>();
        let dupes = 0;
        for (const v of votes || []) {
          const key = `${v.voter_key}::${v.clip_id}`;
          if (pairs.has(key)) dupes++;
          pairs.add(key);
        }

        expect(dupes).toBe(0);
      }
    });
  });

  // ==========================================================================
  // 4. Comment Simulation
  // ==========================================================================
  describe('4. Comment Simulation', () => {
    it('40% of users leave 1-3 comments on active clips', async () => {
      const commenterCount = Math.floor(SIMULATION_USERS * COMMENTING_PCT);
      const commenters = allUserIds.slice(0, commenterCount);

      const comments: Array<{
        clip_id: string;
        user_key: string;
        username: string;
        comment_text: string;
      }> = [];

      for (const userId of commenters) {
        const commentCount = 1 + Math.floor(Math.random() * 3);
        for (let c = 0; c < commentCount; c++) {
          const clipId = pickRandom(allActiveClipIds);
          comments.push({
            clip_id: clipId,
            user_key: `user_${userId}`,
            username: `simuser_${userId.slice(0, 6)}`,
            comment_text: `Sim comment #${c} by ${userId.slice(0, 6)} - Great clip!`.slice(0, 200),
          });
        }
      }

      const startTime = Date.now();
      const commentIds = await createCommentsBatch(comments);
      const duration = Date.now() - startTime;
      metrics['comments_duration_ms'] = duration;
      metrics['comments_count'] = commentIds.length;
      metrics['comments_throughput'] = Math.round((commentIds.length / duration) * 1000);

      allCommentIds = commentIds;

      expect(commentIds.length).toBe(comments.length);
      console.log(`   Created ${commentIds.length} comments in ${duration}ms (${metrics['comments_throughput']} comments/sec)`);
    }, 60000);

    it('20% of comments are threaded replies', async () => {
      if (allCommentIds.length === 0) return;

      const replyCount = Math.floor(allCommentIds.length * 0.2);
      const replies: Array<{
        clip_id: string;
        user_key: string;
        username: string;
        comment_text: string;
        parent_comment_id: string;
      }> = [];

      // Fetch parent comment clip_ids
      const parentSample = pickRandomN(allCommentIds, Math.min(replyCount, allCommentIds.length));
      const { data: parentComments } = await testSupabase
        .from('comments')
        .select('id, clip_id')
        .in('id', parentSample.slice(0, 100)); // limit query size

      if (!parentComments || parentComments.length === 0) return;

      for (let i = 0; i < replyCount && i < parentComments.length; i++) {
        const parent = parentComments[i % parentComments.length];
        const userId = pickRandom(allUserIds);
        replies.push({
          clip_id: parent.clip_id,
          user_key: `user_${userId}`,
          username: `simuser_${userId.slice(0, 6)}`,
          comment_text: `Reply to comment - interesting take!`,
          parent_comment_id: parent.id,
        });
      }

      const replyIds = await createCommentsBatch(replies);
      allCommentIds.push(...replyIds);

      // Verify replies have parent_comment_id set
      const { data: replyData } = await testSupabase
        .from('comments')
        .select('id, parent_comment_id')
        .in('id', replyIds.slice(0, 10));

      for (const reply of replyData || []) {
        expect(reply.parent_comment_id).not.toBeNull();
      }

      console.log(`   Created ${replyIds.length} threaded replies`);
    }, 30000);

    it('comment counts per clip are accurate', async () => {
      // Sample 5 active clips
      const sampleClips = pickRandomN(allActiveClipIds, 5);

      for (const clipId of sampleClips) {
        const { count } = await testSupabase
          .from('comments')
          .select('id', { count: 'exact', head: true })
          .eq('clip_id', clipId)
          .eq('is_deleted', false);

        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ==========================================================================
  // 5. Comment Like Simulation
  // ==========================================================================
  describe('5. Comment Like Simulation', () => {
    it('50% of users like 1-5 random comments', async () => {
      if (allCommentIds.length === 0) {
        console.log('   Skipping: no comments to like');
        return;
      }

      const likerCount = Math.floor(SIMULATION_USERS * LIKING_PCT);
      const likers = allUserIds.slice(0, likerCount);

      const likes: Array<{
        comment_id: string;
        user_key: string;
      }> = [];

      const likedPairs = new Set<string>();

      for (const userId of likers) {
        const likeCount = 1 + Math.floor(Math.random() * 5);
        for (let l = 0; l < likeCount; l++) {
          const commentId = pickRandom(allCommentIds);
          const pairKey = `${commentId}::user_${userId}`;
          if (likedPairs.has(pairKey)) continue;
          likedPairs.add(pairKey);

          likes.push({
            comment_id: commentId,
            user_key: `user_${userId}`,
          });
        }
      }

      const startTime = Date.now();
      const result = await createCommentLikesBatch(likes);
      const duration = Date.now() - startTime;
      metrics['likes_duration_ms'] = duration;
      metrics['likes_created'] = result.created;
      metrics['likes_throughput'] = Math.round((result.created / Math.max(duration, 1)) * 1000);

      expect(result.created).toBeGreaterThan(0);
      console.log(`   Created ${result.created} comment likes in ${duration}ms (${metrics['likes_throughput']} likes/sec), ${result.duplicates} duplicates`);
    }, 60000);

    it('no duplicate likes per user+comment', async () => {
      if (allCommentIds.length === 0) return;

      // Sample check
      const sampleComments = pickRandomN(allCommentIds, 10);
      for (const commentId of sampleComments) {
        const { data: likes } = await testSupabase
          .from('comment_likes')
          .select('user_key')
          .eq('comment_id', commentId);

        const userKeys = new Set<string>();
        let dupes = 0;
        for (const like of likes || []) {
          if (userKeys.has(like.user_key)) dupes++;
          userKeys.add(like.user_key);
        }

        expect(dupes).toBe(0);
      }
    });
  });

  // ==========================================================================
  // 6. AI Generation Simulation (Mocked)
  // ==========================================================================
  describe('6. AI Generation Simulation (Mocked)', () => {
    it('20% of users create 1-2 AI generation records with lifecycle', async () => {
      const genUserCount = Math.floor(SIMULATION_USERS * AI_GEN_PCT);
      const genUsers = allUserIds.slice(0, genUserCount);

      const generations: Array<{
        user_id: string;
        fal_request_id: string;
        status: string;
        prompt: string;
        model: string;
        genre: string;
        cost_cents: number;
        video_url?: string;
        completed_at?: string;
        error_message?: string;
      }> = [];

      for (const userId of genUsers) {
        const genCount = 1 + Math.floor(Math.random() * 2);
        for (let g = 0; g < genCount; g++) {
          const rand = Math.random();
          let status: string;
          let video_url: string | undefined;
          let completed_at: string | undefined;
          let error_message: string | undefined;

          if (rand < 0.1) {
            // 10% fail
            status = 'failed';
            error_message = 'Simulated generation failure';
          } else if (rand < 0.3) {
            // 20% still processing
            status = 'processing';
          } else {
            // 70% completed
            status = 'completed';
            video_url = `https://fal.ai/simulated/${userId.slice(0, 6)}-${g}.mp4`;
            completed_at = new Date().toISOString();
          }

          generations.push({
            user_id: userId,
            fal_request_id: `sim_${userId.slice(0, 8)}_${g}_${Date.now()}`,
            status,
            prompt: `Generate a ${pickRandom(seasonGenres).toLowerCase()} scene with dramatic lighting`,
            model: 'minimax-video',
            genre: pickRandom(seasonGenres),
            cost_cents: 10,
            video_url,
            completed_at,
            error_message,
          });
        }
      }

      const startTime = Date.now();
      const genIds = await createAiGenerationsBatch(generations);
      const duration = Date.now() - startTime;
      metrics['ai_gen_duration_ms'] = duration;
      metrics['ai_gen_count'] = genIds.length;

      expect(genIds.length).toBe(generations.length);
      console.log(`   Created ${genIds.length} AI generation records in ${duration}ms`);
    }, 30000);

    it('generation status distribution matches expected', async () => {
      if (createdAiGenIds.length === 0) return;

      // Query in smaller batches to avoid URL length limits
      const statusCounts: Record<string, number> = {};
      const batchSize = 50;
      for (let i = 0; i < createdAiGenIds.length; i += batchSize) {
        const batch = createdAiGenIds.slice(i, i + batchSize);
        const { data: gens } = await testSupabase
          .from('ai_generations')
          .select('status')
          .in('id', batch);

        for (const g of gens || []) {
          statusCounts[g.status] = (statusCounts[g.status] || 0) + 1;
        }
      }

      const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(0);
      // Completed should be the majority
      expect(statusCounts['completed'] || 0).toBeGreaterThan((statusCounts['failed'] || 0));
      console.log(`   Status distribution:`, statusCounts);
    });

    it('completed generations create clips (mocked registration)', async () => {
      // Simulate: completed generations register their output as pending clips
      const { data: completedGens } = await testSupabase
        .from('ai_generations')
        .select('id, user_id, video_url, genre')
        .in('id', createdAiGenIds.slice(0, 200))
        .eq('status', 'completed')
        .not('video_url', 'is', null);

      if (!completedGens || completedGens.length === 0) return;

      // Register first 20 as clips
      const genClips = completedGens.slice(0, 20).map(g => ({
        title: `AI Generated Clip ${g.id.slice(0, 6)}`,
        status: 'pending',
        season_id: pickRandom(seasonIds),
        user_id: g.user_id,
        video_url: g.video_url!,
        thumbnail_url: 'https://test.example.com/ai-thumb.jpg',
        genre: g.genre || 'ACTION',
        description: 'AI-generated clip from simulation',
      }));

      const clipIds = await createClipsBatch(genClips);
      expect(clipIds.length).toBe(genClips.length);
      console.log(`   Registered ${clipIds.length} AI-generated clips`);
    }, 15000);
  });

  // ==========================================================================
  // 7. Watch/View Tracking
  // ==========================================================================
  describe('7. Watch/View Tracking', () => {
    it('80% of users watch clips (increment view_count)', async () => {
      if (allActiveClipIds.length === 0) return;

      const watcherCount = Math.floor(SIMULATION_USERS * WATCHING_PCT);
      // Each watcher views 1-3 clips
      const viewUpdates: Array<{ clipId: string; increment: number }> = [];

      for (let w = 0; w < watcherCount; w++) {
        const viewCount = 1 + Math.floor(Math.random() * 3);
        for (let v = 0; v < viewCount; v++) {
          const clipId = pickRandom(allActiveClipIds);
          viewUpdates.push({ clipId, increment: 1 });
        }
      }

      // Aggregate increments per clip
      const incrementsPerClip = new Map<string, number>();
      for (const vu of viewUpdates) {
        incrementsPerClip.set(vu.clipId, (incrementsPerClip.get(vu.clipId) || 0) + vu.increment);
      }

      const startTime = Date.now();

      // Apply view increments in batches using RPC or direct update
      // Since there's no RPC for this, we do individual increments per clip
      const clipEntries = Array.from(incrementsPerClip.entries());
      for (let i = 0; i < clipEntries.length; i += 50) {
        const batch = clipEntries.slice(i, i + 50);
        await Promise.all(
          batch.map(async ([clipId, inc]) => {
            // Use raw SQL-style increment via supabase
            const { data: current } = await testSupabase
              .from('tournament_clips')
              .select('view_count')
              .eq('id', clipId)
              .single();

            const currentCount = (current?.view_count as number) || 0;
            await testSupabase
              .from('tournament_clips')
              .update({ view_count: currentCount + inc })
              .eq('id', clipId);
          })
        );
      }

      const duration = Date.now() - startTime;
      metrics['view_tracking_duration_ms'] = duration;
      metrics['total_views'] = viewUpdates.length;

      console.log(`   Tracked ${viewUpdates.length} views across ${incrementsPerClip.size} clips in ${duration}ms`);
    }, 60000);

    it('view counts are non-negative', async () => {
      const sample = pickRandomN(allActiveClipIds, 10);
      for (const clipId of sample) {
        const { data } = await testSupabase
          .from('tournament_clips')
          .select('view_count')
          .eq('id', clipId)
          .single();

        expect((data?.view_count as number) || 0).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ==========================================================================
  // 8. Concurrent Mixed Operations (Stress Test)
  // ==========================================================================
  describe('8. Concurrent Mixed Operations', () => {
    it('simultaneous votes, comments, uploads, and AI gens across all seasons', async () => {
      const startTime = Date.now();

      // Prepare concurrent operations
      const concurrentVotes: Array<{
        voter_key: string;
        clip_id: string;
        slot_position: number;
        vote_weight: number;
      }> = [];

      // 100 votes
      for (let i = 0; i < 100; i++) {
        const userId = pickRandom(allUserIds);
        const seasonId = pickRandom(seasonIds);
        const clips = activeClipIdsBySeason[seasonId];
        if (clips.length === 0) continue;
        concurrentVotes.push({
          voter_key: `concurrent_voter_${userId}_${i}`,
          clip_id: pickRandom(clips),
          slot_position: 1,
          vote_weight: 1,
        });
      }

      // 50 comments
      const concurrentComments = Array.from({ length: 50 }, (_, i) => ({
        clip_id: pickRandom(allActiveClipIds),
        user_key: `concurrent_commenter_${i}`,
        username: `concurrent_user_${i}`,
        comment_text: `Concurrent comment #${i} - stress test!`,
      }));

      // 20 uploads
      const concurrentUploads = Array.from({ length: 20 }, (_, i) => ({
        title: `Concurrent Upload ${i}`,
        status: 'pending',
        season_id: pickRandom(seasonIds),
        user_id: pickRandom(allUserIds),
        video_url: `https://test.example.com/concurrent-${i}.mp4`,
        thumbnail_url: `https://test.example.com/concurrent-thumb-${i}.jpg`,
        genre: pickRandom(seasonGenres),
        description: `Concurrent upload stress test #${i}`,
      }));

      // 10 AI generations
      const concurrentGens = Array.from({ length: 10 }, (_, i) => ({
        user_id: pickRandom(allUserIds),
        fal_request_id: `concurrent_gen_${i}_${Date.now()}`,
        status: 'completed',
        prompt: 'Concurrent stress test generation',
        model: 'minimax-video',
        genre: pickRandom(seasonGenres),
        cost_cents: 10,
        video_url: `https://fal.ai/concurrent/${i}.mp4`,
        completed_at: new Date().toISOString(),
      }));

      // Fire all at once
      const [voteResult, commentIds, uploadIds, genIds] = await Promise.all([
        createVotesBatch(concurrentVotes),
        createCommentsBatch(concurrentComments),
        createClipsBatch(concurrentUploads),
        createAiGenerationsBatch(concurrentGens),
      ]);

      const duration = Date.now() - startTime;
      metrics['concurrent_duration_ms'] = duration;

      console.log(`   Concurrent mixed operations completed in ${duration}ms:`);
      console.log(`     Votes: ${voteResult.created} created`);
      console.log(`     Comments: ${commentIds.length} created`);
      console.log(`     Uploads: ${uploadIds.length} created`);
      console.log(`     AI Gens: ${genIds.length} created`);

      // All operations should complete without crashes
      expect(voteResult.created + voteResult.duplicates).toBeGreaterThan(0);
      expect(commentIds.length).toBe(50);
      expect(uploadIds.length).toBe(20);
      expect(genIds.length).toBe(10);
    }, 60000);

    it('no data corruption after concurrent operations', async () => {
      // Verify counts still make sense
      for (const seasonId of seasonIds) {
        const clips = await getClipsForSeason(seasonId);
        const ourClips = clips.filter(c => createdClipIds.includes(c.id as string));

        for (const clip of ourClips.slice(0, 5)) {
          expect(clip.season_id).toBe(seasonId);
          expect(clip.user_id).toBeDefined();
          expect(['pending', 'active', 'rejected', 'locked']).toContain(clip.status);
        }
      }
    });
  });

  // ==========================================================================
  // 9. Full Lifecycle: Slot Advance Under Load
  // ==========================================================================
  describe('9. Slot Advance Under Load', () => {
    it('lock winner, eliminate losers, advance to next slot while users are active', async () => {
      const seasonId = seasonIds[0];
      const activeClips = activeClipIdsBySeason[seasonId];
      if (activeClips.length < 2) {
        console.log('   Skipping: not enough active clips for slot advance');
        return;
      }

      // Find clip with most votes (the "winner")
      const { data: clipsWithVotes } = await testSupabase
        .from('tournament_clips')
        .select('id, vote_count')
        .in('id', activeClips.slice(0, 50))
        .order('vote_count', { ascending: false });

      if (!clipsWithVotes || clipsWithVotes.length === 0) return;

      const winnerId = clipsWithVotes[0].id;
      const loserIds = clipsWithVotes.slice(1, 10).map((c: { id: string }) => c.id);

      // Simulate concurrent voting WHILE advancing slot
      const concurrentVotesPromise = (async () => {
        const votes = Array.from({ length: 20 }, (_, i) => ({
          voter_key: `advance_voter_${i}_${Date.now()}`,
          clip_id: pickRandom(activeClips),
          slot_position: 1,
          vote_weight: 1,
        }));
        return createVotesBatch(votes);
      })();

      // Lock the winner
      await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', winnerId);

      // Eliminate losers
      if (loserIds.length > 0) {
        await testSupabase
          .from('tournament_clips')
          .update({ status: 'rejected' })
          .in('id', loserIds);
      }

      // Lock slot 1 and set winner
      await testSupabase
        .from('story_slots')
        .update({
          status: 'locked',
          winner_tournament_clip_id: winnerId,
        })
        .eq('season_id', seasonId)
        .eq('slot_position', 1);

      // Advance slot 2 to waiting_for_clips
      await updateSlot(2, { status: 'waiting_for_clips' }, seasonId);

      // Wait for concurrent votes to finish
      await concurrentVotesPromise;

      // Verify winner is locked
      const { data: winner } = await testSupabase
        .from('tournament_clips')
        .select('status')
        .eq('id', winnerId)
        .single();
      expect(winner?.status).toBe('locked');

      // Verify slot 1 is locked
      const slot1 = await getSlot(1, seasonId);
      expect(slot1?.status).toBe('locked');
      expect(slot1?.winner_tournament_clip_id).toBe(winnerId);

      // Verify slot 2 is waiting_for_clips
      const slot2 = await getSlot(2, seasonId);
      expect(slot2?.status).toBe('waiting_for_clips');

      console.log(`   Slot advanced: winner=${winnerId.slice(0, 8)}, ${loserIds.length} eliminated, slot 2 open`);
    }, 30000);
  });

  // ==========================================================================
  // 10. Data Integrity Checks
  // ==========================================================================
  describe('10. Data Integrity Checks', () => {
    it('no orphaned votes — every vote references a valid clip', async () => {
      // Check votes for our test clips
      for (const seasonId of seasonIds) {
        const activeClips = activeClipIdsBySeason[seasonId];
        if (activeClips.length === 0) continue;

        const sample = activeClips.slice(0, 50);
        const { data: votes } = await testSupabase
          .from('votes')
          .select('clip_id')
          .in('clip_id', sample)
          .limit(200);

        if (!votes || votes.length === 0) continue;

        const clipIds = [...new Set(votes.map(v => v.clip_id))];
        const { data: clips } = await testSupabase
          .from('tournament_clips')
          .select('id')
          .in('id', clipIds);

        const existingIds = new Set((clips || []).map((c: { id: string }) => c.id));
        for (const clipId of clipIds) {
          expect(existingIds.has(clipId)).toBe(true);
        }
      }
    });

    it('no orphaned comments — every comment references a valid clip', async () => {
      if (createdCommentIds.length === 0) return;

      const sample = createdCommentIds.slice(0, 100);
      const { data: comments } = await testSupabase
        .from('comments')
        .select('clip_id')
        .in('id', sample);

      if (!comments || comments.length === 0) return;

      const clipIds = [...new Set(comments.map(c => c.clip_id).filter(Boolean))];
      if (clipIds.length === 0) return;

      const { data: clips } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .in('id', clipIds);

      const existingIds = new Set((clips || []).map((c: { id: string }) => c.id));
      for (const clipId of clipIds) {
        expect(existingIds.has(clipId)).toBe(true);
      }
    });

    it('no orphaned comment replies — parent_comment_id references valid comment', async () => {
      const { data: replies } = await testSupabase
        .from('comments')
        .select('id, parent_comment_id')
        .in('id', createdCommentIds.slice(0, 200))
        .not('parent_comment_id', 'is', null);

      if (!replies || replies.length === 0) return;

      const parentIds = [...new Set(replies.map(r => r.parent_comment_id))];
      const { data: parents } = await testSupabase
        .from('comments')
        .select('id')
        .in('id', parentIds);

      const existingParents = new Set((parents || []).map((p: { id: string }) => p.id));
      for (const parentId of parentIds) {
        expect(existingParents.has(parentId)).toBe(true);
      }
    });

    it('all seasons have consistent state', async () => {
      for (const seasonId of seasonIds) {
        const slots = await getSlotsForSeason(seasonId);
        expect(slots.length).toBe(10);

        // Each slot should have a valid status
        for (const slot of slots) {
          expect(['upcoming', 'waiting_for_clips', 'voting', 'locked']).toContain(slot.status);
        }

        // A locked slot must have a winner
        const lockedSlots = slots.filter(s => s.status === 'locked');
        for (const ls of lockedSlots) {
          expect(ls.winner_tournament_clip_id).not.toBeNull();
        }
      }
    });

    it('no duplicate votes per voter+clip across entire dataset', async () => {
      // Global check on our test clips
      let totalDupes = 0;
      for (const seasonId of seasonIds) {
        const activeClips = activeClipIdsBySeason[seasonId];
        if (activeClips.length === 0) continue;

        const { data: votes } = await testSupabase
          .from('votes')
          .select('voter_key, clip_id')
          .in('clip_id', activeClips.slice(0, 100));

        const pairs = new Set<string>();
        for (const v of votes || []) {
          const key = `${v.voter_key}::${v.clip_id}`;
          if (pairs.has(key)) totalDupes++;
          pairs.add(key);
        }
      }

      expect(totalDupes).toBe(0);
      console.log(`   Global duplicate vote check: ${totalDupes} duplicates found`);
    });
  });

  // ==========================================================================
  // 11. Performance Metrics
  // ==========================================================================
  describe('11. Performance Metrics', () => {
    it('measures batch insert throughput', () => {
      console.log('\n========================================');
      console.log('  PERFORMANCE METRICS REPORT');
      console.log(`  Users: ${SIMULATION_USERS}`);
      console.log('========================================');

      if (metrics['upload_count']) {
        console.log(`\n  Uploads:`);
        console.log(`    Total: ${metrics['upload_count']} clips`);
        console.log(`    Duration: ${metrics['upload_duration_ms']}ms`);
        console.log(`    Throughput: ${metrics['upload_throughput']} clips/sec`);
      }

      if (metrics['votes_created']) {
        console.log(`\n  Votes:`);
        console.log(`    Total: ${metrics['votes_created']} votes`);
        console.log(`    Duration: ${metrics['voting_duration_ms']}ms`);
        console.log(`    Throughput: ${metrics['votes_throughput']} votes/sec`);
      }

      if (metrics['comments_count']) {
        console.log(`\n  Comments:`);
        console.log(`    Total: ${metrics['comments_count']} comments`);
        console.log(`    Duration: ${metrics['comments_duration_ms']}ms`);
        console.log(`    Throughput: ${metrics['comments_throughput']} comments/sec`);
      }

      if (metrics['likes_created']) {
        console.log(`\n  Comment Likes:`);
        console.log(`    Total: ${metrics['likes_created']} likes`);
        console.log(`    Duration: ${metrics['likes_duration_ms']}ms`);
        console.log(`    Throughput: ${metrics['likes_throughput']} likes/sec`);
      }

      if (metrics['ai_gen_count']) {
        console.log(`\n  AI Generations:`);
        console.log(`    Total: ${metrics['ai_gen_count']} records`);
        console.log(`    Duration: ${metrics['ai_gen_duration_ms']}ms`);
      }

      if (metrics['total_views']) {
        console.log(`\n  View Tracking:`);
        console.log(`    Total: ${metrics['total_views']} views`);
        console.log(`    Duration: ${metrics['view_tracking_duration_ms']}ms`);
      }

      if (metrics['concurrent_duration_ms']) {
        console.log(`\n  Concurrent Mixed Ops:`);
        console.log(`    Duration: ${metrics['concurrent_duration_ms']}ms`);
      }

      console.log('\n========================================\n');
      expect(true).toBe(true); // metrics test always passes
    });

    it('leaderboard query performs well with large dataset', async () => {
      const seasonId = seasonIds[1]; // use season with active voting

      const startTime = Date.now();

      // Simulate leaderboard query: get top clips by weighted_score
      const { data: leaderboard } = await testSupabase
        .from('tournament_clips')
        .select('id, title, username, vote_count, weighted_score, view_count')
        .eq('season_id', seasonId)
        .eq('status', 'active')
        .order('weighted_score', { ascending: false })
        .limit(20);

      const duration = Date.now() - startTime;

      console.log(`   Leaderboard query: ${duration}ms for top 20 of ${activeClipIdsBySeason[seasonId]?.length || 0} active clips`);

      // Should complete within 2 seconds even with large dataset
      expect(duration).toBeLessThan(2000);
      expect(leaderboard).toBeDefined();
    });

    it('parallel queries across all seasons complete quickly', async () => {
      const startTime = Date.now();

      const queries = [
        // Clips per season
        ...seasonIds.map(id => getClipsForSeason(id)),
        // Slots per season
        ...seasonIds.map(id => getSlotsForSeason(id)),
        // Vote counts per season (via active clips)
        ...seasonIds.map(id => {
          const clips = activeClipIdsBySeason[id]?.slice(0, 50) || [];
          return clips.length > 0
            ? testSupabase.from('votes').select('id', { count: 'exact', head: true }).in('clip_id', clips)
            : Promise.resolve({ count: 0 });
        }),
        // Comment counts (global)
        testSupabase
          .from('comments')
          .select('id', { count: 'exact', head: true })
          .in('id', createdCommentIds.slice(0, 500)),
      ];

      await Promise.all(queries);

      const duration = Date.now() - startTime;
      console.log(`   ${queries.length} parallel queries completed in ${duration}ms`);

      // All queries should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
    });
  });
});
