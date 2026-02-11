'use client';

import { Clock, CheckCircle2, AlertCircle, Loader2, Pause } from 'lucide-react';
import type { MovieScene } from '@/hooks/useMovieProject';

interface MovieProgressTrackerProps {
  totalScenes: number;
  completedScenes: number;
  currentScene: number;
  status: string;
  scenes: MovieScene[];
  spentCredits: number;
  estimatedCredits: number;
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
    case 'generating':
    case 'narrating':
    case 'merging': return <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />;
    case 'failed': return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'skipped': return <Pause className="w-3.5 h-3.5 text-yellow-400" />;
    default: return <Clock className="w-3.5 h-3.5 text-white/30" />;
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'completed': return 'bg-green-500';
    case 'generating':
    case 'narrating':
    case 'merging': return 'bg-cyan-500 animate-pulse';
    case 'failed': return 'bg-red-500';
    case 'skipped': return 'bg-yellow-500';
    default: return 'bg-white/20';
  }
}

export default function MovieProgressTracker({
  totalScenes,
  completedScenes,
  currentScene,
  status,
  scenes,
  spentCredits,
  estimatedCredits,
}: MovieProgressTrackerProps) {
  const progressPercent = totalScenes > 0 ? Math.round((completedScenes / totalScenes) * 100) : 0;

  // Estimate remaining time (2 min per scene for cron interval + generation time)
  const remainingScenes = totalScenes - completedScenes;
  const estimatedMinutes = remainingScenes * 3; // ~3 min avg per scene

  return (
    <div className="space-y-4">
      {/* Overall Progress Bar */}
      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Progress</span>
          <span className="text-sm text-white/60">{completedScenes}/{totalScenes} scenes</span>
        </div>
        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-white/40">
          <span>{progressPercent}%</span>
          {status === 'generating' && remainingScenes > 0 && (
            <span>~{estimatedMinutes} min remaining</span>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white/5 rounded-lg p-3 text-center border border-white/10">
          <p className="text-xs text-white/40">Status</p>
          <p className="text-sm font-medium capitalize mt-1">{status}</p>
        </div>
        <div className="bg-white/5 rounded-lg p-3 text-center border border-white/10">
          <p className="text-xs text-white/40">Current</p>
          <p className="text-sm font-medium mt-1">Scene {currentScene}</p>
        </div>
        <div className="bg-white/5 rounded-lg p-3 text-center border border-white/10">
          <p className="text-xs text-white/40">Credits</p>
          <p className="text-sm font-medium mt-1">{spentCredits}/{estimatedCredits}</p>
        </div>
      </div>

      {/* Scene-by-Scene Status */}
      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
        <p className="text-xs text-white/40 uppercase tracking-wider mb-3 font-medium">Scene Status</p>
        <div className="flex flex-wrap gap-1">
          {scenes.map((scene) => (
            <div
              key={scene.id}
              title={`Scene ${scene.scene_number}: ${scene.status}${scene.scene_title ? ` - ${scene.scene_title}` : ''}`}
              className="group relative"
            >
              <div className={`w-4 h-4 rounded-sm ${getStatusColor(scene.status)} cursor-default`} />
              {/* Tooltip on hover */}
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap bg-black border border-white/20 rounded px-2 py-1 text-xs">
                {scene.scene_number}: {scene.status}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-white/40">
          <span className="flex items-center gap-1">{getStatusIcon('completed')} Done</span>
          <span className="flex items-center gap-1">{getStatusIcon('generating')} Active</span>
          <span className="flex items-center gap-1">{getStatusIcon('pending')} Pending</span>
          <span className="flex items-center gap-1">{getStatusIcon('failed')} Failed</span>
        </div>
      </div>
    </div>
  );
}
