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

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Check,
  Maximize2,
  Minimize2,
  X,
  Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import CommentsSection from '@/components/CommentsSection';
import BottomNavigation from '@/components/BottomNavigation';
import { ActionButton } from '@/components/ActionButton';
import DirectionVotingModal from '@/components/DirectionVotingModal';
import { AuthGuard } from '@/hooks/useAuth';
import { useRealtimeClips, useRealtimeSlots, useStoryBroadcast, ClipUpdate, WinnerSelectedPayload, SeasonResetPayload } from '@/hooks/useRealtimeClips';
import { useLandscapeVideo } from '@/hooks/useLandscapeVideo';
import { DynamicDots } from '@/components/GenreSwiper';

// ============================================================================
// TYPES
// ============================================================================

type SlotStatus = 'upcoming' | 'voting' | 'locked';
type SeasonStatus = 'completed' | 'active' | 'coming_soon';
type _Genre = 'Thriller' | 'Comedy' | 'Action' | 'Sci-Fi' | 'Romance' | 'Animation' | 'Horror';

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
  description?: string;
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

// ============================================================================
// API RESPONSE TYPE
// ============================================================================

interface StoryAPIResponse {
  seasons: Season[];
}

// Fetch seasons from API
async function fetchSeasons(fresh = false): Promise<Season[]> {
  const url = fresh ? '/api/story?fresh=true' : '/api/story';
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch story data');
  }
  const data: StoryAPIResponse = await response.json();
  return data.seasons || [];
}

// ============================================================================
// TYPEWRITER INTRO OVERLAY
// ============================================================================

interface TypewriterIntroProps {
  text: string;
  seasonNumber: number;
  onComplete: () => void;
}

function TypewriterIntro({ text, seasonNumber, onComplete }: TypewriterIntroProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      if (index < text.length) {
        setDisplayedText(text.slice(0, index + 1));
        index++;
      } else {
        clearInterval(interval);
        setIsDone(true);
        // Auto-dismiss after 2s pause
        setTimeout(onComplete, 2000);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [text, onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-8"
      onClick={onComplete}
    >
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-white/50 text-xs font-medium tracking-widest uppercase mb-4"
      >
        Season {seasonNumber}
      </motion.p>
      <p className="text-white text-lg md:text-xl font-medium leading-relaxed text-center max-w-md">
        {displayedText}
        {!isDone && (
          <motion.span
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.5, repeat: Infinity }}
            className="inline-block w-0.5 h-5 bg-cyan-400 ml-0.5 align-middle"
          />
        )}
      </p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: isDone ? 1 : 0 }}
        className="text-white/30 text-xs mt-6"
      >
        Tap to continue
      </motion.p>
    </motion.div>
  );
}

// ============================================================================
// ACTION BUTTON
// ============================================================================

