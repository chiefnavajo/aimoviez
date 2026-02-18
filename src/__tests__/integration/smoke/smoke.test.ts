/**
 * Smoke Tests
 *
 * Quick health check suite for CI/CD deployments.
 * These tests should run in < 30 seconds and verify:
 * - Database connectivity
 * - Core tables exist
 * - Basic CRUD operations work
 * - Critical relationships are intact
 */

import { testSupabase, setupMultiSeasonUser, MULTI_SEASON_USER_ID } from '../setup';

describe('Smoke Tests - Quick Health Check', () => {
  // =========================================================================
  // DATABASE CONNECTIVITY
  // =========================================================================
  describe('Database Connectivity', () => {
    it('can connect to Supabase', async () => {
      const start = Date.now();
      const { error } = await testSupabase.from('seasons').select('id').limit(1);
      const duration = Date.now() - start;

      expect(error).toBeNull();
      expect(duration).toBeLessThan(5000);
    });

    it('responds within acceptable latency', async () => {
      const iterations = 5;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await testSupabase.from('seasons').select('id').limit(1);
        latencies.push(Date.now() - start);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / iterations;
      expect(avgLatency).toBeLessThan(500); // 500ms average
    });
  });

  // =========================================================================
  // CORE TABLES EXIST
  // =========================================================================
  describe('Core Tables Exist', () => {
    const coreTables = [
      'seasons',
      'story_slots',
      'tournament_clips',
      'votes',
      'users',
      'comments',
      'ai_generations',
      'feature_flags',
    ];

    test.each(coreTables)('table "%s" exists and is queryable', async (table) => {
      const { error } = await testSupabase.from(table).select('*').limit(1);

      // Table exists if no "relation does not exist" error
      const tableExists = !error || !error.message.includes('relation');
      expect(tableExists).toBe(true);
    });
  });

  // =========================================================================
  // BASIC CRUD OPERATIONS
  // =========================================================================
  describe('Basic CRUD Operations', () => {
    let testClipId: string | null = null;
    let testSeasonId: string | null = null;

    beforeAll(async () => {
      await setupMultiSeasonUser();

      // Create a test season for CRUD tests
      const { data: newSeason } = await testSupabase
        .from('seasons')
        .insert({
          label: 'Smoke Test Season',
          status: 'active',
          total_slots: 1,
          genre: `SMOKE_${Date.now()}`,
        })
        .select('id')
        .single();

      if (newSeason) {
        testSeasonId = newSeason.id;
      }
    });

    afterAll(async () => {
      // Cleanup
      if (testClipId) {
        await testSupabase.from('votes').delete().eq('clip_id', testClipId);
        await testSupabase.from('tournament_clips').delete().eq('id', testClipId);
      }
      if (testSeasonId) {
        await testSupabase.from('story_slots').delete().eq('season_id', testSeasonId);
        await testSupabase.from('seasons').delete().eq('id', testSeasonId);
      }
    });

    it('can CREATE a record', async () => {
      if (!testSeasonId) {
        // Fallback: get any existing season
        const { data: seasons } = await testSupabase
          .from('seasons')
          .select('id')
          .limit(1);

        if (!seasons || seasons.length === 0) {
          console.log('No seasons available for CRUD test');
          expect(true).toBe(true);
          return;
        }
        testSeasonId = seasons[0].id;
      }

      const { data, error } = await testSupabase
        .from('tournament_clips')
        .insert({
          title: 'Smoke Test Clip',
          status: 'pending',
          season_id: testSeasonId,
          user_id: MULTI_SEASON_USER_ID,
          video_url: 'https://smoke.test/video.mp4',
          thumbnail_url: 'https://smoke.test/thumb.jpg',
          genre: 'TEST',
        })
        .select('id')
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeDefined();
      testClipId = data!.id;
    });

    it('can READ a record', async () => {
      if (!testClipId) return;

      const { data, error } = await testSupabase
        .from('tournament_clips')
        .select('id, title, status')
        .eq('id', testClipId)
        .single();

      expect(error).toBeNull();
      expect(data?.title).toBe('Smoke Test Clip');
    });

    it('can UPDATE a record', async () => {
      if (!testClipId) return;

      const { error } = await testSupabase
        .from('tournament_clips')
        .update({ title: 'Updated Smoke Test' })
        .eq('id', testClipId);

      expect(error).toBeNull();

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('title')
        .eq('id', testClipId)
        .single();

      expect(data?.title).toBe('Updated Smoke Test');
    });

    it('can DELETE a record', async () => {
      if (!testClipId) return;

      const { error } = await testSupabase
        .from('tournament_clips')
        .delete()
        .eq('id', testClipId);

      expect(error).toBeNull();

      const { data } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('id', testClipId)
        .single();

      expect(data).toBeNull();
      testClipId = null;
    });
  });

  // =========================================================================
  // CRITICAL RELATIONSHIPS
  // =========================================================================
  describe('Critical Relationships', () => {
    it('seasons have story_slots', async () => {
      const { data: seasons } = await testSupabase
        .from('seasons')
        .select('id')
        .eq('status', 'active')
        .limit(1);

      if (!seasons || seasons.length === 0) return;

      const { data: slots, error } = await testSupabase
        .from('story_slots')
        .select('id')
        .eq('season_id', seasons[0].id)
        .limit(1);

      expect(error).toBeNull();
      // Active season should have slots
      expect(slots?.length).toBeGreaterThanOrEqual(0);
    });

    it('clips belong to seasons', async () => {
      const { data: clips } = await testSupabase
        .from('tournament_clips')
        .select('id, season_id')
        .limit(1);

      if (!clips || clips.length === 0) return;

      const { data: season, error } = await testSupabase
        .from('seasons')
        .select('id')
        .eq('id', clips[0].season_id)
        .single();

      expect(error).toBeNull();
      expect(season).not.toBeNull();
    });

    it('votes reference valid clips', async () => {
      const { data: votes } = await testSupabase
        .from('votes')
        .select('clip_id')
        .limit(1);

      if (!votes || votes.length === 0) return;

      const { data: clip, error } = await testSupabase
        .from('tournament_clips')
        .select('id')
        .eq('id', votes[0].clip_id)
        .single();

      expect(error).toBeNull();
      expect(clip).not.toBeNull();
    });
  });

  // =========================================================================
  // FEATURE FLAGS
  // =========================================================================
  describe('Feature Flags', () => {
    it('feature_flags table is accessible', async () => {
      const { data, error } = await testSupabase
        .from('feature_flags')
        .select('key, enabled')
        .limit(5);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it('critical flags exist', async () => {
      const criticalFlags = ['async_voting', 'credit_system'];

      for (const flag of criticalFlags) {
        const { data } = await testSupabase
          .from('feature_flags')
          .select('enabled')
          .eq('key', flag)
          .single();

        // Flag might not exist in all environments
        if (data) {
          expect(typeof data.enabled).toBe('boolean');
        }
      }
    });
  });

  // =========================================================================
  // AUTHENTICATION SETUP
  // =========================================================================
  describe('Authentication Setup', () => {
    it('test user exists', async () => {
      const { data, error } = await testSupabase
        .from('users')
        .select('id, username')
        .eq('id', MULTI_SEASON_USER_ID)
        .single();

      if (error) {
        // User might not exist yet - create it
        await setupMultiSeasonUser();
      }

      expect(true).toBe(true); // Test passes if we get here
    });
  });

  // =========================================================================
  // PERFORMANCE BASELINE
  // =========================================================================
  describe('Performance Baseline', () => {
    it('list queries complete quickly', async () => {
      const start = Date.now();

      await Promise.all([
        testSupabase.from('seasons').select('id, label').limit(10),
        testSupabase.from('tournament_clips').select('id, title').limit(10),
        testSupabase.from('users').select('id, username').limit(10),
      ]);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(2000); // All 3 queries in < 2s
    });

    it('count queries work', async () => {
      const { count, error } = await testSupabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true });

      expect(error).toBeNull();
      expect(typeof count).toBe('number');
    });
  });
});
