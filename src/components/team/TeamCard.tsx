// components/team/TeamCard.tsx
// Team preview card for leaderboard display

'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Users, Trophy, Vote, Flame } from 'lucide-react';
import type { TeamLeaderboardEntry } from '@/types';

interface TeamCardProps {
  team: TeamLeaderboardEntry;
  highlight?: boolean;
}

export function TeamCard({ team, highlight = false }: TeamCardProps) {
  const getRankDisplay = (rank: number) => {
    if (rank === 1) return { bg: 'bg-yellow-500/20', text: 'text-yellow-500', icon: '1' };
    if (rank === 2) return { bg: 'bg-gray-400/20', text: 'text-gray-400', icon: '2' };
    if (rank === 3) return { bg: 'bg-orange-600/20', text: 'text-orange-600', icon: '3' };
    return { bg: 'bg-gray-800', text: 'text-gray-400', icon: rank.toString() };
  };

  const rankStyle = getRankDisplay(team.rank);

  return (
    <Link href={`/teams/${team.id}`}>
      <div
        className={`p-4 rounded-xl transition-all hover:scale-[1.02] cursor-pointer ${
          highlight
            ? 'bg-purple-900/30 border border-purple-500/50'
            : 'bg-gray-800/50 border border-gray-700/50 hover:border-gray-600'
        }`}
      >
        <div className="flex items-center gap-4">
          {/* Rank badge */}
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${rankStyle.bg} ${rankStyle.text}`}
          >
            {team.rank <= 3 ? (
              <Trophy size={18} />
            ) : (
              <span>{rankStyle.icon}</span>
            )}
          </div>

          {/* Team info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white truncate">{team.name}</h3>
              <span className="text-xs text-purple-400 bg-purple-500/20 px-1.5 py-0.5 rounded">
                Lvl {team.level}
              </span>
            </div>

            <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
              <span className="flex items-center gap-1">
                <Users size={12} />
                {team.member_count}
              </span>
              <span>Led by {team.leader_username}</span>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm">
            {/* Streak */}
            {team.current_streak > 0 && (
              <div className="flex items-center gap-1 text-orange-500">
                <Flame size={14} fill="currentColor" />
                <span className="font-medium">{team.current_streak}</span>
              </div>
            )}

            {/* Wins */}
            <div className="flex items-center gap-1 text-yellow-500">
              <Trophy size={14} />
              <span className="font-medium">{team.combined_wins}</span>
            </div>

            {/* Votes */}
            <div className="flex items-center gap-1 text-purple-400">
              <Vote size={14} />
              <span className="font-medium">{formatNumber(team.combined_votes)}</span>
            </div>

            {/* XP */}
            <div className="text-right min-w-[60px]">
              <div className="font-bold text-white">{formatNumber(team.total_xp)}</div>
              <div className="text-xs text-gray-500">XP</div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}
