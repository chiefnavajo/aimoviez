/**
 * Integration Test Setup
 *
 * This module provides utilities for testing admin API endpoints against
 * a real Supabase database (local via `supabase start`).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Test Supabase client - uses local Supabase or test project
export const testSupabase: SupabaseClient = createClient(
  process.env.TEST_SUPABASE_URL || 'http://localhost:54321',
  process.env.TEST_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Static test IDs for consistency across test files
// Using fixed UUIDs ensures all test files share the same user
export const TEST_SEASON_ID = '11111111-1111-1111-1111-111111111111';
export const TEST_USER_ID = '22222222-2222-2222-2222-222222222222';
export const TEST_ADMIN_EMAIL = 'admin@test.com';

// Multi-season support: track all created seasons for cleanup
export const TEST_SEASON_IDS: string[] = [];
export const MULTI_SEASON_USER_ID = '33333333-3333-3333-3333-333333333333';

// Types
interface ClipOverrides {
  title?: string;
  status?: 'pending' | 'active' | 'rejected' | 'locked';
  slot_position?: number | null;
  season_id?: string;
  user_id?: string;
  video_url?: string;
  genre?: string;
  eliminated_at?: string;
  elimination_reason?: string;
}

interface SlotOverrides {
  slot_position?: number;
  status?: 'upcoming' | 'waiting_for_clips' | 'voting' | 'locked';
  voting_started_at?: string | null;
  voting_ends_at?: string | null;
  winner_tournament_clip_id?: string | null;
  voting_duration_hours?: number;
}

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Create a test clip in the database
 */
