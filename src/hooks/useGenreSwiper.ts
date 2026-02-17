'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { LAUNCH_GENRES, getGenreEmoji, getGenreLabel } from '@/lib/genres';

/**
 * Active season info from /api/seasons/active
 */
export interface ActiveSeason {
  id: string;
  genre: string;
  label: string;
  emoji: string;
  currentSlot: number;
  totalSlots: number;
  clipCount: number;
  progress: number;
}

interface UseGenreSwiperReturn {
  // Data
  genres: ActiveSeason[];
  currentGenre: ActiveSeason | null;
  currentIndex: number;
  isLoading: boolean;
  error: string | null;
  multiGenreEnabled: boolean;

  // Navigation
  goToGenre: (index: number) => void;
  goToGenreByCode: (code: string) => void;
  nextGenre: () => void;
  prevGenre: () => void;

  // State
  hasNext: boolean;
  hasPrev: boolean;

  // Actions
  refresh: () => Promise<void>;
}

const STORAGE_KEY = 'aimoviez_last_genre';

/**
 * Hook for managing genre swiper state
 * Fetches active seasons and provides navigation helpers
 */
export function useGenreSwiper(): UseGenreSwiperReturn {
  const [genres, setGenres] = useState<ActiveSeason[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [multiGenreEnabled, setMultiGenreEnabled] = useState(false);
  // Use ref to avoid re-triggering useEffect when initial load completes
  const isInitialLoadRef = useRef(true);

  // Fetch active seasons from API
  const fetchGenres = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch('/api/seasons/active', { signal });
      if (!res.ok) {
        throw new Error('Failed to fetch genres');
      }

      const data = await res.json();
      const seasons: ActiveSeason[] = data.seasons || [];

      setGenres(seasons);
      setMultiGenreEnabled(data.multiGenreEnabled ?? false);

      // Only restore from localStorage on initial mount, not on refresh
      // This prevents losing user's current position when calling refresh()
      if (isInitialLoadRef.current && typeof window !== 'undefined' && seasons.length > 0) {
        try {
          const savedGenre = localStorage.getItem(STORAGE_KEY);
          if (savedGenre) {
            const savedIndex = seasons.findIndex(s => s.genre === savedGenre);
            if (savedIndex >= 0) {
              setCurrentIndex(savedIndex);
            }
          }
        } catch {
          // localStorage not available (private browsing) - ignore
        }
        isInitialLoadRef.current = false;
      }
    } catch (err) {
      // HS-5: Ignore abort errors — they're expected on cleanup
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[useGenreSwiper] Error fetching genres:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);  // No dependencies - ref doesn't trigger re-render

  // Fetch on mount with abort controller
  useEffect(() => {
    const controller = new AbortController();
    fetchGenres(controller.signal);
    return () => controller.abort();
  }, [fetchGenres]);

  // Current genre derived from index
  const currentGenre = useMemo(() => {
    return genres[currentIndex] || null;
  }, [genres, currentIndex]);

  // Navigation helpers
  const goToGenre = useCallback((index: number) => {
    if (index >= 0 && index < genres.length) {
      setCurrentIndex(index);
      // Save to localStorage (with error handling for private browsing)
      const genre = genres[index];
      if (typeof window !== 'undefined' && genre) {
        try {
          localStorage.setItem(STORAGE_KEY, genre.genre);
        } catch {
          // localStorage not available - ignore
        }
      }
    }
  }, [genres]);

  const goToGenreByCode = useCallback((code: string) => {
    const index = genres.findIndex(g => g.genre === code);
    if (index >= 0) {
      goToGenre(index);
    }
  }, [genres, goToGenre]);

  const nextGenre = useCallback(() => {
    if (currentIndex < genres.length - 1) {
      goToGenre(currentIndex + 1);
    }
  }, [currentIndex, genres.length, goToGenre]);

  const prevGenre = useCallback(() => {
    if (currentIndex > 0) {
      goToGenre(currentIndex - 1);
    }
  }, [currentIndex, goToGenre]);

  // State flags
  const hasNext = currentIndex < genres.length - 1;
  const hasPrev = currentIndex > 0;

  return {
    genres,
    currentGenre,
    currentIndex,
    isLoading,
    error,
    multiGenreEnabled,
    goToGenre,
    goToGenreByCode,
    nextGenre,
    prevGenre,
    hasNext,
    hasPrev,
    refresh: fetchGenres,
  };
}

/**
 * Hook for keyboard navigation between genres and clips
 */
interface KeyboardNavigationOptions {
  onPrevGenre: () => void;
  onNextGenre: () => void;
  onPrevClip?: () => void;
  onNextClip?: () => void;
  enabled?: boolean;
}

export function useKeyboardNavigation({
  onPrevGenre,
  onNextGenre,
  onPrevClip,
  onNextClip,
  enabled = true,
}: KeyboardNavigationOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        // Horizontal: Switch genres
        case 'ArrowLeft':
          e.preventDefault();
          onPrevGenre();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onNextGenre();
          break;

        // Vertical: Switch clips within genre (optional)
        case 'ArrowUp':
          if (onPrevClip) {
            e.preventDefault();
            onPrevClip();
          }
          break;
        case 'ArrowDown':
          if (onNextClip) {
            e.preventDefault();
            onNextClip();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPrevGenre, onNextGenre, onPrevClip, onNextClip, enabled]);
}
