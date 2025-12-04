'use client';

// ============================================================================
// LEADERBOARD PAGE - Real data from API
// ============================================================================

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Crown,
  Heart,
  BookOpen,
  Plus,
  User,
  Medal,
  Users,
  Film,
  ChevronRight,
} from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';
import { AuthGuard } from '@/hooks/useAuth';

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

function LeaderboardPageContent() {
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
                <motion.div
                  animate={{ y: [0, -3, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="glow-gold rounded-full p-1"
                >
                  <Trophy className="w-8 h-8 text-yellow-500" />
                </motion.div>
                <span className="text-gradient-premium">Leaderboard</span>
              </h1>
              <p className="text-white/60">Top clips, voters, and creators</p>
            </div>

            {/* Tabs with sliding indicator */}
            <div className="relative flex gap-1 mb-6 p-1 glass-card">
              {/* Sliding background indicator */}
              <motion.div
                className="absolute top-1 bottom-1 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-lg border border-white/10"
                initial={false}
                animate={{
                  left: activeTab === 'clips' ? '4px' : activeTab === 'voters' ? 'calc(33.33% + 2px)' : 'calc(66.66% + 0px)',
                  width: 'calc(33.33% - 4px)',
                }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
              {[
                { id: 'clips', label: 'Top Clips', icon: Film },
                { id: 'voters', label: 'Top Voters', icon: Users },
                { id: 'creators', label: 'Top Creators', icon: Crown },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as TabType)}
                  className={`relative flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors z-10 ${
                    activeTab === id
                      ? 'text-white'
                      : 'text-white/50 hover:text-white/70'
                  }`}
                >
                  <Icon className={`w-4 h-4 transition-transform ${activeTab === id ? 'scale-110' : ''}`} />
                  {label}
                </button>
              ))}
            </div>

            {/* Content */}
            {loading ? (
              <LeaderboardSkeleton />
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
            <motion.div
              animate={{ y: [0, -2, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="glow-gold rounded-full"
            >
              <Trophy className="w-7 h-7 text-yellow-500" />
            </motion.div>
            <span className="text-gradient-premium">Leaderboard</span>
          </h1>
        </div>

        {/* Tabs with sliding indicator */}
        <div className="px-4 mb-4">
          <div className="relative flex gap-1 p-1 glass-card">
            {/* Sliding background indicator */}
            <motion.div
              className="absolute top-1 bottom-1 bg-gradient-to-r from-cyan-500/20 to-purple-500/20 rounded-lg border border-white/10"
              initial={false}
              animate={{
                left: activeTab === 'clips' ? '4px' : activeTab === 'voters' ? 'calc(33.33% + 2px)' : 'calc(66.66% + 0px)',
                width: 'calc(33.33% - 4px)',
              }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
            {[
              { id: 'clips', label: 'Clips', icon: Film },
              { id: 'voters', label: 'Voters', icon: Users },
              { id: 'creators', label: 'Creators', icon: Crown },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id as TabType)}
                className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-medium transition-colors z-10 ${
                  activeTab === id
                    ? 'text-white'
                    : 'text-white/50'
                }`}
              >
                <Icon className={`w-4 h-4 transition-transform ${activeTab === id ? 'scale-110' : ''}`} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-4">
          {loading ? (
            <LeaderboardSkeleton />
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

// Wrap with AuthGuard for protected route
export default function LeaderboardPage() {
  return (
    <AuthGuard>
      <LeaderboardPageContent />
    </AuthGuard>
  );
}

// ============================================================================
// COMPONENTS
// ============================================================================

function EmptyState({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex flex-col items-center justify-center py-16 text-white/50 glass-card"
    >
      <motion.div
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <Trophy className="w-12 h-12 mb-4 opacity-30" />
      </motion.div>
      <p className="text-center">{message}</p>
    </motion.div>
  );
}

function ClipCard({ clip, rank }: { clip: TopClip; rank: number }) {
  const medalColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];
  const glowClasses = ['glow-gold', 'glow-silver', 'glow-bronze'];
  const bgClasses = ['rank-gold-bg', 'rank-silver-bg', 'rank-bronze-bg'];

  return (
    <Link href={`/profile/${clip.username}`}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: (rank - 1) * 0.05 }}
        whileHover={{ scale: 1.01, y: -2 }}
        whileTap={{ scale: 0.99 }}
        className={`flex gap-4 p-4 glass-card glass-card-hover ${rank <= 3 ? `${glowClasses[rank - 1]} ${bgClasses[rank - 1]}` : ''}`}
      >
        {/* Rank with medal shine */}
        <div className="flex flex-col items-center justify-center w-12">
          {rank <= 3 ? (
            <div className="medal-shine">
              <Medal className={`w-8 h-8 ${medalColors[rank - 1]}`} />
            </div>
          ) : (
            <span className="text-2xl font-black text-white/60">#{rank}</span>
          )}
        </div>

        {/* Video Thumbnail with hover effect */}
        <div className="w-16 h-24 md:w-20 md:h-28 rounded-lg overflow-hidden bg-white/10 flex-shrink-0 relative group">
          <video
            src={clip.video_url}
            className="w-full h-full object-cover"
            muted
            preload="metadata"
          />
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
              <div className="w-0 h-0 border-l-[8px] border-l-white border-y-[5px] border-y-transparent ml-1" />
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className={`rounded-full p-0.5 ${rank <= 3 ? 'gradient-border-animated' : ''}`}>
              <Image
                src={clip.avatar_url}
                alt={clip.username}
                width={24}
                height={24}
                className="w-6 h-6 rounded-full bg-black"
                unoptimized={clip.avatar_url?.includes('dicebear')}
              />
            </div>
            <span className="font-bold truncate">@{clip.username}</span>
            {rank === 1 && <span className="text-sm">👑</span>}
          </div>
          <div className="text-sm text-white/60 mb-2">
            Season {clip.season_number} • Slot #{clip.slot_position} • {clip.genre}
          </div>
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-pink-500" fill="#ec4899" />
            <span className="font-bold">{formatNumber(clip.vote_count)}</span>
          </div>
        </div>

        <ChevronRight className="w-5 h-5 text-white/60 self-center group-hover:text-white/70 transition-colors" />
      </motion.div>
    </Link>
  );
}

function LeaderboardSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 border border-white/10"
        >
          {/* Rank */}
          <div className="w-10 flex justify-center">
            <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
          </div>
          {/* Thumbnail or Avatar */}
          <div className="w-16 h-24 md:w-20 md:h-28 rounded-lg bg-white/10 animate-pulse flex-shrink-0" />
          {/* Info */}
          <div className="flex-1 space-y-2">
            <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
            <div className="h-3 w-32 bg-white/10 rounded animate-pulse" />
            <div className="h-3 w-16 bg-white/10 rounded animate-pulse" />
          </div>
          {/* Arrow */}
          <div className="w-5 h-5 bg-white/10 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function LeaderboardRow({ entry, type }: { entry: LeaderboardEntry; type: 'votes' | 'received' }) {
  const medalColors = ['text-yellow-500', 'text-gray-400', 'text-amber-600'];
  const glowClasses = ['glow-gold', 'glow-silver', 'glow-bronze'];
  const bgClasses = ['rank-gold-bg', 'rank-silver-bg', 'rank-bronze-bg'];
  const avatarBorderColors = ['border-yellow-500/50', 'border-gray-400/50', 'border-amber-600/50'];
  const TrendIcon = entry.trend === 'up' ? TrendingUp : entry.trend === 'down' ? TrendingDown : Minus;
  const trendColor = entry.trend === 'up' ? 'text-green-500' : entry.trend === 'down' ? 'text-red-500' : 'text-white/60';

  return (
    <Link href={`/profile/${entry.username}`}>
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: (entry.rank - 1) * 0.03 }}
        whileHover={{ scale: 1.01, x: 4 }}
        whileTap={{ scale: 0.98 }}
        className={`flex items-center gap-3 p-3 glass-card glass-card-hover ${entry.rank <= 3 ? `${glowClasses[entry.rank - 1]} ${bgClasses[entry.rank - 1]}` : ''}`}
      >
        {/* Rank with medal shine */}
        <div className="w-10 flex justify-center">
          {entry.rank <= 3 ? (
            <div className="medal-shine">
              <Medal className={`w-6 h-6 ${medalColors[entry.rank - 1]}`} />
            </div>
          ) : (
            <span className="font-bold text-white/60">#{entry.rank}</span>
          )}
        </div>

        {/* Avatar with colored border for top 3 */}
        <div className={`rounded-full ${entry.rank <= 3 ? `p-0.5 ${avatarBorderColors[entry.rank - 1]} border-2` : ''}`}>
          <Image
            src={entry.avatar_url}
            alt={entry.username}
            width={40}
            height={40}
            className="w-10 h-10 rounded-full bg-black"
            unoptimized={entry.avatar_url?.includes('dicebear')}
          />
        </div>

        {/* Name & Badge */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold truncate">@{entry.username}</span>
            {entry.badge && <span className="text-sm">{entry.badge}</span>}
          </div>
          <div className="text-sm text-white/50">
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {formatNumber(entry.score)}
            </motion.span>
            {' '}{type === 'votes' ? 'votes cast' : 'votes received'}
          </div>
        </div>

        {/* Trend with subtle animation */}
        <motion.div
          animate={entry.trend === 'up' ? { y: [0, -2, 0] } : {}}
          transition={{ duration: 1.5, repeat: entry.trend === 'up' ? Infinity : 0 }}
        >
          <TrendIcon className={`w-5 h-5 ${trendColor}`} />
        </motion.div>
      </motion.div>
    </Link>
  );
}
