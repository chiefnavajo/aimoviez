'use client';

// ============================================================================
// VOTING ARENA - FINAL CLEAN VERSION (V5.4)
// ============================================================================
// ✅ Sound enabled by default (unmuted)
// ✅ Mute/Unmute toggle button in right column
// ✅ No play button overlay (auto-plays smoothly)
// ✅ Comments panel transparent with blur (video visible behind)
// ✅ Vote button on right (visible, solid bg)
// ✅ 3-item nav only (Story, Upload, Profile)
// ✅ Bigger nav icons and text
// ✅ Transparent nav background
// ✅ ~95% video visibility
// ============================================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import Pusher from 'pusher-js';
import confetti from 'canvas-confetti';
import { toast, Toaster } from 'react-hot-toast';
import Link from 'next/link';
import { MessageCircle, Share2, X, BookOpen, Plus, User, Search, Volume2, VolumeX, Trophy } from 'lucide-react';
import CommentsSection from '@/components/CommentsSection';
import MiniLeaderboard from '@/components/MiniLeaderboard';
import { AuthGuard } from '@/hooks/useAuth';

// ============================================================================
// TYPES
// ============================================================================

type VoteType = 'standard' | 'super' | 'mega';

// API response clip structure (from /api/vote)
interface APIClip {
  id: string;
  clip_id: string;
  user_id?: string;
  thumbnail_url: string;
  video_url?: string;
  vote_count: number;
  weighted_score: number;
  rank_in_track: number;
  user: {
    username: string;
    avatar_url: string;
    badge_level?: string;
  };
  genre: string;
  duration: number;
  round_number: number;
  total_rounds: number;
  segment_index: number;
  hype_score: number;
  is_featured?: boolean;
  is_creator_followed?: boolean;
  has_voted?: boolean;
}

// Frontend clip structure (normalized for UI)
interface ClipForClient {
  id: string;
  clip_id: string;
  user_id?: string;
  thumbnail_url: string;
  video_url?: string;
  username: string;
  avatar_url: string;
  badge_level: string;
  vote_count: number;
  weighted_score: number;
  rank_in_track: number;
  genre: string;
  duration: number;
  round_number: number;
  total_rounds: number;
  segment_index: number;
  hype_score: number;
  is_featured: boolean;
  is_creator_followed: boolean;
  has_voted?: boolean;
}

