// Tests for useMovieProject, useMovieProjects, useMovieAccess hooks

import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { useMovieProject, useMovieProjects, useMovieAccess } from '@/hooks/useMovieProject';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useMovieProject hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // useMovieProject
  // ===========================================================================

  describe('useMovieProject', () => {
    it('fetches project and scenes by ID', async () => {
      const projectData = {
        project: {
          id: 'proj-1',
          title: 'My Movie',
          description: 'A test movie',
          model: 'minimax',
          style: null,
          voice_id: null,
          aspect_ratio: '16:9',
          target_duration_minutes: 5,
          status: 'completed',
          total_scenes: 3,
          completed_scenes: 3,
          current_scene: 3,
          estimated_credits: 30,
          spent_credits: 28,
          final_video_url: 'https://cdn.example.com/video.mp4',
          total_duration_seconds: 300,
          error_message: null,
          script_data: {},
          source_text: 'Once upon a time...',
          source_text_length: 19,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T01:00:00Z',
          completed_at: '2026-01-01T02:00:00Z',
        },
        scenes: [
          { id: 's1', scene_number: 1, scene_title: 'Intro', status: 'completed' },
          { id: 's2', scene_number: 2, scene_title: 'Middle', status: 'completed' },
          { id: 's3', scene_number: 3, scene_title: 'End', status: 'completed' },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(projectData),
      });

      const { result } = renderHook(() => useMovieProject('proj-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.project?.id).toBe('proj-1');
      expect(result.current.project?.title).toBe('My Movie');
      expect(result.current.scenes).toHaveLength(3);
      expect(result.current.error).toBeNull();
      expect(mockFetch).toHaveBeenCalledWith('/api/movie/projects/proj-1');
    });

    it('does not fetch when projectId is null', () => {
      const { result } = renderHook(() => useMovieProject(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.project).toBeNull();
      expect(result.current.scenes).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns empty scenes on fetch error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const { result } = renderHook(() => useMovieProject('missing-proj'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.project).toBeNull();
      expect(result.current.scenes).toEqual([]);
      expect(result.current.error).toBeInstanceOf(Error);
    });

    it('provides a refetch function', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              project: { id: 'p1', status: 'generating', title: 'WIP' },
              scenes: [],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              project: { id: 'p1', status: 'completed', title: 'WIP' },
              scenes: [{ id: 's1', scene_number: 1 }],
            }),
        });

      const { result } = renderHook(() => useMovieProject('p1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.project?.status).toBe('generating'));

      await result.current.refetch();

      await waitFor(() => expect(result.current.project?.status).toBe('completed'));
    });
  });

  // ===========================================================================
  // useMovieProjects (list)
  // ===========================================================================

  describe('useMovieProjects', () => {
    it('fetches list of projects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            projects: [
              { id: 'p1', title: 'Movie 1', status: 'completed' },
              { id: 'p2', title: 'Movie 2', status: 'generating' },
            ],
          }),
      });

      const { result } = renderHook(() => useMovieProjects(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.projects).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith('/api/movie/projects');
    });

    it('returns empty array on error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const { result } = renderHook(() => useMovieProjects(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.projects).toEqual([]);
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });

  // ===========================================================================
  // useMovieAccess
  // ===========================================================================

  describe('useMovieAccess', () => {
    it('returns access granted for authorized user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            has_access: true,
            is_admin: false,
            max_projects: 5,
            max_scenes_per_project: 20,
            projects_used: 2,
          }),
      });

      const { result } = renderHook(() => useMovieAccess(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.hasAccess).toBe(true);
      expect(result.current.isAdmin).toBe(false);
      expect(result.current.maxProjects).toBe(5);
      expect(result.current.projectsUsed).toBe(2);
      expect(mockFetch).toHaveBeenCalledWith('/api/movie/access');
    });

    it('returns no access when unauthorized', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            has_access: false,
            reason: 'No active subscription',
          }),
      });

      const { result } = renderHook(() => useMovieAccess(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.hasAccess).toBe(false);
      expect(result.current.reason).toBe('No active subscription');
    });

    it('defaults to no access on fetch error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const { result } = renderHook(() => useMovieAccess(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.hasAccess).toBe(false);
      expect(result.current.isAdmin).toBe(false);
    });
  });
});
