// Genre constants, color mappings, and badge helper component

import { Genre, GENRES } from '@/types';

export { GENRES };

export const GENRE_META: Record<Genre, {
  emoji: string;
  label: string;
  bg: string;
  border: string;
  glow: string;
  text: string;
}> = {
  comedy: {
    emoji: '🎭',
    label: 'Comedy',
    bg: 'bg-yellow-500/20',
    border: 'border-yellow-500/40',
    glow: 'shadow-[0_0_20px_rgba(234,179,8,0.3)]',
    text: 'text-yellow-300'
  },
  thriller: {
    emoji: '😱',
    label: 'Thriller',
    bg: 'bg-red-500/20',
    border: 'border-red-500/40',
    glow: 'shadow-[0_0_20px_rgba(239,68,68,0.3)]',
    text: 'text-red-300'
  },
  action: {
    emoji: '💥',
    label: 'Action',
    bg: 'bg-orange-500/20',
    border: 'border-orange-500/40',
    glow: 'shadow-[0_0_20px_rgba(249,115,22,0.3)]',
    text: 'text-orange-300'
  },
  animation: {
    emoji: '🎨',
    label: 'Animation',
    bg: 'bg-purple-500/20',
    border: 'border-purple-500/40',
    glow: 'shadow-[0_0_20px_rgba(168,85,247,0.3)]',
    text: 'text-purple-300'
  }
};

/**
 * GenreBadge component - renders a styled genre pill
 */
interface GenreBadgeProps {
  genre: Genre;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function GenreBadge({ genre, size = 'md', showLabel = true }: GenreBadgeProps) {
  const meta = GENRE_META[genre];
  
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-1.5 text-base'
  };

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full
        ${meta.bg} ${meta.border} ${meta.text}
        border ${sizeClasses[size]}
        font-medium backdrop-blur-sm
        transition-all duration-300 hover:${meta.glow}
      `}
      aria-label={`Genre: ${meta.label}`}
    >
      <span className="leading-none">{meta.emoji}</span>
      {showLabel && <span>{meta.label}</span>}
    </span>
  );
}

/**
 * Get genre metadata by key
 */
export function getGenreMeta(genre: Genre) {
  return GENRE_META[genre];
}
