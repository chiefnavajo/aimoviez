// =========================================
// ENHANCED VOTING ARENA - AiMoviez · 8SEC MADNESS
// =========================================

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import Pusher from 'pusher-js';
import confetti from 'canvas-confetti';
import Link from 'next/link';

// 🔥 pełna kula po 200 głosach
const DAILY_GOAL = 200;

// =========================================
// TYPES & INTERFACES
// =========================================

interface Clip {
  id: string;
  clip_id: string;
  user_id: string;
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
  genre: 'COMEDY' | 'THRILLER' | 'ACTION' | 'ANIMATION';
  duration: number;
  round_number: number;
  total_rounds: number;
  segment_index: number;
  hype_score: number;
  is_featured?: boolean;
  is_creator_followed?: boolean;
}

type VoteType = 'standard' | 'super' | 'mega';

interface VoteResponse {
  success: boolean;
  newScore: number;
  voteType: VoteType;
  clipId: string;
}

interface VotingState {
  clips: Clip[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: {
    standard: number;
    super: number;
    mega: number;
  };
  streak: number;
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

// =========================================
// INFINITY SIGN (branding)
// =========================================

const InfinitySign: React.FC<{
  size?: 'small' | 'medium' | 'hero';
  animated?: boolean;
}> = ({ size = 'medium', animated = false }) => {
  const className =
    size === 'hero'
      ? 'infinity-hero'
      : size === 'small'
      ? 'infinity-small'
      : 'infinity-medium';

  return (
    <motion.div
      className={`relative inline-flex items-center justify-center ${className}`}
      animate={
        animated
          ? {
              scale: [1, 1.05, 1],
              textShadow: [
                '0 0 12px rgba(0, 255, 255, 0.8), 0 0 24px rgba(162, 0, 255, 0.6)',
                '0 0 18px rgba(0, 255, 255, 1), 0 0 32px rgba(162, 0, 255, 0.9)',
                '0 0 12px rgba(0, 255, 255, 0.8), 0 0 24px rgba(162, 0, 255, 0.6)',
              ],
            }
          : {}
      }
      transition={
        animated
          ? {
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }
          : undefined
      }
    >
      <span className="text-[42px] md:text-[52px] font-black tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] drop-shadow-[0_0_15px_rgba(0,255,255,0.9)]">
        ∞
      </span>
      <div className="absolute inset-0 blur-xl opacity-70 bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7]" />
    </motion.div>
  );
};

// =========================================
/** VOTE METER – CYBERPUNKOWA KULA Z PŁYNEM */
// =========================================

const VoteMeter: React.FC<{
  voteCount: number;
  dailyGoal: number;
}> = ({ voteCount, dailyGoal }) => {
  const progress = Math.max(0, Math.min(1, dailyGoal > 0 ? voteCount / dailyGoal : 0));

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Cyberpunkowa kula z płynem */}
      <div
        className="relative w-20 h-20 rounded-full bg-black/80 border border-cyan-300/70
                   overflow-hidden shadow-[0_0_24px_rgba(34,211,238,0.95)]
                   backdrop-blur-md"
      >
        {/* Płyn wypełniający kulę od dołu */}
        <motion.div
          className="absolute inset-x-0 bottom-0"
          initial={false}
          animate={{ height: `${progress * 100}%` }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          <div className="w-full h-full bg-gradient-to-t from-[#00F5FF] via-[#A020F0] to-[#FF00C7]" />
          {/* Glow i odbicia */}
          <div className="absolute inset-0 opacity-35 bg-[radial-gradient(circle_at_30%_10%,#ffffff_0,#ffffff00_55%)]" />
          <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_70%_90%,#22d3ee_0,#0ea5e900_60%)]" />
        </motion.div>

        {/* Wewnętrzny ring */}
        <div className="absolute inset-[3px] rounded-full border border-cyan-100/40 pointer-events-none" />

        {/* Infinity sign nad płynem */}
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          <span className="text-3xl md:text-4xl font-black text-white drop-shadow-[0_0_12px_rgba(0,0,0,0.9)]">
            ∞
          </span>
        </div>
      </div>

      {/* Tekst pod spodem */}
      <span className="mt-1 text-[10px] text-white/80 font-medium leading-none">
        {voteCount}/{dailyGoal} votes
      </span>
    </div>
  );
};

// =========================================
// GENRE TAG
// =========================================

const GENRE_CONFIG: Record<string, { label: string; emoji: string }> = {
  COMEDY: { label: 'Comedy', emoji: '🎭' },
  THRILLER: { label: 'Thriller', emoji: '😱' },
  ACTION: { label: 'Action', emoji: '💥' },
  ANIMATION: { label: 'Animation', emoji: '🎨' },
};

const GenreTag: React.FC<{ genre?: Clip['genre'] | null }> = ({ genre }) => {
  const key = (genre || 'COMEDY').toUpperCase();
  const config = GENRE_CONFIG[key] ?? GENRE_CONFIG['COMEDY'];

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 border border-white/10 text-[10px]">
      <span>{config.emoji}</span>
      <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] font-semibold tracking-wide uppercase text-[9px]">
        {config.label}
      </span>
    </div>
  );
};

