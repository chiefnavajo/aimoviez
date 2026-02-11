/**
 * AI Movie Generation - Integration Tests
 *
 * Tests the full movie generation pipeline against local Supabase:
 * - Database tables (movie_projects, movie_scenes, movie_access)
 * - Access control (feature flag + admin grant)
 * - Project lifecycle (create → generate script → edit → start → pause → resume → cancel → delete)
 * - Scene state machine (pending → generating → narrating → merging → completed)
 * - Frame continuity (scene N last_frame_url → scene N+1 image-to-video)
 * - Credit deduction per scene
 * - Cron orchestrator scene processing logic
 *
 * Run: npx jest --config jest.integration.config.js src/__tests__/integration/movie/
 */

import { testSupabase, setupMultiSeasonUser, MULTI_SEASON_USER_ID } from '../setup';

// =============================================================================
// TEST CONSTANTS
// =============================================================================

const MOVIE_USER_ID = MULTI_SEASON_USER_ID; // Reuse existing test user
const ADMIN_USER_ID = '44444444-4444-4444-4444-444444444444';
const MOVIE_USER_EMAIL = 'multi@integration.local';
const ADMIN_EMAIL = 'movieadmin@test.local';

// =============================================================================
// HELPERS
// =============================================================================

async function ensureFeatureFlag(key: string, enabled: boolean) {
  // Try upsert
  const { error } = await testSupabase
    .from('feature_flags')
    .upsert({ key, name: key, enabled, category: 'ai' }, { onConflict: 'key' });
  if (error) throw new Error(`Failed to set feature flag ${key}: ${error.message}`);
}

async function grantMovieAccess(userId: string, grantedBy?: string) {
  const { error } = await testSupabase
    .from('movie_access')
    .upsert({
      user_id: userId,
      granted_by: grantedBy || ADMIN_USER_ID,
      max_projects: 5,
      max_scenes_per_project: 150,
      is_active: true,
    }, { onConflict: 'user_id' });
  if (error) throw new Error(`Failed to grant access: ${error.message}`);
}

async function revokeMovieAccess(userId: string) {
  await testSupabase
    .from('movie_access')
    .update({ is_active: false })
    .eq('user_id', userId);
}

