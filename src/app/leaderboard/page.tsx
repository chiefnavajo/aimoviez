'use client';

// ============================================================================
// LEADERBOARD PAGE - Matches Dashboard/Storyboard Style
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

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_TOP_CLIPS: TopClip[] = [
  {
    id: 'clip-1',
    video_url: 'https://dxixqdmqomqzhilmdfzg.supabase.co/storage/v1/object/public/videos/spooky-ghost.mp4',
    thumbnail_url: '',
    username: 'veo3_creator',
    avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=veo3',
    vote_count: 4521,
    genre: 'Horror',
    slot_position: 5,
    season_number: 2,
  },
  {
    id: 'clip-2',
    video_url: 'https://dxixqdmqomqzhilmdfzg.supabase.co/storage/v1/object/public/videos/ballet-dancer.mp4',
    thumbnail_url: '',
    username: 'dance_master',
    avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ballet',
    vote_count: 3847,
    genre: 'Comedy',
    slot_position: 5,
    season_number: 2,
  },
  {
    id: 'clip-3',
    video_url: 'https://dxixqdmqomqzhilmdfzg.supabase.co/storage/v1/object/public/videos/superhero-landing.mp4',
    thumbnail_url: '',
    username: 'film_wizard',
    avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=wizard',
    vote_count: 2654,
    genre: 'Action',
    slot_position: 5,
    season_number: 2,
  },
];

const MOCK_TOP_VOTERS: LeaderboardEntry[] = [
  { rank: 1, id: 'v1', username: 'vote_king', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=king', score: 12450, trend: 'same', badge: '👑' },
  { rank: 2, id: 'v2', username: 'movie_lover', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lover', score: 11230, trend: 'up', badge: '🔥' },
  { rank: 3, id: 'v3', username: 'clip_master', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=master', score: 10890, trend: 'down' },
  { rank: 4, id: 'v4', username: 'daily_voter', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=daily', score: 9876, trend: 'up' },
  { rank: 5, id: 'v5', username: 'film_fan', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=fan', score: 8765, trend: 'same' },
  { rank: 6, id: 'v6', username: 'cinema_pro', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=cinema', score: 7654, trend: 'up' },
  { rank: 7, id: 'v7', username: 'reel_queen', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=queen', score: 6543, trend: 'down' },
  { rank: 8, id: 'v8', username: 'screen_time', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=screen', score: 5432, trend: 'same' },
];

const MOCK_TOP_CREATORS: LeaderboardEntry[] = [
  { rank: 1, id: 'c1', username: 'veo3_creator', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=veo3', score: 45210, trend: 'same', badge: '🏆' },
  { rank: 2, id: 'c2', username: 'film_wizard', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=wizard', score: 38470, trend: 'up', badge: '⭐' },
  { rank: 3, id: 'c3', username: 'dance_master', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ballet', score: 28920, trend: 'up' },
  { rank: 4, id: 'c4', username: 'horror_king', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=horror', score: 21340, trend: 'down' },
  { rank: 5, id: 'c5', username: 'comedy_queen', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=comedy', score: 18760, trend: 'same' },
  { rank: 6, id: 'c6', username: 'action_hero', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=action', score: 15430, trend: 'up' },
  { rank: 7, id: 'c7', username: 'scifi_master', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=scifi', score: 12890, trend: 'down' },
  { rank: 8, id: 'c8', username: 'drama_director', avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=drama', score: 10540, trend: 'same' },
];

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<TabType>('clips');
  const [topClips, setTopClips] = useState<TopClip[]>(MOCK_TOP_CLIPS);
  const [topVoters, setTopVoters] = useState<LeaderboardEntry[]>(MOCK_TOP_VOTERS);
  const [topCreators, setTopCreators] = useState<LeaderboardEntry[]>(MOCK_TOP_CREATORS);

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
            <AnimatePresence mode="wait">
              {activeTab === 'clips' && (
                <motion.div
                  key="clips"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  {topClips.map((clip, idx) => (
                    <ClipCard key={clip.id} clip={clip} rank={idx + 1} />
                  ))}
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
                  {topVoters.map((entry) => (
                    <LeaderboardRow key={entry.id} entry={entry} type="votes" />
                  ))}
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
                  {topCreators.map((entry) => (
                    <LeaderboardRow key={entry.id} entry={entry} type="received" />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
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
          <AnimatePresence mode="wait">
            {activeTab === 'clips' && (
              <motion.div
                key="clips"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {topClips.map((clip, idx) => (
                  <ClipCard key={clip.id} clip={clip} rank={idx + 1} />
                ))}
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
                {topVoters.map((entry) => (
                  <LeaderboardRow key={entry.id} entry={entry} type="votes" />
                ))}
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
                {topCreators.map((entry) => (
                  <LeaderboardRow key={entry.id} entry={entry} type="received" />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <BottomNavigation />
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENTS
// ============================================================================

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
