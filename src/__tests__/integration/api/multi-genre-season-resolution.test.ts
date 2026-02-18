/**
 * Integration Test: Multi-Genre Season Resolution
 *
 * Tests the genre-aware season resolution pattern used across all 18 API routes.
 * Verifies that when multiple active seasons exist (one per genre), the correct
 * season is resolved based on the genre parameter.
 *
 * Requires: local Supabase running (`supabase start`)
 */

import {
  testSupabase,
  setupMultiSeasonUser,
  MULTI_SEASON_USER_ID,
} from '../setup';

// Test-only genre codes (won't collide with real genres)
const GENRE_ACTION = 'test_mg_action';
const GENRE_COMEDY = 'test_mg_comedy';
const GENRE_HORROR = 'test_mg_horror';
const GENRE_UNUSED = 'test_mg_unused';

// Fixed test season IDs
const SEASON_ACTION_ID = 'aa001111-aa00-aa00-aa00-aa00aa00aa00';
const SEASON_COMEDY_ID = 'bb002222-bb00-bb00-bb00-bb00bb00bb00';
const SEASON_HORROR_ID = 'cc003333-cc00-cc00-cc00-cc00cc00cc00';

// ============================================================================
// Replicate the common season resolution pattern used across all routes
// ============================================================================

/**
 * Core pattern: resolve active season with optional genre filter.
 * This mirrors the exact query pattern used in all 18 fixed routes.
 */
async function resolveActiveSeason(genreParam?: string | null) {
  let seasonQuery = testSupabase
    .from('seasons')
    .select('id, genre, label, total_slots')
    .eq('status', 'active');

  if (genreParam) {
    seasonQuery = seasonQuery.eq('genre', genreParam);
  }

  const { data: season } = await seasonQuery
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return season;
}

/**
 * Pattern for routes that read genre from request body (POST routes).
 * Used by: ai/generate, ai/register, admin/reset-season, admin/update-slot-status
 */
async function resolveSeasonFromBody(body: { genre?: string; season_id?: string }) {
  if (body.season_id) {
    const { data } = await testSupabase
      .from('seasons')
      .select('id, genre, label')
      .eq('id', body.season_id)
      .maybeSingle();
    return data;
  }

  const genreParam = body.genre?.toLowerCase();
  return resolveActiveSeason(genreParam);
}

/**
 * Pattern for routes that resolve season then find slots (leaderboard routes).
 * Used by: leaderboard/live, leaderboard/clips
 */
async function resolveSlotForGenre(genreParam?: string | null) {
  let resolvedSeasonId: string | null = null;

  if (genreParam) {
    const { data: genreSeason } = await testSupabase
      .from('seasons')
      .select('id')
      .eq('status', 'active')
      .eq('genre', genreParam)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    resolvedSeasonId = genreSeason?.id || null;
  }

  let slotQuery = testSupabase
    .from('story_slots')
    .select('slot_position, season_id')
    .eq('status', 'voting');

  if (resolvedSeasonId) {
    slotQuery = slotQuery.eq('season_id', resolvedSeasonId);
  }

  const { data: slot } = await slotQuery
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return slot;
}

/**
 * Pattern for clip/[id] route — uses clip's own season_id directly.
 */
async function resolveSlotFromClip(clip: { slot_position: number; season_id: string }) {
  const slotQuery = testSupabase
    .from('story_slots')
    .select('id, slot_position, status, season_id')
    .eq('slot_position', clip.slot_position);

  if (clip.season_id) {
    slotQuery.eq('season_id', clip.season_id);
  }

  const { data: slot } = await slotQuery.maybeSingle();
  return slot;
}

// ============================================================================
// HELPERS
// ============================================================================