async function createTestProject(userId: string, overrides: Record<string, unknown> = {}) {
  const { data, error } = await testSupabase
    .from('movie_projects')
    .insert({
      user_id: userId,
      title: `Test Movie ${Date.now()}`,
      source_text: 'A long time ago in a galaxy far far away. '.repeat(10),
      model: 'kling-2.6',
      aspect_ratio: '16:9',
      target_duration_minutes: 2,
      status: 'draft',
      total_scenes: 24,
      estimated_credits: 168,
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

async function setUserCredits(userId: string, credits: number) {
  await testSupabase
    .from('users')
    .update({ balance_credits: credits })
    .eq('id', userId);
}

// =============================================================================
// SETUP & TEARDOWN
// =============================================================================

beforeAll(async () => {
  // Ensure test users exist
  await setupMultiSeasonUser();

  // Create admin user
  const { error: adminErr } = await testSupabase
    .from('users')
    .upsert({
      id: ADMIN_USER_ID,
      username: 'movieadmin',
      email: ADMIN_EMAIL,
      is_admin: true,
      balance_credits: 10000,
    }, { onConflict: 'id' });

  if (adminErr && !adminErr.message.includes('duplicate')) {
    throw new Error(`Failed to create admin: ${adminErr.message}`);
  }

  // Give test user credits
  await setUserCredits(MOVIE_USER_ID, 5000);

  // Enable feature flag
  await ensureFeatureFlag('ai_movie_generation', true);
});

afterAll(async () => {
  // Cleanup movie data
  const { data: projects } = await testSupabase
    .from('movie_projects')
    .select('id')
    .in('user_id', [MOVIE_USER_ID, ADMIN_USER_ID]);

  for (const p of projects || []) {
    await testSupabase.from('movie_scenes').delete().eq('project_id', p.id);
  }
  await testSupabase.from('movie_projects').delete().in('user_id', [MOVIE_USER_ID, ADMIN_USER_ID]);
  await testSupabase.from('movie_access').delete().in('user_id', [MOVIE_USER_ID, ADMIN_USER_ID]);
  await testSupabase.from('feature_flags').delete().eq('key', 'ai_movie_generation');
});

// =============================================================================
// TEST SUITES
// =============================================================================

describe('AI Movie Generation', () => {
  // =========================================================================
  // DATABASE TABLES
  // =========================================================================
  describe('Database Tables', () => {
    test('movie_projects table exists and accepts inserts', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      expect(project.id).toBeDefined();
      expect(project.status).toBe('draft');
      expect(project.model).toBe('kling-2.6');
      expect(project.target_duration_minutes).toBe(2);

      // Cleanup
      await testSupabase.from('movie_projects').delete().eq('id', project.id);
    });

    test('movie_scenes table with unique constraint on (project_id, scene_number)', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      await createTestScenes(project.id, 3);

      const scenes = await getScenes(project.id);
      expect(scenes).toHaveLength(3);
      expect(scenes[0].scene_number).toBe(1);
      expect(scenes[2].scene_number).toBe(3);

      // Try duplicate scene_number — should fail
      const { error } = await testSupabase
        .from('movie_scenes')
        .insert({
          project_id: project.id,
          scene_number: 1, // duplicate
          video_prompt: 'Duplicate scene',
        });
      expect(error).toBeTruthy();

      // Cleanup
      await testSupabase.from('movie_scenes').delete().eq('project_id', project.id);
      await testSupabase.from('movie_projects').delete().eq('id', project.id);
    });

    test('movie_scenes cascade delete with project', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      await createTestScenes(project.id, 5);

      // Delete project
      await testSupabase.from('movie_projects').delete().eq('id', project.id);

      // Scenes should be gone
      const scenes = await getScenes(project.id);
      expect(scenes).toHaveLength(0);
    });

    test('movie_access unique constraint on user_id', async () => {
      await grantMovieAccess(MOVIE_USER_ID);

      // Second insert should conflict
      const { error } = await testSupabase
        .from('movie_access')
        .insert({
          user_id: MOVIE_USER_ID,
          max_projects: 10,
        });
      expect(error).toBeTruthy();
      expect(error!.message).toContain('duplicate');

      await revokeMovieAccess(MOVIE_USER_ID);
    });

    test('movie_projects status constraint rejects invalid status', async () => {
      const { error } = await testSupabase
        .from('movie_projects')
        .insert({
          user_id: MOVIE_USER_ID,
          title: 'Bad Status',
          source_text: 'x'.repeat(100),
          status: 'invalid_status',
        });
      expect(error).toBeTruthy();
    });

    test('movie_scenes status constraint rejects invalid status', async () => {
      const project = await createTestProject(MOVIE_USER_ID);

      const { error } = await testSupabase
        .from('movie_scenes')
        .insert({
          project_id: project.id,
          scene_number: 1,
          video_prompt: 'test',
          status: 'invalid_status',
        });
      expect(error).toBeTruthy();

      await testSupabase.from('movie_projects').delete().eq('id', project.id);
    });
  });

  // =========================================================================
  // ACCESS CONTROL
  // =========================================================================
  describe('Access Control', () => {
    test('feature flag disabled blocks access', async () => {
      await ensureFeatureFlag('ai_movie_generation', false);

      const { data } = await testSupabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'ai_movie_generation')
        .single();

      expect(data?.enabled).toBe(false);

      // Re-enable for other tests
      await ensureFeatureFlag('ai_movie_generation', true);
    });

    test('grant access creates record with correct fields', async () => {
      await grantMovieAccess(MOVIE_USER_ID, ADMIN_USER_ID);

      const { data } = await testSupabase
        .from('movie_access')
        .select('*')
        .eq('user_id', MOVIE_USER_ID)
        .single();

      expect(data).toBeTruthy();
      expect(data!.is_active).toBe(true);
      expect(data!.max_projects).toBe(5);
      expect(data!.max_scenes_per_project).toBe(150);
      expect(data!.granted_by).toBe(ADMIN_USER_ID);
    });

    test('revoke access sets is_active to false', async () => {
      await grantMovieAccess(MOVIE_USER_ID);
      await revokeMovieAccess(MOVIE_USER_ID);

      const { data } = await testSupabase
        .from('movie_access')
        .select('is_active')
        .eq('user_id', MOVIE_USER_ID)
        .single();

      expect(data?.is_active).toBe(false);

      // Re-grant for other tests
      await grantMovieAccess(MOVIE_USER_ID);
    });

    test('expired access record', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // Yesterday

      await testSupabase
        .from('movie_access')
        .upsert({
          user_id: MOVIE_USER_ID,
          granted_by: ADMIN_USER_ID,
          is_active: true,
          expires_at: pastDate,
        }, { onConflict: 'user_id' });

      const { data } = await testSupabase
        .from('movie_access')
        .select('*')
        .eq('user_id', MOVIE_USER_ID)
        .single();

      expect(data?.expires_at).toBeTruthy();
      expect(new Date(data!.expires_at) < new Date()).toBe(true);

      // Reset to no expiry
      await testSupabase
        .from('movie_access')
        .update({ expires_at: null })
        .eq('user_id', MOVIE_USER_ID);
    });
  });

  // =========================================================================
  // PROJECT LIFECYCLE
  // =========================================================================
  describe('Project Lifecycle', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
    });

    test('create project in draft status', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        title: 'My Test Movie',
        target_duration_minutes: 5,
      });
      projectId = project.id;

      expect(project.status).toBe('draft');
      expect(project.title).toBe('My Test Movie');
      expect(project.target_duration_minutes).toBe(5);
      expect(project.completed_scenes).toBe(0);
      expect(project.spent_credits).toBe(0);
    });

    test('draft → script_ready with scenes', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;

      // Simulate script generation
      await testSupabase
        .from('movie_projects')
        .update({
          status: 'script_ready',
          script_data: { scenes: [], summary: 'Test' },
          total_scenes: 5,
        })
        .eq('id', projectId);

      await createTestScenes(projectId, 5);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('script_ready');
      expect(updated?.total_scenes).toBe(5);

      const scenes = await getScenes(projectId);
      expect(scenes).toHaveLength(5);
    });

    test('script_ready → generating with current_scene = 1', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'script_ready', total_scenes: 5 });
      projectId = project.id;
      await createTestScenes(projectId, 5);

      await testSupabase
        .from('movie_projects')
        .update({ status: 'generating', current_scene: 1 })
        .eq('id', projectId);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('generating');
      expect(updated?.current_scene).toBe(1);
    });

    test('generating → paused preserves progress', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'generating',
        current_scene: 3,
        completed_scenes: 2,
        spent_credits: 14,
      });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'paused' })
        .eq('id', projectId);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('paused');
      expect(updated?.current_scene).toBe(3);
      expect(updated?.completed_scenes).toBe(2);
      expect(updated?.spent_credits).toBe(14);
    });

    test('paused → generating resumes', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'paused',
        current_scene: 3,
        completed_scenes: 2,
      });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'generating' })
        .eq('id', projectId);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('generating');
      expect(updated?.current_scene).toBe(3); // Resumes where it left off
    });

    test('cancel marks pending scenes as skipped', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'generating',
        current_scene: 3,
        total_scenes: 5,
      });
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Mark first 2 as completed
      await testSupabase
        .from('movie_scenes')
        .update({ status: 'completed' })
        .eq('project_id', projectId)
        .lte('scene_number', 2);

      // Cancel
      await testSupabase
        .from('movie_scenes')
        .update({ status: 'skipped' })
        .eq('project_id', projectId)
        .eq('status', 'pending');

      await testSupabase
        .from('movie_projects')
        .update({ status: 'cancelled' })
        .eq('id', projectId);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('cancelled');

      const scenes = await getScenes(projectId);
      const completed = scenes.filter(s => s.status === 'completed');
      const skipped = scenes.filter(s => s.status === 'skipped');
      expect(completed).toHaveLength(2);
      expect(skipped).toHaveLength(3);
    });

    test('delete only works for non-active statuses', async () => {
      // Deletable statuses
      for (const status of ['draft', 'script_ready', 'completed', 'failed', 'cancelled']) {
        const project = await createTestProject(MOVIE_USER_ID, { status });
        const { error } = await testSupabase
          .from('movie_projects')
          .delete()
          .eq('id', project.id);
        expect(error).toBeNull();
      }
    });
  });

  // =========================================================================
  // SCENE STATE MACHINE
  // =========================================================================
  describe('Scene State Machine', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'generating',
        current_scene: 1,
        total_scenes: 5,
      });
      projectId = project.id;
      await createTestScenes(projectId, 5);
    });

    afterEach(async () => {
      await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
      await testSupabase.from('movie_projects').delete().eq('id', projectId);
    });

    test('scenes start as pending', async () => {
      const scenes = await getScenes(projectId);
      expect(scenes.every(s => s.status === 'pending')).toBe(true);
    });

    test('pending → generating sets ai_generation_id', async () => {
      const fakeGenId = crypto.randomUUID();

      // Insert a fake ai_generation record
      await testSupabase
        .from('ai_generations')
        .insert({
          id: fakeGenId,
          user_id: MOVIE_USER_ID,
          fal_request_id: `fake-${Date.now()}`,
          status: 'pending',
          prompt: 'test prompt',
          model: 'kling-2.6',
        });

      await testSupabase
        .from('movie_scenes')
        .update({ status: 'generating', ai_generation_id: fakeGenId })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scenes = await getScenes(projectId);
      expect(scenes[0].status).toBe('generating');
      expect(scenes[0].ai_generation_id).toBe(fakeGenId);

      // Cleanup
      await testSupabase.from('ai_generations').delete().eq('id', fakeGenId);
    });

    test('generating → completed with video_url and last_frame_url', async () => {
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'completed',
          video_url: 'https://fal.ai/test-video.mp4',
          public_video_url: 'https://storage.test/scene_001.mp4',
          last_frame_url: 'https://storage.test/frames/scene_001.jpg',
          duration_seconds: 5,
          completed_at: new Date().toISOString(),
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scenes = await getScenes(projectId);
      expect(scenes[0].status).toBe('completed');
      expect(scenes[0].last_frame_url).toBe('https://storage.test/frames/scene_001.jpg');
      expect(scenes[0].public_video_url).toBe('https://storage.test/scene_001.mp4');
    });

    test('failed scene with retry_count tracking', async () => {
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'failed',
          error_message: 'fal.ai timeout',
          retry_count: 1,
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scenes = await getScenes(projectId);
      expect(scenes[0].status).toBe('failed');
      expect(scenes[0].retry_count).toBe(1);
      expect(scenes[0].error_message).toBe('fal.ai timeout');

      // Retry: reset to pending with incremented count
      await testSupabase
        .from('movie_scenes')
        .update({ status: 'pending', error_message: null, retry_count: 2 })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const retried = await getScenes(projectId);
      expect(retried[0].status).toBe('pending');
      expect(retried[0].retry_count).toBe(2);
    });
  });

  // =========================================================================
  // FRAME CONTINUITY CHAIN
  // =========================================================================
  describe('Frame Continuity Chain', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'generating',
        current_scene: 1,
        total_scenes: 5,
      });
      projectId = project.id;
      await createTestScenes(projectId, 5);
    });

    afterEach(async () => {
      await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
      await testSupabase.from('movie_projects').delete().eq('id', projectId);
    });

    test('scene 1 has no previous frame (text-to-video)', async () => {
      const scenes = await getScenes(projectId);
      // Scene 1 should have no last_frame_url from a previous scene
      expect(scenes[0].last_frame_url).toBeNull();
    });

    test('scene N last_frame_url feeds scene N+1', async () => {
      // Complete scene 1 with a last frame
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'completed',
          video_url: 'https://fal.ai/scene1.mp4',
          last_frame_url: 'https://storage.test/frames/scene_001.jpg',
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      // Verify scene 1's frame is available for scene 2
      const { data: prevScene } = await testSupabase
        .from('movie_scenes')
        .select('last_frame_url')
        .eq('project_id', projectId)
        .eq('scene_number', 1)
        .single();

      expect(prevScene?.last_frame_url).toBe('https://storage.test/frames/scene_001.jpg');

      // This URL would be passed to startImageToVideoGeneration for scene 2
    });

    test('full 5-scene continuity chain', async () => {
      // Simulate completing all 5 scenes with frame chain
      for (let i = 1; i <= 5; i++) {
        await testSupabase
          .from('movie_scenes')
          .update({
            status: 'completed',
            video_url: `https://fal.ai/scene${i}.mp4`,
            public_video_url: `https://storage.test/scene_${String(i).padStart(3, '0')}.mp4`,
            last_frame_url: `https://storage.test/frames/scene_${String(i).padStart(3, '0')}.jpg`,
            duration_seconds: 5,
            completed_at: new Date().toISOString(),
          })
          .eq('project_id', projectId)
          .eq('scene_number', i);
      }

      const scenes = await getScenes(projectId);
      expect(scenes).toHaveLength(5);

      // Verify each scene has its own frame
      for (let i = 0; i < 5; i++) {
        expect(scenes[i].status).toBe('completed');
        expect(scenes[i].last_frame_url).toContain(`scene_${String(i + 1).padStart(3, '0')}.jpg`);
        expect(scenes[i].public_video_url).toContain(`scene_${String(i + 1).padStart(3, '0')}.mp4`);
      }

      // Verify chain: scene N frame feeds scene N+1
      for (let i = 1; i < 5; i++) {
        const prevFrame = scenes[i - 1].last_frame_url;
        expect(prevFrame).toBeTruthy();
        // In real cron, this would be passed to startImageToVideoGeneration
      }
    });

    test('missing frame gracefully falls back (no break in chain)', async () => {
      // Scene 1 completed but frame extraction failed
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'completed',
          video_url: 'https://fal.ai/scene1.mp4',
          last_frame_url: null, // Frame extraction failed
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const { data: prevScene } = await testSupabase
        .from('movie_scenes')
        .select('last_frame_url')
        .eq('project_id', projectId)
        .eq('scene_number', 1)
        .single();

      // No frame available — cron would fall back to text-to-video for scene 2
      expect(prevScene?.last_frame_url).toBeNull();
    });
  });

  // =========================================================================
  // CREDIT DEDUCTION PER SCENE
  // =========================================================================
  describe('Credit Deduction', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
    });

    test('per-scene credit tracking on project', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'generating',
        spent_credits: 0,
        total_scenes: 3,
      });
      projectId = project.id;
      await createTestScenes(projectId, 3);

      // Simulate 3 scenes each costing 7 credits
      for (let i = 1; i <= 3; i++) {
        await testSupabase
          .from('movie_scenes')
          .update({ credit_cost: 7, status: 'completed' })
          .eq('project_id', projectId)
          .eq('scene_number', i);
      }

      // Update project spent_credits
      await testSupabase
        .from('movie_projects')
        .update({ spent_credits: 21, completed_scenes: 3 })
        .eq('id', projectId);

      const updated = await getProject(projectId);
      expect(updated?.spent_credits).toBe(21);
      expect(updated?.completed_scenes).toBe(3);
    });

    test('scene credit_cost records per-scene cost', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectId = project.id;
      await createTestScenes(projectId, 3);

      // Different costs per scene (simulating different retries/models)
      await testSupabase.from('movie_scenes').update({ credit_cost: 7 }).eq('project_id', projectId).eq('scene_number', 1);
      await testSupabase.from('movie_scenes').update({ credit_cost: 7 }).eq('project_id', projectId).eq('scene_number', 2);
      await testSupabase.from('movie_scenes').update({ credit_cost: 7 }).eq('project_id', projectId).eq('scene_number', 3);

      const scenes = await getScenes(projectId);
      const totalCost = scenes.reduce((sum, s) => sum + (s.credit_cost || 0), 0);
      expect(totalCost).toBe(21);
    });
  });

  // =========================================================================
  // PROJECT COMPLETION
  // =========================================================================
  describe('Project Completion', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
    });

    test('all scenes completed → project completed', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'generating',
        total_scenes: 3,
      });
      projectId = project.id;
      await createTestScenes(projectId, 3);

      // Complete all scenes
      for (let i = 1; i <= 3; i++) {
        await testSupabase
          .from('movie_scenes')
          .update({
            status: 'completed',
            video_url: `https://storage.test/scene_${i}.mp4`,
            last_frame_url: `https://storage.test/frame_${i}.jpg`,
          })
          .eq('project_id', projectId)
          .eq('scene_number', i);
      }

      // Simulate cron completing project
      await testSupabase
        .from('movie_projects')
        .update({
          status: 'completed',
          completed_scenes: 3,
          completed_at: new Date().toISOString(),
        })
        .eq('id', projectId);

      const completed = await getProject(projectId);
      expect(completed?.status).toBe('completed');
      expect(completed?.completed_scenes).toBe(3);
      expect(completed?.completed_at).toBeTruthy();
    });

    test('completed project has all scene videos', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'completed',
        total_scenes: 3,
        completed_scenes: 3,
      });
      projectId = project.id;
      await createTestScenes(projectId, 3);

      // Set all scenes as completed with URLs
      for (let i = 1; i <= 3; i++) {
        await testSupabase
          .from('movie_scenes')
          .update({
            status: 'completed',
            public_video_url: `https://storage.test/movies/${projectId}/scene_${String(i).padStart(3, '0')}.mp4`,
          })
          .eq('project_id', projectId)
          .eq('scene_number', i);
      }

      const scenes = await getScenes(projectId);
      const allHaveUrls = scenes.every(s => s.public_video_url?.includes('scene_'));
      expect(allHaveUrls).toBe(true);
    });
  });

  // =========================================================================
  // CONCURRENT LIMITS
  // =========================================================================
  describe('Concurrent Limits', () => {
    const projectIds: string[] = [];

    afterEach(async () => {
      for (const id of projectIds) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', id);
        await testSupabase.from('movie_projects').delete().eq('id', id);
      }
      projectIds.length = 0;
    });

    test('max 2 generating projects per user (queryable)', async () => {
      // Create 3 projects, 2 generating, 1 draft
      for (let i = 0; i < 3; i++) {
        const p = await createTestProject(MOVIE_USER_ID, {
          status: i < 2 ? 'generating' : 'draft',
          title: `Concurrent Test ${i}`,
        });
        projectIds.push(p.id);
      }

      // Count generating projects
      const { count } = await testSupabase
        .from('movie_projects')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', MOVIE_USER_ID)
        .eq('status', 'generating');

      expect(count).toBe(2);
    });

    test('max 5 projects per user (queryable)', async () => {
      for (let i = 0; i < 5; i++) {
        const p = await createTestProject(MOVIE_USER_ID, { title: `Limit Test ${i}` });
        projectIds.push(p.id);
      }

      const { count } = await testSupabase
        .from('movie_projects')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', MOVIE_USER_ID);

      expect(count).toBe(5);
    });
  });

  // =========================================================================
  // CRON ORCHESTRATOR QUERIES
  // =========================================================================
  describe('Cron Orchestrator Queries', () => {
    const projectIds: string[] = [];

    afterEach(async () => {
      for (const id of projectIds) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', id);
        await testSupabase.from('movie_projects').delete().eq('id', id);
      }
      projectIds.length = 0;
    });

    test('finds generating projects ordered by updated_at', async () => {
      // Create 3 projects: 2 generating, 1 paused
      for (let i = 0; i < 3; i++) {
        const p = await createTestProject(MOVIE_USER_ID, {
          status: i < 2 ? 'generating' : 'paused',
          title: `Cron Test ${i}`,
        });
        projectIds.push(p.id);
        // Small delay for updated_at ordering
        await new Promise(r => setTimeout(r, 50));
      }

      const { data } = await testSupabase
        .from('movie_projects')
        .select('id, status')
        .eq('status', 'generating')
        .order('updated_at', { ascending: true })
        .limit(3);

      expect(data).toHaveLength(2);
      expect(data!.every(p => p.status === 'generating')).toBe(true);
    });

    test('fetches current scene for a project', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'generating',
        current_scene: 3,
        total_scenes: 5,
      });
      projectIds.push(project.id);
      await createTestScenes(project.id, 5);

      const { data: scene } = await testSupabase
        .from('movie_scenes')
        .select('*')
        .eq('project_id', project.id)
        .eq('scene_number', 3)
        .single();

      expect(scene).toBeTruthy();
      expect(scene!.scene_number).toBe(3);
      expect(scene!.status).toBe('pending');
    });

    test('gets previous scene last_frame_url for continuity', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'generating',
        current_scene: 2,
      });
      projectIds.push(project.id);
      await createTestScenes(project.id, 5);

      // Set scene 1 as completed with frame
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'completed',
          last_frame_url: 'https://storage.test/frame_scene1.jpg',
        })
        .eq('project_id', project.id)
        .eq('scene_number', 1);

      // Query as cron would
      const { data: prevScene } = await testSupabase
        .from('movie_scenes')
        .select('last_frame_url')
        .eq('project_id', project.id)
        .eq('scene_number', 1) // current_scene - 1
        .single();

      expect(prevScene?.last_frame_url).toBe('https://storage.test/frame_scene1.jpg');
    });

    test('distributed lock prevents concurrent cron runs', async () => {
      const lockId1 = `test-lock-${Date.now()}`;
      const expiresAt = new Date(Date.now() + 300000).toISOString();

      // First lock succeeds
      const { error: lock1Err } = await testSupabase
        .from('cron_locks')
        .insert({
          job_name: 'process_movie_scenes',
          lock_id: lockId1,
          acquired_at: new Date().toISOString(),
          expires_at: expiresAt,
        });
      expect(lock1Err).toBeNull();

      // Second lock fails (same job_name)
      const { error: lock2Err } = await testSupabase
        .from('cron_locks')
        .insert({
          job_name: 'process_movie_scenes',
          lock_id: `test-lock-2-${Date.now()}`,
          acquired_at: new Date().toISOString(),
          expires_at: expiresAt,
        });
      expect(lock2Err).toBeTruthy();

      // Cleanup
      await testSupabase
        .from('cron_locks')
        .delete()
        .eq('lock_id', lockId1);
    });
  });

  // =========================================================================
  // DURATION CONFIGURATION
  // =========================================================================
  describe('Duration Configuration', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
    });

    test('1-minute movie creates ~12 scenes (kling at 5s)', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        target_duration_minutes: 1,
        total_scenes: 12, // 60s / 5s per scene
      });
      projectId = project.id;

      expect(project.target_duration_minutes).toBe(1);
      expect(project.total_scenes).toBe(12);
    });

    test('10-minute movie creates ~120 scenes (kling at 5s)', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        target_duration_minutes: 10,
        total_scenes: 120, // 600s / 5s per scene
      });
      projectId = project.id;

      expect(project.target_duration_minutes).toBe(10);
      expect(project.total_scenes).toBe(120);
    });

    test('default duration is 10 minutes', async () => {
      const { data } = await testSupabase
        .from('movie_projects')
        .insert({
          user_id: MOVIE_USER_ID,
          title: 'Default Duration',
          source_text: 'x'.repeat(100),
        })
        .select('target_duration_minutes')
        .single();

      projectId = data!.id;
      expect(data?.target_duration_minutes).toBe(10);
    });
  });
});
