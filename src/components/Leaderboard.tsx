'use client';

// Leaderboard with tabs and smooth number animations

import { useState, memo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, TrendingUp } from 'lucide-react';
import { Leader } from '@/types';

// Memoized leaderboard item to prevent unnecessary re-renders
const LeaderboardItem = memo(function LeaderboardItem({
  leader,
  index,
  getRankColor,
  getRankEmoji
}: {
  leader: Leader;
  index: number;
  getRankColor: (rank: number) => string;
  getRankEmoji: (rank: number) => string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300 group"
    >
      {/* Rank */}
      <div className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg bg-gradient-to-br from-white/10 to-white/5 border border-white/20 group-hover:scale-110 transition-transform">
        {leader.rank <= 3 ? (
          <span className="text-2xl">{getRankEmoji(leader.rank)}</span>
        ) : (
          <span className="text-white/80">{leader.rank}</span>
        )}
      </div>

      {/* Avatar & Name */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Image
          src={leader.user.avatar}
          alt={leader.user.name}
          width={48}
          height={48}
          className="w-12 h-12 rounded-full border-2 border-white/20 group-hover:border-cyan-400/40 transition-colors"
        />
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-semibold truncate">
            {leader.user.name}
          </h4>
          <div className="flex items-center gap-2 mt-0.5">
            {leader.badges.map((badge, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/80"
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="text-right">
        <motion.div
          initial={{ scale: 1 }}
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 0.5 }}
          className={`text-2xl font-bold bg-gradient-to-r ${getRankColor(leader.rank)} bg-clip-text text-transparent`}
        >
          {leader.votesTotal.toLocaleString()}
        </motion.div>
        <div className="text-xs text-white/60 uppercase tracking-wider">
          Votes
        </div>
        <div className="text-xs text-cyan-400 mt-1">
          {leader.xp.toLocaleString()} XP
        </div>
      </div>
    </motion.div>
  );
});

interface LeaderboardProps {
  leaders: Leader[];
}

type Tab = 'daily' | 'weekly' | 'alltime';

export default function Leaderboard({ leaders }: LeaderboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('daily');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'alltime', label: 'All-Time' }
  ];

  const getRankColor = (rank: number) => {
    switch (rank) {
      case 1: return 'from-yellow-400 to-yellow-600';
      case 2: return 'from-slate-300 to-slate-400';
      case 3: return 'from-orange-400 to-orange-600';
      default: return 'from-cyan-400 to-violet-400';
    }
  };

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `#${rank}`;
    }
  };

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl overflow-hidden">
      
      {/* Header with Tabs */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Trophy size={24} className="text-yellow-400" />
              Creator Leaderboard
            </h3>
            <p className="text-sm text-white/60 mt-1">
              Top contributors this period
            </p>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`
                  px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300
                  focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050510]
                  ${activeTab === key
                    ? 'bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-lg'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                  }
                `}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Leaderboard List */}
      <div className="p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="space-y-3"
          >
            {leaders.length === 0 ? (
              <div className="py-12 text-center">
                <TrendingUp size={48} className="mx-auto text-white/60 mb-3" />
                <p className="text-white/60">No creators yet. Be the first!</p>
              </div>
            ) : (
              leaders.map((leader, index) => (
                <LeaderboardItem
                  key={leader.id}
                  leader={leader}
                  index={index}
                  getRankColor={getRankColor}
                  getRankEmoji={getRankEmoji}
                />
              ))
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