async function createSeasonWithGenre(
  seasonId: string,
  genre: string,
  label: string,
  totalSlots: number = 5,
): Promise<void> {
  const { error: seasonError } = await testSupabase.from('seasons').insert({
    id: seasonId,
    label,
    status: 'active',
    total_slots: totalSlots,
    genre,
  });
  if (seasonError) throw new Error(`Failed to create season: ${seasonError.message}`);

  const slots = Array.from({ length: totalSlots }, (_, i) => ({
    season_id: seasonId,
    slot_position: i + 1,
    status: i === 0 ? 'waiting_for_clips' : 'upcoming',
  }));
  const { error: slotsError } = await testSupabase.from('story_slots').insert(slots);
  if (slotsError) throw new Error(`Failed to create slots: ${slotsError.message}`);
}

async function setSlotStatus(
  seasonId: string,
  slotPosition: number,
  status: string,
): Promise<void> {
  const updates: Record<string, unknown> = { status };
  if (status === 'voting') {
    updates.voting_started_at = new Date().toISOString();
    updates.voting_ends_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  await testSupabase
    .from('story_slots')
    .update(updates)
    .eq('season_id', seasonId)
    .eq('slot_position', slotPosition);
}

async function createClipInSeason(
  seasonId: string,
  slotPosition: number,
  genre: string,
  title: string = 'Test Clip',
): Promise<string> {
  const { data, error } = await testSupabase
    .from('tournament_clips')
    .insert({
      title,
      status: 'active',
      season_id: seasonId,
      user_id: MULTI_SEASON_USER_ID,
      video_url: 'https://test.example.com/video.mp4',
      thumbnail_url: 'https://test.example.com/thumb.jpg',
      slot_position: slotPosition,
      genre,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Failed to create clip: ${error.message}`);
  return data.id;
}

async function cleanupSeason(seasonId: string): Promise<void> {
  await testSupabase.from('votes').delete().eq('season_id', seasonId);
  await testSupabase.from('tournament_clips').delete().eq('season_id', seasonId);
  await testSupabase.from('story_slots').delete().eq('season_id', seasonId);
  await testSupabase.from('seasons').delete().eq('id', seasonId);
}

// ============================================================================
// TESTS
// ============================================================================

describe('Multi-Genre Season Resolution', () => {
  beforeAll(async () => {
    await setupMultiSeasonUser();
    // Create 3 active seasons with different genres
    await createSeasonWithGenre(SEASON_ACTION_ID, GENRE_ACTION, 'Action Season', 5);
    await createSeasonWithGenre(SEASON_COMEDY_ID, GENRE_COMEDY, 'Comedy Season', 5);
    await createSeasonWithGenre(SEASON_HORROR_ID, GENRE_HORROR, 'Horror Season', 5);
  });

  afterAll(async () => {
    await cleanupSeason(SEASON_ACTION_ID);
    await cleanupSeason(SEASON_COMEDY_ID);
    await cleanupSeason(SEASON_HORROR_ID);
  });

  // ------------------------------------------------------------------
  // 1. CORE SEASON RESOLUTION (GET routes with ?genre=)
  // Routes: clip/suggest-prompt, co-director/brief, co-director/vote/status,
  //         leaderboard/creators
  // ------------------------------------------------------------------
  describe('Core pattern: resolveActiveSeason(genre)', () => {
    it('returns Action season when genre=action', async () => {
      const season = await resolveActiveSeason(GENRE_ACTION);
      expect(season).not.toBeNull();
      expect(season!.id).toBe(SEASON_ACTION_ID);
      expect(season!.genre).toBe(GENRE_ACTION);
    });

    it('returns Comedy season when genre=comedy', async () => {
      const season = await resolveActiveSeason(GENRE_COMEDY);
      expect(season).not.toBeNull();
      expect(season!.id).toBe(SEASON_COMEDY_ID);
      expect(season!.genre).toBe(GENRE_COMEDY);
    });

    it('returns Horror season when genre=horror', async () => {
      const season = await resolveActiveSeason(GENRE_HORROR);
      expect(season).not.toBeNull();
      expect(season!.id).toBe(SEASON_HORROR_ID);
      expect(season!.genre).toBe(GENRE_HORROR);
    });

    it('returns null for genre with no active season', async () => {
      const season = await resolveActiveSeason(GENRE_UNUSED);
      expect(season).toBeNull();
    });

    it('returns a season (deterministically) when no genre filter', async () => {
      const season = await resolveActiveSeason(null);
      // Should return SOME season (the oldest created one) — not error
      expect(season).not.toBeNull();
      expect(season!.id).toBeDefined();
    });

    it('is deterministic: same result on repeated calls without genre', async () => {
      const first = await resolveActiveSeason(null);
      const second = await resolveActiveSeason(null);
      expect(first!.id).toBe(second!.id);
    });

    it('genres are isolated: Action never returns Comedy', async () => {
      const action = await resolveActiveSeason(GENRE_ACTION);
      const comedy = await resolveActiveSeason(GENRE_COMEDY);
      expect(action!.id).not.toBe(comedy!.id);
      expect(action!.genre).toBe(GENRE_ACTION);
      expect(comedy!.genre).toBe(GENRE_COMEDY);
    });
  });

  // ------------------------------------------------------------------
  // 2. BODY-BASED RESOLUTION (POST routes)
  // Routes: ai/generate, ai/register, admin/update-slot-status,
  //         admin/reset-season, admin/slots/reorganize
  // ------------------------------------------------------------------
  describe('Body pattern: resolveSeasonFromBody({ genre })', () => {
    it('resolves by genre from body', async () => {
      const season = await resolveSeasonFromBody({ genre: GENRE_COMEDY });
      expect(season).not.toBeNull();
      expect(season!.id).toBe(SEASON_COMEDY_ID);
    });

    it('resolves by season_id (overrides genre)', async () => {
      const season = await resolveSeasonFromBody({
        season_id: SEASON_HORROR_ID,
        genre: GENRE_ACTION, // should be ignored
      });
      expect(season).not.toBeNull();
      expect(season!.id).toBe(SEASON_HORROR_ID);
    });

    it('returns a season when neither genre nor season_id provided', async () => {
      const season = await resolveSeasonFromBody({});
      expect(season).not.toBeNull();
    });

    it('returns null for non-existent season_id', async () => {
      const season = await resolveSeasonFromBody({
        season_id: '00000000-0000-0000-0000-000000000000',
      });
      expect(season).toBeNull();
    });

    it('is case-insensitive for genre', async () => {
      const season = await resolveSeasonFromBody({ genre: GENRE_ACTION.toUpperCase() });
      // Our helper lowercases, matching the route behavior
      expect(season).not.toBeNull();
      expect(season!.id).toBe(SEASON_ACTION_ID);
    });
  });

  // ------------------------------------------------------------------
  // 3. SLOT RESOLUTION (leaderboard routes)
  // Routes: leaderboard/live, leaderboard/clips
  // ------------------------------------------------------------------
  describe('Slot pattern: resolveSlotForGenre(genre)', () => {
    beforeAll(async () => {
      // Set Action slot 1 to voting
      await setSlotStatus(SEASON_ACTION_ID, 1, 'voting');
      // Set Comedy slot 1 to voting
      await setSlotStatus(SEASON_COMEDY_ID, 1, 'voting');
      // Horror stays at waiting_for_clips (no voting)
    });

    afterAll(async () => {
      // Reset slots
      await setSlotStatus(SEASON_ACTION_ID, 1, 'waiting_for_clips');
      await setSlotStatus(SEASON_COMEDY_ID, 1, 'waiting_for_clips');
    });

    it('finds Action voting slot when genre=action', async () => {
      const slot = await resolveSlotForGenre(GENRE_ACTION);
      expect(slot).not.toBeNull();
      expect(slot!.season_id).toBe(SEASON_ACTION_ID);
      expect(slot!.slot_position).toBe(1);
    });

    it('finds Comedy voting slot when genre=comedy', async () => {
      const slot = await resolveSlotForGenre(GENRE_COMEDY);
      expect(slot).not.toBeNull();
      expect(slot!.season_id).toBe(SEASON_COMEDY_ID);
    });

    it('returns null when genre has no voting slot', async () => {
      const slot = await resolveSlotForGenre(GENRE_HORROR);
      expect(slot).toBeNull();
    });

    it('returns a slot when no genre (picks any voting slot)', async () => {
      const slot = await resolveSlotForGenre(null);
      expect(slot).not.toBeNull();
      // Should be one of our voting slots
      expect([SEASON_ACTION_ID, SEASON_COMEDY_ID]).toContain(slot!.season_id);
    });

    it('slots are isolated: Action slot != Comedy slot', async () => {
      const action = await resolveSlotForGenre(GENRE_ACTION);
      const comedy = await resolveSlotForGenre(GENRE_COMEDY);
      expect(action!.season_id).not.toBe(comedy!.season_id);
    });
  });

  // ------------------------------------------------------------------
  // 4. CLIP-BASED RESOLUTION (clip/[id] route)
  // Uses clip.season_id directly — no season query needed
  // ------------------------------------------------------------------
  describe('Clip pattern: resolveSlotFromClip(clip)', () => {
    let actionClipId: string;
    let comedyClipId: string;

    beforeAll(async () => {
      // Create clips in different seasons at same slot_position
      actionClipId = await createClipInSeason(SEASON_ACTION_ID, 1, GENRE_ACTION, 'Action Clip');
      comedyClipId = await createClipInSeason(SEASON_COMEDY_ID, 1, GENRE_COMEDY, 'Comedy Clip');
    });

    afterAll(async () => {
      await testSupabase.from('tournament_clips').delete().eq('id', actionClipId);
      await testSupabase.from('tournament_clips').delete().eq('id', comedyClipId);
    });

    it('resolves Action slot from Action clip (even though both at position 1)', async () => {
      const slot = await resolveSlotFromClip({
        slot_position: 1,
        season_id: SEASON_ACTION_ID,
      });
      expect(slot).not.toBeNull();
      expect(slot!.season_id).toBe(SEASON_ACTION_ID);
    });

    it('resolves Comedy slot from Comedy clip (same position, different season)', async () => {
      const slot = await resolveSlotFromClip({
        slot_position: 1,
        season_id: SEASON_COMEDY_ID,
      });
      expect(slot).not.toBeNull();
      expect(slot!.season_id).toBe(SEASON_COMEDY_ID);
    });

    it('clips at same slot_position but different seasons get different slots', async () => {
      const actionSlot = await resolveSlotFromClip({
        slot_position: 1,
        season_id: SEASON_ACTION_ID,
      });
      const comedySlot = await resolveSlotFromClip({
        slot_position: 1,
        season_id: SEASON_COMEDY_ID,
      });
      expect(actionSlot!.id).not.toBe(comedySlot!.id);
    });
  });

  // ------------------------------------------------------------------
  // 5. AI GENERATION PATTERN (ai/complete)
  // Gets genre from generation record, then resolves season
  // ------------------------------------------------------------------
  describe('Generation pattern: genre from DB record', () => {
    it('resolves correct season from generation genre field', async () => {
      // Simulate: generation has genre = GENRE_HORROR
      const genGenre = GENRE_HORROR;

      let seasonQuery = testSupabase
        .from('seasons')
        .select('id')
        .eq('status', 'active');
      if (genGenre) {
        seasonQuery = seasonQuery.eq('genre', genGenre.toLowerCase());
      }
      const { data: seasons } = await seasonQuery
        .order('created_at', { ascending: true })
        .limit(1);

      expect(seasons).not.toBeNull();
      expect(seasons!.length).toBe(1);
      expect(seasons![0].id).toBe(SEASON_HORROR_ID);
    });

    it('finds any season when generation has no genre', async () => {
      const genGenre: string | null = null;

      let seasonQuery = testSupabase
        .from('seasons')
        .select('id')
        .eq('status', 'active');
      if (genGenre) {
        seasonQuery = seasonQuery.eq('genre', genGenre.toLowerCase());
      }
      const { data: seasons } = await seasonQuery
        .order('created_at', { ascending: true })
        .limit(1);

      expect(seasons).not.toBeNull();
      expect(seasons!.length).toBe(1);
      // Returns the oldest active season
    });
  });

  // ------------------------------------------------------------------
  // 6. ADMIN ROUTES: season_id takes priority over genre
  // Routes: admin/stats, admin/slots, admin/clips
  // ------------------------------------------------------------------
  describe('Admin pattern: season_id priority over genre', () => {
    it('uses season_id directly when provided', async () => {
      const { data: season } = await testSupabase
        .from('seasons')
        .select('id, genre')
        .eq('id', SEASON_COMEDY_ID)
        .maybeSingle();

      expect(season).not.toBeNull();
      expect(season!.genre).toBe(GENRE_COMEDY);
    });

    it('falls back to genre-filtered active season when no season_id', async () => {
      let seasonQuery = testSupabase
        .from('seasons')
        .select('id, status, total_slots')
        .eq('status', 'active');
      seasonQuery = seasonQuery.eq('genre', GENRE_HORROR);
      const { data } = await seasonQuery
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      expect(data).not.toBeNull();
      expect(data!.id).toBe(SEASON_HORROR_ID);
    });

    it('falls back deterministically when neither season_id nor genre', async () => {
      const { data: first } = await testSupabase
        .from('seasons')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: second } = await testSupabase
        .from('seasons')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      expect(first).not.toBeNull();
      expect(first!.id).toBe(second!.id);
    });
  });

  // ------------------------------------------------------------------
  // 7. EDGE CASES
  // ------------------------------------------------------------------
  describe('Edge cases', () => {
    it('finished season is not returned even with matching genre', async () => {
      const finishedId = crypto.randomUUID();
      await testSupabase.from('seasons').insert({
        id: finishedId,
        label: 'Finished Season',
        status: 'finished',
        total_slots: 5,
        genre: 'test_mg_finished',
      });

      try {
        const season = await resolveActiveSeason('test_mg_finished');
        expect(season).toBeNull();
      } finally {
        await testSupabase.from('seasons').delete().eq('id', finishedId);
      }
    });

    it('draft season is not returned even with matching genre', async () => {
      const draftId = crypto.randomUUID();
      await testSupabase.from('seasons').insert({
        id: draftId,
        label: 'Draft Season',
        status: 'draft',
        total_slots: 5,
        genre: 'test_mg_draft',
      });

      try {
        const season = await resolveActiveSeason('test_mg_draft');
        expect(season).toBeNull();
      } finally {
        await testSupabase.from('seasons').delete().eq('id', draftId);
      }
    });

    it('empty string genre is treated as no filter', async () => {
      // Empty string is falsy, so no genre filter applied
      const season = await resolveActiveSeason('');
      expect(season).not.toBeNull();
    });

    it('handles concurrent resolution of all genres', async () => {
      const [action, comedy, horror] = await Promise.all([
        resolveActiveSeason(GENRE_ACTION),
        resolveActiveSeason(GENRE_COMEDY),
        resolveActiveSeason(GENRE_HORROR),
      ]);

      expect(action!.id).toBe(SEASON_ACTION_ID);
      expect(comedy!.id).toBe(SEASON_COMEDY_ID);
      expect(horror!.id).toBe(SEASON_HORROR_ID);

      // All different
      const ids = new Set([action!.id, comedy!.id, horror!.id]);
      expect(ids.size).toBe(3);
    });

    it('handles rapid sequential resolution correctly', async () => {
      const results: string[] = [];
      for (let i = 0; i < 5; i++) {
        const genres = [GENRE_ACTION, GENRE_COMEDY, GENRE_HORROR];
        const genre = genres[i % genres.length];
        const season = await resolveActiveSeason(genre);
        results.push(season!.id);
      }

      // Pattern: action, comedy, horror, action, comedy
      expect(results[0]).toBe(SEASON_ACTION_ID);
      expect(results[1]).toBe(SEASON_COMEDY_ID);
      expect(results[2]).toBe(SEASON_HORROR_ID);
      expect(results[3]).toBe(SEASON_ACTION_ID);
      expect(results[4]).toBe(SEASON_COMEDY_ID);
    });
  });
});
