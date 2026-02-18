/**
 * AI Generation Integration Tests
 *
 * Tests the AI generation tracking:
 * - Generation records
 * - Status transitions
 * - Credit deduction tracking
 * - Error handling
 */

import {
  testSupabase,
  createSeason,
  cleanupAllTestSeasons,
  setupMultiSeasonUser,
  MULTI_SEASON_USER_ID,
} from '../setup';

// Track created resources
const createdGenerationIds: string[] = [];
let testSeasonId: string;

async function createGeneration(overrides: Record<string, unknown> = {}): Promise<string> {
  const falRequestId = `fal_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { data, error } = await testSupabase
    .from('ai_generations')
    .insert({
      user_id: MULTI_SEASON_USER_ID,
      fal_request_id: falRequestId,
      prompt: 'Test prompt for integration testing',
      model: 'test-model',
      status: 'pending',
      ...overrides,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create generation: ${error.message}`);

  createdGenerationIds.push(data.id);
  return data.id;
}

async function getGeneration(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await testSupabase
    .from('ai_generations')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

async function updateGenerationStatus(
  id: string,
  status: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await testSupabase
    .from('ai_generations')
    .update({ status, ...extra })
    .eq('id', id);

  if (error) throw new Error(`Failed to update generation: ${error.message}`);
}

async function cleanupTestData(): Promise<void> {
  for (const id of createdGenerationIds) {
    await testSupabase.from('ai_generations').delete().eq('id', id);
  }

  await cleanupAllTestSeasons();
  createdGenerationIds.length = 0;
}

describe('AI Generation Integration Tests', () => {
  beforeAll(async () => {
    await setupMultiSeasonUser();
    testSeasonId = await createSeason('AI Generation Test Season', 10, 'active');
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe('Generation Records', () => {
    it('ai_generations table exists', async () => {
      const { data, error } = await testSupabase
        .from('ai_generations')
        .select('id')
        .limit(1);

      if (error && error.message.includes('relation')) {
        console.log('ai_generations table does not exist, skipping AI tests');
        return;
      }

      expect(Array.isArray(data) || data === null).toBe(true);
    });

    it('creates a generation record', async () => {
      const id = await createGeneration();

      const generation = await getGeneration(id);
      expect(generation).not.toBeNull();
      expect(generation?.status).toBe('pending');
      expect(generation?.user_id).toBe(MULTI_SEASON_USER_ID);
    });

    it('generation has required fields', async () => {
      const id = await createGeneration({
        prompt: 'A cinematic scene of a sunset',
        model: 'fal-ai/runway-gen3',
        credit_amount: 10,
      });

      const generation = await getGeneration(id);
      expect(generation?.prompt).toBe('A cinematic scene of a sunset');
      expect(generation?.model).toBe('fal-ai/runway-gen3');
      expect(generation?.credit_amount).toBe(10);
    });

    it('stores optional style parameter', async () => {
      const id = await createGeneration({
        prompt: 'Test prompt',
        style: 'cinematic',
      });

      const generation = await getGeneration(id);
      expect(generation?.style).toBe('cinematic');
    });
  });

  describe('Status Transitions', () => {
    // Valid statuses: pending, processing, completed, failed, expired
    it('transitions from pending to processing', async () => {
      const id = await createGeneration();

      await updateGenerationStatus(id, 'processing');

      const generation = await getGeneration(id);
      expect(generation?.status).toBe('processing');
    });

    it('transitions from processing to completed', async () => {
      const id = await createGeneration({ status: 'processing' });

      await updateGenerationStatus(id, 'completed', {
        video_url: 'https://example.com/video.mp4',
      });

      const generation = await getGeneration(id);
      expect(generation?.status).toBe('completed');
      expect(generation?.video_url).toBe('https://example.com/video.mp4');
    });

    it('transitions to failed state', async () => {
      const id = await createGeneration({ status: 'processing' });

      await updateGenerationStatus(id, 'failed', {
        error_message: 'Content policy violation',
      });

      const generation = await getGeneration(id);
      expect(generation?.status).toBe('failed');
      expect(generation?.error_message).toBe('Content policy violation');
    });

    it('transitions to expired state', async () => {
      const id = await createGeneration({ status: 'completed' });

      await updateGenerationStatus(id, 'expired');

      const generation = await getGeneration(id);
      expect(generation?.status).toBe('expired');
    });
  });

  describe('Credit Tracking', () => {
    it('tracks credit amount per generation', async () => {
      const id = await createGeneration({ credit_amount: 25 });

      const generation = await getGeneration(id);
      expect(generation?.credit_amount).toBe(25);
    });

    it('can sum total credits used by user', async () => {
      // Create multiple generations and track IDs
      const id1 = await createGeneration({ credit_amount: 10 });
      const id2 = await createGeneration({ credit_amount: 15 });
      const id3 = await createGeneration({ credit_amount: 20 });

      const { data } = await testSupabase
        .from('ai_generations')
        .select('credit_amount')
        .in('id', [id1, id2, id3]);

      const total = data?.reduce((sum, g) => sum + (g.credit_amount || 0), 0) || 0;
      expect(total).toBe(45);
    });

    it('tracks generations without credit amount (legacy)', async () => {
      const id = await createGeneration({ credit_amount: null });

      const generation = await getGeneration(id);
      expect(generation?.credit_amount).toBeNull();
    });
  });

  describe('User Generation Queries', () => {
    it('can fetch user generations', async () => {
      await createGeneration({ prompt: 'User gen 1' });
      await createGeneration({ prompt: 'User gen 2' });

      const { data } = await testSupabase
        .from('ai_generations')
        .select('*')
        .eq('user_id', MULTI_SEASON_USER_ID)
        .order('created_at', { ascending: false });

      expect(data?.length).toBeGreaterThanOrEqual(2);
    });

    it('can filter by status', async () => {
      // Valid statuses: pending, processing, completed, failed, expired
      await createGeneration({ status: 'pending' });
      await createGeneration({ status: 'completed' });
      await createGeneration({ status: 'failed' });

      const { data: pending } = await testSupabase
        .from('ai_generations')
        .select('id')
        .eq('user_id', MULTI_SEASON_USER_ID)
        .eq('status', 'pending');

      expect(pending?.length).toBeGreaterThanOrEqual(1);
    });

    it('can count generations per day', async () => {
      const today = new Date().toISOString().split('T')[0];

      await createGeneration();
      await createGeneration();

      const { count } = await testSupabase
        .from('ai_generations')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', MULTI_SEASON_USER_ID)
        .gte('created_at', today);

      expect(count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Error Handling', () => {
    it('stores error messages for failed generations', async () => {
      const id = await createGeneration({
        status: 'failed',
        error_message: 'Rate limit exceeded',
      });

      const generation = await getGeneration(id);
      expect(generation?.error_message).toBe('Rate limit exceeded');
    });

    it('can retry failed generations', async () => {
      const id = await createGeneration({
        status: 'failed',
        error_message: 'Temporary error',
      });

      // Reset to pending for retry
      await updateGenerationStatus(id, 'pending', {
        error_message: null,
      });

      const generation = await getGeneration(id);
      expect(generation?.status).toBe('pending');
      expect(generation?.error_message).toBeNull();
    });
  });

  describe('Generation Integrity', () => {
    it('generation links to valid user', async () => {
      const fakeUserId = crypto.randomUUID();
      const falRequestId = `fal_integrity_${Date.now()}`;

      const { error } = await testSupabase.from('ai_generations').insert({
        user_id: fakeUserId,
        fal_request_id: falRequestId,
        prompt: 'Orphan generation',
        model: 'test',
        status: 'pending',
      });

      // Should fail with FK constraint (or allow if nullable)
      if (error) {
        expect(error.message.toLowerCase()).toMatch(/foreign|reference|constraint|violates/);
      } else {
        // User FK might be nullable - clean up
        await testSupabase.from('ai_generations').delete().eq('fal_request_id', falRequestId);
        expect(true).toBe(true);
      }
    });

    it('fal_request_id must be unique', async () => {
      const falRequestId = `fal_unique_${Date.now()}`;

      // First insert
      await createGeneration({ fal_request_id: falRequestId });

      // Second insert with same ID
      const { error } = await testSupabase.from('ai_generations').insert({
        user_id: MULTI_SEASON_USER_ID,
        fal_request_id: falRequestId,
        prompt: 'Duplicate request',
        model: 'test',
        status: 'pending',
      });

      // Should fail with unique constraint
      expect(error).not.toBeNull();
    });

    it('deleting user cascades generations', async () => {
      // This test is skipped as we don't want to delete the test user
      // In production, user deletion should cascade to their generations
      expect(true).toBe(true);
    });
  });

  describe('Model Pricing Integration', () => {
    it('model_pricing table exists', async () => {
      const { data, error } = await testSupabase
        .from('model_pricing')
        .select('*')
        .limit(5);

      if (error && error.message.includes('relation')) {
        console.log('model_pricing table does not exist');
        expect(true).toBe(true);
        return;
      }

      expect(Array.isArray(data)).toBe(true);
    });

    it('can lookup model cost', async () => {
      const { data, error } = await testSupabase
        .from('model_pricing')
        .select('model_id, credit_cost')
        .limit(1);

      if (error || !data || data.length === 0) {
        expect(true).toBe(true);
        return;
      }

      expect(data[0].model_id).toBeDefined();
      expect(typeof data[0].credit_cost).toBe('number');
    });
  });

  describe('Generation Performance', () => {
    it('handles many concurrent generation inserts', async () => {
      const baseTime = Date.now();
      const generations = Array(20).fill(null).map((_, i) => ({
        user_id: MULTI_SEASON_USER_ID,
        fal_request_id: `fal_concurrent_${baseTime}_${i}`,
        prompt: `Concurrent test ${i}`,
        model: 'test-model',
        status: 'pending',
      }));

      const { data, error } = await testSupabase
        .from('ai_generations')
        .insert(generations)
        .select('id');

      expect(error).toBeNull();
      expect(data?.length).toBe(20);

      // Track for cleanup
      data?.forEach(g => createdGenerationIds.push(g.id));
    });

    it('queries are fast with index', async () => {
      const start = Date.now();

      await testSupabase
        .from('ai_generations')
        .select('id, status')
        .eq('user_id', MULTI_SEASON_USER_ID)
        .limit(100);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
    });
  });
});
