'use client';

// ============================================================================
// ADMIN USER MANAGEMENT
// View, search, ban/unban users
// ============================================================================

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowLeft,
  Search,
  Users,
  Ban,
  CheckCircle,
  Shield,
  ShieldOff,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Film,
  Heart,
  MessageCircle,
  Calendar,
  AlertTriangle,
  X,
  Eye,
  Edit3,
} from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';

interface UserData {
  id: string;
  username: string;
  email: string;
  avatar_url: string;
  created_at: string;
  is_banned: boolean;
  is_admin: boolean;
  ban_reason?: string;
  banned_at?: string;
  clip_count: number;
  vote_count: number;
}

interface UserDetail extends UserData {
  stats: {
    clips: number;
    votes: number;
    comments: number;
  };
  recentClips: Array<{
    id: string;
    title: string;
    status: string;
    vote_count: number;
    created_at: string;
  }>;
}

export default function AdminUsersPage() {
  const { isLoading: authLoading, isAdmin } = useAdminAuth();

  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'banned'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'most_clips' | 'most_votes'>('newest');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // User detail modal
  const [selectedUser, setSelectedUser] = useState<UserDetail | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);

  // Ban modal
  const [banningUser, setBanningUser] = useState<UserData | null>(null);
  const [banReason, setBanReason] = useState('');
  const [processingBan, setProcessingBan] = useState(false);

  // Edit username modal
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [processingUsername, setProcessingUsername] = useState(false);

  // Fetch users
  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search,
        status: statusFilter,
        sort: sortBy,
        page: page.toString(),
        limit: '20',
      });

      const response = await fetch(`/api/admin/users?${params}`);
      const data = await response.json();

      if (data.success) {
        setUsers(data.users);
        setTotalPages(data.totalPages);
        setTotal(data.total);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, search, statusFilter, sortBy, page]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Fetch user details
  const fetchUserDetail = async (userId: string) => {
    setLoadingUser(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}`);
      const data = await response.json();

      if (data.success) {
        setSelectedUser(data.user);
      }
    } catch (error) {
      console.error('Failed to fetch user details:', error);
    }
    setLoadingUser(false);
  };

  // Ban/Unban user
  const handleBanAction = async (userId: string, action: 'ban' | 'unban') => {
    setProcessingBan(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reason: action === 'ban' ? banReason : undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        setUsers(prev =>
          prev.map(u =>
            u.id === userId
              ? { ...u, is_banned: action === 'ban', ban_reason: banReason }
              : u
          )
        );
        setBanningUser(null);
        setBanReason('');

        // Update detail if open
        if (selectedUser?.id === userId) {
          setSelectedUser(prev =>
            prev ? { ...prev, is_banned: action === 'ban' } : null
          );
        }
      }
    } catch (error) {
      console.error('Failed to update user:', error);
    }
    setProcessingBan(false);
  };

  // Toggle admin status
  const handleAdminToggle = async (userId: string, makeAdmin: boolean) => {
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: makeAdmin ? 'make_admin' : 'remove_admin',
        }),
      });

      const data = await response.json();

      if (data.success) {
        setUsers(prev =>
          prev.map(u =>
            u.id === userId ? { ...u, is_admin: makeAdmin } : u
          )
        );

        if (selectedUser?.id === userId) {
          setSelectedUser(prev =>
            prev ? { ...prev, is_admin: makeAdmin } : null
          );
        }
      }
    } catch (error) {
      console.error('Failed to toggle admin:', error);
    }
  };

  // Update username
  const handleUsernameUpdate = async () => {
    if (!editingUser || !newUsername.trim()) return;

    const cleanUsername = newUsername.toLowerCase().trim();

    // Validate
    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
      setUsernameError('Username must be 3-20 characters');
      return;
    }
    if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
      setUsernameError('Only lowercase letters, numbers, and underscores');
      return;
    }

    setProcessingUsername(true);
    setUsernameError('');

    try {
      const response = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_username',
          username: cleanUsername,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Update local state
        setUsers(prev =>
          prev.map(u =>
            u.id === editingUser.id ? { ...u, username: cleanUsername } : u
          )
        );

        // Update detail modal if open
        if (selectedUser?.id === editingUser.id) {
          setSelectedUser(prev =>
            prev ? { ...prev, username: cleanUsername } : null
          );
        }

        setEditingUser(null);
        setNewUsername('');
      } else {
        setUsernameError(data.error || 'Failed to update username');
      }
    } catch (error) {
      console.error('Failed to update username:', error);
      setUsernameError('Network error. Please try again.');
    }

    setProcessingUsername(false);
  };

  // Open edit username modal
  const openEditUsername = (user: UserData) => {
    setEditingUser(user);
    setNewUsername(user.username);
    setUsernameError('');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-white/60">You don't have admin privileges.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/admin">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </motion.button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">User Management</h1>
                <p className="text-sm text-white/60">{total} total users</p>
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={fetchUsers}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </motion.button>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex flex-wrap gap-4 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by username or email..."
              className="w-full bg-white/10 border border-white/20 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-white/40 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }}
            className="bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value="all" className="bg-gray-900">All Users</option>
            <option value="active" className="bg-gray-900">Active</option>
            <option value="banned" className="bg-gray-900">Banned</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value as typeof sortBy); setPage(1); }}
            className="bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white focus:border-cyan-500 focus:outline-none"
          >
            <option value="newest" className="bg-gray-900">Newest First</option>
            <option value="oldest" className="bg-gray-900">Oldest First</option>
            <option value="most_clips" className="bg-gray-900">Most Clips</option>
            <option value="most_votes" className="bg-gray-900">Most Votes</option>
          </select>
        </div>
      </div>

      {/* Users List */}
      <div className="max-w-7xl mx-auto px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-20">
            <Users className="w-16 h-16 text-white/40 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No users found</h3>
            <p className="text-white/60">Try adjusting your search or filters</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4">
              {users.map((user) => (
                <motion.div
                  key={user.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`bg-white/5 rounded-xl border p-4 ${
                    user.is_banned ? 'border-red-500/30' : 'border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <Image
                      src={user.avatar_url || '/default-avatar.png'}
                      alt={user.username}
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-full bg-white/10"
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold truncate">@{user.username}</h3>
                        {user.is_admin && (
                          <span className="px-2 py-0.5 bg-purple-500/30 text-purple-300 rounded-full text-xs">
                            Admin
                          </span>
                        )}
                        {user.is_banned && (
                          <span className="px-2 py-0.5 bg-red-500/30 text-red-300 rounded-full text-xs">
                            Banned
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-white/60 truncate">{user.email}</p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-white/40">
                        <span className="flex items-center gap-1">
                          <Film className="w-3 h-3" />
                          {user.clip_count} clips
                        </span>
                        <span className="flex items-center gap-1">
                          <Heart className="w-3 h-3" />
                          {user.vote_count} votes
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(user.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => fetchUserDetail(user.id)}
                        className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-5 h-5" />
                      </motion.button>

                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => openEditUsername(user)}
                        className="p-2 bg-cyan-500/20 hover:bg-cyan-500/30 rounded-lg transition-colors text-cyan-400"
                        title="Edit Username"
                      >
                        <Edit3 className="w-5 h-5" />
                      </motion.button>

                      {user.is_banned ? (
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleBanAction(user.id, 'unban')}
                          className="p-2 bg-green-500/20 hover:bg-green-500/30 rounded-lg transition-colors text-green-400"
                          title="Unban User"
                        >
                          <CheckCircle className="w-5 h-5" />
                        </motion.button>
                      ) : (
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setBanningUser(user)}
                          className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg transition-colors text-red-400"
                          title="Ban User"
                        >
                          <Ban className="w-5 h-5" />
                        </motion.button>
                      )}

                      {user.is_admin ? (
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleAdminToggle(user.id, false)}
                          className="p-2 bg-purple-500/20 hover:bg-purple-500/30 rounded-lg transition-colors text-purple-400"
                          title="Remove Admin"
                        >
                          <ShieldOff className="w-5 h-5" />
                        </motion.button>
                      ) : (
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleAdminToggle(user.id, true)}
                          className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                          title="Make Admin"
                        >
                          <Shield className="w-5 h-5" />
                        </motion.button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-8">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 bg-white/10 rounded-lg disabled:opacity-50"
                >
                  <ChevronLeft className="w-5 h-5" />
                </motion.button>
                <span className="text-white/60">
                  Page {page} of {totalPages}
                </span>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 bg-white/10 rounded-lg disabled:opacity-50"
                >
                  <ChevronRight className="w-5 h-5" />
                </motion.button>
              </div>
            )}
          </>
        )}
      </div>

      {/* User Detail Modal */}
      <AnimatePresence>
        {(selectedUser || loadingUser) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => !loadingUser && setSelectedUser(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#1a1a2e] rounded-2xl border border-white/20 p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto"
            >
              {loadingUser ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
                </div>
              ) : selectedUser && (
                <>
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                      <Image
                        src={selectedUser.avatar_url || '/default-avatar.png'}
                        alt={selectedUser.username}
                        width={64}
                        height={64}
                        className="w-16 h-16 rounded-full"
                      />
                      <div>
                        <h2 className="text-xl font-bold">@{selectedUser.username}</h2>
                        <p className="text-sm text-white/60">{selectedUser.email}</p>
                        <div className="flex gap-2 mt-1">
                          {selectedUser.is_admin && (
                            <span className="px-2 py-0.5 bg-purple-500/30 text-purple-300 rounded-full text-xs">
                              Admin
                            </span>
                          )}
                          {selectedUser.is_banned && (
                            <span className="px-2 py-0.5 bg-red-500/30 text-red-300 rounded-full text-xs">
                              Banned
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedUser(null)}
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-white/5 rounded-xl p-4 text-center">
                      <Film className="w-6 h-6 mx-auto mb-2 text-cyan-400" />
                      <p className="text-2xl font-bold">{selectedUser.stats.clips}</p>
                      <p className="text-xs text-white/60">Clips</p>
                    </div>
                    <div className="bg-white/5 rounded-xl p-4 text-center">
                      <Heart className="w-6 h-6 mx-auto mb-2 text-pink-400" />
                      <p className="text-2xl font-bold">{selectedUser.stats.votes}</p>
                      <p className="text-xs text-white/60">Votes</p>
                    </div>
                    <div className="bg-white/5 rounded-xl p-4 text-center">
                      <MessageCircle className="w-6 h-6 mx-auto mb-2 text-green-400" />
                      <p className="text-2xl font-bold">{selectedUser.stats.comments}</p>
                      <p className="text-xs text-white/60">Comments</p>
                    </div>
                  </div>

                  {/* Recent Clips */}
                  {selectedUser.recentClips.length > 0 && (
                    <div className="mb-6">
                      <h3 className="font-bold mb-3">Recent Clips</h3>
                      <div className="space-y-2">
                        {selectedUser.recentClips.map((clip) => (
                          <div
                            key={clip.id}
                            className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                          >
                            <div>
                              <p className="font-medium truncate">{clip.title}</p>
                              <p className="text-xs text-white/60">
                                {clip.vote_count} votes • {clip.status}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Member since */}
                  <p className="text-sm text-white/40 text-center">
                    Member since {new Date(selectedUser.created_at).toLocaleDateString()}
                  </p>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ban Modal */}
      <AnimatePresence>
        {banningUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setBanningUser(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#1a1a2e] rounded-2xl border border-red-500/30 p-6 max-w-md w-full"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 rounded-xl bg-red-500/20">
                  <Ban className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Ban User</h2>
                  <p className="text-sm text-white/60">@{banningUser.username}</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">
                  Reason for ban (optional)
                </label>
                <textarea
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Enter reason..."
                  rows={3}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-white/40 focus:border-red-500 focus:outline-none resize-none"
                />
              </div>

              <div className="flex gap-3">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setBanningUser(null)}
                  disabled={processingBan}
                  className="flex-1 py-3 bg-white/10 rounded-xl font-medium hover:bg-white/20 transition-colors"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleBanAction(banningUser.id, 'ban')}
                  disabled={processingBan}
                  className="flex-1 py-3 bg-red-500 rounded-xl font-bold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {processingBan ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Ban className="w-5 h-5" />
                      Ban User
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Username Modal */}
      <AnimatePresence>
        {editingUser && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setEditingUser(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#1a1a2e] rounded-2xl border border-cyan-500/30 p-6 max-w-md w-full"
            >
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 rounded-xl bg-cyan-500/20">
                  <Edit3 className="w-6 h-6 text-cyan-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Edit Username</h2>
                  <p className="text-sm text-white/60">{editingUser.email}</p>
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium mb-2">
                  New Username
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">@</span>
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => {
                      setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                      setUsernameError('');
                    }}
                    placeholder="username"
                    maxLength={20}
                    className="w-full bg-white/10 border border-white/20 rounded-xl pl-8 pr-4 py-3 text-white placeholder-white/40 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                {usernameError && (
                  <p className="text-red-400 text-sm mt-2">{usernameError}</p>
                )}
                <p className="text-white/40 text-xs mt-2">
                  3-20 characters, lowercase letters, numbers, and underscores only
                </p>
              </div>

              <div className="flex gap-3">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setEditingUser(null)}
                  disabled={processingUsername}
                  className="flex-1 py-3 bg-white/10 rounded-xl font-medium hover:bg-white/20 transition-colors"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleUsernameUpdate}
                  disabled={processingUsername || !newUsername.trim() || newUsername === editingUser.username}
                  className="flex-1 py-3 bg-cyan-500 rounded-xl font-bold hover:bg-cyan-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {processingUsername ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Edit3 className="w-5 h-5" />
                      Update
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
