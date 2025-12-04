'use client';

// VideoCard - Voting card for a single 8-second clip

import { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { ThumbsUp, Play } from 'lucide-react';
import { Clip } from '@/types';
import { GenreBadge } from '@/lib/genre';

interface VideoCardProps {
  clip: Clip;
  onVote: (clipId: string) => void;
  isAuthenticated: boolean;
}

export default function VideoCard({ clip, onVote, isAuthenticated }: VideoCardProps) {
  const [hasVoted, setHasVoted] = useState(false);
  const [showPulse, setShowPulse] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleVote = () => {
    if (!isAuthenticated) {
      // Handled by parent (should show sign-in)
      return;
    }

    if (hasVoted) return;

    setHasVoted(true);
    setShowPulse(true);
    onVote(clip.id);

    setTimeout(() => setShowPulse(false), 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleVote();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02, rotateY: 2 }}
      transition={{ duration: 0.3 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl overflow-hidden hover:shadow-cyan-500/20 hover:border-cyan-400/40 transition-all duration-300"
      tabIndex={0}
      onKeyDown={handleKeyPress}
      role="article"
      aria-label={`${clip.title} by ${clip.user.name}`}
    >
      {/* Video Preview */}
      <div className="relative aspect-[9/16] bg-gradient-to-br from-slate-900 to-slate-800 overflow-hidden">
        <Image
          src={clip.thumbnailUrl}
          alt={clip.title}
          fill
          sizes="(max-width: 768px) 50vw, 25vw"
          className="object-cover transition-transform duration-500 group-hover:scale-110"
        />
        
        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        
        {/* Play button overlay */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border-2 border-white/40">
                <Play size={28} className="text-white ml-1" fill="white" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Genre badge */}
        <div className="absolute top-3 left-3">
          <GenreBadge genre={clip.genre} size="sm" />
        </div>

        {/* Duration */}
        <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm text-xs font-mono text-white">
          {clip.duration}s
        </div>
      </div>

      {/* Card Content */}
      <div className="p-4 space-y-3">
        
        {/* Title */}
        <h3 className="text-lg font-bold text-white line-clamp-1">
          {clip.title}
        </h3>

        {/* Creator */}
        <div className="flex items-center gap-2">
          <Image
            src={clip.user.avatar}
            alt={clip.user.name}
            width={32}
            height={32}
            className="w-8 h-8 rounded-full border-2 border-white/20"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/80 font-medium truncate">
              {clip.user.name}
            </p>
          </div>
        </div>

        {/* Vote Section */}
        <div className="flex items-center gap-3 pt-2 border-t border-white/10">
          <button
            onClick={handleVote}
            disabled={hasVoted}
            className={`
              flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold
              transition-all duration-300 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050510]
              ${hasVoted
                ? 'bg-green-500/20 text-green-400 border border-green-500/40 cursor-not-allowed'
                : 'bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white hover:shadow-lg hover:shadow-cyan-500/50'
              }
            `}
            aria-label={`Vote for ${clip.title}`}
          >
            <ThumbsUp size={18} className={hasVoted ? 'fill-current' : ''} />
            <span>{hasVoted ? 'Voted' : 'Vote'}</span>
          </button>

          {/* Vote count */}
          <motion.div
            animate={showPulse ? { scale: [1, 1.3, 1] } : {}}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10"
          >
            <ThumbsUp size={16} className="text-cyan-400" />
            <span className="text-sm font-bold text-white">
              {clip.votes.toLocaleString()}
            </span>
          </motion.div>
        </div>
      </div>

      {/* Vote success pulse effect */}
      <AnimatePresence>
        {showPulse && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 2, opacity: [0, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 pointer-events-none"
          >
            <div className="absolute inset-0 rounded-2xl border-4 border-cyan-400" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
