/**
 * @jest-environment node
 */

/**
 * movie.test.ts
 * Unit tests for the movie API routes:
 *   GET   /api/movie/projects              — list user's movie projects
 *   POST  /api/movie/projects              — create a new movie project
 *   GET   /api/movie/projects/[id]         — get project detail with scenes
 *   DELETE /api/movie/projects/[id]        — delete project (draft/completed/failed only)
 *   PATCH /api/movie/projects/[id]/scenes  — batch edit scene prompts/narration
 *   POST  /api/movie/projects/[id]/start   — approve script and begin generation
 *   POST  /api/movie/projects/[id]/cancel  — cancel generation permanently
 *   GET   /api/movie/access                — check user's movie access level
 *   POST  /api/movie/preview-script        — stateless script preview via Claude
 */

// ---------------------------------------------------------------------------
// Mocks — BEFORE any imports
// ---------------------------------------------------------------------------

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/validations', () => ({
  parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
  MovieProjectCreateSchema: {},
  MovieSceneUpdateSchema: {},
  MovieScriptPreviewSchema: {},
}));
jest.mock('@/lib/movie-script-generator', () => ({
  estimateMovieCredits: jest.fn().mockReturnValue(70),
  generateMovieScript: jest.fn(),
}));
jest.mock('@/lib/ai-video', () => ({
  MODEL_DURATION_SECONDS: {
    'hailuo-2.3': 6,
    'kling-2.6': 5,
    'veo3-fast': 4,
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { generateMovieScript, estimateMovieCredits } from '@/lib/movie-script-generator';
import {
  createSupabaseChain,
  createSequentialMock,
  createMockRequest,
  parseResponse,
  mockSession,
  TEST_USER,
} from '../helpers/api-test-utils';

import { GET as projectsGet, POST as projectsPost } from '@/app/api/movie/projects/route';
import { GET as projectDetailGet, DELETE as projectDelete } from '@/app/api/movie/projects/[id]/route';
import { PATCH as scenesPatch } from '@/app/api/movie/projects/[id]/scenes/route';
import { POST as startPost } from '@/app/api/movie/projects/[id]/start/route';
import { POST as cancelPost } from '@/app/api/movie/projects/[id]/cancel/route';
import { GET as accessGet } from '@/app/api/movie/access/route';
import { POST as previewScriptPost } from '@/app/api/movie/preview-script/route';

// ---------------------------------------------------------------------------
// Shared references
// ---------------------------------------------------------------------------

const mockCreateClient = createClient as jest.Mock;
const mockGetServerSession = getServerSession as jest.Mock;
const mockGenerateMovieScript = generateMovieScript as jest.Mock;
const mockEstimateMovieCredits = estimateMovieCredits as jest.Mock;

const PROJECT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEstimateMovieCredits.mockReturnValue(70);
});

// ---------------------------------------------------------------------------
// Helper: sequential mock builder
// ---------------------------------------------------------------------------

function buildSequentialMock(
  responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
) {
  const seq = createSequentialMock(responses);
  mockCreateClient.mockReturnValue({ from: seq.from });
  return seq;
}

// ===========================================================================
// GET /api/movie/projects
// ===========================================================================

describe('GET /api/movie/projects', () => {
  const url = '/api/movie/projects';

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await projectsGet(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns 404 when user not found in DB', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> null
    buildSequentialMock([{ data: null, error: null }]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await projectsGet(req));

    expect(status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  test('returns list of projects for authenticated user', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const projectsList = [
      { id: 'p1', title: 'My Movie', status: 'draft', created_at: '2026-01-01' },
      { id: 'p2', title: 'Second Film', status: 'completed', created_at: '2026-02-01' },
    ];

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> projects list
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: projectsList, error: null },
    ]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await projectsGet(req));

    expect(status).toBe(200);
    expect(body.projects).toHaveLength(2);
    expect(body.projects[0].id).toBe('p1');
    expect(body.projects[1].id).toBe('p2');
  });

  test('returns empty array when user has no projects', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: [], error: null },
    ]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await projectsGet(req));

    expect(status).toBe(200);
    expect(body.projects).toEqual([]);
  });

  test('returns 500 on database query error', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: null, error: { message: 'connection refused' } },
    ]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await projectsGet(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch projects');
  });
});

