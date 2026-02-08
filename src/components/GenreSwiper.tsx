'use client';

import React, { useRef, useEffect, useState } from 'react';
import { ActiveSeason } from '@/hooks/useGenreSwiper';
import { getGenreEmoji } from '@/lib/genres';

interface GenreSwiperProps {
  genres: ActiveSeason[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  children: (genre: ActiveSeason) => React.ReactNode;
}

/**
 * GenreSwiper - Horizontal swipe navigation between genres
 * Uses CSS scroll-snap for smooth native swiping
 */
export function GenreSwiper({
  genres,
  currentIndex,
  onIndexChange,
  children,
}: GenreSwiperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isScrolling, setIsScrolling] = useState(false);

  // Scroll to current index when it changes programmatically
  useEffect(() => {
    if (containerRef.current && !isScrolling) {
      const container = containerRef.current;
      const targetScroll = currentIndex * container.offsetWidth;
      container.scrollTo({ left: targetScroll, behavior: 'smooth' });
    }
  }, [currentIndex, isScrolling]);

  // Handle scroll end to detect user swipe
  const handleScroll = () => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const scrollLeft = container.scrollLeft;
    const pageWidth = container.offsetWidth;
    const newIndex = Math.round(scrollLeft / pageWidth);

    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < genres.length) {
      onIndexChange(newIndex);
    }
  };

  // Debounced scroll handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollTimeout: NodeJS.Timeout;

    const onScroll = () => {
      setIsScrolling(true);
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        setIsScrolling(false);
        handleScroll();
      }, 100);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      clearTimeout(scrollTimeout);
    };
  }, [currentIndex, genres.length]);

  if (genres.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-white/50">No genres available</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Genre header with dots (mobile) or tabs (desktop) */}
      <GenreHeader
        genres={genres}
        currentIndex={currentIndex}
        onSelectIndex={onIndexChange}
      />

      {/* Swipeable container */}
      <div
        ref={containerRef}
        className="flex-1 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        style={{
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {genres.map((genre, index) => (
          <div
            key={genre.id}
            className="min-w-full snap-center flex-shrink-0"
            style={{ scrollSnapAlign: 'center' }}
          >
            {children(genre)}
          </div>
        ))}
      </div>

      {/* Keyboard hints (desktop only) */}
      <KeyboardHints />
    </div>
  );
}

/**
 * GenreHeader - Shows genre tabs (desktop) or dots (mobile)
 */
interface GenreHeaderProps {
  genres: ActiveSeason[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
}

export function GenreHeader({ genres, currentIndex, onSelectIndex }: GenreHeaderProps) {
  const currentGenre = genres[currentIndex];

  return (
    <div className="bg-black/40 backdrop-blur-sm border-b border-white/10">
      {/* Mobile: Dots + Current Genre Name */}
      <div className="md:hidden text-center py-3 px-4">
        {/* Dot indicators */}
        <div className="flex justify-center gap-1.5 mb-2">
          {genres.map((g, i) => (
            <button
              key={g.id}
              onClick={() => onSelectIndex(i)}
              className={`w-2 h-2 rounded-full transition-all ${
                i === currentIndex
                  ? 'bg-white scale-110'
                  : 'bg-white/30 hover:bg-white/50'
              }`}
              aria-label={`Switch to ${g.label}`}
            />
          ))}
        </div>
        {/* Current genre */}
        {currentGenre && (
          <>
            <div className="text-lg font-bold text-white">
              {currentGenre.emoji} {currentGenre.label}
            </div>
            <div className="text-xs text-white/60">
              Slot {currentGenre.currentSlot}/{currentGenre.totalSlots}
              {currentGenre.clipCount > 0 && (
                <span className="ml-2">{currentGenre.clipCount} clips</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Desktop: Clickable Tabs */}
      <div className="hidden md:flex items-center gap-1 px-4 py-2">
        {genres.map((g, i) => (
          <button
            key={g.id}
            onClick={() => onSelectIndex(i)}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              i === currentIndex
                ? 'bg-white/20 text-white border-b-2 border-cyan-400'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {g.emoji} {g.label}
            <span className="ml-2 text-xs opacity-60">
              {g.currentSlot}/{g.totalSlots}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * KeyboardHints - Shows keyboard shortcuts (desktop only)
 */
function KeyboardHints() {
  return (
    <div className="hidden md:flex justify-center gap-6 text-xs text-white/40 py-2 bg-black/20">
      <span>
        <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-xs mr-1">
          {'\u2190 \u2192'}
        </kbd>
        genres
      </span>
      <span>
        <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-xs mr-1">
          {'\u2191 \u2193'}
        </kbd>
        clips
      </span>
    </div>
  );
}

/**
 * GenreEmptyState - Shown when a genre has no clips
 */
interface GenreEmptyStateProps {
  genre: ActiveSeason;
}

export function GenreEmptyState({ genre }: GenreEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <span className="text-6xl mb-4">{genre.emoji}</span>
      <h2 className="text-xl font-bold text-white mb-2">
        No {genre.label} clips yet
      </h2>
      <p className="text-white/60 mb-6">
        Be the first to upload a clip for the {genre.label} movie!
      </p>
      <a
        href={`/upload?genre=${genre.genre}`}
        className="bg-gradient-to-r from-pink-500 to-purple-500 px-6 py-3 rounded-full font-semibold text-white hover:opacity-90 transition-opacity"
      >
        Upload {genre.label} Clip
      </a>
    </div>
  );
}

/**
 * SwipeHint - First-time swipe hint for mobile users
 */
export function SwipeHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Only show on mobile
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 768) return;

    const seen = localStorage.getItem('genre_swipe_hint_seen');
    if (seen) return;

    setShow(true);
    const timer = setTimeout(() => {
      setShow(false);
      localStorage.setItem('genre_swipe_hint_seen', 'true');
    }, 4000);

    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="absolute top-20 left-0 right-0 text-center text-sm text-white/70 animate-pulse z-10 pointer-events-none">
      {'\u2190'} Swipe to see more genres {'\u2192'}
    </div>
  );
}
