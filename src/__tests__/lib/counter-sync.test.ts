/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/crdt-vote-counter', () => ({
  getCountsForClips: jest.fn(),
}));

// Import the mock after jest.mock so we can control it in tests
import { getCountsForClips as _mockGetCountsForClips } from '@/lib/crdt-vote-counter';
const mockGetCountsForClips = _mockGetCountsForClips as jest.Mock;

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { forceSyncCounters } from '@/lib/counter-sync';
import type { SyncResult } from '@/lib/counter-sync';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockSupabase(rpcResult: { data: any; error: any }) {
  return {
    rpc: jest.fn().mockResolvedValue(rpcResult),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('counter-sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // Empty input
  // =========================================================================
  describe('forceSyncCounters with empty input', () => {
    it('returns synced: 0 and empty errors for empty clipIds', async () => {
      const supabase = makeMockSupabase({ data: null, error: null });

      const result = await forceSyncCounters(supabase, []);

      expect(result).toEqual({ synced: 0, errors: [] });
      expect(mockGetCountsForClips).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Successful sync
  // =========================================================================
  describe('forceSyncCounters with valid data', () => {
    it('reads CRDT counters and calls batch_update_vote_counts RPC', async () => {
      const counters = new Map([
        ['clip-1', { voteCount: 10, weightedScore: 25 }],
        ['clip-2', { voteCount: 5, weightedScore: 12 }],
      ]);
      mockGetCountsForClips.mockResolvedValueOnce(counters);

      const supabase = makeMockSupabase({
        data: { updated_count: 2, errors: [] },
        error: null,
      });

      const result = await forceSyncCounters(supabase, ['clip-1', 'clip-2']);

      expect(mockGetCountsForClips).toHaveBeenCalledWith(['clip-1', 'clip-2']);
      expect(supabase.rpc).toHaveBeenCalledWith('batch_update_vote_counts', {
        p_updates: expect.arrayContaining([
          { clip_id: 'clip-1', vote_count: 10, weighted_score: 25 },
          { clip_id: 'clip-2', vote_count: 5, weighted_score: 12 },
        ]),
      });
      expect(result).toEqual({ synced: 2, errors: [] });
    });

    it('defaults synced count to updates.length when RPC returns null result', async () => {
      const counters = new Map([
        ['clip-1', { voteCount: 3, weightedScore: 7 }],
      ]);
      mockGetCountsForClips.mockResolvedValueOnce(counters);

      const supabase = makeMockSupabase({ data: null, error: null });

      const result = await forceSyncCounters(supabase, ['clip-1']);

      expect(result.synced).toBe(1);
      expect(result.errors).toEqual([]);
    });
  });

  // =========================================================================
  // Empty counters from CRDT
  // =========================================================================
  describe('forceSyncCounters when CRDT returns empty map', () => {
    it('returns synced: 0 without calling RPC', async () => {
      mockGetCountsForClips.mockResolvedValueOnce(new Map());

      const supabase = makeMockSupabase({ data: null, error: null });

      const result = await forceSyncCounters(supabase, ['clip-1']);

      expect(supabase.rpc).not.toHaveBeenCalled();
      expect(result).toEqual({ synced: 0, errors: [] });
    });
  });

  // =========================================================================
  // RPC error handling
  // =========================================================================
  describe('forceSyncCounters RPC error', () => {
    it('returns batch error when RPC fails', async () => {
      const counters = new Map([
        ['clip-1', { voteCount: 1, weightedScore: 1 }],
      ]);
      mockGetCountsForClips.mockResolvedValueOnce(counters);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const supabase = makeMockSupabase({
        data: null,
        error: { message: 'connection timeout' },
      });

      const result = await forceSyncCounters(supabase, ['clip-1']);

      expect(result.synced).toBe(0);
      expect(result.errors).toEqual([{ clip_id: 'batch', error: 'connection timeout' }]);
      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // RPC partial errors
  // =========================================================================
  describe('forceSyncCounters with partial RPC errors', () => {
    it('propagates per-clip errors from the RPC response', async () => {
      const counters = new Map([
        ['clip-1', { voteCount: 10, weightedScore: 25 }],
        ['clip-2', { voteCount: 5, weightedScore: 12 }],
      ]);
      mockGetCountsForClips.mockResolvedValueOnce(counters);

      const supabase = makeMockSupabase({
        data: {
          updated_count: 1,
          errors: [{ clip_id: 'clip-2', error: 'constraint violation' }],
        },
        error: null,
      });

      const result = await forceSyncCounters(supabase, ['clip-1', 'clip-2']);

      expect(result.synced).toBe(1);
      expect(result.errors).toEqual([
        { clip_id: 'clip-2', error: 'constraint violation' },
      ]);
    });
  });

  // =========================================================================
  // Correct payload structure
  // =========================================================================
  describe('forceSyncCounters payload structure', () => {
    it('builds update payload with clip_id, vote_count, weighted_score', async () => {
      const counters = new Map([
        ['abc-123', { voteCount: 42, weightedScore: 99.5 }],
      ]);
      mockGetCountsForClips.mockResolvedValueOnce(counters);

      const supabase = makeMockSupabase({
        data: { updated_count: 1, errors: [] },
        error: null,
      });

      await forceSyncCounters(supabase, ['abc-123']);

      const payload = supabase.rpc.mock.calls[0][1].p_updates;
      expect(payload).toHaveLength(1);
      expect(payload[0]).toEqual({
        clip_id: 'abc-123',
        vote_count: 42,
        weighted_score: 99.5,
      });
    });
  });
});
