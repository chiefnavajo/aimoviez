'use client';

// ============================================================================
// VOTING ARENA - FINAL CLEAN VERSION (V5.5)
// ============================================================================
// ✅ Sound enabled by default (unmuted)
// ✅ Mute/Unmute toggle button in right column
// ✅ No play button overlay (auto-plays smoothly)
// ✅ Comments panel transparent with blur (video visible behind)
// ✅ Vote button on right (visible, solid bg)
// ✅ Shared BottomNavigation (Story, Watch, Upload, Ranks, Profile)
// ✅ Transparent nav background
// ✅ ~95% video visibility
// ============================================================================

import { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import Link from 'next/link';
import Image from 'next/image';
import { MessageCircle, Share2, Volume2, VolumeX, HelpCircle, BookOpen, Plus, Sparkles, Trophy, User, Play } from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';
import { ActionButton } from '@/components/ActionButton';
import { AuthGuard } from '@/hooks/useAuth';
import { useFeature } from '@/hooks/useFeatureFlags';
import { sounds } from '@/lib/sounds';
import { useInvisibleCaptcha, useCaptchaRequired } from '@/components/CaptchaVerification';
import { useCsrf } from '@/hooks/useCsrf';
import { useOnboarding } from '@/components/OnboardingTour';
import { useSpotlightTour } from '@/components/SpotlightTour';
import { useRealtimeClips, useStoryBroadcast, ClipUpdate, WinnerSelectedPayload } from '@/hooks/useRealtimeClips';
import { useRealtimeVoteBroadcast } from '@/hooks/useRealtimeVotes';
import type { VoteUpdatePayload } from '@/hooks/useRealtimeVotes';
import { useLandscapeVideo } from '@/hooks/useLandscapeVideo';
import { InstallPrompt } from '@/components/InstallPrompt';
import { useGenreSwiper, useKeyboardNavigation } from '@/hooks/useGenreSwiper';
import { GenreHeader } from '@/components/GenreSwiper';

// Lazy load OnboardingTour - only shown once per user
const OnboardingTour = dynamic(() => import('@/components/OnboardingTour').then(mod => mod.default), {
  ssr: false,
  loading: () => null,
});

// Lazy load SpotlightTour - new spotlight-based tour
const SpotlightTour = dynamic(() => import('@/components/SpotlightTour').then(mod => mod.default), {
  ssr: false,
  loading: () => null,
});

// Dynamically import heavy libraries that are only used conditionally
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let confettiLib: any = null;

const loadConfetti = async () => {
  if (!confettiLib) {
    confettiLib = (await import('canvas-confetti')).default;
  }
  return confettiLib;
};

// Dynamically import heavy components to reduce initial bundle
const CommentsSection = dynamic(() => import('@/components/CommentsSection'), { 
  ssr: false,
  loading: () => null 
});

// ============================================================================
// TYPES
// ============================================================================



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
  comment_count?: number;
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
  comment_count?: number;
}

// API response structure
interface APIVotingResponse {
  clips: APIClip[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: {
    standard: number;
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
  // Season status info
  seasonStatus?: 'active' | 'finished' | 'none';
  finishedSeasonName?: string;
  // Waiting for clips status
  waitingForClips?: boolean;
}

// Frontend state structure
interface VotingState {
  clips: ClipForClient[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: {
    standard: number;
  };
  streak: number;
  currentSlot: number;
  totalSlots: number;
  votingEndsAt: string | null;
  votingStartedAt: string | null;
  hasMoreClips: boolean;
  totalClipsInSlot: number;
  // Season status info
  seasonStatus?: 'active' | 'finished' | 'none';
  finishedSeasonName?: string;
  // Waiting for clips status
  waitingForClips?: boolean;
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
    comment_count: clip.comment_count ?? 0,
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
    votingStartedAt: apiResponse.votingStartedAt,
    hasMoreClips: apiResponse.hasMoreClips,
    totalClipsInSlot: apiResponse.totalClipsInSlot,
    seasonStatus: apiResponse.seasonStatus,
    finishedSeasonName: apiResponse.finishedSeasonName,
    waitingForClips: apiResponse.waitingForClips,
  };
}

// Transform API response for appending more clips (pagination)
function transformAndAppendClips(existing: VotingState, apiResponse: APIVotingResponse): VotingState {
  const newClips: ClipForClient[] = apiResponse.clips.map((clip) => ({
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
    comment_count: clip.comment_count ?? 0,
  }));

  // Filter out duplicates (in case some clips were already loaded)
  const existingIds = new Set(existing.clips.map(c => c.id));
  const uniqueNewClips = newClips.filter(c => !existingIds.has(c.id));

  return {
    ...existing,
    clips: [...existing.clips, ...uniqueNewClips],
    hasMoreClips: apiResponse.hasMoreClips,
    totalClipsInSlot: apiResponse.totalClipsInSlot,
    // Update vote-related state from new response
    totalVotesToday: apiResponse.totalVotesToday,
    remainingVotes: apiResponse.remainingVotes,
  };
}

interface VoteResponse {
  success: boolean;
  error?: string;
  newScore?: number;
  totalVotesToday?: number;
  remainingVotes?: number;
}

interface MutationContext {
  previous?: VotingState;
  /** Captured genreParam at mutation time to prevent stale closure issues */
  capturedGenreParam?: string | null;
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
  'SCI-FI': 'Sci-Fi',
  THRILLER: 'Thriller',
  ROMANCE: 'Romance',
  ANIMATION: 'Animation',
  HORROR: 'Horror',
  DRAMA: 'Drama',
};

// ============================================================================
// SIMPLE VOTE BUTTON - Tap to vote/unvote (super/mega votes disabled)
// ============================================================================

interface PowerVoteButtonProps {
  onVote: () => void;
  isVoting: boolean;
  isDisabled: boolean;
  hasVoted: boolean;
  votesToday?: number;
  dailyGoal?: number;
  showDailyProgress?: boolean;
  multiVoteMode?: boolean;
}

const PowerVoteButton = memo(function PowerVoteButton({
  onVote,
  isVoting,
  isDisabled,
  hasVoted,
  votesToday = 0,
  dailyGoal = 200,
  showDailyProgress = false,
}: Omit<PowerVoteButtonProps, 'multiVoteMode'>) {
  const colors = {
    glow: 'rgba(56, 189, 248, 0.5)',
    ring: '#3CF2FF',
    bg: 'rgba(0,0,0,0.3)',
    icon: '∞',
    label: ''
  };

  const circumference = 2 * Math.PI * 29;

  // Daily progress calculation (0 to 1)
  const dailyProgress = Math.min(votesToday / dailyGoal, 1);
  const dailyStrokeDashoffset = circumference * (1 - dailyProgress);

  // Color gradient based on daily progress (blue → cyan → green → gold)
  const getDailyProgressColor = () => {
    if (dailyProgress >= 1) return '#FFD700'; // Gold at 100%
    if (dailyProgress >= 0.75) return '#F59E0B'; // Orange at 75%+
    if (dailyProgress >= 0.5) return '#22C55E'; // Green at 50%+
    if (dailyProgress >= 0.25) return '#06B6D4'; // Cyan at 25%+
    return '#3B82F6'; // Blue at start
  };

  const dailyProgressColor = getDailyProgressColor();

  const handleClick = () => {
    if (isVoting) return;
    if (isDisabled) {
      toast.error('All votes used up for today! Come back tomorrow.');
      return;
    }
    onVote();
  };

  return (
    <div className="relative flex flex-col items-center">
      <motion.button
        onClick={handleClick}
        whileTap={{ scale: 0.95 }}
        disabled={isVoting}
        aria-disabled={isDisabled}
        aria-label={hasVoted ? 'Remove vote from this clip' : 'Vote for this clip'}
        aria-pressed={hasVoted}
        className="relative w-16 h-16 flex items-center justify-center touch-none select-none"
      >
        {/* Outer glow - green when voted */}
        <motion.div
          className="absolute inset-[-6px] rounded-full"
          animate={{
            boxShadow: hasVoted
              ? '0 0 15px rgba(74, 222, 128, 0.5)'
              : [
                  '0 0 15px rgba(56, 189, 248, 0.5)',
                  '0 0 25px rgba(168, 85, 247, 0.6)',
                  '0 0 15px rgba(56, 189, 248, 0.5)',
                ],
          }}
          transition={{ duration: 2.5, repeat: Infinity }}
        />

        {/* Progress ring */}
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 64 64">
          <defs>
            <linearGradient id="voteGradientPower" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3CF2FF" />
              <stop offset="50%" stopColor="#A855F7" />
              <stop offset="100%" stopColor="#EC4899" />
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

          {/* Daily progress ring (outer) - only when feature enabled */}
          {showDailyProgress && !hasVoted && (
            <circle
              cx="32"
              cy="32"
              r="29"
              fill="none"
              stroke={dailyProgressColor}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dailyStrokeDashoffset}
              style={{
                transition: 'stroke-dashoffset 0.5s ease-out, stroke 0.3s ease',
                filter: dailyProgress >= 1 ? 'drop-shadow(0 0 6px #FFD700)' : 'none'
              }}
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
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{
              textShadow: `0 0 10px ${colors.glow}, 0 2px 4px rgba(0,0,0,0.8)`,
            }}
          >
            {colors.icon}
          </motion.span>
        )}
      </motion.button>

      {/* Status indicator */}
      {!hasVoted && (
        <span className="text-[10px] text-white/70 font-medium mt-1">
          Vote now!
        </span>
      )}
    </div>
  );
});

