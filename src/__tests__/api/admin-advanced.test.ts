/**
 * @jest-environment node
 */

/**
 * Admin Advanced API Route Tests
 *
 * Covers: seasons, slots, feature-flags, stats, users, clips, moderation, audit-logs
 *
 * Uses Jest with Supabase/admin-auth mocks (no real DB).
 */

// ---------------------------------------------------------------------------
// Module mocks (must come before imports)
// ---------------------------------------------------------------------------

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth-options', () => ({ authOptions: {} }));
jest.mock('@/lib/rate-limit', () => ({ rateLimit: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/csrf', () => ({ requireCsrf: jest.fn().mockReturnValue(null) }));
jest.mock('@/lib/admin-auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
  checkAdminAuth: jest.fn().mockResolvedValue({
    isAdmin: true,
    userId: '660e8400-e29b-41d4-a716-446655440000',
    email: 'admin@test.com',
  }),
  requireAdminWithAuth: jest.fn().mockResolvedValue({
    isAdmin: true,
    userId: '660e8400-e29b-41d4-a716-446655440000',
    email: 'admin@test.com',
  }),
}));
jest.mock('@/lib/validations', () => ({
  parseBody: jest.fn((_schema: unknown, body: unknown) => ({ success: true, data: body })),
}));
jest.mock('@/lib/audit-log', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/genres', () => ({
  isValidGenre: jest.fn((code: string) => ['action', 'comedy', 'drama', 'horror', 'sci-fi'].includes(code)),
  getGenreCodes: jest.fn(() => ['action', 'comedy', 'drama', 'horror', 'sci-fi']),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import {
  createSupabaseChain,
  createSequentialMock,
  createMockRequest,
  parseResponse,
  TEST_ADMIN,
} from '../helpers/api-test-utils';

// Route handlers
import { GET as seasonsGet, POST as seasonsPost } from '@/app/api/admin/seasons/route';
import { GET as slotsGet } from '@/app/api/admin/slots/route';
import { GET as featureFlagsGet, POST as featureFlagsPost, PUT as featureFlagsPut } from '@/app/api/admin/feature-flags/route';
import { GET as statsGet } from '@/app/api/admin/stats/route';
import { GET as usersGet } from '@/app/api/admin/users/route';
import { GET as clipsGet } from '@/app/api/admin/clips/route';
import { GET as moderationGet, POST as moderationPost, PATCH as moderationPatch, DELETE as moderationDelete } from '@/app/api/admin/moderation/route';
import { GET as auditLogsGet } from '@/app/api/admin/audit-logs/route';

const mockCreateClient = createClient as jest.Mock;
const mockRequireAdmin = requireAdmin as jest.Mock;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  // Default: admin auth passes
  mockRequireAdmin.mockResolvedValue(null);
});

// ===========================================================================
// SEASONS
// ===========================================================================

