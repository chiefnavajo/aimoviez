'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
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

  // Handle scroll end to detect user swipe - memoized to avoid stale closures
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const scrollLeft = container.scrollLeft;
    const pageWidth = container.offsetWidth;

    // Guard against division by zero if container not rendered
    if (pageWidth === 0) return;

    const newIndex = Math.round(scrollLeft / pageWidth);

    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < genres.length) {
      onIndexChange(newIndex);
    }
  }, [currentIndex, genres.length, onIndexChange]);

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
  }, [handleScroll]);

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
 * GenreHeader - Shows genre navigation
 * Mobile: iOS-style dynamic dots that scale based on distance from current
 * Desktop: Scrollable pill bar with fade edges
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
      {/* Mobile: iOS-style dynamic dots + current genre name */}
      <div className="md:hidden text-center py-3 px-4">
        <DynamicDots
          count={genres.length}
          currentIndex={currentIndex}
          onSelect={onSelectIndex}
          labels={genres.map(g => g.label)}
        />
        {currentGenre && (
          <>
            <div className="text-lg font-bold text-white mt-2">
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

      {/* Desktop: Scrollable pill bar */}
      <ScrollablePillBar
        genres={genres}
        currentIndex={currentIndex}
        onSelectIndex={onSelectIndex}
      />
    </div>
  );
}

/**
 * DynamicDots - iOS-style page indicator that scales dots based on proximity
 * Shows max 7 dots at a time. Current dot is largest, nearby dots progressively
 * smaller, distant dots hidden. The visible window slides with the current index.
 */
function DynamicDots({
  count,
  currentIndex,
  onSelect,
  labels,
}: {
  count: number;
  currentIndex: number;
  onSelect: (index: number) => void;
  labels: string[];
}) {
  const MAX_VISIBLE = 7;

  // For <= 7 items, show all dots with size scaling only
  if (count <= MAX_VISIBLE) {
    return (
      <div className="flex justify-center items-center gap-1.5">
        {Array.from({ length: count }, (_, i) => {
          const distance = Math.abs(i - currentIndex);
          const scale = distance === 0 ? 1 : distance === 1 ? 0.75 : 0.5;
          const opacity = distance === 0 ? 1 : distance === 1 ? 0.6 : 0.3;
          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              className="rounded-full bg-white transition-all duration-200"
              style={{
                width: `${8 * scale}px`,
                height: `${8 * scale}px`,
                opacity,
                minWidth: '4px',
                minHeight: '4px',
              }}
              aria-label={`Switch to ${labels[i]}`}
            />
          );
        })}
      </div>
    );
  }

  // For > 7 items, show a sliding window of dots
  const halfWindow = Math.floor(MAX_VISIBLE / 2); // 3
  // Clamp the window so it doesn't go out of bounds
  let windowStart = currentIndex - halfWindow;
  let windowEnd = currentIndex + halfWindow;

  if (windowStart < 0) {
    windowStart = 0;
    windowEnd = MAX_VISIBLE - 1;
  }
  if (windowEnd >= count) {
    windowEnd = count - 1;
    windowStart = count - MAX_VISIBLE;
  }

  return (
    <div className="flex justify-center items-center gap-1.5">
      {/* Left overflow indicator */}
      {windowStart > 0 && (
        <button
          onClick={() => onSelect(windowStart - 1)}
          className="rounded-full bg-white/20 transition-all duration-200"
          style={{ width: '3px', height: '3px' }}
          aria-label="Previous genres"
        />
      )}

      {Array.from({ length: windowEnd - windowStart + 1 }, (_, idx) => {
        const i = windowStart + idx;
        const distance = Math.abs(i - currentIndex);
        const scale = distance === 0 ? 1 : distance === 1 ? 0.75 : distance === 2 ? 0.55 : 0.4;
        const opacity = distance === 0 ? 1 : distance === 1 ? 0.6 : distance === 2 ? 0.35 : 0.2;
        return (
          <button
            key={i}
            onClick={() => onSelect(i)}
            className="rounded-full bg-white transition-all duration-200"
            style={{
              width: `${8 * scale}px`,
              height: `${8 * scale}px`,
              opacity,
              minWidth: '3px',
              minHeight: '3px',
            }}
            aria-label={`Switch to ${labels[i]}`}
          />
        );
      })}

      {/* Right overflow indicator */}
      {windowEnd < count - 1 && (
        <button
          onClick={() => onSelect(windowEnd + 1)}
          className="rounded-full bg-white/20 transition-all duration-200"
          style={{ width: '3px', height: '3px' }}
          aria-label="More genres"
        />
      )}
    </div>
  );
}

/**
 * ScrollablePillBar - Horizontally scrollable genre pills for desktop
 * Auto-scrolls to keep active pill centered. Gradient fades on edges
 * indicate more content in that direction.
 */
function ScrollablePillBar({
  genres,
  currentIndex,
  onSelectIndex,
}: {
  genres: ActiveSeason[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  // Check if fades are needed based on scroll position
  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeftFade(el.scrollLeft > 4);
    setShowRightFade(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  // Auto-scroll to keep active pill visible and roughly centered
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeBtn = el.children[currentIndex] as HTMLElement | undefined;
    if (!activeBtn) return;

    const containerCenter = el.clientWidth / 2;
    const btnCenter = activeBtn.offsetLeft + activeBtn.offsetWidth / 2;
    el.scrollTo({ left: btnCenter - containerCenter, behavior: 'smooth' });
  }, [currentIndex]);

  // Listen for scroll to update fades
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateFades();
    el.addEventListener('scroll', updateFades, { passive: true });
    // Also update on resize
    window.addEventListener('resize', updateFades);
    return () => {
      el.removeEventListener('scroll', updateFades);
      window.removeEventListener('resize', updateFades);
    };
  }, [updateFades, genres.length]);

  return (
    <div className="hidden md:block relative">
      {/* Left fade */}
      {showLeftFade && (
        <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-black/60 to-transparent z-10 pointer-events-none" />
      )}

      {/* Scrollable pills */}
      <div
        ref={scrollRef}
        className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto scrollbar-hide"
        style={{ scrollBehavior: 'smooth' }}
      >
        {genres.map((g, i) => (
          <button
            key={g.id}
            onClick={() => onSelectIndex(i)}
            className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              i === currentIndex
                ? 'bg-cyan-500/20 text-white ring-1 ring-cyan-400/60'
                : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {g.emoji} {g.label}
            <span className="ml-1.5 text-xs opacity-50">
              {g.currentSlot}/{g.totalSlots}
            </span>
          </button>
        ))}
      </div>

      {/* Right fade */}
      {showRightFade && (
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-black/60 to-transparent z-10 pointer-events-none" />
      )}
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

    try {
      const seen = localStorage.getItem('genre_swipe_hint_seen');
      if (seen) return;
    } catch {
      // localStorage not available (private browsing)
      return;
    }

    setShow(true);
    const timer = setTimeout(() => {
      setShow(false);
      try {
        localStorage.setItem('genre_swipe_hint_seen', 'true');
      } catch {
        // Ignore - localStorage not available
      }
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
