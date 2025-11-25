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
import { MessageCircle, Share2, X, Heart, BookOpen, Plus, User, Search, Volume2, VolumeX } from 'lucide-react';

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

interface MutationContext {
  previous?: VotingState;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DAILY_GOAL = 200;

// Mock clips for testing (uses Veo3 videos)
const MOCK_CLIPS: ClipForClient[] = [
  {
    id: 'mock-1',
    clip_id: 'mock-clip-1',
    thumbnail_url: '/uploads/spooky-thumbnail.jpg',
    video_url: '/uploads/Spooky_Gen_Z_App_Opener_Video.mp4',
    username: 'veo3_creator',
    avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=veo3',
    badge_level: 'gold',
    vote_count: 4521,
    weighted_score: 5200,
    rank_in_track: 1,
    genre: 'Horror',
    duration: 8,
    round_number: 6,
    total_rounds: 75,
    segment_index: 5,
    hype_score: 89,
    is_featured: true,
    is_creator_followed: false,
  },
  {
    id: 'mock-2',
    clip_id: 'mock-clip-2',
    thumbnail_url: '/uploads/ballet-thumbnail.jpg',
    video_url: '/uploads/Ballet_Studio_Jackhammer_Surprise.mp4',
    username: 'dance_master',
    avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=ballet',
    badge_level: 'silver',
    vote_count: 3847,
    weighted_score: 4100,
    rank_in_track: 2,
    genre: 'Comedy',
    duration: 8,
    round_number: 6,
    total_rounds: 75,
    segment_index: 5,
    hype_score: 76,
    is_featured: false,
    is_creator_followed: false,
  },
  {
    id: 'mock-3',
    clip_id: 'mock-clip-3',
    thumbnail_url: '/uploads/spooky-thumbnail.jpg',
    video_url: '/uploads/Spooky_Gen_Z_App_Opener_Video.mp4',
    username: 'horror_king',
    avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=horror',
    badge_level: 'bronze',
    vote_count: 2654,
    weighted_score: 3200,
    rank_in_track: 3,
    genre: 'Horror',
    duration: 8,
    round_number: 6,
    total_rounds: 75,
    segment_index: 5,
    hype_score: 65,
    is_featured: false,
    is_creator_followed: false,
  },
  {
    id: 'mock-4',
    clip_id: 'mock-clip-4',
    thumbnail_url: '/uploads/ballet-thumbnail.jpg',
    video_url: '/uploads/Ballet_Studio_Jackhammer_Surprise.mp4',
    username: 'comedy_queen',
    avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=comedy',
    badge_level: 'bronze',
    vote_count: 2201,
    weighted_score: 2800,
    rank_in_track: 4,
    genre: 'Comedy',
    duration: 8,
    round_number: 6,
    total_rounds: 75,
    segment_index: 5,
    hype_score: 58,
    is_featured: false,
    is_creator_followed: false,
  },
  {
    id: 'mock-5',
    clip_id: 'mock-clip-5',
    thumbnail_url: '/uploads/spooky-thumbnail.jpg',
    video_url: '/uploads/Spooky_Gen_Z_App_Opener_Video.mp4',
    username: 'film_wizard',
    avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=wizard',
    badge_level: 'bronze',
    vote_count: 1896,
    weighted_score: 2400,
    rank_in_track: 5,
    genre: 'Thriller',
    duration: 8,
    round_number: 6,
    total_rounds: 75,
    segment_index: 5,
    hype_score: 52,
    is_featured: false,
    is_creator_followed: false,
  },
];

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
// INFINITY VOTE BUTTON (Visible on any background)
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
      whileTap={{ scale: 0.85 }}
      className="relative w-16 h-16 flex items-center justify-center"
    >
      {/* Subtle outer glow */}
      {!isDisabled && (
        <motion.div
          className="absolute inset-[-4px] rounded-full opacity-50"
          animate={{
            boxShadow: [
              '0 0 15px rgba(56, 189, 248, 0.5)',
              '0 0 25px rgba(168, 85, 247, 0.6)',
              '0 0 15px rgba(56, 189, 248, 0.5)',
            ],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}

      {/* Gradient border ring - NO solid background */}
      <svg className="absolute inset-0 w-full h-full drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="voteGradientV5" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3CF2FF" />
            <stop offset="50%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
          <linearGradient id="disabledGradientV5" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#555" />
            <stop offset="100%" stopColor="#333" />
          </linearGradient>
        </defs>
        <circle
          cx="32"
          cy="32"
          r="29"
          fill="rgba(0,0,0,0.3)"
          stroke={isDisabled ? 'url(#disabledGradientV5)' : 'url(#voteGradientV5)'}
          strokeWidth="3"
        />
      </svg>

      {/* Infinity sign */}
      {isVoting ? (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="relative z-10 text-xl text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
        >
          ⚡
        </motion.div>
      ) : isDisabled ? (
        <span className="relative z-10 text-gray-400 text-xl">✓</span>
      ) : (
        <motion.span
          className="relative z-10 text-3xl font-black text-white"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            textShadow: '0 0 10px rgba(56, 189, 248, 0.8), 0 0 20px rgba(168, 85, 247, 0.6), 0 2px 4px rgba(0,0,0,0.8)',
          }}
        >
          ∞
        </motion.span>
      )}
    </motion.button>
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
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false); // Start unmuted

  const videoRef = useRef<HTMLVideoElement>(null);
  const queryClient = useQueryClient();

