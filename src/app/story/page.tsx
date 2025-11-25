'use client';

// ============================================================================
// STORY PAGE - FINAL V4.1
// ============================================================================
// Features:
// ✅ Split view: Video player (top 55%) + Season list (bottom)
// ✅ Video fills entire top section (no black bars)
// ✅ Swipe/scroll season list to browse
// ✅ Tap season → plays in top video player
// ✅ Right column actions on video
// ✅ Contributors panel (transparent)
// ✅ Coming Soon season with genre voting
// ✅ TikTok-style comments panel (no black flash)
// ✅ Breathing VOTE animation on active season thumbnail
// ============================================================================

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Play,
  Heart,
  MessageCircle,
  Share2,
  Trophy,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronRight,
  Plus,
  BookOpen,
  User,
  Lock,
  Clock,
  Bell,
  Check,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

type SlotStatus = 'upcoming' | 'voting' | 'locked';
type SeasonStatus = 'completed' | 'active' | 'coming_soon';
type Genre = 'Thriller' | 'Comedy' | 'Action' | 'Sci-Fi' | 'Romance' | 'Animation' | 'Horror';

interface WinningClip {
  id: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string;
  vote_count: number;
  genre: string;
}

interface Slot {
  id: string;
  slot_position: number;
  status: SlotStatus;
  winning_clip?: WinningClip;
}

interface Season {
  id: string;
  number: number;
  name: string;
  status: SeasonStatus;
  total_slots: number;
  locked_slots: number;
  total_votes: number;
  total_clips: number;
  total_creators: number;
  winning_genre?: string;
  slots: Slot[];
  current_voting_slot?: number;
  thumbnail_url?: string;
}

// ============================================================================
// UTILS
// ============================================================================

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Helper to aggregate contributors from completed segments
function getTopContributors(segments: Slot[]): { username: string; avatar_url: string; segments: number; totalVotes: number }[] {
  const contributorMap = new Map<string, { username: string; avatar_url: string; segments: number; totalVotes: number }>();
  
  segments.forEach(segment => {
    if (segment.winning_clip) {
      const { username, avatar_url, vote_count } = segment.winning_clip;
      const existing = contributorMap.get(username);
      if (existing) {
        existing.segments += 1;
        existing.totalVotes += vote_count;
      } else {
        contributorMap.set(username, { username, avatar_url, segments: 1, totalVotes: vote_count });
      }
    }
  });
  
  return Array.from(contributorMap.values()).sort((a, b) => b.segments - a.segments || b.totalVotes - a.totalVotes);
}

// ============================================================================
// MOCK DATA
// ============================================================================