// ===========================================================================
// POST /api/movie/projects
// ===========================================================================

describe('POST /api/movie/projects', () => {
  const url = '/api/movie/projects';

  const validBody = {
    title: 'Test Movie',
    description: 'A test movie description',
    source_text: 'Once upon a time...',
    model: 'kling-2.6',
    target_duration_minutes: 5,
    aspect_ratio: '16:9',
  };

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await projectsPost(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns 404 when user not found', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> not found
    buildSequentialMock([{ data: null, error: null }]);

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await projectsPost(req));

    expect(status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  test('returns 403 when feature flag is disabled', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('feature_flags') -> disabled
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: false }, error: null },
      { data: { enabled: false }, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await projectsPost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('AI Movie Generation is not enabled');
  });

  test('returns 403 when user has no movie access', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found (not admin)
    // 2nd from('feature_flags') -> enabled
    // 3rd from('movie_access') -> no access
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: false }, error: null },
      { data: { enabled: true }, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await projectsPost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Movie generation access not granted');
  });

  test('returns 400 when project limit is reached', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found (not admin)
    // 2nd from('feature_flags') -> enabled
    // 3rd from('movie_access') -> access granted (max 5 projects)
    // 4th from('movie_projects') -> count = 5 (at limit)
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: false }, error: null },
      { data: { enabled: true }, error: null },
      { data: { max_projects: 5, max_scenes_per_project: 50, is_active: true, expires_at: null }, error: null },
      { data: null, error: null, count: 5 },
    ]);

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await projectsPost(req));

    expect(status).toBe(400);
    expect(body.error).toContain('Maximum 5 projects allowed');
  });

  test('creates project successfully (draft status, no pre-generated scenes)', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const createdProject = {
      id: PROJECT_ID,
      title: 'Test Movie',
      status: 'draft',
      estimated_credits: 70,
      total_scenes: 60,
      created_at: '2026-02-18T00:00:00Z',
    };

    // 1st from('users') -> user found (admin, bypasses access check)
    // 2nd from('feature_flags') -> enabled
    // 3rd from('movie_projects') count check -> 0
    // 4th from('movie_projects') insert -> success
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: true }, error: null },
      { data: { enabled: true }, error: null },
      { data: null, error: null, count: 0 },
      { data: createdProject, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await projectsPost(req));

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.project.id).toBe(PROJECT_ID);
    expect(body.project.status).toBe('draft');
  });

  test('creates project with pre-generated scenes in script_ready status', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const bodyWithScenes = {
      ...validBody,
      scenes: [
        { scene_number: 1, scene_title: 'Opening', video_prompt: 'A sunrise', narration_text: 'It begins' },
        { scene_number: 2, scene_title: 'Climax', video_prompt: 'An explosion', narration_text: 'Action!' },
      ],
    };

    const createdProject = {
      id: PROJECT_ID,
      title: 'Test Movie',
      status: 'script_ready',
      estimated_credits: 70,
      total_scenes: 2,
      created_at: '2026-02-18T00:00:00Z',
    };

    // 1st from('users') -> admin user
    // 2nd from('feature_flags') -> enabled
    // 3rd from('movie_projects') count check -> 0
    // 4th from('movie_projects') insert -> success
    // 5th from('movie_scenes') insert scenes -> success
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: true }, error: null },
      { data: { enabled: true }, error: null },
      { data: null, error: null, count: 0 },
      { data: createdProject, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST', body: bodyWithScenes });
    const { status, body } = await parseResponse(await projectsPost(req));

    expect(status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.project.status).toBe('script_ready');
  });

  test('returns 500 and cleans up when scene insert fails', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const bodyWithScenes = {
      ...validBody,
      scenes: [{ scene_number: 1, scene_title: 'S1', video_prompt: 'prompt' }],
    };

    // 1st from('users') -> admin
    // 2nd from('feature_flags') -> enabled
    // 3rd from('movie_projects') count -> 0
    // 4th from('movie_projects') insert -> success
    // 5th from('movie_scenes') insert -> error
    // 6th from('movie_projects') delete cleanup
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: true }, error: null },
      { data: { enabled: true }, error: null },
      { data: null, error: null, count: 0 },
      { data: { id: PROJECT_ID }, error: null },
      { data: null, error: { message: 'scene insert failed' } },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST', body: bodyWithScenes });
    const { status, body } = await parseResponse(await projectsPost(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to save scenes');
  });
});