  // Swipe handling
  const touchStartY = useRef<number>(0);
  const touchEndY = useRef<number>(0);
  const swipeThreshold = 50;

  // Fetch voting data
  // TESTING MODE: Always use mock clips with Veo3 videos
  const { data: votingData, isLoading, error, refetch } = useQuery<VotingState>({
    queryKey: ['voting', 'track-main'],
    queryFn: async () => {
      // Force mock data for testing your Veo3 videos
      return {
        clips: MOCK_CLIPS,
        totalVotesToday: 0,
        userRank: 0,
        remainingVotes: { standard: 200, super: 0, mega: 0 },
        streak: 1,
      };
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

  // Reset pause state on clip change
  useEffect(() => {
    setIsPaused(false);
  }, [activeIndex]);

  // Vote mutation
  const voteMutation = useMutation<VoteResponse, Error, { clipId: string }, MutationContext>({
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
    onMutate: async ({ clipId }): Promise<MutationContext> => {
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
    onSuccess: () => {
      if (votesToday === 0 || votesToday === 49 || votesToday === 99 || votesToday === 199) {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
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

  const genreLabel = GENRE_LABELS[currentClip?.genre?.toUpperCase()] || currentClip?.genre || '';

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
                className="w-full h-full object-cover"
                autoPlay
                loop
                muted={isMuted}
                playsInline
                onError={() => setVideoError(true)}
              />
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {/* ============ TOP: Search Bar (TikTok Style) ============ */}
      <div className="absolute top-0 left-0 right-0 z-30 pt-12 px-4 pb-3">
        <div className="flex items-center gap-3">
          <motion.div 
            whileTap={{ scale: 0.98 }}
            className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/10 backdrop-blur-sm"
          >
            <Search className="w-5 h-5 text-white/60" />
            <input
              type="text"
              placeholder="Search clips, creators..."
              className="flex-1 bg-transparent text-white text-sm placeholder:text-white/40 outline-none"
            />
          </motion.div>
        </div>
      </div>

      {/* ============ SWIPE HINT ============ */}
      <AnimatePresence>
        {showSwipeHint && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-28 left-0 right-0 z-20 flex justify-center"
          >
            <div className="px-4 py-2 rounded-full bg-black/40 backdrop-blur-sm">
              <p className="text-white/80 text-xs font-medium">Swipe ↑↓ to browse · Tap ∞ to vote</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ RIGHT COLUMN ============ */}
      <div className="absolute right-3 bottom-28 z-20 flex flex-col items-center gap-4">
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

        {/* Vote Count */}
        <ActionButton
          icon={<Heart className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />}
          label={formatNumber(currentClip?.vote_count ?? 0)}
        />

        {/* Comments */}
        <ActionButton
          icon={<MessageCircle className="w-7 h-7 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" />}
          label={comments.length}
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

        {/* VOTE BUTTON */}
        <div className="mt-2">
          <InfinityVoteButton
            onVote={handleVote}
            isVoting={isVoting}
            isDisabled={votesToday >= DAILY_GOAL}
          />
        </div>

        {/* Progress */}
        <p className="text-white text-xs font-semibold drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
          {votesToday}/{DAILY_GOAL}
        </p>
      </div>

      {/* ============ BOTTOM: Creator Info ============ */}
      <div className="absolute bottom-20 left-0 right-16 z-20 px-4">
        <div className="flex items-center gap-2">
          <p className="text-white font-semibold text-sm drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            @{currentClip?.username || 'creator'}
          </p>
          <span className="text-white/60">·</span>
          <p className="text-white/80 text-sm drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">{genreLabel}</p>
        </div>
      </div>

      {/* ============ COMMENTS PANEL ============ */}
      <AnimatePresence>
        {showComments && (
          <motion.div
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ 
              y: {
                type: 'tween',
                duration: 0.3,
                ease: [0.32, 0.72, 0, 1]
              },
              opacity: {
                duration: 0.15,
                ease: 'easeIn'
              }
            }}
            className="absolute bottom-0 left-0 right-0 h-2/3 bg-black/40 backdrop-blur-xl z-50 rounded-t-3xl border-t border-white/10"
          >
            <div className="p-4 h-full flex flex-col">
              <div className="w-10 h-1 rounded-full bg-white/30 mx-auto mb-4" />

              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold">{comments.length} Comments</h3>
                <button onClick={() => setShowComments(false)}>
                  <X className="w-6 h-6 text-white/60" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-4">
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <img
                      src={comment.user.avatar_url}
                      alt=""
                      className="w-9 h-9 rounded-full flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold">{comment.user.username}</p>
                      <p className="text-white/80 text-sm break-words">{comment.text}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-white/40 text-xs">2h</span>
                        <button className="flex items-center gap-1 text-white/40 text-xs hover:text-white/60">
                          <Heart className="w-3 h-3" /> {comment.likes}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-white/10 mt-3">
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

      {/* ============ BOTTOM NAV (3 items, transparent, bigger) ============ */}
      <div className="absolute bottom-0 left-0 right-0 z-40">
        {/* Gradient fade for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-transparent pointer-events-none" />
        
        <div className="relative flex items-center justify-around px-4 pb-2 pt-1">
          <NavButton 
            href="/story" 
            icon={<BookOpen className="w-6 h-6" />} 
            label="Story" 
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
    <QueryClientProvider client={queryClient}>
      <VotingArena />
    </QueryClientProvider>
  );
}