describe('Admin Seasons API', () => {
  describe('GET /api/admin/seasons', () => {
    it('returns a list of seasons with stats', async () => {
      const seasonId = 'season-001';
      const seq = createSequentialMock([
        // 0: seasons query
        {
          data: [
            { id: seasonId, label: 'Season 1', status: 'active', total_slots: 75, created_at: '2026-01-01', description: '', genre: 'action' },
          ],
        },
        // 1: story_slots query for stats
        {
          data: [
            { season_id: seasonId, status: 'locked' },
            { season_id: seasonId, status: 'locked' },
            { season_id: seasonId, status: 'voting' },
            { season_id: seasonId, status: 'upcoming' },
          ],
        },
      ]);
      mockCreateClient.mockReturnValue(seq);

      const req = createMockRequest('/api/admin/seasons');
      const res = await seasonsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.seasons).toHaveLength(1);
      expect(body.seasons[0].stats.locked_slots).toBe(2);
      expect(body.seasons[0].stats.voting_slots).toBe(1);
      expect(body.seasons[0].stats.upcoming_slots).toBe(1);
    });

    it('returns 403 when not admin', async () => {
      mockRequireAdmin.mockResolvedValue(
        NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      );

      const req = createMockRequest('/api/admin/seasons');
      const res = await seasonsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(403);
      expect(body.error).toBe('Admin access required');
    });

    it('returns 500 when DB query fails', async () => {
      const chain = createSupabaseChain({ data: null, error: { message: 'DB error' } });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/seasons');
      const res = await seasonsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(500);
      expect(body.error).toBe('Failed to fetch seasons');
    });
  });

  describe('POST /api/admin/seasons', () => {
    it('creates a new season with slots', async () => {
      const newSeasonId = 'new-season-id';
      const seq = createSequentialMock([
        // 0: seasons insert
        {
          data: { id: newSeasonId, label: 'Season 2', status: 'draft', total_slots: 75 },
        },
        // 1: story_slots insert
        { data: null, error: null },
      ]);
      mockCreateClient.mockReturnValue(seq);

      const req = createMockRequest('/api/admin/seasons', {
        method: 'POST',
        body: { label: 'Season 2', total_slots: 75 },
      });

      const res = await seasonsPost(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.season.id).toBe(newSeasonId);
      expect(body.message).toContain('Season 2');
    });

    it('returns 400 when label is missing', async () => {
      mockCreateClient.mockReturnValue({ from: jest.fn(() => createSupabaseChain({ data: null })) });

      const req = createMockRequest('/api/admin/seasons', {
        method: 'POST',
        body: { total_slots: 75 },
      });

      const res = await seasonsPost(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toBe('Season label is required');
    });

    it('returns 400 for invalid genre', async () => {
      mockCreateClient.mockReturnValue({ from: jest.fn(() => createSupabaseChain({ data: null })) });

      const req = createMockRequest('/api/admin/seasons', {
        method: 'POST',
        body: { label: 'Bad Genre Season', genre: 'nonexistent' },
      });

      const res = await seasonsPost(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toContain('Invalid genre');
    });

    it('returns 403 when not admin', async () => {
      mockRequireAdmin.mockResolvedValue(
        NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      );

      const req = createMockRequest('/api/admin/seasons', {
        method: 'POST',
        body: { label: 'Blocked Season' },
      });

      const res = await seasonsPost(req);
      const { status } = await parseResponse(res);

      expect(status).toBe(403);
    });
  });
});

// ===========================================================================
// SLOTS
// ===========================================================================

describe('Admin Slots API', () => {
  describe('GET /api/admin/slots', () => {
    it('returns slots for the active season in simple mode', async () => {
      const seasonId = 'season-active';
      const seq = createSequentialMock([
        // 0: seasons query (active season lookup)
        { data: { id: seasonId, status: 'active', total_slots: 75 } },
        // 1: story_slots voting slot check
        { data: { slot_position: 5, status: 'voting', voting_started_at: '2026-01-01T00:00:00Z', voting_ends_at: '2026-01-02T00:00:00Z', voting_duration_hours: 24 } },
        // 2: tournament_clips count
        { data: null, count: 3 },
      ]);
      mockCreateClient.mockReturnValue(seq);

      const req = createMockRequest('/api/admin/slots', {
        searchParams: { simple: 'true' },
      });

      const res = await slotsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.currentSlot).toBe(5);
      expect(body.seasonStatus).toBe('active');
      expect(body.totalSlots).toBe(75);
      expect(body.clipsInSlot).toBe(3);
    });

    it('returns empty state when no active season found', async () => {
      const chain = createSupabaseChain({ data: null });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/slots');
      const res = await slotsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.currentSlot).toBe(0);
      expect(body.seasonStatus).toBe('none');
      expect(body.slots).toEqual([]);
    });

    it('returns 403 when not admin', async () => {
      mockRequireAdmin.mockResolvedValue(
        NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      );

      const req = createMockRequest('/api/admin/slots');
      const res = await slotsGet(req);
      const { status } = await parseResponse(res);

      expect(status).toBe(403);
    });
  });
});

// ===========================================================================
// FEATURE FLAGS
// ===========================================================================

