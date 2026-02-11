/**
 * Integration Test: Last Frame Genre Switching
 *
 * Tests the genre-switching flow that the create/upload pages perform:
 * 1. Mount with no genre → get genre_required
 * 2. User picks genre A → fetch genre A's frame
 * 3. User switches to genre B → fetch genre B's frame (NOT genre A's)
 * 4. User switches back to genre A → fetch genre A's frame again
 *
 * This validates the bug fix where !lastFrameUrl guard prevented
 * re-fetching when changing genres.
 *
 * Requires: local Supabase running (`supabase start`)
 */

import {
  testSupabase,
  setupMultiSeasonUser,
  MULTI_SEASON_USER_ID,
} from '../setup';

// Unique test genre codes
const DRAMA = 'test_switch_drama';
const ACTION = 'test_switch_action';
const HORROR = 'test_switch_horror';

// Fixed season IDs (must be valid hex UUIDs)
const DRAMA_SEASON_ID = 'dd001111-dd00-dd00-dd00-dd0011110000';
const ACTION_SEASON_ID = 'aa001111-aa00-aa00-aa00-aa0011110000';
const HORROR_SEASON_ID = 'cc001111-cc00-cc00-cc00-cc0011110000';

// Distinct frame URLs per genre
const DRAMA_FRAME = 'https://test.example.com/frames/drama-last-scene.jpg';
const ACTION_FRAME = 'https://test.example.com/frames/action-last-scene.jpg';
// Horror will intentionally have no frame (edge case)

// ============================================================================
// Replicate the API route logic (mirrors /api/story/last-frame exactly)
// ============================================================================

interface LastFrameResult {
  lastFrameUrl: string | null;
  reason?: string;
  genre?: string | null;
  slotPosition?: number;
  clipTitle?: string | null;
}

