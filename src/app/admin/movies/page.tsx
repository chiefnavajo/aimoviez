'use client';

import { useState, useEffect, useCallback } from 'react';
import { Film, UserPlus, Trash2, Loader2, Search, Eye } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useCsrf } from '@/hooks/useCsrf';
import BottomNavigation from '@/components/BottomNavigation';

interface AccessEntry {
  id: string;
  user_id: string;
  username: string;
  user_email: string;
  max_projects: number;
  max_scenes_per_project: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

interface ProjectEntry {
  id: string;
  title: string;
  status: string;
  model: string;
  total_scenes: number;
  completed_scenes: number;
  spent_credits: number;
  target_duration_minutes: number;
  created_at: string;
  user: { username: string; email: string } | null;
}

export default function AdminMoviesPage() {
  const { isLoading: authLoading, isAdmin } = useAdminAuth();
  const csrf = useCsrf();

  const [tab, setTab] = useState<'access' | 'projects'>('access');
  const [accessList, setAccessList] = useState<AccessEntry[]>([]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Grant access form
  const [grantEmail, setGrantEmail] = useState('');
  const [grantMaxProjects, setGrantMaxProjects] = useState(5);
  const [grantMaxScenes, setGrantMaxScenes] = useState(150);
  const [granting, setGranting] = useState(false);

  const fetchAccess = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/movies/access');
      if (res.ok) {
        const data = await res.json();
        setAccessList(data.access_records || []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/movies/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    Promise.all([fetchAccess(), fetchProjects()]).finally(() => setLoading(false));
  }, [isAdmin, fetchAccess, fetchProjects]);

  const handleGrant = async () => {
    if (!grantEmail.trim()) { toast.error('Enter an email'); return; }
    setGranting(true);
    try {
      const res = await csrf.fetch('/api/admin/movies/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: grantEmail.trim(),
          max_projects: grantMaxProjects,
          max_scenes_per_project: grantMaxScenes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to grant access');
        return;
      }
      toast.success('Access granted!');
      setGrantEmail('');
      fetchAccess();
    } catch {
      toast.error('Failed to grant access');
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (userId: string, username: string) => {
    if (!confirm(`Revoke movie access for ${username}?`)) return;
    try {
      const res = await csrf.fetch(`/api/admin/movies/access/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to revoke');
        return;
      }
      toast.success('Access revoked');
      fetchAccess();
    } catch {
      toast.error('Failed to revoke access');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-white/50">You need admin privileges.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      <div className="max-w-4xl mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Film className="w-6 h-6 text-purple-400" />
          <h1 className="text-2xl font-bold">Movie Admin</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/5 rounded-lg p-1 mb-6">
          <button
            onClick={() => setTab('access')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === 'access' ? 'bg-purple-600 text-white' : 'text-white/50 hover:text-white'
            }`}
          >
            User Access ({accessList.length})
          </button>
          <button
            onClick={() => setTab('projects')}
            className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition ${
              tab === 'projects' ? 'bg-purple-600 text-white' : 'text-white/50 hover:text-white'
            }`}
          >
            All Projects ({projects.length})
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
          </div>
        ) : tab === 'access' ? (
          <div className="space-y-6">
            {/* Grant Access Form */}
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-purple-400" />
                Grant Access
              </h3>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  placeholder="user@email.com"
                  className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:border-purple-500/50 focus:outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={grantMaxProjects}
                    onChange={(e) => setGrantMaxProjects(Number(e.target.value))}
                    min={1}
                    max={50}
                    className="w-20 bg-black/50 border border-white/10 rounded-lg px-2 py-2 text-sm text-white text-center"
                    title="Max projects"
                  />
                  <input
                    type="number"
                    value={grantMaxScenes}
                    onChange={(e) => setGrantMaxScenes(Number(e.target.value))}
                    min={10}
                    max={500}
                    className="w-20 bg-black/50 border border-white/10 rounded-lg px-2 py-2 text-sm text-white text-center"
                    title="Max scenes/project"
                  />
                  <button
                    onClick={handleGrant}
                    disabled={granting}
                    className="px-4 py-2 bg-purple-600 rounded-lg text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    {granting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Grant'}
                  </button>
                </div>
              </div>
              <p className="text-xs text-white/30 mt-2">Fields: email, max projects, max scenes per project</p>
            </div>

            {/* Access List */}
            {accessList.length === 0 ? (
              <p className="text-center text-white/40 py-8">No users have movie access yet.</p>
            ) : (
              <div className="space-y-2">
                {accessList.map((entry) => (
                  <div
                    key={entry.id}
                    className={`bg-white/5 rounded-lg px-4 py-3 border flex items-center gap-3 ${
                      entry.is_active ? 'border-white/10' : 'border-red-500/20 opacity-60'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {entry.username || entry.user_email}
                        {!entry.is_active && <span className="text-red-400 text-xs ml-2">(revoked)</span>}
                      </p>
                      <p className="text-xs text-white/30 truncate">{entry.user_email}</p>
                    </div>
                    <span className="text-xs text-white/40">{entry.max_projects} proj / {entry.max_scenes_per_project} scenes</span>
                    <span className="text-xs text-white/30">{new Date(entry.created_at).toLocaleDateString()}</span>
                    {entry.is_active && (
                      <button
                        onClick={() => handleRevoke(entry.user_id, entry.username || entry.user_email)}
                        className="text-red-400/60 hover:text-red-400 transition p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Projects Tab */
          <div className="space-y-2">
            {projects.length === 0 ? (
              <p className="text-center text-white/40 py-8">No movie projects yet.</p>
            ) : (
              projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/movie/${p.id}`}
                  className="block bg-white/5 rounded-lg px-4 py-3 border border-white/10 hover:border-white/20 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.title}</p>
                      <p className="text-xs text-white/30 mt-0.5">
                        by {p.user?.username || p.user?.email || 'Unknown'} &middot; {p.model} &middot; {p.target_duration_minutes} min
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                      p.status === 'generating' ? 'bg-cyan-500/20 text-cyan-400' :
                      p.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                      'bg-white/10 text-white/50'
                    }`}>
                      {p.status}
                    </span>
                    <span className="text-xs text-white/40">{p.completed_scenes}/{p.total_scenes}</span>
                    <span className="text-xs text-white/30">{p.spent_credits} cr</span>
                    <Eye className="w-4 h-4 text-white/30" />
                  </div>
                </Link>
              ))
            )}
          </div>
        )}
      </div>
      <BottomNavigation />
    </div>
  );
}