// =========================================
// MOCK COMMENTS
// =========================================

function useMockComments(initialClipId?: string) {
  const [comments, setComments] = useState<Comment[]>([]);

  useEffect(() => {
    if (!initialClipId) return;
    setComments([
      {
        id: '1',
        user: {
          username: 'neon_dream',
          avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=neon',
        },
        text: 'This transition is insane 🤯',
        timestamp: new Date(),
        likes: 12,
      },
      {
        id: '2',
        user: {
          username: 'story_addict',
          avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=story',
        },
        text: 'Perfect continuation of the chaos 😂',
        timestamp: new Date(),
        likes: 7,
      },
    ]);
  }, [initialClipId]);

  return { comments, setComments };
}

// =========================================
// MAIN VOTING ARENA
// =========================================

function VotingArenaEnhanced() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isVoting, setIsVoting] = useState(false);
  const [voteType] = useState<VoteType>('standard');
  const [showComments, setShowComments] = useState(false);

  // 🔥 lokalny licznik dzienny – tylko w tej sesji
  const [localVotesToday, setLocalVotesToday] = useState(0);

  const queryClient = useQueryClient();

  const touchStartY = useRef<number>(0);
  const touchEndY = useRef<number>(0);
  const swipeThreshold = 50;

  const { data: votingData, isLoading, error } = useQuery<VotingState>({
    queryKey: ['voting', 'track-main'],
    queryFn: async () => {
      const res = await fetch('/api/vote?trackId=track-main');
      if (!res.ok) throw new Error('Failed to fetch clips');
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 5000,
    retry: 2,
  });

  const streak = votingData?.streak ?? 1;

  // UWAGA: już NIE synchronizujemy localVotesToday z backendem,
  // żeby uniknąć skakania 4 → 3, gdy DB ma mniej z uwagi na duplikaty.

  const currentClipId = votingData?.clips?.[activeIndex]?.clip_id;
  const { comments } = useMockComments(currentClipId);

  const voteMutation = useMutation<
    VoteResponse,
    Error,
    { clipId: string; type: VoteType },
    { previous?: VotingState }
  >({
    mutationFn: async ({ clipId, type }) => {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId, voteType: type }),
      });
      if (!res.ok) throw new Error('Failed to cast vote');
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

      // 🔥 stabilny lokalny licznik do UI (max 200)
      setLocalVotesToday((prev) => Math.min(DAILY_GOAL, prev + 1));

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }

      // NIE cofamy localVotesToday – dzięki temu nie ma skoków 4 → 3
      if (context?.previous) {
        queryClient.setQueryData(['voting', 'track-main'], context.previous);
      }

      toast.error(
        <div className="flex items-center gap-2">
          <span>⚠️ Vote failed</span>
          <span className="text-xs text-white/60">{error.message}</span>
        </div>
      );
      setIsVoting(false);
    },
    onSuccess: (data) => {
      if (data.voteType !== 'standard') {
        confetti({
          particleCount: data.voteType === 'mega' ? 160 : 80,
          spread: 70,
          origin: { y: 0.6 },
        });
      }

      toast.success(
        <div className="flex items-center gap-2">
          <span>✅ Vote counted!</span>
          <span className="text-xs text-white/60">
            New hype score: <strong>{data.newScore}</strong>
          </span>
        </div>
      );

      setIsVoting(false);
      handleNext();
    },
  });

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
              ? {
                  ...clip,
                  vote_count: data.voteCount ?? clip.vote_count,
                  weighted_score: data.weightedScore ?? clip.weighted_score,
                }
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

    if (delta > 0) {
      handleVote();
    } else {
      handleSkip();
    }
  };

  const handleNext = useCallback(() => {
    if (!votingData?.clips?.length) return;
    setActiveIndex((prev) => (prev + 1) % votingData.clips.length);
  }, [votingData?.clips]);

  const handleSkip = () => {
    handleNext();
  };

  const handleVote = () => {
    if (!votingData?.clips?.[activeIndex] || isVoting) return;
    const clip = votingData.clips[activeIndex];

    voteMutation.mutate({
      clipId: clip.clip_id,
      type: voteType,
    });
  };

  const currentClip = votingData?.clips?.[activeIndex];

  // =========================================
  // VIDEO STAGE
  // =========================================

  const renderVideoStage = () => (
    <div className="relative h-full w-full">
      <div className="relative h-full w-full bg-black">
        {currentClip ? (
          <video
            key={currentClip.clip_id}
            src={currentClip.video_url ?? currentClip.thumbnail_url}
            poster={currentClip.thumbnail_url}
            className="h-full w-full object-cover"
            playsInline
            autoPlay
            loop
            muted
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center text-white/40 text-sm">
            <span>No clips available</span>
            <Link
              href="/upload"
              className="mt-2 text-[11px] text-cyan-300 underline underline-offset-4"
            >
              Be the first to upload an 8s clip
            </Link>
          </div>
        )}
      </div>

      {/* OVERLAY GRADIENT */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />

      {/* TOP LEFT META */}
      <div className="absolute top-3 left-3 right-16 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {currentClip && <GenreTag genre={currentClip.genre} />}
          {currentClip?.is_featured && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/30 text-[10px] text-amber-200 flex items-center gap-1">
              ⭐ Featured in track
            </span>
          )}
        </div>

        {currentClip && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full border border-white/20 overflow-hidden bg-black/40">
                <img
                  src={
                    currentClip.user.avatar_url ||
                    'https://api.dicebear.com/7.x/identicon/svg?seed=aimoviez'
                  }
                  alt={currentClip.user.username}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-col">
                <span className="text-[12px] font-semibold">@{currentClip.user.username}</span>
                <span className="text-[10px] text-white/60">
                  Segment #{currentClip.segment_index + 1} · Round {currentClip.round_number}/
                  {currentClip.total_rounds}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT COLUMN BUTTONS */}
      <div className="absolute right-3 bottom-20 sm:right-4 sm:bottom-24 z-30 flex flex-col items-center gap-4">
        {/* main vote */}
        <motion.button
          whileTap={{ scale: 0.92 }}
          disabled={isVoting || !currentClip}
          onClick={handleVote}
          className="relative w-16 h-16 rounded-full flex items-center justify-center
                     bg-black/80 border border-cyan-300/70
                     shadow-[0_0_18px_rgba(0,0,0,0.95),0_0_26px_rgba(34,211,238,0.7)]
                     backdrop-blur-md"
        >
          <div className="relative flex items-center justify-center w-full h-full">
            <div className="absolute inset-2 rounded-full border-2 border-cyan-300/90 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
            <span className="relative text-3xl font-black text-white leading-none">∞</span>

            <motion.div
              className="absolute inset-1"
              animate={{ rotate: 360 }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
            >
              <div className="absolute left-1/2 -translate-x-1/2 -top-0.5 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
            </motion.div>
            <motion.div
              className="absolute inset-1"
              animate={{ rotate: -360 }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
            >
              <div className="absolute left-1/2 -translate-x-1/2 -bottom-0.5 w-1.5 h-1.5 rounded-full bg-cyan-300 shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
            </motion.div>
          </div>
        </motion.button>

        {/* skip */}
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={handleSkip}
          className="relative w-12 h-12 rounded-full flex items-center justify-center
                     bg-black/40 border border-white/60
                     shadow-[0_0_12px_rgba(0,0,0,0.8)]
                     backdrop-blur-sm"
        >
          <span className="text-[11px] text-white leading-none">Skip</span>
        </motion.button>

        {/* comments */}
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => setShowComments((prev) => !prev)}
          className={`relative w-12 h-12 rounded-full flex items-center justify-center
                     bg-black/40 border border-white/60
                     shadow-[0_0_12px_rgba(0,0,0,0.8)]
                     backdrop-blur-sm ${
                       showComments ? 'ring-2 ring-cyan-400/70' : ''
                     }`}
        >
          <span className="text-xl">💬</span>
        </motion.button>

        {/* share */}
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => {
            if (navigator.share) {
              navigator
                .share({
                  title: 'AiMoviez · 8SEC MADNESS',
                  text: 'Help choose the next 8 seconds of the global movie!',
                  url: window.location.href,
                })
                .catch(() => {});
            } else {
              console.log('Share clicked – Web Share API not available');
            }
          }}
          className="relative w-12 h-12 rounded-full flex items-center justify-center
                     bg-black/40 border border-white/60
                     shadow-[0_0_12px_rgba(0,0,0,0.8)]
                     backdrop-blur-sm"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" aria-hidden="true">
            <circle cx="18" cy="5" r="2" fill="currentColor" />
            <circle cx="6" cy="12" r="2" fill="currentColor" />
            <circle cx="18" cy="19" r="2" fill="currentColor" />
            <path
              d="M8 12l8-5M8 12l8 5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </motion.button>
      </div>
    </div>
  );

  // =========================================
  // RENDER
  // =========================================

  return (
    <div className="relative h-dvh w-full bg-gradient-to-b from-black via-[#020617] to-black text-white overflow-hidden">
      {/* Neon background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-fuchsia-500/25 blur-3xl" />
      </div>

      {/* TOP BAR – BRAND (desktop only) */}
      <div className="absolute top-4 inset-x-0 hidden sm:flex items-center justify-between px-4 z-20">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <InfinitySign size="small" animated />
            <span className="text-xs font-semibold tracking-[0.2em] text-white/80">
              AIMOVIEZ
            </span>
          </div>
          <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-cyan-200">
            8SEC MADNESS
          </span>
        </div>
      </div>

      {/* PHONE CONTAINER – FULL HEIGHT ON MOBILE */}
      <div className="relative h-full flex items-stretch justify-center px-0 pt-0 pb-14 sm:px-2 sm:pt-14 sm:pb-6 z-10">
        <div
          className="relative h-full w-full max-w-[480px] sm:max-h-[720px] mx-auto overflow-hidden bg-black/70 border border-white/15 shadow-[0_0_40px_rgba(0,0,0,0.8)]"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* LICZNIK W RAMCE TELEFONU */}
          <div className="absolute top-3 right-3 z-40">
            <VoteMeter voteCount={localVotesToday} dailyGoal={DAILY_GOAL} />
          </div>

          <div className="relative h-full w-full">
            {!showComments ? (
              renderVideoStage()
            ) : (
              <div className="flex flex-col h-full w-full bg-black">
                <div className="relative h-[58%] w-full">{renderVideoStage()}</div>

                <div className="flex-1 bg-black/95 border-t border-white/15">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <span className="text-xs font-semibold text-white/80">
                      Comments ({comments.length})
                    </span>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setShowComments(false)}
                      className="text-xs text-white/70 px-2 py-1 rounded-full bg-white/10 border border-white/20"
                    >
                      Close
                    </motion.button>
                  </div>

                  <div className="px-4 py-2 space-y-2 text-[11px] h-full overflow-y-auto">
                    {comments.length > 0 ? (
                      comments.map((comment) => (
                        <motion.div
                          key={comment.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-start gap-2"
                        >
                          <div className="h-7 w-7 rounded-full overflow-hidden bg-white/10">
                            <img
                              src={comment.user.avatar_url}
                              alt={comment.user.username}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold">
                                @{comment.user.username}
                              </span>
                              <span className="text-[9px] text-white/40">just now</span>
                            </div>
                            <p className="text-[11px] text-white/80">{comment.text}</p>
                          </div>
                          <button className="text-[10px] text-white/40">
                            ❤️ {comment.likes}
                          </button>
                        </motion.div>
                      ))
                    ) : (
                      <p className="text-[11px] text-white/50">
                        No comments yet – be the first!
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* LOADING OVERLAY */}
          <AnimatePresence>
            {isLoading && (
              <motion.div
                className="absolute inset-0 flex items-center justify-center bg-black/70"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <InfinitySign size="medium" animated />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ERROR OVERLAY */}
          <AnimatePresence>
            {error && (
              <motion.div
                className="absolute inset-0 flex items-center justify-center bg-black/80"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="text-center space-y-2">
                  <p className="text-sm text-white/80">Failed to load clips.</p>
                  <button
                    className="text-xs px-3 py-1.5 rounded-full bg-white/10 border border-white/20"
                    onClick={() =>
                      queryClient.invalidateQueries({ queryKey: ['voting', 'track-main'] })
                    }
                  >
                    Try again
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* BOTTOM NAVIGATION */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-black/90 border-t border-white/10">
        <div className="mx-auto max-w-[480px]">
          <div className="flex items-end justify-between px-6 pt-2 pb-3 text-[10px]">
            {/* Story */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              className="relative flex flex-col items-center gap-0.5"
            >
              <span className="text-xl leading-none text-white/70">▶</span>
              <span className="text-white/60">Story</span>
            </motion.button>

            {/* Shorts (ACTIVE) */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              className="relative flex flex-col items-center gap-0.5"
            >
              <span className="text-xl leading-none text-white drop-shadow-[0_0_10px_rgba(56,189,248,0.9)]">
                ∞
              </span>
              <span className="text-white">Shorts</span>
              <motion.div
                className="absolute -bottom-1 h-[2px] w-8 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-violet-500 shadow-[0_0_10px_rgba(56,189,248,0.8)]"
                initial={{ opacity: 0, scaleX: 0.4 }}
                animate={{ opacity: 1, scaleX: 1 }}
              />
            </motion.button>

            {/* Upload */}
            <Link href="/upload" className="flex flex-col items-center gap-0.5">
              <motion.div
                whileTap={{ scale: 0.9 }}
                className="flex flex-col items-center gap-0.5"
              >
                <span className="text-xl leading-none text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-violet-500 drop-shadow-[0_0_10px_rgba(56,189,248,0.9)]">
                  ＋
                </span>
                <span className="text-white/60">Upload</span>
              </motion.div>
            </Link>

            {/* Profile */}
            <motion.button
              whileTap={{ scale: 0.9 }}
              className="relative flex flex-col items-center gap-0.5"
            >
              <span className="text-xl leading-none text-white/70">👤</span>
              <span className="text-white/60">Profile</span>
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =========================================
// PAGE WRAPPER
// =========================================

const queryClient = new QueryClient();

function DashboardPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <VotingArenaEnhanced />
    </QueryClientProvider>
  );
}

export default DashboardPage;