describe('Admin Feature Flags API', () => {
  describe('GET /api/admin/feature-flags', () => {
    it('returns feature flags grouped by category', async () => {
      const flags = [
        { id: '1', key: 'dark_mode', name: 'Dark Mode', description: '', category: 'ui', enabled: true, config: {}, created_at: '2026-01-01' },
        { id: '2', key: 'ai_gen', name: 'AI Generation', description: '', category: 'ai', enabled: false, config: {}, created_at: '2026-01-01' },
      ];
      const chain = createSupabaseChain({ data: flags });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/feature-flags');
      const res = await featureFlagsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.flags).toHaveLength(2);
      expect(body.grouped).toBeDefined();
      expect(body.categories).toContain('ui');
      expect(body.categories).toContain('ai');
    });

    it('returns 403 when not admin', async () => {
      mockRequireAdmin.mockResolvedValue(
        NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      );

      const req = createMockRequest('/api/admin/feature-flags');
      const res = await featureFlagsGet(req);
      const { status } = await parseResponse(res);

      expect(status).toBe(403);
    });

    it('returns 500 on DB error', async () => {
      const chain = createSupabaseChain({ data: null, error: { message: 'connection error' } });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/feature-flags');
      const res = await featureFlagsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(500);
      expect(body.error).toBe('Failed to fetch feature flags');
    });
  });

  describe('POST /api/admin/feature-flags', () => {
    it('creates a new feature flag', async () => {
      const created = { id: '3', key: 'new_flag', name: 'New Flag', description: '', category: 'general', enabled: false, config: {} };
      const chain = createSupabaseChain({ data: created });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/feature-flags', {
        method: 'POST',
        body: { key: 'new_flag', name: 'New Flag' },
      });

      const res = await featureFlagsPost(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.flag.key).toBe('new_flag');
      expect(body.message).toContain('New Flag');
    });

    it('returns 400 when key is missing', async () => {
      const req = createMockRequest('/api/admin/feature-flags', {
        method: 'POST',
        body: { name: 'No Key' },
      });

      const res = await featureFlagsPost(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toBe('Key and name are required');
    });

    it('returns 409 on duplicate key', async () => {
      const chain = createSupabaseChain({ data: null, error: { code: '23505', message: 'duplicate' } });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/feature-flags', {
        method: 'POST',
        body: { key: 'existing_key', name: 'Existing' },
      });

      const res = await featureFlagsPost(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(409);
      expect(body.error).toContain('already exists');
    });
  });

  describe('PUT /api/admin/feature-flags', () => {
    it('toggles a feature flag and logs the action', async () => {
      const updated = { id: '1', key: 'dark_mode', name: 'Dark Mode', enabled: true, config: {} };
      const chain = createSupabaseChain({ data: updated });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/feature-flags', {
        method: 'PUT',
        body: { key: 'dark_mode', enabled: true },
      });

      const res = await featureFlagsPut(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.flag.enabled).toBe(true);
      expect(body.message).toContain('enabled');
      expect(logAdminAction).toHaveBeenCalled();
    });

    it('returns 400 when key is missing', async () => {
      const req = createMockRequest('/api/admin/feature-flags', {
        method: 'PUT',
        body: { enabled: true },
      });

      const res = await featureFlagsPut(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toBe('Feature key is required');
    });

    it('returns 400 when no update data provided', async () => {
      const req = createMockRequest('/api/admin/feature-flags', {
        method: 'PUT',
        body: { key: 'some_flag' },
      });

      const res = await featureFlagsPut(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toBe('No update data provided');
    });

    it('returns 400 when config is not an object', async () => {
      const req = createMockRequest('/api/admin/feature-flags', {
        method: 'PUT',
        body: { key: 'flag', config: 'not-an-object' },
      });

      const res = await featureFlagsPut(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toBe('config must be a JSON object');
    });
  });
});

// ===========================================================================
// STATS
// ===========================================================================

