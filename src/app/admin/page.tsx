'use client';

// ============================================================================
// ADMIN DASHBOARD - With Edit Functionality
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Check,
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Clock,
  User,
  Film,
  TrendingUp,
  AlertCircle,
  ArrowLeft,
  RefreshCw,
  Filter,
  Edit,
  Trash2,
  Save,
  SkipForward,
  Trophy,
  Layers,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface Clip {
  id: string;
  title: string;
  description: string;
  genre: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string;
  status: 'pending' | 'active' | 'rejected';
  vote_count: number;
  uploader_key: string;
  created_at: string;
  slot_position: number;
}

type FilterStatus = 'all' | 'pending' | 'active' | 'rejected';

interface EditForm {
  title: string;
  description: string;
  genre: string;
  status: string;
}

const GENRES = [
  { id: 'action', name: 'Action', emoji: '💥' },
  { id: 'comedy', name: 'Comedy', emoji: '😂' },
  { id: 'thriller', name: 'Thriller', emoji: '🔪' },
  { id: 'scifi', name: 'Sci-Fi', emoji: '🚀' },
  { id: 'romance', name: 'Romance', emoji: '❤️' },
  { id: 'animation', name: 'Animation', emoji: '🎨' },
  { id: 'horror', name: 'Horror', emoji: '👻' },
  { id: 'other', name: 'Other', emoji: '🎬' },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function AdminDashboard() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('pending');
  const [playingClip, setPlayingClip] = useState<string | null>(null);
  const [mutedClips, setMutedClips] = useState<Set<string>>(new Set());
  const [processingClip, setProcessingClip] = useState<string | null>(null);
  const videoRefs = useRef<{ [key: string]: HTMLVideoElement | null }>({});

  // Edit modal state
  const [editingClip, setEditingClip] = useState<Clip | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    title: '',
    description: '',
    genre: '',
    status: '',
  });
  const [saving, setSaving] = useState(false);

  // Slot management state
  const [slotInfo, setSlotInfo] = useState<{
    currentSlot: number;
    totalSlots: number;
    seasonStatus: string;
    clipsInSlot: number;
    votingEndsAt: string | null;
    timeRemainingSeconds: number | null;
  } | null>(null);
  const [advancingSlot, setAdvancingSlot] = useState(false);
  const [advanceResult, setAdvanceResult] = useState<{
    success: boolean;
    message: string;
    winnerClipId?: string;
  } | null>(null);
  const [countdown, setCountdown] = useState<string>('');

  // ============================================================================
  // FETCH CLIPS
  // ============================================================================

  const fetchClips = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/clips?status=${filter}`);
      const data = await response.json();
      setClips(data.clips || []);
    } catch (error) {
      console.error('Failed to fetch clips:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchClips();
  }, [filter]);

  // ============================================================================
  // FETCH SLOT INFO
  // ============================================================================

  const fetchSlotInfo = async () => {
    try {
      const response = await fetch('/api/admin/slots');
      const data = await response.json();
      if (data.ok) {
        setSlotInfo({
          currentSlot: data.currentSlot || 0,
          totalSlots: data.totalSlots || 75,
          seasonStatus: data.seasonStatus || 'none',
          clipsInSlot: data.clipsInSlot || 0,
          votingEndsAt: data.votingEndsAt || null,
          timeRemainingSeconds: data.timeRemainingSeconds || null,
        });
      }
    } catch (error) {
      console.error('Failed to fetch slot info:', error);
    }
  };

  useEffect(() => {
    fetchSlotInfo();
  }, []);

  // Countdown timer effect
  useEffect(() => {
    if (!slotInfo?.votingEndsAt) {
      setCountdown('');
      return;
    }

    const updateCountdown = () => {
      const endTime = new Date(slotInfo.votingEndsAt!).getTime();
      const now = Date.now();
      const diff = Math.max(0, endTime - now);

      if (diff === 0) {
        setCountdown('Voting ended!');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m ${seconds}s`);
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [slotInfo?.votingEndsAt]);

  // ============================================================================
  // ADVANCE SLOT
  // ============================================================================

  const handleAdvanceSlot = async () => {
    if (!confirm('Are you sure you want to advance to the next slot? This will lock the current slot and pick a winner.')) {
      return;
    }

    setAdvancingSlot(true);
    setAdvanceResult(null);

    try {
      const response = await fetch('/api/admin/advance-slot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.ok) {
        setAdvanceResult({
          success: true,
          message: data.finished 
            ? '🎬 Season finished! All 75 slots completed.' 
            : `✅ Advanced to slot ${data.nextSlotPosition}. Winner: ${data.winnerClipId?.slice(0, 8)}...`,
          winnerClipId: data.winnerClipId,
        });
        fetchSlotInfo(); // Refresh slot info
        fetchClips(); // Refresh clips
      } else {
        setAdvanceResult({
          success: false,
          message: data.error || 'Failed to advance slot',
        });
      }
    } catch (error) {
      console.error('Failed to advance slot:', error);
      setAdvanceResult({
        success: false,
        message: 'Network error - failed to advance slot',
      });
    }

    setAdvancingSlot(false);
  };

  // ============================================================================
  // APPROVE/REJECT ACTIONS
  // ============================================================================

  const handleApprove = async (clipId: string) => {
    setProcessingClip(clipId);
    try {
      const response = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId }),
      });

      if (response.ok) {
        setClips((prev) => prev.filter((clip) => clip.id !== clipId));
      }
    } catch (error) {
      console.error('Failed to approve clip:', error);
    }
    setProcessingClip(null);
  };

  const handleReject = async (clipId: string) => {
    setProcessingClip(clipId);
    try {
      const response = await fetch('/api/admin/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId }),
      });

      if (response.ok) {
        setClips((prev) => prev.filter((clip) => clip.id !== clipId));
      }
    } catch (error) {
      console.error('Failed to reject clip:', error);
    }
    setProcessingClip(null);
  };

  // ============================================================================
  // EDIT ACTIONS
  // ============================================================================

  const openEditModal = (clip: Clip) => {
    setEditingClip(clip);
    setEditForm({
      title: clip.title,
      description: clip.description || '',
      genre: clip.genre,
      status: clip.status,
    });
  };

  const closeEditModal = () => {
    setEditingClip(null);
    setEditForm({ title: '', description: '', genre: '', status: '' });
  };

  const handleSaveEdit = async () => {
    if (!editingClip) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/clips/${editingClip.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (response.ok) {
        const data = await response.json();
        // Update clip in list
        setClips((prev) =>
          prev.map((clip) =>
            clip.id === editingClip.id ? { ...clip, ...data.clip } : clip
          )
        );
        closeEditModal();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to update clip');
      }
    } catch (error) {
      console.error('Failed to save edit:', error);
      alert('Failed to update clip');
    }
    setSaving(false);
  };

  const handleDelete = async (clipId: string) => {
    if (!confirm('Are you sure you want to delete this clip? This cannot be undone.')) {
      return;
    }

    setProcessingClip(clipId);
    try {
      const response = await fetch(`/api/admin/clips/${clipId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setClips((prev) => prev.filter((clip) => clip.id !== clipId));
      }
    } catch (error) {
      console.error('Failed to delete clip:', error);
    }
    setProcessingClip(null);
  };

  // ============================================================================
  // VIDEO CONTROLS
  // ============================================================================

  const togglePlay = (clipId: string) => {
    const video = videoRefs.current[clipId];
    if (!video) return;

    if (playingClip === clipId) {
      video.pause();
      setPlayingClip(null);
    } else {
      Object.entries(videoRefs.current).forEach(([id, v]) => {
        if (v && id !== clipId) {
          v.pause();
        }
      });
      video.play();
      setPlayingClip(clipId);
    }
  };

  const toggleMute = (clipId: string) => {
    setMutedClips((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(clipId)) {
        newSet.delete(clipId);
      } else {
        newSet.add(clipId);
      }
      return newSet;
    });
  };

  // ============================================================================
  // STATS
  // ============================================================================

  const stats = {
    pending: clips.filter((c) => c.status === 'pending').length,
    active: clips.filter((c) => c.status === 'active').length,
    rejected: clips.filter((c) => c.status === 'rejected').length,
    total: clips.length,
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                  type="button"
                >
                  <ArrowLeft className="w-5 h-5" />
                </motion.button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">
                  Admin Dashboard
                </h1>
                <p className="text-sm text-white/60">Review and manage uploaded clips</p>
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={fetchClips}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              type="button"
            >
              <RefreshCw className="w-5 h-5" />
            </motion.button>
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <motion.div
            whileHover={{ scale: 1.02 }}
            className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/20">
                <Clock className="w-5 h-5 text-yellow-400" />
              </div>
              <div>
                <p className="text-sm text-white/60">Pending</p>
                <p className="text-2xl font-bold">{stats.pending}</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.02 }}
            className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/20">
                <Check className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-sm text-white/60">Active</p>
                <p className="text-2xl font-bold">{stats.active}</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.02 }}
            className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-500/20">
                <X className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm text-white/60">Rejected</p>
                <p className="text-2xl font-bold">{stats.rejected}</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.02 }}
            className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/20">
                <Film className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <p className="text-sm text-white/60">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Slot Control Panel */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="bg-gradient-to-r from-purple-500/10 to-cyan-500/10 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            {/* Slot Info */}
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-purple-500/20">
                <Layers className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold">Round Control</h2>
                {slotInfo ? (
                  <div className="text-sm text-white/60">
                    <p>
                      Slot <span className="text-cyan-400 font-bold">{slotInfo.currentSlot}</span> of{' '}
                      <span className="text-white/80">{slotInfo.totalSlots}</span>
                      {' · '}{slotInfo.clipsInSlot} clips competing
                      {' · '}Season: <span className={slotInfo.seasonStatus === 'active' ? 'text-green-400' : 'text-yellow-400'}>{slotInfo.seasonStatus}</span>
                    </p>
                    {countdown && slotInfo.votingEndsAt && (
                      <p className="mt-1">
                        ⏱️ Auto-advance in: <span className="text-orange-400 font-bold">{countdown}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-white/60">Loading slot info...</p>
                )}
              </div>
            </div>

            {/* Advance Button */}
            <div className="flex items-center gap-3">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={fetchSlotInfo}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                type="button"
                title="Refresh slot info"
              >
                <RefreshCw className="w-5 h-5" />
              </motion.button>
              
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleAdvanceSlot}
                disabled={advancingSlot || !slotInfo || slotInfo.seasonStatus !== 'active'}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 font-bold
                         hover:shadow-lg hover:shadow-orange-500/20 transition-all disabled:opacity-50
                         flex items-center gap-2"
                type="button"
              >
                {advancingSlot ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Advancing...
                  </>
                ) : (
                  <>
                    <SkipForward className="w-5 h-5" />
                    Advance to Next Slot
                  </>
                )}
              </motion.button>
            </div>
          </div>

          {/* Advance Result Message */}
          <AnimatePresence>
            {advanceResult && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className={`mt-4 p-4 rounded-xl ${
                  advanceResult.success
                    ? 'bg-green-500/20 border border-green-500/40'
                    : 'bg-red-500/20 border border-red-500/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  {advanceResult.success ? (
                    <Trophy className="w-5 h-5 text-green-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  )}
                  <p className={advanceResult.success ? 'text-green-300' : 'text-red-300'}>
                    {advanceResult.message}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Filters */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {(['all', 'pending', 'active', 'rejected'] as FilterStatus[]).map((status) => (
            <motion.button
              key={status}
              whileTap={{ scale: 0.95 }}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-all ${
                filter === status
                  ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
              type="button"
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Clips List */}
      <div className="max-w-7xl mx-auto px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : clips.length === 0 ? (
          <div className="text-center py-20">
            <AlertCircle className="w-16 h-16 text-white/40 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white/80 mb-2">No clips found</h3>
            <p className="text-white/60">
              {filter === 'pending'
                ? 'No pending clips to review'
                : `No ${filter} clips at the moment`}
            </p>
          </div>
        ) : (
          <div className="grid gap-6">
            <AnimatePresence>
              {clips.map((clip) => (
                <motion.div
                  key={clip.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 overflow-hidden"
                >
                  <div className="grid md:grid-cols-[300px,1fr] gap-6 p-6">
                    {/* Video Preview */}
                    <div className="relative aspect-[9/16] max-w-[300px] mx-auto rounded-xl overflow-hidden bg-black">
                      <video
                        ref={(el) => {
                          videoRefs.current[clip.id] = el;
                        }}
                        src={clip.video_url}
                        className="w-full h-full object-cover"
                        loop
                        playsInline
                        muted={mutedClips.has(clip.id)}
                        onPlay={() => setPlayingClip(clip.id)}
                        onPause={() => setPlayingClip(null)}
                      />

                      {/* Play/Pause Overlay */}
                      {playingClip !== clip.id && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => togglePlay(clip.id)}
                            className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-colors"
                            type="button"
                          >
                            <Play className="w-8 h-8 text-white ml-1" />
                          </motion.button>
                        </div>
                      )}

                      {/* Video Controls */}
                      <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
                        <motion.button
                          whileTap={{ scale: 0.9 }}
                          onClick={() => toggleMute(clip.id)}
                          className="p-2 bg-black/70 backdrop-blur-sm rounded-full"
                          type="button"
                        >
                          {mutedClips.has(clip.id) ? (
                            <VolumeX className="w-4 h-4" />
                          ) : (
                            <Volume2 className="w-4 h-4" />
                          )}
                        </motion.button>

                        {playingClip === clip.id && (
                          <motion.button
                            whileTap={{ scale: 0.9 }}
                            onClick={() => togglePlay(clip.id)}
                            className="p-2 bg-black/70 backdrop-blur-sm rounded-full"
                            type="button"
                          >
                            <Pause className="w-4 h-4" />
                          </motion.button>
                        )}
                      </div>

                      {/* Status Badge */}
                      <div
                        className={`absolute top-2 right-2 px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm ${
                          clip.status === 'pending'
                            ? 'bg-yellow-500/30 text-yellow-200'
                            : clip.status === 'active'
                            ? 'bg-green-500/30 text-green-200'
                            : 'bg-red-500/30 text-red-200'
                        }`}
                      >
                        {clip.status}
                      </div>
                    </div>

                    {/* Clip Details */}
                    <div className="flex flex-col justify-between">
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-xl font-bold mb-1">{clip.title}</h3>
                          <p className="text-white/60 text-sm">{clip.description || 'No description'}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium">
                            🎭 {clip.genre}
                          </span>
                          <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium">
                            📍 Slot {clip.slot_position}
                          </span>
                          <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium">
                            👍 {clip.vote_count} votes
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <img
                            src={clip.avatar_url}
                            alt={clip.username}
                            className="w-10 h-10 rounded-full bg-white/10"
                          />
                          <div>
                            <p className="font-medium">{clip.username}</p>
                            <p className="text-xs text-white/60">
                              {new Date(clip.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-3 mt-4">
                        {/* Edit Button - Always visible */}
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => openEditModal(clip)}
                          disabled={processingClip === clip.id}
                          className="flex-1 py-3 rounded-xl bg-blue-500/20 border border-blue-500/40 font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                          type="button"
                        >
                          <Edit className="w-5 h-5" />
                          Edit
                        </motion.button>

                        {/* Delete Button */}
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleDelete(clip.id)}
                          disabled={processingClip === clip.id}
                          className="py-3 px-4 rounded-xl bg-red-500/20 border border-red-500/40 font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                          type="button"
                        >
                          <Trash2 className="w-5 h-5" />
                        </motion.button>

                        {/* Approve/Reject - Only for pending */}
                        {clip.status === 'pending' && (
                          <>
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleReject(clip.id)}
                              disabled={processingClip === clip.id}
                              className="flex-1 py-3 rounded-xl bg-red-500/20 border border-red-500/40 font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                              type="button"
                            >
                              <X className="w-5 h-5" />
                              Reject
                            </motion.button>

                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleApprove(clip.id)}
                              disabled={processingClip === clip.id}
                              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 font-bold hover:shadow-lg hover:shadow-green-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                              type="button"
                            >
                              <Check className="w-5 h-5" />
                              {processingClip === clip.id ? 'Processing...' : 'Approve'}
                            </motion.button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingClip && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={closeEditModal}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 rounded-2xl border border-white/20 p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Edit Clip</h2>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={closeEditModal}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                  type="button"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Title *
                  </label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    maxLength={50}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                             placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors"
                    placeholder="Clip title"
                  />
                  <p className="text-xs text-white/40 mt-1">{editForm.title.length}/50</p>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Description
                  </label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    maxLength={200}
                    rows={3}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                             placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors resize-none"
                    placeholder="Optional description"
                  />
                  <p className="text-xs text-white/40 mt-1">{editForm.description.length}/200</p>
                </div>

                {/* Genre */}
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Genre *
                  </label>
                  <select
                    value={editForm.genre}
                    onChange={(e) => setEditForm({ ...editForm, genre: e.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                             focus:border-cyan-400 focus:outline-none transition-colors"
                  >
                    {GENRES.map((genre) => (
                      <option key={genre.id} value={genre.id} className="bg-gray-900">
                        {genre.emoji} {genre.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status */}
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Status *
                  </label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                             focus:border-cyan-400 focus:outline-none transition-colors"
                  >
                    <option value="pending" className="bg-gray-900">⏳ Pending</option>
                    <option value="active" className="bg-gray-900">✅ Active</option>
                    <option value="rejected" className="bg-gray-900">❌ Rejected</option>
                  </select>
                </div>

                {/* Info Box */}
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
                  <p className="text-sm text-blue-300">
                    <strong>Note:</strong> Changes will update the clip immediately. Video URL, uploader info, and votes cannot be edited.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={closeEditModal}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl bg-white/10 font-medium hover:bg-white/20 transition-colors disabled:opacity-50"
                  type="button"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSaveEdit}
                  disabled={saving || !editForm.title.trim() || !editForm.genre}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 font-bold
                           hover:shadow-lg hover:shadow-cyan-500/20 transition-all disabled:opacity-50
                           flex items-center justify-center gap-2"
                  type="button"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      Save Changes
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
