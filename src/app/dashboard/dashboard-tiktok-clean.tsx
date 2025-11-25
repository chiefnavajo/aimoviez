'use client';

// ============================================================================
// VOTING ARENA - CLEAN TIKTOK STYLE
// ============================================================================
// Maximum video visibility with minimal UI:
// ✅ Thin outline vote button with ∞ (transparent center)
// ✅ Right column action buttons (TikTok style)
// ✅ Minimal slot indicator (top-left)
// ✅ Simple text progress "64/200 today"
// ✅ Single line creator info "@username · Genre"
// ✅ Swipe to skip (no skip button)
// ✅ ~85% video visibility
// ============================================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import Pusher from 'pusher-js';
import confetti from 'canvas-confetti';
import { toast, Toaster } from 'react-hot-toast';
import Link from 'next/link';
import { MessageCircle, Share2, X, Heart } from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

type VoteType = 'standard' | 'super' | 'mega';

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
}

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
}

interface VoteResponse {
  success: boolean;
  error?: string;
  newScore?: number;
  totalVotesToday?: number;
  remainingVotes?: number;
  voteType?: VoteType;
}

interface Comment {
  id: string;
  user: {
    username: string;
    avatar_url: string;
  };
  text: string;
  timestamp: Date;
  likes: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DAILY_GOAL = 200;

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
// INFINITY VOTE BUTTON (Thin Outline Style)
// ============================================================================

interface InfinityVoteButtonProps {
  onVote: () => void;
  isVoting: boolean;
  isDisabled: boolean;
}

function InfinityVoteButton({ onVote, isVoting, isDisabled }: InfinityVoteButtonProps) {
  return (
    <motion.button
      onClick={onVote}
      disabled={isVoting || isDisabled}
      whileTap={{ scale: 0.9 }}
      className="relative w-20 h-20 flex items-center justify-center"
    >
      {/* Outer glow effect */}
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{
          boxShadow: isDisabled
            ? '0 0 0px rgba(100, 100, 100, 0)'
            : [
                '0 0 20px rgba(56, 189, 248, 0.3), 0 0 40px rgba(168, 85, 247, 0.2)',
                '0 0 30px rgba(56, 189, 248, 0.5), 0 0 60px rgba(168, 85, 247, 0.3)',
                '0 0 20px rgba(56, 189, 248, 0.3), 0 0 40px rgba(168, 85, 247, 0.2)',
              ],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Thin gradient outline circle */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 80 80"
      >
        <defs>
          <linearGradient id="voteGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3CF2FF" />
            <stop offset="50%" stopColor="#A020F0" />
            <stop offset="100%" stopColor="#FF00C7" />
          </linearGradient>
          <linearGradient id="disabledGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#666" />
            <stop offset="100%" stopColor="#444" />
          </linearGradient>
        </defs>
        <circle
          cx="40"
          cy="40"
          r="37"
          fill="none"
          stroke={isDisabled ? 'url(#disabledGradient)' : 'url(#voteGradient)'}
          strokeWidth="3"
        />
      </svg>

      {/* Infinity sign */}
      {isVoting ? (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="text-2xl"
        >
          ⚡
        </motion.div>
      ) : isDisabled ? (
        <span className="text-gray-500 text-2xl">✓</span>
      ) : (
        <motion.span
          className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7]"
          animate={{
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          style={{
            filter: 'drop-shadow(0 0 10px rgba(56, 189, 248, 0.5))',
          }}
        >
          ∞
        </motion.span>
      )}
    </motion.button>
  );
}

// ============================================================================
// SMALL INFINITY FOR NAV
// ============================================================================

const InfinitySmall = () => (
  <motion.span
    className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7]"
    animate={{ scale: [1, 1.1, 1] }}
    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
  >
    ∞
  </motion.span>
);

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
      <div className="w-12 h-12 rounded-full bg-black/20 backdrop-blur-sm border border-white/10 flex items-center justify-center">
        {icon}
      </div>
      {label !== undefined && (
        <span className="text-white text-xs font-medium">{label}</span>
      )}
    </motion.button>
  );
}

// ============================================================================
// MOCK COMMENTS
// ============================================================================

