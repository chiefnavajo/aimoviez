// app/team/page.tsx
// Team Dashboard - Shows user's team or create/join options

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Users, Plus, UserPlus, Trophy, Loader2 } from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';
import { AuthGuard } from '@/hooks/useAuth';
import { useUserTeam } from '@/hooks/useTeam';
import {
  TeamDashboard,
  TeamCreateModal,
  TeamJoinModal,
} from '@/components/team';
import type { TeamRole } from '@/types';

function TeamPageContent() {
  const { data, isLoading, error, refetch } = useUserTeam();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-purple-500" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
        <div className="text-red-400 text-center mb-4">
          Failed to load team data
        </div>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg"
        >
          Retry
        </button>
      </div>
    );
  }

  const hasTeam = !!data?.team;
  const team = data?.team;
  const userRole = (data?.membership?.role as TeamRole) || 'member';

  return (
    <div className="min-h-screen bg-black pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-black/95 backdrop-blur-sm border-b border-gray-800">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="text-purple-400" size={24} />
              <h1 className="text-xl font-bold text-white">
                {hasTeam ? 'My Team' : 'Dream Teams'}
              </h1>
            </div>
            {hasTeam && (
              <Link
                href="/teams"
                className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                <Trophy size={16} />
                Leaderboard
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {hasTeam && team ? (
          <TeamDashboard
            team={team}
            userRole={userRole}
            onTeamLeft={() => refetch()}
          />
        ) : (
          <NoTeamView
            onCreateClick={() => setShowCreateModal(true)}
            onJoinClick={() => setShowJoinModal(true)}
          />
        )}
      </div>

      {/* Modals */}
      <TeamCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => refetch()}
      />
      <TeamJoinModal
        isOpen={showJoinModal}
        onClose={() => setShowJoinModal(false)}
        onSuccess={() => refetch()}
      />

      <BottomNavigation />
    </div>
  );
}

// No team state - show create/join options
function NoTeamView({
  onCreateClick,
  onJoinClick,
}: {
  onCreateClick: () => void;
  onJoinClick: () => void;
}) {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center py-8">
        <div className="w-20 h-20 mx-auto bg-purple-600/20 rounded-full flex items-center justify-center mb-4">
          <Users className="text-purple-400" size={40} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Join a Dream Team</h2>
        <p className="text-gray-400 max-w-md mx-auto">
          Team up with friends to get vote multipliers, compete on team
          leaderboards, and maintain streaks together.
        </p>
      </div>

      {/* Actions */}
      <div className="grid gap-4 sm:grid-cols-2">
        <button
          onClick={onCreateClick}
          className="flex flex-col items-center gap-3 p-6 bg-gradient-to-br from-purple-900/50 to-purple-800/30 border border-purple-500/30 rounded-2xl hover:border-purple-500/50 transition-colors"
        >
          <div className="w-14 h-14 bg-purple-600 rounded-full flex items-center justify-center">
            <Plus className="text-white" size={28} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Create a Team</h3>
            <p className="text-sm text-gray-400">
              Start your own team and invite friends
            </p>
          </div>
        </button>

        <button
          onClick={onJoinClick}
          className="flex flex-col items-center gap-3 p-6 bg-gradient-to-br from-green-900/30 to-green-800/20 border border-green-500/30 rounded-2xl hover:border-green-500/50 transition-colors"
        >
          <div className="w-14 h-14 bg-green-600 rounded-full flex items-center justify-center">
            <UserPlus className="text-white" size={28} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">Join a Team</h3>
            <p className="text-sm text-gray-400">
              Have an invite code? Join an existing team
            </p>
          </div>
        </button>
      </div>

      {/* Benefits */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white">Team Benefits</h3>
        <div className="grid gap-3">
          <BenefitCard
            title="Vote Multiplier"
            description="Get 1.5x votes when 3+ team members vote for the same clip"
            color="yellow"
          />
          <BenefitCard
            title="Team Streaks"
            description="Keep the whole team active to maintain your streak"
            color="orange"
          />
          <BenefitCard
            title="Leaderboard Glory"
            description="Compete as a team on dedicated team rankings"
            color="purple"
          />
          <BenefitCard
            title="Team Chat"
            description="Coordinate with your team in real-time"
            color="blue"
          />
        </div>
      </div>

      {/* Browse Teams */}
      <div className="text-center pt-4">
        <Link
          href="/teams"
          className="inline-flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors"
        >
          <Trophy size={16} />
          Browse Team Leaderboard
        </Link>
      </div>
    </div>
  );
}

function BenefitCard({
  title,
  description,
  color,
}: {
  title: string;
  description: string;
  color: 'yellow' | 'orange' | 'purple' | 'blue';
}) {
  const colorClasses = {
    yellow: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500',
    orange: 'bg-orange-500/10 border-orange-500/30 text-orange-500',
    purple: 'bg-purple-500/10 border-purple-500/30 text-purple-400',
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
  };

  return (
    <div className={`p-4 rounded-xl border ${colorClasses[color]}`}>
      <h4 className="font-medium mb-1">{title}</h4>
      <p className="text-sm text-gray-400">{description}</p>
    </div>
  );
}

export default function TeamPage() {
  return (
    <AuthGuard>
      <TeamPageContent />
    </AuthGuard>
  );
}
