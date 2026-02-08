// Centralized genre definitions for multi-genre seasons
// Server-compatible (no React) - use genre.tsx for React components

/**
 * All available genres in the system
 */
export const GENRES = [
  { code: 'action', label: 'Action', emoji: '💥' },
  { code: 'comedy', label: 'Comedy', emoji: '🎭' },
  { code: 'horror', label: 'Horror', emoji: '👻' },
  { code: 'animation', label: 'Animation', emoji: '🎨' },
  { code: 'thriller', label: 'Thriller', emoji: '😱' },
  { code: 'sci-fi', label: 'Sci-Fi', emoji: '🚀' },
  { code: 'romance', label: 'Romance', emoji: '❤️' },
  { code: 'drama', label: 'Drama', emoji: '🎭' },
] as const;

/**
 * Genres to launch with initially (subset of all genres)
 */
export const LAUNCH_GENRES = ['action', 'comedy', 'horror', 'animation'] as const;

export type GenreCode = typeof GENRES[number]['code'];
export type LaunchGenreCode = typeof LAUNCH_GENRES[number];

/**
 * Map from genre code to genre definition for fast lookup
 */
export const GENRE_MAP = Object.fromEntries(
  GENRES.map(g => [g.code, g])
) as Record<GenreCode, typeof GENRES[number]>;

/**
 * Get emoji for a genre code
 */
export function getGenreEmoji(code: string): string {
  return GENRE_MAP[code as GenreCode]?.emoji || '🎥';
}

/**
 * Get label for a genre code
 */
export function getGenreLabel(code: string): string {
  return GENRE_MAP[code as GenreCode]?.label || code;
}

/**
 * Check if a genre is valid
 */
export function isValidGenre(code: string): code is GenreCode {
  return code in GENRE_MAP;
}

/**
 * Check if a genre is a launch genre
 */
export function isLaunchGenre(code: string): code is LaunchGenreCode {
  return LAUNCH_GENRES.includes(code as LaunchGenreCode);
}

/**
 * Get all genre codes as array
 */
export function getGenreCodes(): GenreCode[] {
  return GENRES.map(g => g.code);
}

/**
 * Get launch genre codes as array
 */
export function getLaunchGenreCodes(): LaunchGenreCode[] {
  return [...LAUNCH_GENRES];
}
