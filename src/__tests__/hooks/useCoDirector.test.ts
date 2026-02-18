// Tests for useCoDirector hooks (useBrief, useDirections, useDirectionVoteStatus, useCastDirectionVote)

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  useBrief,
  useDirections,
  useDirectionVoteStatus,
  useCastDirectionVote,
} from '@/hooks/useCoDirector';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useCoDirector hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear any CSRF cookies
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: '',
    });
  });

  // ===========================================================================
  // useBrief
  // ===========================================================================

  describe('useBrief', () => {
    it('fetches a published brief successfully', async () => {
      const briefData = {
        ok: true,
        has_brief: true,
        season_id: 'season-1',
        slot_position: 3,
        brief: {
          id: 'brief-1',
          title: 'The Chase Scene',
          scene_description: 'A high-speed pursuit through neon streets',
          visual_requirements: 'Dark lighting, rain effects',
          tone_guidance: 'Tense and fast-paced',
          continuity_notes: null,
          do_list: 'Include rain',
          dont_list: 'No daylight',
          example_prompts: ['A car races through a dark alley'],
          published_at: '2026-01-15T00:00:00Z',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(briefData),
      });

      const { result } = renderHook(() => useBrief(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.has_brief).toBe(true);
      expect(result.current.data?.brief?.title).toBe('The Chase Scene');
    });

    it('passes genre query parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, has_brief: false }),
      });

      renderHook(() => useBrief('horror'), { wrapper: createWrapper() });

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith('/api/co-director/brief?genre=horror')
      );
    });

    it('returns has_brief: false on 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const { result } = renderHook(() => useBrief(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.has_brief).toBe(false);
    });
  });

  // ===========================================================================
  // useDirections
  // ===========================================================================

  describe('useDirections', () => {
    it('fetches direction options', async () => {
      const directionsData = {
        ok: true,
        season_id: 'season-1',
        slot_position: 2,
        voting_open: true,
        voting_ends_at: '2026-02-01T12:00:00Z',
        directions: [
          { id: 'd1', title: 'Path A', description: 'Go left', mood: 'tense', suggested_genre: null, visual_hints: null, vote_count: 5 },
          { id: 'd2', title: 'Path B', description: 'Go right', mood: 'calm', suggested_genre: null, visual_hints: null, vote_count: 3 },
        ],
        total_votes: 8,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(directionsData),
      });

      const { result } = renderHook(() => useDirections('season-1', 2), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.directions).toHaveLength(2);
      expect(result.current.data?.voting_open).toBe(true);
      expect(result.current.data?.total_votes).toBe(8);
    });

    it('returns empty directions on 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const { result } = renderHook(() => useDirections('season-1', 5), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.directions).toEqual([]);
      expect(result.current.data?.voting_open).toBe(false);
    });
  });

  // ===========================================================================
  // useDirectionVoteStatus
  // ===========================================================================

  describe('useDirectionVoteStatus', () => {
    it('returns vote status when user has voted', async () => {
      const voteStatus = {
        ok: true,
        season_id: 'season-1',
        slot_position: 2,
        has_voted: true,
        voted_for: 'direction-abc',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(voteStatus),
      });

      const { result } = renderHook(() => useDirectionVoteStatus('season-1', 2), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.has_voted).toBe(true);
      expect(result.current.data?.voted_for).toBe('direction-abc');
    });

    it('returns has_voted: false on 404', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const { result } = renderHook(() => useDirectionVoteStatus(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.has_voted).toBe(false);
      expect(result.current.data?.voted_for).toBeNull();
    });
  });

  // ===========================================================================
  // useCastDirectionVote
  // ===========================================================================

  describe('useCastDirectionVote', () => {
    it('casts a vote successfully', async () => {
      const voteResponse = {
        ok: true,
        message: 'Vote recorded',
        vote_id: 'vote-1',
        voted_for: 'dir-option-1',
        changed: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(voteResponse),
      });

      const { result } = renderHook(() => useCastDirectionVote(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.mutate('dir-option-1');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.voted_for).toBe('dir-option-1');

      // Verify POST call
      const postCall = mockFetch.mock.calls.find(
        (call) => call[1]?.method === 'POST'
      );
      expect(postCall).toBeDefined();
      expect(JSON.parse(postCall![1].body)).toEqual({
        direction_option_id: 'dir-option-1',
      });
    });

    it('handles vote failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Voting is closed' }),
      });

      const { result } = renderHook(() => useCastDirectionVote(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.mutate('dir-option-1');
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Voting is closed');
    });
  });
});
