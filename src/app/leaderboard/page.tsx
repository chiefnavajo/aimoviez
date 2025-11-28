'use client';

// ============================================================================
// LEADERBOARD PAGE - Tournament Rankings & Competition
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Filter,
  ArrowLeft,
  Play,
  Volume2,
  VolumeX,
  Crown,
  Flame,
  AlertTriangle,
  Check,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface LeaderboardClip {
  id: string;
  title: string;
  description: string;
  genre: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string;
  vote_count: number;
  weighted_score: number;
  hype_score: number;
  slot_position: number;
  created_at: string;
  rank?: number;
  percentage?: number;
  trend?: 'up' | 'down' | 'same';
}

interface Season {
  id: string;
  status: string;
  total_slots: number;
  genre: string;
  start_date: string;
  end_date: string;
}

type GenreFilter = 'all' | 'action' | 'comedy' | 'thriller' | 'scifi' | 'romance' | 'animation' | 'horror' | 'other';

const GENRE_EMOJIS: Record<string, string> = {
  action: '💥',
  comedy: '😂',
  thriller: '🔪',
  scifi: '🚀',
  romance: '❤️',
  animation: '🎨',
  horror: '👻',
  other: '🎬',
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LeaderboardPage() {
  const [clips, setClips] = useState<LeaderboardClip[]>([]);
  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [genreFilter, setGenreFilter] = useState<GenreFilter>('all');
  const [playingClip, setPlayingClip] = useState<string | null>(null);
  const [mutedClips, setMutedClips] = useState<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState<string>('');
  const videoRefs = useRef<{ [key: string]: HTMLVideoElement | null }>({});

  // ============================================================================
  // FETCH DATA
  // ============================================================================

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/leaderboard');
      const data = await response.json();
      
      if (data.success) {
        setClips(data.clips || []);
        setSeason(data.season);
      }
    } catch (error) {
      console.error('Failed to fetch leaderboard:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLeaderboard();
    // Refresh every 30 seconds
    const interval = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(interval);
  }, []);

  // ============================================================================
  // COUNTDOWN TIMER
  // ============================================================================

  useEffect(() => {
    if (!season?.end_date) return;

    const updateCountdown = () => {
      const now = new Date().getTime();
      const end = new Date(season.end_date).getTime();
      const distance = end - now;

      if (distance < 0) {
        setTimeLeft('Season ended');
        return;
      }

      const days = Math.floor(distance / (1000 * 60 * 60 * 24));
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));

      setTimeLeft(`${days}d ${hours}h ${minutes}m left`);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 60000); // Update every minute
    return () => clearInterval(interval);
  }, [season]);

  // ============================================================================
  // FILTER CLIPS
  // ============================================================================

  const filteredClips = genreFilter === 'all' 
    ? clips 
    : clips.filter(clip => clip.genre.toLowerCase() === genreFilter);

  // ============================================================================
  // CALCULATE STATS
  // ============================================================================

  const totalVotes = clips.reduce((sum, clip) => sum + clip.vote_count, 0);
  const topSlots = season?.total_slots || 10;

  const getClipStatus = (rank: number, percentage: number) => {
    if (rank <= topSlots) {
      if (rank <= 3) return { label: 'MAKING IT! 🎬', color: 'text-green-400', bg: 'bg-green-500/20' };
      if (rank <= topSlots - 2) return { label: 'SAFE ✅', color: 'text-blue-400', bg: 'bg-blue-500/20' };
      return { label: 'AT RISK ⚠️', color: 'text-yellow-400', bg: 'bg-yellow-500/20' };
    }
    return { label: 'ELIMINATED ❌', color: 'text-red-400', bg: 'bg-red-500/20' };
  };

  const getRankIcon = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  // ============================================================================
  // VIDEO CONTROLS
  // ============================================================================

  const togglePlay = (clipId: string) => {
    const video = videoRefs.current[clipId];
    if (!video) return;

    if (playingClip === clipId) {
      video.pause();
      setPlayingClip(null);
    } else {
      // Pause all other videos
      Object.entries(videoRefs.current).forEach(([id, v]) => {
        if (v && id !== clipId) {
          v.pause();
        }
      });
      video.play().catch(err => console.error('Play error:', err));
      setPlayingClip(clipId);
    }
  };

  const toggleMute = (clipId: string) => {
    setMutedClips((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(clipId)) {
        newSet.delete(clipId);
      } else {
        newSet.add(clipId);
      }
      return newSet;
    });
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                  type="button"
                >
                  <ArrowLeft className="w-5 h-5" />
                </motion.button>
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <Trophy className="w-6 h-6 text-yellow-400" />
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-yellow-400 via-orange-400 to-red-500 bg-clip-text text-transparent">
                    Tournament Leaderboard
                  </h1>
                </div>
                {season && (
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-sm text-white/60">Season {season.id.slice(0, 8)}</p>
                    {timeLeft && (
                      <div className="flex items-center gap-1 text-xs text-cyan-400">
                        <Clock className="w-3 h-3" />
                        {timeLeft}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={fetchLeaderboard}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              type="button"
            >
              <TrendingUp className="w-5 h-5 text-green-400" />
            </motion.button>
          </div>
        </div>
      </header>

      {/* Stats Banner */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-gradient-to-r from-purple-500/20 via-cyan-500/20 to-purple-500/20 rounded-xl p-6 border border-white/10 backdrop-blur-sm">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-3xl font-bold">{clips.length}</p>
              <p className="text-sm text-white/60">Competing Clips</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-yellow-400">{topSlots}</p>
              <p className="text-sm text-white/60">Spots Available</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-cyan-400">{totalVotes}</p>
              <p className="text-sm text-white/60">Total Votes</p>
            </div>
          </div>
        </div>
      </div>

      {/* Genre Filters */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <Filter className="w-4 h-4 text-white/60 flex-shrink-0" />
          {(['all', 'action', 'comedy', 'thriller', 'scifi', 'romance', 'animation', 'horror', 'other'] as GenreFilter[]).map((genre) => (
            <motion.button
              key={genre}
              whileTap={{ scale: 0.95 }}
              onClick={() => setGenreFilter(genre)}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-all ${
                genreFilter === genre
                  ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
              type="button"
            >
              {genre !== 'all' && GENRE_EMOJIS[genre]} {genre.charAt(0).toUpperCase() + genre.slice(1)}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Leaderboard */}
      <div className="max-w-7xl mx-auto px-4">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-400"></div>
          </div>
        ) : filteredClips.length === 0 ? (
          <div className="text-center py-20">
            <Trophy className="w-16 h-16 text-white/40 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white/80 mb-2">No clips yet</h3>
            <p className="text-white/60">Be the first to compete!</p>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence>
              {filteredClips.map((clip, index) => {
                const status = getClipStatus(clip.rank || index + 1, clip.percentage || 0);
                const isTop3 = (clip.rank || index + 1) <= 3;
                const isMakingIt = (clip.rank || index + 1) <= topSlots;

                return (
                  <motion.div
                    key={clip.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ delay: index * 0.05 }}
                    className={`relative bg-white/5 backdrop-blur-sm rounded-xl border overflow-hidden ${
                      isTop3 
                        ? 'border-yellow-500/50 shadow-lg shadow-yellow-500/20' 
                        : isMakingIt
                        ? 'border-green-500/30'
                        : 'border-white/10'
                    }`}
                  >
                    {/* Rank Badge */}
                    <div className="absolute top-4 left-4 z-10">
                      <div className={`text-4xl font-bold ${
                        isTop3 ? 'animate-pulse' : ''
                      }`}>
                        {getRankIcon(clip.rank || index + 1)}
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="absolute top-4 right-4 z-10">
                      <div className={`px-3 py-1 rounded-full text-xs font-bold ${status.bg} ${status.color} backdrop-blur-sm`}>
                        {status.label}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-[280px,1fr] gap-6 p-6">
                      {/* Video Preview */}
                      <div className="relative aspect-[9/16] max-w-[280px] mx-auto rounded-xl overflow-hidden bg-black">
                        <video
                          ref={(el) => {
                            videoRefs.current[clip.id] = el;
                          }}
                          src={clip.video_url}
                          className="w-full h-full object-cover"
                          loop
                          playsInline
                          muted={mutedClips.has(clip.id)}
                          onPlay={() => setPlayingClip(clip.id)}
                          onPause={() => setPlayingClip(null)}
                        />

                        {/* Play Button */}
                        {playingClip !== clip.id && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <motion.button
                              whileTap={{ scale: 0.9 }}
                              onClick={() => togglePlay(clip.id)}
                              className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors"
                              type="button"
                            >
                              <Play className="w-8 h-8 text-white ml-1" />
                            </motion.button>
                          </div>
                        )}

                        {/* Controls */}
                        <div className="absolute bottom-2 left-2">
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => toggleMute(clip.id)}
                            className="p-2 bg-black/70 backdrop-blur-sm rounded-full"
                            type="button"
                          >
                            {mutedClips.has(clip.id) ? (
                              <VolumeX className="w-4 h-4" />
                            ) : (
                              <Volume2 className="w-4 h-4" />
                            )}
                          </motion.button>
                        </div>
                      </div>

                      {/* Clip Info */}
                      <div className="flex flex-col justify-between">
                        <div className="space-y-4">
                          <div>
                            <h3 className="text-xl font-bold mb-1">{clip.title}</h3>
                            <p className="text-white/60 text-sm line-clamp-2">
                              {clip.description || 'No description'}
                            </p>
                          </div>

                          {/* Stats */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-white/5 rounded-lg p-3">
                              <p className="text-2xl font-bold text-cyan-400">{clip.vote_count}</p>
                              <p className="text-xs text-white/60">Votes</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-3">
                              <p className="text-2xl font-bold text-purple-400">
                                {clip.percentage?.toFixed(1)}%
                              </p>
                              <p className="text-xs text-white/60">Share</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-3">
                              <p className="text-2xl font-bold text-orange-400">
                                {clip.hype_score?.toFixed(0) || 0}
                              </p>
                              <p className="text-xs text-white/60">Hype</p>
                            </div>
                            <div className="bg-white/5 rounded-lg p-3">
                              <p className="text-xl font-bold">{GENRE_EMOJIS[clip.genre.toLowerCase()]}</p>
                              <p className="text-xs text-white/60">{clip.genre}</p>
                            </div>
                          </div>

                          {/* Progress Bar */}
                          <div className="space-y-2">
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-white/70">Vote Progress</span>
                              <span className="font-bold text-cyan-400">{clip.vote_count} votes</span>
                            </div>
                            <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(clip.percentage || 0, 100)}%` }}
                                className={`h-full rounded-full ${
                                  isTop3
                                    ? 'bg-gradient-to-r from-yellow-400 to-orange-500'
                                    : isMakingIt
                                    ? 'bg-gradient-to-r from-green-400 to-cyan-500'
                                    : 'bg-gradient-to-r from-gray-500 to-gray-600'
                                }`}
                              />
                            </div>
                          </div>

                          {/* Creator Info */}
                          <div className="flex items-center gap-3 pt-2">
                            <img
                              src={clip.avatar_url}
                              alt={clip.username}
                              className="w-10 h-10 rounded-full bg-white/10"
                            />
                            <div>
                              <p className="font-medium">{clip.username}</p>
                              <p className="text-xs text-white/60">
                                {new Date(clip.created_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Cutoff Line Indicator */}
      {filteredClips.length > topSlots && (
        <div className="max-w-7xl mx-auto px-4 mt-8">
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-red-500 to-transparent" />
            <div className="px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-full text-sm font-bold text-red-400">
              ⚠️ CUTOFF LINE - Top {topSlots} Make It!
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-red-500 via-transparent to-transparent" />
          </div>
        </div>
      )}
    </div>
  );
}
