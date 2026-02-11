'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Download, Share2, Film } from 'lucide-react';
import toast from 'react-hot-toast';
import { AuthGuard } from '@/hooks/useAuth';
import { useMovieProject } from '@/hooks/useMovieProject';
import MoviePlaylistPlayer from '@/components/movie/MoviePlaylistPlayer';
import BottomNavigation from '@/components/BottomNavigation';

function WatchContent() {
  const params = useParams();
  const projectId = params.id as string;
  const { project, scenes, isLoading } = useMovieProject(projectId);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="text-center">
          <Film className="w-16 h-16 text-white/20 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Project Not Found</h2>
          <p className="text-white/40 mb-6">This project doesn&apos;t exist or you don&apos;t have access.</p>
          <Link href="/movie" className="px-6 py-3 bg-white/10 rounded-xl hover:bg-white/20 transition">
            Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  const completedScenes = scenes.filter(s => s.public_video_url || s.video_url);

  if (completedScenes.length === 0) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-4">
        <div className="text-center">
          <Film className="w-16 h-16 text-white/20 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">No Scenes Available</h2>
          <p className="text-white/40 mb-6">This movie has no completed scenes yet.</p>
          <Link href={`/movie/${projectId}`} className="px-6 py-3 bg-white/10 rounded-xl hover:bg-white/20 transition">
            Back to Project
          </Link>
        </div>
      </div>
    );
  }

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: project.title, url });
      } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied!');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <div className="max-w-4xl mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={`/movie/${projectId}`} className="text-white/50 hover:text-white transition flex-shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl font-bold truncate">{project.title}</h1>
              <p className="text-sm text-white/40">
                {completedScenes.length} scenes &middot; {project.model}
                {project.total_duration_seconds ? ` · ${Math.round(project.total_duration_seconds / 60)} min` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleShare}
              className="p-2.5 bg-white/10 rounded-lg hover:bg-white/20 transition"
            >
              <Share2 className="w-4 h-4" />
            </button>
            {project.final_video_url && (
              <a
                href={`/api/movie/projects/${projectId}/download`}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-lg text-sm font-medium hover:opacity-90 transition"
              >
                <Download className="w-4 h-4" />
                Download
              </a>
            )}
          </div>
        </div>

        {/* Player */}
        <MoviePlaylistPlayer
          scenes={scenes}
          title={project.title}
          autoPlay={true}
        />

        {/* Description */}
        {project.description && (
          <div className="mt-6 bg-white/5 rounded-xl p-4 border border-white/10">
            <p className="text-sm text-white/60">{project.description}</p>
          </div>
        )}

        {/* Scene List */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-white/50 uppercase tracking-wider mb-3">All Scenes</h3>
          <div className="space-y-2">
            {scenes.map((scene) => (
              <div
                key={scene.id}
                className="bg-white/5 rounded-lg px-4 py-3 border border-white/10 flex items-center gap-3"
              >
                <span className="text-xs font-mono text-white/30 w-6 text-center">{scene.scene_number}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{scene.scene_title || `Scene ${scene.scene_number}`}</p>
                  {scene.narration_text && (
                    <p className="text-xs text-purple-300/50 italic truncate mt-0.5">{scene.narration_text}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {scene.duration_seconds && (
                    <span className="text-xs text-white/30">{scene.duration_seconds}s</span>
                  )}
                  {scene.status === 'completed' ? (
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-white/20" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <BottomNavigation />
    </div>
  );
}

export default function MovieWatchPage() {
  return (
    <AuthGuard>
      <WatchContent />
    </AuthGuard>
  );
}