describe('Admin Stats API', () => {
  describe('GET /api/admin/stats', () => {
    it('returns comprehensive stats', async () => {
      // The stats route runs ~12 parallel COUNT queries via Promise.all.
      // We mock a single from() that always returns count-style results.
      let callIdx = 0;
      const responses = [
        // 0: seasons (active season lookup)
        { data: { id: 'season-1', name: 'S1', total_slots: 75 } },
        // 1-11: various count queries (votes, clips, slots, moderation)
        { data: null, count: 500 },  // total votes
        { data: null, count: 100 },  // total clips
        { data: null, count: 50 },   // today votes
        { data: null, count: 10 },   // today clips
        { data: null, count: 40 },   // yesterday votes
        { data: null, count: 8 },    // yesterday clips
        { data: null, count: 20 },   // locked slots
        { data: null, count: 1 },    // voting slots
        { data: null, count: 54 },   // upcoming slots
        { data: null, count: 5 },    // pending clips
        { data: null, count: 80 },   // approved clips
        { data: null, count: 3 },    // rejected clips
      ];

      const chains = responses.map(r => createSupabaseChain(r));
      mockCreateClient.mockReturnValue({
        from: jest.fn(() => {
          const chain = chains[Math.min(callIdx, chains.length - 1)];
          callIdx++;
          return chain;
        }),
      });

      const req = createMockRequest('/api/admin/stats');
      const res = await statsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.overview).toBeDefined();
      expect(body.overview.total_votes).toBe(500);
      expect(body.overview.total_clips).toBe(100);
      expect(body.growth).toBeDefined();
      expect(body.engagement).toBeDefined();
      expect(body.content).toBeDefined();
      expect(body.season).toBeDefined();
      expect(body.season.current_season_id).toBe('season-1');
      expect(body.recent_activity).toBeDefined();
    });

    it('returns 403 when not admin', async () => {
      mockRequireAdmin.mockResolvedValue(
        NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      );

      const req = createMockRequest('/api/admin/stats');
      const res = await statsGet(req);
      const { status } = await parseResponse(res);

      expect(status).toBe(403);
    });
  });
});

// ===========================================================================
// USERS
// ===========================================================================

describe('Admin Users API', () => {
  describe('GET /api/admin/users', () => {
    it('returns paginated user list', async () => {
      const users = [
        { id: 'u1', username: 'alice', email: 'alice@test.com', clips_uploaded: 5, total_votes_cast: 20, created_at: '2026-01-01' },
        { id: 'u2', username: 'bob', email: 'bob@test.com', clips_uploaded: 3, total_votes_cast: 10, created_at: '2026-01-02' },
      ];
      const chain = createSupabaseChain({ data: users, count: 42 });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/users', {
        searchParams: { page: '1', limit: '20' },
      });

      const res = await usersGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.users).toHaveLength(2);
      expect(body.total).toBe(42);
      expect(body.page).toBe(1);
      expect(body.totalPages).toBe(3); // ceil(42/20)
    });

    it('enriches users with clip_count and vote_count', async () => {
      const users = [
        { id: 'u1', username: 'creator', email: 'c@test.com', clips_uploaded: 12, total_votes_cast: 50, created_at: '2026-01-01' },
      ];
      const chain = createSupabaseChain({ data: users, count: 1 });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/users');
      const res = await usersGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.users[0].clip_count).toBe(12);
      expect(body.users[0].vote_count).toBe(50);
    });

    it('returns 403 when not admin', async () => {
      mockRequireAdmin.mockResolvedValue(
        NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      );

      const req = createMockRequest('/api/admin/users');
      const res = await usersGet(req);
      const { status } = await parseResponse(res);

      expect(status).toBe(403);
    });

    it('returns 500 on DB error', async () => {
      const chain = createSupabaseChain({ data: null, error: { message: 'query failed' } });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/users');
      const res = await usersGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(500);
      expect(body.error).toBe('Failed to fetch users');
    });
  });
});

// ===========================================================================
// CLIPS
// ===========================================================================

