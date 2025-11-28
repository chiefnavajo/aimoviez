'use client';

// HypeMeter - Live user count with animated gradient bar

import { motion } from 'framer-motion';
import { HypeStats } from '@/types';

interface HypeMeterProps {
  stats: HypeStats;
}

export default function HypeMeter({ stats }: HypeMeterProps) {
  const percentage = Math.min(100, (stats.liveUsers / 2000) * 100);

  return (
    <div className="p-6 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl">
      <div className="space-y-4">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-2xl">🔥</span>
              Live Hype
            </h3>
            <p className="text-sm text-white/60 mt-0.5">
              Real-time activity pulse
            </p>
          </div>
          
          <motion.div
            initial={{ scale: 1 }}
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent"
          >
            {stats.liveUsers.toLocaleString()}
          </motion.div>
        </div>

        {/* Animated Gradient Bar */}
        <div className="relative">
          <div className="h-3 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full relative"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 via-violet-500 to-fuchsia-500" />
              <motion.div
                animate={{
                  x: ['-100%', '100%']
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'linear'
                }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
              />
            </motion.div>
          </div>
          
          <p className="text-xs text-white/60 mt-2">
            {stats.liveUsers > 1500 ? '🔥 Peak activity!' : 'Voting now'}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/10">
          <div>
            <div className="text-2xl font-bold text-cyan-400">
              {stats.totalVotesToday.toLocaleString()}
            </div>
            <div className="text-xs text-white/60 uppercase tracking-wider">
              Votes Today
            </div>
          </div>
          
          <div>
            <div className="text-2xl font-bold text-violet-400">
              {stats.clipsSubmitted}
            </div>
            <div className="text-xs text-white/60 uppercase tracking-wider">
              Clips Live
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