function useMockComments(clipId?: string) {
  const [comments, setComments] = useState<Comment[]>([]);

  useEffect(() => {
    if (!clipId) return;
    setComments([
      {
        id: '1',
        user: { username: 'neon_dream', avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=neon' },
        text: 'This is absolutely insane! 🔥',
        timestamp: new Date(),
        likes: 24,
      },
      {
        id: '2',
        user: { username: 'movie_buff', avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=movie' },
        text: 'Perfect transition 👏',
        timestamp: new Date(),
        likes: 18,
      },
      {
        id: '3',
        user: { username: 'creator_vibes', avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=creator' },
        text: 'This needs to win!',
        timestamp: new Date(),
        likes: 12,
      },
    ]);
  }, [clipId]);

  return { comments, setComments };
}

// ============================================================================
// MAIN VOTING ARENA
// ============================================================================

function VotingArena() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isVoting, setIsVoting] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(true);

  const queryClient = useQueryClient();

  // Swipe handling
  const touchStartY = useRef<number>(0);
  const touchEndY = useRef<number>(0);
  const swipeThreshold = 50;

  // Fetch voting data
  const { data: votingData, isLoading, error, refetch } = useQuery<VotingState>({
    queryKey: ['voting', 'track-main'],
    queryFn: async () => {
      const res = await fetch('/api/vote?trackId=track-main');
      if (!res.ok) throw new Error('Failed to fetch clips');
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 5000,
    retry: 3,
  });

  const votesToday = votingData?.totalVotesToday ?? 0;
  const currentClip = votingData?.clips?.[activeIndex];
  const { comments } = useMockComments(currentClip?.clip_id);

  // Hide swipe hint after first interaction
  useEffect(() => {
    if (activeIndex > 0) setShowSwipeHint(false);
  }, [activeIndex]);

  // Vote mutation
  const voteMutation = useMutation<VoteResponse, Error, { clipId: string }>({
    mutationFn: async ({ clipId }) => {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId, voteType: 'standard' }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to vote');
      }
      return res.json();
    },
    onMutate: async ({ clipId }) => {
      setIsVoting(true);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(50);
      }

      await queryClient.cancelQueries({ queryKey: ['voting', 'track-main'] });
      const previous = queryClient.getQueryData<VotingState>(['voting', 'track-main']);

      if (previous) {
        queryClient.setQueryData<VotingState>(['voting', 'track-main'], {
          ...previous,
          clips: previous.clips.map((clip) =>
            clip.clip_id === clipId ? { ...clip, vote_count: clip.vote_count + 1 } : clip
          ),
          totalVotesToday: (previous.totalVotesToday ?? 0) + 1,
        });
      }

      return { previous };
    },
    onError: (error, _variables, context: any) => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }
      if (context?.previous) {
        queryClient.setQueryData(['voting', 'track-main'], context.previous);
      }
      toast.error(error.message);
      setIsVoting(false);
    },
    onSuccess: () => {
      // Celebration on milestones
      if (votesToday === 0 || votesToday === 49 || votesToday === 99 || votesToday === 199) {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.7 } });
      }
      setIsVoting(false);
      handleNext();
    },
  });

  // Pusher real-time
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_PUSHER_KEY || !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) return;

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    });

    const channel = pusher.subscribe('voting-track-main');
    channel.bind('vote-update', (data: any) => {
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

  // Touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (showComments) return;
    touchStartY.current = e.touches[0].clientY;
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

  const handleVote = () => {
    if (!currentClip || isVoting) return;
    if (votesToday >= DAILY_GOAL) {
      toast.error('Daily limit reached! Come back tomorrow 🚀');
      return;
    }
    voteMutation.mutate({ clipId: currentClip.clip_id });
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Check out this clip on AiMoviez!',
          url: window.location.href,
        });
      } catch (e) {
        // User cancelled
      }
    } else {
      toast.success('Link copied!');
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        >
          <span className="text-6xl">∞</span>
        </motion.div>
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
          <Link href="/story" className="px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white">
            Back to Story
          </Link>
        </div>
      </div>
    );
  }

  const genreLabel = currentClip?.genre ? (GENRE_LABELS[currentClip.genre.toUpperCase() as keyof typeof GENRE_LABELS] || currentClip.genre) : '';

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
        >
          {videoError ? (
            <div className="w-full h-full flex items-center justify-center bg-black">
              <div className="text-center">
                <div className="text-5xl mb-4">🎬</div>
                <p className="text-white/60">Video unavailable</p>
              </div>
            </div>
          ) : currentClip ? (
            <video
              key={currentClip.clip_id}
              src={currentClip.video_url ?? '/placeholder-video.mp4'}
              poster={currentClip.thumbnail_url}
              className="w-full h-full object-cover"
              autoPlay
              loop
              muted
              playsInline
              onError={() => setVideoError(true)}
            />
          ) : null}
        </motion.div>
      </AnimatePresence>

      {/* ============ TOP: Slot Indicator (Minimal) ============ */}
      <div className="absolute top-4 left-4 z-20">
        <div className="px-3 py-1.5 rounded-full bg-black/30 backdrop-blur-sm border border-white/10">
          <span className="text-white/80 text-sm font-medium">
            {currentClip?.round_number ?? 1}/{currentClip?.total_rounds ?? 75}
          </span>
        </div>
      </div>

      {/* ============ RIGHT COLUMN: Actions (TikTok Style) ============ */}
      <div className="absolute right-3 bottom-48 z-20 flex flex-col items-center gap-5">
        {/* Creator Avatar */}
        <Link href={`/profile/${currentClip?.user_id}`}>
          <motion.div whileTap={{ scale: 0.9 }} className="relative">
            <img
              src={currentClip?.avatar_url || 'https://api.dicebear.com/7.x/identicon/svg?seed=default'}
              alt=""
              className="w-12 h-12 rounded-full border-2 border-white object-cover"
            />
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center">
              <span className="text-white text-xs">+</span>
            </div>
          </motion.div>
        </Link>

        {/* Vote Count */}
        <ActionButton
          icon={<span className="text-lg">🔥</span>}
          label={currentClip?.vote_count?.toLocaleString() ?? 0}
        />

        {/* Comments */}
        <ActionButton
          icon={<MessageCircle className="w-6 h-6 text-white" />}
          label={comments.length}
          onClick={() => setShowComments(true)}
        />

        {/* Share */}
        <ActionButton
          icon={<Share2 className="w-6 h-6 text-white" />}
          onClick={handleShare}
        />
      </div>

      {/* ============ BOTTOM LEFT: Creator Info (Single Line) ============ */}
      <div className="absolute left-4 bottom-44 z-20">
        <p className="text-white font-semibold text-base">
          @{currentClip?.username || 'creator'}
        </p>
        <p className="text-white/60 text-sm">
          {genreLabel}
        </p>
      </div>

      {/* ============ CENTER BOTTOM: Vote Button + Progress ============ */}
      <div className="absolute bottom-24 left-0 right-0 z-30 flex flex-col items-center">
        {/* Swipe Hint (shows only initially) */}
        <AnimatePresence>
          {showSwipeHint && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-4 px-4 py-2 rounded-full bg-black/40 backdrop-blur-sm border border-white/10"
            >
              <p className="text-white/60 text-xs">Swipe ↑ to skip · Tap ∞ to vote</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Vote Button */}
        <InfinityVoteButton
          onVote={handleVote}
          isVoting={isVoting}
          isDisabled={votesToday >= DAILY_GOAL}
        />

        {/* Progress Text */}
        <p className="mt-2 text-white/50 text-sm">
          {votesToday}/{DAILY_GOAL} today
        </p>
      </div>

      {/* ============ COMMENTS PANEL ============ */}
      <AnimatePresence>
        {showComments && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30 }}
            className="absolute bottom-0 left-0 right-0 h-2/3 bg-black/95 backdrop-blur-lg z-50 rounded-t-3xl border-t border-white/10"
          >
            <div className="p-4">
              {/* Handle */}
              <div className="w-10 h-1 rounded-full bg-white/30 mx-auto mb-4" />

              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold">{comments.length} Comments</h3>
                <button onClick={() => setShowComments(false)}>
                  <X className="w-6 h-6 text-white/60" />
                </button>
              </div>

              {/* Comments List */}
              <div className="space-y-4 overflow-y-auto max-h-[50vh]">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <img
                      src={comment.user.avatar_url}
                      alt=""
                      className="w-9 h-9 rounded-full"
                    />
                    <div className="flex-1">
                      <p className="text-white text-sm font-semibold">{comment.user.username}</p>
                      <p className="text-white/80 text-sm">{comment.text}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-white/40 text-xs">2h</span>
                        <button className="flex items-center gap-1 text-white/40 text-xs">
                          <Heart className="w-3 h-3" /> {comment.likes}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Comment Input */}
              <div className="absolute bottom-4 left-4 right-4">
                <div className="flex gap-2 p-2 rounded-full bg-white/10 border border-white/10">
                  <input
                    type="text"
                    placeholder="Add a comment..."
                    className="flex-1 bg-transparent text-white text-sm px-3 outline-none"
                  />
                  <button className="px-4 py-2 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 text-white text-sm font-semibold">
                    Post
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ BOTTOM NAV ============ */}
      <div className="absolute bottom-0 left-0 right-0 z-40">
        <div className="bg-black/80 backdrop-blur-lg border-t border-white/10">
          <div className="flex items-center justify-around px-6 py-3">
            {/* Story */}
            <Link href="/story">
              <motion.div whileTap={{ scale: 0.9 }} className="flex flex-col items-center gap-0.5">
                <span className="text-xl">📖</span>
                <span className="text-white/60 text-xs">Story</span>
              </motion.div>
            </Link>

            {/* Shorts (Active) */}
            <motion.div className="relative flex flex-col items-center gap-0.5">
              <InfinitySmall />
              <motion.div
                className="absolute -bottom-1 w-6 h-1 rounded-full bg-gradient-to-r from-cyan-400 to-purple-500"
              />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-500 text-xs font-semibold">
                Shorts
              </span>
            </motion.div>

            {/* Upload */}
            <Link href="/upload">
              <motion.div whileTap={{ scale: 0.9 }} className="flex flex-col items-center gap-0.5">
                <span className="text-xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-violet-500">
                  ＋
                </span>
                <span className="text-white/60 text-xs">Upload</span>
              </motion.div>
            </Link>

            {/* Profile */}
            <Link href="/profile">
              <motion.div whileTap={{ scale: 0.9 }} className="flex flex-col items-center gap-0.5">
                <span className="text-xl text-white/70">👤</span>
                <span className="text-white/60 text-xs">Profile</span>
              </motion.div>
            </Link>
          </div>
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
    <QueryClientProvider client={queryClient}>
      <VotingArena />
    </QueryClientProvider>
  );
}