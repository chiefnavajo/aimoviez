// hooks/useTeam.ts
// React Query hooks for Dream Teams feature

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TeamWithStats, TeamMember, TeamInvite, TeamLeaderboardEntry } from '@/types';

// ===========================
// CSRF HELPER
// ===========================

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'csrf-token') return value;
  }
  return null;
}

/** Ensure CSRF cookie exists; fetch from /api/csrf if missing */
async function ensureCsrfToken(): Promise<string | null> {
  let token = getCsrfToken();
  if (token) return token;

  try {
    await fetch('/api/csrf', { credentials: 'include' });
    // Wait briefly for cookie to be set
    await new Promise(r => setTimeout(r, 100));
    token = getCsrfToken();
  } catch {
    // Non-fatal
  }
  return token;
}

async function csrfHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  const token = await ensureCsrfToken();
  if (token) headers['x-csrf-token'] = token;
  return headers;
}

// ===========================
// GET USER'S TEAM
// ===========================

interface UserTeamResponse {
  ok: boolean;
  team: TeamWithStats | null;
  membership?: {
    role: string;
    joined_at: string;
  };
}

export function useUserTeam() {
  return useQuery<UserTeamResponse>({
    queryKey: ['user-team'],
    queryFn: async () => {
      const res = await fetch('/api/teams?my=true');
      if (!res.ok) throw new Error('Failed to fetch team');
      return res.json();
    },
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: true,
  });
}

// ===========================
// GET TEAM BY ID
// ===========================

interface TeamDetailResponse {
  ok: boolean;
  team: TeamWithStats;
}

export function useTeamDetail(teamId: string | null) {
  return useQuery<TeamDetailResponse>({
    queryKey: ['team', teamId],
    queryFn: async () => {
      if (!teamId) throw new Error('No team ID');
      const res = await fetch(`/api/teams/${teamId}`);
      if (!res.ok) throw new Error('Failed to fetch team');
      return res.json();
    },
    enabled: !!teamId,
    staleTime: 30 * 1000,
  });
}

// ===========================
// GET TEAM MEMBERS
// ===========================

interface MembersResponse {
  ok: boolean;
  members: TeamMember[];
}

export function useTeamMembers(teamId: string | null) {
  return useQuery<MembersResponse>({
    queryKey: ['team-members', teamId],
    queryFn: async () => {
      if (!teamId) throw new Error('No team ID');
      const res = await fetch(`/api/teams/${teamId}/members`);
      if (!res.ok) throw new Error('Failed to fetch members');
      return res.json();
    },
    enabled: !!teamId,
    staleTime: 30 * 1000,
  });
}

// ===========================
// GET TEAM INVITES
// ===========================

interface InvitesResponse {
  ok: boolean;
  invites: TeamInvite[];
}

export function useTeamInvites(teamId: string | null) {
  return useQuery<InvitesResponse>({
    queryKey: ['team-invites', teamId],
    queryFn: async () => {
      if (!teamId) throw new Error('No team ID');
      const res = await fetch(`/api/teams/${teamId}/invites`);
      if (!res.ok) throw new Error('Failed to fetch invites');
      return res.json();
    },
    enabled: !!teamId,
    staleTime: 60 * 1000,
  });
}

// ===========================
// GET TEAM LEADERBOARD
// ===========================

interface LeaderboardResponse {
  ok: boolean;
  teams: TeamLeaderboardEntry[];
  total: number;
  page: number;
  limit: number;
}

export function useTeamLeaderboard(page: number = 1, limit: number = 20) {
  return useQuery<LeaderboardResponse>({
    queryKey: ['team-leaderboard', page, limit],
    queryFn: async () => {
      const res = await fetch(`/api/teams?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error('Failed to fetch leaderboard');
      return res.json();
    },
    staleTime: 60 * 1000,
  });
}

// ===========================
// MUTATIONS
// ===========================

// Create Team
interface CreateTeamParams {
  name: string;
  description?: string;
}

export function useCreateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateTeamParams) => {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: await csrfHeaders(),
        body: JSON.stringify(params),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create team');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-team'] });
      queryClient.invalidateQueries({ queryKey: ['team-leaderboard'] });
    },
  });
}

// Join Team via Code
export function useJoinTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch('/api/teams/join', {
        method: 'POST',
        headers: await csrfHeaders(),
        body: JSON.stringify({ code }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join team');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-team'] });
    },
  });
}

// Leave Team
export function useLeaveTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (teamId: string) => {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: 'DELETE',
        headers: await csrfHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to leave team');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-team'] });
      queryClient.invalidateQueries({ queryKey: ['team-leaderboard'] });
    },
  });
}

// Kick Member
interface KickMemberParams {
  teamId: string;
  userId: string;
}

export function useKickMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ teamId, userId }: KickMemberParams) => {
      const res = await fetch(`/api/teams/${teamId}/members?user_id=${userId}`, {
        method: 'DELETE',
        headers: await csrfHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to kick member');
      return data;
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] });
      queryClient.invalidateQueries({ queryKey: ['team', teamId] });
    },
  });
}

// Update Member Role
interface UpdateRoleParams {
  teamId: string;
  userId: string;
  role: 'member' | 'officer';
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ teamId, userId, role }: UpdateRoleParams) => {
      const res = await fetch(`/api/teams/${teamId}/members`, {
        method: 'PATCH',
        headers: await csrfHeaders(),
        body: JSON.stringify({ user_id: userId, role }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update role');
      return data;
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ['team-members', teamId] });
    },
  });
}

// Create Invite
interface CreateInviteParams {
  teamId: string;
  max_uses?: number;
  expires_in_days?: number;
}

export function useCreateInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ teamId, ...params }: CreateInviteParams) => {
      const res = await fetch(`/api/teams/${teamId}/invites`, {
        method: 'POST',
        headers: await csrfHeaders(),
        body: JSON.stringify(params),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create invite');
      return data;
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ['team-invites', teamId] });
    },
  });
}

// Revoke Invite
interface RevokeInviteParams {
  teamId: string;
  inviteId: string;
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ teamId, inviteId }: RevokeInviteParams) => {
      const res = await fetch(`/api/teams/${teamId}/invites?invite_id=${inviteId}`, {
        method: 'DELETE',
        headers: await csrfHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to revoke invite');
      return data;
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ['team-invites', teamId] });
    },
  });
}

// Update Team
interface UpdateTeamParams {
  teamId: string;
  name?: string;
  description?: string;
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ teamId, ...params }: UpdateTeamParams) => {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: 'PATCH',
        headers: await csrfHeaders(),
        body: JSON.stringify(params),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update team');
      return data;
    },
    onSuccess: (_, { teamId }) => {
      queryClient.invalidateQueries({ queryKey: ['team', teamId] });
      queryClient.invalidateQueries({ queryKey: ['user-team'] });
    },
  });
}

// Disband Team
export function useDisbandTeam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (teamId: string) => {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: 'DELETE',
        headers: await csrfHeaders(),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to disband team');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-team'] });
      queryClient.invalidateQueries({ queryKey: ['team-leaderboard'] });
    },
  });
}