function _ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label?: string | number; onClick?: (e: React.MouseEvent) => void }) {
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

// Ref handle for external navigation control
export interface VideoPlayerHandle {
  goToIndex: (index: number) => void;
  goNext: () => void;
  goPrev: () => void;
  getCurrentIndex: () => number;
  getTotalSegments: () => number;
}

interface VideoPlayerProps {
  season: Season;
  onVote: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  // If true, hides internal nav buttons (for desktop where external buttons exist)
  hideInternalNav?: boolean;
  // Callback when segment changes (for syncing external UI like counter)
  onSegmentChange?: (index: number, total: number) => void;
  // Ref for imperative control
  playerRef?: React.RefObject<VideoPlayerHandle | null>;
  // Landscape mode - hide UI elements for true fullscreen
  isLandscape?: boolean;
  // Show controls in landscape mode (auto-hides after delay)
  showLandscapeControls?: boolean;
  // Mute control - lifted to parent for landscape overlay access
  isMuted?: boolean;
  onMuteToggle?: () => void;
}

function VideoPlayer({ season, onVote, isFullscreen, onToggleFullscreen, hideInternalNav, onSegmentChange, playerRef, isLandscape = false, showLandscapeControls = true, isMuted: isMutedProp, onMuteToggle }: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(true); // Start playing automatically
  const [currentIndex, setCurrentIndex] = useState(0);
  // Use prop if provided, otherwise use internal state (backwards compatible)
  const [isMutedInternal, setIsMutedInternal] = useState(true);
  const isMuted = isMutedProp !== undefined ? isMutedProp : isMutedInternal;
  const [showContributors, setShowContributors] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [lastTap, setLastTap] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [_duration, setDuration] = useState(0);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [clipDurations, setClipDurations] = useState<number[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const tapTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Track expected index to prevent stale onEnded events from causing oscillation
  const expectedIndexRef = useRef(0);
  // Track last loaded video URL to avoid redundant loads
  const lastVideoUrlRef = useRef<string | null>(null);
  // Ref for completedSegments length to use in persistent event handlers
  const segmentsLengthRef = useRef(0);
  // Swipe tracking for segment navigation
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [touchEndY, setTouchEndY] = useState<number | null>(null);

  const completedSegments = useMemo(
    () => season.slots.filter(s => s.status === 'locked' && s.winning_clip),
    [season.slots]
  );

  // Keep segment length ref in sync for persistent event handlers
  segmentsLengthRef.current = completedSegments.length;

  // Helper to safely change index - updates both state and ref
  const safeSetIndex = useCallback((newIndex: number, source: string) => {
    console.log(`[safeSetIndex] source=${source}, newIndex=${newIndex}, expectedRef=${expectedIndexRef.current}, currentIndex state will update`);
    expectedIndexRef.current = newIndex;
    setCurrentIndex(newIndex);
  }, []);

  // Expose imperative methods via ref
  useEffect(() => {
    if (playerRef) {
      (playerRef as React.MutableRefObject<VideoPlayerHandle | null>).current = {
        goToIndex: (index: number) => {
          const maxIndex = completedSegments.length - 1;
          const newIndex = Math.max(0, Math.min(index, maxIndex));
          safeSetIndex(newIndex, 'goToIndex');
        },
        goNext: () => {
          const maxIndex = completedSegments.length - 1;
          const newIndex = Math.min(expectedIndexRef.current + 1, maxIndex);
          console.log(`[goNext] called, expectedRef=${expectedIndexRef.current}, maxIndex=${maxIndex}, newIndex=${newIndex}`);
          safeSetIndex(newIndex, 'goNext');
        },
        goPrev: () => {
          const newIndex = Math.max(expectedIndexRef.current - 1, 0);
          console.log(`[goPrev] called, expectedRef=${expectedIndexRef.current}, newIndex=${newIndex}`);
          safeSetIndex(newIndex, 'goPrev');
        },
        getCurrentIndex: () => expectedIndexRef.current,
        getTotalSegments: () => completedSegments.length,
      };
    }
  }, [playerRef, completedSegments.length, safeSetIndex]);

  // Notify parent of segment changes - runs on mount and whenever index/total changes
  useEffect(() => {
    // Always notify parent, even on initial mount
    if (completedSegments.length > 0) {
      onSegmentChange?.(currentIndex, completedSegments.length);
    }
  }, [currentIndex, completedSegments.length, onSegmentChange]);

  // Memoize callback to prevent CommentsSection re-renders
  const handleCloseComments = useCallback(() => setShowComments(false), []);

  // Fetch comment count for the season
  useEffect(() => {
    async function fetchCommentCount() {
      try {
        const response = await fetch(`/api/comments?clipId=${season.id}&countOnly=true`);
        if (response.ok) {
          const data = await response.json();
          setCommentCount(data.count || 0);
        }
      } catch {
        // Ignore errors - just show 0
      }
    }
    fetchCommentCount();
  }, [season.id]);

  const currentSegment = completedSegments[currentIndex];

  const isActive = season.status === 'active';
  const isCompleted = season.status === 'completed';
  const isComingSoon = season.status === 'coming_soon';

  // Reset when season changes
  useEffect(() => {
    expectedIndexRef.current = 0;
    lastVideoUrlRef.current = null; // Force reload for new season
    setCurrentIndex(0);
    setIsPlaying(true); // Auto-play when season loads
    setVideoLoaded(false);
  }, [season.id]);


  // Swap video source when user navigates to a different segment
  // IMPORTANT: Depends on currentIndex AND season.id — NOT completedSegments.
  // Data refetches (polling, realtime) change completedSegments reference every 30s,
  // which would reset the video mid-playback if included in deps.
  // season.id is included to ensure we re-run after season switch completes.
  useEffect(() => {
    setVideoLoaded(false);
    setCurrentTime(0); // Reset time immediately to prevent progress bar jump

    const video = videoRef.current;
    // Read segments from ref to get latest data without adding to deps
    const segment = completedSegments[currentIndex];
    const newUrl = segment?.winning_clip?.video_url;

    if (!video || !newUrl) return;

    // Only reload if the URL actually changed (avoids redundant network requests)
    if (lastVideoUrlRef.current !== newUrl) {
      lastVideoUrlRef.current = newUrl;
      video.src = newUrl;
      video.load();
    } else {
      // Same URL (navigated back to same clip) — rewind and play from cache
      video.currentTime = 0;
      setVideoLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, season.id]);

  // Consolidated video playback control - prevents race conditions
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying && videoLoaded && completedSegments.length > 0) {
      // Only play when video is loaded and we should be playing
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Autoplay blocked - user needs to interact first
        });
      }
    } else if (!isPlaying) {
      video.pause();
    }
  }, [videoLoaded, isPlaying, completedSegments.length]);

  // Note: Auto-advance is handled by video onEnded event

  const handleTap = () => {
    if (completedSegments.length === 0 || showContributors || showComments) return;

    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;

    if (now - lastTap < DOUBLE_TAP_DELAY) {
      // Double tap detected - toggle fullscreen
      // Clear pending single-tap timer
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      onToggleFullscreen();
      setLastTap(0);
    } else {
      // Single tap - wait to see if it's a double tap
      setLastTap(now);
      // Clear any existing timer before setting new one
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
      }
      tapTimerRef.current = setTimeout(() => {
        // If no second tap happened, toggle play/pause
        if (Date.now() - now >= DOUBLE_TAP_DELAY - 50) {
          setIsPlaying(prev => !prev);
        }
        tapTimerRef.current = null;
      }, DOUBLE_TAP_DELAY);
    }
  };

  // Cleanup tap timer on unmount
  useEffect(() => {
    return () => {
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
      }
    };
  }, []);

  const handlePlayPause = () => {
    if (completedSegments.length === 0 || showContributors || showComments) return;
    setIsPlaying(!isPlaying);
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onMuteToggle) {
      // Use parent-controlled mute state - React will update the video element via muted prop
      onMuteToggle();
    } else {
      // Fall back to internal state
      setIsMutedInternal(!isMuted);
    }
    // Note: Don't manually set videoRef.current.muted here - let React handle it
    // via the muted={isMuted} prop to avoid race conditions and double-updates
  };

  const jumpToSegment = (index: number) => {
    safeSetIndex(index, 'jumpToSegment');
    setShowContributors(false);
    setIsPlaying(true);
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `AiMoviez Season ${season.number}`,
          url: window.location.href
        });
        toast.success('Shared!');
      } catch (error) {
        // User cancelled share dialog (AbortError) - ignore
        // For other errors, try clipboard fallback
        if (error instanceof Error && error.name !== 'AbortError') {
          try {
            await navigator.clipboard.writeText(window.location.href);
            toast.success('Link copied!');
          } catch {
            toast.error('Failed to share');
          }
        }
      }
    } else {
      // No native share - try clipboard
      try {
        await navigator.clipboard.writeText(window.location.href);
        toast.success('Link copied!');
      } catch {
        toast.error('Failed to copy link');
      }
    }
  };

  // Progress bar handlers
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const clipDuration = videoRef.current.duration;
      setDuration(clipDuration);
      // Track duration for each clip for accurate timeline seeking
      setClipDurations(prev => {
        const newDurations = [...prev];
        newDurations[currentIndex] = clipDuration;
        return newDurations;
      });
    }
  };

  // Swipe handlers for segment navigation (vertical swipe like TikTok)
  const minSwipeDistance = 50;

  const handleTouchStart = (e: React.TouchEvent) => {
    // Don't track swipe if comments or contributors panel is open
    if (showComments || showContributors) return;
    setTouchEndY(null);
    setTouchStartY(e.targetTouches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (showComments || showContributors) return;
    setTouchEndY(e.targetTouches[0].clientY);
  };

  const handleTouchEnd = () => {
    if (!touchStartY || !touchEndY) return;
    if (showComments || showContributors) return;
    if (completedSegments.length <= 1) return;

    const distance = touchStartY - touchEndY;
    const isSwipeUp = distance > minSwipeDistance;
    const isSwipeDown = distance < -minSwipeDistance;

    if (isSwipeUp) {
      // Swipe up - go to next segment (loop to first at end)
      const nextIndex = (currentIndex + 1) % completedSegments.length;
      safeSetIndex(nextIndex, 'swipeUp');
      setCurrentTime(0);
      if (videoRef.current) videoRef.current.currentTime = 0;
    }
    // Swipe down does nothing - only swipe up to navigate

    // Reset touch state
    setTouchStartY(null);
    setTouchEndY(null);
  };

  // Coming Soon View
  if (isComingSoon) {
    return (
      <div className="relative h-full bg-gradient-to-br from-purple-900/30 via-black to-pink-900/30">
        <div className="absolute inset-0 flex flex-col items-center justify-center p-6">
          <Lock className="w-16 h-16 text-white/60 mb-4" />
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
        {season.thumbnail_url && !season.thumbnail_url.match(/\.(mp4|webm|mov|quicktime)$/i) && <Image src={season.thumbnail_url} alt="" fill sizes="100vw" className="object-cover opacity-50" />}
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
    <div
      className="relative h-full bg-black overflow-hidden"
      onClick={handleTap}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Blurred background - animated fade on segment change */}
      <AnimatePresence mode="wait">
        <motion.div key={currentIndex} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0">
          {currentSegment?.winning_clip?.thumbnail_url &&
           !currentSegment.winning_clip.thumbnail_url.match(/\.(mp4|webm|mov|m4v|quicktime)(\?|$)/i) ? (
            <img
              src={currentSegment.winning_clip.thumbnail_url}
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60"
              aria-hidden="true"
              alt=""
            />
          ) : (
            <div
              className="absolute inset-0 w-full h-full scale-110 blur-2xl opacity-60 bg-gradient-to-br from-[#3CF2FF]/40 via-[#A020F0]/40 to-[#FF00C7]/40"
              aria-hidden="true"
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Persistent video element — never remounted, src swapped via useEffect */}
      {/* This avoids re-downloading video data on every segment change */}
      {currentSegment?.winning_clip?.video_url ? (
        <>
          <video
            ref={videoRef}
            poster={currentSegment.winning_clip.thumbnail_url || undefined}
            className="absolute inset-0 w-full h-full object-contain"
            muted={isMuted}
            playsInline
            preload="auto"
            loop={completedSegments.length <= 1}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onCanPlay={() => {
              setVideoLoaded(true);
              if (isPlaying && videoRef.current) {
                videoRef.current.play().catch(() => {});
              }
            }}
            onEnded={() => {
              // Use refs to avoid stale closures — video element is persistent
              const idx = expectedIndexRef.current;
              const total = segmentsLengthRef.current;
              console.log(`[onEnded] fired, expectedRef=${idx}, total=${total}`);
              if (idx < total - 1) {
                safeSetIndex(idx + 1, 'onEnded-advance');
              } else {
                safeSetIndex(0, 'onEnded-loop');
              }
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => {
              // Only set to false if we didn't just finish (avoid pause during transition)
            }}
          />
          {/* Loading overlay */}
          {!videoLoaded && (
            <div className="absolute inset-0 bg-gradient-to-br from-[#3CF2FF]/20 via-[#A020F0]/20 to-[#FF00C7]/20 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}
          {/* Play button overlay when paused */}
          {!isPlaying && videoLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20">
              <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Play className="w-8 h-8 text-white ml-1" fill="white" />
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-[#3CF2FF]/20 to-[#FF00C7]/20 flex items-center justify-center">
          <Play className="w-16 h-16 text-white/50" />
        </div>
      )}

      {/* Gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/50 pointer-events-none" />

      {/* Top Right: Fullscreen toggle (hidden in landscape) */}
      <div className={`absolute top-0 right-0 pt-12 pr-4 z-30 ${isLandscape ? 'hidden' : ''}`}>
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

      {/* Top Left: Compact progress info (hidden in landscape) */}
      <div className={`absolute top-0 left-0 pt-12 px-3 z-10 ${isLandscape ? 'hidden' : ''}`}>
        <div className="flex flex-col gap-1.5">
          {/* Progress pill - larger for better visibility */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/20">
            <div className="w-2 h-2 rounded-full bg-cyan-400" />
            <span className="text-white text-sm font-bold">
              {currentSegment?.slot_position || 1}/{season.total_slots}
            </span>
            <span className="text-white/60 text-sm">·</span>
            <span className="text-white/80 text-sm font-medium">
              {formatDuration(
                completedSegments.reduce((sum, _, idx) =>
                  sum + Math.floor(clipDurations[idx] || 8), 0)
              )}
            </span>
          </div>

          {/* Voting Segment Indicator - larger for better visibility */}
          {season.current_voting_slot && (
            <motion.div
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-3 py-1.5 rounded-full bg-orange-500/90 backdrop-blur-sm flex items-center gap-2 w-fit"
            >
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-white text-sm font-bold">
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

      {/* Right Column - Unified with Dashboard styling (hidden in landscape) */}
      <div className={`absolute right-2 sm:right-3 bottom-28 sm:bottom-32 z-20 flex flex-col items-center gap-3 sm:gap-4 ${isLandscape ? 'hidden' : ''}`} onClick={(e) => e.stopPropagation()}>
        {/* Creator Avatar - Same size as dashboard */}
        {currentSegment?.winning_clip && (
          <Link href={`/profile/${currentSegment.winning_clip.username}`} className="block relative">
            <Image
              src={currentSegment.winning_clip.avatar_url}
              alt={`${currentSegment.winning_clip.username}'s avatar`}
              width={48}
              height={48}
              className="w-12 h-12 rounded-full border-2 border-white/80 object-cover"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
              unoptimized={currentSegment.winning_clip.avatar_url?.includes('dicebear')}
            />
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center border-2 border-black">
              <span className="text-white text-[10px] font-bold">+</span>
            </div>
          </Link>
        )}

        {/* Vote Button - Dashboard style with infinity symbol */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={isActive ? onVote : () => window.location.href = '/dashboard'}
          className="flex flex-col items-center gap-1 relative"
          aria-label="Vote now"
        >
          {/* Glowing vote button */}
          <div className="relative w-16 h-16 flex items-center justify-center">
            {/* Outer glow animation */}
            <motion.div
              className="absolute inset-[-4px] rounded-full"
              animate={{
                boxShadow: [
                  '0 0 15px rgba(56, 189, 248, 0.5)',
                  '0 0 25px rgba(168, 85, 247, 0.6)',
                  '0 0 15px rgba(56, 189, 248, 0.5)',
                ],
              }}
              transition={{ duration: 2.5, repeat: Infinity }}
            />

            {/* Progress ring SVG */}
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 56 56">
              <defs>
                <linearGradient id="storyVoteGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3CF2FF" />
                  <stop offset="50%" stopColor="#A855F7" />
                  <stop offset="100%" stopColor="#EC4899" />
                </linearGradient>
              </defs>
              {/* Background circle */}
              <circle
                cx="28"
                cy="28"
                r="25"
                fill="rgba(0,0,0,0.3)"
                stroke="rgba(255,255,255,0.2)"
                strokeWidth="3"
              />
            </svg>

            {/* Infinity symbol */}
            <motion.span
              className="relative z-10 text-3xl font-black text-white"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              style={{ textShadow: '0 0 20px rgba(56, 189, 248, 0.8)' }}
            >
              ∞
            </motion.span>
          </div>
        </motion.button>

        {/* Rankings Button (Completed seasons only) */}
        {isCompleted && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => { window.location.href = '/leaderboard'; }}
            className="flex flex-col items-center gap-1"
            aria-label="View rankings"
          >
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-400 via-amber-500 to-orange-500 flex items-center justify-center shadow-lg">
              <Trophy className="w-7 h-7 text-white drop-shadow-lg" />
            </div>
            <span className="text-white text-[11px] font-semibold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">Rankings</span>
          </motion.button>
        )}

        {/* Comments - Using shared ActionButton */}
        <ActionButton
          icon={<MessageCircle className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />}
          label={formatNumber(commentCount)}
          onClick={(e) => { e.stopPropagation(); setShowComments(true); }}
          ariaLabel="Open comments"
        />

        {/* Share - Using shared ActionButton */}
        <ActionButton
          icon={<Share2 className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />}
          onClick={handleShare}
          ariaLabel="Share this video"
        />

        {/* Mute - Using shared ActionButton */}
        <ActionButton
          icon={
            isMuted ? (
              <VolumeX className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
            ) : (
              <Volume2 className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
            )
          }
          onClick={toggleMute}
          ariaLabel={isMuted ? "Unmute video" : "Mute video"}
        />
      </div>

      {/* Left Side: Up/Down Navigation Arrows - Unified with Dashboard styling (hidden in landscape) */}
      {/* On mobile: show internal nav. On desktop: hide if external navigation provided */}
      {completedSegments.length > 1 && !hideInternalNav && !isLandscape && (
        <div className="absolute left-3 md:left-8 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-4 md:gap-6">
          {/* Previous Segment Arrow */}
          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.25)' }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              if (currentIndex > 0) {
                safeSetIndex(currentIndex - 1, 'internalPrev');
                setCurrentTime(0);
                if (videoRef.current) videoRef.current.currentTime = 0;
              }
            }}
            className={`w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/10 backdrop-blur-md
                     border border-white/20 flex items-center justify-center
                     transition-all shadow-lg ${currentIndex === 0 ? 'opacity-30' : 'opacity-100'}`}
            disabled={currentIndex === 0}
            aria-label="Previous segment"
          >
            <svg className="w-5 h-5 md:w-7 md:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
            </svg>
          </motion.button>

          {/* Segment Counter - Matching dashboard style */}
          <div className="text-center">
            <span className="text-white/80 text-xs md:text-sm font-medium drop-shadow-lg">
              {currentIndex + 1}/{completedSegments.length}
            </span>
          </div>

          {/* Next Segment Arrow */}
          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.25)' }}
            whileTap={{ scale: 0.9 }}
            onClick={(e) => {
              e.stopPropagation();
              if (currentIndex < completedSegments.length - 1) {
                safeSetIndex(currentIndex + 1, 'internalNext');
                setCurrentTime(0);
                if (videoRef.current) videoRef.current.currentTime = 0;
              }
            }}
            className={`w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/10 backdrop-blur-md
                     border border-white/20 flex items-center justify-center
                     transition-all shadow-lg ${currentIndex === completedSegments.length - 1 ? 'opacity-30' : 'opacity-100'}`}
            disabled={currentIndex === completedSegments.length - 1}
            aria-label="Next segment"
          >
            <svg className="w-5 h-5 md:w-7 md:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </motion.button>
        </div>
      )}

      {/* Top: Seekable Progress Line - Shows overall story progress with time-based seeking */}
      {/* In landscape mode, fades with other controls */}
      {completedSegments.length > 0 && (
        <div
          className={`absolute top-0 left-0 right-0 z-30 pt-2 px-2 cursor-pointer group transition-opacity duration-300 ${
            isLandscape && !showLandscapeControls ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left - 8; // Account for px-2 padding
            const width = rect.width - 16;
            const percentage = Math.max(0, Math.min(1, clickX / width));

            // Calculate total duration using known durations or estimate (8s per clip)
            const DEFAULT_CLIP_DURATION = 8;
            const totalDuration = completedSegments.reduce((sum, _, idx) => {
              return sum + (clipDurations[idx] || DEFAULT_CLIP_DURATION);
            }, 0);

            // Calculate target time in the timeline
            const targetTime = percentage * totalDuration;

            // Find which segment and time within that segment
            let accumulatedTime = 0;
            let targetSegment = 0;
            let timeInSegment = 0;

            for (let i = 0; i < completedSegments.length; i++) {
              const segmentDuration = clipDurations[i] || DEFAULT_CLIP_DURATION;
              if (accumulatedTime + segmentDuration > targetTime) {
                targetSegment = i;
                timeInSegment = targetTime - accumulatedTime;
                break;
              }
              accumulatedTime += segmentDuration;
              targetSegment = i;
              timeInSegment = segmentDuration; // At the end of last segment
            }

            // Jump to segment and time
            if (targetSegment !== currentIndex) {
              safeSetIndex(targetSegment, 'progressBar');
            }
            setCurrentTime(timeInSegment);
            if (videoRef.current) {
              videoRef.current.currentTime = timeInSegment;
            }
          }}
        >
          {/* Invisible touch target for easier tapping */}
          <div className="h-4 flex items-center">
            <div className="w-full h-0.5 group-hover:h-1 rounded-full bg-white/20 overflow-hidden transition-all">
              <motion.div
                className="h-full bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500"
                style={{
                  width: (() => {
                    // Calculate progress based on actual timeline
                    const DEFAULT_CLIP_DURATION = 8;
                    const totalDuration = completedSegments.reduce((sum, _, idx) => {
                      return sum + (clipDurations[idx] || DEFAULT_CLIP_DURATION);
                    }, 0);

                    // Time elapsed: sum of all previous segments + current time in this segment
                    let elapsedTime = 0;
                    for (let i = 0; i < currentIndex; i++) {
                      elapsedTime += clipDurations[i] || DEFAULT_CLIP_DURATION;
                    }
                    elapsedTime += currentTime;

                    const overallProgress = totalDuration > 0 ? (elapsedTime / totalDuration) * 100 : 0;
                    return `${Math.min(100, overallProgress)}%`;
                  })(),
                }}
                transition={{ duration: 0.1, ease: 'linear' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Bottom left: Creator info - Higher on mobile to avoid season list (hidden in landscape) */}
      {currentSegment?.winning_clip && !isLandscape && (
        <div className="absolute bottom-28 md:bottom-12 left-4 md:left-60 right-16 z-20">
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
                      {segment.winning_clip?.thumbnail_url && !segment.winning_clip.thumbnail_url.match(/\.(mp4|webm|mov|quicktime)$/i) ? (
                        <Image src={segment.winning_clip.thumbnail_url} alt="" fill sizes="48px" className="object-cover" />
                      ) : (
                        <video src={segment.winning_clip?.video_url} className="w-full h-full object-cover" muted playsInline preload="metadata" poster={segment.winning_clip?.thumbnail_url || undefined} />
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
                    <ChevronRight className="w-4 h-4 text-white/60" />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Comments Panel - Using shared CommentsSection component */}
      {/* Use season.id for comments so they're for the whole movie, not individual segments */}
      <CommentsSection
        clipId={season.id}
        isOpen={showComments}
        onClose={handleCloseComments}
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
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedSeason = seasons.find(s => s.id === selectedSeasonId) || seasons[0];
  const currentIndex = seasons.findIndex(s => s.id === selectedSeasonId);
  const completedSegments = selectedSeason?.slots.filter(s => s.status === 'locked' && s.winning_clip) || [];
  const progressPercent = selectedSeason ? Math.round((completedSegments.length / selectedSeason.total_slots) * 100) : 0;

  // Get the best available thumbnail - last completed segment or season thumbnail
  const lastCompletedClip = completedSegments.length > 0
    ? completedSegments[completedSegments.length - 1]?.winning_clip
    : null;
  const thumbnailUrl = lastCompletedClip?.thumbnail_url || selectedSeason?.thumbnail_url;
  const videoUrl = lastCompletedClip?.video_url || selectedSeason?.thumbnail_url;

  const isActive = selectedSeason?.status === 'active';
  const isCompleted = selectedSeason?.status === 'completed';
  const isComingSoon = selectedSeason?.status === 'coming_soon';

  // Swipe detection
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
    setTouchStartY(e.targetTouches[0].clientY);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart || !touchEnd) return;

    // Check for vertical swipe to collapse/expand
    const touchEndY = e.changedTouches[0].clientY;
    if (touchStartY !== null) {
      const verticalDistance = touchStartY - touchEndY;
      if (Math.abs(verticalDistance) > minSwipeDistance) {
        if (verticalDistance > 0) {
          // Swipe up - expand
          setIsExpanded(true);
        } else {
          // Swipe down - collapse
          setIsExpanded(false);
        }
        return;
      }
    }

    // Horizontal swipe for season change (only when expanded)
    if (isExpanded) {
      const distance = touchStart - touchEnd;
      const isLeftSwipe = distance > minSwipeDistance;
      const isRightSwipe = distance < -minSwipeDistance;

      if (isLeftSwipe) {
        onSwipeLeft(); // Next season
      } else if (isRightSwipe) {
        onSwipeRight(); // Previous season
      }
    }
  };

  if (!selectedSeason) return null;

  // Collapsed view - minimal pill
  if (!isExpanded) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-transparent backdrop-blur-sm border-t border-white/10"
        onClick={() => setIsExpanded(true)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/30" />
        </div>

        {/* Collapsed content */}
        <div className="flex items-center justify-center gap-3 px-4 pb-3">
          <div className="flex items-center gap-2">
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
              </div>
            )}
          </div>

          {/* Mini progress */}
          {!isComingSoon && (
            <div className="flex items-center gap-2">
              <div className="w-16 h-1 rounded-full bg-white/20 overflow-hidden">
                <div
                  className={`h-full ${isCompleted ? 'bg-green-500' : 'bg-gradient-to-r from-cyan-500 to-purple-500'}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-white/50 text-[10px]">{progressPercent}%</span>
            </div>
          )}

          <ChevronDown className="w-4 h-4 text-white/50 rotate-180" />
        </div>
      </motion.div>
    );
  }

  // Expanded view - full season strip
  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="bg-transparent backdrop-blur-sm border-t border-white/10"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Drag handle to collapse */}
      <div
        className="flex justify-center pt-2 pb-1 cursor-pointer"
        onClick={() => setIsExpanded(false)}
      >
        <div className="w-10 h-1 rounded-full bg-white/30" />
      </div>

      {/* Season Indicator Dots */}
      <div className="flex justify-center gap-1.5 pb-1">
        {seasons.map((season, _idx) => (
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
          <div className="relative w-12 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-white/10">
            {isComingSoon ? (
              /* Coming soon - show lock */
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-500/30 to-pink-500/30">
                <Lock className="w-4 h-4 text-white/50" />
              </div>
            ) : thumbnailUrl || videoUrl ? (
              /* Has media - check if it's a video or image */
              (() => {
                const mediaUrl = thumbnailUrl || videoUrl;
                if (!mediaUrl) return null;
                const isVideo = mediaUrl.match(/\.(mp4|webm|mov|m4v)(\?|$)/i);

                if (isVideo) {
                  return (
                    <video
                      src={mediaUrl}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  );
                } else {
                  return (
                    <Image
                      src={mediaUrl}
                      alt=""
                      fill
                      sizes="100vw"
                      className="object-cover"
                    />
                  );
                }
              })()
            ) : (
              /* No content yet - show gradient with season number */
              <div className="w-full h-full bg-gradient-to-br from-[#3CF2FF]/30 via-[#A020F0]/30 to-[#FF00C7]/30 flex flex-col items-center justify-center">
                <span className="text-white/90 text-base font-black">S{selectedSeason.number}</span>
                {isActive && (
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse mt-0.5" />
                )}
              </div>
            )}
            {/* Badge - show if we have media content */}
            {(thumbnailUrl || videoUrl) && (
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
          <div className="flex flex-col items-center gap-1 text-white/60">
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
        <span className="text-white/60 text-[9px]">Swipe to change season • Swipe down to collapse</span>
      </div>
    </motion.div>
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Component kept for future desktop sidebar use
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
            <Lock className="w-6 h-6 text-white/60" />
          </div>
        ) : (
          <>
            {/* Thumbnail - use video preview if no actual image thumbnail */}
            {(() => {
              const thumbUrl = completedSegments[completedSegments.length - 1]?.winning_clip?.thumbnail_url || season.thumbnail_url;
              const isActualImage = thumbUrl && !thumbUrl.match(/\.(mp4|webm|mov|quicktime)$/i);
              const videoUrl = completedSegments[completedSegments.length - 1]?.winning_clip?.video_url;

              if (isActualImage) {
                return <Image src={thumbUrl} alt="" fill sizes="64px" className="object-cover" />;
              } else if (videoUrl) {
                return <video src={videoUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />;
              } else {
                return <div className="w-full h-full bg-gradient-to-br from-[#3CF2FF]/20 to-[#FF00C7]/20" />;
              }
            })()}
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
              <div className="flex justify-between text-[10px] text-white/60">
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
      <ChevronRight className={`w-5 h-5 flex-shrink-0 ${isSelected ? 'text-white' : 'text-white/60'}`} />
    </motion.button>
  );
}

// ============================================================================
// MAIN STORY PAGE
// ============================================================================

function StoryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Desktop navigation - track current segment for the counter display
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [totalSegments, setTotalSegments] = useState(0);
  // Mute state - lifted here for landscape overlay access
  const [isMuted, setIsMuted] = useState(true);
  // Track if we're on desktop to conditionally render only ONE VideoPlayer (prevents double audio)
  const [isDesktop, setIsDesktop] = useState(false);
  // Ref for imperative control of VideoPlayer
  const videoPlayerRef = useRef<VideoPlayerHandle | null>(null);
  // Typewriter intro state - tracks which seasons have already shown their intro
  const [shownIntros, setShownIntros] = useState<Set<string>>(new Set());
  const [showingIntro, setShowingIntro] = useState(false);

  // Landscape video mode - auto-fill screen when phone rotates
  const { isLandscape, showControls, handleScreenTap } = useLandscapeVideo();

  // Horizontal swipe for season switching on mobile
  const [seasonTouchStartX, setSeasonTouchStartX] = useState<number | null>(null);
  const [seasonTouchEndX, setSeasonTouchEndX] = useState<number | null>(null);
  const [seasonTouchStartY, setSeasonTouchStartY] = useState<number | null>(null);
  const [seasonTouchEndY, setSeasonTouchEndY] = useState<number | null>(null);

  // Detect desktop vs mobile to render only ONE VideoPlayer (CSS hidden still plays audio)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Fetch seasons from API
  // Realtime updates are primary, polling is a safety net for missed websocket events
  const { data: seasons = [], isLoading, error } = useQuery<Season[]>({
    queryKey: ['story-seasons'],
    queryFn: () => fetchSeasons(true), // Always fetch fresh to catch any missed realtime events
    staleTime: 30000, // 30 seconds - shorter to catch missed broadcasts faster
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    refetchInterval: 30000, // Poll every 30s as fallback for missed realtime events
    refetchIntervalInBackground: false, // Don't poll when tab is hidden (saves API calls)
  });

  // Helper to fetch fresh data and update cache (bypasses server cache)
  const fetchFreshAndUpdate = useCallback(async () => {
    try {
      console.log('[Story Realtime] Fetching fresh data (bypassing cache)...');
      const freshData = await fetchSeasons(true);
      queryClient.setQueryData<Season[]>(['story-seasons'], freshData);
      console.log('[Story Realtime] Cache updated with fresh data');
    } catch (error) {
      console.error('[Story Realtime] Failed to fetch fresh data:', error);
    }
  }, [queryClient]);

  // Real-time updates for vote counts and new winners
  // NOTE: Disabled due to Supabase Realtime postgres_changes binding issue
  // Using useStoryBroadcast instead which works reliably
  useRealtimeClips({
    enabled: false,
    onClipUpdate: useCallback((updatedClip: ClipUpdate) => {
      // If a clip's status changed to 'locked', a new winner was selected - refetch fresh
      if (updatedClip.status === 'locked') {
        console.log('[Story Realtime] New winner detected (clip locked)');
        fetchFreshAndUpdate();
        return;
      }

      // Update the clip vote count in the React Query cache
      queryClient.setQueryData<Season[]>(['story-seasons'], (oldData) => {
        if (!oldData) return oldData;
        return oldData.map((season) => ({
          ...season,
          slots: season.slots?.map((slot) => {
            if (slot.winning_clip?.id === updatedClip.id) {
              return {
                ...slot,
                winning_clip: {
                  ...slot.winning_clip,
                  vote_count: updatedClip.vote_count ?? slot.winning_clip.vote_count,
                },
              };
            }
            return slot;
          }),
        }));
      });
    }, [queryClient, fetchFreshAndUpdate]),
  });

  // Real-time updates for slot changes (when winner is assigned to a slot)
  // NOTE: Disabled due to Supabase Realtime postgres_changes binding issue
  // Using useStoryBroadcast instead which works reliably
  useRealtimeSlots({
    enabled: false,
    onSlotUpdate: useCallback((updatedSlot: { id: string; status?: string; winner_tournament_clip_id?: string | null }) => {
      // Refetch on ANY slot update - winner assigned, status change, etc.
      console.log('[Story Realtime] Slot update received:', updatedSlot);
      fetchFreshAndUpdate();
    }, [fetchFreshAndUpdate]),
  });

  // Real-time broadcast listener for winner selection and season reset (most reliable instant updates)
  // The admin API broadcasts when a winner is selected or season is reset, this is more reliable than postgres_changes
  useStoryBroadcast({
    enabled: true,
    onWinnerSelected: useCallback((payload: WinnerSelectedPayload) => {
      console.log('[Story Broadcast] Winner selected event received:', payload);
      fetchFreshAndUpdate();
    }, [fetchFreshAndUpdate]),
    onSeasonReset: useCallback((payload: SeasonResetPayload) => {
      console.log('[Story Broadcast] Season reset event received:', payload);
      fetchFreshAndUpdate();
    }, [fetchFreshAndUpdate]),
  });

  // Fetch fresh data when tab becomes visible (catch missed broadcasts while away)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Story] Tab became visible, fetching fresh data...');
        fetchFreshAndUpdate();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchFreshAndUpdate]);

  // Set initial selected season when data loads
  useEffect(() => {
    if (seasons.length > 0 && !selectedSeasonId) {
      setSelectedSeasonId(seasons[0].id);
    }
  }, [seasons, selectedSeasonId]);

  const selectedSeason = seasons.find(s => s.id === selectedSeasonId) || seasons[0];
  const selectedSeasonIndex = seasons.findIndex(s => s.id === selectedSeasonId);

  const goToSeason = useCallback((index: number) => {
    if (index >= 0 && index < seasons.length) {
      setSelectedSeasonId(seasons[index].id);
    }
  }, [seasons]);

  // Show typewriter intro when selecting a season with a description (once per session)
  useEffect(() => {
    if (selectedSeason?.description && !shownIntros.has(selectedSeason.id)) {
      setShowingIntro(true);
    }
  }, [selectedSeason, shownIntros]);

  const dismissIntro = useCallback(() => {
    if (selectedSeason) {
      setShownIntros(prev => new Set(prev).add(selectedSeason.id));
    }
    setShowingIntro(false);
  }, [selectedSeason]);

  // Reset segment index when season changes, and pre-compute total segments
  useEffect(() => {
    setCurrentSegmentIndex(0);
    // Pre-compute total segments from the selected season data
    if (selectedSeason) {
      const completedSegs = selectedSeason.slots.filter(s => s.status === 'locked' && s.winning_clip);
      setTotalSegments(completedSegs.length);
    } else {
      setTotalSegments(0);
    }
  }, [selectedSeasonId, selectedSeason]);

  // Callback to sync segment state from VideoPlayer
  const handleSegmentChange = useCallback((index: number, total: number) => {
    setCurrentSegmentIndex(index);
    setTotalSegments(total);
  }, []);

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

  // Horizontal swipe handlers for season switching on mobile
  const handleSeasonTouchStart = useCallback((e: React.TouchEvent) => {
    setSeasonTouchStartX(e.touches[0].clientX);
    setSeasonTouchStartY(e.touches[0].clientY);
    setSeasonTouchEndX(null);
    setSeasonTouchEndY(null);
  }, []);

  const handleSeasonTouchMove = useCallback((e: React.TouchEvent) => {
    setSeasonTouchEndX(e.touches[0].clientX);
    setSeasonTouchEndY(e.touches[0].clientY);
  }, []);

  const handleSeasonTouchEnd = useCallback(() => {
    if (seasonTouchStartX === null || seasonTouchEndX === null) return;
    if (seasons.length <= 1) return;

    const deltaX = seasonTouchStartX - seasonTouchEndX;
    const deltaY = seasonTouchStartY !== null && seasonTouchEndY !== null
      ? seasonTouchStartY - seasonTouchEndY
      : 0;

    // Only handle if swipe is more horizontal than vertical
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return;

    const minSwipeDistance = 50;
    if (Math.abs(deltaX) < minSwipeDistance) return;

    if (deltaX > 0) {
      // Swipe left = next season
      goToNextSeason();
      if (navigator.vibrate) navigator.vibrate(30);
    } else {
      // Swipe right = previous season
      goToPrevSeason();
      if (navigator.vibrate) navigator.vibrate(30);
    }

    // Reset
    setSeasonTouchStartX(null);
    setSeasonTouchEndX(null);
    setSeasonTouchStartY(null);
    setSeasonTouchEndY(null);
  }, [seasonTouchStartX, seasonTouchEndX, seasonTouchStartY, seasonTouchEndY, seasons.length, goToNextSeason, goToPrevSeason]);

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
            onClick={() => fetchFreshAndUpdate()}
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
    <div className="min-h-screen min-h-[100dvh] bg-black overflow-hidden">
      {/* Typewriter Story Intro Overlay */}
      <AnimatePresence>
        {showingIntro && selectedSeason?.description && (
          <TypewriterIntro
            text={selectedSeason.description}
            seasonNumber={selectedSeason.number}
            onComplete={dismissIntro}
          />
        )}
      </AnimatePresence>

      {/* Desktop Layout - TikTok Style (only render on desktop to prevent double audio) */}
      {isDesktop && (
      <div className="flex h-[100dvh] relative">
        {/* Full Screen Video Background */}
        <div className="absolute inset-0 z-0">
          <VideoPlayer
            season={selectedSeason}
            onVote={handleVoteNow}
            isFullscreen={false}
            onToggleFullscreen={toggleFullscreen}
            hideInternalNav={true}
            onSegmentChange={handleSegmentChange}
            playerRef={videoPlayerRef}
            isMuted={isMuted}
            onMuteToggle={() => setIsMuted(!isMuted)}
          />
        </div>

        {/* Left Sidebar - Navigation (Fully Transparent) */}
        <div className="w-56 h-full flex flex-col py-4 px-3 relative z-30" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
          {/* Navigation Items */}
          <nav className="flex-1 space-y-1 mt-40">
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
            <Link href="/watch">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-black/30 text-white/90 transition">
                <Play className="w-6 h-6" />
                <span>Watch</span>
              </div>
            </Link>
            <Link href="/upload">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-black/30 text-white/90 transition">
                <Plus className="w-6 h-6" />
                <span>Upload</span>
              </div>
            </Link>
            <Link href="/create">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-black/30 text-white/90 transition">
                <Sparkles className="w-6 h-6" />
                <span>AI Create</span>
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

            {/* Segment Navigation Arrows - aligned under Profile icon */}
            {totalSegments > 1 && (
              <div className="flex flex-col items-start gap-2 px-3 pt-4 mt-2">
                <div className="flex flex-col items-center gap-2 w-6">
                  <motion.button
                    whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.25)' }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => videoPlayerRef.current?.goPrev()}
                    className={`w-10 h-10 -ml-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center transition-all ${
                      currentSegmentIndex === 0 ? 'opacity-30' : 'opacity-100'
                    }`}
                    disabled={currentSegmentIndex === 0}
                  >
                    <ChevronDown className="w-5 h-5 text-white rotate-180" />
                  </motion.button>

                  <span className="text-white/80 text-sm font-medium drop-shadow-lg">
                    {currentSegmentIndex + 1}/{totalSegments}
                  </span>

                  <motion.button
                    whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.25)' }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => videoPlayerRef.current?.goNext()}
                    className={`w-10 h-10 -ml-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center transition-all ${
                      currentSegmentIndex >= totalSegments - 1 ? 'opacity-30' : 'opacity-100'
                    }`}
                    disabled={currentSegmentIndex >= totalSegments - 1}
                  >
                    <ChevronDown className="w-5 h-5 text-white" />
                  </motion.button>
                </div>
              </div>
            )}
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

        {/* Season Navigation Arrows - REMOVED: overlapped with segment navigation, use sidebar season selector instead */}

        {/* Direction Voting Modal - Shows when Co-Director direction voting is open */}
        <DirectionVotingModal />
      </div>
      )}

      {/* Mobile Layout - Full screen video with overlay controls (only render on mobile to prevent double audio) */}
      {!isDesktop && (
      <div
        className={`h-[100dvh] relative ${isLandscape ? 'video-landscape-mode' : ''}`}
        onClick={isLandscape ? handleScreenTap : undefined}
        onTouchStart={handleSeasonTouchStart}
        onTouchMove={handleSeasonTouchMove}
        onTouchEnd={handleSeasonTouchEnd}
      >
        {/* Video Player - Full screen */}
        <div className="absolute inset-0">
          <VideoPlayer
            season={selectedSeason}
            onVote={handleVoteNow}
            isFullscreen={isFullscreen || isLandscape}
            onToggleFullscreen={toggleFullscreen}
            isLandscape={isLandscape}
            showLandscapeControls={showControls}
            isMuted={isMuted}
            onMuteToggle={() => setIsMuted(!isMuted)}
          />
        </div>

        {/* Season dots - top center (hidden in landscape/fullscreen) */}
        {!isLandscape && !isFullscreen && seasons.length > 1 && (
          <div className="absolute top-0 left-0 right-0 pt-12 z-20 flex justify-center pointer-events-auto">
            <DynamicDots
              count={seasons.length}
              currentIndex={Math.max(0, selectedSeasonIndex)}
              onSelect={goToSeason}
              labels={seasons.map(s => s.name || `Season ${s.number}`)}
            />
          </div>
        )}

        {/* Landscape mode controls overlay */}
        {isLandscape && (
          <div className={`landscape-controls ${showControls ? 'landscape-controls-visible' : 'landscape-controls-hidden'}`}>
            {/* Mute button - bottom left */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMuted(!isMuted);
              }}
              className="absolute bottom-4 left-4 w-12 h-12 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center"
            >
              {isMuted ? <VolumeX className="w-6 h-6 text-white" /> : <Volume2 className="w-6 h-6 text-white" />}
            </button>
            {/* Rotate hint - bottom center */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/50 backdrop-blur-md rounded-full text-white/60 text-sm">
              Rotate to exit fullscreen
            </div>
          </div>
        )}

        {/* Season Strip removed - using horizontal swipe instead for cleaner mobile UX */}

        {/* Direction Voting Modal - Shows when Co-Director direction voting is open */}
        {!isFullscreen && !isLandscape && <DirectionVotingModal />}

        {/* Bottom Navigation - Using shared component (hidden when fullscreen or landscape) */}
        {!isFullscreen && !isLandscape && <BottomNavigation />}
      </div>
      )}
    </div>
  );
}

// ============================================================================
// PAGE WRAPPER
// ============================================================================

export default function StoryPageWithProvider() {
  return (
    <AuthGuard>
      <StoryPage />
    </AuthGuard>
  );
}