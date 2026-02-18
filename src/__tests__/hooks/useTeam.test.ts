// Tests for useTeam hooks (useUserTeam, useTeamDetail, useCreateTeam, useJoinTeam, useLeaveTeam, etc.)

import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Must be before the import of the hooks
const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  useUserTeam,
  useTeamDetail,
  useTeamMembers,
  useCreateTeam,
  useJoinTeam,
  useLeaveTeam,
  useTeamLeaderboard,
  useKickMember,
} from '@/hooks/useTeam';

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

describe('useTeam hooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set a CSRF cookie so ensureCsrfToken() returns immediately (no fetch + setTimeout)
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: 'csrf-token=test-csrf-token',
    });
  });

  // ===========================================================================
  // useUserTeam
  // ===========================================================================

  describe('useUserTeam', () => {
    it('fetches user team data successfully', async () => {
      const teamData = {
        ok: true,
        team: { id: 'team-1', name: 'Test Team', member_count: 3 },
        membership: { role: 'leader', joined_at: '2026-01-01T00:00:00Z' },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(teamData),
      });

      const { result } = renderHook(() => useUserTeam(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(teamData);
      expect(mockFetch).toHaveBeenCalledWith('/api/teams?mode=my-team');
    });

    it('returns error when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const { result } = renderHook(() => useUserTeam(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });

  // ===========================================================================
  // useTeamDetail
  // ===========================================================================

  describe('useTeamDetail', () => {
    it('fetches team detail when teamId is provided', async () => {
      const teamDetail = {
        ok: true,
        team: { id: 'team-1', name: 'Alpha Squad', member_count: 5 },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(teamDetail),
      });

      const { result } = renderHook(() => useTeamDetail('team-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(teamDetail);
      expect(mockFetch).toHaveBeenCalledWith('/api/teams/team-1');
    });

    it('does not fetch when teamId is null', () => {
      const { result } = renderHook(() => useTeamDetail(null), {
        wrapper: createWrapper(),
      });

      expect(result.current.fetchStatus).toBe('idle');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // useTeamMembers
  // ===========================================================================

  describe('useTeamMembers', () => {
    it('fetches members for a given team', async () => {
      const membersData = {
        ok: true,
        members: [
          { id: 'u1', username: 'alice', role: 'leader' },
          { id: 'u2', username: 'bob', role: 'member' },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(membersData),
      });

      const { result } = renderHook(() => useTeamMembers('team-1'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.members).toHaveLength(2);
    });
  });

  // ===========================================================================
  // useCreateTeam
  // ===========================================================================

  describe('useCreateTeam', () => {
    it('creates a team successfully', async () => {
      const createResponse = { ok: true, team: { id: 'new-team', name: 'New Team' } };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createResponse),
      });

      const { result } = renderHook(() => useCreateTeam(), { wrapper: createWrapper() });

      act(() => {
        result.current.mutate({ name: 'New Team', description: 'A test team' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Verify POST was called to /api/teams
      const postCall = mockFetch.mock.calls.find(
        (call) => call[0] === '/api/teams' && call[1]?.method === 'POST'
      );
      expect(postCall).toBeDefined();
      // Verify CSRF token header was sent
      expect(postCall![1].headers['x-csrf-token']).toBe('test-csrf-token');
    });

    it('handles creation error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Name already taken' }),
      });

      const { result } = renderHook(() => useCreateTeam(), { wrapper: createWrapper() });

      act(() => {
        result.current.mutate({ name: 'Duplicate' });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Name already taken');
    });
  });

  // ===========================================================================
  // useJoinTeam
  // ===========================================================================

  describe('useJoinTeam', () => {
    it('joins a team via invite code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, team_id: 'team-abc' }),
      });

      const { result } = renderHook(() => useJoinTeam(), { wrapper: createWrapper() });

      act(() => {
        result.current.mutate('INVITE123');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const joinCall = mockFetch.mock.calls.find(
        (call) => call[0] === '/api/teams/join' && call[1]?.method === 'POST'
      );
      expect(joinCall).toBeDefined();
      expect(JSON.parse(joinCall![1].body)).toEqual({ code: 'INVITE123' });
    });
  });

  // ===========================================================================
  // useLeaveTeam
  // ===========================================================================

  describe('useLeaveTeam', () => {
    it('leaves a team successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const { result } = renderHook(() => useLeaveTeam(), { wrapper: createWrapper() });

      act(() => {
        result.current.mutate('team-1');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const leaveCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/members') && call[1]?.method === 'DELETE'
      );
      expect(leaveCall).toBeDefined();
    });
  });

  // ===========================================================================
  // useTeamLeaderboard
  // ===========================================================================

  describe('useTeamLeaderboard', () => {
    it('fetches leaderboard with default pagination', async () => {
      const leaderboardData = {
        ok: true,
        teams: [{ id: 't1', name: 'Top Team', total_votes: 100 }],
        total: 1,
        offset: 0,
        limit: 20,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(leaderboardData),
      });

      const { result } = renderHook(() => useTeamLeaderboard(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.teams).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith('/api/teams?limit=20&offset=0');
    });
  });

  // ===========================================================================
  // useKickMember
  // ===========================================================================

  describe('useKickMember', () => {
    it('kicks a member from the team', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const { result } = renderHook(() => useKickMember(), { wrapper: createWrapper() });

      act(() => {
        result.current.mutate({ teamId: 'team-1', userId: 'user-bad' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const kickCall = mockFetch.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('user_id=user-bad')
      );
      expect(kickCall).toBeDefined();
    });
  });
});