// API response structure
interface APIVotingResponse {
  clips: APIClip[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: {
    standard: number;
    super: number;
    mega: number;
  };
  votedClipIds: string[];
  currentSlot: number;
  totalSlots: number;
  streak: number;
  votingEndsAt: string | null;
  votingStartedAt: string | null;
  timeRemainingSeconds: number | null;
  totalClipsInSlot: number;
  clipsShown: number;
  hasMoreClips: boolean;
}

// Frontend state structure
interface VotingState {
  clips: ClipForClient[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: {
    standard: number;
    super: number;
    mega: number;
  };
  streak: number;
  currentSlot: number;
  totalSlots: number;
  votingEndsAt: string | null;
  hasMoreClips: boolean;
}

// Transform API response to frontend state
function transformAPIResponse(apiResponse: APIVotingResponse): VotingState {
  const clips: ClipForClient[] = apiResponse.clips.map((clip) => ({
    id: clip.id,
    clip_id: clip.clip_id,
    user_id: clip.user_id,
    thumbnail_url: clip.thumbnail_url,
    video_url: clip.video_url,
    username: clip.user?.username || 'Creator',
    avatar_url: clip.user?.avatar_url || `https://api.dicebear.com/7.x/identicon/svg?seed=${clip.id}`,
    badge_level: clip.user?.badge_level || 'CREATOR',
    vote_count: clip.vote_count,
    weighted_score: clip.weighted_score,
    rank_in_track: clip.rank_in_track,
    genre: clip.genre,
    duration: clip.duration,
    round_number: clip.round_number,
    total_rounds: clip.total_rounds,
    segment_index: clip.segment_index,
    hype_score: clip.hype_score,
    is_featured: clip.is_featured || false,
    is_creator_followed: clip.is_creator_followed || false,
    has_voted: clip.has_voted,
  }));

  return {
    clips,
    totalVotesToday: apiResponse.totalVotesToday,
    userRank: apiResponse.userRank,
    remainingVotes: apiResponse.remainingVotes,
    streak: apiResponse.streak,
    currentSlot: apiResponse.currentSlot,
    totalSlots: apiResponse.totalSlots,
    votingEndsAt: apiResponse.votingEndsAt,
    hasMoreClips: apiResponse.hasMoreClips,
  };
}

interface VoteResponse {
  success: boolean;
  error?: string;
  newScore?: number;
  totalVotesToday?: number;
  remainingVotes?: number;
  voteType?: VoteType;
}

interface MutationContext {
  previous?: VotingState;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DAILY_GOAL = 200;

// Consistent number formatting (avoids hydration mismatch)
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

const GENRE_LABELS: Record<string, string> = {
  COMEDY: 'Comedy',
  ACTION: 'Action',
  SCIFI: 'Sci-Fi',
  THRILLER: 'Thriller',
  ROMANCE: 'Romance',
  ANIMATION: 'Animation',
  HORROR: 'Horror',
};

// ============================================================================
// POWER VOTE BUTTON - Long-press for Super/Mega votes
// ============================================================================
// TAP = Standard (1x)
// HOLD 1s = Super (3x)
// HOLD 2s = Mega (10x)
// ============================================================================

interface PowerVoteButtonProps {
  onVote: (voteType: VoteType) => void;
  isVoting: boolean;
  isDisabled: boolean;
  hasVoted: boolean;
  superRemaining: number;
  megaRemaining: number;
}

function PowerVoteButton({
  onVote,
  isVoting,
  isDisabled,
  hasVoted,
  superRemaining,
  megaRemaining
}: PowerVoteButtonProps) {
  const [holdProgress, setHoldProgress] = useState(0);
  const [currentVoteType, setCurrentVoteType] = useState<VoteType>('standard');
  const [isHolding, setIsHolding] = useState(false);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const SUPER_THRESHOLD = 1000; // 1 second for Super
  const MEGA_THRESHOLD = 2000;  // 2 seconds for Mega

  const clearTimers = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const handlePressStart = () => {
    if (isVoting || isDisabled) return;

    // For voted clips, we still need to track the press for revoke
    setIsHolding(true);
    startTimeRef.current = Date.now();
    setHoldProgress(0);
    setCurrentVoteType('standard');

    // Only start progress interval for new votes (not for revoke)
    if (!hasVoted) {
      // Update progress every 50ms
      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        const progress = Math.min(elapsed / MEGA_THRESHOLD, 1);
        setHoldProgress(progress);

        // Determine vote type based on elapsed time
        if (elapsed >= MEGA_THRESHOLD && megaRemaining > 0) {
          setCurrentVoteType('mega');
          // Vibrate if available
          if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
        } else if (elapsed >= SUPER_THRESHOLD && superRemaining > 0) {
          setCurrentVoteType('super');
          // Vibrate if available
          if (navigator.vibrate) navigator.vibrate(30);
        } else {
          setCurrentVoteType('standard');
        }
      }, 50);
    }
  };

  const handlePressEnd = () => {
    if (!isHolding) return;

    clearTimers();
    setIsHolding(false);

    const elapsed = Date.now() - startTimeRef.current;

    // Determine final vote type
    let finalVoteType: VoteType = 'standard';
    if (elapsed >= MEGA_THRESHOLD && megaRemaining > 0) {
      finalVoteType = 'mega';
    } else if (elapsed >= SUPER_THRESHOLD && superRemaining > 0) {
      finalVoteType = 'super';
    }

    // Execute vote or revoke
    if (!isDisabled) {
      if (hasVoted) {
        // Tap on voted clip = revoke
        onVote('standard'); // This will trigger revoke in handleVote
      } else {
        onVote(finalVoteType);
      }
    }

    // Reset progress after animation
    setTimeout(() => {
      setHoldProgress(0);
      setCurrentVoteType('standard');
    }, 300);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimers();
  }, []);