describe('Admin Clips API', () => {
  describe('GET /api/admin/clips', () => {
    it('returns clips for the active season', async () => {
      const clips = [
        { id: 'clip-1', title: 'Cool Clip', status: 'active', vote_count: 10, season_id: 's1', slot_position: 1 },
        { id: 'clip-2', title: 'Another Clip', status: 'active', vote_count: 5, season_id: 's1', slot_position: 1 },
      ];
      // The clips route calls from('tournament_clips') FIRST (to build the query),
      // then from('seasons') SECOND (to look up the active season).
      // The tournament_clips chain is awaited last (after .range()), so it needs
      // the clips data. The seasons chain is awaited in the middle.
      const seq = createSequentialMock([
        // 0: from('tournament_clips') - main query (awaited last)
        { data: clips, count: 2 },
        // 1: from('seasons') - active season lookup (awaited in the middle)
        { data: { id: 's1' } },
      ]);
      mockCreateClient.mockReturnValue(seq);

      const req = createMockRequest('/api/admin/clips');
      const res = await clipsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.clips).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('returns 403 when not admin', async () => {
      mockRequireAdmin.mockResolvedValue(
        NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      );

      const req = createMockRequest('/api/admin/clips');
      const res = await clipsGet(req);
      const { status } = await parseResponse(res);

      expect(status).toBe(403);
    });

    it('returns 500 on DB error', async () => {
      // from('tournament_clips') is called first (main query), then from('seasons')
      const seq = createSequentialMock([
        // 0: from('tournament_clips') - fails
        { data: null, error: { message: 'connection lost' } },
        // 1: from('seasons') - active season lookup succeeds
        { data: { id: 's1' } },
      ]);
      mockCreateClient.mockReturnValue(seq);

      const req = createMockRequest('/api/admin/clips');
      const res = await clipsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(500);
      expect(body.error).toBe('Failed to fetch clips');
    });

    it('filters by season_id when provided', async () => {
      const clips = [{ id: 'clip-x', title: 'Specific Season Clip', season_id: 'season-42' }];
      const chain = createSupabaseChain({ data: clips, count: 1 });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/clips', {
        searchParams: { season_id: 'season-42' },
      });

      const res = await clipsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.clips).toHaveLength(1);
    });
  });
});

// ===========================================================================
// MODERATION
// ===========================================================================

describe('Admin Moderation API', () => {
  describe('GET /api/admin/moderation', () => {
    it('returns pending moderation queue', async () => {
      const pending = [
        { id: 'mc-1', video_url: 'https://cdn/v1.mp4', thumbnail_url: 'https://cdn/t1.jpg', username: 'alice', avatar_url: null, genre: 'action', slot_position: 1, created_at: '2026-01-01', moderation_status: 'pending' },
        { id: 'mc-2', video_url: 'https://cdn/v2.mp4', thumbnail_url: 'https://cdn/t2.jpg', username: 'bob', avatar_url: null, genre: 'comedy', slot_position: 2, created_at: '2026-01-02', moderation_status: 'pending' },
      ];
      const chain = createSupabaseChain({ data: pending, count: 2 });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/moderation');
      const res = await moderationGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.queue).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.page).toBe(1);
      expect(body.queue[0].moderation_status).toBe('pending');
    });

    it('returns 403 when not admin', async () => {
      mockRequireAdmin.mockResolvedValue(
        NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      );

      const req = createMockRequest('/api/admin/moderation');
      const res = await moderationGet(req);
      const { status } = await parseResponse(res);

      expect(status).toBe(403);
    });
  });

  describe('POST /api/admin/moderation (approve)', () => {
    it('approves a clip and sets status to active', async () => {
      const approvedClip = { id: 'mc-1', moderation_status: 'approved', status: 'active', username: 'alice' };
      const chain = createSupabaseChain({ data: approvedClip });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/moderation', {
        method: 'POST',
        body: { clip_id: 'mc-1' },
      });

      const res = await moderationPost(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.clip.moderation_status).toBe('approved');
      expect(body.message).toBe('Clip approved successfully');
      expect(logAdminAction).toHaveBeenCalled();
    });

    it('returns 400 when clip_id is missing', async () => {
      const req = createMockRequest('/api/admin/moderation', {
        method: 'POST',
        body: {},
      });

      const res = await moderationPost(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toBe('clip_id is required');
    });
  });

  describe('DELETE /api/admin/moderation (reject)', () => {
    it('rejects a clip with a reason', async () => {
      const rejectedClip = { id: 'mc-3', moderation_status: 'rejected', status: 'rejected', username: 'eve' };
      const chain = createSupabaseChain({ data: rejectedClip });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/moderation', {
        method: 'DELETE',
        body: { clip_id: 'mc-3', reason: 'Inappropriate content' },
      });

      const res = await moderationDelete(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.clip.moderation_status).toBe('rejected');
      expect(body.message).toBe('Clip rejected successfully');
      expect(logAdminAction).toHaveBeenCalled();
    });

    it('returns 400 when clip_id is missing', async () => {
      const req = createMockRequest('/api/admin/moderation', {
        method: 'DELETE',
        body: {},
      });

      const res = await moderationDelete(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toBe('clip_id is required');
    });
  });

  describe('PATCH /api/admin/moderation (batch)', () => {
    it('batch approves multiple clips', async () => {
      const updated = [
        { id: 'mc-1', moderation_status: 'approved', status: 'active' },
        { id: 'mc-2', moderation_status: 'approved', status: 'active' },
      ];
      const chain = createSupabaseChain({ data: updated });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/moderation', {
        method: 'PATCH',
        body: { clip_ids: ['mc-1', 'mc-2'], action: 'approve' },
      });

      const res = await moderationPatch(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.updated_count).toBe(2);
      expect(body.message).toContain('approved');
    });

    it('returns 400 when clip_ids is empty', async () => {
      const req = createMockRequest('/api/admin/moderation', {
        method: 'PATCH',
        body: { clip_ids: [], action: 'approve' },
      });

      const res = await moderationPatch(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toBe('clip_ids array is required');
    });

    it('returns 400 for invalid action', async () => {
      const req = createMockRequest('/api/admin/moderation', {
        method: 'PATCH',
        body: { clip_ids: ['mc-1'], action: 'delete' },
      });

      const res = await moderationPatch(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toContain('action must be');
    });

    it('returns 400 when batch exceeds 100 clips', async () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => `clip-${i}`);

      const req = createMockRequest('/api/admin/moderation', {
        method: 'PATCH',
        body: { clip_ids: tooMany, action: 'approve' },
      });

      const res = await moderationPatch(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.error).toContain('Maximum 100');
    });
  });
});