// ActionButton imported from shared component

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

  // FIX: Ref to track isPaused for use in setTimeout (prevents stale closure)
  const isPausedRef = useRef(false);

  // FIX: Sync ref with state to prevent stale closures in setTimeout callbacks
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Double-tap detection
  const [lastTapTime, setLastTapTime] = useState(0);
  const [doubleTapPosition, setDoubleTapPosition] = useState<{ x: number; y: number } | null>(null);
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);

  // Pull-to-refresh
  const [pullDistance, setPullDistance] = useState(0);
  const pullDistanceRef = useRef(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullStartY = useRef<number>(0);
  const isPulling = useRef<boolean>(false);
  const PULL_THRESHOLD = 80;

  // BUG 3 FIX: Refs to store timeout IDs for proper cleanup on unmount
  const heartTimeoutRef = useRef<NodeJS.Timeout>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout>(null);

  // BUG 5 FIX: Keep pullDistanceRef in sync with state
  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  // BUG 3 FIX: Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (heartTimeoutRef.current) clearTimeout(heartTimeoutRef.current);
      if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    };
  }, []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const queryClient = useQueryClient();

  // Feature flag for spotlight tour (new tour style)
  const { enabled: useSpotlightTourFlag } = useFeature('spotlight_tour');

  // Onboarding tours - modal (old) and spotlight (new)
  const modalTour = useOnboarding();
  const spotlightTour = useSpotlightTour();

  // Use the appropriate tour based on feature flag
  const activeTour = useSpotlightTourFlag ? spotlightTour : modalTour;
  const { showTour, completeTour, skipTour, resetTour } = activeTour;

  // Feature flag for vote button daily progress fill
  const { enabled: showVoteProgress } = useFeature('vote_button_progress');

  // Feature flag for multi-vote mode (allows voting multiple times on same clip)
  const { enabled: multiVoteMode } = useFeature('multi_vote_mode');

  // Multi-genre swiper
  const {
    genres,
    currentGenre,
    currentIndex: genreIndex,
    goToGenre,
    nextGenre,
    prevGenre,
    multiGenreEnabled,
    hasNext: hasNextGenre,
    hasPrev: hasPrevGenre,
  } = useGenreSwiper();

  // CSRF protection for API calls
  const { getHeaders } = useCsrf();

  // CAPTCHA for bot protection
  const { isRequired: captchaRequired } = useCaptchaRequired();
  const captchaTokenRef = useRef<string | null>(null);
  const { execute: executeCaptcha, reset: resetCaptcha, CaptchaWidget, isConfigured: captchaConfigured } = useInvisibleCaptcha({
    onVerify: (token) => {
      captchaTokenRef.current = token;
    },
    onError: (error) => {
      console.error('[CAPTCHA] Error:', error);
      toast.error('Verification failed. Please try again.');
    },
  });

  // Swipe handling (vertical for clips, horizontal for genres)
  const touchStartY = useRef<number>(0);
  const touchEndY = useRef<number>(0);
  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  const swipeThreshold = 50;

  // Video preload cache to prevent DOM accumulation on swipes
  const preloadedVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Track if we're loading more clips
  const [_isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // FIX: Ref to track midnight timeout for proper cleanup of recursive timeout
  const midnightTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Landscape video mode - auto-fill screen when phone rotates
  const { isLandscape, showControls, handleScreenTap } = useLandscapeVideo();

  // Desktop detection - show sidebar on desktop, hide genre tabs on mobile (use swipe instead)
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    setIsDesktop(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);
  const isMobile = !isDesktop;

  // Fetch voting data from real API
  // No refetchInterval - clips only change when user navigates (swipe/arrows)
  // Include genre param when multi-genre is enabled
  const genreParam = multiGenreEnabled && currentGenre ? currentGenre.genre : null;

  // Ref to track current genreParam for stale closure detection in async callbacks
  const genreParamRef = useRef(genreParam);
  useEffect(() => {
    genreParamRef.current = genreParam;
  }, [genreParam]);

  // FIX: Clear preloaded videos on genre switch to prevent memory waste
  // Videos from previous genre are not useful after switching
  useEffect(() => {
    const cache = preloadedVideosRef.current;
    cache.forEach((video) => {
      video.src = '';
      video.load();
    });
    cache.clear();
  }, [genreParam]);

  const { data: votingData, isLoading, error, refetch } = useQuery<VotingState>({
    queryKey: ['voting', 'track-main', genreParam],
    queryFn: async () => {
      const url = genreParam
        ? `/api/vote?trackId=track-main&genre=${encodeURIComponent(genreParam)}`
        : '/api/vote?trackId=track-main';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch voting data');
      }
      const apiResponse: APIVotingResponse = await response.json();
      return transformAPIResponse(apiResponse);
    },
    staleTime: 0, // Always consider data stale on mount to ensure fresh fetch
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: 3,
    refetchOnMount: 'always', // Always refetch fresh data on page load
    placeholderData: (previousData) => previousData, // Show cached data immediately while fetching
  });

  // Load more clips when approaching the end of the list
  // Uses excludeIds to get fresh random clips that haven't been shown yet
  // FIX: Capture genreParam at start to prevent race condition when genre switches mid-fetch
  const loadMoreClips = useCallback(async () => {
    if (!votingData?.hasMoreClips || !votingData?.clips?.length || loadingMoreRef.current) {
      return;
    }

    // Capture genreParam at the start of async operation
    const capturedGenreParam = genreParam;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      // Send IDs of all already-loaded clips to exclude them from new batch
      const excludeIds = votingData.clips.map(c => c.id).join(',');
      let moreUrl = `/api/vote?trackId=track-main&excludeIds=${encodeURIComponent(excludeIds)}&limit=10`;
      if (capturedGenreParam) {
        moreUrl += `&genre=${encodeURIComponent(capturedGenreParam)}`;
      }
      const response = await fetch(moreUrl);
      if (!response.ok) {
        throw new Error('Failed to load more clips');
      }
      const apiResponse: APIVotingResponse = await response.json();

      // Verify genre hasn't changed during fetch - if it has, discard results
      // FIX: Compare against ref (current live value), not closure value (always stale)
      if (capturedGenreParam !== genreParamRef.current) {
        console.log('[loadMoreClips] Genre changed during fetch, discarding results');
        return;
      }

      // Update the query cache with appended clips using captured genreParam
      queryClient.setQueryData<VotingState>(['voting', 'track-main', capturedGenreParam], (old) => {
        if (!old) return old;
        return transformAndAppendClips(old, apiResponse);
      });
    } catch (error) {
      console.error('Error loading more clips:', error);
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [votingData?.hasMoreClips, votingData?.clips, queryClient, genreParam]);

  // Auto-refresh at midnight UTC when daily votes reset
  // This ensures users don't need to manually refresh to see their reset vote count
  // FIX: Use ref to track recursive timeout and clear properly on cleanup
  useEffect(() => {
    const scheduleNextMidnightRefresh = () => {
      // Clear any existing timeout first to prevent duplicates
      if (midnightTimeoutRef.current) {
        clearTimeout(midnightTimeoutRef.current);
      }

      const now = new Date();
      // Calculate next midnight UTC
      const nextMidnight = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1, // Tomorrow
        0, 0, 0, 0 // 00:00:00.000 UTC
      ));
      const msUntilMidnight = nextMidnight.getTime() - now.getTime();

      // Set timeout to refetch at midnight UTC
      midnightTimeoutRef.current = setTimeout(() => {
        console.log('[Dashboard] Midnight UTC - refreshing vote data');
        refetch();
        // Schedule the next midnight refresh
        scheduleNextMidnightRefresh();
      }, msUntilMidnight);
    };

    scheduleNextMidnightRefresh();

    return () => {
      if (midnightTimeoutRef.current) {
        clearTimeout(midnightTimeoutRef.current);
        midnightTimeoutRef.current = null;
      }
    };
  }, [refetch]);

  const votesToday = votingData?.totalVotesToday ?? 0;
  const currentClip = useMemo(() => votingData?.clips?.[activeIndex], [votingData?.clips, activeIndex]);

  // Real-time updates for clips (votes, new clips, deletions)
  // NOTE: Disabled due to Supabase Realtime postgres_changes binding issue
  useRealtimeClips({
    enabled: false,
    onClipUpdate: useCallback((updatedClip: ClipUpdate) => {
      // If clip status changed to 'locked' (winner selected), show notification and remove
      if (updatedClip.status === 'locked') {
        console.log('[Realtime] Clip won the slot - removing from feed');
        toast.success('A winner has been selected for this slot!', {
          icon: '🏆',
          duration: 4000,
        });
        // Refetch to get the new slot's clips
        setTimeout(() => refetch(), 1000);
        return;
      }

      // If clip status changed to non-active (rejected, pending, etc.), remove it
      if (updatedClip.status && updatedClip.status !== 'active' && updatedClip.status !== 'approved' && updatedClip.status !== 'voting') {
        console.log('[Realtime] Clip status changed to', updatedClip.status, '- removing from feed');
        queryClient.setQueryData<VotingState>(['voting', 'track-main', genreParam], (oldData) => {
          if (!oldData?.clips) return oldData;
          return {
            ...oldData,
            clips: oldData.clips.filter((clip) => clip.clip_id !== updatedClip.id),
          };
        });
        return;
      }

      // If clip's slot_position changed (moved to different slot), refetch
      if (updatedClip.slot_position !== undefined) {
        console.log('[Realtime] Clip moved to different slot - refreshing feed');
        refetch();
        return;
      }

      // Update the clip in the React Query cache
      queryClient.setQueryData<VotingState>(['voting', 'track-main', genreParam], (oldData) => {
        if (!oldData?.clips) return oldData;
        return {
          ...oldData,
          clips: oldData.clips.map((clip) =>
            clip.clip_id === updatedClip.id
              ? {
                  ...clip,
                  vote_count: updatedClip.vote_count ?? clip.vote_count,
                  weighted_score: updatedClip.weighted_score ?? clip.weighted_score,
                  hype_score: updatedClip.hype_score ?? clip.hype_score,
                }
              : clip
          ),
        };
      });
    }, [queryClient, refetch, genreParam]),
    onNewClip: useCallback((newClip: ClipUpdate) => {
      // When a new clip is approved/added, refetch to get the full clip data
      // Only refetch if the clip status is 'active' or 'approved' (ready for voting)
      if (newClip.status === 'active' || newClip.status === 'approved') {
        console.log('[Realtime] New clip added to voting, refreshing feed...');
        refetch();
        toast.success('New clip added!', { icon: '🎬' });
      }
    }, [refetch]),
    onClipDelete: useCallback((clipId: string) => {
      // Remove deleted clip from the cache
      queryClient.setQueryData<VotingState>(['voting', 'track-main', genreParam], (oldData) => {
        if (!oldData?.clips) return oldData;
        const newClips = oldData.clips.filter((clip) => clip.clip_id !== clipId);
        return {
          ...oldData,
          clips: newClips,
        };
      });
    }, [queryClient, genreParam]),
  });

  // Real-time broadcast listener for winner selection
  // When admin selects a winner, refetch clips to get the new slot's content
  useStoryBroadcast({
    enabled: true,
    onWinnerSelected: useCallback((payload: WinnerSelectedPayload) => {
      console.log('[Dashboard Broadcast] Winner selected event received:', payload);
      toast.success('A winner has been selected for this slot!', {
        icon: '🏆',
        duration: 4000,
      });
      // Refetch to get the new slot's clips (winner is removed, remaining clips move to next slot)
      setTimeout(() => refetch(), 500);
    }, [refetch]),
  });

  // Real-time vote broadcast: update vote counts from other users
  // Multi-genre: pass seasonId to subscribe to genre-specific channel
  useRealtimeVoteBroadcast({
    enabled: true,
    seasonId: currentGenre?.id,
    onVoteUpdate: useCallback((payload: VoteUpdatePayload) => {
      // Filter out updates from other seasons/genres
      if (payload.seasonId && currentGenre?.id && payload.seasonId !== currentGenre.id) {
        return; // Ignore votes from other genres
      }
      queryClient.setQueryData<VotingState>(['voting', 'track-main', genreParam], (oldData) => {
        if (!oldData?.clips) return oldData;
        return {
          ...oldData,
          clips: oldData.clips.map((clip) =>
            clip.clip_id === payload.clipId
              ? {
                  ...clip,
                  vote_count: payload.voteCount,
                  weighted_score: payload.weightedScore,
                }
              : clip
          ),
        };
      });
    }, [queryClient, genreParam, currentGenre?.id]),
  });

  // Browser-level prefetch for next video
  useEffect(() => {
    if (!votingData?.clips?.length) return;
    const nextIndex = (activeIndex + 1) % votingData.clips.length;
    const nextClip = votingData.clips[nextIndex];

    if (nextClip?.video_url) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'video';
      link.href = nextClip.video_url;
      link.type = 'video/mp4';
      document.head.appendChild(link);
      return () => {
        if (link.parentNode) {
          document.head.removeChild(link);
        }
      };
    }
  }, [activeIndex, votingData?.clips]);

  // Reset pause state on clip change
  useEffect(() => {
    setIsPaused(false);
  }, [activeIndex]);

  // Reset activeIndex when switching genres to prevent out-of-bounds access
  useEffect(() => {
    setActiveIndex(0);
  }, [genreParam]);

  // Bound activeIndex when clips array shrinks (e.g., realtime deletion)
  useEffect(() => {
    const clipsLength = votingData?.clips?.length ?? 0;
    if (clipsLength > 0 && activeIndex >= clipsLength) {
      setActiveIndex(clipsLength - 1);
    }
  }, [votingData?.clips?.length, activeIndex]);

  // Video prefetching - preload next clips for smooth playback
  // FIX: Use Map to cache videos by clip_id, preventing DOM accumulation
  // PERF: Use 'auto' preload for fully buffered next videos
  useEffect(() => {
    if (!votingData?.clips?.length) return;

    const cache = preloadedVideosRef.current;
    // Preload next 2 clips for smoother swiping experience
    const clipsToPreload = [
      (activeIndex + 1) % votingData.clips.length,
      (activeIndex + 2) % votingData.clips.length,
    ];

    // Get clip IDs that should be preloaded
    const preloadClipIds = new Set<string>();
    clipsToPreload.forEach((index) => {
      const clip = votingData.clips[index];
      if (clip?.clip_id && clip?.video_url) {
        preloadClipIds.add(clip.clip_id);

        // Only create video element if not already cached
        if (!cache.has(clip.clip_id)) {
          const video = document.createElement('video');
          video.preload = 'auto'; // Use 'auto' for better preloading of next videos
          video.muted = true;
          video.playsInline = true;
          video.src = clip.video_url;
          // Listen for canplaythrough to know when video is ready
          video.addEventListener('canplaythrough', () => {
            // Video is preloaded and ready for smooth playback
          }, { once: true });
          video.load();
          cache.set(clip.clip_id, video);
        }
      }
    });

    // Cleanup videos that are no longer in preload set
    cache.forEach((video, clipId) => {
      if (!preloadClipIds.has(clipId)) {
        video.src = '';
        video.load();
        cache.delete(clipId);
      }
    });
  }, [activeIndex, votingData?.clips]);

  // Cleanup all preloaded videos on unmount
  useEffect(() => {
    const cache = preloadedVideosRef.current;
    return () => {
      cache.forEach((video) => {
        video.src = '';
        video.load();
      });
      cache.clear();
    };
  }, []);

  // Vote mutation - standard votes only
  const voteMutation = useMutation<VoteResponse, Error, { clipId: string; captchaToken?: string | null }, MutationContext>({
    mutationFn: async ({ clipId, captchaToken }) => {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ clipId, captchaToken }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Failed to vote' }));
        throw new Error(errorData.error || 'Failed to vote');
      }
      return res.json();
    },
    onMutate: async ({ clipId }): Promise<MutationContext> => {
      // Capture genreParam at mutation time to prevent stale closure issues
      const capturedGenreParam = genreParam;

      // QUICK WIN #1: Don't show spinner - optimistic update makes it feel instant
      // setIsVoting only used briefly for preventing double-clicks
      setIsVoting(true);

      // Vibration feedback - instant tactile response
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(50);
      }

      await queryClient.cancelQueries({ queryKey: ['voting', 'track-main', capturedGenreParam] });
      const previous = queryClient.getQueryData<VotingState>(['voting', 'track-main', capturedGenreParam]);

      // Calculate new vote count for sound decision
      const newVotesToday = (previous?.totalVotesToday ?? 0) + 1;

      if (previous) {
        queryClient.setQueryData<VotingState>(['voting', 'track-main', capturedGenreParam], {
          ...previous,
          clips: previous.clips.map((clip) =>
            clip.clip_id === clipId
              ? { ...clip, vote_count: clip.vote_count + 1, has_voted: true }
              : clip
          ),
          totalVotesToday: newVotesToday,
        });
      }

      // QUICK WIN #3: Play sound IMMEDIATELY (don't wait for server)
      // Milestones: 1st vote, 50th, 100th, 200th
      if (newVotesToday === 1 || newVotesToday === 50 || newVotesToday === 100 || newVotesToday === 200) {
        sounds.play('milestone');
        // Fire confetti async - don't block
        loadConfetti().then(confettiLib => {
          confettiLib({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        });
      } else {
        sounds.play('vote');
      }

      // QUICK WIN #1: Remove spinner immediately after optimistic update
      // The has_voted state change shows the checkmark, no spinner needed
      setTimeout(() => setIsVoting(false), 50);

      return { previous, capturedGenreParam };
    },
    onError: (error: Error, _variables, context) => {
      // On error: play error sound and rollback
      sounds.play('error');
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }
      if (context?.previous) {
        // Use captured genreParam from mutation time, not current (which may have changed)
        queryClient.setQueryData(['voting', 'track-main', context.capturedGenreParam], context.previous);
      }
      toast.error(error.message);
      setIsVoting(false);
    },
    onSuccess: () => {
      // Server confirmed - nothing to do, optimistic update already handled UI
      // Sound already played in onMutate
      setIsVoting(false);
    },
  });

  // Revoke vote mutation
  const revokeMutation = useMutation<
    { success: boolean; newScore: number },
    Error,
    { clipId: string },
    MutationContext
  >({
    mutationFn: async ({ clipId }) => {
      const res = await fetch('/api/vote', {
        method: 'DELETE',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ clipId }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Failed to revoke vote' }));
        throw new Error(errorData.error || 'Failed to revoke vote');
      }
      return res.json();
    },
    onMutate: async ({ clipId }): Promise<MutationContext> => {
      // Capture genreParam at mutation time
      const capturedGenreParam = genreParam;
      setIsVoting(true);

      // Vibration feedback for revoke
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([30, 20, 30]);
      }

      await queryClient.cancelQueries({ queryKey: ['voting', 'track-main', capturedGenreParam] });
      const previous = queryClient.getQueryData<VotingState>(['voting', 'track-main', capturedGenreParam]);

      if (previous) {
        queryClient.setQueryData<VotingState>(['voting', 'track-main', capturedGenreParam], {
          ...previous,
          clips: previous.clips.map((clip) =>
            clip.clip_id === clipId
              ? { ...clip, vote_count: Math.max(0, clip.vote_count - 1), has_voted: false }
              : clip
          ),
          totalVotesToday: Math.max(0, (previous.totalVotesToday ?? 0) - 1),
        });
      }

      return { previous, capturedGenreParam };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previous) {
        // Use captured genreParam from mutation time
        queryClient.setQueryData(['voting', 'track-main', context.capturedGenreParam], context.previous);
      }
      toast.error(error.message);
      setIsVoting(false);
    },
    onSuccess: (data, { clipId }, context) => {
      toast.success('Vote removed');
      setIsVoting(false);

      // Update with actual server value using captured genreParam
      const capturedGenreParam = context?.capturedGenreParam;
      const previous = queryClient.getQueryData<VotingState>(['voting', 'track-main', capturedGenreParam]);
      if (previous) {
        queryClient.setQueryData<VotingState>(['voting', 'track-main', capturedGenreParam], {
          ...previous,
          clips: previous.clips.map((clip) =>
            clip.clip_id === clipId
              ? { ...clip, vote_count: Math.max(0, data.newScore) }
              : clip
          ),
        });
      }
    },
  });

  // Touch handlers with pull-to-refresh and horizontal genre swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    if (showComments) return;
    touchStartY.current = e.touches[0].clientY;
    touchEndY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = e.touches[0].clientX;

    // Pull-to-refresh: only start if at top of page
    if (activeIndex === 0 && !isRefreshing) {
      pullStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (showComments) return;
    touchEndY.current = e.touches[0].clientY;
    touchEndX.current = e.touches[0].clientX;

    // Pull-to-refresh logic
    if (isPulling.current && activeIndex === 0 && !isRefreshing) {
      const distance = e.touches[0].clientY - pullStartY.current;
      if (distance > 0) {
        // Rubber band effect - diminishing returns
        setPullDistance(Math.min(distance * 0.5, PULL_THRESHOLD * 1.5));
      }
    }
  };

  const handleTouchEnd = async () => {
    if (showComments) return;

    // Check for pull-to-refresh trigger (BUG 5 FIX: read from ref to avoid stale closure)
    if (isPulling.current && pullDistanceRef.current >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);

      // Haptic feedback
      if (navigator.vibrate) navigator.vibrate(50);

      try {
        await refetch();
        toast.success('Refreshed!');
      } catch {
        toast.error('Failed to refresh');
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }

      isPulling.current = false;
      return;
    }

    // Reset pull distance
    setPullDistance(0);
    isPulling.current = false;

    // Calculate swipe deltas
    const deltaY = touchStartY.current - touchEndY.current;
    const deltaX = touchStartX.current - touchEndX.current;

    // Determine if swipe is more horizontal or vertical
    const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);

    // Horizontal swipe for genre switching (when multi-genre enabled)
    if (isHorizontalSwipe && Math.abs(deltaX) >= swipeThreshold && multiGenreEnabled && genres.length > 1) {
      if (deltaX > 0 && hasNextGenre) {
        // Swipe left = next genre
        nextGenre();
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate(30);
      } else if (deltaX < 0 && hasPrevGenre) {
        // Swipe right = previous genre
        prevGenre();
        if (navigator.vibrate) navigator.vibrate(30);
      }
      return;
    }

    // Vertical swipe for clip navigation
    if (!isHorizontalSwipe && Math.abs(deltaY) >= swipeThreshold) {
      if (deltaY > 0) handleNext();
      else handlePrevious();
    }
  };

  const handleNext = useCallback(() => {
    if (!votingData?.clips?.length) return;
    setVideoError(false);

    // Load more clips when approaching the end (3 clips before last)
    const nextIndex = (activeIndex + 1) % votingData.clips.length;
    const clipsRemaining = votingData.clips.length - nextIndex;
    if (clipsRemaining <= 3 && votingData.hasMoreClips) {
      loadMoreClips();
    }

    setActiveIndex(nextIndex);
  }, [votingData?.clips, votingData?.hasMoreClips, activeIndex, loadMoreClips]);

  const handlePrevious = useCallback(() => {
    if (!votingData?.clips?.length) return;
    setVideoError(false);
    setActiveIndex((prev) => (prev === 0 ? votingData.clips.length - 1 : prev - 1));
  }, [votingData?.clips]);

  // Keyboard navigation for desktop users
  // Up/Down = clips within genre, Left/Right = switch genres (when multi-genre enabled)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        // Vertical: Navigate clips
        case 'ArrowUp':
          e.preventDefault();
          handlePrevious();
          break;
        case 'ArrowDown':
          e.preventDefault();
          handleNext();
          break;

        // Horizontal: Navigate genres (when enabled) or clips (fallback)
        case 'ArrowLeft':
          e.preventDefault();
          if (multiGenreEnabled && hasPrevGenre) {
            prevGenre();
          } else {
            handlePrevious();
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (multiGenreEnabled && hasNextGenre) {
            nextGenre();
          } else {
            handleNext();
          }
          break;

        // Spacebar: Play/Pause
        case ' ':
          e.preventDefault();
          if (videoRef.current) {
            if (videoRef.current.paused) {
              videoRef.current.play();
              setIsPaused(false);
            } else {
              videoRef.current.pause();
              setIsPaused(true);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrevious, multiGenreEnabled, hasPrevGenre, hasNextGenre, prevGenre, nextGenre]);

  // Handle vote - if already voted, revoke (unless multi-vote mode); otherwise cast new vote
  const handleVote = async () => {
    if (!currentClip || isVoting) return;

    // If already voted on this clip and multi-vote mode is OFF, revoke the vote
    // When multi-vote mode is ON, allow voting again (no revoke)
    if (currentClip.has_voted && !multiVoteMode) {
      revokeMutation.mutate({ clipId: currentClip.clip_id });
      return;
    }

    // Check daily limit for new votes
    if (votesToday >= DAILY_GOAL) {
      toast.error('Daily limit reached! Come back tomorrow 🚀');
      return;
    }

    // Execute CAPTCHA if required
    let captchaToken: string | null = null;
    if (captchaRequired && captchaConfigured) {
      try {
        captchaToken = await executeCaptcha();
        if (!captchaToken) {
          toast.error('Verification required. Please try again.');
          return;
        }
      } catch {
        toast.error('Verification failed. Please try again.');
        return;
      }
    }

    voteMutation.mutate({ clipId: currentClip.clip_id, captchaToken });

    // Reset CAPTCHA for next vote
    resetCaptcha();
  };

  // Handle revoke vote separately (for explicit revoke action)
  const _handleRevokeVote = () => {
    if (!currentClip || isVoting || !currentClip.has_voted) return;
    revokeMutation.mutate({ clipId: currentClip.clip_id });
  };

  const handleVideoTap = (e?: React.MouseEvent | React.TouchEvent) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;

    // Get tap position (center of screen if no event)
    let tapX = window.innerWidth / 2;
    let tapY = window.innerHeight / 2;
    if (e && 'touches' in e && e.touches.length > 0) {
      tapX = e.touches[0].clientX;
      tapY = e.touches[0].clientY;
    } else if (e && 'clientX' in e) {
      tapX = e.clientX;
      tapY = e.clientY;
    }

    // Check for double-tap
    if (now - lastTapTime < DOUBLE_TAP_DELAY) {
      // Double-tap detected - vote!
      setLastTapTime(0);

      // Allow voting if: not voted yet, OR multi-vote mode is ON
      const canVote = (!currentClip?.has_voted || multiVoteMode) && votesToday < DAILY_GOAL && !isVoting;

      if (canVote) {
        // Show heart animation at tap position
        setDoubleTapPosition({ x: tapX, y: tapY });
        setShowHeartAnimation(true);

        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate([50, 30, 50]);

        // Trigger vote
        handleVote();

        // Hide heart after animation (BUG 3 FIX: store timeout for cleanup)
        heartTimeoutRef.current = setTimeout(() => {
          setShowHeartAnimation(false);
          setDoubleTapPosition(null);
        }, 1000);
      } else if (currentClip?.has_voted && !multiVoteMode) {
        // Already voted and multi-vote is OFF - show feedback
        toast('Already voted!', { icon: '❤️' });
      }
      return;
    }

    // Single tap - set timer to toggle play/pause
    setLastTapTime(now);

    // Use timeout to wait for potential second tap (BUG 3 FIX: store timeout for cleanup)
    tapTimeoutRef.current = setTimeout(() => {
      // Only pause/play if this was a single tap (no double tap occurred)
      if (Date.now() - now >= DOUBLE_TAP_DELAY - 20) {
        if (!videoRef.current) return;
        // FIX: Use ref instead of state to avoid stale closure in setTimeout
        if (isPausedRef.current) {
          videoRef.current.play();
          setIsPaused(false);
        } else {
          videoRef.current.pause();
          setIsPaused(true);
        }
      }
    }, DOUBLE_TAP_DELAY);
  };

  const handleShare = async () => {
    // FIX: Validate clip_id to prevent open redirect / URL injection attacks
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const clipId = currentClip?.clip_id;

    if (!clipId || !UUID_REGEX.test(clipId)) {
      toast.error('Invalid clip ID');
      return;
    }

    // Use URL constructor to safely build the share URL
    const shareUrl = new URL(`/clip/${encodeURIComponent(clipId)}`, window.location.origin).href;

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

  // Handler for when a comment is added - update comment count optimistically
  const handleCommentAdded = useCallback(() => {
    if (!currentClip?.clip_id) return;

    const previous = queryClient.getQueryData<VotingState>(['voting', 'track-main', genreParam]);
    if (previous) {
      queryClient.setQueryData<VotingState>(['voting', 'track-main', genreParam], {
        ...previous,
        clips: previous.clips.map((clip) =>
          clip.clip_id === currentClip.clip_id
            ? { ...clip, comment_count: (clip.comment_count ?? 0) + 1 }
            : clip
        ),
      });
    }
  }, [currentClip?.clip_id, queryClient, genreParam]);

  // Loading state with skeleton - improved with gradient background
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#050510] via-[#0a0a18] to-[#050510] flex flex-col">
        {/* Skeleton Header */}
        <div className="flex items-center justify-between p-4">
          <div className="h-6 w-32 bg-white/10 rounded animate-pulse" />
          <div className="h-8 w-8 bg-white/10 rounded-full animate-pulse" />
        </div>

        {/* Skeleton Video */}
        <div className="flex-1 relative mx-4 mb-4">
          <div className="w-full h-full min-h-[60vh] bg-gradient-to-br from-white/5 to-white/10 rounded-2xl animate-pulse flex items-center justify-center border border-white/10">
            <div className="w-16 h-16 rounded-full bg-white/10 animate-pulse" />
          </div>

          {/* Skeleton Right Controls */}
          <div className="absolute right-2 sm:right-3 bottom-28 sm:bottom-32 flex flex-col gap-3 sm:gap-4">
            <div className="w-12 h-12 bg-white/10 rounded-full animate-pulse" />
            <div className="w-12 h-12 bg-white/10 rounded-full animate-pulse" />
            <div className="w-12 h-12 bg-white/10 rounded-full animate-pulse" />
          </div>

          {/* Skeleton Creator Info */}
          <div className="absolute bottom-4 left-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 rounded-full animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 w-24 bg-white/10 rounded animate-pulse" />
              <div className="h-3 w-16 bg-white/10 rounded animate-pulse" />
            </div>
          </div>
        </div>

        {/* Skeleton Bottom Nav */}
        <div className="h-16 border-t border-white/10 flex items-center justify-around px-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="w-6 h-6 bg-white/10 rounded animate-pulse" />
              <div className="w-10 h-2 bg-white/10 rounded animate-pulse" />
            </div>
          ))}
        </div>
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

  // Empty state - check if season ended, no season, waiting for uploads, or just no clips
  if (!votingData?.clips?.length) {
    const seasonEnded = votingData?.seasonStatus === 'finished';
    const noSeason = votingData?.seasonStatus === 'none';
    const seasonName = votingData?.finishedSeasonName;
    // Check if slot is explicitly waiting for clips (new status)
    const isWaitingForClips = votingData?.waitingForClips === true;
    // Timer hasn't started = waiting for first clip upload
    const waitingForUploads = isWaitingForClips || ((votingData?.currentSlot ?? 0) > 0 && !votingData?.votingStartedAt);

    return (
      <div
        className="relative min-h-screen min-h-[100dvh] w-full overflow-hidden bg-black"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile genre switcher - shown when multi-genre enabled */}
        {!isDesktop && multiGenreEnabled && genres.length > 1 && (
          <div className="absolute top-0 left-0 right-0 z-40">
            <GenreHeader
              genres={genres}
              currentIndex={genreIndex}
              onSelectIndex={goToGenre}
            />
          </div>
        )}

        {/* Desktop Sidebar - Navigation + Genres (same as main layout) */}
        {isDesktop && !isLandscape && (
          <div className="absolute left-0 top-0 bottom-0 w-56 flex flex-col py-4 px-3 z-40" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
            <nav className="flex-1 space-y-1 mt-40">
              <Link href="/dashboard">
                <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-cyan-500/30">
                  <Play className="w-6 h-6 text-cyan-400" />
                  <span className="font-semibold">Vote Now</span>
                </div>
              </Link>
              <Link href="/story">
                <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-black/30 text-white/90 transition">
                  <BookOpen className="w-6 h-6" />
                  <span>Story</span>
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
            </nav>

            {/* Genre List at Bottom (only when multi-genre enabled) */}
            {multiGenreEnabled && genres.length > 0 && (
              <div className="border-t border-white/20 pt-4 mt-4">
                <p className="text-white/70 text-xs font-medium px-3 mb-2">GENRES</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {genres.map((genre, index) => (
                    <button
                      key={genre.id}
                      onClick={() => goToGenre(index)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition outline-none ${
                        index === genreIndex
                          ? 'bg-black/30 backdrop-blur-sm text-white border border-white/10'
                          : 'hover:bg-black/20 text-white/80'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-sm">{genre.emoji} {genre.label}</span>
                      <span className="text-[10px] text-red-400 font-bold ml-auto">LIVE</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty state content - centered, offset for sidebar on desktop */}
        <div className={`min-h-screen flex items-center justify-center p-6 ${isDesktop && !isLandscape ? 'ml-56' : ''}`}>
          <div className="text-center">
            {seasonEnded ? (
            <>
              <div className="text-5xl mb-4">🏆</div>
              <h2 className="text-white text-xl font-bold mb-2">
                {seasonName || 'Season'} Complete!
              </h2>
              <p className="text-white/60 mb-6">
                Thanks for voting! Check out the winning clips on the Story page.
                <br />
                <span className="text-cyan-400">New season coming soon!</span>
              </p>
              <div className="flex flex-col gap-3">
                <Link
                  href="/story"
                  className="px-6 py-3 rounded-full bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7] text-white font-semibold inline-block"
                >
                  Watch the Story
                </Link>
                <Link
                  href="/leaderboard"
                  className="px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white inline-block"
                >
                  View Leaderboard
                </Link>
              </div>
            </>
          ) : noSeason ? (
            <>
              <div className="text-5xl mb-4">🎬</div>
              <h2 className="text-white text-xl font-bold mb-2">
                New Season Coming Soon
              </h2>
              <p className="text-white/60 mb-6">
                We&apos;re preparing the next season.
                <br />
                Check back soon for new voting!
              </p>
              <div className="flex flex-col gap-3">
                <Link
                  href="/story"
                  className="px-6 py-3 rounded-full bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7] text-white font-semibold inline-block"
                >
                  Watch Previous Stories
                </Link>
                <Link
                  href="/leaderboard"
                  className="px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white inline-block"
                >
                  View Leaderboard
                </Link>
              </div>
            </>
          ) : waitingForUploads ? (
            <>
              <div className="text-5xl mb-4">⏳</div>
              <h2 className="text-white text-xl font-bold mb-2">
                Waiting for Uploads
              </h2>
              <p className="text-white/60 mb-6">
                Voting starts when the first clip is uploaded.
                <br />
                Be the first to upload!
              </p>
              <div className="flex flex-col gap-3">
                <Link
                  href="/upload"
                  className="px-6 py-3 rounded-full bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7] text-white font-semibold inline-block"
                >
                  Upload a Clip
                </Link>
                <Link
                  href="/story"
                  className="px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white inline-block"
                >
                  Watch the Story
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="text-5xl mb-4">📢</div>
              <h2 className="text-white text-xl font-bold mb-2">
                Need More Clips!
              </h2>
              <p className="text-white/60 mb-6">
                Slot {votingData?.currentSlot || 1} is waiting for clips.
                <br />
                <span className="text-cyan-400">Upload yours and start the competition!</span>
              </p>
              <div className="flex flex-col gap-3">
                <Link
                  href="/upload"
                  className="px-6 py-3 rounded-full bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7] text-white font-semibold inline-block"
                >
                  Upload a Clip
                </Link>
                <Link
                  href="/story"
                  className="px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white inline-block"
                >
                  Watch the Story
                </Link>
              </div>
            </>
            )}
          </div>
        </div>

        {/* Bottom Navigation - mobile only */}
        {!isDesktop && !isLandscape && <BottomNavigation />}
      </div>
    );
  }

 const genreLabel = currentClip?.genre 
  ? (GENRE_LABELS[currentClip.genre.toUpperCase() as keyof typeof GENRE_LABELS] || currentClip.genre)
  : '';

  return (
    <div
      className={`relative min-h-screen min-h-[100dvh] w-full overflow-hidden bg-black ${isLandscape ? 'video-landscape-mode' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={isLandscape ? handleScreenTap : undefined}
    >
      {/* Mobile genre switcher - shown when multi-genre enabled */}
      {!isDesktop && !isLandscape && multiGenreEnabled && genres.length > 1 && (
        <div className="absolute top-0 left-0 right-0 z-40">
          <GenreHeader
            genres={genres}
            currentIndex={genreIndex}
            onSelectIndex={goToGenre}
          />
        </div>
      )}

      {/* Desktop Sidebar - Navigation + Genres */}
      {isDesktop && !isLandscape && (
        <div className="absolute left-0 top-0 bottom-0 w-56 flex flex-col py-4 px-3 z-40" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
          {/* Navigation Items */}
          <nav className="flex-1 space-y-1 mt-40">
            <Link href="/dashboard">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-cyan-500/30">
                <Play className="w-6 h-6 text-cyan-400" />
                <span className="font-semibold">Vote Now</span>
              </div>
            </Link>
            <Link href="/story">
              <div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-black/30 text-white/90 transition">
                <BookOpen className="w-6 h-6" />
                <span>Story</span>
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
          </nav>

          {/* Genre List at Bottom (only when multi-genre enabled) */}
          {multiGenreEnabled && genres.length > 0 && (
            <div className="border-t border-white/20 pt-4 mt-4">
              <p className="text-white/70 text-xs font-medium px-3 mb-2">GENRES</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {genres.map((genre, index) => (
                  <button
                    key={genre.id}
                    onClick={() => goToGenre(index)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition outline-none ${
                      index === genreIndex
                        ? 'bg-black/30 backdrop-blur-sm text-white border border-white/10'
                        : 'hover:bg-black/20 text-white/80'
                    }`}
                  >
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-sm">{genre.emoji} {genre.label}</span>
                    <span className="text-[10px] text-red-400 font-bold ml-auto">LIVE</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PWA Install Banner - shows at top when not installed */}
      {!isLandscape && <InstallPrompt variant="banner" />}

      {/* Invisible CAPTCHA widget (renders nothing visible) */}
      {captchaConfigured && <CaptchaWidget />}

      {/* Pull-to-refresh indicator */}
      <AnimatePresence>
        {pullDistance > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="absolute top-0 left-0 right-0 z-50 flex justify-center pt-4"
            style={{ transform: `translateY(${pullDistance}px)` }}
          >
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full ${
              pullDistance >= PULL_THRESHOLD ? 'bg-cyan-500' : 'bg-white/20'
            } backdrop-blur-sm transition-colors`}>
              <motion.div
                animate={{ rotate: isRefreshing ? 360 : 0 }}
                transition={{ duration: 1, repeat: isRefreshing ? Infinity : 0, ease: 'linear' }}
              >
                {isRefreshing ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
              </motion.div>
              <span className="text-white text-sm font-medium">
                {isRefreshing ? 'Refreshing...' : pullDistance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Double-tap heart animation */}
      <AnimatePresence>
        {showHeartAnimation && doubleTapPosition && (
          <motion.div
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: [0, 1.5, 1], opacity: [1, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="fixed z-50 pointer-events-none"
            style={{
              left: doubleTapPosition.x - 50,
              top: doubleTapPosition.y - 50,
            }}
          >
            <svg aria-hidden="true" width="100" height="100" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                fill="url(#heartGradient)"
              />
              <defs>
                <linearGradient id="heartGradient" x1="2" y1="3" x2="22" y2="21">
                  <stop offset="0%" stopColor="#FF00C7" />
                  <stop offset="50%" stopColor="#A020F0" />
                  <stop offset="100%" stopColor="#3CF2FF" />
                </linearGradient>
              </defs>
            </svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Onboarding Tour - Modal (old) or Spotlight (new) based on feature flag */}
      {showTour && (
        useSpotlightTourFlag ? (
          <SpotlightTour onComplete={completeTour} onSkip={skipTour} />
        ) : (
          <OnboardingTour onComplete={completeTour} onSkip={skipTour} />
        )
      )}

      {/* ============ VIDEO ============ */}
      {/* Desktop: Full screen. Mobile: Full screen with blur background */}
      <div className="absolute inset-0" data-tour="video-area">
        <div
          className="relative w-full h-full overflow-hidden"
          onClick={handleVideoTap}
          onKeyDown={(e) => {
            if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              handleVideoTap();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={currentClip ? `Video by ${currentClip.username}. Press space to play or pause` : 'Video player'}
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
            {/* Blurred background - static thumbnail fills empty space around non-matching aspect ratios */}
            {currentClip.thumbnail_url ? (
              <img
                src={currentClip.thumbnail_url}
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
            {/* Main video - full video visible, blur background fills empty space */}
            <video
              ref={videoRef}
              key={currentClip.clip_id}
              src={currentClip.video_url ?? '/placeholder-video.mp4'}
              poster={currentClip?.thumbnail_url}
              className="relative w-full h-full object-contain [&::-webkit-media-controls]:hidden [&::-webkit-media-controls-enclosure]:hidden [&::-webkit-media-controls-panel]:hidden [&::-webkit-media-controls-start-playback-button]:hidden"
              style={{ WebkitAppearance: 'none' } as React.CSSProperties}
              autoPlay
              loop
              muted={isMuted}
              playsInline
              webkit-playsinline="true"
              x5-playsinline="true"
              disablePictureInPicture
              controlsList="nodownload nofullscreen noremoteplayback"
              preload="auto"
              onError={() => setVideoError(true)}
              onCanPlay={(e) => {
                const video = e.currentTarget;
                if (video.paused) {
                  video.play().catch(() => {
                    video.muted = true;
                    video.play().catch(() => {});
                  });
                }
              }}
            />
          </>
        ) : null}
        </div>
      </div>


      {/* ============ HELP BUTTON (Top Right Corner, hidden in landscape) ============ */}
      {!isLandscape && (
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={resetTour}
          className="absolute top-2 right-3 z-50 p-2 rounded-full bg-black/40 backdrop-blur-sm border border-white/20"
          aria-label="Show tutorial"
        >
          <HelpCircle className="w-5 h-5 text-white/70" aria-hidden="true" />
        </motion.button>
      )}


      {/* ============ ROUND INFO - Top of screen, above MiniLeaderboard (hidden in landscape) ============ */}
      {votingData && !isLandscape && (
        <div className="absolute top-2 left-0 right-0 z-40 flex justify-center">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-4 py-1.5"
          >
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-white text-sm font-bold tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              Round {votingData.currentSlot}/{votingData.totalSlots}
            </span>
            <span className="text-cyan-400 text-sm font-bold uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              {currentClip?.genre || 'Mixed'}
            </span>
          </motion.div>
        </div>
      )}

      {/* ============ RIGHT COLUMN (hidden in landscape) ============ */}
      <div className={`absolute right-2 sm:right-3 bottom-28 sm:bottom-32 z-20 flex flex-col items-center gap-3 sm:gap-4 ${isLandscape ? 'hidden' : ''}`}>
        {/* Creator Avatar */}
        <Link href={`/profile/${currentClip?.username}`}>
          <motion.div whileTap={{ scale: 0.9 }} className="relative">
            <Image
              src={currentClip?.avatar_url || 'https://api.dicebear.com/7.x/identicon/svg?seed=default'}
              alt={currentClip?.username ? `${currentClip.username}'s avatar` : 'Creator avatar'}
              width={48}
              height={48}
              className="w-12 h-12 rounded-full border-2 border-white/80 object-cover"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
              unoptimized={currentClip?.avatar_url?.includes('dicebear')}
            />
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center border-2 border-black">
              <span className="text-white text-[10px] font-bold">+</span>
            </div>
          </motion.div>
        </Link>

        {/* Vote Button */}
        <div className="flex flex-col items-center gap-1" data-tour="vote-button">
          <PowerVoteButton
            onVote={handleVote}
            isVoting={isVoting}
            isDisabled={votesToday >= DAILY_GOAL}
            hasVoted={currentClip?.has_voted ?? false}
            votesToday={votesToday}
            dailyGoal={DAILY_GOAL}
            showDailyProgress={showVoteProgress}
          />
          {/* Vote Count - FIX: Added aria-live for screen reader accessibility */}
          <span
            className="text-white text-xs font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]"
            aria-live="polite"
            aria-atomic="true"
          >
            {formatNumber(currentClip?.vote_count ?? 0)}
          </span>
        </div>

        {/* Comments */}
        <ActionButton
          icon={<MessageCircle className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />}
          label={formatNumber(currentClip?.comment_count ?? 0)}
          onClick={() => setShowComments(true)}
          ariaLabel="Open comments"
        />

        {/* Share */}
        <ActionButton
          icon={<Share2 className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />}
          onClick={handleShare}
          ariaLabel="Share this clip"
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
          ariaLabel={isMuted ? "Unmute video" : "Mute video"}
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

      {/* ============ BOTTOM: Creator Info (hidden in landscape) ============ */}
      <div className={`absolute bottom-24 left-0 right-16 z-20 px-4 ${isLandscape ? 'hidden' : ''}`}>
        <div className="flex items-center gap-2">
          <p className="text-white font-semibold text-sm drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            @{currentClip?.username || 'creator'}
          </p>
          <span className="text-white/60">·</span>
          <p className="text-white/80 text-sm drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">{genreLabel}</p>
        </div>
      </div>

      {/* ============ NAVIGATION ARROWS - LEFT SIDE (hidden in landscape) ============ */}
      {votingData?.clips && votingData.clips.length > 1 && !isLandscape && (
        <div className="absolute left-3 md:left-8 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-4 md:gap-6" data-tour="nav-arrows">
          {/* Previous Clip Arrow */}
          <motion.button
            whileHover={{ scale: 1.1, backgroundColor: 'rgba(255,255,255,0.25)' }}
            whileTap={{ scale: 0.9 }}
            onClick={handlePrevious}
            className={`w-10 h-10 md:w-14 md:h-14 rounded-full bg-white/10 backdrop-blur-md
                     border border-white/20 flex items-center justify-center
                     transition-all shadow-lg ${activeIndex === 0 ? 'opacity-30' : 'opacity-100'}`}
            type="button"
            aria-label="Previous clip"
            disabled={activeIndex === 0}
          >
            <svg className="w-5 h-5 md:w-7 md:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
            aria-label="Next clip"
            disabled={activeIndex >= votingData.clips.length - 1}
          >
            <svg className="w-5 h-5 md:w-7 md:h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </motion.button>
        </div>
      )}


      {/* ============ COMMENTS PANEL ============ */}
      <CommentsSection
        clipId={currentClip?.clip_id || ''}
        isOpen={showComments}
        onClose={() => setShowComments(false)}
        clipUsername={currentClip?.username}
        onCommentAdded={handleCommentAdded}
      />

      {/* ============ BOTTOM NAV (hidden in landscape and on desktop) ============ */}
      {!isLandscape && !isDesktop && <BottomNavigation />}

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
          {/* Vote button - right side */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleVote();
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-14 h-14 bg-gradient-to-br from-cyan-500 to-purple-500 rounded-full flex items-center justify-center shadow-lg"
          >
            <svg aria-hidden="true" className="w-7 h-7" viewBox="0 0 24 24" fill="white">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </button>
          {/* Rotate hint - bottom center */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/50 backdrop-blur-md rounded-full text-white/60 text-sm">
            Rotate to exit fullscreen
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PAGE WRAPPER
// ============================================================================

export default function DashboardPage() {
  return (
    <AuthGuard>
      <VotingArena />
    </AuthGuard>
  );
}