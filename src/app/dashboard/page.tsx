// =========================================
// AiMoviez · 8SEC MADNESS – Voting Arena
// Minimal TikTok-style UI, monochrome buttons
// =========================================

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
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
// INFINITY SIGN – white, no background
// =========================================

const InfinitySign: React.FC<{
  size?: 'small' | 'medium' | 'hero';
  animated?: boolean;
}> = ({ size = 'medium', animated = false }) => {
  const baseSizeClass =
    size === 'hero'
      ? 'text-[42px] md:text-[52px]'
      : size === 'medium'
      ? 'text-[32px] md:text-[36px]'
      : 'text-[22px] md:text-[24px]'; // small

  return (
    <motion.div
      className="relative inline-flex items-center justify-center leading-none"
      animate={
        animated
          ? {
              scale: [1, 1.06, 1],
              opacity: [0.9, 1, 0.9],
            }
          : {}
      }
      transition={
        animated
          ? {
              duration: 1.4,
              repeat: Infinity,
              ease: 'easeInOut',
            }
          : undefined
      }
    >
      <span className={`${baseSizeClass} font-black leading-none text-white`}>∞</span>
    </motion.div>
  );
};

// =========================================
// VOTING INDICATORS
// =========================================

const VotingIndicator: React.FC<{
  voteCount: number;
  dailyGoal: number;
  streak: number;
}> = ({ voteCount, dailyGoal, streak }) => {
  const progress = Math.min(1, voteCount / dailyGoal);
  const mv = useMotionValue(progress);
  useTransform(mv, [0, 1], [0.3, 1]);

  return (
    <motion.div
      className="hidden sm:flex items-center gap-3 px-4 py-2 rounded-full bg-black/60 border border-white/15 shadow-[0_0_18px_rgba(255,255,255,0.25)]"
      style={{
        boxShadow: `0 0 ${10 + progress * 18}px rgba(255,255,255,${0.25 + progress * 0.25})`,
      }}
    >
      <div className="relative flex items-center justify-center">
        <InfinitySign size="small" animated />
        <motion.span
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-white leading-none"
          animate={{ opacity: [0.6, 1, 0.6], y: [0, -1, 0] }}
          transition={{ duration: 1.8, repeat: Infinity }}
        >
          {voteCount}
        </motion.span>
      </div>

      <div className="flex flex-col gap-1 w-[140px]">
        <div className="flex justify-between text-[10px] text-white/70">
          <span>Today&apos;s Hype</span>
          <span>
            {voteCount}/{dailyGoal}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-white/60 via-white to-white/80"
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <div className="flex items-center gap-1 text-[9px] text-white/60">
          <span>🔥 Streak: {streak} days</span>
        </div>
      </div>
    </motion.div>
  );
};

// (opcjonalny CompactVotingIndicator możesz zostawić lub usunąć, nie jest już używany)

// =========================================
// GENRE TAG
// =========================================

const GenreTag: React.FC<{ genre: Clip['genre'] }> = ({ genre }) => {
  const config = {
    COMEDY: { label: 'Comedy', emoji: '🎭' },
    THRILLER: { label: 'Thriller', emoji: '😱' },
    ACTION: { label: 'Action', emoji: '💥' },
    ANIMATION: { label: 'Animation', emoji: '🎨' },
  }[genre];

  return (
    <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-black/60 border border-white/15 text-[10px]">
      <span>{config.emoji}</span>
      <span className="text-white font-semibold tracking-wide uppercase text-[9px]">
        {config.label}
      </span>
    </div>
  );
};