// ===========================================================================
// AUDIT LOGS
// ===========================================================================

describe('Admin Audit Logs API', () => {
  describe('GET /api/admin/audit-logs', () => {
    it('returns paginated audit log entries', async () => {
      const logs = [
        { id: 'log-1', action: 'create_season', resource_type: 'season', resource_id: 's1', admin_email: TEST_ADMIN.email, details: {}, created_at: '2026-01-02' },
        { id: 'log-2', action: 'toggle_feature', resource_type: 'feature_flag', resource_id: 'dark_mode', admin_email: TEST_ADMIN.email, details: {}, created_at: '2026-01-01' },
      ];
      const chain = createSupabaseChain({ data: logs, count: 25 });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/audit-logs', {
        searchParams: { page: '1', limit: '50' },
      });

      const res = await auditLogsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.logs).toHaveLength(2);
      expect(body.total).toBe(25);
      expect(body.page).toBe(1);
      expect(body.totalPages).toBe(1); // ceil(25/50)
    });

    it('returns 403 when not admin', async () => {
      mockRequireAdmin.mockResolvedValue(
        NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      );

      const req = createMockRequest('/api/admin/audit-logs');
      const res = await auditLogsGet(req);
      const { status } = await parseResponse(res);

      expect(status).toBe(403);
    });

    it('returns 500 on DB error', async () => {
      const chain = createSupabaseChain({ data: null, error: { message: 'timeout' } });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/audit-logs');
      const res = await auditLogsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(500);
      expect(body.error).toBe('Failed to fetch audit logs');
    });

    it('filters by action type', async () => {
      const logs = [
        { id: 'log-3', action: 'approve_clip', resource_type: 'clip', resource_id: 'c1', admin_email: TEST_ADMIN.email, details: {}, created_at: '2026-01-03' },
      ];
      const chain = createSupabaseChain({ data: logs, count: 1 });
      mockCreateClient.mockReturnValue({ from: jest.fn(() => chain) });

      const req = createMockRequest('/api/admin/audit-logs', {
        searchParams: { action: 'approve_clip' },
      });

      const res = await auditLogsGet(req);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(200);
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].action).toBe('approve_clip');
    });
  });
});
