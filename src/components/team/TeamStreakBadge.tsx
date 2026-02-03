// components/team/TeamStreakBadge.tsx
// Team streak display with fire animation

'use client';

import { Flame } from 'lucide-react';

interface TeamStreakBadgeProps {
  currentStreak: number;
  longestStreak?: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function TeamStreakBadge({
  currentStreak,
  longestStreak,
  size = 'md',
  showLabel = true,
}: TeamStreakBadgeProps) {
  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg',
  };

  const iconSizes = {
    sm: 14,
    md: 18,
    lg: 24,
  };

  const isActive = currentStreak > 0;
  const isHot = currentStreak >= 7;
  const isBlazing = currentStreak >= 14;

  return (
    <div className={`flex items-center gap-1.5 ${sizeClasses[size]}`}>
      <div
        className={`relative ${
          isBlazing
            ? 'text-orange-400 animate-pulse'
            : isHot
            ? 'text-orange-500'
            : isActive
            ? 'text-yellow-500'
            : 'text-gray-500'
        }`}
      >
        <Flame size={iconSizes[size]} fill={isActive ? 'currentColor' : 'none'} />
        {isBlazing && (
          <Flame
            size={iconSizes[size]}
            className="absolute inset-0 text-red-500 animate-ping opacity-50"
          />
        )}
      </div>

      <span
        className={`font-bold ${
          isBlazing
            ? 'text-orange-400'
            : isHot
            ? 'text-orange-500'
            : isActive
            ? 'text-yellow-500'
            : 'text-gray-500'
        }`}
      >
        {currentStreak}
      </span>

      {showLabel && (
        <span className="text-gray-400 font-normal">
          {currentStreak === 1 ? 'day' : 'days'}
        </span>
      )}

      {longestStreak !== undefined && longestStreak > currentStreak && (
        <span className="text-gray-500 text-xs ml-1">(best: {longestStreak})</span>
      )}
    </div>
  );
}
