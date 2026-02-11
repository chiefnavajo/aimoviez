'use client';

import { useQuery } from '@tanstack/react-query';

interface MovieProject {
  id: string;
  title: string;
  description: string;
  model: string;
  style: string | null;
  voice_id: string | null;
  aspect_ratio: string;
  target_duration_minutes: number;
  status: string;
  total_scenes: number;
  completed_scenes: number;
  current_scene: number;
  estimated_credits: number;
  spent_credits: number;
  final_video_url: string | null;
  total_duration_seconds: number | null;
  error_message: string | null;
  script_data: unknown;
  source_text: string;
  source_text_length: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface MovieScene {
  id: string;
  scene_number: number;
  scene_title: string;
  video_prompt: string;
  narration_text: string | null;
  status: string;
  video_url: string | null;
  public_video_url: string | null;
  last_frame_url: string | null;
  duration_seconds: number | null;
  credit_cost: number;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
}

interface MovieProjectResponse {
  project: MovieProject;
  scenes: MovieScene[];
}

interface MovieAccessResponse {
  has_access: boolean;
  is_admin?: boolean;
  reason?: string;
  max_projects?: number;
  max_scenes_per_project?: number;
  projects_used?: number;
  expires_at?: string | null;
}

export function useMovieProject(projectId: string | null) {
  const { data, isLoading, error, refetch } = useQuery<MovieProjectResponse>({
    queryKey: ['movie-project', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/movie/projects/${projectId}`);
      if (!res.ok) throw new Error('Failed to fetch project');
      return res.json();
    },
    enabled: !!projectId,
    // Poll every 10s during generation
    refetchInterval: (query) => {
      const status = query.state.data?.project?.status;
      if (status === 'generating' || status === 'script_generating') return 10_000;
      return false;
    },
    staleTime: 5_000,
  });

  return {
    project: data?.project || null,
    scenes: data?.scenes || [],
    isLoading,
    error,
    refetch,
  };
}

export function useMovieProjects() {
  const { data, isLoading, error, refetch } = useQuery<{ projects: MovieProject[] }>({
    queryKey: ['movie-projects'],
    queryFn: async () => {
      const res = await fetch('/api/movie/projects');
      if (!res.ok) throw new Error('Failed to fetch projects');
      return res.json();
    },
    staleTime: 30_000,
  });

  return {
    projects: data?.projects || [],
    isLoading,
    error,
    refetch,
  };
}

export function useMovieAccess() {
  const { data, isLoading, error } = useQuery<MovieAccessResponse>({
    queryKey: ['movie-access'],
    queryFn: async () => {
      const res = await fetch('/api/movie/access');
      if (!res.ok) throw new Error('Failed to check access');
      return res.json();
    },
    staleTime: 60_000,
  });

  return {
    hasAccess: data?.has_access ?? false,
    isAdmin: data?.is_admin ?? false,
    reason: data?.reason,
    maxProjects: data?.max_projects,
    projectsUsed: data?.projects_used,
    isLoading,
    error,
  };
}

export type { MovieProject, MovieScene, MovieAccessResponse };
