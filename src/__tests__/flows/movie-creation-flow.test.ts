/**
 * @jest-environment node
 *
 * MOVIE CREATION FLOW TEST
 * Tests the full movie creation lifecycle:
 *   Create project -> Generate script -> Start generation -> Check scenes -> Cancel/Complete -> Download
 *
 * Imports route handlers and calls them in sequence with shared mocked state.
 */

// ============================================================================
// MOCKS
// ============================================================================

const mockCreateClient = jest.fn();
const mockGetServerSession = jest.fn();
const mockRateLimit = jest.fn().mockResolvedValue(null);
const mockRequireCsrf = jest.fn().mockResolvedValue(null);
const mockParseBody = jest.fn();
const mockGenerateMovieScript = jest.fn();
const mockEstimateMovieCredits = jest.fn().mockReturnValue(50);

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }));
jest.mock('next-auth', () => ({ getServerSession: mockGetServerSession }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: mockRequireCsrf }));
jest.mock('@/lib/validations', () => ({
  MovieProjectCreateSchema: {},
  MovieSceneUpdateSchema: {},
  parseBody: mockParseBody,
}));
jest.mock('@/lib/movie-script-generator', () => ({
  generateMovieScript: mockGenerateMovieScript,
  estimateMovieCredits: mockEstimateMovieCredits,
}));
jest.mock('@/lib/ai-video', () => ({
  MODEL_DURATION_SECONDS: { 'kling-v2': 5, 'minimax-video-01': 5 },
}));

// ============================================================================
// IMPORTS
// ============================================================================

import {
  createMockRequest,
  createSupabaseChain,
  parseResponse,
  TEST_USER,
} from '../helpers/api-test-utils';

// ============================================================================
// SHARED STATE
// ============================================================================

const USER_ID = TEST_USER.userId;
const PROJECT_ID = 'proj-001';

