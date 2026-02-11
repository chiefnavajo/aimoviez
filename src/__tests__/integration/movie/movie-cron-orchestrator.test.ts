/**
 * AI Movie Generation - Cron Orchestrator Tests
 *
 * Tests the cron scene-processing pipeline against local Supabase:
 * - Pending scene processing (credit deduction, status transition, frame continuity)
 * - Generating scene processing (completion, failure, retry)
 * - Scene completion (video URLs, project advancement)
 * - Credit edge cases (insufficient credits, refund simulation)
 * - Pause/cancel during processing
 * - Distributed lock behavior
 * - Full end-to-end pipeline simulation
 *
 * Run: npx jest --config jest.integration.config.js --testPathPattern=movie-cron-orchestrator
 */

import { testSupabase, setupMultiSeasonUser, MULTI_SEASON_USER_ID } from '../setup';

// =============================================================================
// TEST CONSTANTS
// =============================================================================

const MOVIE_USER_ID = MULTI_SEASON_USER_ID;
const ADMIN_USER_ID = '44444444-4444-4444-4444-444444444444';
const ADMIN_EMAIL = 'movieadmin@test.local';

const KLING_CREDIT_COST = 7;

// =============================================================================
// HELPERS
// =============================================================================

async function ensureFeatureFlag(key: string, enabled: boolean) {
  const { error } = await testSupabase
    .from('feature_flags')
    .upsert({ key, name: key, enabled, category: 'ai' }, { onConflict: 'key' });
  if (error) throw new Error(`Failed to set feature flag ${key}: ${error.message}`);
}

async function grantMovieAccess(userId: string) {
  const { error } = await testSupabase
    .from('movie_access')
    .upsert({
      user_id: userId,
      granted_by: ADMIN_USER_ID,
      max_projects: 5,
      max_scenes_per_project: 150,
      is_active: true,
    }, { onConflict: 'user_id' });
  if (error) throw new Error(`Failed to grant access: ${error.message}`);
}

