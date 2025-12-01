'use client';

// ============================================================================
// STORY PAGE - V5.0 (Real API Data)
// ============================================================================
// Features:
// ✅ Fetches real seasons/slots from /api/story
// ✅ Split view: Video player (top 55%) + Season list (bottom)
// ✅ Video fills entire top section (no black bars)
// ✅ Swipe/scroll season list to browse
// ✅ Tap season → plays in top video player
// ✅ Right column actions on video
// ✅ Contributors panel (transparent)
// ✅ Coming Soon season with genre voting
// ✅ TikTok-style comments panel (no black flash)
// ✅ Heart button voting (no infinity symbol)
// ✅ Clean thumbnail design (no breathing overlay)
// ============================================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  Pause,
} from 'lucide-react';
import CommentsSection from '@/components/CommentsSection';
import BottomNavigation from '@/components/BottomNavigation';

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
// API RESPONSE TYPE
// ============================================================================

interface StoryAPIResponse {
  seasons: Season[];
}

// Fetch seasons from API
async function fetchSeasons(): Promise<Season[]> {
  const response = await fetch('/api/story');
  if (!response.ok) {
    throw new Error('Failed to fetch story data');
  }
  const data: StoryAPIResponse = await response.json();
  return data.seasons || [];
}

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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

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

  // Control video playback when isPlaying changes or index changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    if (isPlaying) {
      // Small delay to ensure video element is ready after index change
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Autoplay blocked - this is fine, user will tap to play
        });
      }
    } else {
      video.pause();
    }
  }, [isPlaying, currentIndex]);

  // Note: Auto-advance is handled by video onEnded event

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
          setIsPlaying(prev => !prev);
        }
      }, DOUBLE_TAP_DELAY);
    }
  };

  const handlePlayPause = () => {
    if (completedSegments.length === 0 || showContributors || showComments) return;
    setIsPlaying(!isPlaying);
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

  // Progress bar handlers
  const handleTimeUpdate = () => {
    if (videoRef.current && !isDragging) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!progressRef.current || !videoRef.current) return;

    const rect = progressRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;

    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleProgressDrag = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging || !progressRef.current || !videoRef.current) return;

    const rect = progressRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = clickX / rect.width;
    const newTime = percentage * duration;

    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Format time for display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
        {season.thumbnail_url && <img src={season.thumbnail_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />}
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
          {currentSegment?.winning_clip?.video_url ? (
            <>
              {/* Show thumbnail as background while video loads */}
              {currentSegment.winning_clip.thumbnail_url && (
                <img
                  src={currentSegment.winning_clip.thumbnail_url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <video
                ref={videoRef}
                src={currentSegment.winning_clip.video_url}
                poster={currentSegment.winning_clip.thumbnail_url || undefined}
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay={isPlaying}
                muted={isMuted}
                playsInline
                preload="auto"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => {
                  // Auto-advance to next segment, keep playing
                  if (currentIndex < completedSegments.length - 1) {
                    setCurrentIndex(prev => prev + 1);
                  } else {
                    // End of season - loop back to start or stop
                    setCurrentIndex(0);
                    setIsPlaying(false);
                  }
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => {
                  // Only set to false if we didn't just finish (avoid pause during transition)
                }}
              />
              {/* Play button overlay when paused */}
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                    <Play className="w-8 h-8 text-white ml-1" fill="white" />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#3CF2FF]/20 to-[#FF00C7]/20 flex items-center justify-center">
              <Play className="w-16 h-16 text-white/50" />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/50 pointer-events-none" />

      {/* Top Right: Fullscreen toggle */}
      <div className="absolute top-0 right-0 pt-12 pr-4 z-30">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}
          className="w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20"
        >
          {isFullscreen ? (
            <Minimize2 className="w-4 h-4 text-white" />
          ) : (
            <Maximize2 className="w-4 h-4 text-white" />
          )}
        </motion.button>
      </div>

      {/* Top Left: Compact progress info (mobile-friendly) */}
      <div className="absolute top-0 left-0 pt-12 px-3 z-10">
        <div className="flex flex-col gap-1.5">
          {/* Progress pill - compact */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-white/10">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span className="text-white/90 text-[10px] font-medium">
              {completedSegments.length}/{season.total_slots}
            </span>
            <span className="text-white/50 text-[10px]">·</span>
            <span className="text-white/70 text-[10px]">
              {formatDuration(completedSegments.length * 8)}
            </span>
          </div>

          {/* Voting Segment Indicator - compact */}
          {season.current_voting_slot && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-2 py-1 rounded-full bg-orange-500/90 backdrop-blur-sm flex items-center gap-1.5 w-fit"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              <span className="text-white text-[10px] font-bold">
                Voting #{season.current_voting_slot}
              </span>
            </motion.div>
          )}
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

      {/* Right Column - Responsive position for mobile */}
      <div className="absolute right-3 bottom-4 z-20 flex flex-col items-center gap-3 md:gap-4 md:bottom-28">
        {/* Creator Avatar - Hidden on very small screens, visible on md+ */}
        {currentSegment?.winning_clip && (
          <div className="hidden sm:block relative">
            <img
              src={currentSegment.winning_clip.avatar_url}
              alt=""
              className="w-10 h-10 md:w-12 md:h-12 rounded-full border-2 border-white/80 object-cover"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
            />
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-4 md:w-5 md:h-5 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center border-2 border-black">
              <span className="text-white text-[8px] md:text-[10px] font-bold">+</span>
            </div>
          </div>
        )}

        {/* Trophy/Segments */}
        <div className="relative">
          <motion.button
            whileTap={{ scale: 0.8 }}
            onClick={(e) => { e.stopPropagation(); setShowContributorsPopup(!showContributorsPopup); }}
            className="flex flex-col items-center gap-0.5"
          >
            <Trophy className="w-7 h-7 md:w-9 md:h-9 text-yellow-400 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]" />
            <span className="text-white text-[10px] md:text-xs font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              {completedSegments.length}
            </span>
          </motion.button>
          
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
        
        {/* Vote Button - Always visible, same style on all seasons */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          onClick={isActive ? onVote : () => window.location.href = '/dashboard'}
          className="flex flex-col items-center gap-0.5 relative"
        >
          <Heart 
            className="w-7 h-7 md:w-9 md:h-9 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
          />
          <span className="text-white text-[10px] md:text-xs font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
            {formatNumber(season.total_votes)}
          </span>
        </motion.button>
        
        {/* Rankings Button (Completed) */}
        {isCompleted && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              window.location.href = '/leaderboard';
            }}
            className="flex flex-col items-center gap-0.5"
          >
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-500 flex items-center justify-center shadow-lg">
              <Trophy className="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow-lg" />
            </div>
            <span className="text-white text-[9px] md:text-[10px] font-bold drop-shadow">Rankings</span>
          </motion.button>
        )}
        
        {/* Comments */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          onClick={(e) => { e.stopPropagation(); setShowComments(true); }}
          className="flex flex-col items-center gap-0.5"
        >
          <MessageCircle className="w-6 h-6 md:w-7 md:h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
          <span className="text-white text-[10px] md:text-xs font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">24</span>
        </motion.button>
        
        {/* Share */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          onClick={handleShare}
          className="flex flex-col items-center gap-0.5"
        >
          <Share2 className="w-6 h-6 md:w-7 md:h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
        </motion.button>
        
        {/* Mute */}
        <motion.button
          whileTap={{ scale: 0.8 }}
          onClick={toggleMute}
          className="flex flex-col items-center gap-0.5"
        >
          {isMuted ? (
            <VolumeX className="w-6 h-6 md:w-7 md:h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
          ) : (
            <Volume2 className="w-6 h-6 md:w-7 md:h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
          )}
        </motion.button>
      </div>

      {/* Progress Bar - Below video */}
      {completedSegments.length > 0 && duration > 0 && (
        <div className="absolute bottom-16 md:bottom-24 left-4 md:left-60 right-4 md:right-20 z-20" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            {/* Play/Pause Button */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
              className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 text-white" fill="white" />
              ) : (
                <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
              )}
            </motion.button>

            {/* Progress Bar */}
            <div
              ref={progressRef}
              className="flex-1 h-1.5 bg-white/20 rounded-full cursor-pointer relative group"
              onClick={handleProgressClick}
              onMouseDown={handleDragStart}
              onMouseMove={handleProgressDrag}
              onMouseUp={handleDragEnd}
              onMouseLeave={handleDragEnd}
              onTouchStart={handleDragStart}
              onTouchMove={handleProgressDrag}
              onTouchEnd={handleDragEnd}
            >
              {/* Buffered/Progress */}
              <div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 rounded-full transition-all"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
              {/* Draggable Handle */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${duration > 0 ? (currentTime / duration) * 100 : 0}% - 6px)` }}
              />
            </div>

            {/* Time Display */}
            <span className="text-white/70 text-xs font-mono min-w-[70px] text-right">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>
      )}

      {/* Bottom left: Creator info - Higher on mobile to avoid season list */}
      {currentSegment?.winning_clip && (
        <div className="absolute bottom-4 md:bottom-12 left-4 md:left-60 right-16 z-20">
          <div className="flex items-center gap-2">
            <p className="text-white font-semibold text-sm drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
              @{currentSegment.winning_clip.username}
            </p>
            <span className="text-white/60">·</span>
            <p className="text-white/80 text-sm drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">{currentSegment.winning_clip.genre}</p>
            {isCompleted && (
              <div className="px-1.5 py-0.5 rounded bg-gradient-to-r from-yellow-400 to-orange-500 flex items-center gap-0.5 ml-1">
                <Trophy className="w-3 h-3 text-white" />
                <span className="text-white text-[9px] font-bold">Winner</span>
              </div>
            )}
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
                    <div className="relative w-12 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br from-[#3CF2FF]/20 to-[#FF00C7]/20">
                      {segment.winning_clip?.thumbnail_url ? (
                        <img src={segment.winning_clip.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <video src={segment.winning_clip?.video_url} className="w-full h-full object-cover" muted playsInline />
                      )}
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

      {/* Comments Panel - Using shared CommentsSection component */}
      <CommentsSection
        clipId={currentSegment?.winning_clip?.id || ''}
        isOpen={showComments}
        onClose={() => setShowComments(false)}
        clipUsername={currentSegment?.winning_clip?.username}
      />
    </div>
  );
}

// ============================================================================
// HORIZONTAL SEASON STRIP (Mobile - Swipeable)
// ============================================================================

interface SeasonStripProps {
  seasons: Season[];
  selectedSeasonId: string | null;
  onSelectSeason: (id: string) => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
}

function SeasonStrip({ seasons, selectedSeasonId, onSelectSeason, onSwipeLeft, onSwipeRight }: SeasonStripProps) {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSeason = seasons.find(s => s.id === selectedSeasonId) || seasons[0];
  const currentIndex = seasons.findIndex(s => s.id === selectedSeasonId);
  const completedSegments = selectedSeason?.slots.filter(s => s.status === 'locked' && s.winning_clip) || [];
  const progressPercent = selectedSeason ? Math.round((completedSegments.length / selectedSeason.total_slots) * 100) : 0;

  const isActive = selectedSeason?.status === 'active';
  const isCompleted = selectedSeason?.status === 'completed';
  const isComingSoon = selectedSeason?.status === 'coming_soon';

  // Swipe detection
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      onSwipeLeft(); // Next season
    } else if (isRightSwipe) {
      onSwipeRight(); // Previous season
    }
  };

  if (!selectedSeason) return null;

  return (
    <div
      ref={containerRef}
      className="bg-black/80 backdrop-blur-md border-t border-white/10"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Season Indicator Dots */}
      <div className="flex justify-center gap-1.5 pt-2 pb-1">
        {seasons.map((season, idx) => (
          <button
            key={season.id}
            onClick={() => onSelectSeason(season.id)}
            className={`transition-all ${
              season.id === selectedSeasonId
                ? 'w-6 h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500'
                : 'w-1.5 h-1.5 rounded-full bg-white/30'
            }`}
          />
        ))}
      </div>

      {/* Main Season Info */}
      <div className="px-4 pb-2">
        <div className="flex items-center gap-3">
          {/* Thumbnail */}
          <div className="relative w-12 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-white/5">
            {isComingSoon ? (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500/30 to-pink-500/30">
                <Lock className="w-4 h-4 text-white/50" />
              </div>
            ) : completedSegments.length > 0 && completedSegments[completedSegments.length - 1]?.winning_clip?.thumbnail_url ? (
              /* Has thumbnail - show it */
              <img
                src={completedSegments[completedSegments.length - 1].winning_clip!.thumbnail_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : completedSegments.length > 0 && completedSegments[completedSegments.length - 1]?.winning_clip?.video_url ? (
              /* No thumbnail but has video - show video first frame */
              <video
                src={completedSegments[completedSegments.length - 1].winning_clip!.video_url}
                className="w-full h-full object-cover"
                muted
                playsInline
                preload="metadata"
              />
            ) : selectedSeason.thumbnail_url ? (
              <img
                src={selectedSeason.thumbnail_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              /* No thumbnail yet - show gradient with season number */
              <div className="w-full h-full bg-gradient-to-br from-[#3CF2FF]/30 via-[#A020F0]/30 to-[#FF00C7]/30 flex flex-col items-center justify-center">
                <span className="text-white/80 text-lg font-black">S{selectedSeason.number}</span>
                {isActive && (
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse mt-1" />
                )}
              </div>
            )}
            {/* Only show badge if we have an actual thumbnail/video */}
            {(completedSegments.length > 0 || selectedSeason.thumbnail_url) && (
              <div className="absolute top-0.5 left-0.5 px-1 py-0.5 rounded bg-black/70 text-white text-[7px] font-bold">
                S{selectedSeason.number}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-white font-bold text-sm">Season {selectedSeason.number}</span>
              {isActive && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/30">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-red-400 text-[9px] font-medium">LIVE</span>
                </div>
              )}
              {isCompleted && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-500/30">
                  <Check className="w-3 h-3 text-green-400" />
                  <span className="text-green-400 text-[9px] font-medium">Done</span>
                </div>
              )}
              {isComingSoon && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-purple-500/30">
                  <Clock className="w-3 h-3 text-purple-400" />
                  <span className="text-purple-400 text-[9px] font-medium">Soon</span>
                </div>
              )}
            </div>

            {!isComingSoon && (
              <>
                {/* Progress Bar */}
                <div className="h-1 rounded-full bg-white/20 overflow-hidden mb-1">
                  <div
                    className={`h-full transition-all ${isCompleted ? 'bg-green-500' : 'bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500'}`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-white/50">
                  <span>{completedSegments.length}/{selectedSeason.total_slots} segments</span>
                  <span>{formatDuration(completedSegments.length * 8)}/10:00</span>
                </div>
              </>
            )}

            {isComingSoon && (
              <p className="text-purple-400/70 text-xs">Vote for genre</p>
            )}
          </div>

          {/* Swipe Hint Arrows */}
          <div className="flex flex-col items-center gap-1 text-white/30">
            {currentIndex > 0 && (
              <ChevronRight className="w-4 h-4 rotate-180" />
            )}
            {currentIndex < seasons.length - 1 && (
              <ChevronRight className="w-4 h-4" />
            )}
          </div>
        </div>
      </div>

      {/* Swipe hint text */}
      <div className="text-center pb-1">
        <span className="text-white/30 text-[9px]">Swipe to change season</span>
      </div>
    </div>
  );
}

// ============================================================================
// SEASON LIST ITEM (Desktop only now)
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
    // Just select the season (show video at top)
    onSelect();
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
            {/* Thumbnail - use video preview if no thumbnail */}
            {completedSegments[completedSegments.length - 1]?.winning_clip?.thumbnail_url || season.thumbnail_url ? (
              <img
                src={completedSegments[completedSegments.length - 1]?.winning_clip?.thumbnail_url || season.thumbnail_url}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : completedSegments[completedSegments.length - 1]?.winning_clip?.video_url ? (
              <video
                src={completedSegments[completedSegments.length - 1]?.winning_clip?.video_url}
                className="w-full h-full object-cover"
                muted
                playsInline
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#3CF2FF]/20 to-[#FF00C7]/20" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <Play className="w-6 h-6 text-white" />
            </div>
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
            {/* Progress Section - Visual only */}
            <div className="mt-2 mb-1">
              {/* Progress Bar */}
              <div className="h-1.5 rounded-full bg-white/20 overflow-hidden relative mb-1">
                <div
                  className={`h-full transition-all ${isCompleted ? 'bg-green-500' : 'bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500'}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Stats */}
              <div className="flex justify-between text-[10px] text-white/40">
                <span>{completedSegments.length}/{season.total_slots}</span>
                <span>{formatDuration(completedSegments.length * 8)} / 10:00</span>
              </div>
            </div>

            {/* Action Buttons */}
            {isActive && (
              <div className="mt-3">
                {/* Rankings Button - Full width */}
                <motion.div
                  whileTap={{ scale: 0.95 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push('/leaderboard');
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-white/10 border border-white/20
                           text-white text-xs font-bold hover:bg-white/20 transition-all cursor-pointer text-center"
                >
                  🏆 View Rankings
                </motion.div>
              </div>
            )}

            {/* Rankings Button - Only for completed seasons */}
            {isCompleted && (
              <div className="mt-3">
                <motion.div
                  whileTap={{ scale: 0.95 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push('/leaderboard');
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-gradient-to-r from-yellow-400 via-amber-500 to-orange-500
                           text-white text-xs font-bold shadow-lg hover:shadow-xl transition-all cursor-pointer text-center"
                >
                  🏆 View Final Rankings
                </motion.div>
              </div>
            )}
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
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fetch seasons from API
  const { data: seasons = [], isLoading, error, refetch } = useQuery<Season[]>({
    queryKey: ['story-seasons'],
    queryFn: fetchSeasons,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  // Set initial selected season when data loads
  useEffect(() => {
    if (seasons.length > 0 && !selectedSeasonId) {
      setSelectedSeasonId(seasons[0].id);
    }
  }, [seasons, selectedSeasonId]);

  const selectedSeason = seasons.find(s => s.id === selectedSeasonId) || seasons[0];

  const handleVoteNow = () => {
    localStorage.setItem('aimoviez_has_voted', 'true');
    router.push('/dashboard');
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const goToPrevSeason = useCallback(() => {
    const currentIdx = seasons.findIndex(s => s.id === selectedSeasonId);
    if (currentIdx > 0) {
      setSelectedSeasonId(seasons[currentIdx - 1].id);
    }
  }, [seasons, selectedSeasonId]);

  const goToNextSeason = useCallback(() => {
    const currentIdx = seasons.findIndex(s => s.id === selectedSeasonId);
    if (currentIdx < seasons.length - 1) {
      setSelectedSeasonId(seasons[currentIdx + 1].id);
    }
  }, [seasons, selectedSeasonId]);

  // Loading state
  if (isLoading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <motion.span
          className="text-6xl font-black text-white"
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          style={{ textShadow: '0 0 30px rgba(56, 189, 248, 0.8)' }}
        >
          ∞
        </motion.span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="h-screen bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-5xl mb-4">😵</div>
          <h2 className="text-white text-xl font-bold mb-2">Connection Error</h2>
          <p className="text-white/60 mb-6">Failed to load story data</p>
          <button
            onClick={() => refetch()}
            className="px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state - no seasons yet
  if (seasons.length === 0 || !selectedSeason) {
    return (
      <div className="h-screen bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <motion.span
            className="text-6xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7]"
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            ∞
          </motion.span>
          <h2 className="text-white text-xl font-bold mt-6 mb-2">No Seasons Yet</h2>
          <p className="text-white/60 mb-6">Be the first to contribute a clip!</p>
          <Link
            href="/upload"
            className="px-6 py-3 rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 text-white font-bold inline-block"
          >
            Upload a Clip
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black overflow-hidden">
      {/* Desktop Layout - TikTok Style */}
      <div className="hidden md:flex h-full relative">
        {/* Full Screen Video Background */}
        <div className="absolute inset-0 z-0">
          <VideoPlayer
            season={selectedSeason}
            onVote={handleVoteNow}
            isFullscreen={false}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>

        {/* Left Sidebar - Navigation (Fully Transparent) */}
        <div className="w-56 h-full flex flex-col py-4 px-3 relative z-10" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 px-3 py-2 mb-4">
            <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7] drop-shadow-lg">
              AiMoviez
            </span>
          </Link>

          {/* Navigation Items */}
          <nav className="flex-1 space-y-1 mt-24">
            <Link href="/dashboard">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-cyan-500/30 hover:border-cyan-400/50 transition">
                <Play className="w-6 h-6 text-cyan-400" />
                <span className="font-semibold">Vote Now</span>
              </div>
            </Link>
            <Link href="/story">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-black/30 backdrop-blur-sm text-white border border-white/10">
                <BookOpen className="w-6 h-6" />
                <span className="font-semibold">Story</span>
              </div>
            </Link>
            <Link href="/upload">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-black/30 text-white/90 transition">
                <Plus className="w-6 h-6" />
                <span>Upload</span>
              </div>
            </Link>
            <Link href="/leaderboard">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-black/30 text-white/90 transition">
                <Trophy className="w-6 h-6" />
                <span>Leaderboard</span>
              </div>
            </Link>
            <Link href="/profile">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-black/30 text-white/90 transition">
                <User className="w-6 h-6" />
                <span>Profile</span>
              </div>
            </Link>
          </nav>

          {/* Season List at Bottom */}
          <div className="border-t border-white/20 pt-4 mt-4">
            <p className="text-white/70 text-xs font-medium px-3 mb-2">SEASONS</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {seasons.map(season => (
                <button
                  key={season.id}
                  onClick={() => setSelectedSeasonId(season.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition outline-none ${
                    season.id === selectedSeasonId
                      ? 'bg-black/30 backdrop-blur-sm text-white border border-white/10'
                      : 'hover:bg-black/20 text-white/80'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${
                    season.status === 'active' ? 'bg-red-500 animate-pulse' :
                    season.status === 'completed' ? 'bg-green-500' : 'bg-white/30'
                  }`} />
                  <span className="text-sm">Season {season.number}</span>
                  {season.status === 'active' && (
                    <span className="text-[10px] text-red-400 font-bold">LIVE</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Navigation Arrows - Left Side, Vertically Centered (matches dashboard) */}
        <div className="hidden md:flex absolute left-8 top-1/2 -translate-y-1/2 flex-col gap-6 z-30">
          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.25)' }}
            whileTap={{ scale: 0.9 }}
            onClick={goToPrevSeason}
            disabled={seasons.findIndex(s => s.id === selectedSeasonId) === 0}
            className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-md
                     border border-white/20 flex items-center justify-center
                     transition-all shadow-lg disabled:opacity-30"
          >
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
            </svg>
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.25)' }}
            whileTap={{ scale: 0.9 }}
            onClick={goToNextSeason}
            disabled={seasons.findIndex(s => s.id === selectedSeasonId) === seasons.length - 1}
            className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-md
                     border border-white/20 flex items-center justify-center
                     transition-all shadow-lg disabled:opacity-30"
          >
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </motion.button>
        </div>
      </div>

      {/* Mobile Layout - Maximized Video with Swipeable Season Strip */}
      <div className="md:hidden h-full flex flex-col">
        {/* Video Player - Takes most of the screen */}
        <motion.div
          className="relative flex-1"
          animate={{
            height: isFullscreen ? '100vh' : 'auto',
          }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          style={{ minHeight: isFullscreen ? '100vh' : 'calc(100vh - 170px)' }}
        >
          <VideoPlayer
            season={selectedSeason}
            onVote={handleVoteNow}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        </motion.div>

        {/* Season Strip - Compact horizontal swipeable (hidden when fullscreen) */}
        <AnimatePresence>
          {!isFullscreen && (
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="flex-shrink-0 mb-16"
            >
              <SeasonStrip
                seasons={seasons}
                selectedSeasonId={selectedSeasonId}
                onSelectSeason={setSelectedSeasonId}
                onSwipeLeft={goToNextSeason}
                onSwipeRight={goToPrevSeason}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Navigation - Using shared component (hidden when fullscreen) */}
        {!isFullscreen && <BottomNavigation />}
      </div>
    </div>
  );
}

// ============================================================================
// PAGE WRAPPER WITH QUERY CLIENT
// ============================================================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

export default function StoryPageWithProvider() {
  return (
    <QueryClientProvider client={queryClient}>
      <StoryPage />
    </QueryClientProvider>
  );
}