export async function createTestClip(overrides: ClipOverrides = {}): Promise<Record<string, unknown>> {
  const clipData = {
    title: `Test Clip ${Date.now()}`,
    status: 'pending',
    season_id: TEST_SEASON_ID,
    user_id: TEST_USER_ID,
    video_url: 'https://test.example.com/video.mp4',
    thumbnail_url: 'https://test.example.com/thumb.jpg',
    genre: 'TEST',
    description: 'Integration test clip',
    ...overrides,
  };

  const { data, error } = await testSupabase
    .from('tournament_clips')
    .insert(clipData)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create test clip: ${error.message}`);
  }

  return data;
}

/**
 * Create multiple test clips
 */
export async function createTestClips(count: number, overrides: ClipOverrides = {}): Promise<Record<string, unknown>[]> {
  const clips: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const clip = await createTestClip({
      title: `Test Clip ${i + 1} - ${Date.now()}`,
      ...overrides,
    });
    clips.push(clip);
  }
  return clips;
}

/**
 * Get a clip by ID
 */
export async function getClip(clipId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await testSupabase
    .from('tournament_clips')
    .select('*')
    .eq('id', clipId)
    .single();

  if (error) {
    return null;
  }

  return data;
}

/**
 * Get a slot by position
 */
export async function getSlot(position: number, seasonId: string = TEST_SEASON_ID): Promise<Record<string, unknown> | null> {
  const { data, error } = await testSupabase
    .from('story_slots')
    .select('*')
    .eq('season_id', seasonId)
    .eq('slot_position', position)
    .single();

  if (error) {
    return null;
  }

  return data;
}

/**
 * Update a slot directly (for test setup)
 */
export async function updateSlot(position: number, updates: SlotOverrides, seasonId: string = TEST_SEASON_ID): Promise<void> {
  const { error } = await testSupabase
    .from('story_slots')
    .update(updates)
    .eq('season_id', seasonId)
    .eq('slot_position', position);

  if (error) {
    throw new Error(`Failed to update slot: ${error.message}`);
  }
}

/**
 * Call an admin API endpoint
 * Note: This requires the dev server to be running on localhost:3000
 */
export async function callAdminAPI(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<ApiResponse> {
  const baseUrl = process.env.TEST_API_URL || 'http://localhost:3000';

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // In a real setup, we'd need proper admin auth
      // For now, we'll need to mock or configure test auth
      'X-Test-Admin': 'true',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let responseBody: Record<string, unknown>;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = { error: 'Failed to parse response' };
  }

  return {
    status: response.status,
    body: responseBody,
  };
}

/**
 * Setup test season with slots
 */
export async function setupTestSeason(totalSlots: number = 10): Promise<void> {
  // Create test user in users table first (required for foreign key constraint)
  const { error: userError } = await testSupabase
    .from('users')
    .insert({
      id: TEST_USER_ID,
      username: 'testuser',
      email: 'test@integration.local',
    });

  if (userError && !userError.message.includes('duplicate')) {
    throw new Error(`Failed to create test user: ${userError.message}`);
  }

  // Create test season
  const { error: seasonError } = await testSupabase
    .from('seasons')
    .insert({
      id: TEST_SEASON_ID,
      label: 'Integration Test Season',
      status: 'active',
      total_slots: totalSlots,
      genre: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    });

  if (seasonError) {
    throw new Error(`Failed to create test season: ${seasonError.message}`);
  }

  // Create slots
  const slots = Array.from({ length: totalSlots }, (_, i) => ({
    season_id: TEST_SEASON_ID,
    slot_position: i + 1,
    status: i === 0 ? 'waiting_for_clips' : 'upcoming',
  }));

  const { error: slotsError } = await testSupabase
    .from('story_slots')
    .insert(slots);

  if (slotsError) {
    throw new Error(`Failed to create test slots: ${slotsError.message}`);
  }
}

/**
 * Cleanup test data
 */
export async function cleanupTestData(): Promise<void> {
  // Helper to delete from a table, gracefully ignoring "table not found" errors
  async function safeDelete(table: string, column: string, value: string) {
    try {
      await testSupabase.from(table).delete().eq(column, value);
    } catch {
      // Gracefully handle table not found or other errors
    }
  }

  // Delete in order due to foreign key constraints
  // First, clean up co-director / analysis related tables
  await safeDelete('direction_votes', 'season_id', TEST_SEASON_ID);
  await safeDelete('direction_options', 'season_id', TEST_SEASON_ID);
  await safeDelete('slot_briefs', 'season_id', TEST_SEASON_ID);
  await safeDelete('story_analyses', 'season_id', TEST_SEASON_ID);

  // Clean up social / notification tables
  await safeDelete('comment_likes', 'season_id', TEST_SEASON_ID);
  await safeDelete('notifications', 'user_id', TEST_USER_ID);
  await safeDelete('cron_locks', 'season_id', TEST_SEASON_ID);

  // Core tables
  await safeDelete('votes', 'season_id', TEST_SEASON_ID);
  await safeDelete('tournament_clips', 'season_id', TEST_SEASON_ID);
  await safeDelete('story_slots', 'season_id', TEST_SEASON_ID);
  await safeDelete('seasons', 'id', TEST_SEASON_ID);
  await safeDelete('users', 'id', TEST_USER_ID);
}

/**
 * Wait for a condition to be true (with timeout)
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number = 5000,
  intervalMs: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('Timeout waiting for condition');
}

/**
 * Assert slot state matches expected values
 */
export async function assertSlotState(
  position: number,
  expected: Partial<SlotOverrides>,
  seasonId: string = TEST_SEASON_ID
): Promise<void> {
  const slot = await getSlot(position, seasonId);

  if (!slot) {
    throw new Error(`Slot ${position} not found`);
  }

  for (const [key, value] of Object.entries(expected)) {
    if (slot[key] !== value) {
      throw new Error(
        `Slot ${position} ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(slot[key])}`
      );
    }
  }
}

/**
 * Assert clip state matches expected values
 */
export async function assertClipState(
  clipId: string,
  expected: Partial<ClipOverrides>
): Promise<void> {
  const clip = await getClip(clipId);

  if (!clip) {
    throw new Error(`Clip ${clipId} not found`);
  }

  for (const [key, value] of Object.entries(expected)) {
    if (clip[key] !== value) {
      throw new Error(
        `Clip ${clipId} ${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(clip[key])}`
      );
    }
  }
}

// ============================================
// Multi-Season Helper Functions
// ============================================

// Counter for unique genre names (to avoid unique constraint on active seasons)
let genreCounter = 0;

/**
 * Create a test season with slots (for multi-season tests)
 * Automatically tracks the season for cleanup
 * Uses unique genre per season to avoid idx_seasons_active_genre constraint
 */
export async function createSeason(
  label: string,
  totalSlots: number = 10,
  status: 'draft' | 'active' | 'finished' = 'active'
): Promise<string> {
  const seasonId = crypto.randomUUID();
  TEST_SEASON_IDS.push(seasonId);

  // Use unique genre for each season to avoid unique constraint
  const uniqueGenre = `TEST_${genreCounter++}_${Date.now()}`;

  const { error: seasonError } = await testSupabase
    .from('seasons')
    .insert({
      id: seasonId,
      label,
      status,
      total_slots: totalSlots,
      genre: uniqueGenre,
    });

  if (seasonError) {
    throw new Error(`Failed to create season: ${seasonError.message}`);
  }

  // Create slots
  const slots = Array.from({ length: totalSlots }, (_, i) => ({
    season_id: seasonId,
    slot_position: i + 1,
    status: i === 0 ? 'waiting_for_clips' : 'upcoming',
  }));

  const { error: slotsError } = await testSupabase
    .from('story_slots')
    .insert(slots);

  if (slotsError) {
    throw new Error(`Failed to create slots for season: ${slotsError.message}`);
  }

  return seasonId;
}

/**
 * Create a test clip for a specific season (multi-season support)
 */
export async function createClipForSeason(
  seasonId: string,
  overrides: Omit<ClipOverrides, 'season_id'> = {}
): Promise<Record<string, unknown>> {
  const clipData = {
    title: `Test Clip ${Date.now()}`,
    status: 'pending',
    season_id: seasonId,
    user_id: MULTI_SEASON_USER_ID,
    video_url: 'https://test.example.com/video.mp4',
    thumbnail_url: 'https://test.example.com/thumb.jpg',
    genre: 'TEST',
    description: 'Multi-season integration test clip',
    ...overrides,
  };

  const { data, error } = await testSupabase
    .from('tournament_clips')
    .insert(clipData)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create clip for season: ${error.message}`);
  }

  return data;
}