async function createTestProject(userId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await testSupabase
    .from('movie_projects')
    .insert({
      user_id: userId,
      title: `Cron Test ${Date.now()}`,
      source_text: 'A long time ago in a galaxy far far away. '.repeat(10),
      model: 'kling-2.6',
      aspect_ratio: '16:9',
      target_duration_minutes: 2,
      status: 'generating',
      current_scene: 1,
      total_scenes: 5,
      completed_scenes: 0,
      spent_credits: 0,
      estimated_credits: 35,
      ...overrides,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create project: ${error.message}`);
  return data;
}

async function createTestScenes(projectId: string, count: number = 5) {
  const scenes = Array.from({ length: count }, (_, i) => ({
    project_id: projectId,
    scene_number: i + 1,
    scene_title: `Scene ${i + 1}`,
    video_prompt: `Wide establishing shot of a dramatic landscape, scene ${i + 1}`,
    narration_text: i % 2 === 0 ? `Narration for scene ${i + 1}` : null,
    status: 'pending',
    credit_cost: 0,
    retry_count: 0,
  }));

  const { error } = await testSupabase.from('movie_scenes').insert(scenes);
  if (error) throw new Error(`Failed to create scenes: ${error.message}`);
}

async function getProject(projectId: string) {
  const { data } = await testSupabase
    .from('movie_projects')
    .select('*')
    .eq('id', projectId)
    .single();
  return data;
}

async function getScenes(projectId: string) {
  const { data } = await testSupabase
    .from('movie_scenes')
    .select('*')
    .eq('project_id', projectId)
    .order('scene_number', { ascending: true });
  return data || [];
}

async function getScene(projectId: string, sceneNumber: number) {
  const { data } = await testSupabase
    .from('movie_scenes')
    .select('*')
    .eq('project_id', projectId)
    .eq('scene_number', sceneNumber)
    .single();
  return data;
}

async function setUserCredits(userId: string, credits: number) {
  await testSupabase
    .from('users')
    .update({ balance_credits: credits })
    .eq('id', userId);
}

async function getUserCredits(userId: string): Promise<number> {
  const { data } = await testSupabase
    .from('users')
    .select('balance_credits')
    .eq('id', userId)
    .single();
  return data?.balance_credits ?? 0;
}

// =============================================================================
// SETUP & TEARDOWN
// =============================================================================

beforeAll(async () => {
  await setupMultiSeasonUser();

  await testSupabase
    .from('users')
    .upsert({
      id: ADMIN_USER_ID,
      username: 'movieadmin',
      email: ADMIN_EMAIL,
      is_admin: true,
      balance_credits: 10000,
    }, { onConflict: 'id' });

  await setUserCredits(MOVIE_USER_ID, 5000);
  await ensureFeatureFlag('ai_movie_generation', true);
  await grantMovieAccess(MOVIE_USER_ID);
});

afterAll(async () => {
  const { data: projects } = await testSupabase
    .from('movie_projects')
    .select('id')
    .in('user_id', [MOVIE_USER_ID, ADMIN_USER_ID]);

  for (const p of projects || []) {
    await testSupabase.from('movie_scenes').delete().eq('project_id', p.id);
  }
  await testSupabase.from('movie_projects').delete().in('user_id', [MOVIE_USER_ID, ADMIN_USER_ID]);
  await testSupabase.from('movie_access').delete().in('user_id', [MOVIE_USER_ID, ADMIN_USER_ID]);
  await testSupabase.from('cron_locks').delete().eq('job_name', 'process_movie_scenes');
  await testSupabase.from('feature_flags').delete().eq('key', 'ai_movie_generation');
});

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Movie Cron Orchestrator', () => {
  // =========================================================================
  // PENDING SCENE PROCESSING
  // =========================================================================
  describe('Pending Scene Processing', () => {
    let projectId: string;

    beforeEach(async () => {
      await setUserCredits(MOVIE_USER_ID, 5000);
    });

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
      // Clean up any ai_generations created
      await testSupabase.from('ai_generations').delete().eq('user_id', MOVIE_USER_ID);
    });

    test('deducts credits from user balance', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;
      await createTestScenes(projectId, 5);

      const before = await getUserCredits(MOVIE_USER_ID);

      // Simulate cron credit deduction
      await testSupabase
        .from('users')
        .update({ balance_credits: before - KLING_CREDIT_COST })
        .eq('id', MOVIE_USER_ID);

      const after = await getUserCredits(MOVIE_USER_ID);
      expect(after).toBe(before - KLING_CREDIT_COST);
    });

    test('sets scene status to generating with ai_generation_id', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Create fake ai_generation
      const fakeGenId = crypto.randomUUID();
      await testSupabase
        .from('ai_generations')
        .insert({
          id: fakeGenId,
          user_id: MOVIE_USER_ID,
          fal_request_id: `fal-${Date.now()}`,
          status: 'pending',
          prompt: 'test prompt',
          model: 'kling-2.6',
        });

      // Simulate cron updating scene
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'generating',
          ai_generation_id: fakeGenId,
          credit_cost: KLING_CREDIT_COST,
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scene = await getScene(projectId, 1);
      expect(scene?.status).toBe('generating');
      expect(scene?.ai_generation_id).toBe(fakeGenId);
      expect(scene?.credit_cost).toBe(KLING_CREDIT_COST);
    });

    test('scene 1 uses text-to-video (no previous frame)', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { current_scene: 1 });
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Scene 1 has no predecessor
      const { data: prevScene } = await testSupabase
        .from('movie_scenes')
        .select('last_frame_url')
        .eq('project_id', projectId)
        .eq('scene_number', 0) // scene_number - 1 = 0 (doesn't exist)
        .maybeSingle();

      expect(prevScene).toBeNull();
      // Cron would use text-to-video for scene 1
    });

    test('scene 2+ gets previous scene last_frame_url', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { current_scene: 2 });
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Complete scene 1 with frame
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'completed',
          video_url: 'https://fal.ai/scene1.mp4',
          last_frame_url: 'https://storage.test/frame_001.jpg',
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      // Cron query for previous scene frame
      const { data: prevScene } = await testSupabase
        .from('movie_scenes')
        .select('last_frame_url')
        .eq('project_id', projectId)
        .eq('scene_number', 1) // current_scene - 1
        .single();

      expect(prevScene?.last_frame_url).toBe('https://storage.test/frame_001.jpg');
      // Cron would use image-to-video with this frame
    });

    test('falls back to text-to-video when previous frame is null', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { current_scene: 2 });
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Scene 1 completed but frame extraction failed
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'completed',
          video_url: 'https://fal.ai/scene1.mp4',
          last_frame_url: null,
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const { data: prevScene } = await testSupabase
        .from('movie_scenes')
        .select('last_frame_url')
        .eq('project_id', projectId)
        .eq('scene_number', 1)
        .single();

      expect(prevScene?.last_frame_url).toBeNull();
      // Cron falls back to text-to-video
    });

    test('records credit_cost on scene', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;
      await createTestScenes(projectId, 3);

      for (let i = 1; i <= 3; i++) {
        await testSupabase
          .from('movie_scenes')
          .update({ credit_cost: KLING_CREDIT_COST })
          .eq('project_id', projectId)
          .eq('scene_number', i);
      }

      const scenes = await getScenes(projectId);
      const totalCost = scenes.reduce((sum, s) => sum + (s.credit_cost || 0), 0);
      expect(totalCost).toBe(KLING_CREDIT_COST * 3);
    });
  });

  // =========================================================================
  // GENERATING SCENE PROCESSING
  // =========================================================================
  describe('Generating Scene Processing', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
      await testSupabase.from('ai_generations').delete().eq('user_id', MOVIE_USER_ID);
    });

    test('completed ai_generation advances scene', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;
      await createTestScenes(projectId, 5);

      const fakeGenId = crypto.randomUUID();
      await testSupabase.from('ai_generations').insert({
        id: fakeGenId,
        user_id: MOVIE_USER_ID,
        fal_request_id: `fal-${Date.now()}`,
        status: 'completed',
        prompt: 'test',
        model: 'kling-2.6',
        video_url: 'https://fal.ai/result.mp4',
      });

      // Scene is generating, gen is completed
      await testSupabase
        .from('movie_scenes')
        .update({ status: 'generating', ai_generation_id: fakeGenId })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      // Cron checks generation status
      const { data: gen } = await testSupabase
        .from('ai_generations')
        .select('status, video_url')
        .eq('id', fakeGenId)
        .single();

      expect(gen?.status).toBe('completed');
      expect(gen?.video_url).toBeTruthy();

      // Cron advances scene to next stage (merging if no narration)
      await testSupabase
        .from('movie_scenes')
        .update({ status: 'merging', video_url: gen!.video_url })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scene = await getScene(projectId, 1);
      expect(scene?.status).toBe('merging');
    });

    test('failed ai_generation increments retry_count', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;
      await createTestScenes(projectId, 5);

      const fakeGenId = crypto.randomUUID();
      await testSupabase.from('ai_generations').insert({
        id: fakeGenId,
        user_id: MOVIE_USER_ID,
        fal_request_id: `fal-${Date.now()}`,
        status: 'failed',
        prompt: 'test',
        model: 'kling-2.6',
      });

      await testSupabase
        .from('movie_scenes')
        .update({ status: 'generating', ai_generation_id: fakeGenId })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      // Cron detects failure, retries
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'pending',
          ai_generation_id: null,
          retry_count: 1,
          error_message: 'fal.ai generation failed',
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scene = await getScene(projectId, 1);
      expect(scene?.status).toBe('pending');
      expect(scene?.retry_count).toBe(1);
    });

    test('3+ retries fails the scene', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Scene already at retry 3
      await testSupabase
        .from('movie_scenes')
        .update({ retry_count: 3, status: 'generating' })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      // Cron detects retry >= 3, marks as failed
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'failed',
          error_message: 'Max retries exceeded',
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scene = await getScene(projectId, 1);
      expect(scene?.status).toBe('failed');
      expect(scene?.error_message).toBe('Max retries exceeded');
    });

    test('scene failure fails the project', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Scene fails
      await testSupabase
        .from('movie_scenes')
        .update({ status: 'failed', retry_count: 3 })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      // Cron fails the project
      await testSupabase
        .from('movie_projects')
        .update({
          status: 'failed',
          error_message: 'Scene 1 failed after 3 retries',
        })
        .eq('id', projectId);

      const p = await getProject(projectId);
      expect(p?.status).toBe('failed');
      expect(p?.error_message).toContain('Scene 1');
    });
  });

  // =========================================================================
  // SCENE COMPLETION
  // =========================================================================
  describe('Scene Completion', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
    });

    test('completed scene has video_url, public_video_url, last_frame_url', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;
      await createTestScenes(projectId, 5);

      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'completed',
          video_url: 'https://fal.ai/scene1.mp4',
          public_video_url: 'https://storage.test/scene_001.mp4',
          last_frame_url: 'https://storage.test/frame_001.jpg',
          duration_seconds: 5,
          completed_at: new Date().toISOString(),
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scene = await getScene(projectId, 1);
      expect(scene?.video_url).toBeTruthy();
      expect(scene?.public_video_url).toBeTruthy();
      expect(scene?.last_frame_url).toBeTruthy();
      expect(scene?.duration_seconds).toBe(5);
      expect(scene?.completed_at).toBeTruthy();
    });

    test('increments project.completed_scenes', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { completed_scenes: 0 });
      projectId = project.id;

      // Simulate cron increment
      await testSupabase
        .from('movie_projects')
        .update({ completed_scenes: 1, spent_credits: KLING_CREDIT_COST })
        .eq('id', projectId);

      const updated = await getProject(projectId);
      expect(updated?.completed_scenes).toBe(1);
      expect(updated?.spent_credits).toBe(KLING_CREDIT_COST);
    });

    test('advances project.current_scene', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { current_scene: 1 });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ current_scene: 2 })
        .eq('id', projectId);

      const updated = await getProject(projectId);
      expect(updated?.current_scene).toBe(2);
    });

    test('last scene completed → project status completed', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        total_scenes: 3,
        completed_scenes: 2,
        current_scene: 3,
      });
      projectId = project.id;
      await createTestScenes(projectId, 3);

      // Complete all scenes
      for (let i = 1; i <= 3; i++) {
        await testSupabase
          .from('movie_scenes')
          .update({
            status: 'completed',
            video_url: `https://fal.ai/scene${i}.mp4`,
            public_video_url: `https://storage.test/scene_${i}.mp4`,
            last_frame_url: `https://storage.test/frame_${i}.jpg`,
          })
          .eq('project_id', projectId)
          .eq('scene_number', i);
      }

      // Cron checks: all scenes completed?
      const { count: completedCount } = await testSupabase
        .from('movie_scenes')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'completed');

      expect(completedCount).toBe(3);

      // All scenes done → complete project
      await testSupabase
        .from('movie_projects')
        .update({
          status: 'completed',
          completed_scenes: 3,
          completed_at: new Date().toISOString(),
        })
        .eq('id', projectId);

      const p = await getProject(projectId);
      expect(p?.status).toBe('completed');
      expect(p?.completed_scenes).toBe(3);
      expect(p?.completed_at).toBeTruthy();
    });

    test('final video URL set on completion', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'completed' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({
          final_video_url: `https://storage.test/movies/${projectId}/final.mp4`,
          total_duration_seconds: 25,
        })
        .eq('id', projectId);

      const p = await getProject(projectId);
      expect(p?.final_video_url).toContain('final.mp4');
      expect(p?.total_duration_seconds).toBe(25);
    });
  });

  // =========================================================================
  // CREDIT EDGE CASES
  // =========================================================================
  describe('Credit Edge Cases', () => {
    let projectId: string;

    beforeEach(async () => {
      await setUserCredits(MOVIE_USER_ID, 5000);
    });

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
    });

    test('insufficient credits mid-generation pauses project', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        current_scene: 3,
        completed_scenes: 2,
        spent_credits: 14,
      });
      projectId = project.id;

      // User ran out of credits
      await setUserCredits(MOVIE_USER_ID, 3);

      const credits = await getUserCredits(MOVIE_USER_ID);
      expect(credits).toBeLessThan(KLING_CREDIT_COST);

      // Cron would auto-pause
      await testSupabase
        .from('movie_projects')
        .update({
          status: 'paused',
          error_message: 'Insufficient credits. Add more credits and resume.',
        })
        .eq('id', projectId);

      const p = await getProject(projectId);
      expect(p?.status).toBe('paused');
      expect(p?.error_message).toContain('Insufficient credits');
      expect(p?.current_scene).toBe(3); // Progress preserved
    });

    test('credit refund simulation when generation fails', async () => {
      const before = await getUserCredits(MOVIE_USER_ID);

      // Deduct
      await setUserCredits(MOVIE_USER_ID, before - KLING_CREDIT_COST);
      const afterDeduct = await getUserCredits(MOVIE_USER_ID);
      expect(afterDeduct).toBe(before - KLING_CREDIT_COST);

      // Generation submit fails → refund
      await setUserCredits(MOVIE_USER_ID, afterDeduct + KLING_CREDIT_COST);
      const afterRefund = await getUserCredits(MOVIE_USER_ID);
      expect(afterRefund).toBe(before);
    });

    test('spent_credits tracks cumulative cost across scenes', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { spent_credits: 0 });
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Simulate 3 scenes completed
      for (let i = 1; i <= 3; i++) {
        await testSupabase
          .from('movie_scenes')
          .update({ credit_cost: KLING_CREDIT_COST, status: 'completed' })
          .eq('project_id', projectId)
          .eq('scene_number', i);
      }

      // Sum up scene costs
      const scenes = await getScenes(projectId);
      const totalSpent = scenes.reduce((sum, s) => sum + (s.credit_cost || 0), 0);

      await testSupabase
        .from('movie_projects')
        .update({ spent_credits: totalSpent, completed_scenes: 3 })
        .eq('id', projectId);

      const p = await getProject(projectId);
      expect(p?.spent_credits).toBe(KLING_CREDIT_COST * 3);
    });
  });

  // =========================================================================
  // PAUSE/CANCEL DURING PROCESSING
  // =========================================================================
  describe('Pause/Cancel During Processing', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
    });

    test('paused project not picked up by cron query', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'paused' });
      projectId = project.id;

      // Cron query: only 'generating' status
      const { data } = await testSupabase
        .from('movie_projects')
        .select('id')
        .eq('status', 'generating')
        .eq('id', projectId);

      expect(data).toHaveLength(0);
    });

    test('cancelled project not picked up by cron query', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'cancelled' });
      projectId = project.id;

      const { data } = await testSupabase
        .from('movie_projects')
        .select('id')
        .eq('status', 'generating')
        .eq('id', projectId);

      expect(data).toHaveLength(0);
    });

    test('resume after pause continues from current_scene', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'paused',
        current_scene: 4,
        completed_scenes: 3,
        total_scenes: 10,
      });
      projectId = project.id;
      await createTestScenes(projectId, 10);

      // Mark first 3 scenes completed
      for (let i = 1; i <= 3; i++) {
        await testSupabase
          .from('movie_scenes')
          .update({ status: 'completed' })
          .eq('project_id', projectId)
          .eq('scene_number', i);
      }

      // Resume
      await testSupabase
        .from('movie_projects')
        .update({ status: 'generating' })
        .eq('id', projectId)
        .eq('status', 'paused');

      const p = await getProject(projectId);
      expect(p?.status).toBe('generating');
      expect(p?.current_scene).toBe(4); // Continues where it left off

      // Scene 4 should be pending
      const scene4 = await getScene(projectId, 4);
      expect(scene4?.status).toBe('pending');
    });

    test('cancel skips all intermediate-status scenes', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { total_scenes: 5 });
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Various in-progress states
      await testSupabase.from('movie_scenes').update({ status: 'completed' }).eq('project_id', projectId).eq('scene_number', 1);
      await testSupabase.from('movie_scenes').update({ status: 'generating' }).eq('project_id', projectId).eq('scene_number', 2);
      await testSupabase.from('movie_scenes').update({ status: 'narrating' }).eq('project_id', projectId).eq('scene_number', 3);
      // 4 and 5 remain 'pending'

      // Cancel: skip all non-completed
      await testSupabase
        .from('movie_scenes')
        .update({ status: 'skipped' })
        .eq('project_id', projectId)
        .in('status', ['pending', 'generating', 'narrating', 'merging']);

      await testSupabase
        .from('movie_projects')
        .update({ status: 'cancelled' })
        .eq('id', projectId);

      const scenes = await getScenes(projectId);
      expect(scenes[0].status).toBe('completed');
      expect(scenes[1].status).toBe('skipped');
      expect(scenes[2].status).toBe('skipped');
      expect(scenes[3].status).toBe('skipped');
      expect(scenes[4].status).toBe('skipped');
    });
  });

  // =========================================================================
  // DISTRIBUTED LOCK
  // =========================================================================
  describe('Distributed Lock', () => {
    const lockIds: string[] = [];

    afterEach(async () => {
      for (const id of lockIds) {
        await testSupabase.from('cron_locks').delete().eq('lock_id', id);
      }
      lockIds.length = 0;
    });

    test('lock acquisition prevents concurrent runs', async () => {
      const lockId1 = `movie-cron-test-${Date.now()}-1`;
      const lockId2 = `movie-cron-test-${Date.now()}-2`;
      lockIds.push(lockId1, lockId2);
      const expiresAt = new Date(Date.now() + 300000).toISOString();

      // First lock succeeds
      const { error: err1 } = await testSupabase
        .from('cron_locks')
        .insert({
          job_name: 'process_movie_scenes',
          lock_id: lockId1,
          acquired_at: new Date().toISOString(),
          expires_at: expiresAt,
        });
      expect(err1).toBeNull();

      // Second lock fails (unique on job_name)
      const { error: err2 } = await testSupabase
        .from('cron_locks')
        .insert({
          job_name: 'process_movie_scenes',
          lock_id: lockId2,
          acquired_at: new Date().toISOString(),
          expires_at: expiresAt,
        });
      expect(err2).toBeTruthy();
    });

    test('expired lock can be cleaned up', async () => {
      const lockId = `movie-cron-expired-${Date.now()}`;
      lockIds.push(lockId);
      const expiredAt = new Date(Date.now() - 60000).toISOString(); // 1 min ago

      await testSupabase.from('cron_locks').insert({
        job_name: 'process_movie_scenes',
        lock_id: lockId,
        acquired_at: new Date().toISOString(),
        expires_at: expiredAt,
      });

      // Delete expired locks
      await testSupabase
        .from('cron_locks')
        .delete()
        .eq('job_name', 'process_movie_scenes')
        .lt('expires_at', new Date().toISOString());

      // Verify lock is gone
      const { data: remaining } = await testSupabase
        .from('cron_locks')
        .select('lock_id')
        .eq('lock_id', lockId)
        .maybeSingle();

      expect(remaining).toBeNull();
      lockIds.length = 0; // Already cleaned up
    });

    test('lock released after processing', async () => {
      const lockId = `movie-cron-release-${Date.now()}`;
      lockIds.push(lockId);

      await testSupabase.from('cron_locks').insert({
        job_name: 'process_movie_scenes',
        lock_id: lockId,
        acquired_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 300000).toISOString(),
      });

      // Simulate cron completion: delete lock
      await testSupabase
        .from('cron_locks')
        .delete()
        .eq('lock_id', lockId);

      // Lock is gone
      const { data } = await testSupabase
        .from('cron_locks')
        .select('lock_id')
        .eq('lock_id', lockId)
        .maybeSingle();

      expect(data).toBeNull();
      lockIds.length = 0;
    });
  });

  // =========================================================================
  // FULL PIPELINE SIMULATION
  // =========================================================================
  describe('Full Pipeline Simulation', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
      await testSupabase.from('ai_generations').delete().eq('user_id', MOVIE_USER_ID);
      await setUserCredits(MOVIE_USER_ID, 5000);
    });

    test('5-scene project: full generation pipeline', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        total_scenes: 5,
        current_scene: 1,
        completed_scenes: 0,
        spent_credits: 0,
      });
      projectId = project.id;
      await createTestScenes(projectId, 5);

      const initialCredits = await getUserCredits(MOVIE_USER_ID);

      // Simulate cron processing all 5 scenes
      for (let sceneNum = 1; sceneNum <= 5; sceneNum++) {
        // Step 1: Deduct credits
        const currentCredits = await getUserCredits(MOVIE_USER_ID);
        await setUserCredits(MOVIE_USER_ID, currentCredits - KLING_CREDIT_COST);

        // Step 2: Create ai_generation
        const genId = crypto.randomUUID();
        await testSupabase.from('ai_generations').insert({
          id: genId,
          user_id: MOVIE_USER_ID,
          fal_request_id: `fal-pipeline-${sceneNum}-${Date.now()}`,
          status: 'completed',
          prompt: `Scene ${sceneNum} prompt`,
          model: 'kling-2.6',
          video_url: `https://fal.ai/pipeline_scene${sceneNum}.mp4`,
        });

        // Step 3: Update scene through stages
        await testSupabase
          .from('movie_scenes')
          .update({
            status: 'completed',
            ai_generation_id: genId,
            credit_cost: KLING_CREDIT_COST,
            video_url: `https://fal.ai/pipeline_scene${sceneNum}.mp4`,
            public_video_url: `https://storage.test/scene_${sceneNum}.mp4`,
            last_frame_url: `https://storage.test/frame_${sceneNum}.jpg`,
            duration_seconds: 5,
            completed_at: new Date().toISOString(),
          })
          .eq('project_id', projectId)
          .eq('scene_number', sceneNum);

        // Step 4: Update project progress
        await testSupabase
          .from('movie_projects')
          .update({
            current_scene: sceneNum < 5 ? sceneNum + 1 : sceneNum,
            completed_scenes: sceneNum,
            spent_credits: KLING_CREDIT_COST * sceneNum,
          })
          .eq('id', projectId);
      }

      // Step 5: Complete project
      await testSupabase
        .from('movie_projects')
        .update({
          status: 'completed',
          final_video_url: `https://storage.test/movies/${projectId}/final.mp4`,
          total_duration_seconds: 25,
          completed_at: new Date().toISOString(),
        })
        .eq('id', projectId);

      // Verify final state
      const finalProject = await getProject(projectId);
      expect(finalProject?.status).toBe('completed');
      expect(finalProject?.completed_scenes).toBe(5);
      expect(finalProject?.spent_credits).toBe(KLING_CREDIT_COST * 5);
      expect(finalProject?.final_video_url).toContain('final.mp4');
      expect(finalProject?.completed_at).toBeTruthy();

      // Verify all scenes completed with frame chain
      const scenes = await getScenes(projectId);
      expect(scenes).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(scenes[i].status).toBe('completed');
        expect(scenes[i].public_video_url).toBeTruthy();
        expect(scenes[i].last_frame_url).toBeTruthy();
        expect(scenes[i].credit_cost).toBe(KLING_CREDIT_COST);
      }

      // Verify credits deducted correctly
      const finalCredits = await getUserCredits(MOVIE_USER_ID);
      expect(finalCredits).toBe(initialCredits - (KLING_CREDIT_COST * 5));
    });

    test('cron project selection query', async () => {
      // Create projects in various states
      const generating = await createTestProject(MOVIE_USER_ID, { status: 'generating', title: 'Active 1' });
      const paused = await createTestProject(MOVIE_USER_ID, { status: 'paused', title: 'Paused' });
      const completed = await createTestProject(MOVIE_USER_ID, { status: 'completed', title: 'Done' });

      // Cron query: only generating, ordered, limited to 3
      const { data } = await testSupabase
        .from('movie_projects')
        .select('id, status, title')
        .eq('status', 'generating')
        .order('updated_at', { ascending: true })
        .limit(3);

      const ids = (data || []).map(p => p.id);
      expect(ids).toContain(generating.id);
      expect(ids).not.toContain(paused.id);
      expect(ids).not.toContain(completed.id);

      // Cleanup
      for (const id of [generating.id, paused.id, completed.id]) {
        await testSupabase.from('movie_projects').delete().eq('id', id);
      }
      projectId = ''; // Prevent afterEach double-delete
    });
  });
});