// =========================================
// MOCK COMMENTS (LOCAL)
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

  const queryClient = useQueryClient();

  // Swiping
  const touchStartY = useRef<number>(0);
  const touchEndY = useRef<number>(0);
  const swipeThreshold = 50;

  // Load clips + voting state
  const { data: votingData, isLoading, error } = useQuery<VotingState>({
    queryKey: ['voting', 'track-main'],
    queryFn: async () => {
      const res = await fetch('/api/vote?trackId=track-main');
      if (!res.ok) {
        throw new Error('Failed to fetch clips');
      }
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 5000,
    retry: 2,
  });

  const currentClipId = votingData?.clips?.[activeIndex]?.clip_id;
  const { comments } = useMockComments(currentClipId);

  // Vote mutation
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
          totalVotesToday: previous.totalVotesToday + 1,
        });
      }

      return { previous };
    },
    onError: (error, _variables, context) => {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }

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

  // Pusher realtime (optional)
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_PUSHER_KEY || !process.env.NEXT_PUBLIC_PUSHER_CLUSTER) return;

    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    });

    const channel = pusher.subscribe('clips');
    channel.bind('vote-updated', (data: { clipId: string; newCount: number }) => {
      queryClient.setQueryData<VotingState>(['voting', 'track-main'], (old) => {
        if (!old) return old;
        return {
          ...old,
          clips: old.clips?.map((clip: Clip) =>
            clip.clip_id === data.clipId ? { ...clip, vote_count: data.newCount } : clip
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
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
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
  // RENDER
  // =========================================

  return (
    <div className="relative h-dvh w-full bg-gradient-to-b from-black via-[#020617] to-black text-white overflow-hidden">
      {/* Subtle background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-72 w-72 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-white/8 blur-3xl" />
      </div>

      {/* TOP BAR – tylko od sm w górę */}
      <div className="absolute top-3 inset-x-0 hidden sm:flex items-center justify-between px-3 z-20">
        <div className="flex items-center gap-1">
          <InfinitySign size="small" animated />
          <span className="text-xs font-semibold tracking-[0.18em] text-white/80">
            AIMOVIEZ
          </span>
          <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white/80">
            8SEC MADNESS
          </span>
        </div>

        <VotingIndicator
          voteCount={votingData?.totalVotesToday ?? 0}
          dailyGoal={100}
          streak={votingData?.streak ?? 1}
        />
      </div>

      {/* PHONE CONTAINER / VIDEO */}
      <div className="relative h-full flex items-center justify-center px-1 pb-4 pt-12 z-10">
        <div
          className="relative h-[88vh] max-h-[780px] w-full max-w-[440px] mx-auto rounded-[28px] overflow-hidden bg-black/70 border border-white/15 shadow-[0_0_40px_rgba(0,0,0,0.8)]"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="relative h-full w-full">
            {/* VIDEO */}
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
                <div className="h-full w-full flex items-center justify-center text-white/40 text-sm">
                  {isLoading ? 'Loading clips…' : 'No clips available'}
                </div>
              )}
            </div>

            {/* GRADIENT OVERLAY */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />

            {/* META – TOP LEFT INSIDE PHONE */}
            <div className="absolute top-3 left-3 right-20 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                {currentClip && <GenreTag genre={currentClip.genre} />}
                {currentClip?.is_featured && (
                  <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/30 text-[10px] text-white flex items-center gap-1">
                    ⭐ Featured in track
                  </span>
                )}
              </div>

              {currentClip && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full border border-white/20 overflow-hidden bg-black/40">
                      <img
                        src={currentClip.user.avatar_url}
                        alt={currentClip.user.username}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[12px] font-semibold">
                        @{currentClip.user.username}
                      </span>
                      <span className="text-[10px] text-white/70">
                        Segment #{currentClip.segment_index + 1} · Round {currentClip.round_number}/
                        {currentClip.total_rounds}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN – BUTTONS */}
            <div className="absolute right-3 bottom-20 sm:right-4 sm:bottom-24 z-30 flex flex-col items-center gap-4">
              {/* MAIN VOTE BUTTON ∞ with two orbiting dots */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                disabled={isVoting || !currentClip}
                onClick={handleVote}
                className="relative w-12 h-12 rounded-full flex items-center justify-center
                           bg-black/60 border border-white/80
                           shadow-[0_0_10px_rgba(0,0,0,0.9),0_0_18px_rgba(255,255,255,0.8)]
                           backdrop-blur-sm"
              >
                <div className="relative flex items-center justify-center w-full h-full">
                  {/* Infinity in the center */}
                  <InfinitySign size="small" animated />

                  {/* Orbiting dot #1 – klasyczna, na górze */}
                  <motion.div
                    className="absolute inset-0"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
                  >
                    <div className="absolute left-1/2 -translate-x-1/2 -top-0.5 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]" />
                  </motion.div>

                  {/* Orbiting dot #2 – mniejsza, na boku, w przeciwnym kierunku */}
                  <motion.div
                    className="absolute inset-0"
                    animate={{ rotate: -360 }}
                    transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 left-[16%] w-1 h-1 rounded-full bg-white/90 shadow-[0_0_4px_rgba(255,255,255,0.8)]" />
                  </motion.div>
                </div>
              </motion.button>

              {/* SKIP */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleSkip}
                className="relative w-12 h-12 rounded-full flex items-center justify-center
                           bg-black/40 border border-white/60
                           shadow-[0_0_12px_rgba(0,0,0,0.8)]
                           backdrop-blur-sm"
              >
                <span className="text-[11px] text-white leading-none">Skip</span>
              </motion.button>

              {/* COMMENTS */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowComments(true)}
                className="relative w-12 h-12 rounded-full flex items-center justify-center
                           bg-black/40 border border-white/60
                           shadow-[0_0_12px_rgba(0,0,0,0.8)]
                           backdrop-blur-sm"
              >
                <span className="text-lg text-white leading-none">💬</span>
              </motion.button>

              {/* SHARE */}
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => {
                  if (typeof window !== 'undefined' && navigator.share) {
                    navigator
                      .share({
                        title: 'AiMoviez · 8SEC MADNESS',
                        text: 'Check out this clip on AiMoviez · 8SEC MADNESS',
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

            {/* COMMENTS PANEL */}
            <AnimatePresence>
              {showComments && (
                <motion.div
                  className="absolute inset-x-0 bottom-0 max-h-[65%] bg-black/90 border-t border-white/15 rounded-t-[24px] overflow-hidden"
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', stiffness: 260, damping: 28 }}
                >
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

                  <div className="px-4 py-2 space-y-2 text-[11px] max-h-[50vh] overflow-y-auto">
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
                </motion.div>
              )}
            </AnimatePresence>
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

      {/* FLOATING HOME BUTTON */}
      <Link
        href="/"
        className="fixed bottom-4 left-4 z-40
                   w-11 h-11 rounded-full bg-black/70 border border-white/40
                   flex items-center justify-center
                   text-xl text-white shadow-lg shadow-black/70
                   active:scale-95 transition-transform"
      >
        ⌂
      </Link>

      {/* FLOATING + BUTTON – ENTRY POINT DO UPLOADU */}
      <Link
        href="/upload"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40
                   w-14 h-14 rounded-full bg-white text-black
                   flex items-center justify-center
                   text-3xl font-bold shadow-xl shadow-black/70
                   active:scale-95 transition-transform"
      >
        +
      </Link>
    </div>
  );
}

// =========================================
// PAGE WRAPPER – React Query Provider
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
