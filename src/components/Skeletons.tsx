// ============================================================================
// SKELETON LOADERS
// Reusable loading states for better perceived performance
// ============================================================================

'use client';

import { motion } from 'framer-motion';

// ============================================================================
// BASE SKELETON - Animated pulse effect
// ============================================================================

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-white/10 rounded ${className}`}
    />
  );
}

// ============================================================================
// CLIP CARD SKELETON - For dashboard/discover pages
// ============================================================================

export function ClipCardSkeleton() {
  return (
    <div className="relative w-full aspect-[9/16] rounded-2xl overflow-hidden bg-white/5">
      {/* Video area */}
      <Skeleton className="absolute inset-0 rounded-none" />

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />

          <div className="flex-1 space-y-2">
            {/* Username */}
            <Skeleton className="h-4 w-24" />
            {/* Genre tag */}
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </div>

      {/* Right side actions */}
      <div className="absolute right-3 bottom-20 flex flex-col gap-4">
        <Skeleton className="w-10 h-10 rounded-full" />
        <Skeleton className="w-10 h-10 rounded-full" />
        <Skeleton className="w-10 h-10 rounded-full" />
      </div>
    </div>
  );
}

// ============================================================================
// LEADERBOARD ROW SKELETON
// ============================================================================

export function LeaderboardRowSkeleton({ index = 0 }: { index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10"
    >
      {/* Rank */}
      <Skeleton className="w-8 h-8 rounded-lg" />

      {/* Avatar */}
      <Skeleton className="w-10 h-10 rounded-full flex-shrink-0" />

      {/* Info */}
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-20" />
      </div>

      {/* Score */}
      <div className="text-right space-y-1">
        <Skeleton className="h-5 w-16 ml-auto" />
        <Skeleton className="h-3 w-12 ml-auto" />
      </div>
    </motion.div>
  );
}

export function LeaderboardSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <LeaderboardRowSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

// ============================================================================
// PROFILE STATS SKELETON
// ============================================================================

export function ProfileStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.05 }}
          className="p-4 rounded-xl bg-white/5 border border-white/10"
        >
          <Skeleton className="w-8 h-8 rounded-lg mb-2" />
          <Skeleton className="h-6 w-16 mb-1" />
          <Skeleton className="h-3 w-12" />
        </motion.div>
      ))}
    </div>
  );
}

// ============================================================================
// COMMENT SKELETON
// ============================================================================

export function CommentSkeleton({ index = 0 }: { index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="flex gap-3 p-3"
    >
      {/* Avatar */}
      <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />

      <div className="flex-1 space-y-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-12" />
        </div>

        {/* Comment text */}
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </motion.div>
  );
}

export function CommentsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <CommentSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

// ============================================================================
// BADGE SKELETON
// ============================================================================

export function BadgeSkeleton({ index = 0 }: { index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05 }}
      className="flex flex-col items-center gap-2 p-3"
    >
      <Skeleton className="w-14 h-14 rounded-xl" />
      <Skeleton className="h-3 w-16" />
    </motion.div>
  );
}

export function BadgesSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <BadgeSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

// ============================================================================
// CLIP THUMBNAIL SKELETON - Smaller version for grids
// ============================================================================

export function ClipThumbnailSkeleton({ index = 0 }: { index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.03 }}
      className="relative aspect-[9/16] rounded-xl overflow-hidden bg-white/5"
    >
      <Skeleton className="absolute inset-0 rounded-none" />

      {/* Bottom stats */}
      <div className="absolute bottom-2 left-2 right-2">
        <Skeleton className="h-4 w-12" />
      </div>
    </motion.div>
  );
}

export function ClipGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <ClipThumbnailSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

// ============================================================================
// FULL PAGE LOADING - Centered infinity symbol
// ============================================================================

export function FullPageLoader() {
  return (
    <div className="h-screen bg-black flex items-center justify-center">
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

// ============================================================================
// SECTION LOADING - For partial page loads
// ============================================================================

export function SectionLoader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="w-8 h-8 border-2 border-white/30 border-t-cyan-400 rounded-full"
      />
      <p className="text-white/50 text-sm mt-3">{text}</p>
    </div>
  );
}

export default Skeleton;
