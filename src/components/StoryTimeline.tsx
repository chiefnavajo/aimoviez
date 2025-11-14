'use client';

// StoryTimeline - Shows all 75 segments with progress

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, X } from 'lucide-react';
import { TimelineSegment } from '@/types';
import { GenreBadge } from '@/lib/genre';

interface StoryTimelineProps {
  segments: TimelineSegment[];
}

export default function StoryTimeline({ segments }: StoryTimelineProps) {
  const [selectedSegment, setSelectedSegment] = useState<TimelineSegment | null>(null);

  const getSegmentStyle = (segment: TimelineSegment) => {
    switch (segment.status) {
      case 'done':
        return 'bg-gradient-to-br from-cyan-500/40 to-violet-500/40 border-cyan-400/60 shadow-[0_0_15px_rgba(6,182,212,0.4)] cursor-pointer hover:scale-110';
      case 'open':
        return 'bg-gradient-to-br from-cyan-500 to-violet-500 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.6)] animate-pulse cursor-pointer scale-110';
      case 'upcoming':
        return 'bg-white/5 border-white/10 hover:bg-white/10 cursor-default';
    }
  };

  const completedCount = segments.filter(s => s.status === 'done').length;
  const progressPercent = (completedCount / segments.length) * 100;

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Film size={24} className="text-cyan-400" />
            Story Timeline
          </h3>
          <p className="text-sm text-white/60 mt-1">
            {completedCount} of {segments.length} scenes complete
          </p>
        </div>

        {/* Progress Bar */}
        <div className="flex-1 max-w-md">
          <div className="h-2 rounded-full bg-white/5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-cyan-500 to-violet-500"
            />
          </div>
          <p className="text-xs text-right text-white/60 mt-1">
            {progressPercent.toFixed(1)}% complete
          </p>
        </div>
      </div>

      {/* Timeline Grid */}
      <div className="p-6 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl">
        <div className="relative">
          {/* Scroll container */}
          <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
            <div className="flex gap-2 pb-4 min-w-max">
              {segments.map((segment) => (
                <motion.button
                  key={segment.segment}
                  onClick={() => {
                    if (segment.status === 'done' || segment.status === 'open') {
                      setSelectedSegment(segment);
                    }
                  }}
                  whileHover={
                    segment.status !== 'upcoming'
                      ? { scale: 1.1, y: -4 }
                      : {}
                  }
                  className={`
                    relative flex-shrink-0 w-12 h-16 rounded-lg border-2
                    transition-all duration-300 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050510]
                    ${getSegmentStyle(segment)}
                  `}
                  aria-label={`Segment ${segment.segment}: ${segment.status}`}
                >
                  {/* Segment number */}
                  <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                    {segment.segment}
                  </span>

                  {/* Thumbnail overlay for completed */}
                  {segment.status === 'done' && segment.thumbUrl && (
                    <div className="absolute inset-0 rounded-lg overflow-hidden opacity-0 hover:opacity-100 transition-opacity">
                      <img
                        src={segment.thumbUrl}
                        alt={`Scene ${segment.segment}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40" />
                    </div>
                  )}

                  {/* Status indicator */}
                  {segment.status === 'open' && (
                    <motion.div
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-400 border-2 border-[#050510]"
                    />
                  )}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/10 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-gradient-to-br from-cyan-500 to-violet-500" />
              <span className="text-white/60">Complete</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-gradient-to-br from-cyan-500 to-violet-500 animate-pulse" />
              <span className="text-white/60">Active</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm bg-white/5 border border-white/10" />
              <span className="text-white/60">Upcoming</span>
            </div>
          </div>
        </div>
      </div>

      {/* Segment Detail Modal */}
      <AnimatePresence>
        {selectedSegment && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedSegment(null)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            >
              {/* Modal */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-md rounded-2xl bg-[#0a0a18] border border-white/10 shadow-2xl overflow-hidden"
              >
                {/* Close button */}
                <button
                  onClick={() => setSelectedSegment(null)}
                  className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400"
                  aria-label="Close modal"
                >
                  <X size={18} className="text-white" />
                </button>

                {/* Content */}
                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="text-2xl font-bold text-white">
                      Scene {selectedSegment.segment}
                    </h3>
                    <p className="text-sm text-white/60 mt-1">
                      {selectedSegment.status === 'done' ? 'Completed' : 'Currently Active'}
                    </p>
                  </div>

                  {selectedSegment.genre && (
                    <GenreBadge genre={selectedSegment.genre} size="lg" />
                  )}

                  {selectedSegment.status === 'done' && selectedSegment.thumbUrl && (
                    <div className="aspect-[9/16] rounded-xl overflow-hidden">
                      <img
                        src={selectedSegment.thumbUrl}
                        alt={`Scene ${selectedSegment.segment}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  {selectedSegment.status === 'open' && (
                    <div className="p-6 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 border border-cyan-400/40 text-center">
                      <p className="text-white/80 font-medium">
                        🔥 This scene is currently active!
                      </p>
                      <p className="text-sm text-white/60 mt-2">
                        Vote for your favorite clip to influence the story
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
