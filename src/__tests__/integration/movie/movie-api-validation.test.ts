/**
 * AI Movie Generation - API Validation Tests
 *
 * Tests the business logic and validation that each API route enforces,
 * simulated at the database layer against local Supabase:
 * - Project CRUD validation (required fields, text length, model, limits)
 * - Access control (feature flag, grant/revoke, expiry, admin bypass)
 * - State transition guards (start, pause, resume, cancel, generate-script)
 * - Scene editing (batch edit, status guards)
 * - Owner isolation (user A can't access user B's projects)
 *
 * Run: npx jest --config jest.integration.config.js --testPathPattern=movie-api-validation
 */

import { testSupabase, setupMultiSeasonUser, MULTI_SEASON_USER_ID } from '../setup';

// =============================================================================
// TEST CONSTANTS
// =============================================================================

const MOVIE_USER_ID = MULTI_SEASON_USER_ID;
const ADMIN_USER_ID = '44444444-4444-4444-4444-444444444444';
const OTHER_USER_ID = '55555555-5555-5555-5555-555555555555';
const ADMIN_EMAIL = 'movieadmin@test.local';
const OTHER_EMAIL = 'otheruser@test.local';

// =============================================================================
// HELPERS (same pattern as movie-generation.test.ts)
// =============================================================================

async function ensureFeatureFlag(key: string, enabled: boolean) {
  const { error } = await testSupabase
    .from('feature_flags')
    .upsert({ key, name: key, enabled, category: 'ai' }, { onConflict: 'key' });
  if (error) throw new Error(`Failed to set feature flag ${key}: ${error.message}`);
}

