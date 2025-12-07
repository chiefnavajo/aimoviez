'use client';

// ============================================================================
// MINI LEADERBOARD - Live voting stats bar for dashboard
// ============================================================================
// Features:
// - Top 3 clips with thumbnails and vote counts
// - Live vote pulse showing activity
// - Tap to jump to clip
// - Collapsible on scroll
// - Current clip rank highlight
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { Trophy, Flame, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';

interface LeaderClip {
  id: string;
  clip_id: string;
  thumbnail_url: string;
  username: string;
  vote_count: number;
  rank: number;
}

interface MiniLeaderboardProps {
  currentClipId?: string;
  onClipSelect?: (clipId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function MiniLeaderboard({
  currentClipId,
  onClipSelect,
  isCollapsed = false,
  onToggleCollapse,
}: MiniLeaderboardProps) {
  const [topClips, setTopClips] = useState<LeaderClip[]>([]);
  const [votesPerMinute, setVotesPerMinute] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [_lastVoteTime, _setLastVoteTime] = useState<Date | null>(null);
  const [showPulse, setShowPulse] = useState(false);

  // Use ref to store topClips for voting activity calculation without causing re-renders
  const topClipsRef = useRef<LeaderClip[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Memoized fetch functions to prevent interval memory leaks
  const fetchTopClips = useCallback(async () => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/leaderboard/clips?limit=5', {
        signal: abortController.signal,
      });
      if (response.ok) {
        const data = await response.json();
        const clips = (data.clips || data.leaderboard || []).slice(0, 5).map((clip: any, index: number) => {
          // Get thumbnail URL, but fallback to placeholder if it's a video URL (.mp4)
          let thumbnailUrl = clip.thumbnail_url;
          if (!thumbnailUrl || thumbnailUrl.endsWith('.mp4') || thumbnailUrl.endsWith('.webm')) {
            thumbnailUrl = `https://api.dicebear.com/7.x/shapes/svg?seed=${clip.id}`;
          }
          return {
            id: clip.id,
            clip_id: clip.clip_id || clip.id,
            thumbnail_url: thumbnailUrl,
            username: clip.username || clip.user?.username || 'Creator',
            vote_count: clip.vote_count || clip.votes || 0,
            rank: index + 1,
          };
        });
        setTopClips(clips);
        topClipsRef.current = clips;
      }
    } catch (error) {
      // Ignore aborted requests
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('Failed to fetch leaderboard:', error);
    }
    setIsLoading(false);
  }, []);

  // Memoized voting activity fetch - uses ref to avoid dependency on topClips state
  const fetchVotingActivity = useCallback(() => {
    try {
      // Calculate from leaderboard data or use estimate
      const totalVotes = topClipsRef.current.reduce((sum, clip) => sum + clip.vote_count, 0);
      // Simulate activity based on total votes (in real app, track actual rate)
      const baseRate = Math.max(5, Math.floor(totalVotes / 100));
      const variance = Math.floor(Math.random() * 10) - 5;
      setVotesPerMinute(Math.max(1, baseRate + variance));
    } catch {
      setVotesPerMinute(Math.floor(Math.random() * 20) + 5);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchTopClips();
  }, [fetchTopClips]);

  // Refresh every 10 seconds with stable callbacks
  useEffect(() => {
    const interval = setInterval(() => {
      fetchTopClips();
      fetchVotingActivity();
    }, 10000);
    return () => {
      clearInterval(interval);
      // Abort any pending request on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [fetchTopClips, fetchVotingActivity]);

  // Pulse effect when votes change
  const voteCountsKey = topClips.map(c => c.vote_count).join(',');
  useEffect(() => {
    if (topClips.length > 0) {
      setShowPulse(true);
      const timer = setTimeout(() => setShowPulse(false), 1000);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voteCountsKey]);

  // Get rank badge styling
  const getRankStyle = (rank: number) => {
    switch (rank) {
      case 1:
        return 'bg-gradient-to-r from-yellow-400 to-amber-500 text-black';
      case 2:
        return 'bg-gradient-to-r from-gray-300 to-gray-400 text-black';
      case 3:
        return 'bg-gradient-to-r from-amber-600 to-amber-700 text-white';
      default:
        return 'bg-white/20 text-white';
    }
  };

  // Check if current clip is in top 5
  const currentClipRank = topClips.find(c => c.clip_id === currentClipId)?.rank;

  if (isLoading) {
    return (
      <div className="px-4 py-2">
        <div className="h-12 bg-white/5 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-3"
    >
      {/* Collapsed View - Just the pulse and expand button */}
      <AnimatePresence mode="wait">
        {isCollapsed ? (
          <motion.button
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onToggleCollapse}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-full bg-black/40 backdrop-blur-md border border-white/10"
          >
            <Flame className={`w-4 h-4 ${showPulse ? 'text-orange-400' : 'text-orange-500'}`} />
            <span className="text-white/80 text-xs font-medium">
              {votesPerMinute} votes/min
            </span>
            <ChevronDown className="w-4 h-4 text-white/60" />
          </motion.button>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="rounded-2xl bg-black/60 backdrop-blur-md border border-white/10 overflow-hidden"
          >
            {/* Header Row */}
            <div className="flex items-center justify-center px-3 py-2 border-b border-white/10 relative">
              {/* Live Vote Pulse - Left side */}
              <div className="flex items-center gap-2">
                <motion.div
                  animate={showPulse ? {
                    scale: [1, 1.3, 1],
                    opacity: [1, 0.7, 1],
                  } : {}}
                  transition={{ duration: 0.5 }}
                >
                  <Flame className="w-4 h-4 text-orange-500" />
                </motion.div>
                <span className="text-white/90 text-xs font-bold">
                  {votesPerMinute} votes/min
                </span>
                <motion.div
                  className="w-2 h-2 rounded-full bg-green-500"
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />

                {/* Collapse Button - Centered, visible background */}
                <button
                  onClick={onToggleCollapse}
                  className="ml-3 p-2 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 transition border border-white/20"
                  aria-label="Collapse leaderboard"
                >
                  <ChevronUp className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>

            {/* Top Clips Row */}
            <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto scrollbar-hide">
              <Trophy className="w-4 h-4 text-yellow-500 flex-shrink-0" />

              {topClips.map((clip, _index) => (
                <motion.button
                  key={clip.id}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onClipSelect?.(clip.clip_id)}
                  className={`relative flex-shrink-0 ${
                    clip.clip_id === currentClipId
                      ? 'ring-2 ring-cyan-400 ring-offset-1 ring-offset-black'
                      : ''
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden">
                    <Image
                      src={clip.thumbnail_url}
                      alt={clip.username}
                      fill
                      sizes="40px"
                      className="object-cover"
                    />
                    {/* Rank Badge */}
                    <div className={`absolute -top-1 -left-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${getRankStyle(clip.rank)}`}>
                      {clip.rank}
                    </div>
                  </div>

                  {/* Vote Count */}
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-full bg-black/80 backdrop-blur-sm">
                    <span className="text-[9px] text-white font-bold">
                      {clip.vote_count >= 1000
                        ? `${(clip.vote_count / 1000).toFixed(1)}k`
                        : clip.vote_count}
                    </span>
                  </div>
                </motion.button>
              ))}

              {/* View Full Leaderboard */}
              <motion.a
                href="/leaderboard"
                whileTap={{ scale: 0.95 }}
                className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 hover:bg-white/20 transition"
              >
                <TrendingUp className="w-3 h-3 text-white/70" />
                <span className="text-[10px] text-white/70 font-medium">All</span>
              </motion.a>
            </div>

            {/* Current Clip Rank Indicator */}
            {currentClipRank && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="px-3 py-1.5 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border-t border-white/10"
              >
                <p className="text-[10px] text-center text-cyan-300 font-medium">
                  This clip is #{currentClipRank} in the competition!
                </p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