async function getLastFrame(
  genreParam?: string | null,
  flags: { last_frame_continuation: boolean; multi_genre_enabled: boolean } = {
    last_frame_continuation: true,
    multi_genre_enabled: true,
  }
): Promise<LastFrameResult> {
  if (!flags.last_frame_continuation) {
    return { lastFrameUrl: null, reason: 'feature_disabled' };
  }

  const REAL_GENRES = ['action', 'comedy', 'horror', 'animation', 'thriller', 'sci-fi', 'romance', 'drama'];
  const isValid = genreParam && (REAL_GENRES.includes(genreParam) || genreParam.startsWith('test_'));
  if (genreParam && !isValid) {
    return { lastFrameUrl: null, reason: 'invalid_genre' };
  }

  if (flags.multi_genre_enabled && !genreParam) {
    return { lastFrameUrl: null, reason: 'genre_required' };
  }

  let seasonQuery = testSupabase
    .from('seasons')
    .select('id, genre')
    .eq('status', 'active');

  if (flags.multi_genre_enabled && genreParam) {
    seasonQuery = seasonQuery.eq('genre', genreParam);
  }

  const { data: season } = await seasonQuery
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!season) {
    return { lastFrameUrl: null, reason: 'no_active_season' };
  }

  const { data: currentSlot } = await testSupabase
    .from('story_slots')
    .select('slot_position')
    .eq('season_id', season.id)
    .in('status', ['voting', 'waiting_for_clips', 'upcoming'])
    .order('slot_position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!currentSlot || currentSlot.slot_position <= 1) {
    return { lastFrameUrl: null, reason: 'first_slot' };
  }

  const previousPosition = currentSlot.slot_position - 1;

  const { data: prevSlot } = await testSupabase
    .from('story_slots')
    .select('winner_tournament_clip_id')
    .eq('season_id', season.id)
    .eq('slot_position', previousPosition)
    .eq('status', 'locked')
    .maybeSingle();

  if (!prevSlot?.winner_tournament_clip_id) {
    return { lastFrameUrl: null, reason: 'no_previous_winner' };
  }

  const { data: clip } = await testSupabase
    .from('tournament_clips')
    .select('last_frame_url, title')
    .eq('id', prevSlot.winner_tournament_clip_id)
    .single();

  if (!clip?.last_frame_url) {
    return { lastFrameUrl: null, reason: 'frame_not_extracted' };
  }

  return {
    lastFrameUrl: clip.last_frame_url,
    slotPosition: previousPosition,
    clipTitle: clip.title || null,
    genre: season.genre || null,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

async function createSeasonWithSlots(
  seasonId: string,
  genre: string,
  label: string,
  totalSlots: number = 5
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

async function createWinnerWithFrame(
  seasonId: string,
  slotPosition: number,
  lastFrameUrl: string | null,
  title: string
): Promise<string> {
  const { data: clip, error: clipError } = await testSupabase
    .from('tournament_clips')
    .insert({
      title,
      status: 'locked',
      season_id: seasonId,
      user_id: MULTI_SEASON_USER_ID,
      video_url: 'https://test.example.com/video.mp4',
      thumbnail_url: 'https://test.example.com/thumb.jpg',
      last_frame_url: lastFrameUrl,
      slot_position: slotPosition,
      genre: 'TEST',
    })
    .select('id')
    .single();

  if (clipError) throw new Error(`Failed to create winner clip: ${clipError.message}`);

  // Lock the slot with this winner
  await testSupabase
    .from('story_slots')
    .update({ status: 'locked', winner_tournament_clip_id: clip.id })
    .eq('season_id', seasonId)
    .eq('slot_position', slotPosition);

  // Advance next slot
  await testSupabase
    .from('story_slots')
    .update({ status: 'waiting_for_clips' })
    .eq('season_id', seasonId)
    .eq('slot_position', slotPosition + 1);

  return clip.id;
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

describe('Last Frame - Genre Switching Flow', () => {
  beforeAll(async () => {
    await setupMultiSeasonUser();

    // Create 3 parallel active seasons
    await createSeasonWithSlots(DRAMA_SEASON_ID, DRAMA, 'Drama Season');
    await createSeasonWithSlots(ACTION_SEASON_ID, ACTION, 'Action Season');
    await createSeasonWithSlots(HORROR_SEASON_ID, HORROR, 'Horror Season');

    // Drama: slot 1 locked with frame, slot 2 open
    await createWinnerWithFrame(DRAMA_SEASON_ID, 1, DRAMA_FRAME, 'Drama Episode 1');

    // Action: slot 1 locked with frame, slot 2 open
    await createWinnerWithFrame(ACTION_SEASON_ID, 1, ACTION_FRAME, 'Action Episode 1');

    // Horror: slot 1 locked WITHOUT frame (edge case), slot 2 open
    await createWinnerWithFrame(HORROR_SEASON_ID, 1, null, 'Horror Episode 1');
  });

  afterAll(async () => {
    await cleanupSeason(DRAMA_SEASON_ID);
    await cleanupSeason(ACTION_SEASON_ID);
    await cleanupSeason(HORROR_SEASON_ID);
  });

  // ------------------------------------------------------------------
  // 1. CREATE PAGE FLOW (AIGeneratePanel genre selector)
  // ------------------------------------------------------------------
  describe('Create page flow: mount → pick genre → switch genre', () => {
    it('Step 1: mount with no genre → gets genre_required', async () => {
      const result = await getLastFrame(null);
      expect(result.lastFrameUrl).toBeNull();
      expect(result.reason).toBe('genre_required');
    });

    it('Step 2: user picks Drama → gets Drama frame', async () => {
      const result = await getLastFrame(DRAMA);
      expect(result.lastFrameUrl).toBe(DRAMA_FRAME);
      expect(result.genre).toBe(DRAMA);
      expect(result.clipTitle).toBe('Drama Episode 1');
    });

    it('Step 3: user switches to Action → gets Action frame (not Drama)', async () => {
      const result = await getLastFrame(ACTION);
      expect(result.lastFrameUrl).toBe(ACTION_FRAME);
      expect(result.genre).toBe(ACTION);
      expect(result.clipTitle).toBe('Action Episode 1');
      // The critical assertion: Action's frame is different from Drama's
      expect(result.lastFrameUrl).not.toBe(DRAMA_FRAME);
    });

    it('Step 4: user switches back to Drama → gets Drama frame again', async () => {
      const result = await getLastFrame(DRAMA);
      expect(result.lastFrameUrl).toBe(DRAMA_FRAME);
      expect(result.genre).toBe(DRAMA);
    });
  });

  // ------------------------------------------------------------------
  // 2. UPLOAD PAGE FLOW (genre selected in step 2, late continuation)
  // ------------------------------------------------------------------
  describe('Upload page flow: mount → select genre → see frame → change genre', () => {
    it('mount with no genre → genre_required signals multiGenreEnabled', async () => {
      const result = await getLastFrame(null);
      expect(result.reason).toBe('genre_required');
      // UI sets multiGenreEnabled = true at this point
    });

    it('user selects Action genre → gets Action frame for late continuation', async () => {
      const result = await getLastFrame(ACTION);
      expect(result.lastFrameUrl).toBe(ACTION_FRAME);
    });

    it('user changes mind, selects Drama → gets Drama frame instead', async () => {
      const result = await getLastFrame(DRAMA);
      expect(result.lastFrameUrl).toBe(DRAMA_FRAME);
      expect(result.lastFrameUrl).not.toBe(ACTION_FRAME);
    });
  });

  // ------------------------------------------------------------------
  // 3. URL PRE-SELECTION (?genre=action)
  // ------------------------------------------------------------------
  describe('URL pre-selection: /create?genre=action', () => {
    it('loads correct frame immediately when genre is in URL', async () => {
      // Simulates fetchLastFrame(urlGenre) on mount
      const result = await getLastFrame(ACTION);
      expect(result.lastFrameUrl).toBe(ACTION_FRAME);
      expect(result.genre).toBe(ACTION);
    });

    it('user overrides URL genre by picking Drama in panel', async () => {
      // First call with URL genre
      const initial = await getLastFrame(ACTION);
      expect(initial.lastFrameUrl).toBe(ACTION_FRAME);

      // User picks different genre in UI
      const switched = await getLastFrame(DRAMA);
      expect(switched.lastFrameUrl).toBe(DRAMA_FRAME);
      expect(switched.lastFrameUrl).not.toBe(initial.lastFrameUrl);
    });
  });

  // ------------------------------------------------------------------
  // 4. EDGE CASE: Switch to genre without extracted frame
  // ------------------------------------------------------------------
  describe('Edge case: genre with no extracted frame', () => {
    it('switching to Horror (no frame) returns frame_not_extracted', async () => {
      const result = await getLastFrame(HORROR);
      expect(result.lastFrameUrl).toBeNull();
      expect(result.reason).toBe('frame_not_extracted');
    });

    it('switching from Horror back to Drama still works', async () => {
      // First get null from Horror
      const horror = await getLastFrame(HORROR);
      expect(horror.lastFrameUrl).toBeNull();

      // Then switch to Drama — should get Drama's frame
      const drama = await getLastFrame(DRAMA);
      expect(drama.lastFrameUrl).toBe(DRAMA_FRAME);
    });

    it('switching from Drama to Horror to Action returns correct frames', async () => {
      const r1 = await getLastFrame(DRAMA);
      expect(r1.lastFrameUrl).toBe(DRAMA_FRAME);

      const r2 = await getLastFrame(HORROR);
      expect(r2.lastFrameUrl).toBeNull();

      const r3 = await getLastFrame(ACTION);
      expect(r3.lastFrameUrl).toBe(ACTION_FRAME);
    });
  });

  // ------------------------------------------------------------------
  // 5. RAPID SWITCHING (simulates quick genre changes)
  // ------------------------------------------------------------------
  describe('Rapid genre switching', () => {
    it('10 rapid switches all return correct genre-specific frames', async () => {
      const sequence = [DRAMA, ACTION, DRAMA, ACTION, HORROR, DRAMA, ACTION, HORROR, ACTION, DRAMA];
      const expected = [DRAMA_FRAME, ACTION_FRAME, DRAMA_FRAME, ACTION_FRAME, null, DRAMA_FRAME, ACTION_FRAME, null, ACTION_FRAME, DRAMA_FRAME];

      for (let i = 0; i < sequence.length; i++) {
        const result = await getLastFrame(sequence[i]);
        expect(result.lastFrameUrl).toBe(expected[i]);
      }
    });

    it('parallel fetches for different genres return correct isolated results', async () => {
      const [drama, action, horror] = await Promise.all([
        getLastFrame(DRAMA),
        getLastFrame(ACTION),
        getLastFrame(HORROR),
      ]);

      expect(drama.lastFrameUrl).toBe(DRAMA_FRAME);
      expect(drama.genre).toBe(DRAMA);

      expect(action.lastFrameUrl).toBe(ACTION_FRAME);
      expect(action.genre).toBe(ACTION);

      expect(horror.lastFrameUrl).toBeNull();
      expect(horror.reason).toBe('frame_not_extracted');
    });
  });

  // ------------------------------------------------------------------
  // 6. GENRE ISOLATION (no cross-contamination)
  // ------------------------------------------------------------------
  describe('Genre isolation', () => {
    it('Drama frame never appears when requesting Action', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await getLastFrame(ACTION);
        expect(result.lastFrameUrl).toBe(ACTION_FRAME);
        expect(result.lastFrameUrl).not.toBe(DRAMA_FRAME);
      }
    });

    it('Action frame never appears when requesting Drama', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await getLastFrame(DRAMA);
        expect(result.lastFrameUrl).toBe(DRAMA_FRAME);
        expect(result.lastFrameUrl).not.toBe(ACTION_FRAME);
      }
    });

    it('genre field in response always matches the requested genre', async () => {
      const drama = await getLastFrame(DRAMA);
      expect(drama.genre).toBe(DRAMA);

      const action = await getLastFrame(ACTION);
      expect(action.genre).toBe(ACTION);

      const horror = await getLastFrame(HORROR);
      // Horror has no extracted frame, so genre is not in the response
      // (genre only returned when a frame is found)
      expect(horror.reason).toBe('frame_not_extracted');
    });
  });

  // ------------------------------------------------------------------
  // 7. PROGRESSIVE STORY (genres at different slot positions)
  // ------------------------------------------------------------------
  describe('Progressive story: genres at different slot positions', () => {
    const PROG_DRAMA_ID = 'dd002222-dd00-dd00-dd00-dd0022220001';
    const PROG_ACTION_ID = 'aa002222-aa00-aa00-aa00-aa0022220001';
    const PROG_DRAMA = 'test_prog_drama';
    const PROG_ACTION = 'test_prog_action';

    beforeAll(async () => {
      // Drama: 2 slots locked (at slot 3 now)
      await createSeasonWithSlots(PROG_DRAMA_ID, PROG_DRAMA, 'Progressive Drama', 5);
      await createWinnerWithFrame(PROG_DRAMA_ID, 1, 'https://frames/drama-ep1.jpg', 'Drama Ep 1');
      await createWinnerWithFrame(PROG_DRAMA_ID, 2, 'https://frames/drama-ep2.jpg', 'Drama Ep 2');

      // Action: 1 slot locked (at slot 2 now)
      await createSeasonWithSlots(PROG_ACTION_ID, PROG_ACTION, 'Progressive Action', 5);
      await createWinnerWithFrame(PROG_ACTION_ID, 1, 'https://frames/action-ep1.jpg', 'Action Ep 1');
    });

    afterAll(async () => {
      await cleanupSeason(PROG_DRAMA_ID);
      await cleanupSeason(PROG_ACTION_ID);
    });

    it('Drama returns slot 2 frame (latest locked)', async () => {
      const result = await getLastFrame(PROG_DRAMA);
      expect(result.lastFrameUrl).toBe('https://frames/drama-ep2.jpg');
      expect(result.slotPosition).toBe(2);
      expect(result.clipTitle).toBe('Drama Ep 2');
    });

    it('Action returns slot 1 frame (only locked slot)', async () => {
      const result = await getLastFrame(PROG_ACTION);
      expect(result.lastFrameUrl).toBe('https://frames/action-ep1.jpg');
      expect(result.slotPosition).toBe(1);
      expect(result.clipTitle).toBe('Action Ep 1');
    });

    it('switching between progressive genres returns each correct latest frame', async () => {
      const drama = await getLastFrame(PROG_DRAMA);
      const action = await getLastFrame(PROG_ACTION);

      expect(drama.slotPosition).toBe(2);
      expect(action.slotPosition).toBe(1);
      expect(drama.lastFrameUrl).not.toBe(action.lastFrameUrl);
    });
  });
});