const MOCK_SEASONS: Season[] = [
  {
    id: 'season-2',
    number: 2,
    name: 'Revenge',
    status: 'active',
    total_slots: 75,
    locked_slots: 5,
    total_votes: 12400,
    total_clips: 342,
    total_creators: 156,
    current_voting_slot: 6,
    thumbnail_url: '/uploads/spooky-thumbnail.jpg',
    slots: [
      { id: 's2-1', slot_position: 1, status: 'locked', winning_clip: { id: 'c1', video_url: '/uploads/Spooky_Gen_Z_App_Opener_Video.mp4', thumbnail_url: '/uploads/spooky-thumbnail.jpg', username: 'veo3_creator', avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=veo3', vote_count: 4521, genre: 'Horror' } },
      { id: 's2-2', slot_position: 2, status: 'locked', winning_clip: { id: 'c2', video_url: '/uploads/Ballet_Studio_Jackhammer_Surprise.mp4', thumbnail_url: '/uploads/ballet-thumbnail.jpg', username: 'dance_master', avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=ballet', vote_count: 3847, genre: 'Comedy' } },
      { id: 's2-3', slot_position: 3, status: 'locked', winning_clip: { id: 'c3', video_url: '/uploads/Spooky_Gen_Z_App_Opener_Video.mp4', thumbnail_url: '/uploads/spooky-thumbnail.jpg', username: 'film_wizard', avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=wizard', vote_count: 2654, genre: 'Comedy' } },
      { id: 's2-4', slot_position: 4, status: 'locked', winning_clip: { id: 'c4', video_url: '/uploads/Ballet_Studio_Jackhammer_Surprise.mp4', thumbnail_url: '/uploads/ballet-thumbnail.jpg', username: 'neon_creator', avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=neon', vote_count: 2201, genre: 'Thriller' } },
      { id: 's2-5', slot_position: 5, status: 'locked', winning_clip: { id: 'c5', video_url: '/uploads/Spooky_Gen_Z_App_Opener_Video.mp4', thumbnail_url: '/uploads/spooky-thumbnail.jpg', username: 'movie_master', avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=master', vote_count: 1896, genre: 'Action' } },
      { id: 's2-6', slot_position: 6, status: 'voting' },
      ...Array.from({ length: 69 }, (_, i) => ({ id: `s2-${i + 7}`, slot_position: i + 7, status: 'upcoming' as SlotStatus })),
    ],
  },
  {
    id: 'season-1',
    number: 1,
    name: 'Chaos Begins',
    status: 'completed',
    total_slots: 75,
    locked_slots: 75,
    total_votes: 127000,
    total_clips: 3200,
    total_creators: 892,
    winning_genre: 'Comedy',
    thumbnail_url: 'https://picsum.photos/seed/s1main/400/711',
    slots: Array.from({ length: 75 }, (_, i) => ({
      id: `s1-${i + 1}`,
      slot_position: i + 1,
      status: 'locked' as SlotStatus,
      winning_clip: {
        id: `s1-clip-${i + 1}`,
        video_url: `/videos/s1-clip${i + 1}.mp4`,
        thumbnail_url: `https://picsum.photos/seed/s1c${i + 1}/400/711`,
        username: `creator_${i + 1}`,
        avatar_url: `https://api.dicebear.com/7.x/identicon/svg?seed=s1creator${i + 1}`,
        vote_count: Math.floor(Math.random() * 3000) + 1000,
        genre: ['Comedy', 'Action', 'Drama', 'Thriller'][Math.floor(Math.random() * 4)],
      },
    })),
  },
  {
    id: 'season-3',
    number: 3,
    name: 'TBD',
    status: 'coming_soon',
    total_slots: 75,
    locked_slots: 0,
    total_votes: 0,
    total_clips: 0,
    total_creators: 0,
    slots: [],
  },
];

const GENRES: Genre[] = ['Action', 'Comedy', 'Thriller', 'Sci-Fi', 'Romance', 'Animation', 'Horror'];

const MOCK_GENRE_VOTES: Record<Genre, number> = {
  Action: 25,
  Comedy: 19,
  Thriller: 21,
  'Sci-Fi': 14,
  Romance: 9,
  Animation: 6,
  Horror: 6,
};

// ============================================================================
// INFINITY VOTE BUTTON
// ============================================================================

function InfinityVoteButton({ onClick, label, size = 'normal' }: { onClick: () => void; label?: string; size?: 'small' | 'normal' }) {
  const btnSize = size === 'small' ? 'w-12 h-12' : 'w-16 h-16';
  const textSize = size === 'small' ? 'text-xl' : 'text-3xl';
  
  return (
    <div className="flex flex-col items-center gap-1">
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={onClick}
        className={`relative ${btnSize} flex items-center justify-center`}
      >
        <motion.div
          className="absolute inset-[-3px] rounded-full opacity-50"
          animate={{
            boxShadow: [
              '0 0 12px rgba(56, 189, 248, 0.5)',
              '0 0 20px rgba(168, 85, 247, 0.6)',
              '0 0 12px rgba(56, 189, 248, 0.5)',
            ],
          }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <svg className="absolute inset-0 w-full h-full drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" viewBox="0 0 64 64">
          <defs>
            <linearGradient id="voteGradStory" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3CF2FF" />
              <stop offset="50%" stopColor="#A855F7" />
              <stop offset="100%" stopColor="#EC4899" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="29" fill="rgba(0,0,0,0.3)" stroke="url(#voteGradStory)" strokeWidth="3" />
        </svg>
        <motion.span
          className={`relative z-10 ${textSize} font-black text-white`}
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ textShadow: '0 0 8px rgba(56, 189, 248, 0.8), 0 0 16px rgba(168, 85, 247, 0.6)' }}
        >
          ∞
        </motion.span>
      </motion.button>
      {label && <p className="text-white/70 text-xs font-medium">{label}</p>}
    </div>
  );
}

// ============================================================================
// ACTION BUTTON
// ============================================================================

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label?: string | number; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <motion.button whileTap={{ scale: 0.9 }} onClick={onClick} className="flex flex-col items-center gap-0.5">
      <div className="w-10 h-10 rounded-full flex items-center justify-center">{icon}</div>
      {label !== undefined && (
        <span className="text-white text-[10px] font-semibold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">{label}</span>
      )}
    </motion.button>
  );
}

// ============================================================================
// VIDEO PLAYER SECTION (Top)
// ============================================================================

interface VideoPlayerProps {
  season: Season;
  onVote: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

function VideoPlayer({ season, onVote, isFullscreen, onToggleFullscreen }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [showContributors, setShowContributors] = useState(false);
  const [showContributorsPopup, setShowContributorsPopup] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [lastTap, setLastTap] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const completedSegments = season.slots.filter(s => s.status === 'locked' && s.winning_clip);
  const currentSegment = completedSegments[currentIndex];
  const totalDuration = completedSegments.length * 8;
  const isActive = season.status === 'active';
  const isCompleted = season.status === 'completed';
  const isComingSoon = season.status === 'coming_soon';

  // Reset when season changes
  useEffect(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, [season.id]);

  // Auto-advance segments
  useEffect(() => {
    if (!isPlaying || completedSegments.length === 0) return;
    const timer = setTimeout(() => {
      if (currentIndex < completedSegments.length - 1) {
        setCurrentIndex(prev => prev + 1);
      } else {
        setCurrentIndex(0);
        setIsPlaying(false);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [currentIndex, isPlaying, completedSegments.length]);

  const handleTap = () => {
    // Close popup if open
    if (showContributorsPopup) {
      setShowContributorsPopup(false);
      return;
    }
    
    if (completedSegments.length === 0 || showContributors || showComments) return;
    
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    
    if (now - lastTap < DOUBLE_TAP_DELAY) {
      // Double tap detected - toggle fullscreen
      onToggleFullscreen();
      setLastTap(0);
    } else {
      // Single tap - wait to see if it's a double tap
      setLastTap(now);
      setTimeout(() => {
        // If no second tap happened, toggle play/pause
        if (Date.now() - now >= DOUBLE_TAP_DELAY - 50) {
          setIsPlaying(prev => {
            if (videoRef.current) {
              prev ? videoRef.current.pause() : videoRef.current.play();
            }
            return !prev;
          });
        }
      }, DOUBLE_TAP_DELAY);
    }
  };

  const handlePlayPause = () => {
    if (completedSegments.length === 0 || showContributors || showComments) return;
    setIsPlaying(!isPlaying);
    if (videoRef.current) {
      isPlaying ? videoRef.current.pause() : videoRef.current.play();
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const jumpToSegment = (index: number) => {
    setCurrentIndex(index);
    setShowContributors(false);
    setIsPlaying(true);
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      try { await navigator.share({ title: `AiMoviez Season ${season.number}`, url: window.location.href }); } catch {}
    } else {
      await navigator.clipboard.writeText(window.location.href);
    }
  };

  // Coming Soon View
  if (isComingSoon) {
    return (
      <div className="relative h-full bg-gradient-to-br from-purple-900/30 via-black to-pink-900/30">
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6">
          <Lock className="w-16 h-16 text-white/30 mb-4" />
          <h2 className="text-white text-2xl font-bold mb-2">Season {season.number}</h2>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-purple-400" />
            <span className="text-purple-400 font-medium">Coming Soon</span>
          </div>
          <p className="text-white/50 text-center mb-6">Vote for the genre in the list below</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (completedSegments.length === 0) {
    return (
      <div className="relative h-full bg-black" onClick={handlePlayPause}>
        <img src={season.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/30" />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="text-5xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7]"
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            ∞
          </motion.span>
          <h2 className="text-white text-xl font-bold mt-4">Season {season.number}</h2>
          <p className="text-white/50 text-sm mt-1">Be the first to contribute!</p>
          <motion.button whileTap={{ scale: 0.95 }} onClick={onVote} className="mt-6 px-6 py-3 rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 text-white font-bold">
            Start Voting
          </motion.button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full bg-black overflow-hidden" onClick={handleTap}>
      {/* Video/Image */}
      <AnimatePresence mode="wait">
        <motion.div key={currentIndex} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
          {isPlaying && currentSegment?.winning_clip?.video_url ? (
            <video
              ref={videoRef}
              src={currentSegment.winning_clip.video_url}
              poster={currentSegment.winning_clip.thumbnail_url}
              className="w-full h-full object-cover"
              autoPlay
              muted={isMuted}
              playsInline
            />
          ) : (
            <img src={currentSegment?.winning_clip?.thumbnail_url || season.thumbnail_url} alt="" className="w-full h-full object-cover" />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/50 pointer-events-none" />

      {/* Top Left: Expand button + segments info */}
      <div className="absolute top-0 left-0 pt-12 px-4 z-10">
        <div className="flex flex-col gap-1">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center border border-white/20"
          >
            {isFullscreen ? (
              <Minimize2 className="w-5 h-5 text-white" />
            ) : (
              <Maximize2 className="w-5 h-5 text-white" />
            )}
          </motion.button>
          <p className="text-white/70 text-xs mt-1 drop-shadow">
            {completedSegments.length}/{season.total_slots} segments · {formatDuration(completedSegments.length * 8)}/10:00
          </p>
        </div>
      </div>


      {/* Center: Play button */}
      <AnimatePresence>
        {!isPlaying && !showContributors && !showComments && (
          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center">
              <Play className="w-10 h-10 text-white ml-1" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right Column - Season info at top, then actions */}
      <div className="absolute right-3 top-10 bottom-16 flex flex-col items-center justify-start gap-2 z-20">
        {/* Season info - at very top */}
        <div className="flex flex-col items-center">
          <span className="text-white font-bold text-sm drop-shadow-lg">Season {season.number}</span>
          {isActive && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/30 mt-1">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400 text-[10px] font-medium">LIVE</span>
            </div>
          )}
          {isCompleted && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/30 mt-1">
              <Check className="w-3 h-3 text-green-400" />
              <span className="text-green-400 text-[10px] font-medium">Complete</span>
            </div>
          )}
        </div>

        {/* Contributors */}
        <div className="relative">
          <ActionButton 
            icon={<Trophy className="w-6 h-6 text-yellow-400 drop-shadow-lg" />} 
            label={completedSegments.length} 
            onClick={(e) => { e.stopPropagation(); setShowContributorsPopup(!showContributorsPopup); }} 
          />
          
          {/* Contributors Popup - Transparent & Scrollable */}
          <AnimatePresence>
            {showContributorsPopup && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, x: 10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: 10 }}
                className="absolute right-14 top-0 w-56 bg-black/50 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden"
                style={{ maxHeight: '60vh' }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-black/30">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-yellow-400" />
                    <span className="text-white font-semibold text-sm">Top contributors</span>
                  </div>
                  <button onClick={() => setShowContributorsPopup(false)} className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
                
                {/* Scrollable List */}
                <div className="overflow-y-auto" style={{ maxHeight: 'calc(60vh - 44px)' }}>
                  {getTopContributors(completedSegments).map((contributor, idx) => (
                    <div key={contributor.username} className="flex items-center gap-2 px-3 py-2 hover:bg-white/10 border-b border-white/5 last:border-b-0">
                      <img src={contributor.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">@{contributor.username}</p>
                        <p className="text-white/50 text-xs">
                          {contributor.segments} segment{contributor.segments > 1 ? 's' : ''} · {formatNumber(contributor.totalVotes)} ♡
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        {/* Vote Button */}
        <InfinityVoteButton onClick={onVote} size="small" />
        
        {/* Heart / Likes */}
        <ActionButton icon={<Heart className="w-6 h-6 text-white drop-shadow-lg" />} label={formatNumber(season.total_votes)} />
        
        {/* Comments */}
        <ActionButton icon={<MessageCircle className="w-6 h-6 text-white drop-shadow-lg" />} label={24} onClick={(e) => { e.stopPropagation(); setShowComments(true); }} />
        
        {/* Share */}
        <ActionButton icon={<Share2 className="w-6 h-6 text-white drop-shadow-lg" />} onClick={handleShare} />
        
        {/* Mute */}
        <motion.button whileTap={{ scale: 0.9 }} onClick={toggleMute} className="w-8 h-8 flex items-center justify-center">
          {isMuted ? <VolumeX className="w-5 h-5 text-white drop-shadow-lg" /> : <Volume2 className="w-5 h-5 text-white drop-shadow-lg" />}
        </motion.button>
      </div>

      {/* Bottom left: Creator info - just above split */}
      {currentSegment?.winning_clip && (
        <div className="absolute bottom-2 left-4 z-10">
          <div className="flex items-center gap-2">
            <img src={currentSegment.winning_clip.avatar_url} alt="" className="w-8 h-8 rounded-full border border-white/30" />
            <div>
              <p className="text-white text-sm font-semibold drop-shadow">@{currentSegment.winning_clip.username}</p>
              <p className="text-white/50 text-xs">{currentSegment.winning_clip.genre}</p>
            </div>
          </div>
        </div>
      )}

      {/* Contributors Panel */}
      <AnimatePresence>
        {showContributors && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-40" onClick={() => setShowContributors(false)} />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25 }} className="absolute inset-x-0 bottom-0 top-16 z-50 bg-black/70 backdrop-blur-md rounded-t-3xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-white/30" /></div>
              <div className="flex items-center justify-between px-4 pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-400" />
                  <span className="text-white font-bold">Contributors ({completedSegments.length})</span>
                </div>
                <button onClick={() => setShowContributors(false)} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                  <ChevronDown className="w-5 h-5 text-white" />
                </button>
              </div>
              <div className="overflow-y-auto h-[calc(100%-60px)] px-4 py-3">
                {completedSegments.map((segment, index) => (
                  <motion.button key={segment.id} whileTap={{ scale: 0.98 }} onClick={() => jumpToSegment(index)} className="w-full flex items-center gap-3 p-2 rounded-xl bg-white/10 hover:bg-white/20 mb-2 border border-white/10">
                    <div className="relative w-12 h-16 rounded-lg overflow-hidden flex-shrink-0">
                      <img src={segment.winning_clip?.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Play className="w-4 h-4 text-white" />
                      </div>
                      <div className="absolute top-0.5 left-0.5 px-1 py-0.5 rounded bg-black/60 text-white text-[8px] font-bold">#{segment.slot_position}</div>
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-white font-medium text-sm">@{segment.winning_clip?.username}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Heart className="w-3 h-3 text-pink-400" />
                        <span className="text-white/60 text-xs">{formatNumber(segment.winning_clip?.vote_count || 0)}</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-white/30" />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Comments Panel - TikTok Style */}
      <AnimatePresence>
        {showComments && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/20 z-40" 
              onClick={() => setShowComments(false)} 
            />
            {/* Panel */}
            <motion.div 
              initial={{ y: '100%' }} 
              animate={{ y: 0 }} 
              exit={{ y: '100%' }} 
              transition={{ type: 'tween', duration: 0.3, ease: [0.32, 0.72, 0, 1] }} 
              className="absolute inset-x-0 bottom-0 h-[70%] bg-[#121212]/95 backdrop-blur-xl z-50 rounded-t-3xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-white/30" /></div>
              <div className="flex items-center justify-between px-4 pb-2 border-b border-white/10">
                <span className="text-white font-bold text-sm">Comments (24)</span>
                <button onClick={() => setShowComments(false)} className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">
                  <ChevronDown className="w-4 h-4 text-white" />
                </button>
              </div>
              <div className="overflow-y-auto h-[calc(100%-100px)] px-4 py-2">
                {[
                  { user: 'movie_fan', text: 'This is amazing! 🔥', time: '2m' },
                  { user: 'creator_123', text: 'Can\'t wait for more!', time: '5m' },
                  { user: 'film_lover', text: 'Great transitions', time: '12m' },
                  { user: 'director_x', text: 'Thanks for voting! 🙏', time: '1h' },
                ].map((c, i) => (
                  <div key={i} className="flex gap-2 mb-3">
                    <img src={`https://api.dicebear.com/7.x/identicon/svg?seed=${c.user}`} alt="" className="w-7 h-7 rounded-full" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-medium text-xs">@{c.user}</span>
                        <span className="text-white/40 text-[10px]">{c.time}</span>
                      </div>
                      <p className="text-white/80 text-xs">{c.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-3 bg-black/50 border-t border-white/10">
                <div className="flex items-center gap-2">
                  <input type="text" placeholder="Add a comment..." className="flex-1 bg-white/10 rounded-full px-3 py-1.5 text-white text-xs placeholder:text-white/40 outline-none border border-white/10" />
                  <button className="text-cyan-400 font-semibold text-xs">Post</button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// SEASON LIST ITEM
// ============================================================================

interface SeasonListItemProps {
  season: Season;
  isSelected: boolean;
  onSelect: () => void;
}

function SeasonListItem({ season, isSelected, onSelect }: SeasonListItemProps) {
  const router = useRouter();
  const completedSegments = season.slots.filter(s => s.status === 'locked' && s.winning_clip);
  const progressPercent = Math.round((completedSegments.length / season.total_slots) * 100);
  const isActive = season.status === 'active';
  const isCompleted = season.status === 'completed';
  const isComingSoon = season.status === 'coming_soon';

  const handleThumbnailTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isActive) {
      // Go to voting arena for active seasons
      router.push('/dashboard');
    } else {
      // Select season for non-active
      onSelect();
    }
  };

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onSelect}
      className={`w-full flex items-center gap-3 p-3 transition-colors ${
        isSelected ? 'bg-white/10' : 'bg-transparent hover:bg-white/5'
      }`}
    >
      {/* Animated Thumbnail */}
      <motion.div 
        whileTap={{ scale: 0.95 }}
        onClick={handleThumbnailTap}
        className="relative w-16 h-24 rounded-xl overflow-hidden flex-shrink-0 bg-white/5 cursor-pointer"
      >
        {isComingSoon ? (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500/20 to-pink-500/20">
            <Lock className="w-6 h-6 text-white/40" />
          </div>
        ) : (
          <>
            {/* Thumbnail image */}
            <img
              src={completedSegments[completedSegments.length - 1]?.winning_clip?.thumbnail_url || season.thumbnail_url}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Play className="w-6 h-6 text-white" />
            </div>
            
            {/* Breathing VOTE overlay - only for active seasons */}
            {isActive && (
              <motion.div
                className="absolute inset-0 flex flex-col items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, rgba(80,180,200,0.85) 0%, rgba(140,100,180,0.85) 50%, rgba(180,100,140,0.85) 100%)'
                }}
                animate={{ 
                  opacity: [0, 0.85, 0.85, 0],
                }}
                transition={{ 
                  duration: 10,
                  repeat: Infinity,
                  ease: [0.4, 0, 0.2, 1], // cubic-bezier for ultra smooth
                  times: [0, 0.3, 0.7, 1]
                }}
              >
                {/* Breathing infinity symbol */}
                <motion.div
                  animate={{ 
                    scale: [1, 1.08, 1],
                    opacity: [0.85, 1, 0.85]
                  }}
                  transition={{ 
                    duration: 5,
                    repeat: Infinity,
                    ease: [0.45, 0, 0.55, 1] // ultra smooth sine-like curve
                  }}
                  className="text-white/90 text-2xl font-bold drop-shadow-md"
                >
                  ∞
                </motion.div>
                {/* VOTE text */}
                <motion.span 
                  animate={{
                    opacity: [0.65, 0.85, 0.65]
                  }}
                  transition={{
                    duration: 5,
                    repeat: Infinity,
                    ease: [0.45, 0, 0.55, 1]
                  }}
                  className="text-white/90 text-[10px] font-bold tracking-wider drop-shadow-md mt-0.5"
                >
                  VOTE
                </motion.span>
              </motion.div>
            )}
          </>
        )}
        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold z-10">
          S{season.number}
        </div>
      </motion.div>

      {/* Info */}
      <div className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-white font-bold">Season {season.number}</span>
          {isActive && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/30">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400 text-[10px] font-medium">LIVE</span>
            </div>
          )}
          {isCompleted && (
            <div className="w-5 h-5 rounded-full bg-green-500/30 flex items-center justify-center">
              <Check className="w-3 h-3 text-green-400" />
            </div>
          )}
          {isComingSoon && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-500/30">
              <Clock className="w-3 h-3 text-purple-400" />
              <span className="text-purple-400 text-[10px] font-medium">Soon</span>
            </div>
          )}
        </div>

        <p className="text-white/50 text-sm truncate">{season.name}</p>

        {!isComingSoon && (
          <>
            <div className="h-1 rounded-full bg-white/20 overflow-hidden mt-2 mb-1">
              <div
                className={`h-full ${isCompleted ? 'bg-green-500' : 'bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500'}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-white/40">
              <span>{completedSegments.length}/{season.total_slots}</span>
              <span>{formatDuration(completedSegments.length * 8)} / 10:00</span>
            </div>
          </>
        )}

        {isComingSoon && (
          <p className="text-purple-400/70 text-xs mt-1">Vote for genre</p>
        )}
      </div>

      {/* Arrow */}
      <ChevronRight className={`w-5 h-5 flex-shrink-0 ${isSelected ? 'text-white' : 'text-white/30'}`} />
    </motion.button>
  );
}

// ============================================================================
// MAIN STORY PAGE
// ============================================================================

function StoryPage() {
  const router = useRouter();
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(MOCK_SEASONS[0].id);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const selectedSeason = MOCK_SEASONS.find(s => s.id === selectedSeasonId) || MOCK_SEASONS[0];

  const handleVoteNow = () => {
    localStorage.setItem('aimoviez_has_voted', 'true');
    router.push('/dashboard');
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <div className="h-screen bg-black flex flex-col">
      {/* Video Player */}
      <motion.div
        className="relative"
        animate={{
          height: isFullscreen ? '100vh' : '55vh',
        }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      >
        <VideoPlayer
          season={selectedSeason}
          onVote={handleVoteNow}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </motion.div>

      {/* Season List (hidden when fullscreen) */}
      <AnimatePresence>
        {!isFullscreen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex-1 overflow-y-auto border-t border-white/10"
          >
            <div className="py-2">
              {MOCK_SEASONS.map(season => (
                <SeasonListItem
                  key={season.id}
                  season={season}
                  isSelected={season.id === selectedSeasonId}
                  onSelect={() => setSelectedSeasonId(season.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Navigation (hidden when fullscreen) */}
      <AnimatePresence>
        {!isFullscreen && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="bg-black border-t border-white/10 flex-shrink-0"
          >
            <div className="flex items-center justify-around px-4 py-2">
              <div className="flex flex-col items-center gap-1 py-2 px-6">
                <BookOpen className="w-6 h-6 text-white" />
                <span className="text-white text-xs font-medium">Story</span>
              </div>
              <Link href="/upload">
                <motion.div whileTap={{ scale: 0.9 }} className="flex flex-col items-center gap-1 py-2 px-6">
                  <Plus className="w-7 h-7 text-white/70" />
                  <span className="text-white/60 text-xs">Upload</span>
                </motion.div>
              </Link>
              <Link href="/profile">
                <motion.div whileTap={{ scale: 0.9 }} className="flex flex-col items-center gap-1 py-2 px-6">
                  <User className="w-6 h-6 text-white/70" />
                  <span className="text-white/60 text-xs">Profile</span>
                </motion.div>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default StoryPage;