// ===========================================================================
// GET /api/movie/projects/[id]
// ===========================================================================

describe('GET /api/movie/projects/[id]', () => {
  const url = `/api/movie/projects/${PROJECT_ID}`;
  const context = { params: Promise.resolve({ id: PROJECT_ID }) };

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await projectDetailGet(req, context));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns 404 when user not found', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    buildSequentialMock([{ data: null, error: null }]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await projectDetailGet(req, context));

    expect(status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  test('returns 404 when project not found or not owned by user', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> not found (wrong owner)
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: null, error: { code: 'PGRST116', message: 'not found' } },
    ]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await projectDetailGet(req, context));

    expect(status).toBe(404);
    expect(body.error).toBe('Project not found');
  });

  test('returns project detail with scenes', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const project = {
      id: PROJECT_ID,
      title: 'My Movie',
      status: 'generating',
      source_text: 'A'.repeat(600),
      total_scenes: 10,
    };

    const scenes = [
      { id: 's1', scene_number: 1, scene_title: 'Opening', status: 'completed', video_url: 'https://example.com/s1.mp4' },
      { id: 's2', scene_number: 2, scene_title: 'Middle', status: 'pending', video_url: null },
    ];

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> project found
    // 3rd from('movie_scenes') -> scenes list
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: project, error: null },
      { data: scenes, error: null },
    ]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await projectDetailGet(req, context));

    expect(status).toBe(200);
    expect(body.project.id).toBe(PROJECT_ID);
    expect(body.project.source_text).toHaveLength(503); // 500 + '...'
    expect(body.project.source_text_length).toBe(600);
    expect(body.scenes).toHaveLength(2);
    expect(body.scenes[0].scene_number).toBe(1);
  });
});

// ===========================================================================
// DELETE /api/movie/projects/[id]
// ===========================================================================

describe('DELETE /api/movie/projects/[id]', () => {
  const url = `/api/movie/projects/${PROJECT_ID}`;
  const context = { params: Promise.resolve({ id: PROJECT_ID }) };

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, { method: 'DELETE' });
    const { status, body } = await parseResponse(await projectDelete(req, context));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns 404 when project not found', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> not found
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'DELETE' });
    const { status, body } = await parseResponse(await projectDelete(req, context));

    expect(status).toBe(404);
    expect(body.error).toBe('Project not found');
  });

  test('returns 400 when trying to delete a generating project', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> project in 'generating' status
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: { id: PROJECT_ID, status: 'generating', user_id: TEST_USER.userId }, error: null },
    ]);

    const req = createMockRequest(url, { method: 'DELETE' });
    const { status, body } = await parseResponse(await projectDelete(req, context));

    expect(status).toBe(400);
    expect(body.error).toContain("Cannot delete project in 'generating' status");
  });

  test('deletes project in draft status successfully', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> project in 'draft' status
    // 3rd from('movie_projects') -> delete success
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: { id: PROJECT_ID, status: 'draft', user_id: TEST_USER.userId }, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'DELETE' });
    const { status, body } = await parseResponse(await projectDelete(req, context));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(PROJECT_ID);
  });

  test('deletes project in completed status successfully', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: { id: PROJECT_ID, status: 'completed', user_id: TEST_USER.userId }, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'DELETE' });
    const { status, body } = await parseResponse(await projectDelete(req, context));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ===========================================================================
// PATCH /api/movie/projects/[id]/scenes
// ===========================================================================

