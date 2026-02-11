'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Film, Plus, Clock, CheckCircle2, AlertCircle, Loader2, Pause, Trash2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { AuthGuard } from '@/hooks/useAuth';
import { useMovieProjects, useMovieAccess } from '@/hooks/useMovieProject';
import { useCsrf } from '@/hooks/useCsrf';
import BottomNavigation from '@/components/BottomNavigation';

function getStatusBadge(status: string) {
  switch (status) {
    case 'completed':
      return <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 className="w-3 h-3" />Completed</span>;
    case 'generating':
    case 'script_generating':
      return <span className="flex items-center gap-1 text-xs text-cyan-400"><Loader2 className="w-3 h-3 animate-spin" />Generating</span>;
    case 'script_ready':
      return <span className="flex items-center gap-1 text-xs text-purple-400"><Clock className="w-3 h-3" />Script Ready</span>;
    case 'paused':
      return <span className="flex items-center gap-1 text-xs text-yellow-400"><Pause className="w-3 h-3" />Paused</span>;
    case 'failed':
      return <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="w-3 h-3" />Failed</span>;
    case 'cancelled':
      return <span className="flex items-center gap-1 text-xs text-white/40"><XCircle className="w-3 h-3" />Cancelled</span>;
    default:
      return <span className="flex items-center gap-1 text-xs text-white/40"><Clock className="w-3 h-3" />{status}</span>;
  }
}

function MovieListContent() {
  const router = useRouter();
  const csrf = useCsrf();
  const { hasAccess, isLoading: accessLoading } = useMovieAccess();
  const { projects, isLoading, refetch } = useMovieProjects();
  const [deleting, setDeleting] = useState<string | null>(null);

  if (accessLoading || isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <Film className="w-16 h-16 text-purple-500/30 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">AI Movie Studio</h1>
          <p className="text-white/50 mb-6">
            This feature is invite-only. Contact an admin to get access to create AI-generated movies from your text.
          </p>
          <Link href="/dashboard" className="px-6 py-3 bg-white/10 rounded-xl text-white/70 hover:bg-white/20 transition">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const handleDelete = async (projectId: string) => {
    if (!confirm('Delete this project? This cannot be undone.')) return;
    setDeleting(projectId);
    try {
      const res = await csrf.fetch(`/api/movie/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete');
        return;
      }
      toast.success('Project deleted');
      refetch();
    } catch {
      toast.error('Failed to delete project');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <div className="max-w-3xl mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Film className="w-6 h-6 text-purple-400" />
              Movie Studio
            </h1>
            <p className="text-sm text-white/40 mt-1">Create AI-generated movies from text</p>
          </div>
          <Link
            href="/movie/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-xl text-sm font-medium hover:opacity-90 transition"
          >
            <Plus className="w-4 h-4" />
            New Movie
          </Link>
        </div>

        {/* Project List */}
        {projects.length === 0 ? (
          <div className="bg-white/5 rounded-2xl p-12 text-center border border-white/10">
            <Film className="w-12 h-12 text-white/20 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No projects yet</h3>
            <p className="text-white/40 mb-6 text-sm">Upload your text and let AI create a movie for you.</p>
            <Link
              href="/movie/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 rounded-xl text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Create Your First Movie
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {projects.map((project) => (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-white/5 rounded-xl border border-white/10 hover:border-white/20 transition overflow-hidden"
                >
                  <button
                    onClick={() => router.push(`/movie/${project.id}`)}
                    className="w-full text-left px-5 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{project.title}</h3>
                        <p className="text-sm text-white/40 mt-1 line-clamp-1">{project.description || 'No description'}</p>
                        <div className="flex items-center gap-4 mt-2">
                          {getStatusBadge(project.status)}
                          <span className="text-xs text-white/30">
                            {project.completed_scenes}/{project.total_scenes} scenes
                          </span>
                          <span className="text-xs text-white/30">
                            {project.target_duration_minutes} min
                          </span>
                          <span className="text-xs text-white/30">
                            {new Date(project.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      {/* Progress ring for generating */}
                      {(project.status === 'generating') && project.total_scenes > 0 && (
                        <div className="flex-shrink-0 w-12 h-12 relative">
                          <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                            <path
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3"
                            />
                            <path
                              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              fill="none" stroke={`url(#grad-${project.id})`} strokeWidth="3"
                              strokeDasharray={`${(project.completed_scenes / project.total_scenes) * 100}, 100`}
                            />
                            <defs>
                              <linearGradient id={`grad-${project.id}`}>
                                <stop offset="0%" stopColor="#a855f7" />
                                <stop offset="100%" stopColor="#06b6d4" />
                              </linearGradient>
                            </defs>
                          </svg>
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                            {Math.round((project.completed_scenes / project.total_scenes) * 100)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </button>

                  {/* Delete button for deletable statuses */}
                  {['draft', 'completed', 'failed', 'cancelled'].includes(project.status) && (
                    <div className="px-5 pb-3 flex justify-end">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(project.id); }}
                        disabled={deleting === project.id}
                        className="text-xs text-red-400/60 hover:text-red-400 flex items-center gap-1 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                        {deleting === project.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
      <BottomNavigation />
    </div>
  );
}

export default function MoviePage() {
  return (
    <AuthGuard>
      <MovieListContent />
    </AuthGuard>
  );
}
