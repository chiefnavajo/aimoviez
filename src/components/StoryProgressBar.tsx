'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause } from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface Segment {
  id: string;
  slot_position: number;
  status: 'upcoming' | 'voting' | 'locked';
  winning_clip?: {
    id: string;
    video_url: string;
    thumbnail_url: string;
    username: string;
    avatar_url: string;
    vote_count: number;
    genre: string;
  };
}

interface StoryProgressBarProps {
  segments: Segment[];
  totalSegments: number;
  currentIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  onSegmentSelect: (index: number) => void;
  onSeekWithinClip: (time: number) => void;
  clipDurations: number[];
}

// ============================================================================
// HELPER
// ============================================================================

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function StoryProgressBar({
  segments,
  totalSegments,
  currentIndex,
  currentTime,
  duration,
  isPlaying,
  onPlayPause,
  onSegmentSelect,
  onSeekWithinClip,
  clipDurations,
}: StoryProgressBarProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const prevIndexRef = useRef(currentIndex);

  const completedSegments = segments.filter(s => s.status === 'locked' && s.winning_clip);
  const completedCount = completedSegments.length;
  const currentSegment = completedSegments[currentIndex];

  // Detect segment changes and suppress transitions briefly
  useEffect(() => {
    if (prevIndexRef.current !== currentIndex) {
      setIsTransitioning(true);
      prevIndexRef.current = currentIndex;
      // Allow transitions again after a short delay
      const timer = setTimeout(() => setIsTransitioning(false), 150);
      return () => clearTimeout(timer);
    }
  }, [currentIndex]);

  // Memoize segment start times
  const segmentStartTimes = useMemo(() => {
    const times: number[] = [];
    let accumulated = 0;
    for (let i = 0; i < completedCount; i++) {
      times.push(accumulated);
      accumulated += clipDurations[i] || 8;
    }
    return times;
  }, [clipDurations, completedCount]);

  // Calculate total duration
  const totalDuration = useMemo(() => {
    if (clipDurations.length === completedCount && clipDurations.length > 0) {
      return clipDurations.reduce((sum, d) => sum + d, 0);
    }
    return completedCount * 8;
  }, [clipDurations, completedCount]);

  // Calculate progress directly from props - no intermediate state
  const progress = useMemo(() => {
    if (totalDuration <= 0 || completedCount === 0) return 0;

    const timeBeforeCurrent = segmentStartTimes[currentIndex] || 0;
    // Use the passed duration prop if clipDurations[currentIndex] isn't available yet
    const currentClipDuration = clipDurations[currentIndex] || duration || 8;
    const clampedCurrentTime = Math.max(0, Math.min(currentTime, currentClipDuration));
    const overallCurrentTime = timeBeforeCurrent + clampedCurrentTime;

    return Math.max(0, Math.min(100, (overallCurrentTime / totalDuration) * 100));
  }, [currentIndex, currentTime, segmentStartTimes, clipDurations, totalDuration, completedCount, duration]);

  // Calculate display time
  const overallCurrentTime = useMemo(() => {
    const timeBeforeCurrent = segmentStartTimes[currentIndex] || 0;
    const currentClipDuration = clipDurations[currentIndex] || duration || 8;
    const clampedCurrentTime = Math.max(0, Math.min(currentTime, currentClipDuration));
    return timeBeforeCurrent + clampedCurrentTime;
  }, [currentIndex, currentTime, segmentStartTimes, clipDurations, duration]);

  // Seek to position
  const seekToPosition = (percentage: number) => {
    const targetTime = (percentage / 100) * totalDuration;
    let accumulatedTime = 0;

    for (let i = 0; i < completedCount; i++) {
      const clipDuration = clipDurations[i] || 8;

      if (accumulatedTime + clipDuration >= targetTime) {
        const timeWithinClip = targetTime - accumulatedTime;

        if (i !== currentIndex) {
          onSegmentSelect(i);
        }
        onSeekWithinClip(Math.max(0, Math.min(timeWithinClip, clipDuration)));
        return;
      }
      accumulatedTime += clipDuration;
    }

    if (completedCount > 0) {
      onSegmentSelect(completedCount - 1);
      onSeekWithinClip(clipDurations[completedCount - 1] || 8);
    }
  };

  // Handle seek
  const handleSeek = (clientX: number) => {
    if (!progressRef.current) return;

    const rect = progressRef.current.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    seekToPosition(percentage);
  };

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    handleSeek(clientX);
  };

  // Global events for dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      handleSeek(clientX);
    };

    const handleGlobalEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleGlobalMove);
    window.addEventListener('mouseup', handleGlobalEnd);
    window.addEventListener('touchmove', handleGlobalMove, { passive: false });
    window.addEventListener('touchend', handleGlobalEnd);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalEnd);
      window.removeEventListener('touchmove', handleGlobalMove);
      window.removeEventListener('touchend', handleGlobalEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  if (completedCount === 0) {
    return null;
  }

  return (
    <div className="w-full" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3">
        {/* Play/Pause */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={onPlayPause}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 text-white" fill="white" />
          ) : (
            <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
          )}
        </motion.button>

        {/* Progress Bar */}
        <div className="flex-1 flex flex-col gap-1">
          <div
            ref={progressRef}
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
            className={`relative h-1.5 rounded-full bg-white/20 overflow-visible select-none ${
              isDragging ? 'cursor-grabbing' : 'cursor-pointer'
            }`}
          >
            {/* Progress fill */}
            <div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-400 via-purple-500 to-pink-500 rounded-full"
              style={{
                width: `${progress}%`,
                transition: (isDragging || isTransitioning) ? 'none' : 'width 100ms ease-out'
              }}
            />

            {/* Drag handle */}
            <div
              className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-lg transition-transform duration-100 ${
                isDragging ? 'scale-125' : 'scale-100'
              }`}
              style={{
                left: `calc(${progress}% - 7px)`,
                transition: (isDragging || isTransitioning) ? 'transform 100ms ease-out' : 'left 100ms ease-out, transform 100ms ease-out'
              }}
            />
          </div>

          {/* Info row */}
          <div className="flex items-center justify-between">
            <span className="text-white/70 text-[11px]">
              Segment <span className="text-cyan-400 font-bold">{currentSegment?.slot_position || currentIndex + 1}</span>
              <span className="text-white/60"> / {totalSegments}</span>
            </span>
            <span className="text-white/60 text-[11px] font-mono">
              {formatTime(overallCurrentTime)} / {formatTime(totalDuration)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
