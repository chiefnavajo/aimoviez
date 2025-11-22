'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';

interface StorySegment {
  slot_position: number;
  clip_id: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string | null;
}

interface StoryResponse {
  seasonLabel: string;
  totalSlots: number;
  lockedSlots: number;
  segments: StorySegment[];
}

type GenreCode = 'COMEDY' | 'THRILLER' | 'ACTION' | 'ANIMATION';

interface GenreOptionSummary {
  code: GenreCode;
  label: string;
  votes: number;
  percentage: number;
}

interface GenreSummaryResponse {
  seasonNumber: number;
  totalVotes: number;
  options: GenreOptionSummary[];
  userChoice: GenreCode | null;
}

// =============== Infinity logo (brand) ===============
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

// =============== Kółka gatunków w prostokącie wideo ===============
function GenreVotingPanel({
  seasonNumber,
  data,
  submitting,
  onVote,
  error,
}: {
  seasonNumber: number;
  data: GenreSummaryResponse | null;
  submitting: boolean;
  onVote: (genre: GenreCode) => void;
  error: string | null;
}) {
  if (!data) return null;

  const { totalVotes, options, userChoice } = data;

  const shortLabel = (code: GenreCode): string => {
    switch (code) {
      case 'COMEDY':
        return 'Co';
      case 'THRILLER':
        return 'Th';
      case 'ACTION':
        return 'Ac';
      case 'ANIMATION':
        return 'An';
      default: {
        const _exhaustiveCheck: never = code;
        return _exhaustiveCheck;
      }
    }
  };

  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 z-10">
      {options.map((opt) => {
        const isActive = userChoice === opt.code;

        return (
          <button
            key={opt.code}
            disabled={submitting}
            onClick={() => onVote(opt.code)}
            className={[
              'relative w-12 h-12 rounded-full flex items-center justify-center text-[9px] font-medium',
              'border border-white/40 bg-black/70 backdrop-blur-sm',
              'shadow-[0_0_16px_rgba(0,0,0,0.8)]',
              'hover:border-cyan-300 hover:shadow-[0_0_26px_rgba(34,211,238,0.7)]',
              isActive
                ? 'border-cyan-300 text-cyan-100 shadow-[0_0_30px_rgba(34,211,238,0.9)]'
                : 'text-white/80',
              submitting ? 'opacity-60' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="absolute inset-[3px] rounded-full border border-white/20" />
            <span className="relative z-10">{shortLabel(opt.code)}</span>
          </button>
        );
      })}

      <div className="mt-1 text-[9px] text-white/45 text-center leading-tight">
        Next S{seasonNumber} genre
        <br />
        {totalVotes} votes
      </div>

      {error && (
        <div className="mt-1 text-[9px] text-red-400 text-center max-w-[120px]">
          {error}
        </div>
      )}
    </div>
  );
}

// =============== Główna strona STORY ===============
export default function StoryPage() {
  const [data, setData] = useState<StoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [genreData, setGenreData] = useState<GenreSummaryResponse | null>(null);
  const [genreLoading, setGenreLoading] = useState(true);
  const [genreSubmitting, setGenreSubmitting] = useState(false);
  const [genreError, setGenreError] = useState<string | null>(null);

  // STORY
  useEffect(() => {
    async function loadStory() {
      try {
        setLoading(true);
        const res = await fetch('/api/story');
        if (!res.ok) throw new Error('Failed to load story');
        const json = (await res.json()) as StoryResponse;
        setData(json);
        setCurrentIndex(0);
      } catch (e: any) {
        console.error('[StoryPage] loadStory error:', e);
        setError(e.message ?? 'Failed to load story');
      } finally {
        setLoading(false);
      }
    }

    loadStory();
  }, []);

  // GENRES (Season 2)
  const loadGenres = async () => {
    try {
      setGenreLoading(true);
      const res = await fetch('/api/genres?season=2');
      if (!res.ok) throw new Error('Failed to load genre votes');
      const json = (await res.json()) as GenreSummaryResponse;
      setGenreData(json);
      setGenreError(null);
    } catch (e: any) {
      console.error('[StoryPage] genre load error:', e);
      setGenreError(e.message ?? 'Failed to load genre votes');
    } finally {
      setGenreLoading(false);
    }
  };

  useEffect(() => {
    loadGenres();
  }, []);

  const handleGenreVote = async (genre: GenreCode) => {
    try {
      setGenreSubmitting(true);
      const res = await fetch('/api/genres', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genre, seasonNumber: 2 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to save vote');
      }
      await loadGenres();
    } catch (e: any) {
      console.error('[StoryPage] vote error:', e);
      setGenreError(e.message ?? 'Failed to save vote');
    } finally {
      setGenreSubmitting(false);
    }
  };

  const handleEnded = () => {
    if (!data) return;
    if (currentIndex < data.segments.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        Loading story…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-400">Cannot load story.</p>
        <Link
          href="/dashboard"
          className="px-4 py-2 rounded-full bg-white text-black text-sm"
        >
          Back to Shorts
        </Link>
      </div>
    );
  }

  const { segments, seasonLabel, lockedSlots, totalSlots } = data;
  const hasSegments = segments.length > 0;
  const currentSegment = hasSegments ? segments[currentIndex] : null;

  return (
    <div className="relative h-dvh w-full bg-gradient-to-b from-black via-[#020617] to-black text-white overflow-hidden">
      {/* Neon background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-fuchsia-500/25 blur-3xl" />
      </div>

      {/* TOP BAR – jak na dashboardzie */}
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

      {/* PHONE CONTAINER */}
      <div className="relative h-full flex items-stretch justify-center px-0 pt-0 pb-14 sm:px-2 sm:pt-14 sm:pb-6 z-10">
        <div className="relative h-full w-full max-w-[480px] sm:max-h-[720px] mx-auto overflow-hidden bg-black/70 border border-white/15 shadow-[0_0_40px_rgba(0,0,0,0.8)]">
          {/* META STORY U GÓRY W RAMCE */}
          <div className="absolute top-3 left-3 right-3 z-20 flex justify-between items-start">
            <div className="flex flex-col gap-0.5 text-[9px] text-white/60">
              <span className="uppercase tracking-[0.2em] text-[9px] text-white/40">
                Story · Season 1
              </span>
              <span>
                {seasonLabel} · Locked {lockedSlots}/{totalSlots}
              </span>
              {hasSegments && (
                <span>
                  Segment {currentIndex + 1}/{segments.length}
                </span>
              )}
            </div>
            <Link
              href="/dashboard"
              className="px-2 py-1 rounded-full border border-white/25 bg-black/60 text-[9px] text-white/80 hover:bg-white hover:text-black transition"
            >
              Shorts
            </Link>
          </div>

          {/* ŚRODEK – wideo + kółka gatunków */}
          <div className="relative h-full w-full flex items-center justify-center">
            {hasSegments && currentSegment ? (
              <div className="relative w-full max-w-[320px] sm:max-w-[360px] aspect-[9/16] overflow-hidden border border-cyan-400/40 bg-black shadow-[0_0_45px_rgba(34,211,238,0.6)]">
                {currentSegment.video_url ? (
                  <video
                    key={currentSegment.clip_id}
                    ref={videoRef}
                    src={currentSegment.video_url}
                    className="absolute inset-0 w-full h-full object-cover"
                    autoPlay
                    muted
                    playsInline
                    controls
                    onEnded={handleEnded}
                  />
                ) : (
                  <img
                    src={currentSegment.thumbnail_url}
                    alt="Story segment"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}

                <div className="absolute bottom-3 left-4 text-[11px] text-white/90 bg-black/50 px-3 py-1 rounded-full z-10">
                  @{currentSegment.username || 'creator'}
                </div>

                {!genreLoading && (
                  <GenreVotingPanel
                    seasonNumber={2}
                    data={genreData}
                    submitting={genreSubmitting}
                    onVote={handleGenreVote}
                    error={genreError}
                  />
                )}
              </div>
            ) : (
              <div className="text-white/60 text-sm">
                No final story segments yet.
              </div>
            )}
          </div>

          {/* Mały tekst na dole ramki – bez pasków */}
          {hasSegments && (
            <div className="absolute bottom-4 left-0 right-0 flex justify-center">
              <div className="text-[10px] text-white/50 text-center">
                Segment {currentIndex + 1}/{lockedSlots || 0} · Total slots{' '}
                {totalSlots}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM NAV – Story aktywne */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-black/90 border-t border-white/10">
        <div className="mx-auto max-w-[480px]">
          <div className="flex items-end justify-between px-6 pt-2 pb-3 text-[10px]">
            {/* Story (ACTIVE) */}
            <Link href="/story" className="relative flex flex-col items-center gap-0.5">
              <motion.span
                whileTap={{ scale: 0.9 }}
                className="text-xl leading-none text-white drop-shadow-[0_0_10px_rgba(56,189,248,0.9)]"
              >
                ▶
              </motion.span>
              <span className="text-white">Story</span>
              <motion.div
                className="absolute -bottom-1 h-[2px] w-8 rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-violet-500 shadow-[0_0_10px_rgba(56,189,248,0.8)]"
                initial={{ opacity: 0, scaleX: 0.4 }}
                animate={{ opacity: 1, scaleX: 1 }}
              />
            </Link>

            {/* Shorts (dashboard) */}
            <Link href="/dashboard" className="flex flex-col items-center gap-0.5">
              <motion.span whileTap={{ scale: 0.9 }} className="text-xl leading-none text-white/70">
                ∞
              </motion.span>
              <span className="text-white/60">Shorts</span>
            </Link>

            {/* Upload */}
            <Link href="/upload" className="flex flex-col items-center gap-0.5">
              <motion.span
                whileTap={{ scale: 0.9 }}
                className="text-xl leading-none text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-fuchsia-500 to-violet-500 drop-shadow-[0_0_10px_rgba(56,189,248,0.9)]"
              >
                ＋
              </motion.span>
              <span className="text-white/60">Upload</span>
            </Link>

            {/* Profile (placeholder) */}
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