/**
 * Get all clips for a season
 */
export async function getClipsForSeason(seasonId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await testSupabase
    .from('tournament_clips')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to get clips for season: ${error.message}`);
  }

  return data || [];
}

/**
 * Get all slots for a season
 */
export async function getSlotsForSeason(seasonId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await testSupabase
    .from('story_slots')
    .select('*')
    .eq('season_id', seasonId)
    .order('slot_position', { ascending: true });

  if (error) {
    throw new Error(`Failed to get slots for season: ${error.message}`);
  }

  return data || [];
}

/**
 * Setup the shared multi-season test user
 */
export async function setupMultiSeasonUser(): Promise<void> {
  // First, check if user with this ID already exists
  const { data: existingById } = await testSupabase
    .from('users')
    .select('id')
    .eq('id', MULTI_SEASON_USER_ID)
    .single();

  if (existingById) {
    // User already exists with correct ID, we're done
    return;
  }

  // Check if user with this email exists (different ID)
  const { data: existingByEmail } = await testSupabase
    .from('users')
    .select('id')
    .eq('email', 'multi@integration.local')
    .single();

  if (existingByEmail) {
    // Delete user with conflicting email
    await testSupabase
      .from('users')
      .delete()
      .eq('email', 'multi@integration.local');
  }

  // Now create the user with our specific ID
  const { error } = await testSupabase
    .from('users')
    .insert({
      id: MULTI_SEASON_USER_ID,
      username: 'multiuser',
      email: 'multi@integration.local',
    });

  if (error) {
    throw new Error(`Failed to create multi-season user: ${error.message}`);
  }
}

/**
 * Cleanup all tracked multi-season test data
 */
export async function cleanupAllTestSeasons(): Promise<void> {
  for (const seasonId of TEST_SEASON_IDS) {
    await testSupabase.from('votes').delete().eq('season_id', seasonId);
    await testSupabase.from('tournament_clips').delete().eq('season_id', seasonId);
    await testSupabase.from('story_slots').delete().eq('season_id', seasonId);
    await testSupabase.from('seasons').delete().eq('id', seasonId);
  }
  TEST_SEASON_IDS.length = 0; // Clear the array

  // Note: We don't delete the multi-season user here to avoid breaking other tests
  // The user is shared across test suites within a single test run
}

/**
 * Approve a clip directly in the database (for test setup)
 */
export async function approveClipDirect(clipId: string, slotPosition: number): Promise<void> {
  const { error } = await testSupabase
    .from('tournament_clips')
    .update({
      status: 'active',
      slot_position: slotPosition,
    })
    .eq('id', clipId);

  if (error) {
    throw new Error(`Failed to approve clip: ${error.message}`);
  }
}

/**
 * Assign winner directly in the database (for test setup)
 */
export async function assignWinnerDirect(
  seasonId: string,
  slotPosition: number,
  clipId: string
): Promise<void> {
  // Lock the clip
  const { error: clipError } = await testSupabase
    .from('tournament_clips')
    .update({ status: 'locked' })
    .eq('id', clipId);

  if (clipError) {
    throw new Error(`Failed to lock clip: ${clipError.message}`);
  }

  // Lock the slot and set winner
  const { error: slotError } = await testSupabase
    .from('story_slots')
    .update({
      status: 'locked',
      winner_tournament_clip_id: clipId,
    })
    .eq('season_id', seasonId)
    .eq('slot_position', slotPosition);

  if (slotError) {
    throw new Error(`Failed to lock slot: ${slotError.message}`);
  }

  // Advance next slot to waiting_for_clips
  const { error: nextSlotError } = await testSupabase
    .from('story_slots')
    .update({ status: 'waiting_for_clips' })
    .eq('season_id', seasonId)
    .eq('slot_position', slotPosition + 1);

  // Ignore error if no next slot exists
  if (nextSlotError && !nextSlotError.message.includes('No rows')) {
    // It's OK if there's no next slot
  }
}

/**
 * Delete a clip directly from the database
 */
export async function deleteClipDirect(clipId: string): Promise<void> {
  const { error } = await testSupabase
    .from('tournament_clips')
    .delete()
    .eq('id', clipId);

  if (error) {
    throw new Error(`Failed to delete clip: ${error.message}`);
  }
}

/**
 * Count clips in a season by status
 */
export async function countClipsByStatus(
  seasonId: string,
  status?: 'pending' | 'active' | 'rejected' | 'locked'
): Promise<number> {
  let query = testSupabase
    .from('tournament_clips')
    .select('id', { count: 'exact', head: true })
    .eq('season_id', seasonId);

  if (status) {
    query = query.eq('status', status);
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(`Failed to count clips: ${error.message}`);
  }

  return count || 0;
}

/**
 * Call the assign_winner_atomic RPC function
 */
export async function callAssignWinnerRPC(params: {
  clipId: string;
  slotId: string;
  seasonId: string;
  nextSlotPosition: number;
  votingDurationHours?: number;
  advanceSlot?: boolean;
}) {
  const { data, error } = await testSupabase.rpc('assign_winner_atomic', {
    p_clip_id: params.clipId,
    p_slot_id: params.slotId,
    p_season_id: params.seasonId,
    p_next_slot_position: params.nextSlotPosition,
    p_voting_duration_hours: params.votingDurationHours ?? 24,
    p_advance_slot: params.advanceSlot ?? true,
  });
  return { data, error };
}
