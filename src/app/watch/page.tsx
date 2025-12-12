'use client';

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Maximize, Share2, List, X, ArrowLeft
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import BottomNavigation from '@/components/BottomNavigation';
import { AuthGuard } from '@/hooks/useAuth';

// ============================================================================
// WATCH MOVIE PAGE
// ============================================================================
// Seamless playback of all locked-in slots forming the complete movie
// ============================================================================

interface LockedSlot {
  id: string;
  slot_position: number;
  winning_clip_id: string;
  clip: {
    id: string;
    video_url: string;
    thumbnail_url: string;
    title: string;
    username: string;
    genre: string;
    vote_count: number;
  };
}

// Memoized playlist item to prevent unnecessary re-renders
interface PlaylistItemProps {
  slot: LockedSlot;
  index: number;
  isActive: boolean;
  isPlaying: boolean;
  onSelect: () => void;
}

const PlaylistItem = memo(function PlaylistItem({
  slot,
  index,
  isActive,
  isPlaying,
  onSelect
}: PlaylistItemProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
        isActive
          ? 'bg-cyan-500/20 border-2 border-cyan-500'
          : 'bg-white/5 hover:bg-white/10 border-2 border-transparent'
      }`}
    >
      <div className="relative w-16 h-24 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
        <Image
          src={slot.clip.thumbnail_url}
          alt={slot.clip.title}
          fill
          sizes="64px"
          className="object-cover"
        />
        {isActive && isPlaying && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <Play className="w-6 h-6 text-cyan-500" />
          </div>
        )}
      </div>

      <div className="flex-1 text-left">
        <div className="text-sm font-bold text-white/40 mb-1">
          Slot {slot.slot_position}
        </div>
        <div className="font-bold mb-1">{slot.clip.title}</div>
        <div className="text-xs text-white/60">
          @{slot.clip.username} • {slot.clip.genre}
        </div>
      </div>

      <div className="text-sm text-white/40">
        8s
      </div>
    </button>
  );
});

function WatchMoviePageContent() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const preloadedVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [currentSlotIndex, setCurrentSlotIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [autoplayEnabled, _setAutoplayEnabled] = useState(true);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch locked slots
  const { data: lockedSlots, isLoading } = useQuery<LockedSlot[]>({
    queryKey: ['locked-slots'],
    queryFn: async () => {
      const response = await fetch('/api/watch');
      if (!response.ok) throw new Error('Failed to fetch movie');
      return response.json();
    },
  });

  const currentSlot = lockedSlots?.[currentSlotIndex];
  const totalSlots = lockedSlots?.length || 0;

  // Use refs to access current values in event handlers without causing re-renders
  const currentSlotIndexRef = useRef(currentSlotIndex);
  const totalSlotsRef = useRef(totalSlots);
  const autoplayEnabledRef = useRef(autoplayEnabled);

  // Keep refs in sync with state
  useEffect(() => {
    currentSlotIndexRef.current = currentSlotIndex;
  }, [currentSlotIndex]);

  useEffect(() => {
    totalSlotsRef.current = totalSlots;
  }, [totalSlots]);

  useEffect(() => {
    autoplayEnabledRef.current = autoplayEnabled;
  }, [autoplayEnabled]);

  // Video preloading - preload next 2 slots for smooth playback
  useEffect(() => {
    if (!lockedSlots?.length) return;

    const cache = preloadedVideosRef.current;
    const slotsToPreload = [
      (currentSlotIndex + 1) % lockedSlots.length,
      (currentSlotIndex + 2) % lockedSlots.length,
    ].filter(idx => idx !== currentSlotIndex);

    const preloadIds = new Set<string>();
    slotsToPreload.forEach((index) => {
      const slot = lockedSlots[index];
      if (slot?.clip?.video_url) {
        preloadIds.add(slot.id);
        if (!cache.has(slot.id)) {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.muted = true;
          video.playsInline = true;
          video.src = slot.clip.video_url;
          video.load();
          cache.set(slot.id, video);
        }
      }
    });

    // Cleanup old preloaded videos
    cache.forEach((video, slotId) => {
      if (!preloadIds.has(slotId)) {
        video.src = '';
        video.load();
        cache.delete(slotId);
      }
    });
  }, [currentSlotIndex, lockedSlots]);

  // Cleanup preloaded videos on unmount
  useEffect(() => {
    const cache = preloadedVideosRef.current;
    return () => {
      cache.forEach((video) => {
        video.src = '';
        video.load();
      });
      cache.clear();
    };
  }, []);

  // Memoized event handlers to prevent re-creation on every render
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    setProgress((video.currentTime / video.duration) * 100);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
  }, []);

  const handleEnded = useCallback(() => {
    if (autoplayEnabledRef.current && currentSlotIndexRef.current < totalSlotsRef.current - 1) {
      // Auto-play next slot
      setCurrentSlotIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
    }
  }, []);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);

  // Video event handlers - only re-attaches when handlers change (they're stable via useCallback)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [handleTimeUpdate, handleLoadedMetadata, handleEnded, handlePlay, handlePause]);

  // Auto-hide controls
  useEffect(() => {
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    } else {
      setShowControls(true);
    }

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isPlaying, showControls]);

  // Toggle play/pause
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  };

  // Next slot
  const nextSlot = () => {
    if (currentSlotIndex < totalSlots - 1) {
      setCurrentSlotIndex(currentSlotIndex + 1);
    }
  };

  // Previous slot
  const previousSlot = () => {
    if (currentSlotIndex > 0) {
      setCurrentSlotIndex(currentSlotIndex - 1);
    }
  };

  // Jump to slot
  const jumpToSlot = (index: number) => {
    setCurrentSlotIndex(index);
    setShowPlaylist(false);
  };

  // Seek
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Share
  const handleShare = async () => {
    if (navigator.share && currentSlot) {
      try {
        await navigator.share({
          title: `AiMoviez - Slot ${currentSlot.slot_position}`,
          text: `Check out "${currentSlot.clip.title}" by @${currentSlot.clip.username}`,
          url: window.location.href,
        });
        toast.success('Shared!');
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          try {
            await navigator.clipboard.writeText(window.location.href);
            toast.success('Link copied!');
          } catch {
            toast.error('Failed to share');
          }
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(window.location.href);
        toast.success('Link copied!');
      } catch {
        toast.error('Failed to copy link');
      }
    }
  };

  // Format time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Skeleton loader for Watch page
  if (isLoading) {
    return (
      <div className="relative min-h-screen min-h-[100dvh] w-full bg-black overflow-hidden">
        {/* Skeleton video area */}
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
          {/* Centered play button skeleton */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="w-20 h-20 rounded-full bg-white/10 animate-pulse" />
          </div>
        </div>

        {/* Top bar skeleton */}
        <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between">
          <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
            <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
          </div>
        </div>

        {/* Bottom controls skeleton */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black via-black/80 to-transparent">
          {/* Title skeleton */}
          <div className="mb-4">
            <div className="h-7 w-48 bg-white/10 rounded-lg animate-pulse mb-2" />
            <div className="h-4 w-64 bg-white/10 rounded animate-pulse" />
          </div>

          {/* Progress bar skeleton */}
          <div className="w-full h-1.5 bg-white/10 rounded-full mb-4 animate-pulse" />

          {/* Controls skeleton */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-white/10 animate-pulse" />
              <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
              <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
              <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
              <div className="w-16 h-4 bg-white/10 rounded animate-pulse" />
            </div>
            <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!lockedSlots || lockedSlots.length === 0) {
    return (
      <div className="relative min-h-screen bg-black text-white flex flex-col pb-24">
        {/* Cyberpunk Back Button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          whileHover={{ scale: 1.05 }}
          onClick={() => router.back()}
          className="absolute top-3 left-3 z-30 p-[2px] rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 shadow-[0_0_15px_rgba(59,130,246,0.5),0_0_30px_rgba(147,51,234,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.7),0_0_40px_rgba(147,51,234,0.5)] transition-all duration-300"
        >
          <div className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-cyan-400/30">
            <ArrowLeft className="w-4 h-4 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,1)]" />
          </div>
        </motion.button>

        <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Play className="w-16 h-16 mx-auto mb-4 text-white/20" />
          <h2 className="text-2xl font-bold mb-2">No Movie Yet</h2>
          <p className="text-white/60 mb-6">The movie is still being created!</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 rounded-xl font-bold"
          >
            Go Vote
          </button>
        </div>
        </div>
        <BottomNavigation />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen min-h-[100dvh] w-full bg-black overflow-hidden">
      {/* Cyberpunk Back Button - Always Visible */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.05 }}
        onClick={() => router.back()}
        className="absolute top-4 left-4 z-30 p-[2px] rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 shadow-[0_0_20px_rgba(59,130,246,0.6),0_0_40px_rgba(147,51,234,0.4)] hover:shadow-[0_0_30px_rgba(59,130,246,0.8),0_0_60px_rgba(147,51,234,0.6)] transition-all duration-300"
      >
        <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-cyan-400/30">
          <ArrowLeft className="w-5 h-5 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,1)]" />
        </div>
      </motion.button>

      {/* Video Player */}
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <video
          ref={videoRef}
          src={currentSlot?.clip.video_url}
          className="w-full h-full object-contain"
          muted={isMuted}
          onClick={togglePlay}
          onMouseMove={() => setShowControls(true)}
        />
      </div>

      {/* Overlay Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/50 pointer-events-none"
          >
            {/* Top Bar */}
            <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between pointer-events-auto">
              <button
                onClick={() => router.back()}
                className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-black/70 transition-all"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPlaylist(!showPlaylist)}
                  className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-black/70 transition-all"
                >
                  <List className="w-6 h-6" />
                </button>
                <button
                  onClick={handleShare}
                  className="w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-black/70 transition-all"
                >
                  <Share2 className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Center Play Button */}
            {!isPlaying && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                onClick={togglePlay}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-white/30 transition-all pointer-events-auto"
              >
                <Play className="w-10 h-10 ml-1" />
              </motion.button>
            )}

            {/* Bottom Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-6 pointer-events-auto">
              {/* Slot Info */}
              <div className="mb-4">
                <div className="text-2xl font-black mb-1">
                  {currentSlot?.clip.title}
                </div>
                <div className="text-sm text-white/80">
                  Slot {currentSlot?.slot_position}/{totalSlots} • by @{currentSlot?.clip.username} • {currentSlot?.clip.genre}
                </div>
              </div>

              {/* Progress Bar */}
              <div
                onClick={handleSeek}
                className="w-full h-1.5 bg-white/20 rounded-full mb-4 cursor-pointer hover:h-2 transition-all"
              >
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Play/Pause */}
                  <button
                    onClick={togglePlay}
                    className="w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all"
                  >
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
                  </button>

                  {/* Previous */}
                  <button
                    onClick={previousSlot}
                    disabled={currentSlotIndex === 0}
                    className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all disabled:opacity-30"
                  >
                    <SkipBack className="w-5 h-5" />
                  </button>

                  {/* Next */}
                  <button
                    onClick={nextSlot}
                    disabled={currentSlotIndex === totalSlots - 1}
                    className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all disabled:opacity-30"
                  >
                    <SkipForward className="w-5 h-5" />
                  </button>

                  {/* Volume */}
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all"
                  >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>

                  {/* Time */}
                  <div className="text-sm font-medium">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Fullscreen */}
                  <button
                    onClick={toggleFullscreen}
                    className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all"
                  >
                    <Maximize className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Playlist Sidebar */}
      <AnimatePresence>
        {showPlaylist && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPlaylist(false)}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm z-40"
            />

            {/* Playlist */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-black/95 backdrop-blur-xl border-l border-white/10 z-50 overflow-y-auto"
            >
              <div className="sticky top-0 bg-black/80 backdrop-blur-xl border-b border-white/10 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-xl font-bold">Movie Playlist</h2>
                  <button
                    onClick={() => setShowPlaylist(false)}
                    className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                <p className="text-sm text-white/60">{totalSlots} slots locked in</p>
              </div>

              <div className="p-4 space-y-2">
                {lockedSlots.map((slot, index) => (
                  <PlaylistItem
                    key={slot.id}
                    slot={slot}
                    index={index}
                    isActive={index === currentSlotIndex}
                    isPlaying={isPlaying}
                    onSelect={() => jumpToSlot(index)}
                  />
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bottom Navigation (only visible when not fullscreen) */}
      {!isFullscreen && <BottomNavigation />}
    </div>
  );
}

// Wrap with AuthGuard for protected route
export default function WatchMoviePage() {
  return (
    <AuthGuard>
      <WatchMoviePageContent />
    </AuthGuard>
  );
}
