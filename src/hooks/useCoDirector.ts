// hooks/useCoDirector.ts
// React Query hooks for AI Co-Director features
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Client-safe CSRF token getter (no server secrets needed)
function getCsrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'csrf-token') return value;
  }
  return null;
}

// ============================================================================
// TYPES
// ============================================================================

interface Brief {
  id: string;
  title: string;
  scene_description: string;
  visual_requirements: string;
  tone_guidance: string;
  continuity_notes: string | null;
  do_list: string | null;
  dont_list: string | null;
  example_prompts: string[];
  published_at: string;
}

interface BriefResponse {
  ok: boolean;
  has_brief: boolean;
  season_id?: string;
  season_label?: string;
  slot_position?: number;
  brief?: Brief;
  message?: string;
}

interface DirectionOption {
  id: string;
  title: string;
  description: string;
  mood: string | null;
  suggested_genre: string | null;
  visual_hints: string | null;
  vote_count: number;
}

interface DirectionsResponse {
  ok: boolean;
  season_id: string;
  slot_position: number;
  voting_open: boolean;
  voting_ends_at: string | null;
  directions: DirectionOption[];
  total_votes: number;
}

interface VoteStatusResponse {
  ok: boolean;
  season_id?: string;
  slot_position?: number;
  has_voted: boolean;
  voted_for: string | null;
}

interface VoteResponse {
  ok: boolean;
  message: string;
  vote_id: string;
  voted_for: string;
  changed: boolean;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook to fetch the published creative brief for the current slot
 * Used in BriefBanner on the /create page
 */
export function useBrief(genre?: string | null) {
  return useQuery<BriefResponse>({
    queryKey: ['co-director', 'brief', genre],
    queryFn: async () => {
      const genreQuery = genre ? `?genre=${encodeURIComponent(genre)}` : '';
      const res = await fetch(`/api/co-director/brief${genreQuery}`);
      if (!res.ok) {
        if (res.status === 404) {
          return { ok: true, has_brief: false };
        }
        throw new Error('Failed to fetch brief');
      }
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry if feature is disabled
  });
}

/**
 * Hook to fetch direction options for a specific slot
 * Used in direction voting UI
 */
export function useDirections(seasonId?: string, slotPosition?: number) {
  return useQuery<DirectionsResponse>({
    queryKey: ['co-director', 'directions', seasonId, slotPosition],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (seasonId) params.set('season_id', seasonId);
      if (slotPosition) params.set('slot_position', String(slotPosition));

      const res = await fetch(`/api/co-director/directions?${params}`);
      if (!res.ok) {
        if (res.status === 404) {
          return {
            ok: true,
            season_id: seasonId || '',
            slot_position: slotPosition || 0,
            voting_open: false,
            voting_ends_at: null,
            directions: [],
            total_votes: 0,
          };
        }
        throw new Error('Failed to fetch directions');
      }
      return res.json();
    },
    staleTime: 30 * 1000, // 30 seconds - voting counts can change
    enabled: true,
    retry: false,
  });
}

/**
 * Hook to get user's vote status for direction voting
 */
export function useDirectionVoteStatus(seasonId?: string, slotPosition?: number) {
  return useQuery<VoteStatusResponse>({
    queryKey: ['co-director', 'vote-status', seasonId, slotPosition],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (seasonId) params.set('season_id', seasonId);
      if (slotPosition) params.set('slot_position', String(slotPosition));

      const res = await fetch(`/api/co-director/direction-vote?${params}`);
      if (!res.ok) {
        if (res.status === 404) {
          return { ok: true, has_voted: false, voted_for: null };
        }
        throw new Error('Failed to fetch vote status');
      }
      return res.json();
    },
    staleTime: 60 * 1000, // 1 minute
    retry: false,
  });
}

/**
 * Hook to cast a direction vote
 */
export function useCastDirectionVote() {
  const queryClient = useQueryClient();

  return useMutation<VoteResponse, Error, string>({
    mutationFn: async (directionOptionId: string) => {
      const csrfToken = getCsrfTokenFromCookie();

      const res = await fetch('/api/co-director/direction-vote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify({ direction_option_id: directionOptionId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to cast vote');
      }

      return res.json();
    },
    onSuccess: () => {
      // Invalidate related queries to refresh vote counts
      queryClient.invalidateQueries({ queryKey: ['co-director', 'directions'] });
      queryClient.invalidateQueries({ queryKey: ['co-director', 'vote-status'] });
    },
  });
}

/**
 * Hook to check if direction voting is currently open
 * Returns simplified status for conditional rendering
 */
export function useIsDirectionVotingOpen() {
  const { data, isLoading } = useDirections();

  return {
    isOpen: data?.voting_open ?? false,
    endsAt: data?.voting_ends_at ?? null,
    isLoading,
    directions: data?.directions ?? [],
    totalVotes: data?.total_votes ?? 0,
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export type {
  Brief,
  BriefResponse,
  DirectionOption,
  DirectionsResponse,
  VoteStatusResponse,
  VoteResponse,
};