function buildSupabaseMock(overrides?: Record<string, jest.Mock>) {
  const storageMock = {
    from: jest.fn().mockReturnValue({
      createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://test.supabase.co/signed/movies/proj-001/final.mp4' } }),
      remove: jest.fn().mockResolvedValue({}),
    }),
  };
  return {
    from: jest.fn(),
    rpc: jest.fn().mockReturnValue(Promise.resolve({ data: null, error: null })),
    storage: storageMock,
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Movie Creation Flow: Create -> Script -> Start -> Cancel -> Download', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  // --------------------------------------------------------------------------
  // STEP 1: Create a movie project
  // --------------------------------------------------------------------------
  test('Step 1: Authenticated user creates a movie project', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: TEST_USER.email },
    });

    mockParseBody.mockReturnValue({
      success: true,
      data: {
        title: 'My Movie',
        description: 'A test movie',
        source_text: 'Once upon a time...',
        model: 'kling-v2',
        aspect_ratio: '16:9',
        target_duration_minutes: 10,
      },
    });

    const userChain = createSupabaseChain({ data: { id: USER_ID, is_admin: false }, error: null });
    const featureFlagChain = createSupabaseChain({ data: { enabled: true }, error: null });
    const accessChain = createSupabaseChain({ data: { max_projects: 10, max_scenes_per_project: 150, is_active: true, expires_at: null }, error: null });
    const countChain = createSupabaseChain({ data: null, error: null, count: 0 });
    const insertChain = createSupabaseChain({
      data: { id: PROJECT_ID, title: 'My Movie', status: 'draft', estimated_credits: 50, total_scenes: 120, created_at: new Date().toISOString() },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return userChain;
      if (fromCallCount === 2) return featureFlagChain;
      if (fromCallCount === 3) return accessChain;
      if (fromCallCount === 4) return countChain;
      return insertChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/movie/projects/route');
    const req = createMockRequest('/api/movie/projects', {
      method: 'POST',
      body: {
        title: 'My Movie',
        description: 'A test movie',
        source_text: 'Once upon a time...',
        model: 'kling-v2',
        aspect_ratio: '16:9',
        target_duration_minutes: 10,
      },
    });

    const res = await POST(req);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.project.id).toBe(PROJECT_ID);
    expect(body.project.status).toBe('draft');
  });

  // --------------------------------------------------------------------------
  // STEP 2: Unauthenticated user cannot create a project
  // --------------------------------------------------------------------------
  test('Step 2: Unauthenticated user cannot create a project', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import('@/app/api/movie/projects/route');
    const req = createMockRequest('/api/movie/projects', {
      method: 'POST',
      body: { title: 'Test' },
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  // --------------------------------------------------------------------------
  // STEP 3: Generate script for the project
  // --------------------------------------------------------------------------
  test('Step 3: User generates a script for the project', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    mockGenerateMovieScript.mockResolvedValue({
      ok: true,
      script: {
        total_scenes: 10,
        estimated_duration_seconds: 50,
        summary: 'A story about...',
        scenes: Array.from({ length: 10 }, (_, i) => ({
          scene_number: i + 1,
          scene_title: `Scene ${i + 1}`,
          video_prompt: `Generate video for scene ${i + 1}`,
          narration_text: `Narration for scene ${i + 1}`,
        })),
      },
      costCents: 5,
    });

    const userChain = createSupabaseChain({ data: { id: USER_ID }, error: null });
    const projectChain = createSupabaseChain({
      data: { id: PROJECT_ID, user_id: USER_ID, status: 'draft', source_text: 'Once upon a time...', model: 'kling-v2', style: null, voice_id: null, aspect_ratio: '16:9', target_duration_minutes: 10 },
      error: null,
    });
    const updateStatusChain = createSupabaseChain({ data: null, error: null, count: 1 });
    const accessChain = createSupabaseChain({ data: { max_scenes_per_project: 150 }, error: null });
    const deleteOldScenesChain = createSupabaseChain({ data: null, error: null });
    const insertScenesChain = createSupabaseChain({ data: null, error: null });
    const finalUpdateChain = createSupabaseChain({ data: null, error: null });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return userChain;
      if (fromCallCount === 2) return projectChain;
      if (fromCallCount === 3) return updateStatusChain;
      if (fromCallCount === 4) return accessChain;
      if (fromCallCount === 5) return deleteOldScenesChain;
      if (fromCallCount === 6) return insertScenesChain;
      return finalUpdateChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/movie/projects/[id]/generate-script/route');
    const req = createMockRequest(`/api/movie/projects/${PROJECT_ID}/generate-script`, {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ id: PROJECT_ID }) });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total_scenes).toBe(10);
  });

  // --------------------------------------------------------------------------
  // STEP 4: Start generation
  // --------------------------------------------------------------------------
  test('Step 4: User starts generation from script_ready status', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    const userChain = createSupabaseChain({ data: { id: USER_ID, balance_credits: 100 }, error: null });
    const projectChain = createSupabaseChain({
      data: { id: PROJECT_ID, status: 'script_ready', user_id: USER_ID, total_scenes: 10, estimated_credits: 50, model: 'kling-v2' },
      error: null,
    });
    const sceneCountChain = createSupabaseChain({ data: null, error: null, count: 10 });
    const activeProjectsChain = createSupabaseChain({ data: null, error: null, count: 0 });
    const startUpdateChain = createSupabaseChain({ data: null, error: null, count: 1 });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return userChain;
      if (fromCallCount === 2) return projectChain;
      if (fromCallCount === 3) return sceneCountChain;
      if (fromCallCount === 4) return activeProjectsChain;
      return startUpdateChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/movie/projects/[id]/start/route');
    const req = createMockRequest(`/api/movie/projects/${PROJECT_ID}/start`, { method: 'POST' });

    const res = await POST(req, { params: Promise.resolve({ id: PROJECT_ID }) });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total_scenes).toBe(10);
  });

  // --------------------------------------------------------------------------
  // STEP 5: Cancel generation
  // --------------------------------------------------------------------------
  test('Step 5: User cancels an in-progress generation', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    const userChain = createSupabaseChain({ data: { id: USER_ID }, error: null });
    const projectChain = createSupabaseChain({
      data: { id: PROJECT_ID, status: 'generating', user_id: USER_ID, completed_scenes: 3, spent_credits: 15 },
      error: null,
    });
    const updateScenesChain = createSupabaseChain({ data: null, error: null });
    const updateProjectChain = createSupabaseChain({ data: null, error: null });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return userChain;
      if (fromCallCount === 2) return projectChain;
      if (fromCallCount === 3) return updateScenesChain;
      return updateProjectChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { POST } = await import('@/app/api/movie/projects/[id]/cancel/route');
    const req = createMockRequest(`/api/movie/projects/${PROJECT_ID}/cancel`, { method: 'POST' });

    const res = await POST(req, { params: Promise.resolve({ id: PROJECT_ID }) });
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.completed_scenes).toBe(3);
    expect(body.credits_spent).toBe(15);
  });

  // --------------------------------------------------------------------------
  // STEP 6: Download completed movie
  // --------------------------------------------------------------------------
  test('Step 6: User downloads a completed movie', async () => {
    mockGetServerSession.mockResolvedValue({ user: { email: TEST_USER.email } });

    const userChain = createSupabaseChain({ data: { id: USER_ID }, error: null });
    const projectChain = createSupabaseChain({
      data: {
        id: PROJECT_ID,
        status: 'completed',
        user_id: USER_ID,
        title: 'My Movie',
        final_video_url: 'https://test.supabase.co/storage/v1/object/videos/movies/proj-001/final.mp4',
        total_duration_seconds: 50,
      },
      error: null,
    });

    let fromCallCount = 0;
    const fromMock = jest.fn(() => {
      fromCallCount++;
      if (fromCallCount === 1) return userChain;
      return projectChain;
    });

    mockCreateClient.mockReturnValue(buildSupabaseMock({ from: fromMock }));

    const { GET } = await import('@/app/api/movie/projects/[id]/download/route');
    const req = createMockRequest(`/api/movie/projects/${PROJECT_ID}/download`);

    const res = await GET(req, { params: Promise.resolve({ id: PROJECT_ID }) });

    // Download route returns a redirect (307) to the signed URL
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('supabase.co');
  });
});
