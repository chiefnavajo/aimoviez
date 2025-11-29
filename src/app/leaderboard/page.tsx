'use client';

// ============================================================================
// LEADERBOARD PAGE - Real data from API
// ============================================================================

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Crown,
  Flame,
  Heart,
  BookOpen,
  Plus,
  User,
  Medal,
  Users,
  Film,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';

// ============================================================================
// TYPES
// ============================================================================

interface LeaderboardEntry {
  rank: number;
  id: string;
  username: string;
  avatar_url: string;
  score: number;
  trend: 'up' | 'down' | 'same';
  badge?: string;
}

interface TopClip {
  id: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string;
  vote_count: number;
  genre: string;
  slot_position: number;
  season_number: number;
}

type TabType = 'clips' | 'voters' | 'creators';

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// Badge assignment based on rank
function getBadge(rank: number): string | undefined {
  if (rank === 1) return '👑';
  if (rank === 2) return '🔥';
  if (rank === 3) return '⭐';
  return undefined;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<TabType>('clips');
  const [topClips, setTopClips] = useState<TopClip[]>([]);
  const [topVoters, setTopVoters] = useState<LeaderboardEntry[]>([]);
  const [topCreators, setTopCreators] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data from APIs
  useEffect(() => {
    async function fetchLeaderboardData() {
      setLoading(true);
      setError(null);

      try {
        // Fetch all three leaderboards in parallel
        const [clipsRes, votersRes, creatorsRes] = await Promise.all([
          fetch('/api/leaderboard/clips?limit=10'),
          fetch('/api/leaderboard/voters?limit=10'),
          fetch('/api/leaderboard/creators?limit=10'),
        ]);

        // Parse responses
        const [clipsData, votersData, creatorsData] = await Promise.all([
          clipsRes.json(),
          votersRes.json(),
          creatorsRes.json(),
        ]);

        // Transform clips data
        if (clipsData.clips) {
          const clips: TopClip[] = clipsData.clips.map((clip: any) => ({
            id: clip.id,
            video_url: clip.video_url || '',
            thumbnail_url: clip.thumbnail_url || '',
            username: clip.username || 'Creator',
            avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${clip.username}`,
            vote_count: clip.vote_count || 0,
            genre: clip.genre || 'Unknown',
            slot_position: clip.slot_position || 1,
            season_number: 1, // Default to season 1
          }));
          setTopClips(clips);
        }

        // Transform voters data
        if (votersData.voters) {
          const voters: LeaderboardEntry[] = votersData.voters.map((voter: any) => ({
            rank: voter.rank,
            id: voter.voter_key,
            username: voter.username || `Voter${voter.voter_key?.substring(0, 6)}`,
            avatar_url: voter.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${voter.voter_key}`,
            score: voter.total_votes || 0,
            trend: 'same' as const, // No historical data for trends yet
            badge: getBadge(voter.rank),
          }));
          setTopVoters(voters);
        }

        // Transform creators data
        if (creatorsData.creators) {
          const creators: LeaderboardEntry[] = creatorsData.creators.map((creator: any) => ({
            rank: creator.rank,
            id: creator.user_id,
            username: creator.username || 'Creator',
            avatar_url: creator.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${creator.user_id}`,
            score: creator.total_votes || 0,
            trend: 'same' as const,
            badge: getBadge(creator.rank),
          }));
          setTopCreators(creators);
        }
      } catch (err) {
        console.error('Failed to fetch leaderboard data:', err);
        setError('Failed to load leaderboard data');
      } finally {
        setLoading(false);
      }
    }

    fetchLeaderboardData();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Desktop Layout */}
      <div className="hidden md:flex h-screen">
        {/* Left Sidebar - Navigation */}
        <div className="w-56 h-full flex flex-col py-4 px-3 border-r border-white/10">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 px-3 py-2 mb-4">
            <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7]">
              AiMoviez
            </span>
          </Link>

          {/* Vote Now Button */}
          <Link href="/dashboard" className="mb-4">
            <motion.div 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] text-white font-bold shadow-lg"
            >
              <Heart className="w-5 h-5" fill="white" />
              <span>Vote Now</span>
            </motion.div>
          </Link>

          {/* Navigation Items */}
          <nav className="flex-1 space-y-1">
            <Link href="/story">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition">
                <BookOpen className="w-6 h-6" />
                <span>Story</span>
              </div>
            </Link>
            <Link href="/upload">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition">
                <Plus className="w-6 h-6" />
                <span>Upload</span>
              </div>
            </Link>
            <Link href="/leaderboard">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-white/10 text-white border border-white/10">
                <Trophy className="w-6 h-6 text-yellow-500" />
                <span className="font-semibold">Leaderboard</span>
              </div>
            </Link>
            <Link href="/profile">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition">
                <User className="w-6 h-6" />
                <span>Profile</span>
              </div>
            </Link>
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-8">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-black mb-2 flex items-center gap-3">
                <Trophy className="w-8 h-8 text-yellow-500" />
                Leaderboard
              </h1>
              <p className="text-white/60">Top clips, voters, and creators</p>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6 p-1 bg-white/5 rounded-xl">
              {[
                { id: 'clips', label: 'Top Clips', icon: Film },
                { id: 'voters', label: 'Top Voters', icon: Users },
                { id: 'creators', label: 'Top Creators', icon: Crown },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as TabType)}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition ${
                    activeTab === id 
                      ? 'bg-white/10 text-white' 
                      : 'text-white/50 hover:text-white/70'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {/* Content */}
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-white/50" />
              </div>
            ) : error ? (
              <div className="text-center py-20 text-white/50">
                <p>{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-4 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition"
                >
                  Retry
                </button>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {activeTab === 'clips' && (
                  <motion.div
                    key="clips"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-4"
                  >
                    {topClips.length === 0 ? (
                      <EmptyState message="No clips yet. Be the first to upload!" />
                    ) : (
                      topClips.map((clip, idx) => (
                        <ClipCard key={clip.id} clip={clip} rank={idx + 1} />
                      ))
                    )}
                  </motion.div>
                )}

                {activeTab === 'voters' && (
                  <motion.div
                    key="voters"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-2"
                  >
                    {topVoters.length === 0 ? (
                      <EmptyState message="No votes yet. Start voting to appear here!" />
                    ) : (
                      topVoters.map((entry) => (
                        <LeaderboardRow key={entry.id} entry={entry} type="votes" />
                      ))
                    )}
                  </motion.div>
                )}

                {activeTab === 'creators' && (
                  <motion.div
                    key="creators"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-2"
                  >
                    {topCreators.length === 0 ? (
                      <EmptyState message="No creators yet. Upload a clip to get started!" />
                    ) : (
                      topCreators.map((entry) => (
                        <LeaderboardRow key={entry.id} entry={entry} type="received" />
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden pb-20">
        {/* Header */}
        <div className="px-4 pt-12 pb-4">
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Trophy className="w-7 h-7 text-yellow-500" />
            Leaderboard
          </h1>
        </div>

        {/* Tabs */}
        <div className="px-4 mb-4">
          <div className="flex gap-1 p-1 bg-white/5 rounded-xl">
            {[
              { id: 'clips', label: 'Clips', icon: Film },
              { id: 'voters', label: 'Voters', icon: Users },
              { id: 'creators', label: 'Creators', icon: Crown },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as TabType)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition ${
                  activeTab === id 
                    ? 'bg-white/10 text-white' 
                    : 'text-white/50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-white/50" />
            </div>
          ) : error ? (
            <div className="text-center py-20 text-white/50">
              <p>{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition"
              >
                Retry
              </button>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {activeTab === 'clips' && (
                <motion.div
                  key="clips"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-3"
                >
                  {topClips.length === 0 ? (
                    <EmptyState message="No clips yet" />
                  ) : (
                    topClips.map((clip, idx) => (
                      <ClipCard key={clip.id} clip={clip} rank={idx + 1} />
                    ))
                  )}
                </motion.div>
              )}

              {activeTab === 'voters' && (
                <motion.div
                  key="voters"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2"
                >
                  {topVoters.length === 0 ? (
                    <EmptyState message="No votes yet" />
                  ) : (
                    topVoters.map((entry) => (
                      <LeaderboardRow key={entry.id} entry={entry} type="votes" />
                    ))
                  )}
                </motion.div>
              )}

              {activeTab === 'creators' && (
                <motion.div
                  key="creators"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2"
                >
                  {topCreators.length === 0 ? (
                    <EmptyState message="No creators yet" />
                  ) : (
                    topCreators.map((entry) => (
                      <LeaderboardRow key={entry.id} entry={entry} type="received" />
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        <BottomNavigation />
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENTS
// ============================================================================

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-white/50">
      <Trophy className="w-12 h-12 mb-4 opacity-30" />
      <p className="text-center">{message}</p>
    </div>
  );
}

function ClipCard({ clip, rank }: { clip: TopClip; rank: number }) {
  const medalColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];
  
  return (
    <Link href={`/profile/${clip.username}`}>
      <motion.div
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        className="flex gap-4 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition border border-white/5"
      >
        {/* Rank */}
        <div className="flex flex-col items-center justify-center w-12">
          {rank <= 3 ? (
            <Medal className={`w-8 h-8 ${medalColors[rank - 1]}`} />
          ) : (
            <span className="text-2xl font-black text-white/40">#{rank}</span>
          )}
        </div>

        {/* Video Thumbnail */}
        <div className="w-16 h-24 md:w-20 md:h-28 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
          <video 
            src={clip.video_url}
            className="w-full h-full object-cover"
            muted
            preload="metadata"
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <img 
              src={clip.avatar_url} 
              alt={clip.username}
              className="w-6 h-6 rounded-full"
            />
            <span className="font-bold truncate">@{clip.username}</span>
          </div>
          <div className="text-sm text-white/60 mb-2">
            Season {clip.season_number} • Slot #{clip.slot_position} • {clip.genre}
          </div>
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-pink-500" fill="#ec4899" />
            <span className="font-bold">{formatNumber(clip.vote_count)}</span>
          </div>
        </div>

        <ChevronRight className="w-5 h-5 text-white/30 self-center" />
      </motion.div>
    </Link>
  );
}

function LeaderboardRow({ entry, type }: { entry: LeaderboardEntry; type: 'votes' | 'received' }) {
  const medalColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];
  const TrendIcon = entry.trend === 'up' ? TrendingUp : entry.trend === 'down' ? TrendingDown : Minus;
  const trendColor = entry.trend === 'up' ? 'text-green-500' : entry.trend === 'down' ? 'text-red-500' : 'text-white/30';

  return (
    <Link href={`/profile/${entry.username}`}>
      <motion.div
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-3 p-3 bg-white/5 rounded-xl hover:bg-white/10 transition"
      >
        {/* Rank */}
        <div className="w-10 flex justify-center">
          {entry.rank <= 3 ? (
            <Medal className={`w-6 h-6 ${medalColors[entry.rank - 1]}`} />
          ) : (
            <span className="font-bold text-white/40">#{entry.rank}</span>
          )}
        </div>

        {/* Avatar */}
        <img 
          src={entry.avatar_url} 
          alt={entry.username}
          className="w-10 h-10 rounded-full"
        />

        {/* Name & Badge */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold truncate">@{entry.username}</span>
            {entry.badge && <span>{entry.badge}</span>}
          </div>
          <div className="text-sm text-white/50">
            {formatNumber(entry.score)} {type === 'votes' ? 'votes cast' : 'votes received'}
          </div>
        </div>

        {/* Trend */}
        <TrendIcon className={`w-5 h-5 ${trendColor}`} />
      </motion.div>
    </Link>
  );
}
