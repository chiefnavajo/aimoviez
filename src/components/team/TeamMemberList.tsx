// components/team/TeamMemberList.tsx
// List of team members with management actions

'use client';

import { TeamMemberCard } from './TeamMemberCard';
import { useTeamMembers, useKickMember, useUpdateMemberRole } from '@/hooks/useTeam';
import { Users, Loader2 } from 'lucide-react';
import type { TeamRole } from '@/types';

interface TeamMemberListProps {
  teamId: string;
  leaderId: string;
  currentUserId?: string;
  currentUserRole?: TeamRole;
}

export function TeamMemberList({
  teamId,
  leaderId,
  currentUserId,
  currentUserRole,
}: TeamMemberListProps) {
  const { data, isLoading, error } = useTeamMembers(teamId);
  const kickMutation = useKickMember();
  const updateRoleMutation = useUpdateMemberRole();

  const isLeader = currentUserRole === 'leader';
  const canManage = isLeader || currentUserRole === 'officer';

  const handleKick = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member from the team?')) {
      return;
    }
    try {
      await kickMutation.mutateAsync({ teamId, userId });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to kick member');
    }
  };

  const handlePromote = async (userId: string, newRole: TeamRole) => {
    const action = newRole === 'officer' ? 'promote' : 'demote';
    if (!confirm(`Are you sure you want to ${action} this member?`)) {
      return;
    }
    try {
      await updateRoleMutation.mutateAsync({ teamId, userId, role: newRole as 'member' | 'officer' });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="animate-spin text-purple-500" size={24} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-400">
        Failed to load team members
      </div>
    );
  }

  const members = data?.members || [];

  // Sort: leader first, then officers, then members
  const sortedMembers = [...members].sort((a, b) => {
    const roleOrder = { leader: 0, officer: 1, member: 2 };
    return roleOrder[a.role] - roleOrder[b.role];
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Users size={20} className="text-purple-400" />
          Team Members
        </h3>
        <span className="text-sm text-gray-400">{members.length}/5</span>
      </div>

      <div className="space-y-2">
        {sortedMembers.map((member) => (
          <TeamMemberCard
            key={member.id}
            member={member}
            isLeader={isLeader}
            canManage={canManage}
            currentUserId={currentUserId}
            onKick={handleKick}
            onPromote={handlePromote}
          />
        ))}
      </div>

      {members.length < 5 && (
        <div className="text-center py-3 text-gray-500 text-sm border border-dashed border-gray-700 rounded-xl">
          {5 - members.length} spots available
        </div>
      )}
    </div>
  );
}
