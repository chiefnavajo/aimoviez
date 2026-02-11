'use client';

import { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Play, Pause, RotateCcw, XCircle, Download,
  Sparkles, Film, Loader2, AlertCircle, CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { AuthGuard } from '@/hooks/useAuth';
import { useMovieProject } from '@/hooks/useMovieProject';
import { useCsrf } from '@/hooks/useCsrf';
import MovieScriptEditor from '@/components/movie/MovieScriptEditor';
import MovieProgressTracker from '@/components/movie/MovieProgressTracker';
import MoviePlaylistPlayer from '@/components/movie/MoviePlaylistPlayer';
import BottomNavigation from '@/components/BottomNavigation';

function MovieDashboardContent() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const csrf = useCsrf();
  const { project, scenes, isLoading, error, refetch } = useMovieProject(projectId);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const doAction = useCallback(async (action: string, successMsg: string) => {
    setActionLoading(action);
    try {
      const res = await csrf.fetch(`/api/movie/projects/${projectId}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || `Failed to ${action}`);
        return;
      }
      toast.success(successMsg);
      refetch();
    } catch {
      toast.error(`Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  }, [projectId, csrf, refetch]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-400/30 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Project Not Found</h2>
          <p className="text-white/40 mb-6">This project doesn&apos;t exist or you don&apos;t have access to it.</p>
          <Link href="/movie" className="px-6 py-3 bg-white/10 rounded-xl hover:bg-white/20 transition">
            Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  const status = project.status;
  const isGeneratingScript = status === 'script_generating';
  const isScriptReady = status === 'script_ready';
  const isDraft = status === 'draft';
  const isGenerating = status === 'generating';
  const isPaused = status === 'paused';
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <div className="max-w-3xl mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <Link href="/movie" className="text-white/50 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">{project.title}</h1>
            <p className="text-sm text-white/40">{project.model} &middot; {project.target_duration_minutes} min</p>
          </div>
        </div>

        {/* Status Banner */}
        {isFailed && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-400">Generation Failed</p>
              <p className="text-xs text-red-300/60 mt-1">{project.error_message || 'An error occurred during generation.'}</p>
            </div>
          </div>
        )}

        {isGeneratingScript && (
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl px-4 py-4 mb-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-purple-400 animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-purple-300">Generating Script...</p>
              <p className="text-xs text-purple-300/60 mt-1">AI is analyzing your text and creating scenes. This may take a minute.</p>
            </div>
          </div>
        )}

        {isCompleted && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-300">Movie Complete!</p>
              <p className="text-xs text-green-300/60 mt-0.5">{project.total_scenes} scenes &middot; {project.spent_credits} credits used</p>
            </div>
            <Link
              href={`/movie/${projectId}/watch`}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 rounded-lg text-sm font-medium hover:bg-green-700 transition"
            >
              <Play className="w-4 h-4" />
              Watch
            </Link>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2 mb-6">
          {isDraft && (
            <button
              onClick={() => doAction('generate-script', 'Script generation started!')}
              disabled={!!actionLoading}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-xl text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {actionLoading === 'generate-script' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Generate Script
            </button>
          )}

          {isScriptReady && (
            <button
              onClick={() => doAction('start', 'Generation started!')}
              disabled={!!actionLoading}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-xl text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {actionLoading === 'start' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Start Generation
            </button>
          )}

          {isGenerating && (
            <button
              onClick={() => doAction('pause', 'Generation paused')}
              disabled={!!actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 border border-yellow-500/30 rounded-xl text-sm text-yellow-300 hover:bg-yellow-500/30 transition disabled:opacity-50"
            >
              <Pause className="w-4 h-4" />
              Pause
            </button>
          )}

          {isPaused && (
            <button
              onClick={() => doAction('resume', 'Generation resumed!')}
              disabled={!!actionLoading}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-xl text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              {actionLoading === 'resume' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Resume
            </button>
          )}

          {(isGenerating || isPaused) && (
            <button
              onClick={() => {
                if (confirm('Cancel this generation? Pending scenes will be skipped.')) {
                  doAction('cancel', 'Generation cancelled');
                }
              }}
              disabled={!!actionLoading}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 border border-red-500/30 rounded-xl text-sm text-red-300 hover:bg-red-500/30 transition disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Cancel
            </button>
          )}

          {isCompleted && project.final_video_url && (
            <a
              href={`/api/movie/projects/${projectId}/download`}
              className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-xl text-sm hover:bg-white/20 transition"
            >
              <Download className="w-4 h-4" />
              Download MP4
            </a>
          )}
        </div>

        {/* Content based on status */}
        {(isGenerating || isPaused || isCompleted || isFailed) && scenes.length > 0 && (
          <div className="mb-6">
            <MovieProgressTracker
              totalScenes={project.total_scenes}
              completedScenes={project.completed_scenes}
              currentScene={project.current_scene}
              status={project.status}
              scenes={scenes}
              spentCredits={project.spent_credits}
              estimatedCredits={project.estimated_credits}
            />
          </div>
        )}

        {/* Preview player for completed scenes during generation */}
        {(isGenerating || isPaused) && scenes.some(s => s.public_video_url || s.video_url) && (
          <div className="mb-6">
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
              <Film className="w-5 h-5 text-purple-400" />
              Preview
            </h3>
            <MoviePlaylistPlayer
              scenes={scenes}
              title={project.title}
              autoPlay={false}
            />
          </div>
        )}

        {/* Completed: full player */}
        {isCompleted && scenes.some(s => s.public_video_url || s.video_url) && (
          <div className="mb-6">
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
              <Film className="w-5 h-5 text-purple-400" />
              Movie Player
            </h3>
            <MoviePlaylistPlayer
              scenes={scenes}
              title={project.title}
              autoPlay={false}
            />
          </div>
        )}

        {/* Script Editor (shown for script_ready and draft with scenes) */}
        {(isScriptReady || (isDraft && scenes.length > 0)) && (
          <MovieScriptEditor
            projectId={projectId}
            scenes={scenes}
            onSaved={refetch}
          />
        )}

        {/* Draft with no scenes */}
        {isDraft && scenes.length === 0 && (
          <div className="bg-white/5 rounded-2xl p-8 text-center border border-white/10">
            <Sparkles className="w-12 h-12 text-purple-400/30 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Ready to Generate Script</h3>
            <p className="text-white/40 text-sm mb-1">
              Click &ldquo;Generate Script&rdquo; to have AI create a scene-by-scene script from your text.
            </p>
            <p className="text-white/30 text-xs">
              Source text: {project.source_text_length?.toLocaleString() || '?'} characters
            </p>
          </div>
        )}
      </div>
      <BottomNavigation />
    </div>
  );
}

export default function MovieDashboardPage() {
  return (
    <AuthGuard>
      <MovieDashboardContent />
    </AuthGuard>
  );
}
