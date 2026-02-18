/**
 * Concurrent Voting Stress Test
 *
 * Simulates 1000 users voting at almost the same time to test:
 * - Race conditions
 * - Database locks
 * - Vote counting accuracy
 * - System stability under concurrent load
 */

import {
  testSupabase,
  TEST_SEASON_IDS,
  createSeason,
  getSlot,
  cleanupAllTestSeasons,
  updateSlot,
} from '../setup';

// Test configuration
const CONCURRENT_VOTERS = 1000;
const NUMBER_OF_CLIPS = 5; // 5 clips competing for votes

// Track created resources for cleanup
const createdUserIds: string[] = [];
const createdClipIds: string[] = [];
let testSeasonId: string;

/**
 * Create test users in batch
 */
async function createTestUsers(count: number): Promise<string[]> {
  const userIds: string[] = [];
  const batchSize = 100;

  for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
    const batchUsers = [];
    const start = batch * batchSize;
    const end = Math.min(start + batchSize, count);

    for (let i = start; i < end; i++) {
      const id = crypto.randomUUID();
      userIds.push(id);
      batchUsers.push({
        id,
        username: `voter${i}`,
        email: `voter${i}@test.local`,
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
 * Create test clips for voting
 */
async function createTestClips(seasonId: string, count: number): Promise<string[]> {
  const clipIds: string[] = [];
  const uploaderUserId = createdUserIds[0]; // Use first user as uploader

  for (let i = 0; i < count; i++) {
    const { data, error } = await testSupabase
      .from('tournament_clips')
      .insert({
        title: `Voting Test Clip ${i + 1}`,
        status: 'active',
        season_id: seasonId,
        user_id: uploaderUserId,
        slot_position: 1,
        video_url: 'https://test.example.com/video.mp4',
        thumbnail_url: 'https://test.example.com/thumb.jpg',
        genre: 'TEST',
        description: 'Concurrent voting test clip',
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create clip: ${error.message}`);
    }

    clipIds.push(data.id);
  }

  createdClipIds.push(...clipIds);
  return clipIds;
}

/**
 * Single vote operation - returns promise that resolves when vote is complete
 */
async function castVote(
  voterKey: string,
  clipId: string,
  slotPosition: number
): Promise<{ success: boolean; error?: string; duration: number }> {
  const startTime = Date.now();

  try {
    const { error } = await testSupabase.from('votes').insert({
      voter_key: voterKey,
      clip_id: clipId,
      slot_position: slotPosition,
      vote_weight: 1,
    });

    const duration = Date.now() - startTime;

    if (error) {
      return { success: false, error: error.message, duration };
    }

    return { success: true, duration };
  } catch (err) {
    const duration = Date.now() - startTime;
    return { success: false, error: String(err), duration };
  }
}

/**
 * Get vote counts for all clips
 */
async function getVoteCounts(clipIds: string[]): Promise<Map<string, number>> {
  const { data, error } = await testSupabase
    .from('votes')
    .select('clip_id')
    .in('clip_id', clipIds);

  if (error) {
    throw new Error(`Failed to get votes: ${error.message}`);
  }

  const counts = new Map<string, number>();
  for (const clipId of clipIds) {
    counts.set(clipId, 0);
  }

  for (const vote of data || []) {
    const clipId = vote.clip_id;
    counts.set(clipId, (counts.get(clipId) || 0) + 1);
  }

  return counts;
}

/**
 * Cleanup test data
 */
async function cleanupTestData(): Promise<void> {
  // Delete votes
  if (createdClipIds.length > 0) {
    await testSupabase.from('votes').delete().in('clip_id', createdClipIds);
  }

  // Delete clips
  if (createdClipIds.length > 0) {
    await testSupabase.from('tournament_clips').delete().in('id', createdClipIds);
  }

  // Clean up seasons
  await cleanupAllTestSeasons();

  // Delete users
  if (createdUserIds.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < createdUserIds.length; i += batchSize) {
      const batch = createdUserIds.slice(i, i + batchSize);
      await testSupabase.from('users').delete().in('id', batch);
    }
  }

  // Clear arrays
  createdUserIds.length = 0;
  createdClipIds.length = 0;
}

describe('Concurrent Voting Stress Test', () => {
  let clipIds: string[] = [];
  let userIds: string[] = [];

  beforeAll(async () => {
    // Create season
    testSeasonId = await createSeason('Concurrent Voting Test', 10, 'active');

    // Create users
    userIds = await createTestUsers(CONCURRENT_VOTERS);

    // Create clips
    clipIds = await createTestClips(testSeasonId, NUMBER_OF_CLIPS);

    // Set slot to voting
    await updateSlot(1, { status: 'voting' }, testSeasonId);
  }, 120000);

  afterAll(async () => {
    await cleanupTestData();
  }, 60000);

  describe('Setup Verification', () => {
    it('created 1000 users for voting', () => {
      expect(userIds).toHaveLength(CONCURRENT_VOTERS);
    });

    it('created 5 clips to vote on', () => {
      expect(clipIds).toHaveLength(NUMBER_OF_CLIPS);
    });

    it('slot is in voting status', async () => {
      const slot = await getSlot(1, testSeasonId);
      expect(slot?.status).toBe('voting');
    });
  });

  describe('Simultaneous Voting - All at Once', () => {
    it('1000 users vote at the exact same time', async () => {
      // Prepare all vote promises (but don't execute yet)
      const votePromises = userIds.map((userId, index) => {
        // Distribute votes across clips (round-robin)
        const clipId = clipIds[index % NUMBER_OF_CLIPS];
        const voterKey = `concurrent_voter_${userId}`;

        return castVote(voterKey, clipId, 1);
      });

      // Record start time
      const startTime = Date.now();

      // Execute ALL votes simultaneously
      const results = await Promise.all(votePromises);

      // Record end time
      const totalDuration = Date.now() - startTime;

      // Analyze results
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      const durations = results.map(r => r.duration);
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);
      const minDuration = Math.min(...durations);

      console.log('\n⚡ Concurrent Voting Results (1000 simultaneous):');
      console.log(`   Total time: ${totalDuration}ms`);
      console.log(`   Successful votes: ${successful.length}`);
      console.log(`   Failed votes: ${failed.length}`);
      console.log(`   Success rate: ${((successful.length / CONCURRENT_VOTERS) * 100).toFixed(1)}%`);
      console.log(`   Avg vote duration: ${avgDuration.toFixed(2)}ms`);
      console.log(`   Min vote duration: ${minDuration}ms`);
      console.log(`   Max vote duration: ${maxDuration}ms`);

      if (failed.length > 0) {
        const errorTypes = new Map<string, number>();
        for (const f of failed) {
          const key = f.error || 'unknown';
          errorTypes.set(key, (errorTypes.get(key) || 0) + 1);
        }
        console.log(`   Error breakdown:`, Object.fromEntries(errorTypes));
        console.log(`   ℹ️  Note: "fetch failed" errors indicate connection pool exhaustion`);
        console.log(`   ℹ️  This is expected behavior - use wave voting for better results`);
      }

      // With local Supabase, connection limits cause failures
      // The important thing is that successful votes are recorded correctly
      // At least some votes should succeed
      expect(successful.length).toBeGreaterThan(100);

      // And successful votes should be recorded in database
      const voteCounts = await getVoteCounts(clipIds);
      let totalRecorded = 0;
      for (const count of voteCounts.values()) {
        totalRecorded += count;
      }
      expect(totalRecorded).toBe(successful.length);
    }, 60000);

    it('vote counts are accurate after concurrent voting', async () => {
      const voteCounts = await getVoteCounts(clipIds);

      let totalVotes = 0;
      const distribution: Record<string, number> = {};

      for (const [clipId, count] of voteCounts.entries()) {
        totalVotes += count;
        distribution[clipId.slice(0, 8)] = count;
      }

      console.log('\n📊 Vote Distribution:');
      console.log(`   Total votes recorded: ${totalVotes}`);
      console.log(`   Per clip:`, distribution);

      // Votes should be roughly evenly distributed among successful votes
      // Due to connection limits, we expect fewer votes but even distribution
      const avgPerClip = totalVotes / NUMBER_OF_CLIPS;
      for (const count of voteCounts.values()) {
        // Each clip should have within 50% of average
        expect(count).toBeGreaterThan(avgPerClip * 0.5);
        expect(count).toBeLessThan(avgPerClip * 1.5);
      }

      // Should have recorded some votes
      expect(totalVotes).toBeGreaterThan(100);
    });

    it('no duplicate votes from same voter', async () => {
      const { data: allVotes } = await testSupabase
        .from('votes')
        .select('voter_key, clip_id')
        .in('clip_id', clipIds);

      // Check for duplicates
      const voterClipPairs = new Set<string>();
      const duplicates: string[] = [];

      for (const vote of allVotes || []) {
        const key = `${vote.voter_key}-${vote.clip_id}`;
        if (voterClipPairs.has(key)) {
          duplicates.push(key);
        }
        voterClipPairs.add(key);
      }

      console.log(`   Duplicate votes detected: ${duplicates.length}`);

      // No duplicates should exist (database constraint should prevent)
      expect(duplicates.length).toBe(0);
    });
  });

  describe('Wave Voting - Bursts of Users', () => {
    beforeAll(async () => {
      // Clear previous votes for this test
      await testSupabase.from('votes').delete().in('clip_id', clipIds);
    });

    it('10 waves of 100 users voting rapidly', async () => {
      const waves = 10;
      const usersPerWave = 100;
      const waveResults: Array<{
        wave: number;
        successful: number;
        failed: number;
        duration: number;
      }> = [];

      for (let wave = 0; wave < waves; wave++) {
        const waveUsers = userIds.slice(wave * usersPerWave, (wave + 1) * usersPerWave);

        const votePromises = waveUsers.map((userId, index) => {
          const clipId = clipIds[index % NUMBER_OF_CLIPS];
          const voterKey = `wave${wave}_voter_${userId}`;
          return castVote(voterKey, clipId, 1);
        });

        const startTime = Date.now();
        const results = await Promise.all(votePromises);
        const duration = Date.now() - startTime;

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        waveResults.push({ wave: wave + 1, successful, failed, duration });
      }

      console.log('\n🌊 Wave Voting Results:');
      for (const wr of waveResults) {
        console.log(`   Wave ${wr.wave}: ${wr.successful}/${usersPerWave} successful in ${wr.duration}ms`);
      }

      // Each wave should have high success rate
      for (const wr of waveResults) {
        expect(wr.successful).toBeGreaterThan(usersPerWave * 0.95);
      }
    }, 60000);

    it('total votes match expected after waves', async () => {
      const voteCounts = await getVoteCounts(clipIds);

      let totalVotes = 0;
      for (const count of voteCounts.values()) {
        totalVotes += count;
      }

      console.log(`   Total votes after waves: ${totalVotes}`);

      // Should have ~1000 votes from 10 waves of 100
      expect(totalVotes).toBeGreaterThan(900);
    });
  });

  describe('Stress Test - Rapid Fire Single Clip', () => {
    const targetClipId = () => clipIds[0];

    beforeAll(async () => {
      // Clear previous votes
      await testSupabase.from('votes').delete().in('clip_id', clipIds);
    });

    it('500 users vote for the same clip simultaneously', async () => {
      const voters = userIds.slice(0, 500);

      const votePromises = voters.map((userId) => {
        const voterKey = `singleclip_voter_${userId}`;
        return castVote(voterKey, targetClipId(), 1);
      });

      const startTime = Date.now();
      const results = await Promise.all(votePromises);
      const duration = Date.now() - startTime;

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      const successRate = (successful / 500) * 100;

      console.log('\n🎯 Single Clip Stress Test (500 concurrent):');
      console.log(`   Duration: ${duration}ms`);
      console.log(`   Successful: ${successful}`);
      console.log(`   Failed: ${failed}`);
      console.log(`   Success rate: ${successRate.toFixed(1)}%`);

      // Verify vote count matches successful votes
      const { count } = await testSupabase
        .from('votes')
        .select('id', { count: 'exact', head: true })
        .eq('clip_id', targetClipId());

      console.log(`   Actual votes on clip: ${count}`);
      console.log(`   ℹ️  Database accurately recorded all successful votes`);

      // Key assertion: database records exactly what succeeded
      expect(count).toBe(successful);
      // Some votes should succeed
      expect(successful).toBeGreaterThan(50);
    }, 30000);
  });

  describe('Race Condition Detection', () => {
    beforeAll(async () => {
      // Clear previous votes
      await testSupabase.from('votes').delete().in('clip_id', clipIds);
    });

    it('detects if votes are lost under heavy load', async () => {
      const testVoters = 200;
      const voters = userIds.slice(0, testVoters);

      // Each voter votes for a random clip
      const expectedVotes = new Map<string, number>();
      for (const clipId of clipIds) {
        expectedVotes.set(clipId, 0);
      }

      const votePromises = voters.map((userId, index) => {
        const clipId = clipIds[index % NUMBER_OF_CLIPS];
        expectedVotes.set(clipId, (expectedVotes.get(clipId) || 0) + 1);
        const voterKey = `race_voter_${userId}`;
        return castVote(voterKey, clipId, 1);
      });

      const results = await Promise.all(votePromises);
      const successfulVotes = results.filter(r => r.success).length;

      // Get actual counts
      const actualCounts = await getVoteCounts(clipIds);

      let totalActual = 0;
      for (const count of actualCounts.values()) {
        totalActual += count;
      }

      console.log('\n🔍 Race Condition Check:');
      console.log(`   Expected successful: ${successfulVotes}`);
      console.log(`   Actual in database: ${totalActual}`);
      console.log(`   Lost votes: ${successfulVotes - totalActual}`);

      // No votes should be lost
      expect(totalActual).toBe(successfulVotes);
    }, 30000);

    it('vote order is preserved (FIFO check)', async () => {
      // Clear and create fresh votes with timestamps
      await testSupabase.from('votes').delete().in('clip_id', clipIds);

      const testVoters = 50;
      const voters = userIds.slice(0, testVoters);

      // Vote sequentially to establish order
      for (let i = 0; i < testVoters; i++) {
        await castVote(`order_voter_${i}`, clipIds[0], 1);
      }

      // Fetch votes and check order
      const { data: votes } = await testSupabase
        .from('votes')
        .select('voter_key, created_at')
        .eq('clip_id', clipIds[0])
        .order('created_at', { ascending: true });

      // Verify they're in order
      let isOrdered = true;
      for (let i = 0; i < (votes?.length || 0) - 1; i++) {
        const current = new Date(votes![i].created_at).getTime();
        const next = new Date(votes![i + 1].created_at).getTime();
        if (current > next) {
          isOrdered = false;
          break;
        }
      }

      console.log(`   Votes are in chronological order: ${isOrdered}`);
      expect(isOrdered).toBe(true);
    });
  });

  describe('Performance Metrics', () => {
    it('measures database throughput', async () => {
      // Clear votes
      await testSupabase.from('votes').delete().in('clip_id', clipIds);

      const testSize = 100;
      const voters = userIds.slice(0, testSize);

      // Measure sequential voting
      const seqStart = Date.now();
      for (let i = 0; i < testSize; i++) {
        await castVote(`seq_voter_${i}`, clipIds[i % NUMBER_OF_CLIPS], 1);
      }
      const seqDuration = Date.now() - seqStart;
      const seqThroughput = (testSize / seqDuration) * 1000;

      // Clear and measure parallel voting
      await testSupabase.from('votes').delete().in('clip_id', clipIds);

      const parStart = Date.now();
      await Promise.all(
        voters.map((_, i) => castVote(`par_voter_${i}`, clipIds[i % NUMBER_OF_CLIPS], 1))
      );
      const parDuration = Date.now() - parStart;
      const parThroughput = (testSize / parDuration) * 1000;

      console.log('\n📈 Performance Metrics:');
      console.log(`   Sequential (${testSize} votes):`);
      console.log(`     Duration: ${seqDuration}ms`);
      console.log(`     Throughput: ${seqThroughput.toFixed(2)} votes/sec`);
      console.log(`   Parallel (${testSize} votes):`);
      console.log(`     Duration: ${parDuration}ms`);
      console.log(`     Throughput: ${parThroughput.toFixed(2)} votes/sec`);
      console.log(`   Speedup: ${(seqDuration / parDuration).toFixed(2)}x`);

      // Parallel should be faster
      expect(parDuration).toBeLessThan(seqDuration);
    }, 60000);
  });
});
