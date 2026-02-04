// app/teams/page.tsx
// Team Leaderboard - Ranked list of all teams

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Trophy, Users, ArrowLeft, Loader2 } from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';
import { useTeamLeaderboard, useUserTeam } from '@/hooks/useTeam';
import { TeamCard } from '@/components/team';

export default function TeamsPage() {
  const [page] = useState(1);
  const { data: leaderboardData, isLoading, error, refetch } = useTeamLeaderboard(page, 50);
  const { data: userTeamData } = useUserTeam();

  const userTeamId = userTeamData?.team?.id;

  return (
    <div className="min-h-screen bg-black pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-black/95 backdrop-blur-sm border-b border-gray-800">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href="/team"
                className="p-2 -ml-2 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} className="text-gray-400" />
              </Link>
              <div className="flex items-center gap-2">
                <Trophy className="text-yellow-500" size={24} />
                <h1 className="text-xl font-bold text-white">Team Leaderboard</h1>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Users size={16} />
              {leaderboardData?.total || 0} teams
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-purple-500" size={32} />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-400 mb-4">Failed to load teams.</p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : !leaderboardData?.teams?.length ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {/* User's team highlight (if not in top list) */}
            {userTeamId && !leaderboardData.teams.some(t => t.id === userTeamId) && userTeamData?.team && (
              <div className="mb-6">
                <div className="text-sm text-gray-400 mb-2">Your Team</div>
                <TeamCard
                  team={{
                    rank: -1, // Unranked
                    id: userTeamData.team.id,
                    name: userTeamData.team.name,
                    logo_url: userTeamData.team.logo_url,
                    level: userTeamData.team.level,
                    total_xp: userTeamData.team.total_xp,
                    current_streak: userTeamData.team.current_streak,
                    member_count: userTeamData.team.member_count,
                    combined_votes: userTeamData.team.combined_votes,
                    combined_wins: userTeamData.team.combined_wins,
                    leader_username: userTeamData.team.leader_username || 'Unknown',
                  }}
                  highlight
                />
              </div>
            )}

            {/* Top Teams */}
            {leaderboardData.teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                highlight={team.id === userTeamId}
              />
            ))}
          </div>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 mx-auto bg-gray-800 rounded-full flex items-center justify-center mb-4">
        <Trophy className="text-gray-600" size={32} />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">No Teams Yet</h3>
      <p className="text-gray-400 mb-6">
        Be the first to create a team and claim the top spot!
      </p>
      <Link
        href="/team"
        className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors"
      >
        <Users size={18} />
        Create a Team
      </Link>
    </div>
  );
}