describe('PATCH /api/movie/projects/[id]/scenes', () => {
  const url = `/api/movie/projects/${PROJECT_ID}/scenes`;
  const context = { params: Promise.resolve({ id: PROJECT_ID }) };

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, { method: 'PATCH', body: { scenes: [] } });
    const { status, body } = await parseResponse(await scenesPatch(req, context));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns 404 when project not found', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> not found
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, {
      method: 'PATCH',
      body: { scenes: [{ scene_number: 1, video_prompt: 'new prompt' }] },
    });
    const { status, body } = await parseResponse(await scenesPatch(req, context));

    expect(status).toBe(404);
    expect(body.error).toBe('Project not found');
  });

  test('returns 400 when project is in generating status', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> project in 'generating' status
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: { id: PROJECT_ID, status: 'generating', user_id: TEST_USER.userId }, error: null },
    ]);

    const req = createMockRequest(url, {
      method: 'PATCH',
      body: { scenes: [{ scene_number: 1, video_prompt: 'new prompt' }] },
    });
    const { status, body } = await parseResponse(await scenesPatch(req, context));

    expect(status).toBe(400);
    expect(body.error).toContain("Cannot edit scenes when project is in 'generating' status");
  });

  test('updates scenes successfully when project is script_ready', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> project in 'script_ready'
    // 3rd from('movie_scenes') -> update scene 1
    // 4th from('movie_scenes') -> update scene 2
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: { id: PROJECT_ID, status: 'script_ready', user_id: TEST_USER.userId }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, {
      method: 'PATCH',
      body: {
        scenes: [
          { scene_number: 1, video_prompt: 'Updated prompt 1' },
          { scene_number: 2, narration_text: 'Updated narration' },
        ],
      },
    });
    const { status, body } = await parseResponse(await scenesPatch(req, context));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.updated).toBe(2);
  });
});

// ===========================================================================
// POST /api/movie/projects/[id]/start
// ===========================================================================

describe('POST /api/movie/projects/[id]/start', () => {
  const url = `/api/movie/projects/${PROJECT_ID}/start`;
  const context = { params: Promise.resolve({ id: PROJECT_ID }) };

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await startPost(req, context));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns 404 when project not found or not owned', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user with credits
    // 2nd from('movie_projects') -> not found
    buildSequentialMock([
      { data: { id: TEST_USER.userId, balance_credits: 100 }, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await startPost(req, context));

    expect(status).toBe(404);
    expect(body.error).toBe('Project not found');
  });

  test('returns 400 when project is not in script_ready status', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user with credits
    // 2nd from('movie_projects') -> project in 'draft'
    buildSequentialMock([
      { data: { id: TEST_USER.userId, balance_credits: 100 }, error: null },
      { data: { id: PROJECT_ID, status: 'draft', user_id: TEST_USER.userId, total_scenes: 10, estimated_credits: 70, model: 'kling-2.6' }, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await startPost(req, context));

    expect(status).toBe(400);
    expect(body.error).toContain("Cannot start generation from 'draft' status");
  });

  test('returns 400 when no scenes exist', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user with credits
    // 2nd from('movie_projects') -> project in 'script_ready'
    // 3rd from('movie_scenes') count -> 0
    buildSequentialMock([
      { data: { id: TEST_USER.userId, balance_credits: 100 }, error: null },
      { data: { id: PROJECT_ID, status: 'script_ready', user_id: TEST_USER.userId, total_scenes: 10, estimated_credits: 70, model: 'kling-2.6' }, error: null },
      { data: null, error: null, count: 0 },
    ]);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await startPost(req, context));

    expect(status).toBe(400);
    expect(body.error).toContain('No scenes found');
  });

  test('returns 400 when user has insufficient credits', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user with 2 credits (below minimum of 5)
    // 2nd from('movie_projects') -> script_ready
    // 3rd from('movie_scenes') count -> 10 scenes
    // 4th from('movie_projects') count active -> 0
    buildSequentialMock([
      { data: { id: TEST_USER.userId, balance_credits: 2 }, error: null },
      { data: { id: PROJECT_ID, status: 'script_ready', user_id: TEST_USER.userId, total_scenes: 10, estimated_credits: 70, model: 'kling-2.6' }, error: null },
      { data: null, error: null, count: 10 },
      { data: null, error: null, count: 0 },
    ]);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await startPost(req, context));

    expect(status).toBe(400);
    expect(body.error).toContain('Insufficient credits');
  });

  test('starts generation successfully', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user with plenty of credits
    // 2nd from('movie_projects') -> script_ready
    // 3rd from('movie_scenes') count -> 10 scenes
    // 4th from('movie_projects') count active generating -> 0
    // 5th from('movie_projects') update status -> success
    buildSequentialMock([
      { data: { id: TEST_USER.userId, balance_credits: 500 }, error: null },
      { data: { id: PROJECT_ID, status: 'script_ready', user_id: TEST_USER.userId, total_scenes: 10, estimated_credits: 70, model: 'kling-2.6' }, error: null },
      { data: null, error: null, count: 10 },
      { data: null, error: null, count: 0 },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await startPost(req, context));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total_scenes).toBe(10);
    expect(body.estimated_credits).toBe(70);
    expect(body.message).toContain('Generation started');
  });

  test('returns 400 when concurrent generation limit (2) is reached', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user with credits
    // 2nd from('movie_projects') -> script_ready
    // 3rd from('movie_scenes') count -> 10 scenes
    // 4th from('movie_projects') count active generating -> 2 (at limit)
    buildSequentialMock([
      { data: { id: TEST_USER.userId, balance_credits: 500 }, error: null },
      { data: { id: PROJECT_ID, status: 'script_ready', user_id: TEST_USER.userId, total_scenes: 10, estimated_credits: 70, model: 'kling-2.6' }, error: null },
      { data: null, error: null, count: 10 },
      { data: null, error: null, count: 2 },
    ]);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await startPost(req, context));

    expect(status).toBe(400);
    expect(body.error).toContain('Maximum 2 concurrent movie generations');
  });
});

