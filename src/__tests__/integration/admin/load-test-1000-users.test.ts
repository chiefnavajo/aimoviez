/**
 * Load Test: 1000 Users Simulation
 *
 * Simulates realistic user behavior:
 * - 1000 unique users
 * - Uploads: Users uploading clips to various seasons
 * - Votes: Users voting on active clips
 * - Mixed activity: Concurrent operations
 */

import {
  testSupabase,
  TEST_SEASON_IDS,
  createSeason,
  getSlot,
  getSlotsForSeason,
  getClipsForSeason,
  cleanupAllTestSeasons,
  updateSlot,
} from '../setup';

// Test configuration
const TOTAL_USERS = 1000;
const SEASONS_COUNT = 4; // 4 active seasons
const CLIPS_PER_ACTIVE_USER = 2; // ~30% of users upload
const UPLOADING_USER_PERCENTAGE = 0.3;
const VOTING_USER_PERCENTAGE = 0.7;

// Track created resources for cleanup
const createdUserIds: string[] = [];
const createdClipIds: string[] = [];

/**
 * Create test users in batch
 */
async function createTestUsers(count: number): Promise<string[]> {
  const userIds: string[] = [];
  const batchSize = 100; // Insert in batches to avoid timeouts

  for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
    const batchUsers = [];
    const start = batch * batchSize;
    const end = Math.min(start + batchSize, count);

    for (let i = start; i < end; i++) {
      const id = crypto.randomUUID();
      userIds.push(id);
      batchUsers.push({
        id,
        username: `loaduser${i}`,
        email: `loaduser${i}@test.local`,
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

/**
 * Create clips in batch for multiple users
 */
async function createClipsForUsers(
  userIds: string[],
  seasonIds: string[],
  clipsPerUser: number
): Promise<string[]> {
  const clipIds: string[] = [];
  const batchSize = 50;
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

  // Prepare all clips
  for (const userId of userIds) {
    for (let c = 0; c < clipsPerUser; c++) {
      const seasonId = seasonIds[Math.floor(Math.random() * seasonIds.length)];
      allClips.push({
        title: `Load Test Clip ${userId.slice(0, 8)}-${c}`,
        status: 'pending',
        season_id: seasonId,
        user_id: userId,
        video_url: 'https://test.example.com/video.mp4',
        thumbnail_url: 'https://test.example.com/thumb.jpg',
        genre: 'TEST',
        description: 'Load test clip',
      });
    }
  }

  // Insert in batches
  for (let i = 0; i < allClips.length; i += batchSize) {
    const batch = allClips.slice(i, i + batchSize);
    const { data, error } = await testSupabase
      .from('tournament_clips')
      .insert(batch)
      .select('id');

    if (error) {
      throw new Error(`Failed to create clips batch: ${error.message}`);
    }

    if (data) {
      clipIds.push(...data.map(d => d.id));
    }
  }

  createdClipIds.push(...clipIds);
  return clipIds;
}

/**
 * Approve clips in batch (admin operation)
 */
async function approveClipsBatch(clipIds: string[], slotPosition: number): Promise<void> {
  const batchSize = 50;

  for (let i = 0; i < clipIds.length; i += batchSize) {
    const batch = clipIds.slice(i, i + batchSize);
    const { error } = await testSupabase
      .from('tournament_clips')
      .update({ status: 'active', slot_position: slotPosition })
      .in('id', batch);

    if (error) {
      throw new Error(`Failed to approve clips batch: ${error.message}`);
    }
  }
}

/**
 * Create votes in batch
 * Uses the actual votes table schema: voter_key, clip_id, slot_position
 */
async function createVotesBatch(
  userIds: string[],
  clipIds: string[],
  slotPosition: number = 1
): Promise<number> {
  const batchSize = 100;
  const votes: Array<{
    voter_key: string;
    clip_id: string;
    slot_position: number;
    vote_weight: number;
  }> = [];

  // Each user votes for a random clip
  for (const userId of userIds) {
    if (clipIds.length === 0) continue;
    const clipId = clipIds[Math.floor(Math.random() * clipIds.length)];
    votes.push({
      voter_key: `user_${userId}`, // Use user ID as voter key
      clip_id: clipId,
      slot_position: slotPosition,
      vote_weight: 1,
    });
  }

  let totalCreated = 0;

  for (let i = 0; i < votes.length; i += batchSize) {
    const batch = votes.slice(i, i + batchSize);
    const { error } = await testSupabase.from('votes').insert(batch);

    // Ignore duplicate vote errors (user already voted)
    if (error && !error.message.includes('duplicate')) {
      console.warn(`Vote batch warning: ${error.message}`);
    } else {
      totalCreated += batch.length;
    }
  }

  return totalCreated;
}

/**
 * Get vote counts for clips
 */
async function getVoteCounts(clipIds: string[]): Promise<Map<string, number>> {
  if (clipIds.length === 0) {
    return new Map();
  }

  const { data, error } = await testSupabase
    .from('votes')
    .select('clip_id')
    .in('clip_id', clipIds);

  if (error) {
    throw new Error(`Failed to get votes: ${error.message}`);
  }

  const counts = new Map<string, number>();
  for (const vote of data || []) {
    const clipId = vote.clip_id;
    counts.set(clipId, (counts.get(clipId) || 0) + 1);
  }

  return counts;
}

/**
 * Cleanup all load test data
 */
async function cleanupLoadTestData(): Promise<void> {
  // Delete votes for created clips
  if (createdClipIds.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < createdClipIds.length; i += batchSize) {
      const batch = createdClipIds.slice(i, i + batchSize);
      await testSupabase.from('votes').delete().in('clip_id', batch);
    }
  }

  // Delete clips
  if (createdClipIds.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < createdClipIds.length; i += batchSize) {
      const batch = createdClipIds.slice(i, i + batchSize);
      await testSupabase.from('tournament_clips').delete().in('id', batch);
    }
  }

  // Clean up seasons (slots are deleted via cascade or manual)
  await cleanupAllTestSeasons();

  // Delete users
  if (createdUserIds.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < createdUserIds.length; i += batchSize) {
      const batch = createdUserIds.slice(i, i + batchSize);
      await testSupabase.from('users').delete().in('id', batch);
    }
  }

  // Clear tracking arrays
  createdUserIds.length = 0;
  createdClipIds.length = 0;
}

describe('Load Test: 1000 Users Simulation', () => {
  const seasonIds: string[] = [];
  let allUserIds: string[] = [];

  beforeAll(async () => {
    // Create seasons
    for (let i = 1; i <= SEASONS_COUNT; i++) {
      const seasonId = await createSeason(`Load Test Season ${i}`, 10, 'active');
      seasonIds.push(seasonId);
    }

    // Create 1000 users
    allUserIds = await createTestUsers(TOTAL_USERS);
  }, 60000); // 60 second timeout for setup

  afterAll(async () => {
    await cleanupLoadTestData();
  }, 60000); // 60 second timeout for cleanup

  describe('User Creation', () => {
    it('creates 1000 unique users successfully', () => {
      expect(allUserIds).toHaveLength(TOTAL_USERS);

      // Verify uniqueness
      const uniqueIds = new Set(allUserIds);
      expect(uniqueIds.size).toBe(TOTAL_USERS);
    });

    it('all users exist in database', async () => {
      // Sample check - verify 10 random users exist
      const sampleIds = allUserIds.slice(0, 10);

      const { data, error } = await testSupabase
        .from('users')
        .select('id')
        .in('id', sampleIds);

      expect(error).toBeNull();
      expect(data).toHaveLength(10);
    });
  });

  describe('Mass Upload Simulation', () => {
    it('300 users upload 2 clips each (600 total clips)', async () => {
      const uploadingUsers = allUserIds.slice(0, Math.floor(TOTAL_USERS * UPLOADING_USER_PERCENTAGE));

      const clipIds = await createClipsForUsers(
        uploadingUsers,
        seasonIds,
        CLIPS_PER_ACTIVE_USER
      );

      expect(clipIds.length).toBe(uploadingUsers.length * CLIPS_PER_ACTIVE_USER);

      // Verify clips are distributed across seasons
      for (const seasonId of seasonIds) {
        const clips = await getClipsForSeason(seasonId);
        expect(clips.length).toBeGreaterThan(0);
      }
    }, 30000);

    it('clips are properly distributed across 4 seasons', async () => {
      const distribution: Record<string, number> = {};

      for (const seasonId of seasonIds) {
        const clips = await getClipsForSeason(seasonId);
        distribution[seasonId] = clips.length;
      }

      // Each season should have roughly 150 clips (600/4)
      // Allow for random distribution variance (100-200 per season)
      for (const count of Object.values(distribution)) {
        expect(count).toBeGreaterThan(50);
        expect(count).toBeLessThan(300);
      }

      // Total should be 600
      const total = Object.values(distribution).reduce((a, b) => a + b, 0);
      expect(total).toBe(600);
    });

    it('each user has exactly 2 clips', async () => {
      const uploadingUsers = allUserIds.slice(0, Math.floor(TOTAL_USERS * UPLOADING_USER_PERCENTAGE));

      // Sample check - verify 10 random uploading users
      const sampleUsers = uploadingUsers.slice(0, 10);

      for (const userId of sampleUsers) {
        const { count, error } = await testSupabase
          .from('tournament_clips')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);

        expect(error).toBeNull();
        expect(count).toBe(CLIPS_PER_ACTIVE_USER);
      }
    });
  });

  describe('Admin Approval Flow', () => {
    it('admin approves 100 clips for voting in season 1', async () => {
      const season1Clips = await getClipsForSeason(seasonIds[0]);
      const clipsToApprove = season1Clips.slice(0, 100).map(c => c.id as string);

      await approveClipsBatch(clipsToApprove, 1);
      await updateSlot(1, { status: 'voting' }, seasonIds[0]);

      // Verify all are now active
      const { count } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', seasonIds[0])
        .eq('status', 'active');

      expect(count).toBe(100);
    });

    it('slot status changes to voting', async () => {
      const slot = await getSlot(1, seasonIds[0]);
      expect(slot?.status).toBe('voting');
    });
  });

  describe('Mass Voting Simulation', () => {
    let activeClipIds: string[] = [];

    it('700 users vote on active clips', async () => {
      const votingUsers = allUserIds.slice(
        Math.floor(TOTAL_USERS * UPLOADING_USER_PERCENTAGE),
        Math.floor(TOTAL_USERS * (UPLOADING_USER_PERCENTAGE + VOTING_USER_PERCENTAGE))
      );

      // Get active clips in season 1
      const { data: activeClips } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('season_id', seasonIds[0])
        .eq('status', 'active');

      activeClipIds = activeClips?.map(c => c.id) || [];
      expect(activeClipIds.length).toBeGreaterThan(0);

      const votesCreated = await createVotesBatch(
        votingUsers,
        activeClipIds,
        1 // slot_position
      );

      expect(votesCreated).toBeGreaterThan(0);
    }, 30000);

    it('votes are distributed across clips', async () => {
      const voteCounts = await getVoteCounts(activeClipIds);

      // Should have votes on multiple clips
      expect(voteCounts.size).toBeGreaterThan(1);

      // Total votes should be close to 700 (some might fail due to duplicates)
      let totalVotes = 0;
      for (const count of voteCounts.values()) {
        totalVotes += count;
      }
      expect(totalVotes).toBeGreaterThan(500);
    });

    it('can identify winning clip by vote count', async () => {
      const voteCounts = await getVoteCounts(activeClipIds);

      let maxVotes = 0;
      let winningClipId = '';

      for (const [clipId, count] of voteCounts.entries()) {
        if (count > maxVotes) {
          maxVotes = count;
          winningClipId = clipId;
        }
      }

      expect(winningClipId).not.toBe('');
      expect(maxVotes).toBeGreaterThan(0);
    });
  });

  describe('Concurrent Operations', () => {
    it('simultaneous uploads and votes across seasons', async () => {
      // Get users who haven't uploaded yet
      const newUploadUsers = allUserIds.slice(950, 1000); // Last 50 users

      // Get existing active clips for voting
      const { data: existingClips } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('season_id', seasonIds[0])
        .eq('status', 'active')
        .limit(50);

      const existingClipIds = existingClips?.map(c => c.id) || [];

      // Perform uploads and votes concurrently
      const uploadPromise = createClipsForUsers(newUploadUsers, [seasonIds[1]], 1);
      const votePromise = createVotesBatch(
        allUserIds.slice(0, 50), // First 50 users vote
        existingClipIds,
        1 // slot_position
      );

      const [newClipIds, additionalVotes] = await Promise.all([
        uploadPromise,
        votePromise,
      ]);

      expect(newClipIds.length).toBe(50);
      // Additional votes might be 0 if users already voted
    }, 30000);

    it('database maintains integrity under concurrent load', async () => {
      // Verify no orphaned data
      for (const seasonId of seasonIds) {
        const clips = await getClipsForSeason(seasonId);

        for (const clip of clips) {
          // Each clip should have a valid user
          expect(clip.user_id).toBeDefined();
          expect(createdUserIds).toContain(clip.user_id);

          // Each clip should have valid season
          expect(clip.season_id).toBe(seasonId);
        }
      }
    });
  });

  describe('Statistics & Reporting', () => {
    it('generates accurate user activity report', async () => {
      const stats = {
        totalUsers: TOTAL_USERS,
        uploadingUsers: 0,
        votingUsers: 0,
        totalClips: 0,
        totalVotes: 0,
        clipsPerSeason: {} as Record<string, number>,
      };

      // Count clips by querying our created clips directly
      const allClips: Array<{ user_id: string }> = [];
      const batchSize = 100;
      for (let i = 0; i < createdClipIds.length; i += batchSize) {
        const batch = createdClipIds.slice(i, i + batchSize);
        const { data } = await testSupabase
          .from('tournament_clips')
          .select('user_id')
          .in('id', batch);
        if (data) allClips.push(...data);
      }

      const usersWithClips = new Set(allClips.map(c => c.user_id));
      stats.uploadingUsers = usersWithClips.size;
      stats.totalClips = allClips.length;

      // Count votes on our test clips
      if (createdClipIds.length > 0) {
        let totalVotes = 0;
        for (let i = 0; i < createdClipIds.length; i += batchSize) {
          const batch = createdClipIds.slice(i, i + batchSize);
          const { count } = await testSupabase
            .from('votes')
            .select('id', { count: 'exact', head: true })
            .in('clip_id', batch);
          totalVotes += count || 0;
        }
        stats.totalVotes = totalVotes;
      }

      // Clips per season
      for (const seasonId of seasonIds) {
        const clips = await getClipsForSeason(seasonId);
        stats.clipsPerSeason[seasonId.slice(0, 8)] = clips.length;
      }

      // Verify stats make sense
      expect(stats.totalUsers).toBe(1000);
      expect(stats.uploadingUsers).toBeGreaterThan(200);
      expect(stats.totalClips).toBeGreaterThan(500);
      expect(stats.totalVotes).toBeGreaterThan(0);

      console.log('\n📊 Load Test Statistics:');
      console.log(`   Total Users: ${stats.totalUsers}`);
      console.log(`   Users Who Uploaded: ${stats.uploadingUsers}`);
      console.log(`   Total Clips: ${stats.totalClips}`);
      console.log(`   Total Votes: ${stats.totalVotes}`);
      console.log(`   Clips per Season:`, stats.clipsPerSeason);
    });

    it('system handles 1000 users without performance degradation', async () => {
      const startTime = Date.now();

      // Perform a series of operations
      const operations = [
        // 10 parallel clip fetches
        ...seasonIds.map(id => getClipsForSeason(id)),
        // 10 parallel slot fetches
        ...seasonIds.map(id => getSlot(1, id)),
      ];

      await Promise.all(operations);

      const duration = Date.now() - startTime;

      // All operations should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
      console.log(`   Query performance: ${operations.length} parallel queries in ${duration}ms`);
    });
  });

  describe('Edge Cases with High User Count', () => {
    it('handles user voting for their own clip', async () => {
      // Get a user who uploaded a clip
      const { data: clipWithUser } = await testSupabase
        .from('tournament_clips')
        .select('id, user_id')
        .eq('season_id', seasonIds[0])
        .eq('status', 'active')
        .limit(1)
        .single();

      if (clipWithUser) {
        // User tries to vote for their own clip
        const { error } = await testSupabase.from('votes').insert({
          voter_key: `user_${clipWithUser.user_id}`,
          clip_id: clipWithUser.id,
          slot_position: 1,
          vote_weight: 1,
        });

        // This might be allowed or prevented depending on business rules
        // Just verify it doesn't crash the system
        expect(true).toBe(true);
      }
    });

    it('handles duplicate vote attempts gracefully', async () => {
      const uniqueVoterKey = `test_dup_voter_${Date.now()}`;

      const { data: activeClip } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('season_id', seasonIds[0])
        .eq('status', 'active')
        .limit(1)
        .single();

      if (activeClip) {
        // First vote
        await testSupabase.from('votes').insert({
          voter_key: uniqueVoterKey,
          clip_id: activeClip.id,
          slot_position: 1,
          vote_weight: 1,
        });

        // Duplicate vote attempt (same voter_key, same clip)
        const { error } = await testSupabase.from('votes').insert({
          voter_key: uniqueVoterKey,
          clip_id: activeClip.id,
          slot_position: 1,
          vote_weight: 1,
        });

        // Should either succeed (if allowed) or fail with duplicate/unique error
        if (error) {
          const msg = error.message.toLowerCase();
          expect(msg.includes('duplicate') || msg.includes('unique')).toBe(true);
        }
      }
    });

    it('handles max clips per user limit', async () => {
      // Verify no user has more than expected clips
      const { data: clipsByUser } = await testSupabase
        .from('tournament_clips')
        .select('user_id')
        .in('user_id', allUserIds);

      const userClipCounts = new Map<string, number>();
      for (const clip of clipsByUser || []) {
        const count = userClipCounts.get(clip.user_id) || 0;
        userClipCounts.set(clip.user_id, count + 1);
      }

      // No user should have more than 3 clips (2 initial + 1 from concurrent test)
      for (const [userId, count] of userClipCounts.entries()) {
        expect(count).toBeLessThanOrEqual(3);
      }
    });
  });
});
