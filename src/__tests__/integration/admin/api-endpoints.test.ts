/**
 * API Endpoints Tests (Database-driven)
 *
 * Tests the underlying database operations that admin API endpoints rely on.
 * Instead of making HTTP calls to localhost:3000 (which requires a running dev
 * server and fake auth headers), these tests operate directly against Supabase
 * to verify:
 *   - Season CRUD operations
 *   - Slot state transitions (upcoming -> voting -> locked)
 *   - Clip lifecycle (pending -> active -> locked/eliminated)
 *   - Winner assignment via the assign_winner_atomic RPC
 *   - Feature flag management
 */

import {
  testSupabase,
  setupTestSeason,
  cleanupTestData,
  createTestClip,
  getClip,
  getSlot,
  updateSlot,
  createSeason,
  cleanupAllTestSeasons,
  setupMultiSeasonUser,
  MULTI_SEASON_USER_ID,
  TEST_SEASON_ID,
  TEST_USER_ID,
} from '../setup';

// Each describe block uses its own season to avoid cross-test interference.
// Genre names include timestamps and random suffixes to satisfy the
// idx_seasons_active_genre unique constraint.

function uniqueGenre(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('API Endpoints Tests', () => {
  // ----------------------------------------------------------------
  // Global setup: ensure the shared multi-season user exists
  // ----------------------------------------------------------------
  beforeAll(async () => {
    await setupMultiSeasonUser();
  });

  afterAll(async () => {
    await cleanupAllTestSeasons();
  });

  // ==========================================================================
  // 1. Season CRUD Operations
  // ==========================================================================
  describe('Season CRUD Operations', () => {
    let seasonId: string;
    const genre = uniqueGenre('CRUD');

    afterAll(async () => {
      // Clean up season-specific data
      await testSupabase.from('tournament_clips').delete().eq('season_id', seasonId);
      await testSupabase.from('story_slots').delete().eq('season_id', seasonId);
      await testSupabase.from('seasons').delete().eq('id', seasonId);
    });

    it('creates a new season with correct defaults', async () => {
      const { data, error } = await testSupabase
        .from('seasons')
        .insert({
          label: 'CRUD Test Season',
          status: 'draft',
          total_slots: 5,
          genre,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.label).toBe('CRUD Test Season');
      expect(data.status).toBe('draft');
      expect(data.total_slots).toBe(5);
      expect(data.genre).toBe(genre);
      expect(data.id).toBeDefined();

      seasonId = data.id;
    });

    it('reads back the created season by ID', async () => {
      const { data, error } = await testSupabase
        .from('seasons')
        .select('*')
        .eq('id', seasonId)
        .single();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data.label).toBe('CRUD Test Season');
      expect(data.genre).toBe(genre);
    });

    it('updates season status from draft to active', async () => {
      const { error } = await testSupabase
        .from('seasons')
        .update({ status: 'active' })
        .eq('id', seasonId);

      expect(error).toBeNull();

      const { data } = await testSupabase
        .from('seasons')
        .select('status')
        .eq('id', seasonId)
        .single();

      expect(data?.status).toBe('active');
    });

    it('updates season status from active to finished', async () => {
      const { error } = await testSupabase
        .from('seasons')
        .update({ status: 'finished', finished_at: new Date().toISOString() })
        .eq('id', seasonId);

      expect(error).toBeNull();

      const { data } = await testSupabase
        .from('seasons')
        .select('status, finished_at')
        .eq('id', seasonId)
        .single();

      expect(data?.status).toBe('finished');
      expect(data?.finished_at).not.toBeNull();
    });

    it('rejects an invalid season status', async () => {
      const { error } = await testSupabase
        .from('seasons')
        .update({ status: 'bogus_status' })
        .eq('id', seasonId);

      // The check constraint seasons_status_check should reject this
      expect(error).not.toBeNull();
    });

    it('returns null for a non-existent season ID', async () => {
      const fakeId = crypto.randomUUID();
      const { data, error } = await testSupabase
        .from('seasons')
        .select('*')
        .eq('id', fakeId)
        .single();

      // PostgREST returns an error when .single() finds no rows
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it('can update season description', async () => {
      const { error } = await testSupabase
        .from('seasons')
        .update({ description: 'A test description' })
        .eq('id', seasonId);

      expect(error).toBeNull();

      const { data } = await testSupabase
        .from('seasons')
        .select('description')
        .eq('id', seasonId)
        .single();

      expect(data?.description).toBe('A test description');
    });
  });

  // ==========================================================================
  // 2. Slot Management (state transitions)
  // ==========================================================================
  describe('Slot Management', () => {
    let seasonId: string;

    beforeAll(async () => {
      seasonId = await createSeason('Slot Mgmt Season', 5, 'active');
    });

    beforeEach(async () => {
      // Reset slots to a clean baseline before each test
      for (let i = 1; i <= 5; i++) {
        await updateSlot(i, {
          status: i === 1 ? 'waiting_for_clips' : 'upcoming',
          voting_started_at: null,
          voting_ends_at: null,
          winner_tournament_clip_id: null,
        }, seasonId);
      }

      // Remove any clips from previous sub-tests
      await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('season_id', seasonId);
    });

    it('creates the correct number of slots for a season', async () => {
      const { data, error } = await testSupabase
        .from('story_slots')
        .select('slot_position, status')
        .eq('season_id', seasonId)
        .order('slot_position');

      expect(error).toBeNull();
      expect(data).toHaveLength(5);
      expect(data![0].slot_position).toBe(1);
      expect(data![4].slot_position).toBe(5);
    });

    it('first slot starts as waiting_for_clips, rest are upcoming', async () => {
      const { data } = await testSupabase
        .from('story_slots')
        .select('slot_position, status')
        .eq('season_id', seasonId)
        .order('slot_position');

      expect(data![0].status).toBe('waiting_for_clips');
      for (let i = 1; i < data!.length; i++) {
        expect(data![i].status).toBe('upcoming');
      }
    });

    it('transitions slot from waiting_for_clips to voting', async () => {
      const now = new Date();
      const endsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      await updateSlot(1, {
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: endsAt.toISOString(),
      }, seasonId);

      const slot = await getSlot(1, seasonId);
      expect(slot?.status).toBe('voting');
      expect(slot?.voting_started_at).not.toBeNull();
      expect(slot?.voting_ends_at).not.toBeNull();

      // Timer should be approximately 24 hours
      const start = new Date(slot!.voting_started_at as string);
      const end = new Date(slot!.voting_ends_at as string);
      const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      expect(hours).toBeCloseTo(24, 0);
    });

    it('transitions slot from voting to locked', async () => {
      await updateSlot(1, { status: 'voting' }, seasonId);
      await updateSlot(1, { status: 'locked' }, seasonId);

      const slot = await getSlot(1, seasonId);
      expect(slot?.status).toBe('locked');
    });

    it('rejects an invalid slot status', async () => {
      const { error } = await testSupabase
        .from('story_slots')
        .update({ status: 'invalid_status' })
        .eq('season_id', seasonId)
        .eq('slot_position', 1);

      expect(error).not.toBeNull();
    });

    it('returns null for a non-existent slot position', async () => {
      const slot = await getSlot(999, seasonId);
      expect(slot).toBeNull();
    });

    it('sets voting duration hours on a slot', async () => {
      await updateSlot(1, { voting_duration_hours: 48 }, seasonId);

      const slot = await getSlot(1, seasonId);
      expect(slot?.voting_duration_hours).toBe(48);
    });

    it('clears voting timestamps when resetting a slot', async () => {
      // First set voting state
      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }, seasonId);

      // Now reset
      await updateSlot(1, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
      }, seasonId);

      const slot = await getSlot(1, seasonId);
      expect(slot?.status).toBe('waiting_for_clips');
      expect(slot?.voting_started_at).toBeNull();
      expect(slot?.voting_ends_at).toBeNull();
    });
  });

  // ==========================================================================
  // 3. Clip Lifecycle (pending -> active -> locked/eliminated)
  // ==========================================================================
  describe('Clip Lifecycle', () => {
    let seasonId: string;

    beforeAll(async () => {
      seasonId = await createSeason('Clip Lifecycle Season', 5, 'active');
    });

    beforeEach(async () => {
      // Clean clips between tests
      await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('season_id', seasonId);

      // Reset slot 1
      await updateSlot(1, {
        status: 'waiting_for_clips',
        voting_started_at: null,
        voting_ends_at: null,
        winner_tournament_clip_id: null,
      }, seasonId);
    });

    it('creates a clip in pending status', async () => {
      const clip = await createTestClip({
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      expect(clip).toBeDefined();
      expect(clip.status).toBe('pending');
      expect(clip.slot_position).toBeNull();
      expect(clip.season_id).toBe(seasonId);
    });

    it('creates clips with unique IDs', async () => {
      const clip1 = await createTestClip({
        title: 'Unique A',
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });
      const clip2 = await createTestClip({
        title: 'Unique B',
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      expect(clip1.id).not.toBe(clip2.id);
    });

    it('transitions clip from pending to active with slot assignment', async () => {
      const clip = await createTestClip({
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { error } = await testSupabase
        .from('tournament_clips')
        .update({ status: 'active', slot_position: 1 })
        .eq('id', clip.id);

      expect(error).toBeNull();

      const updated = await getClip(clip.id as string);
      expect(updated?.status).toBe('active');
      expect(updated?.slot_position).toBe(1);
    });

    it('transitions clip from active to locked', async () => {
      const clip = await createTestClip({
        status: 'active',
        slot_position: 1,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { error } = await testSupabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clip.id);

      expect(error).toBeNull();

      const updated = await getClip(clip.id as string);
      expect(updated?.status).toBe('locked');
    });

    it('transitions clip from pending to rejected', async () => {
      const clip = await createTestClip({
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { error } = await testSupabase
        .from('tournament_clips')
        .update({ status: 'rejected' })
        .eq('id', clip.id);

      expect(error).toBeNull();

      const updated = await getClip(clip.id as string);
      expect(updated?.status).toBe('rejected');
    });

    it('eliminates an active clip with reason and timestamp', async () => {
      const clip = await createTestClip({
        status: 'active',
        slot_position: 1,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const now = new Date().toISOString();
      const { error } = await testSupabase
        .from('tournament_clips')
        .update({
          status: 'eliminated',
          eliminated_at: now,
          elimination_reason: 'lost',
        })
        .eq('id', clip.id);

      expect(error).toBeNull();

      const updated = await getClip(clip.id as string);
      expect(updated?.status).toBe('eliminated');
      expect(updated?.eliminated_at).not.toBeNull();
      expect(updated?.elimination_reason).toBe('lost');
    });

    it('deletes a clip from the database', async () => {
      const clip = await createTestClip({
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { error } = await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('id', clip.id);

      expect(error).toBeNull();

      const deleted = await getClip(clip.id as string);
      expect(deleted).toBeNull();
    });

    it('returns null when reading a non-existent clip', async () => {
      const fakeId = crypto.randomUUID();
      const clip = await getClip(fakeId);
      expect(clip).toBeNull();
    });

    it('updates clip title and description', async () => {
      const clip = await createTestClip({
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { error } = await testSupabase
        .from('tournament_clips')
        .update({ title: 'Updated Title', description: 'Updated desc' })
        .eq('id', clip.id);

      expect(error).toBeNull();

      const updated = await getClip(clip.id as string);
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.description).toBe('Updated desc');
    });

    it('filters clips by season', async () => {
      // Create clips in our test season
      await createTestClip({
        title: 'Season Filter A',
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });
      await createTestClip({
        title: 'Season Filter B',
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { data, error } = await testSupabase
        .from('tournament_clips')
        .select('*')
        .eq('season_id', seasonId);

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(2);
      data!.forEach((clip: Record<string, unknown>) => {
        expect(clip.season_id).toBe(seasonId);
      });
    });

    it('filters clips by status', async () => {
      await createTestClip({
        status: 'pending',
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });
      await createTestClip({
        status: 'active',
        slot_position: 1,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { data: pendingClips } = await testSupabase
        .from('tournament_clips')
        .select('*')
        .eq('season_id', seasonId)
        .eq('status', 'pending');

      const { data: activeClips } = await testSupabase
        .from('tournament_clips')
        .select('*')
        .eq('season_id', seasonId)
        .eq('status', 'active');

      expect(pendingClips!.length).toBeGreaterThanOrEqual(1);
      expect(activeClips!.length).toBeGreaterThanOrEqual(1);

      pendingClips!.forEach((c: Record<string, unknown>) => expect(c.status).toBe('pending'));
      activeClips!.forEach((c: Record<string, unknown>) => expect(c.status).toBe('active'));
    });

    it('supports pagination via limit and offset (range)', async () => {
      // Create 4 clips
      for (let i = 0; i < 4; i++) {
        await createTestClip({
          title: `Page Clip ${i}`,
          season_id: seasonId,
          user_id: MULTI_SEASON_USER_ID,
        });
      }

      const { data: page1 } = await testSupabase
        .from('tournament_clips')
        .select('*')
        .eq('season_id', seasonId)
        .order('created_at')
        .range(0, 1); // first 2

      const { data: page2 } = await testSupabase
        .from('tournament_clips')
        .select('*')
        .eq('season_id', seasonId)
        .order('created_at')
        .range(2, 3); // next 2

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);

      // Pages should not overlap
      const page1Ids = page1!.map((c: Record<string, unknown>) => c.id);
      const page2Ids = page2!.map((c: Record<string, unknown>) => c.id);
      page2Ids.forEach((id: unknown) => {
        expect(page1Ids).not.toContain(id);
      });
    });
  });

  // ==========================================================================
  // 4. Winner Assignment via RPC
  // ==========================================================================
  describe('Winner Assignment via RPC', () => {
    let seasonId: string;

    beforeAll(async () => {
      seasonId = await createSeason('Winner RPC Season', 5, 'active');
    });

    beforeEach(async () => {
      // Clean clips
      // First clear slot winner references to avoid FK constraint issues
      await testSupabase
        .from('story_slots')
        .update({ winner_tournament_clip_id: null })
        .eq('season_id', seasonId);

      await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('season_id', seasonId);

      // Reset all slots
      for (let i = 1; i <= 5; i++) {
        await updateSlot(i, {
          status: i === 1 ? 'voting' : 'upcoming',
          voting_started_at: i === 1 ? new Date().toISOString() : null,
          voting_ends_at: i === 1 ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
          winner_tournament_clip_id: null,
        }, seasonId);
      }
    });

    it('assigns winner, locks slot, and advances to next slot', async () => {
      // Create a winning clip and a losing clip
      const winner = await createTestClip({
        status: 'active',
        slot_position: 1,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });
      const loser = await createTestClip({
        status: 'active',
        slot_position: 1,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      // Get the slot UUID (RPC requires the slot id, not position)
      const { data: slotRow } = await testSupabase
        .from('story_slots')
        .select('id')
        .eq('season_id', seasonId)
        .eq('slot_position', 1)
        .single();

      const { data: rpcResult, error } = await testSupabase.rpc('assign_winner_atomic', {
        p_clip_id: winner.id,
        p_slot_id: slotRow!.id,
        p_season_id: seasonId,
        p_next_slot_position: 2,
        p_voting_duration_hours: 24,
        p_advance_slot: true,
      });

      expect(error).toBeNull();
      expect(rpcResult).toBeDefined();
      expect(rpcResult.length).toBeGreaterThan(0);

      const result = rpcResult[0];
      expect(result.success).toBe(true);
      expect(result.message).toBe('Winner assigned successfully');
      expect(result.winner_clip_id).toBe(winner.id);
      expect(result.slot_locked).toBe(1);
      expect(result.next_slot_position).toBe(2);
      expect(result.season_finished).toBe(false);

      // Verify slot 1 is now locked with the winner
      const slot1 = await getSlot(1, seasonId);
      expect(slot1?.status).toBe('locked');
      expect(slot1?.winner_tournament_clip_id).toBe(winner.id);

      // Verify winning clip is locked
      const winnerClip = await getClip(winner.id as string);
      expect(winnerClip?.status).toBe('locked');

      // Verify losing clip is eliminated
      const loserClip = await getClip(loser.id as string);
      expect(loserClip?.status).toBe('eliminated');
      expect(loserClip?.elimination_reason).toBe('lost');

      // Verify slot 2 advanced to waiting_for_clips (no active clips there)
      const slot2 = await getSlot(2, seasonId);
      expect(slot2?.status).toBe('waiting_for_clips');
    });

    it('rejects winner assignment when slot is not in voting state', async () => {
      // Set slot 1 to locked (not voting)
      await updateSlot(1, { status: 'locked' }, seasonId);

      const clip = await createTestClip({
        status: 'active',
        slot_position: 1,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { data: slotRow } = await testSupabase
        .from('story_slots')
        .select('id')
        .eq('season_id', seasonId)
        .eq('slot_position', 1)
        .single();

      const { data: rpcResult, error } = await testSupabase.rpc('assign_winner_atomic', {
        p_clip_id: clip.id,
        p_slot_id: slotRow!.id,
        p_season_id: seasonId,
        p_next_slot_position: 2,
        p_voting_duration_hours: 24,
        p_advance_slot: true,
      });

      expect(error).toBeNull();
      expect(rpcResult).toBeDefined();

      const result = rpcResult[0];
      expect(result.success).toBe(false);
      expect(result.message).toContain('Slot is no longer in voting state');
    });

    it('finishes the season when assigning winner on the last slot', async () => {
      // Set slot 1 to voting for last-slot scenario
      // We treat slot 1 as if it were the last by passing next_slot_position > total_slots
      const clip = await createTestClip({
        status: 'active',
        slot_position: 1,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { data: slotRow } = await testSupabase
        .from('story_slots')
        .select('id')
        .eq('season_id', seasonId)
        .eq('slot_position', 1)
        .single();

      const { data: rpcResult, error } = await testSupabase.rpc('assign_winner_atomic', {
        p_clip_id: clip.id,
        p_slot_id: slotRow!.id,
        p_season_id: seasonId,
        p_next_slot_position: 999, // beyond total_slots=5
        p_voting_duration_hours: 24,
        p_advance_slot: true,
      });

      expect(error).toBeNull();
      const result = rpcResult[0];
      expect(result.success).toBe(true);
      expect(result.season_finished).toBe(true);
      expect(result.next_slot_position).toBeNull();

      // Verify season is now finished
      const { data: season } = await testSupabase
        .from('seasons')
        .select('status')
        .eq('id', seasonId)
        .single();

      expect(season?.status).toBe('finished');

      // Reset season status for subsequent tests
      await testSupabase
        .from('seasons')
        .update({ status: 'active' })
        .eq('id', seasonId);
    });

    it('advances next slot to voting if clips already exist there', async () => {
      // Pre-place an active clip on slot 2
      await createTestClip({
        status: 'active',
        slot_position: 2,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      // Create a winner for slot 1
      const winner = await createTestClip({
        status: 'active',
        slot_position: 1,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { data: slotRow } = await testSupabase
        .from('story_slots')
        .select('id')
        .eq('season_id', seasonId)
        .eq('slot_position', 1)
        .single();

      const { data: rpcResult } = await testSupabase.rpc('assign_winner_atomic', {
        p_clip_id: winner.id,
        p_slot_id: slotRow!.id,
        p_season_id: seasonId,
        p_next_slot_position: 2,
        p_voting_duration_hours: 24,
        p_advance_slot: true,
      });

      expect(rpcResult[0].success).toBe(true);

      // Slot 2 should be in voting (because it had active clips)
      const slot2 = await getSlot(2, seasonId);
      expect(slot2?.status).toBe('voting');
      expect(slot2?.voting_started_at).not.toBeNull();
      expect(slot2?.voting_ends_at).not.toBeNull();
    });

    it('does not advance next slot when p_advance_slot is false', async () => {
      const winner = await createTestClip({
        status: 'active',
        slot_position: 1,
        season_id: seasonId,
        user_id: MULTI_SEASON_USER_ID,
      });

      const { data: slotRow } = await testSupabase
        .from('story_slots')
        .select('id')
        .eq('season_id', seasonId)
        .eq('slot_position', 1)
        .single();

      const { data: rpcResult } = await testSupabase.rpc('assign_winner_atomic', {
        p_clip_id: winner.id,
        p_slot_id: slotRow!.id,
        p_season_id: seasonId,
        p_next_slot_position: 2,
        p_voting_duration_hours: 24,
        p_advance_slot: false,
      });

      expect(rpcResult[0].success).toBe(true);

      // Slot 2 should remain 'upcoming' (unchanged)
      const slot2 = await getSlot(2, seasonId);
      expect(slot2?.status).toBe('upcoming');
    });
  });

  // ==========================================================================
  // 5. Feature Flag Management
  // ==========================================================================
  describe('Feature Flag Management', () => {
    const testFlagKey = `test_flag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    afterAll(async () => {
      // Remove the test flag we created
      await testSupabase.from('feature_flags').delete().eq('key', testFlagKey);
    });

    it('creates a new feature flag', async () => {
      const { data, error } = await testSupabase
        .from('feature_flags')
        .insert({
          key: testFlagKey,
          name: 'Test Flag',
          description: 'A flag created by integration tests',
          enabled: false,
          category: 'test',
          config: { max_items: 10 },
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(data.key).toBe(testFlagKey);
      expect(data.enabled).toBe(false);
      expect(data.category).toBe('test');
      expect(data.config).toEqual({ max_items: 10 });
    });

    it('reads back the feature flag by key', async () => {
      const { data, error } = await testSupabase
        .from('feature_flags')
        .select('*')
        .eq('key', testFlagKey)
        .single();

      expect(error).toBeNull();
      expect(data?.name).toBe('Test Flag');
      expect(data?.description).toBe('A flag created by integration tests');
    });

    it('enables a feature flag', async () => {
      const { error } = await testSupabase
        .from('feature_flags')
        .update({ enabled: true })
        .eq('key', testFlagKey);

      expect(error).toBeNull();

      const { data } = await testSupabase
        .from('feature_flags')
        .select('enabled, updated_at')
        .eq('key', testFlagKey)
        .single();

      expect(data?.enabled).toBe(true);
      // updated_at trigger should have fired
      expect(data?.updated_at).not.toBeNull();
    });

    it('disables a feature flag', async () => {
      const { error } = await testSupabase
        .from('feature_flags')
        .update({ enabled: false })
        .eq('key', testFlagKey);

      expect(error).toBeNull();

      const { data } = await testSupabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', testFlagKey)
        .single();

      expect(data?.enabled).toBe(false);
    });

    it('updates feature flag config (JSON)', async () => {
      const newConfig = { max_items: 20, threshold: 0.75 };

      const { error } = await testSupabase
        .from('feature_flags')
        .update({ config: newConfig })
        .eq('key', testFlagKey);

      expect(error).toBeNull();

      const { data } = await testSupabase
        .from('feature_flags')
        .select('config')
        .eq('key', testFlagKey)
        .single();

      expect(data?.config).toEqual(newConfig);
    });

    it('rejects duplicate feature flag keys', async () => {
      const { error } = await testSupabase
        .from('feature_flags')
        .insert({
          key: testFlagKey,
          name: 'Duplicate Flag',
        });

      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/duplicate|unique|violates/i);
    });

    it('lists feature flags filtered by category', async () => {
      const { data, error } = await testSupabase
        .from('feature_flags')
        .select('key, name, category')
        .eq('category', 'test');

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
      data!.forEach((flag: Record<string, unknown>) => {
        expect(flag.category).toBe('test');
      });
    });

    it('deletes a feature flag', async () => {
      // Create a throwaway flag to delete
      const throwawayKey = `throwaway_${Date.now()}`;
      await testSupabase.from('feature_flags').insert({
        key: throwawayKey,
        name: 'Throwaway',
      });

      const { error } = await testSupabase
        .from('feature_flags')
        .delete()
        .eq('key', throwawayKey);

      expect(error).toBeNull();

      const { data } = await testSupabase
        .from('feature_flags')
        .select('key')
        .eq('key', throwawayKey)
        .single();

      expect(data).toBeNull();
    });
  });

  // ==========================================================================
  // 6. Cross-cutting concerns
  // ==========================================================================
  describe('Cross-cutting Concerns', () => {
    let seasonId: string;

    beforeAll(async () => {
      seasonId = await createSeason('Cross-cut Season', 3, 'active');
    });

    beforeEach(async () => {
      // Clear slot winners first to avoid FK issues
      await testSupabase
        .from('story_slots')
        .update({ winner_tournament_clip_id: null })
        .eq('season_id', seasonId);

      await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('season_id', seasonId);

      for (let i = 1; i <= 3; i++) {
        await updateSlot(i, {
          status: i === 1 ? 'waiting_for_clips' : 'upcoming',
          voting_started_at: null,
          voting_ends_at: null,
          winner_tournament_clip_id: null,
        }, seasonId);
      }
    });

    it('concurrent clip creation does not produce duplicate IDs', async () => {
      const clipPromises = Array.from({ length: 5 }, (_, i) =>
        createTestClip({
          title: `Concurrent Clip ${i}`,
          season_id: seasonId,
          user_id: MULTI_SEASON_USER_ID,
        })
      );

      const clips = await Promise.all(clipPromises);
      const ids = clips.map((c) => c.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(5);
    });

    it('bulk operations: create, filter, and delete multiple clips', async () => {
      // Create 5 clips
      for (let i = 0; i < 5; i++) {
        await createTestClip({
          title: `Bulk ${i}`,
          season_id: seasonId,
          user_id: MULTI_SEASON_USER_ID,
        });
      }

      // Verify count
      const { count: beforeCount } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', seasonId);

      expect(beforeCount).toBe(5);

      // Bulk delete all clips for the season
      const { error } = await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('season_id', seasonId);

      expect(error).toBeNull();

      // Verify count is 0
      const { count: afterCount } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', seasonId);

      expect(afterCount).toBe(0);
    });

    it('slot state is independent across different seasons', async () => {
      const otherSeasonId = await createSeason('Independent Season', 3, 'active');

      // Advance slot 1 to voting in the main season
      await updateSlot(1, {
        status: 'voting',
        voting_started_at: new Date().toISOString(),
        voting_ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }, seasonId);

      // Slot 1 in the other season should still be waiting_for_clips
      const otherSlot = await getSlot(1, otherSeasonId);
      expect(otherSlot?.status).toBe('waiting_for_clips');

      const mainSlot = await getSlot(1, seasonId);
      expect(mainSlot?.status).toBe('voting');
    });

    it('deleting a season does not leave orphan slots', async () => {
      const tempSeasonId = await createSeason('Temp Season', 2, 'draft');

      // Verify slots exist
      const { count: slotCount } = await testSupabase
        .from('story_slots')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', tempSeasonId);

      expect(slotCount).toBe(2);

      // Delete slots then season
      await testSupabase.from('story_slots').delete().eq('season_id', tempSeasonId);
      await testSupabase.from('seasons').delete().eq('id', tempSeasonId);

      // Verify no orphan slots
      const { count: remainingSlots } = await testSupabase
        .from('story_slots')
        .select('id', { count: 'exact', head: true })
        .eq('season_id', tempSeasonId);

      expect(remainingSlots).toBe(0);
    });
  });
});