// ===========================================================================
// POST /api/movie/projects/[id]/cancel
// ===========================================================================

describe('POST /api/movie/projects/[id]/cancel', () => {
  const url = `/api/movie/projects/${PROJECT_ID}/cancel`;
  const context = { params: Promise.resolve({ id: PROJECT_ID }) };

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await cancelPost(req, context));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns 404 when project not found', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> not found
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await cancelPost(req, context));

    expect(status).toBe(404);
    expect(body.error).toBe('Project not found');
  });

  test('returns 400 when project is in non-cancellable status', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> project in 'completed' status
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: { id: PROJECT_ID, status: 'completed', user_id: TEST_USER.userId, completed_scenes: 10, spent_credits: 70 }, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await cancelPost(req, context));

    expect(status).toBe(400);
    expect(body.error).toContain("Cannot cancel project in 'completed' status");
  });

  test('cancels a generating project successfully', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('movie_projects') -> project in 'generating'
    // 3rd from('movie_scenes') -> update pending scenes to skipped
    // 4th from('movie_projects') -> update status to cancelled
    buildSequentialMock([
      { data: { id: TEST_USER.userId }, error: null },
      { data: { id: PROJECT_ID, status: 'generating', user_id: TEST_USER.userId, completed_scenes: 3, spent_credits: 21 }, error: null },
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST' });
    const { status, body } = await parseResponse(await cancelPost(req, context));

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Project cancelled.');
    expect(body.completed_scenes).toBe(3);
    expect(body.credits_spent).toBe(21);
  });
});

// ===========================================================================
// GET /api/movie/access
// ===========================================================================

describe('GET /api/movie/access', () => {
  const url = '/api/movie/access';

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await accessGet(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns feature_disabled when flag is off', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('feature_flags') -> disabled
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: false }, error: null },
      { data: { enabled: false }, error: null },
    ]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await accessGet(req));

    expect(status).toBe(200);
    expect(body.has_access).toBe(false);
    expect(body.reason).toBe('feature_disabled');
  });

  test('returns admin access when user is admin', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> admin user
    // 2nd from('feature_flags') -> enabled
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: true }, error: null },
      { data: { enabled: true }, error: null },
    ]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await accessGet(req));

    expect(status).toBe(200);
    expect(body.has_access).toBe(true);
    expect(body.is_admin).toBe(true);
    expect(body.max_projects).toBe(100);
    expect(body.max_scenes_per_project).toBe(300);
  });

  test('returns not_granted when user has no movie_access row', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> non-admin user
    // 2nd from('feature_flags') -> enabled
    // 3rd from('movie_access') -> not found
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: false }, error: null },
      { data: { enabled: true }, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await accessGet(req));

    expect(status).toBe(200);
    expect(body.has_access).toBe(false);
    expect(body.reason).toBe('not_granted');
  });

  test('returns full access details with project count for granted user', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> non-admin user
    // 2nd from('feature_flags') -> enabled
    // 3rd from('movie_access') -> active access
    // 4th from('movie_projects') -> count 3
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: false }, error: null },
      { data: { enabled: true }, error: null },
      { data: { max_projects: 10, max_scenes_per_project: 50, is_active: true, expires_at: null }, error: null },
      { data: null, error: null, count: 3 },
    ]);

    const req = createMockRequest(url);
    const { status, body } = await parseResponse(await accessGet(req));

    expect(status).toBe(200);
    expect(body.has_access).toBe(true);
    expect(body.is_admin).toBe(false);
    expect(body.max_projects).toBe(10);
    expect(body.max_scenes_per_project).toBe(50);
    expect(body.projects_used).toBe(3);
  });
});

