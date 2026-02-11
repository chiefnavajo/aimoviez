'use client';

import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { Play, Pause, SkipForward, SkipBack, Maximize, List } from 'lucide-react';
import type { MovieScene } from '@/hooks/useMovieProject';

interface MoviePlaylistPlayerProps {
  scenes: MovieScene[];
  title: string;
  autoPlay?: boolean;
}

const SceneItem = memo(function SceneItem({
  scene,
  index,
  isActive,
  onSelect,
}: {
  scene: MovieScene;
  index: number;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition ${
        isActive
          ? 'bg-purple-500/20 border border-purple-500/30'
          : 'hover:bg-white/5'
      }`}
    >
      <span className={`text-xs font-mono w-6 text-center ${isActive ? 'text-purple-400' : 'text-white/40'}`}>
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isActive ? 'text-white' : 'text-white/70'}`}>
          {scene.scene_title || `Scene ${scene.scene_number}`}
        </p>
        {scene.duration_seconds && (
          <p className="text-xs text-white/40">{scene.duration_seconds}s</p>
        )}
      </div>
      {scene.status === 'completed' ? (
        <div className="w-2 h-2 rounded-full bg-green-500" />
      ) : (
        <div className="w-2 h-2 rounded-full bg-white/20" />
      )}
    </button>
  );
});

export default function MoviePlaylistPlayer({ scenes, title: _title, autoPlay = true }: MoviePlaylistPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);

  const completedScenes = scenes.filter(s => s.public_video_url || s.video_url);
  const currentScene = completedScenes[currentIndex];

  const shouldAutoPlayRef = useRef(autoPlay);

  const playScene = useCallback((index: number) => {
    if (index >= 0 && index < completedScenes.length) {
      shouldAutoPlayRef.current = true;
      setCurrentIndex(index);
    }
  }, [completedScenes.length]);

  // Load and play when currentIndex changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.load();
    if (shouldAutoPlayRef.current) {
      video.play().catch(() => {});
    }
  }, [currentIndex]);

  const handleEnded = useCallback(() => {
    // Auto-advance to next scene
    if (currentIndex < completedScenes.length - 1) {
      playScene(currentIndex + 1);
    } else {
      setIsPlaying(false);
    }
  }, [currentIndex, completedScenes.length, playScene]);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen().catch(() => {});
      }
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, []);

  if (completedScenes.length === 0) {
    return (
      <div className="bg-white/5 rounded-xl p-8 text-center">
        <p className="text-white/50">No scenes available yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Video Player */}
      <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
        <video
          ref={videoRef}
          src={currentScene?.public_video_url || currentScene?.video_url || ''}
          className="w-full h-full object-contain"
          onEnded={handleEnded}
          playsInline
          autoPlay={autoPlay}
        />

        {/* Controls Overlay */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button onClick={() => playScene(currentIndex - 1)} disabled={currentIndex === 0} className="text-white/70 hover:text-white disabled:text-white/20">
                <SkipBack className="w-5 h-5" />
              </button>
              <button onClick={togglePlay} className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30">
                {isPlaying ? <Pause className="w-5 h-5 text-white" /> : <Play className="w-5 h-5 text-white ml-0.5" />}
              </button>
              <button onClick={() => playScene(currentIndex + 1)} disabled={currentIndex >= completedScenes.length - 1} className="text-white/70 hover:text-white disabled:text-white/20">
                <SkipForward className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/50">
                {currentIndex + 1} / {completedScenes.length}
              </span>
              <button onClick={() => setShowPlaylist(!showPlaylist)} className="text-white/70 hover:text-white">
                <List className="w-5 h-5" />
              </button>
              <button onClick={toggleFullscreen} className="text-white/70 hover:text-white">
                <Maximize className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Scene Title */}
      <div className="text-center">
        <p className="text-white/50 text-sm">{currentScene?.scene_title || `Scene ${currentIndex + 1}`}</p>
      </div>

      {/* Playlist Sidebar */}
      {showPlaylist && (
        <div className="bg-white/5 rounded-xl p-3 max-h-60 overflow-y-auto space-y-1">
          <p className="text-xs text-white/40 px-3 mb-2 font-medium uppercase tracking-wider">Scenes</p>
          {completedScenes.map((scene, index) => (
            <SceneItem
              key={scene.id}
              scene={scene}
              index={index}
              isActive={index === currentIndex}
              onSelect={() => playScene(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
