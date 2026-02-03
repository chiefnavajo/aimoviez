// components/team/TeamDashboard.tsx
// Main team view with stats, members, and chat

'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  Users,
  Trophy,
  Vote,
  Zap,
  Settings,
  UserPlus,
  LogOut,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { useUserTeam, useLeaveTeam, useDisbandTeam } from '@/hooks/useTeam';
import { TeamMemberList } from './TeamMemberList';
import { TeamChat } from './TeamChat';
import { TeamStreakBadge } from './TeamStreakBadge';
import { TeamInviteModal } from './TeamInviteModal';
import type { TeamWithStats, TeamRole } from '@/types';

interface TeamDashboardProps {
  team: TeamWithStats;
  userRole: TeamRole;
  onTeamLeft?: () => void;
}

export function TeamDashboard({ team, userRole, onTeamLeft }: TeamDashboardProps) {
  const { user } = useAuth();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'members' | 'chat'>('members');

  const leaveMutation = useLeaveTeam();
  const disbandMutation = useDisbandTeam();

  const isLeader = userRole === 'leader';
  const currentUserId = user?.id;

  const handleLeave = async () => {
    const message = isLeader
      ? 'As the leader, leaving will disband the entire team. Are you sure?'
      : 'Are you sure you want to leave this team?';

    if (!confirm(message)) return;

    try {
      if (isLeader) {
        await disbandMutation.mutateAsync(team.id);
      } else {
        await leaveMutation.mutateAsync(team.id);
      }
      onTeamLeft?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to leave team');
    }
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <div className="space-y-6">
      {/* Team Header */}
      <div className="bg-gradient-to-br from-purple-900/50 to-gray-900 border border-purple-500/30 rounded-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-white">{team.name}</h1>
              <span className="text-sm text-purple-400 bg-purple-500/20 px-2 py-1 rounded-full">
                Level {team.level}
              </span>
            </div>
            {team.description && (
              <p className="text-gray-400 text-sm max-w-md">{team.description}</p>
            )}
          </div>

          <TeamStreakBadge
            currentStreak={team.current_streak}
            longestStreak={team.longest_streak}
            size="lg"
          />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <StatCard
            icon={<Users size={18} />}
            label="Members"
            value={`${team.member_count}/5`}
            color="purple"
          />
          <StatCard
            icon={<Zap size={18} />}
            label="Total XP"
            value={formatNumber(team.total_xp)}
            color="yellow"
          />
          <StatCard
            icon={<Vote size={18} />}
            label="Combined Votes"
            value={formatNumber(team.combined_votes)}
            color="blue"
          />
          <StatCard
            icon={<Trophy size={18} />}
            label="Wins"
            value={team.combined_wins.toString()}
            color="green"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 mt-6">
          {team.member_count < 5 && (
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors"
            >
              <UserPlus size={16} />
              Invite Members
            </button>
          )}

          {isLeader && (
            <button
              onClick={() => {/* TODO: Settings modal */}}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
            >
              <Settings size={16} />
              Team Settings
            </button>
          )}

          <button
            onClick={handleLeave}
            disabled={leaveMutation.isPending || disbandMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-lg font-medium transition-colors ml-auto"
          >
            {(leaveMutation.isPending || disbandMutation.isPending) ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <LogOut size={16} />
            )}
            {isLeader ? 'Disband Team' : 'Leave Team'}
          </button>
        </div>
      </div>

      {/* Multiplier Info */}
      <div className="bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-500/20 rounded-full flex items-center justify-center">
            <Zap className="text-yellow-500" size={20} />
          </div>
          <div>
            <h3 className="font-medium text-yellow-500">Vote Multiplier</h3>
            <p className="text-sm text-gray-400">
              When 3+ team members vote for the same clip, each vote counts as{' '}
              <span className="text-yellow-500 font-bold">1.5x</span>!
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-800 pb-2">
        <TabButton
          active={activeTab === 'members'}
          onClick={() => setActiveTab('members')}
        >
          <Users size={16} />
          Members
        </TabButton>
        <TabButton
          active={activeTab === 'chat'}
          onClick={() => setActiveTab('chat')}
        >
          <ChevronRight size={16} />
          Team Chat
        </TabButton>
      </div>

      {/* Tab Content */}
      {activeTab === 'members' ? (
        <TeamMemberList
          teamId={team.id}
          leaderId={team.leader_id}
          currentUserId={currentUserId}
          currentUserRole={userRole}
        />
      ) : (
        <TeamChat teamId={team.id} currentUserId={currentUserId} />
      )}

      {/* Invite Modal */}
      <TeamInviteModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        teamId={team.id}
        teamName={team.name}
        memberCount={team.member_count}
      />
    </div>
  );
}

// Stat card component
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: 'purple' | 'yellow' | 'blue' | 'green';
}

function StatCard({ icon, label, value, color }: StatCardProps) {
  const colorClasses = {
    purple: 'text-purple-400 bg-purple-500/10',
    yellow: 'text-yellow-500 bg-yellow-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    green: 'text-green-400 bg-green-500/10',
  };

  return (
    <div className="bg-gray-800/50 rounded-xl p-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${colorClasses[color]}`}>
        {icon}
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  );
}

// Tab button component
interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
        active
          ? 'bg-purple-600 text-white'
          : 'text-gray-400 hover:text-white hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
  );
}