// ===========================================================================
// POST /api/movie/preview-script
// ===========================================================================

describe('POST /api/movie/preview-script', () => {
  const url = '/api/movie/preview-script';

  const validBody = {
    source_text: 'A story about a brave knight...',
    model: 'kling-2.6',
    style: 'cinematic',
    target_duration_minutes: 3,
  };

  test('returns 401 when not authenticated', async () => {
    mockSession(mockGetServerSession, null);

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await previewScriptPost(req));

    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  test('returns 403 when feature flag is disabled', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> user found
    // 2nd from('feature_flags') -> disabled
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: false }, error: null },
      { data: { enabled: false }, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await previewScriptPost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('AI Movie Generation is not enabled');
  });

  test('returns 403 when non-admin user has no access', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> non-admin user
    // 2nd from('feature_flags') -> enabled
    // 3rd from('movie_access') -> no access
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: false }, error: null },
      { data: { enabled: true }, error: null },
      { data: null, error: null },
    ]);

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await previewScriptPost(req));

    expect(status).toBe(403);
    expect(body.error).toBe('Movie generation access not granted');
  });

  test('returns script preview successfully for admin user', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    const scriptResult = {
      scenes: [
        { scene_number: 1, scene_title: 'The Call', video_prompt: 'A knight receives a quest', narration_text: 'Our hero begins...' },
        { scene_number: 2, scene_title: 'The Journey', video_prompt: 'Riding through forests', narration_text: 'Through the wilderness...' },
      ],
      total_scenes: 2,
      estimated_duration_seconds: 10,
      summary: 'A brave knight sets out on a quest.',
    };

    // 1st from('users') -> admin user (skips movie_access check)
    // 2nd from('feature_flags') -> enabled
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: true }, error: null },
      { data: { enabled: true }, error: null },
    ]);

    mockGenerateMovieScript.mockResolvedValue({ ok: true, script: scriptResult });

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await previewScriptPost(req));

    expect(status).toBe(200);
    expect(body.scenes).toHaveLength(2);
    expect(body.total_scenes).toBe(2);
    expect(body.estimated_duration_seconds).toBe(10);
    expect(body.estimated_credits).toBe(70);
    expect(body.summary).toBe('A brave knight sets out on a quest.');
    expect(mockGenerateMovieScript).toHaveBeenCalledWith(
      validBody.source_text,
      expect.objectContaining({
        model: 'kling-2.6',
        style: 'cinematic',
        targetDurationMinutes: 3,
      }),
    );
  });

  test('returns 500 when script generation fails', async () => {
    mockSession(mockGetServerSession, TEST_USER);

    // 1st from('users') -> admin user
    // 2nd from('feature_flags') -> enabled
    buildSequentialMock([
      { data: { id: TEST_USER.userId, is_admin: true }, error: null },
      { data: { enabled: true }, error: null },
    ]);

    mockGenerateMovieScript.mockResolvedValue({ ok: false, error: 'Claude API rate limited' });

    const req = createMockRequest(url, { method: 'POST', body: validBody });
    const { status, body } = await parseResponse(await previewScriptPost(req));

    expect(status).toBe(500);
    expect(body.error).toBe('Script generation failed');
  });
});