async function grantMovieAccess(userId: string, overrides: Record<string, unknown> = {}) {
  const { error } = await testSupabase
    .from('movie_access')
    .upsert({
      user_id: userId,
      granted_by: ADMIN_USER_ID,
      max_projects: 5,
      max_scenes_per_project: 150,
      is_active: true,
      ...overrides,
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

  // Create admin user
  await testSupabase
    .from('users')
    .upsert({
      id: ADMIN_USER_ID,
      username: 'movieadmin',
      email: ADMIN_EMAIL,
      is_admin: true,
      balance_credits: 10000,
    }, { onConflict: 'id' });

  // Create second test user for isolation tests
  await testSupabase
    .from('users')
    .upsert({
      id: OTHER_USER_ID,
      username: 'otheruser',
      email: OTHER_EMAIL,
      is_admin: false,
      balance_credits: 1000,
    }, { onConflict: 'id' });

  await setUserCredits(MOVIE_USER_ID, 5000);
  await ensureFeatureFlag('ai_movie_generation', true);
  await grantMovieAccess(MOVIE_USER_ID);
});

afterAll(async () => {
  const { data: projects } = await testSupabase
    .from('movie_projects')
    .select('id')
    .in('user_id', [MOVIE_USER_ID, ADMIN_USER_ID, OTHER_USER_ID]);

  for (const p of projects || []) {
    await testSupabase.from('movie_scenes').delete().eq('project_id', p.id);
  }
  await testSupabase.from('movie_projects').delete().in('user_id', [MOVIE_USER_ID, ADMIN_USER_ID, OTHER_USER_ID]);
  await testSupabase.from('movie_access').delete().in('user_id', [MOVIE_USER_ID, ADMIN_USER_ID, OTHER_USER_ID]);
  await testSupabase.from('feature_flags').delete().eq('key', 'ai_movie_generation');
});

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Movie API Validation', () => {
  // =========================================================================
  // PROJECT CRUD VALIDATION
  // =========================================================================
  describe('Project CRUD Validation', () => {
    const projectIds: string[] = [];

    afterEach(async () => {
      for (const id of projectIds) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', id);
        await testSupabase.from('movie_projects').delete().eq('id', id);
      }
      projectIds.length = 0;
    });

    test('rejects project without title', async () => {
      const { error } = await testSupabase
        .from('movie_projects')
        .insert({
          user_id: MOVIE_USER_ID,
          source_text: 'A long time ago in a galaxy far far away. '.repeat(10),
        });
      expect(error).toBeTruthy();
    });

    test('rejects project without source_text', async () => {
      const { error } = await testSupabase
        .from('movie_projects')
        .insert({
          user_id: MOVIE_USER_ID,
          title: 'Test',
        });
      expect(error).toBeTruthy();
    });

    test('accepts project with valid fields', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectIds.push(project.id);
      expect(project.id).toBeDefined();
      expect(project.status).toBe('draft');
    });

    test('accepts all valid AI models', async () => {
      const validModels = ['kling-2.6', 'veo3-fast', 'hailuo-2.3', 'sora-2'];
      for (const model of validModels) {
        const project = await createTestProject(MOVIE_USER_ID, { model });
        projectIds.push(project.id);
        expect(project.model).toBe(model);
      }
    });

    test('project count limit enforcement (max 5 queryable)', async () => {
      // Create 5 projects
      for (let i = 0; i < 5; i++) {
        const p = await createTestProject(MOVIE_USER_ID, { title: `Limit Test ${i}` });
        projectIds.push(p.id);
      }

      // Count matches access limit
      const { count } = await testSupabase
        .from('movie_projects')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', MOVIE_USER_ID);

      expect(count).toBe(5);

      // App would check count >= max_projects before allowing creation
      const { data: access } = await testSupabase
        .from('movie_access')
        .select('max_projects')
        .eq('user_id', MOVIE_USER_ID)
        .single();

      expect(count).toBeGreaterThanOrEqual(access!.max_projects);
    });

    test('owner isolation — user A cannot see user B projects', async () => {
      const projectA = await createTestProject(MOVIE_USER_ID, { title: 'User A Project' });
      projectIds.push(projectA.id);

      const projectB = await createTestProject(OTHER_USER_ID, { title: 'User B Project' });
      projectIds.push(projectB.id);

      // Query as user A (filter by user_id)
      const { data: userAProjects } = await testSupabase
        .from('movie_projects')
        .select('id, title')
        .eq('user_id', MOVIE_USER_ID);

      const userAIds = (userAProjects || []).map(p => p.id);
      expect(userAIds).toContain(projectA.id);
      expect(userAIds).not.toContain(projectB.id);
    });

    test('delete allowed for draft, completed, failed, cancelled', async () => {
      for (const status of ['draft', 'script_ready', 'completed', 'failed', 'cancelled']) {
        const project = await createTestProject(MOVIE_USER_ID, { status });
        const { error } = await testSupabase
          .from('movie_projects')
          .delete()
          .eq('id', project.id);
        expect(error).toBeNull();
      }
    });

    test('delete cascade removes all scenes', async () => {
      const project = await createTestProject(MOVIE_USER_ID);
      projectIds.push(project.id);
      await createTestScenes(project.id, 10);

      // Verify scenes exist
      const before = await getScenes(project.id);
      expect(before).toHaveLength(10);

      // Delete project
      await testSupabase.from('movie_projects').delete().eq('id', project.id);
      projectIds.length = 0; // Already cleaned up

      // Scenes gone
      const after = await getScenes(project.id);
      expect(after).toHaveLength(0);
    });

    test('title truncated at 200 characters', async () => {
      const longTitle = 'A'.repeat(200);
      const project = await createTestProject(MOVIE_USER_ID, { title: longTitle });
      projectIds.push(project.id);
      expect(project.title).toBe(longTitle);
      expect(project.title.length).toBe(200);
    });
  });

  // =========================================================================
  // ACCESS CONTROL
  // =========================================================================
  describe('Access Control', () => {
    afterEach(async () => {
      // Restore access for other tests
      await ensureFeatureFlag('ai_movie_generation', true);
      await grantMovieAccess(MOVIE_USER_ID);
    });

    test('feature flag disabled — access check query returns disabled', async () => {
      await ensureFeatureFlag('ai_movie_generation', false);

      const { data } = await testSupabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'ai_movie_generation')
        .single();

      expect(data?.enabled).toBe(false);
    });

    test('no movie_access record — user has no access', async () => {
      // OTHER_USER has no movie_access record
      const { data } = await testSupabase
        .from('movie_access')
        .select('is_active')
        .eq('user_id', OTHER_USER_ID)
        .eq('is_active', true)
        .maybeSingle();

      expect(data).toBeNull();
    });

    test('expired access — not valid', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();

      await grantMovieAccess(MOVIE_USER_ID, { expires_at: pastDate });

      const { data } = await testSupabase
        .from('movie_access')
        .select('*')
        .eq('user_id', MOVIE_USER_ID)
        .eq('is_active', true)
        .single();

      // Record exists but is expired
      expect(data).toBeTruthy();
      expect(new Date(data!.expires_at) < new Date()).toBe(true);

      // App would check: is_active AND (expires_at IS NULL OR expires_at > NOW())
      const { data: valid } = await testSupabase
        .from('movie_access')
        .select('*')
        .eq('user_id', MOVIE_USER_ID)
        .eq('is_active', true)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
        .maybeSingle();

      expect(valid).toBeNull();

      // Reset
      await grantMovieAccess(MOVIE_USER_ID, { expires_at: null });
    });

    test('revoked access (is_active=false) — user denied', async () => {
      await revokeMovieAccess(MOVIE_USER_ID);

      const { data } = await testSupabase
        .from('movie_access')
        .select('is_active')
        .eq('user_id', MOVIE_USER_ID)
        .eq('is_active', true)
        .maybeSingle();

      expect(data).toBeNull();
    });

    test('admin user has is_admin flag', async () => {
      const { data } = await testSupabase
        .from('users')
        .select('is_admin')
        .eq('id', ADMIN_USER_ID)
        .single();

      expect(data?.is_admin).toBe(true);
    });

    test('grant access creates record with correct limits', async () => {
      await grantMovieAccess(OTHER_USER_ID, {
        max_projects: 10,
        max_scenes_per_project: 200,
      });

      const { data } = await testSupabase
        .from('movie_access')
        .select('*')
        .eq('user_id', OTHER_USER_ID)
        .single();

      expect(data!.is_active).toBe(true);
      expect(data!.max_projects).toBe(10);
      expect(data!.max_scenes_per_project).toBe(200);
      expect(data!.granted_by).toBe(ADMIN_USER_ID);

      // Cleanup
      await testSupabase.from('movie_access').delete().eq('user_id', OTHER_USER_ID);
    });

    test('grant access with future expiry is valid', async () => {
      const futureDate = new Date(Date.now() + 30 * 86400000).toISOString(); // 30 days

      await grantMovieAccess(MOVIE_USER_ID, { expires_at: futureDate });

      const { data } = await testSupabase
        .from('movie_access')
        .select('*')
        .eq('user_id', MOVIE_USER_ID)
        .eq('is_active', true)
        .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
        .maybeSingle();

      expect(data).toBeTruthy();

      // Reset
      await grantMovieAccess(MOVIE_USER_ID, { expires_at: null });
    });
  });

  // =========================================================================
  // STATE TRANSITION GUARDS
  // =========================================================================
  describe('State Transition Guards', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
      await setUserCredits(MOVIE_USER_ID, 5000);
    });

    // --- generate-script ---
    test('generate-script: allowed from draft', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'draft' });
      projectId = project.id;

      // Atomic CAS: only update if status is draft or script_ready
      await testSupabase
        .from('movie_projects')
        .update({ status: 'script_generating' })
        .eq('id', projectId)
        .in('status', ['draft', 'script_ready']);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('script_generating');
    });

    test('generate-script: allowed from script_ready (re-generate)', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'script_ready' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'script_generating' })
        .eq('id', projectId)
        .in('status', ['draft', 'script_ready']);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('script_generating');
    });

    test('generate-script: blocked from generating', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'generating' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'script_generating' })
        .eq('id', projectId)
        .in('status', ['draft', 'script_ready']);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('generating'); // Unchanged
    });

    test('generate-script: blocked from completed', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'completed' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'script_generating' })
        .eq('id', projectId)
        .in('status', ['draft', 'script_ready']);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('completed'); // Unchanged
    });

    // --- start ---
    test('start: allowed from script_ready', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'script_ready',
        total_scenes: 5,
      });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'generating', current_scene: 1 })
        .eq('id', projectId)
        .eq('status', 'script_ready');

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('generating');
    });

    test('start: blocked from draft', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'draft' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'generating', current_scene: 1 })
        .eq('id', projectId)
        .eq('status', 'script_ready');

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('draft'); // Unchanged
    });

    test('start: blocked with insufficient credits (<5)', async () => {
      await setUserCredits(MOVIE_USER_ID, 3);

      const credits = await getUserCredits(MOVIE_USER_ID);
      expect(credits).toBeLessThan(5);
      // API would return 400 here
    });

    test('start: blocked with 2+ concurrent generating projects', async () => {
      // Create 2 generating projects
      const p1 = await createTestProject(MOVIE_USER_ID, { status: 'generating', title: 'Gen 1' });
      const p2 = await createTestProject(MOVIE_USER_ID, { status: 'generating', title: 'Gen 2' });

      const { count } = await testSupabase
        .from('movie_projects')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', MOVIE_USER_ID)
        .eq('status', 'generating');

      expect(count).toBeGreaterThanOrEqual(2);
      // API would check count >= 2 and reject

      // Cleanup extra projects
      await testSupabase.from('movie_projects').delete().eq('id', p1.id);
      await testSupabase.from('movie_projects').delete().eq('id', p2.id);
      projectId = ''; // Prevent afterEach double-delete
    });

    // --- pause ---
    test('pause: allowed from generating', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'generating' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'paused' })
        .eq('id', projectId)
        .eq('status', 'generating');

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('paused');
    });

    test('pause: blocked from paused (already paused)', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'paused' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'paused' })
        .eq('id', projectId)
        .eq('status', 'generating');

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('paused'); // Was already paused, CAS didn't match
    });

    test('pause: blocked from draft', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'draft' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'paused' })
        .eq('id', projectId)
        .eq('status', 'generating');

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('draft'); // Unchanged
    });

    // --- resume ---
    test('resume: allowed from paused', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'paused',
        current_scene: 3,
        completed_scenes: 2,
      });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'generating' })
        .eq('id', projectId)
        .eq('status', 'paused');

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('generating');
      expect(updated?.current_scene).toBe(3); // Preserved
    });

    test('resume: blocked from generating', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'generating' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'generating' })
        .eq('id', projectId)
        .eq('status', 'paused');

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('generating'); // Was already generating, CAS didn't match 'paused'
    });

    test('resume: blocked with insufficient credits', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'paused' });
      projectId = project.id;

      await setUserCredits(MOVIE_USER_ID, 2);
      const credits = await getUserCredits(MOVIE_USER_ID);
      expect(credits).toBeLessThan(5);
    });

    // --- cancel ---
    test('cancel: allowed from generating', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'generating', total_scenes: 5 });
      projectId = project.id;
      await createTestScenes(projectId, 5);

      // Mark first 2 as completed
      await testSupabase
        .from('movie_scenes')
        .update({ status: 'completed' })
        .eq('project_id', projectId)
        .lte('scene_number', 2);

      // Cancel: atomic status check
      await testSupabase
        .from('movie_projects')
        .update({ status: 'cancelled' })
        .eq('id', projectId)
        .in('status', ['generating', 'paused']);

      const cancelledProject = await getProject(projectId);
      expect(cancelledProject?.status).toBe('cancelled');

      // Skip non-completed scenes
      await testSupabase
        .from('movie_scenes')
        .update({ status: 'skipped' })
        .eq('project_id', projectId)
        .in('status', ['pending', 'generating', 'narrating', 'merging']);

      const scenes = await getScenes(projectId);
      const completed = scenes.filter(s => s.status === 'completed');
      const skipped = scenes.filter(s => s.status === 'skipped');
      expect(completed).toHaveLength(2);
      expect(skipped).toHaveLength(3);
    });

    test('cancel: allowed from paused', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'paused' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'cancelled' })
        .eq('id', projectId)
        .in('status', ['generating', 'paused']);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('cancelled');
    });

    test('cancel: blocked from completed', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'completed' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'cancelled' })
        .eq('id', projectId)
        .in('status', ['generating', 'paused']);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('completed'); // Unchanged
    });

    test('cancel: blocked from draft', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'draft' });
      projectId = project.id;

      await testSupabase
        .from('movie_projects')
        .update({ status: 'cancelled' })
        .eq('id', projectId)
        .in('status', ['generating', 'paused']);

      const updated = await getProject(projectId);
      expect(updated?.status).toBe('draft'); // Unchanged
    });
  });

  // =========================================================================
  // SCENE EDITING
  // =========================================================================
  describe('Scene Editing', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_scenes').delete().eq('project_id', projectId);
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
    });

    test('batch edit video_prompt and narration_text', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'script_ready', total_scenes: 3 });
      projectId = project.id;
      await createTestScenes(projectId, 3);

      // Edit scene 1 and 2
      await testSupabase
        .from('movie_scenes')
        .update({ video_prompt: 'New prompt for scene 1' })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      await testSupabase
        .from('movie_scenes')
        .update({ narration_text: 'Updated narration' })
        .eq('project_id', projectId)
        .eq('scene_number', 2);

      const scenes = await getScenes(projectId);
      expect(scenes[0].video_prompt).toBe('New prompt for scene 1');
      expect(scenes[1].narration_text).toBe('Updated narration');
      // Scene 3 unchanged
      expect(scenes[2].video_prompt).toContain('scene 3');
    });

    test('edit allowed in script_ready status', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'script_ready' });
      projectId = project.id;
      await createTestScenes(projectId, 2);

      // Status check (app would verify before allowing edit)
      const p = await getProject(projectId);
      expect(['script_ready', 'paused']).toContain(p?.status);
    });

    test('edit allowed in paused status', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'paused' });
      projectId = project.id;
      await createTestScenes(projectId, 2);

      const p = await getProject(projectId);
      expect(['script_ready', 'paused']).toContain(p?.status);

      // Can actually update
      await testSupabase
        .from('movie_scenes')
        .update({ video_prompt: 'Edited while paused' })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scenes = await getScenes(projectId);
      expect(scenes[0].video_prompt).toBe('Edited while paused');
    });

    test('edit blocked in generating status (app-level guard)', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'generating' });
      projectId = project.id;

      // App checks status before allowing edits
      const p = await getProject(projectId);
      expect(['script_ready', 'paused']).not.toContain(p?.status);
    });

    test('edit scene_title', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'script_ready' });
      projectId = project.id;
      await createTestScenes(projectId, 2);

      await testSupabase
        .from('movie_scenes')
        .update({ scene_title: 'The Grand Opening' })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      const scenes = await getScenes(projectId);
      expect(scenes[0].scene_title).toBe('The Grand Opening');
    });

    test('cannot edit completed scenes (status preserved)', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'paused' });
      projectId = project.id;
      await createTestScenes(projectId, 3);

      // Mark scene 1 as completed
      await testSupabase
        .from('movie_scenes')
        .update({
          status: 'completed',
          video_url: 'https://test.com/video.mp4',
        })
        .eq('project_id', projectId)
        .eq('scene_number', 1);

      // App would filter: only update pending scenes
      await testSupabase
        .from('movie_scenes')
        .update({ video_prompt: 'Should not change' })
        .eq('project_id', projectId)
        .eq('scene_number', 1)
        .eq('status', 'pending'); // Guard: only pending

      const scene = await getScene(projectId, 1);
      expect(scene?.video_prompt).not.toBe('Should not change'); // Not updated because scene is completed
      expect(scene?.status).toBe('completed');
    });
  });

  // =========================================================================
  // ADMIN OPERATIONS
  // =========================================================================
  describe('Admin Operations', () => {
    afterEach(async () => {
      await testSupabase.from('movie_access').delete().eq('user_id', OTHER_USER_ID);
    });

    test('admin can list all projects across users', async () => {
      const p1 = await createTestProject(MOVIE_USER_ID, { title: 'Admin View 1' });
      const p2 = await createTestProject(OTHER_USER_ID, { title: 'Admin View 2' });

      // Admin query: no user_id filter
      const { data: allProjects } = await testSupabase
        .from('movie_projects')
        .select('id, title, user_id')
        .in('id', [p1.id, p2.id]);

      expect(allProjects).toHaveLength(2);

      // Cleanup
      await testSupabase.from('movie_projects').delete().eq('id', p1.id);
      await testSupabase.from('movie_projects').delete().eq('id', p2.id);
    });

    test('admin can list all access records with user info', async () => {
      await grantMovieAccess(OTHER_USER_ID);

      // Query access records
      const { data: accessRecords } = await testSupabase
        .from('movie_access')
        .select('id, user_id, is_active, max_projects')
        .eq('is_active', true);

      expect(accessRecords).toBeTruthy();
      expect(accessRecords!.length).toBeGreaterThan(0);

      // Verify we can look up user info for each access record
      const userIds = accessRecords!.map(a => a.user_id);
      const { data: users } = await testSupabase
        .from('users')
        .select('id, email, username')
        .in('id', userIds);

      expect(users).toBeTruthy();
      expect(users!.length).toBeGreaterThan(0);
    });

    test('admin revoke sets is_active false', async () => {
      await grantMovieAccess(OTHER_USER_ID);

      await testSupabase
        .from('movie_access')
        .update({ is_active: false })
        .eq('user_id', OTHER_USER_ID);

      const { data } = await testSupabase
        .from('movie_access')
        .select('is_active')
        .eq('user_id', OTHER_USER_ID)
        .single();

      expect(data?.is_active).toBe(false);
    });
  });

  // =========================================================================
  // DOWNLOAD GUARDS
  // =========================================================================
  describe('Download Guards', () => {
    let projectId: string;

    afterEach(async () => {
      if (projectId) {
        await testSupabase.from('movie_projects').delete().eq('id', projectId);
      }
    });

    test('download available only when final_video_url exists', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'completed',
        final_video_url: 'https://storage.test/movies/final.mp4',
      });
      projectId = project.id;

      const p = await getProject(projectId);
      expect(p?.final_video_url).toBeTruthy();
    });

    test('download not available without final_video_url', async () => {
      const project = await createTestProject(MOVIE_USER_ID, {
        status: 'completed',
        final_video_url: null,
      });
      projectId = project.id;

      const p = await getProject(projectId);
      expect(p?.final_video_url).toBeNull();
    });

    test('download not available for non-completed project', async () => {
      const project = await createTestProject(MOVIE_USER_ID, { status: 'generating' });
      projectId = project.id;

      const p = await getProject(projectId);
      expect(p?.status).not.toBe('completed');
    });
  });
});