  // Get colors based on current vote type
  const getVoteColors = () => {
    switch (currentVoteType) {
      case 'mega':
        return {
          glow: 'rgba(168, 85, 247, 0.8)',
          ring: '#A855F7',
          bg: 'rgba(168, 85, 247, 0.3)',
          icon: '💎',
          label: 'MEGA 10x'
        };
      case 'super':
        return {
          glow: 'rgba(250, 204, 21, 0.8)',
          ring: '#FACC15',
          bg: 'rgba(250, 204, 21, 0.3)',
          icon: '⚡',
          label: 'SUPER 3x'
        };
      default:
        return {
          glow: 'rgba(56, 189, 248, 0.5)',
          ring: '#3CF2FF',
          bg: 'rgba(0,0,0,0.3)',
          icon: '∞',
          label: ''
        };
    }
  };

  const colors = getVoteColors();
  const circumference = 2 * Math.PI * 29;
  const strokeDashoffset = circumference * (1 - holdProgress);

  return (
    <div className="relative flex flex-col items-center">
      {/* Vote type label */}
      <AnimatePresence>
        {isHolding && currentVoteType !== 'standard' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`absolute -top-8 px-3 py-1 rounded-full text-xs font-bold ${
              currentVoteType === 'mega'
                ? 'bg-purple-500 text-white'
                : 'bg-yellow-500 text-black'
            }`}
          >
            {colors.label}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onMouseDown={handlePressStart}
        onMouseUp={handlePressEnd}
        onMouseLeave={handlePressEnd}
        onTouchStart={handlePressStart}
        onTouchEnd={handlePressEnd}
        disabled={isVoting || isDisabled}
        className="relative w-16 h-16 flex items-center justify-center touch-none select-none"
      >
        {/* Outer glow - intensifies with hold, green when voted */}
        <motion.div
          className="absolute inset-[-6px] rounded-full"
          animate={{
            boxShadow: isHolding
              ? `0 0 ${20 + holdProgress * 30}px ${colors.glow}`
              : hasVoted
                ? '0 0 15px rgba(74, 222, 128, 0.5)'
                : [
                    '0 0 15px rgba(56, 189, 248, 0.5)',
                    '0 0 25px rgba(168, 85, 247, 0.6)',
                    '0 0 15px rgba(56, 189, 248, 0.5)',
                  ],
          }}
          transition={isHolding ? { duration: 0.1 } : { duration: 2.5, repeat: Infinity }}
        />

        {/* Progress ring */}
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 64 64">
          <defs>
            <linearGradient id="voteGradientPower" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3CF2FF" />
              <stop offset="50%" stopColor="#A855F7" />
              <stop offset="100%" stopColor="#EC4899" />
            </linearGradient>
            <linearGradient id="superGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FACC15" />
              <stop offset="100%" stopColor="#F59E0B" />
            </linearGradient>
            <linearGradient id="megaGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#A855F7" />
              <stop offset="100%" stopColor="#7C3AED" />
            </linearGradient>
            <linearGradient id="votedGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4ADE80" />
              <stop offset="100%" stopColor="#22C55E" />
            </linearGradient>
          </defs>

          {/* Background circle */}
          <circle
            cx="32"
            cy="32"
            r="29"
            fill={hasVoted ? 'rgba(74, 222, 128, 0.2)' : colors.bg}
            stroke={hasVoted ? '#4ADE80' : 'rgba(255,255,255,0.2)'}
            strokeWidth="3"
          />

          {/* Progress circle */}
          {isHolding && (
            <circle
              cx="32"
              cy="32"
              r="29"
              fill="none"
              stroke={
                currentVoteType === 'mega'
                  ? 'url(#megaGradient)'
                  : currentVoteType === 'super'
                    ? 'url(#superGradient)'
                    : 'url(#voteGradientPower)'
              }
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              style={{ transition: 'stroke-dashoffset 0.05s linear' }}
            />
          )}
        </svg>

        {/* Icon */}
        {isVoting ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="relative z-10 text-xl text-white"
          >
            ⚡
          </motion.div>
        ) : hasVoted ? (
          <motion.div
            className="relative z-10 flex flex-col items-center"
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <span className="text-2xl text-green-400" style={{ textShadow: '0 0 10px rgba(74, 222, 128, 0.8)' }}>
              ✓
            </span>
          </motion.div>
        ) : (
          <motion.span
            className="relative z-10 text-3xl font-black text-white"
            animate={isHolding ? { scale: 1 + holdProgress * 0.3 } : { scale: [1, 1.1, 1] }}
            transition={isHolding ? { duration: 0.1 } : { duration: 2, repeat: Infinity }}
            style={{
              textShadow: `0 0 10px ${colors.glow}, 0 2px 4px rgba(0,0,0,0.8)`,
            }}
          >
            {colors.icon}
          </motion.span>
        )}
      </motion.button>

      {/* Status indicator */}
      {hasVoted ? (
        <span className="text-[10px] text-green-400/70 font-medium mt-1">
          tap to undo
        </span>
      ) : (superRemaining > 0 || megaRemaining > 0) ? (
        <div className="flex gap-2 mt-1">
          {superRemaining > 0 && (
            <span className="text-[10px] text-yellow-400 font-medium">
              ⚡{superRemaining}
            </span>
          )}
          {megaRemaining > 0 && (
            <span className="text-[10px] text-purple-400 font-medium">
              💎{megaRemaining}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ============================================================================
// RIGHT COLUMN ACTION BUTTON
// ============================================================================

interface ActionButtonProps {
  icon: React.ReactNode;
  label?: string | number;
  onClick?: () => void;
}

function ActionButton({ icon, label, onClick }: ActionButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      className="flex flex-col items-center gap-1"
    >
      <div className="w-12 h-12 rounded-full flex items-center justify-center">
        {icon}
      </div>
      {label !== undefined && (
        <span className="text-white text-[11px] font-semibold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
          {label}
        </span>
      )}
    </motion.button>
  );
}

// ============================================================================
// NAV BUTTON (Bigger size)
// ============================================================================

interface NavButtonProps {
  href: string;
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
}

function NavButton({ href, icon, label, isActive = false }: NavButtonProps) {
  const content = (
    <motion.div 
      whileTap={{ scale: 0.9 }} 
      className="flex flex-col items-center gap-1 py-2 px-6"
    >
      <div className={`text-2xl ${isActive ? 'text-white' : 'text-white/70'}`}>
        {icon}
      </div>
      <span className={`text-xs font-medium ${isActive ? 'text-white' : 'text-white/60'}`}>
        {label}
      </span>
    </motion.div>
  );

  if (isActive) {
    return <div>{content}</div>;
  }

  return <Link href={href}>{content}</Link>;
}

// ============================================================================
// MAIN VOTING ARENA
// ============================================================================

function VotingArena() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isVoting, setIsVoting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true); // Start muted for mobile autoplay
  const [leaderboardCollapsed, setLeaderboardCollapsed] = useState(true); // Start collapsed

  const videoRef = useRef<HTMLVideoElement>(null);
  const queryClient = useQueryClient();

  // Swipe handling
  const touchStartY = useRef<number>(0);
  const touchEndY = useRef<number>(0);
  const swipeThreshold = 50;

  // Fetch voting data from real API
  // No refetchInterval - clips only change when user navigates (swipe/arrows)
  const { data: votingData, isLoading, error, refetch } = useQuery<VotingState>({
    queryKey: ['voting', 'track-main'],
    queryFn: async () => {
      const response = await fetch('/api/vote?trackId=track-main');
      if (!response.ok) {
        throw new Error('Failed to fetch voting data');
      }
      const apiResponse: APIVotingResponse = await response.json();
      return transformAPIResponse(apiResponse);
    },
    staleTime: Infinity, // Never consider data stale - user controls navigation
    retry: 3,
  });

  const votesToday = votingData?.totalVotesToday ?? 0;
  const currentClip = votingData?.clips?.[activeIndex];

  // Hide swipe hint after first interaction
  useEffect(() => {
    if (activeIndex > 0) setShowSwipeHint(false);
  }, [activeIndex]);

  // Reset pause state on clip change
  useEffect(() => {
    setIsPaused(false);
  }, [activeIndex]);

  // Vote mutation - supports standard, super, mega vote types
  const voteMutation = useMutation<VoteResponse, Error, { clipId: string; voteType: VoteType }, MutationContext>({
    mutationFn: async ({ clipId, voteType }) => {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId, voteType }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to vote');
      }
      return res.json();
    },
    onMutate: async ({ clipId, voteType }): Promise<MutationContext> => {
      setIsVoting(true);

      // Vibration feedback based on vote type
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        if (voteType === 'mega') {
          navigator.vibrate([50, 30, 50, 30, 100]);
        } else if (voteType === 'super') {
          navigator.vibrate([50, 30, 50]);
        } else {
          navigator.vibrate(50);
        }
      }

      await queryClient.cancelQueries({ queryKey: ['voting', 'track-main'] });
      const previous = queryClient.getQueryData<VotingState>(['voting', 'track-main']);

      // Calculate vote weight for optimistic update
      const voteWeight = voteType === 'mega' ? 10 : voteType === 'super' ? 3 : 1;

      if (previous) {
        queryClient.setQueryData<VotingState>(['voting', 'track-main'], {
          ...previous,
          clips: previous.clips.map((clip) =>
            clip.clip_id === clipId
              ? { ...clip, vote_count: clip.vote_count + voteWeight, has_voted: true }
              : clip
          ),
          totalVotesToday: (previous.totalVotesToday ?? 0) + 1,
        });
      }

      return { previous };
    },
    onError: (error: Error, _variables, context) => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }
      if (context?.previous) {
        queryClient.setQueryData(['voting', 'track-main'], context.previous);
      }
      toast.error(error.message);
      setIsVoting(false);
    },
    onSuccess: (_data, { voteType }) => {
      // Confetti for milestones and special votes
      if (voteType === 'mega') {
        confetti({ particleCount: 150, spread: 100, origin: { y: 0.6 } });
        toast.success('MEGA VOTE! 10x Power!', { icon: '💎' });
      } else if (voteType === 'super') {
        confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
        toast.success('SUPER VOTE! 3x Power!', { icon: '⚡' });
      } else if (votesToday === 0 || votesToday === 49 || votesToday === 99 || votesToday === 199) {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
      }
      setIsVoting(false);
      // Don't invalidate/refetch - optimistic update already handled the UI
      // This prevents video from changing after voting
    },
  });

  // Revoke vote mutation
  const revokeMutation = useMutation<
    { success: boolean; newScore: number; revokedVoteType: VoteType },
    Error,
    { clipId: string },
    MutationContext
  >({
    mutationFn: async ({ clipId }) => {
      const res = await fetch('/api/vote', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to revoke vote');
      }
      return res.json();
    },
    onMutate: async ({ clipId }): Promise<MutationContext> => {
      setIsVoting(true);

      // Vibration feedback for revoke
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([30, 20, 30]);
      }

      await queryClient.cancelQueries({ queryKey: ['voting', 'track-main'] });
      const previous = queryClient.getQueryData<VotingState>(['voting', 'track-main']);

      if (previous) {
        // Find the clip to get approximate vote weight (assume standard for optimistic)
        queryClient.setQueryData<VotingState>(['voting', 'track-main'], {
          ...previous,
          clips: previous.clips.map((clip) =>
            clip.clip_id === clipId
              ? { ...clip, vote_count: Math.max(0, clip.vote_count - 1), has_voted: false }
              : clip
          ),
          totalVotesToday: Math.max(0, (previous.totalVotesToday ?? 0) - 1),
        });
      }

      return { previous };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['voting', 'track-main'], context.previous);
      }
      toast.error(error.message);
      setIsVoting(false);
    },
    onSuccess: (data) => {
      const voteType = data.revokedVoteType;
      if (voteType === 'mega') {
        toast.success('Mega vote removed', { icon: '💎' });
      } else if (voteType === 'super') {
        toast.success('Super vote removed', { icon: '⚡' });
      } else {
        toast.success('Vote removed');
      }
      setIsVoting(false);
      // Don't invalidate/refetch - optimistic update already handled the UI
      // This prevents video from changing after revoking
    },
  });

  // Pusher real-time
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_PUSHER_KEY || !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) return;

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    });

    const channel = pusher.subscribe('voting-track-main');
    channel.bind('vote-update', (data: { clipId: string; voteCount?: number }) => {
      queryClient.setQueryData<VotingState | undefined>(['voting', 'track-main'], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          clips: prev.clips.map((clip) =>
            clip.clip_id === data.clipId
              ? { ...clip, vote_count: data.voteCount ?? clip.vote_count }
              : clip
          ),
        };
      });
    });

    return () => {
      channel.unbind_all();
      channel.unsubscribe();
      pusher.disconnect();
    };
  }, [queryClient]);

  // Keyboard navigation for desktop users
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevious();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === ' ') {
        e.preventDefault();
        handleVideoTap();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, votingData?.clips?.length]);

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (showComments) return;
    touchStartY.current = e.touches[0].clientY;
    // Reset touchEndY to same position - prevents tap from triggering swipe
    // (if user taps without moving, delta will be 0)
    touchEndY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (showComments) return;
    touchEndY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    if (showComments) return;
    const delta = touchStartY.current - touchEndY.current;
    if (Math.abs(delta) < swipeThreshold) return;

    if (delta > 0) handleNext();
    else handlePrevious();
  };

  const handleNext = useCallback(() => {
    if (!votingData?.clips?.length) return;
    setVideoError(false);
    setActiveIndex((prev) => (prev + 1) % votingData.clips.length);
  }, [votingData?.clips]);

  const handlePrevious = useCallback(() => {
    if (!votingData?.clips?.length) return;
    setVideoError(false);
    setActiveIndex((prev) => (prev === 0 ? votingData.clips.length - 1 : prev - 1));
  }, [votingData?.clips]);

  // Handle vote - if already voted, revoke; otherwise cast new vote
  const handleVote = (voteType: VoteType = 'standard') => {
    if (!currentClip || isVoting) return;

    // If already voted on this clip, revoke the vote (only on tap, not hold)
    if (currentClip.has_voted && voteType === 'standard') {
      revokeMutation.mutate({ clipId: currentClip.clip_id });
      return;
    }

    // Check daily limit for new votes
    if (votesToday >= DAILY_GOAL) {
      toast.error('Daily limit reached! Come back tomorrow 🚀');
      return;
    }

    voteMutation.mutate({ clipId: currentClip.clip_id, voteType });
  };

  // Handle revoke vote separately (for explicit revoke action)
  const handleRevokeVote = () => {
    if (!currentClip || isVoting || !currentClip.has_voted) return;
    revokeMutation.mutate({ clipId: currentClip.clip_id });
  };

  const handleVideoTap = () => {
    if (!videoRef.current) return;
    if (isPaused) {
      videoRef.current.play();
      setIsPaused(false);
    } else {
      videoRef.current.pause();
      setIsPaused(true);
    }
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/clip/${currentClip?.clip_id}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Check out this clip on AiMoviez!',
          text: `Vote for @${currentClip?.username}'s clip!`,
          url: shareUrl,
        });
      } catch {
        // User cancelled
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast.success('Link copied!');
      } catch {
        toast.error('Failed to copy link');
      }
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
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
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-5xl mb-4">😵</div>
          <h2 className="text-white text-xl font-bold mb-2">Connection Error</h2>
          <p className="text-white/60 mb-6">Failed to load clips</p>
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

  // Empty state
  if (!votingData?.clips?.length) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-5xl mb-4">🎬</div>
          <h2 className="text-white text-xl font-bold mb-2">No clips yet</h2>
          <p className="text-white/60 mb-6">Check back soon!</p>
          <Link href="/story" className="px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white inline-block">
            Back to Story
          </Link>
        </div>
      </div>
    );
  }

 const genreLabel = currentClip?.genre 
  ? (GENRE_LABELS[currentClip.genre.toUpperCase() as keyof typeof GENRE_LABELS] || currentClip.genre)
  : '';

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-black"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Toaster position="top-center" />

      {/* ============ VIDEO ============ */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeIndex}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0"
          onClick={handleVideoTap}
        >
          {videoError ? (
            <div className="w-full h-full flex items-center justify-center bg-black">
              <div className="text-center">
                <div className="text-5xl mb-4">🎬</div>
                <p className="text-white/60">Video unavailable</p>
              </div>
            </div>
          ) : currentClip ? (
            <>
              <video
                ref={videoRef}
                key={currentClip.clip_id}
                src={currentClip.video_url ?? '/placeholder-video.mp4'}
                poster={currentClip.thumbnail_url}
                className="w-full h-full object-cover [&::-webkit-media-controls]:hidden [&::-webkit-media-controls-enclosure]:hidden [&::-webkit-media-controls-panel]:hidden [&::-webkit-media-controls-start-playback-button]:hidden"
                style={{ WebkitAppearance: 'none' } as React.CSSProperties}
                autoPlay
                loop
                muted={isMuted}
                playsInline
                webkit-playsinline="true"
                x5-playsinline="true"
                disablePictureInPicture
                controlsList="nodownload nofullscreen noremoteplayback"
                onError={() => setVideoError(true)}
                onLoadedData={(e) => {
                  // Force play on mobile
                  const video = e.currentTarget;
                  video.play().catch(() => {
                    // If autoplay fails, keep muted and try again
                    video.muted = true;
                    video.play().catch(() => {});
                  });
                }}
              />
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {/* ============ TOP: Mini Leaderboard ============ */}
      <div className="absolute top-0 left-0 right-0 z-30 pt-12 pb-2">
        <MiniLeaderboard
          currentClipId={currentClip?.clip_id}
          onClipSelect={(clipId) => {
            // Find clip index and jump to it
            const index = votingData?.clips?.findIndex(c => c.clip_id === clipId);
            if (index !== undefined && index >= 0) {
              setActiveIndex(index);
              setVideoError(false);
            }
          }}
          isCollapsed={leaderboardCollapsed}
          onToggleCollapse={() => setLeaderboardCollapsed(!leaderboardCollapsed)}
        />
      </div>


      {/* ============ VOTING SEGMENT INFO ============ */}
      {votingData && (
        <div className="absolute top-28 left-4 z-20">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col gap-1"
          >
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/90 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-white text-xs font-bold">
                Voting: Segment {votingData.currentSlot}
              </span>
            </div>
            <div className="px-3 py-1 rounded-full bg-black/50 backdrop-blur-sm">
              <span className="text-white/70 text-[10px]">
                Round {votingData.currentSlot} of {votingData.totalSlots} · {currentClip?.genre || 'Mixed'}
              </span>
            </div>
          </motion.div>
        </div>
      )}

      {/* ============ RIGHT COLUMN ============ */}
      <div className="absolute right-3 bottom-32 z-20 flex flex-col items-center gap-4">
        {/* Creator Avatar */}
        <Link href={`/profile/${currentClip?.user_id}`}>
          <motion.div whileTap={{ scale: 0.9 }} className="relative">
            <img
              src={currentClip?.avatar_url || 'https://api.dicebear.com/7.x/identicon/svg?seed=default'}
              alt=""
              className="w-12 h-12 rounded-full border-2 border-white/80 object-cover"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
            />
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center border-2 border-black">
              <span className="text-white text-[10px] font-bold">+</span>
            </div>
          </motion.div>
        </Link>

        {/* POWER VOTE BUTTON - Long press for Super/Mega votes */}
        <div className="flex flex-col items-center gap-1">
          <PowerVoteButton
            onVote={handleVote}
            isVoting={isVoting}
            isDisabled={votesToday >= DAILY_GOAL}
            hasVoted={currentClip?.has_voted ?? false}
            superRemaining={votingData?.remainingVotes?.super ?? 1}
            megaRemaining={votingData?.remainingVotes?.mega ?? 1}
          />
          {/* Vote Count */}
          <span className="text-white text-xs font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
            {formatNumber(currentClip?.vote_count ?? 0)}
          </span>
        </div>

        {/* Comments */}
        <ActionButton
          icon={<MessageCircle className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />}
          label="Chat"
          onClick={() => setShowComments(true)}
        />

        {/* Share */}
        <ActionButton
          icon={<Share2 className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />}
          onClick={handleShare}
        />

        {/* Mute/Unmute */}
        <ActionButton
          icon={
            isMuted ? (
              <VolumeX className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
            ) : (
              <Volume2 className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />
            )
          }
          onClick={() => setIsMuted(!isMuted)}
        />

        {/* Daily Vote Progress */}
        <div className="mt-2 flex flex-col items-center">
          <p className="text-white text-xs font-semibold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
            {votesToday}/{DAILY_GOAL}
          </p>
          <p className="text-white/60 text-[10px] font-medium">
            votes today
          </p>
        </div>

      </div>

      {/* ============ BOTTOM: Creator Info ============ */}
      <div className="absolute bottom-24 left-0 right-16 z-20 px-4">
        <div className="flex items-center gap-2">
          <p className="text-white font-semibold text-sm drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            @{currentClip?.username || 'creator'}
          </p>
          <span className="text-white/60">·</span>
          <p className="text-white/80 text-sm drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">{genreLabel}</p>
        </div>
      </div>

      {/* ============ NAVIGATION ARROWS - LEFT SIDE (All Screens) ============ */}
      {votingData?.clips && votingData.clips.length > 1 && (
        <div className="absolute left-3 md:left-8 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-4 md:gap-6">
          {/* Previous Clip Arrow */}
          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.25)' }}
            whileTap={{ scale: 0.9 }}
            onClick={handlePrevious}
            className={`w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/10 backdrop-blur-md
                     border border-white/20 flex items-center justify-center
                     transition-all shadow-lg ${activeIndex === 0 ? 'opacity-30' : 'opacity-100'}`}
            type="button"
            title="Previous clip (↑)"
          >
            <svg className="w-5 h-5 md:w-7 md:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
            </svg>
          </motion.button>

          {/* Clip Counter */}
          <div className="text-center">
            <span className="text-white/80 text-xs md:text-sm font-medium drop-shadow-lg">
              {activeIndex + 1}/{votingData.clips.length}
            </span>
          </div>

          {/* Next Clip Arrow */}
          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.25)' }}
            whileTap={{ scale: 0.9 }}
            onClick={handleNext}
            className={`w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/10 backdrop-blur-md
                     border border-white/20 flex items-center justify-center
                     transition-all shadow-lg ${activeIndex >= votingData.clips.length - 1 ? 'opacity-30' : 'opacity-100'}`}
            type="button"
            title="Next clip (↓)"
          >
            <svg className="w-5 h-5 md:w-7 md:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </motion.button>
        </div>
      )}

      {/* Keyboard Hint - Desktop Only */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 0.6, y: 0 }}
        transition={{ delay: 1.5, duration: 0.5 }}
        className="hidden md:block absolute bottom-24 left-8 z-20
                 px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur-sm
                 border border-white/10"
      >
        <p className="text-white/70 text-[10px] font-medium tracking-wide">
          ↑↓ SPACE
        </p>
      </motion.div>

      {/* ============ COMMENTS PANEL ============ */}
      <CommentsSection
        clipId={currentClip?.clip_id || ''}
        isOpen={showComments}
        onClose={() => setShowComments(false)}
        clipUsername={currentClip?.username}
      />

      {/* ============ BOTTOM NAV (4 items, transparent, bigger) ============ */}
      <div className="absolute bottom-0 left-0 right-0 z-40 pb-safe">
        {/* Gradient fade for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent pointer-events-none" />

        <div className="relative flex items-center justify-around px-4 pb-4 pt-1">
          <NavButton
            href="/story"
            icon={<BookOpen className="w-6 h-6" />}
            label="Story"
          />
          <NavButton
            href="/leaderboard"
            icon={<Trophy className="w-6 h-6" />}
            label="Rankings"
          />
          <NavButton
            href="/upload"
            icon={<Plus className="w-7 h-7" />}
            label="Upload"
          />
          <NavButton
            href="/profile"
            icon={<User className="w-6 h-6" />}
            label="Profile"
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PAGE WRAPPER
// ============================================================================

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 2,
    },
  },
});

export default function DashboardPage() {
  return (
    <AuthGuard>
      <QueryClientProvider client={queryClient}>
        <VotingArena />
      </QueryClientProvider>
    </AuthGuard>
  );
}