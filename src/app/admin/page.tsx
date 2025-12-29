'use client';

// ============================================================================
// ADMIN DASHBOARD - With Edit Functionality
// Requires admin authentication
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import {
  Check,
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Clock,
  Film,
  AlertCircle,
  ArrowLeft,
  RefreshCw,
  Edit,
  Trash2,
  Save,
  SkipForward,
  Trophy,
  Layers,
  ShieldX,
  LogIn,
  Settings,
  Zap,
  Users,
  DollarSign,
  Shield,
  ToggleLeft,
  ToggleRight,
  RotateCcw,
  Crown,
  Archive,
  ArchiveRestore,
  Flag,
  Unlock,
} from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useCsrf } from '@/hooks/useCsrf';

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
  status: 'pending' | 'active' | 'rejected' | 'locked';
  vote_count: number;
  uploader_key: string;
  created_at: string;
  slot_position: number;
  season_id?: string;
}

interface Season {
  id: string;
  label: string;
  status: 'draft' | 'active' | 'finished' | 'archived';
  total_slots: number;
  created_at: string;
}

type FilterStatus = 'all' | 'pending' | 'active' | 'rejected' | 'locked';
type AdminTab = 'clips' | 'features' | 'users';

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  category: string;
  config: Record<string, unknown>;
  updated_at: string;
}

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
  const _router = useRouter();
  const { isLoading: authLoading, isAdmin, error: authError } = useAdminAuth();
  const { getHeaders } = useCsrf();

  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [slotFilter, setSlotFilter] = useState<number | 'all' | 'locked'>('all');
  const [seasonFilter, setSeasonFilter] = useState<string | 'all'>('all');
  const [seasons, setSeasons] = useState<Season[]>([]);
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
    slotStatus: 'upcoming' | 'voting' | 'locked' | 'waiting_for_clips';
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

  // Reset season state
  const [resettingSeason, setResettingSeason] = useState(false);
  const [fullResetting, setFullResetting] = useState(false);
  const [resetResult, setResetResult] = useState<{
    success: boolean;
    message: string;
    clipsInSlot?: number;
  } | null>(null);

  // Assign winner state
  const [assigningWinner, setAssigningWinner] = useState(false);
  const [winnerCandidate, setWinnerCandidate] = useState<Clip | null>(null);
  const [winnerResult, setWinnerResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Tab and feature flags state
  const [activeTab, setActiveTab] = useState<AdminTab>('clips');
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [loadingFlags, setLoadingFlags] = useState(false);
  const [togglingFlag, setTogglingFlag] = useState<string | null>(null);

  // Multi-vote mode state (quick toggle)
  const [multiVoteEnabled, setMultiVoteEnabled] = useState(false);
  const [loadingMultiVote, setLoadingMultiVote] = useState(true);

  // Reset user votes state
  const [resetVotesUsername, setResetVotesUsername] = useState('');
  const [resettingUserVotes, setResettingUserVotes] = useState(false);
  const [resetVotesResult, setResetVotesResult] = useState<{
    success: boolean;
    message: string;
    votesDeleted?: number;
  } | null>(null);

  // Reset active clips to pending state
  const [resettingActiveClips, setResettingActiveClips] = useState(false);
  const [resetActiveClipsResult, setResetActiveClipsResult] = useState<{
    success: boolean;
    message: string;
    updated?: number;
  } | null>(null);

  // Bulk selection state
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    success: boolean;
    message: string;
    updated?: number;
  } | null>(null);

  // Create new season state
  const [showCreateSeason, setShowCreateSeason] = useState(false);
  const [creatingSeason, setCreatingSeason] = useState(false);
  const [newSeasonLabel, setNewSeasonLabel] = useState('');
  const [newSeasonSlots, setNewSeasonSlots] = useState(75);

  // Archive season state
  const [archivingSeason, setArchivingSeason] = useState(false);

  // Bulk cleanup state
  const [showBulkCleanup, setShowBulkCleanup] = useState(false);
  const [bulkCleanupProcessing, setBulkCleanupProcessing] = useState(false);
  const [newSeason1Label, setNewSeason1Label] = useState('Season 1');

  // ============================================================================
  // FETCH SEASONS
  // ============================================================================

  const fetchSeasons = async () => {
    try {
      const response = await fetch('/api/admin/seasons');
      const data = await response.json();
      if (data.seasons) {
        setSeasons(data.seasons);
        // Auto-select active season if none selected
        if (seasonFilter === 'all') {
          const activeSeason = data.seasons.find((s: Season) => s.status === 'active');
          if (activeSeason) {
            setSeasonFilter(activeSeason.id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch seasons:', error);
    }
  };

  useEffect(() => {
    fetchSeasons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // CREATE NEW SEASON
  // ============================================================================

  const handleCreateSeason = async () => {
    if (!newSeasonLabel.trim()) {
      alert('Please enter a season label');
      return;
    }

    const confirmCreate = window.confirm(
      `Create and activate "${newSeasonLabel}" with ${newSeasonSlots} slots?\n\n` +
      'This will:\n' +
      '• Finish any currently active season\n' +
      '• Create a new active season\n' +
      '• Set slot 1 to voting (timer starts when first clip is uploaded)'
    );

    if (!confirmCreate) return;

    setCreatingSeason(true);
    try {
      const response = await fetch('/api/admin/seasons', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          label: newSeasonLabel.trim(),
          total_slots: newSeasonSlots,
          auto_activate: true,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`${data.message}`);
        setShowCreateSeason(false);
        setNewSeasonLabel('');
        setNewSeasonSlots(75);
        fetchSeasons();
        fetchSlotInfo();
      } else {
        alert(`Error: ${data.error || 'Failed to create season'}`);
      }
    } catch (error) {
      console.error('Failed to create season:', error);
      alert('Network error - failed to create season');
    } finally {
      setCreatingSeason(false);
    }
  };

  // ============================================================================
  // ARCHIVE/UNARCHIVE SEASON
  // ============================================================================

  const handleArchiveSeason = async (seasonId: string, archive: boolean) => {
    const season = seasons.find(s => s.id === seasonId);
    if (!season) return;

    const action = archive ? 'archive' : 'unarchive';
    const confirmed = window.confirm(
      archive
        ? `Archive "${season.label}"?\n\nThis will hide the season from users. You can unarchive it later.`
        : `Unarchive "${season.label}"?\n\nThis will make the season visible to users again.`
    );

    if (!confirmed) return;

    setArchivingSeason(true);
    try {
      const response = await fetch('/api/admin/seasons', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          status: archive ? 'archived' : 'finished',
        }),
      });

      const data = await response.json();
      if (data.success) {
        fetchSeasons();
        setBulkResult({
          success: true,
          message: `Season "${season.label}" ${action}d successfully`,
        });
      } else {
        alert(`Error: ${data.error || `Failed to ${action} season`}`);
      }
    } catch (error) {
      console.error(`Failed to ${action} season:`, error);
      alert(`Network error - failed to ${action} season`);
    } finally {
      setArchivingSeason(false);
    }
  };

  // ============================================================================
  // DELETE SEASON
  // ============================================================================

  const [deletingSeason, setDeletingSeason] = useState(false);

  const handleDeleteSeason = async (seasonId: string) => {
    const season = seasons.find(s => s.id === seasonId);
    if (!season) return;

    // Prevent deleting active season
    if (season.status === 'active') {
      alert('Cannot delete an active season. Archive or finish it first.');
      return;
    }

    // Require typing confirmation
    const typedConfirm = window.prompt(
      `⚠️ PERMANENT DELETE ⚠️\n\n` +
      `This will permanently delete "${season.label}" and ALL its data:\n` +
      `• All slots\n` +
      `• All clips\n` +
      `• All votes\n\n` +
      `This action CANNOT be undone.\n\n` +
      `Type "DELETE" to confirm:`
    );

    if (typedConfirm !== 'DELETE') {
      if (typedConfirm !== null) {
        alert('Deletion cancelled. You must type "DELETE" exactly to confirm.');
      }
      return;
    }

    setDeletingSeason(true);
    try {
      const response = await fetch('/api/admin/seasons', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: seasonId,
          confirm: true,
        }),
      });

      const data = await response.json();
      if (data.success) {
        // Reset filter if we deleted the selected season
        if (seasonFilter === seasonId) {
          setSeasonFilter('all');
        }
        fetchSeasons();
        setBulkResult({
          success: true,
          message: `Season "${season.label}" permanently deleted (${data.deleted?.clips_deleted || 0} clips, ${data.deleted?.slots_deleted || 0} slots)`,
        });
      } else {
        alert(`Error: ${data.error || 'Failed to delete season'}`);
      }
    } catch (error) {
      console.error('Failed to delete season:', error);
      alert('Network error - failed to delete season');
    } finally {
      setDeletingSeason(false);
    }
  };

  // ============================================================================
  // FINISH SEASON EARLY
  // ============================================================================

  const [finishingSeason, setFinishingSeason] = useState(false);

  const handleFinishSeason = async () => {
    // Find the active season
    const activeSeason = seasons.find(s => s.status === 'active');
    if (!activeSeason) {
      alert('No active season to finish');
      return;
    }

    const confirmed = window.confirm(
      `Finish "${activeSeason.label}" early?\n\n` +
      `This will:\n` +
      `• Set the season status to "finished"\n` +
      `• Stop voting on the current slot\n` +
      `• Keep all existing data (clips, votes, winners)\n\n` +
      `Users will still be able to view the season but not vote.`
    );

    if (!confirmed) return;

    setFinishingSeason(true);
    try {
      const response = await fetch('/api/admin/seasons', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          season_id: activeSeason.id,
          status: 'finished',
        }),
      });

      const data = await response.json();
      if (data.success) {
        fetchSeasons();
        fetchSlotInfo();
        setBulkResult({
          success: true,
          message: `Season "${activeSeason.label}" finished successfully`,
        });
      } else {
        alert(`Error: ${data.error || 'Failed to finish season'}`);
      }
    } catch (error) {
      console.error('Failed to finish season:', error);
      alert('Network error - failed to finish season');
    } finally {
      setFinishingSeason(false);
    }
  };

  // ============================================================================
  // BULK CLEANUP - Delete all seasons and start fresh
  // ============================================================================

  const handleBulkCleanup = async () => {
    if (!newSeason1Label.trim()) {
      alert('Please enter a name for the new Season 1');
      return;
    }

    setBulkCleanupProcessing(true);

    try {
      // Step 1: Finish the active season (if any)
      const activeSeason = seasons.find(s => s.status === 'active');
      if (activeSeason) {
        console.log('[BulkCleanup] Finishing active season:', activeSeason.label);
        const finishResponse = await fetch('/api/admin/seasons', {
          method: 'PATCH',
          headers: getHeaders(),
          body: JSON.stringify({
            season_id: activeSeason.id,
            status: 'finished',
          }),
        });
        const finishData = await finishResponse.json();
        if (!finishData.success) {
          throw new Error(`Failed to finish active season: ${finishData.error}`);
        }
      }

      // Step 2: Delete ALL seasons (now that none are active)
      // Re-fetch seasons to get updated statuses
      const seasonsResponse = await fetch('/api/admin/seasons');
      const seasonsData = await seasonsResponse.json();
      const allSeasons = seasonsData.seasons || [];

      let deletedCount = 0;
      for (const season of allSeasons) {
        console.log('[BulkCleanup] Deleting season:', season.label);
        const deleteResponse = await fetch('/api/admin/seasons', {
          method: 'DELETE',
          headers: getHeaders(),
          body: JSON.stringify({
            season_id: season.id,
            confirm: true,
          }),
        });
        const deleteData = await deleteResponse.json();
        if (deleteData.success) {
          deletedCount++;
        } else {
          console.warn(`[BulkCleanup] Failed to delete ${season.label}:`, deleteData.error);
        }
      }

      // Step 3: Create fresh Season 1
      console.log('[BulkCleanup] Creating fresh Season 1:', newSeason1Label);
      const createResponse = await fetch('/api/admin/seasons', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          label: newSeason1Label.trim(),
          total_slots: 75,
          auto_activate: true,
        }),
      });
      const createData = await createResponse.json();

      if (!createData.success) {
        throw new Error(`Failed to create new season: ${createData.error}`);
      }

      // Success!
      setShowBulkCleanup(false);
      setNewSeason1Label('Season 1');
      fetchSeasons();
      fetchSlotInfo();
      setBulkResult({
        success: true,
        message: `Cleanup complete! Deleted ${deletedCount} season(s). Created "${newSeason1Label.trim()}" with 75 slots.`,
      });

    } catch (error) {
      console.error('[BulkCleanup] Error:', error);
      alert(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setBulkCleanupProcessing(false);
    }
  };

  // ============================================================================
  // FETCH CLIPS
  // ============================================================================

  const fetchClips = async () => {
    setLoading(true);
    try {
      const seasonParam = seasonFilter !== 'all' ? `&season_id=${seasonFilter}` : '';
      const response = await fetch(`/api/admin/clips?status=${filter}${seasonParam}`);
      const data = await response.json();
      setClips(data.clips || []);
    } catch (error) {
      console.error('Failed to fetch clips:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchClips();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, seasonFilter]);

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
          slotStatus: data.slotStatus || 'upcoming',
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
  // FETCH FEATURE FLAGS
  // ============================================================================

  const fetchFeatureFlags = async () => {
    setLoadingFlags(true);
    try {
      const response = await fetch('/api/admin/feature-flags');
      const data = await response.json();
      if (data.ok) {
        setFeatureFlags(data.flags || []);
      }
    } catch (error) {
      console.error('Failed to fetch feature flags:', error);
    }
    setLoadingFlags(false);
  };

  useEffect(() => {
    if (activeTab === 'features') {
      fetchFeatureFlags();
    }
  }, [activeTab]);

  // ============================================================================
  // MULTI-VOTE MODE (Quick Toggle)
  // ============================================================================

  const fetchMultiVoteStatus = async () => {
    try {
      const response = await fetch('/api/admin/feature-flags');
      const data = await response.json();
      if (data.ok && data.flags) {
        const multiVoteFlag = data.flags.find((f: FeatureFlag) => f.key === 'multi_vote_mode');
        setMultiVoteEnabled(multiVoteFlag?.enabled ?? false);
      }
    } catch (error) {
      console.error('Failed to fetch multi-vote status:', error);
    }
    setLoadingMultiVote(false);
  };

  useEffect(() => {
    fetchMultiVoteStatus();
  }, []);

  const handleToggleMultiVote = async () => {
    setLoadingMultiVote(true);
    try {
      const response = await fetch('/api/admin/feature-flags', {
        method: 'PUT',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ key: 'multi_vote_mode', enabled: !multiVoteEnabled }),
      });

      const data = await response.json();
      if (data.ok) {
        setMultiVoteEnabled(!multiVoteEnabled);
        // Also update feature flags if on that tab
        setFeatureFlags((prev) =>
          prev.map((f) => (f.key === 'multi_vote_mode' ? { ...f, enabled: !multiVoteEnabled } : f))
        );
      }
    } catch (error) {
      console.error('Failed to toggle multi-vote mode:', error);
    }
    setLoadingMultiVote(false);
  };

  // ============================================================================
  // RESET USER VOTES
  // ============================================================================

  const handleResetUserVotes = async () => {
    if (!resetVotesUsername.trim()) {
      setResetVotesResult({
        success: false,
        message: 'Please enter a username',
      });
      return;
    }

    const confirmReset = confirm(
      `Are you sure you want to reset ALL votes for user "${resetVotesUsername}"?\n\nThis will delete all their voting history and cannot be undone.`
    );

    if (!confirmReset) return;

    setResettingUserVotes(true);
    setResetVotesResult(null);

    try {
      const response = await fetch('/api/admin/reset-user-votes', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ username: resetVotesUsername.trim() }),
      });

      const data = await response.json();

      if (data.ok) {
        setResetVotesResult({
          success: true,
          message: data.message,
          votesDeleted: data.votes_deleted,
        });
        setResetVotesUsername(''); // Clear input on success
      } else {
        setResetVotesResult({
          success: false,
          message: data.error || 'Failed to reset user votes',
        });
      }
    } catch (error) {
      console.error('Failed to reset user votes:', error);
      setResetVotesResult({
        success: false,
        message: 'Network error - failed to reset user votes',
      });
    }

    setResettingUserVotes(false);
  };

  // ============================================================================
  // RESET ACTIVE CLIPS TO PENDING
  // ============================================================================

  const handleResetActiveClipsToPending = async () => {
    // Get all active clip IDs from current clips list
    const activeClipIds = clips.filter((c) => c.status === 'active').map((c) => c.id);

    if (activeClipIds.length === 0) {
      setResetActiveClipsResult({
        success: false,
        message: 'No active clips found to reset',
      });
      return;
    }

    const confirmReset = confirm(
      `Are you sure you want to reset ${activeClipIds.length} active clip(s) to PENDING status?\n\nThis will remove them from the voting arena until re-approved.`
    );

    if (!confirmReset) return;

    setResettingActiveClips(true);
    setResetActiveClipsResult(null);

    try {
      const response = await fetch('/api/admin/bulk', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          action: 'reset_to_pending',
          clipIds: activeClipIds,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setResetActiveClipsResult({
          success: true,
          message: `Successfully reset ${data.updated} clip(s) to pending`,
          updated: data.updated,
        });
        // Update local state to reflect the change
        setClips((prev) =>
          prev.map((c) =>
            activeClipIds.includes(c.id) ? { ...c, status: 'pending' as const } : c
          )
        );
      } else {
        setResetActiveClipsResult({
          success: false,
          message: data.error || 'Failed to reset clips',
        });
      }
    } catch (error) {
      console.error('Failed to reset active clips:', error);
      setResetActiveClipsResult({
        success: false,
        message: 'Network error - failed to reset clips',
      });
    }

    setResettingActiveClips(false);
  };

  // ============================================================================
  // TOGGLE FEATURE FLAG
  // ============================================================================

  const handleToggleFeature = async (flag: FeatureFlag) => {
    setTogglingFlag(flag.key);
    try {
      const response = await fetch('/api/admin/feature-flags', {
        method: 'PUT',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({ key: flag.key, enabled: !flag.enabled }),
      });

      const data = await response.json();
      if (data.ok) {
        setFeatureFlags((prev) =>
          prev.map((f) => (f.key === flag.key ? { ...f, enabled: !f.enabled } : f))
        );
      }
    } catch (error) {
      console.error('Failed to toggle feature:', error);
    }
    setTogglingFlag(null);
  };

  // ============================================================================
  // RESET SEASON
  // ============================================================================

  const handleResetSeason = async () => {
    const confirmReset = confirm(
      'Are you sure you want to reset the season?\n\n' +
      'This will:\n' +
      '- Reset all slots to "upcoming"\n' +
      '- Set slot 1 to "voting"\n' +
      '- Clear all winners\n' +
      '- Optionally clear votes and reset vote counts\n\n' +
      'This action cannot be undone!'
    );

    if (!confirmReset) return;

    const clearVotes = confirm('Do you also want to clear all votes and reset clip vote counts?');

    setResettingSeason(true);
    setResetResult(null);
    setAdvanceResult(null);

    try {
      const response = await fetch('/api/admin/reset-season', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          clear_votes: clearVotes,
          reset_clip_counts: clearVotes,
          start_slot: 1,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        setResetResult({
          success: true,
          message: `Season reset! Now voting on slot 1 with ${data.clips_in_slot} clips.`,
          clipsInSlot: data.clips_in_slot,
        });
        fetchSlotInfo();
        fetchClips();
      } else {
        setResetResult({
          success: false,
          message: data.error || 'Failed to reset season',
        });
      }
    } catch (error) {
      console.error('Failed to reset season:', error);
      setResetResult({
        success: false,
        message: 'Network error - failed to reset season',
      });
    }

    setResettingSeason(false);
  };

  // ============================================================================
  // FULL CLEAN RESET
  // ============================================================================

  const handleFullCleanReset = async () => {
    const confirmReset = confirm(
      '⚠️ FULL CLEAN RESET ⚠️\n\n' +
      'This will completely reset everything:\n\n' +
      '• Reset all 75 slots to "upcoming"\n' +
      '• Set slot 1 to "voting"\n' +
      '• Clear ALL winners\n' +
      '• DELETE ALL VOTES\n' +
      '• Reset ALL clip vote counts to 0\n\n' +
      'This is a DESTRUCTIVE action and cannot be undone!\n\n' +
      'Are you absolutely sure?'
    );

    if (!confirmReset) return;

    // Double confirm for safety
    const doubleConfirm = confirm(
      'FINAL CONFIRMATION\n\n' +
      'You are about to delete ALL voting data.\n' +
      'Type "yes" mentality by clicking OK to proceed.'
    );

    if (!doubleConfirm) return;

    setFullResetting(true);
    setResetResult(null);
    setAdvanceResult(null);

    try {
      const response = await fetch('/api/admin/reset-season', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          clear_votes: true,
          reset_clip_counts: true,
          start_slot: 1,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        setResetResult({
          success: true,
          message: `Full clean reset complete! Season back to slot 1 with ${data.clips_in_slot} clips. All votes cleared.`,
          clipsInSlot: data.clips_in_slot,
        });
        fetchSlotInfo();
        fetchClips();
      } else {
        setResetResult({
          success: false,
          message: data.error || 'Failed to perform full reset',
        });
      }
    } catch (error) {
      console.error('Failed to perform full reset:', error);
      setResetResult({
        success: false,
        message: 'Network error - failed to perform full reset',
      });
    }

    setFullResetting(false);
  };

  // ============================================================================
  // ASSIGN WINNER MANUALLY
  // ============================================================================

  const openWinnerModal = (clip: Clip) => {
    setWinnerCandidate(clip);
    setWinnerResult(null);
  };

  const closeWinnerModal = () => {
    setWinnerCandidate(null);
  };

  const handleAssignWinner = async () => {
    if (!winnerCandidate) return;

    setAssigningWinner(true);
    setWinnerResult(null);

    try {
      const response = await fetch('/api/admin/assign-winner', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          clipId: winnerCandidate.id,
          advanceSlot: true,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        setWinnerResult({
          success: true,
          message: data.message || `Winner assigned: ${winnerCandidate.title}`,
        });
        // Refresh data
        fetchSlotInfo();
        fetchClips();
        // Close modal after a short delay
        setTimeout(() => {
          closeWinnerModal();
        }, 2000);
      } else {
        setWinnerResult({
          success: false,
          message: data.error || 'Failed to assign winner',
        });
      }
    } catch (error) {
      console.error('Failed to assign winner:', error);
      setWinnerResult({
        success: false,
        message: 'Network error - failed to assign winner',
      });
    }

    setAssigningWinner(false);
  };

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
        headers: getHeaders(),
        credentials: 'include',
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
        headers: getHeaders(),
        credentials: 'include',
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
        headers: getHeaders(),
        credentials: 'include',
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
        headers: getHeaders(),
        credentials: 'include',
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
        headers: getHeaders(),
        credentials: 'include',
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
  // UNLOCK SLOT - Revert a locked slot back to voting
  // ============================================================================

  const handleUnlockSlot = async (clip: Clip) => {
    const confirmMsg = `Unlock slot ${clip.slot_position}?\n\nThis will:\n- Remove "${clip.title}" as the winner\n- Set the slot back to "voting" status\n- Optionally revert the clip to "pending"\n\nDo you also want to revert the clip to pending status?`;

    const revertToPending = confirm(confirmMsg);

    // Second confirmation for the unlock action itself
    if (!confirm(`Confirm: Unlock slot ${clip.slot_position} and remove winner?`)) {
      return;
    }

    setProcessingClip(clip.id);
    try {
      // First, we need to get the slot_id for this slot_position
      const slotsResponse = await fetch(`/api/admin/slots?season_id=${clip.season_id}`, {
        headers: getHeaders(),
        credentials: 'include',
      });
      const slotsData = await slotsResponse.json();

      const slot = slotsData.slots?.find((s: { slot_position: number }) => s.slot_position === clip.slot_position);
      if (!slot) {
        alert('Could not find slot information');
        setProcessingClip(null);
        return;
      }

      // Call the unlock API
      const response = await fetch('/api/admin/slots', {
        method: 'PATCH',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          slot_id: slot.id,
          unlock: true,
          revert_clip_to_pending: revertToPending,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`Slot ${clip.slot_position} unlocked successfully!${data.clipReverted ? '\nClip reverted to pending.' : ''}`);
        // Refresh data
        fetchClips();
        fetchSlotInfo();
      } else {
        alert(`Failed to unlock slot: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to unlock slot:', error);
      alert('Failed to unlock slot. Check console for details.');
    }
    setProcessingClip(null);
  };

  // ============================================================================
  // BULK ACTIONS
  // ============================================================================

  const handleSelectClip = (clipId: string) => {
    setSelectedClips((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(clipId)) {
        newSet.delete(clipId);
      } else {
        newSet.add(clipId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const pendingClips = filteredClips.filter((c) => c.status === 'pending');
    if (selectedClips.size === pendingClips.length) {
      setSelectedClips(new Set());
    } else {
      setSelectedClips(new Set(pendingClips.map((c) => c.id)));
    }
  };

  const handleBulkAction = async (action: 'approve' | 'reject') => {
    if (selectedClips.size === 0) return;

    setBulkProcessing(true);
    setBulkResult(null);

    try {
      const response = await fetch('/api/admin/bulk', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          action,
          clipIds: Array.from(selectedClips),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setBulkResult({
          success: true,
          message: `Successfully ${action}d ${data.updated} clip${data.updated !== 1 ? 's' : ''}`,
          updated: data.updated,
        });
        // Remove processed clips from the list
        setClips((prev) => prev.filter((c) => !selectedClips.has(c.id)));
        setSelectedClips(new Set());
      } else {
        setBulkResult({
          success: false,
          message: data.error || `Failed to ${action} clips`,
        });
      }
    } catch (error) {
      console.error(`Bulk ${action} error:`, error);
      setBulkResult({
        success: false,
        message: `Network error - failed to ${action} clips`,
      });
    }

    setBulkProcessing(false);
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
    locked: clips.filter((c) => c.status === 'locked').length,
    total: clips.length,
  };

  // Filter clips by status and slot
  const filteredClips = clips.filter((clip) => {
    const statusMatch = filter === 'all' || clip.status === filter;
    const slotMatch = slotFilter === 'all'
      || (slotFilter === 'locked' && clip.status === 'locked')
      || clip.slot_position === slotFilter;
    return statusMatch && slotMatch;
  });

  // ============================================================================
  // RENDER
  // ============================================================================

  // Loading state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60">Verifying admin access...</p>
        </div>
      </div>
    );
  }

  // Not authenticated - show login
  if (authError === 'Not authenticated') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="max-w-md mx-auto px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
              <LogIn className="w-10 h-10 text-cyan-500" />
            </div>
            <div>
              <h1 className="text-2xl font-black mb-2">Admin Login Required</h1>
              <p className="text-white/60">You need to sign in to access the admin dashboard.</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => signIn('google')}
              className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold text-lg flex items-center justify-center gap-3"
            >
              Sign in with Google
            </motion.button>
            <Link href="/dashboard">
              <p className="text-sm text-white/40 hover:text-white/60 transition-colors">
                Back to Dashboard
              </p>
            </Link>
          </motion.div>
        </div>
      </div>
    );
  }

  // Not authorized as admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="max-w-md mx-auto px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="w-20 h-20 mx-auto rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center">
              <ShieldX className="w-10 h-10 text-red-500" />
            </div>
            <div>
              <h1 className="text-2xl font-black mb-2">Access Denied</h1>
              <p className="text-white/60">You don't have admin privileges to access this page.</p>
              <p className="text-white/40 text-sm mt-2">Contact the site administrator if you believe this is an error.</p>
            </div>
            <Link href="/dashboard">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-4 bg-white/10 border border-white/20 rounded-xl font-bold text-lg"
              >
                Back to Dashboard
              </motion.button>
            </Link>
          </motion.div>
        </div>
      </div>
    );
  }

  // Authorized admin - show dashboard
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
              onClick={activeTab === 'clips' ? fetchClips : fetchFeatureFlags}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              type="button"
            >
              <RefreshCw className="w-5 h-5" />
            </motion.button>
          </div>

          {/* Tab Navigation */}
          <div className="flex gap-2 mt-4">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveTab('clips')}
              className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                activeTab === 'clips'
                  ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
              type="button"
            >
              <Film className="w-4 h-4" />
              Clips
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setActiveTab('features')}
              className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                activeTab === 'features'
                  ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
              type="button"
            >
              <Settings className="w-4 h-4" />
              Feature Flags
            </motion.button>
            <Link href="/admin/users">
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 bg-white/10 text-white/70 hover:bg-white/20"
                type="button"
              >
                <Users className="w-4 h-4" />
                Users
              </motion.button>
            </Link>
          </div>
        </div>
      </header>

      {/* CLIPS TAB CONTENT */}
      {activeTab === 'clips' && (
        <>
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
                      {' · '}<span className={slotInfo.clipsInSlot === 0 ? 'text-red-400 font-bold' : ''}>{slotInfo.clipsInSlot} clips competing</span>
                      {' · '}Season: <span className={slotInfo.seasonStatus === 'active' ? 'text-green-400' : 'text-yellow-400'}>{slotInfo.seasonStatus}</span>
                      {' · '}Slot: <span className={
                        slotInfo.slotStatus === 'voting' ? 'text-green-400' :
                        slotInfo.slotStatus === 'waiting_for_clips' ? 'text-orange-400 font-bold' :
                        slotInfo.slotStatus === 'locked' ? 'text-purple-400' : 'text-white/60'
                      }>{slotInfo.slotStatus === 'waiting_for_clips' ? '⏳ Waiting for Clips' : slotInfo.slotStatus}</span>
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
                {/* Warning: Slot waiting for clips */}
                {slotInfo && slotInfo.slotStatus === 'waiting_for_clips' && slotInfo.seasonStatus === 'active' && (
                  <div className="mt-3 p-3 rounded-lg bg-orange-500/20 border border-orange-500/40 flex items-start gap-2">
                    <Clock className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-orange-300 font-medium">Slot {slotInfo.currentSlot} is waiting for clips!</p>
                      <p className="text-orange-300/70 text-xs mt-1">
                        Voting is paused. Approve pending clips or wait for new uploads.
                        <br />Voting will automatically resume when a clip is approved.
                      </p>
                    </div>
                  </div>
                )}
                {/* Warning: No clips in current slot (voting status) */}
                {slotInfo && slotInfo.clipsInSlot === 0 && slotInfo.slotStatus === 'voting' && slotInfo.seasonStatus === 'active' && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/20 border border-red-500/40 flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-red-300 font-medium">No clips in current voting slot!</p>
                      <p className="text-red-300/70 text-xs mt-1">
                        Users need to upload clips for slot {slotInfo.currentSlot} before voting can continue.
                        Approve pending clips or wait for new uploads.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 flex-wrap">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={fetchSlotInfo}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                type="button"
                title="Refresh slot info"
              >
                <RefreshCw className="w-5 h-5" />
              </motion.button>

              {/* Reset Season Button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleResetSeason}
                disabled={resettingSeason || fullResetting || !slotInfo}
                className="px-4 py-3 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 font-bold
                         hover:shadow-lg hover:shadow-yellow-500/20 transition-all disabled:opacity-50
                         flex items-center gap-2"
                type="button"
                title="Reset season to slot 1"
              >
                {resettingSeason ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-5 h-5" />
                    Reset Season
                  </>
                )}
              </motion.button>

              {/* Full Clean Reset Button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleFullCleanReset}
                disabled={resettingSeason || fullResetting || !slotInfo}
                className="px-4 py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-800 font-bold
                         hover:shadow-lg hover:shadow-red-500/20 transition-all disabled:opacity-50
                         flex items-center gap-2 border border-red-400/50"
                type="button"
                title="Complete reset: clears all votes and resets everything"
              >
                {fullResetting ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    Full Reset...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5" />
                    Full Clean Reset
                  </>
                )}
              </motion.button>

              {/* Advance Slot Button */}
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

          {/* Multi-Vote Mode Toggle */}
          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${multiVoteEnabled ? 'bg-green-500/20' : 'bg-white/10'}`}>
                  <Zap className={`w-5 h-5 ${multiVoteEnabled ? 'text-green-400' : 'text-white/60'}`} />
                </div>
                <div>
                  <h3 className="font-bold flex items-center gap-2">
                    Multi-Vote Mode
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      multiVoteEnabled
                        ? 'bg-green-500/30 text-green-300'
                        : 'bg-white/10 text-white/50'
                    }`}>
                      {multiVoteEnabled ? 'ON' : 'OFF'}
                    </span>
                  </h3>
                  <p className="text-sm text-white/60">
                    {multiVoteEnabled
                      ? 'Users can vote on the same clip multiple times (up to 200 daily)'
                      : 'Users can only vote once per clip'}
                  </p>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleToggleMultiVote}
                disabled={loadingMultiVote}
                className={`p-3 rounded-xl transition-all ${
                  multiVoteEnabled
                    ? 'bg-green-500 hover:bg-green-600'
                    : 'bg-white/10 hover:bg-white/20'
                } disabled:opacity-50`}
                type="button"
              >
                {loadingMultiVote ? (
                  <RefreshCw className="w-6 h-6 animate-spin" />
                ) : multiVoteEnabled ? (
                  <ToggleRight className="w-6 h-6" />
                ) : (
                  <ToggleLeft className="w-6 h-6" />
                )}
              </motion.button>
            </div>
          </div>

          {/* Reset User Votes */}
          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="p-2 rounded-lg bg-red-500/20">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h3 className="font-bold">Reset User Votes</h3>
                  <p className="text-sm text-white/60">Delete all votes for a specific user</p>
                </div>
              </div>

              <div className="flex flex-1 gap-3 items-center">
                <input
                  type="text"
                  value={resetVotesUsername}
                  onChange={(e) => setResetVotesUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleResetUserVotes()}
                  placeholder="Enter username..."
                  className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white
                           placeholder-white/40 focus:border-red-400 focus:outline-none transition-colors"
                />
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleResetUserVotes}
                  disabled={resettingUserVotes || !resetVotesUsername.trim()}
                  className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-orange-500 font-bold
                           hover:shadow-lg hover:shadow-red-500/20 transition-all disabled:opacity-50
                           flex items-center gap-2 whitespace-nowrap"
                  type="button"
                >
                  {resettingUserVotes ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      Reset
                    </>
                  )}
                </motion.button>
              </div>
            </div>

            {/* Reset User Votes Result Message */}
            <AnimatePresence>
              {resetVotesResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`mt-4 p-3 rounded-lg ${
                    resetVotesResult.success
                      ? 'bg-green-500/20 border border-green-500/40'
                      : 'bg-red-500/20 border border-red-500/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {resetVotesResult.success ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                    <p className={resetVotesResult.success ? 'text-green-300' : 'text-red-300'}>
                      {resetVotesResult.message}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Reset Active Clips to Pending */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/30">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <Layers className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h3 className="font-bold">Reset Active Clips to Pending</h3>
                  <p className="text-sm text-white/60">
                    Move all active clips back to pending status ({clips.filter(c => c.status === 'active').length} active)
                  </p>
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleResetActiveClipsToPending}
                disabled={resettingActiveClips || clips.filter(c => c.status === 'active').length === 0}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 font-bold
                         hover:shadow-lg hover:shadow-amber-500/20 transition-all disabled:opacity-50
                         flex items-center gap-2 whitespace-nowrap"
                type="button"
              >
                {resettingActiveClips ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <Layers className="w-4 h-4" />
                    Reset to Pending
                  </>
                )}
              </motion.button>
            </div>

            {/* Reset Active Clips Result Message */}
            <AnimatePresence>
              {resetActiveClipsResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`mt-4 p-3 rounded-lg ${
                    resetActiveClipsResult.success
                      ? 'bg-green-500/20 border border-green-500/40'
                      : 'bg-red-500/20 border border-red-500/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {resetActiveClipsResult.success ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                    <p className={resetActiveClipsResult.success ? 'text-green-300' : 'text-red-300'}>
                      {resetActiveClipsResult.message}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Reset Result Message */}
          <AnimatePresence>
            {resetResult && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className={`mt-4 p-4 rounded-xl ${
                  resetResult.success
                    ? 'bg-yellow-500/20 border border-yellow-500/40'
                    : 'bg-red-500/20 border border-red-500/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  {resetResult.success ? (
                    <RotateCcw className="w-5 h-5 text-yellow-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  )}
                  <p className={resetResult.success ? 'text-yellow-300' : 'text-red-300'}>
                    {resetResult.message}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

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
        <div className="flex flex-wrap items-center gap-3">
          {/* Status Filter */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {(['all', 'pending', 'active', 'locked', 'rejected'] as FilterStatus[]).map((status) => (
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

          {/* Season Filter */}
          <div className="flex items-center gap-2">
            <span className="text-white/60 text-sm">Season:</span>
            <select
              value={seasonFilter}
              onChange={(e) => setSeasonFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/10 text-white border border-white/20 outline-none focus:border-cyan-500 transition"
            >
              <option value="all" className="bg-gray-900">All Seasons</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id} className="bg-gray-900">
                  {season.label || `Season ${season.id.slice(0, 8)}`}
                  {season.status === 'active' ? ' (Active)' :
                   season.status === 'finished' ? ' (Finished)' :
                   season.status === 'archived' ? ' (Archived)' : ' (Draft)'}
                </option>
              ))}
            </select>
            {/* Archive/Unarchive Button - only show when a specific season is selected */}
            {seasonFilter !== 'all' && (() => {
              const selectedSeason = seasons.find(s => s.id === seasonFilter);
              if (!selectedSeason || selectedSeason.status === 'active') return null;
              const isArchived = selectedSeason.status === 'archived';
              return (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleArchiveSeason(seasonFilter, !isArchived)}
                  disabled={archivingSeason || deletingSeason}
                  className={`px-3 py-2 rounded-lg transition-all font-medium text-sm flex items-center gap-1 ${
                    isArchived
                      ? 'bg-green-500/20 border border-green-500/40 hover:bg-green-500/30 text-green-300'
                      : 'bg-orange-500/20 border border-orange-500/40 hover:bg-orange-500/30 text-orange-300'
                  } disabled:opacity-50`}
                  type="button"
                  title={isArchived ? 'Unarchive season (make visible to users)' : 'Archive season (hide from users)'}
                >
                  {archivingSeason ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : isArchived ? (
                    <ArchiveRestore className="w-4 h-4" />
                  ) : (
                    <Archive className="w-4 h-4" />
                  )}
                  {isArchived ? 'Unarchive' : 'Archive'}
                </motion.button>
              );
            })()}
            {/* Delete Season Button - only show when a non-active season is selected */}
            {seasonFilter !== 'all' && (() => {
              const selectedSeason = seasons.find(s => s.id === seasonFilter);
              if (!selectedSeason || selectedSeason.status === 'active') return null;
              return (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleDeleteSeason(seasonFilter)}
                  disabled={deletingSeason || archivingSeason}
                  className="px-3 py-2 rounded-lg transition-all font-medium text-sm flex items-center gap-1 bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-300 disabled:opacity-50"
                  type="button"
                  title="Permanently delete season and all its data"
                >
                  {deletingSeason ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Delete
                </motion.button>
              );
            })()}
            {/* Finish Season Early Button - only show when there's an active season */}
            {seasons.some(s => s.status === 'active') && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleFinishSeason}
                disabled={finishingSeason || deletingSeason || archivingSeason}
                className="px-3 py-2 rounded-lg transition-all font-medium text-sm flex items-center gap-1 bg-yellow-500/20 border border-yellow-500/40 hover:bg-yellow-500/30 text-yellow-300 disabled:opacity-50"
                type="button"
                title="Finish the active season early (keeps all data)"
              >
                {finishingSeason ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Flag className="w-4 h-4" />
                )}
                Finish Season
              </motion.button>
            )}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowBulkCleanup(true)}
              className="px-3 py-2 rounded-lg transition-all font-medium text-sm flex items-center gap-1 bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-300"
              type="button"
              title="Delete all seasons and start fresh with Season 1"
            >
              <Trash2 className="w-4 h-4" />
              Fresh Start
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowCreateSeason(true)}
              className="px-3 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 transition-all font-medium text-sm flex items-center gap-1"
              type="button"
            >
              <Layers className="w-4 h-4" />
              New Season
            </motion.button>
          </div>

          {/* Slot Filter */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-white/60 text-sm">Slot:</span>
            <select
              value={slotFilter}
              onChange={(e) => {
                const val = e.target.value;
                setSlotFilter(val === 'all' ? 'all' : val === 'locked' ? 'locked' : Number(val));
              }}
              className="px-3 py-2 rounded-lg bg-white/10 text-white border border-white/20 outline-none focus:border-cyan-500 transition"
            >
              <option value="all" className="bg-gray-900">All Slots</option>
              <option value="locked" className="bg-gray-900">🏆 Winners (Locked)</option>
              {slotInfo && Array.from({ length: slotInfo.currentSlot + 5 }, (_, i) => i + 1).map((slot) => (
                <option key={slot} value={slot} className="bg-gray-900">
                  Slot {slot} {slot === slotInfo.currentSlot ? '(Current)' : slot < slotInfo.currentSlot ? '(Locked)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {filter === 'pending' && filteredClips.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="bg-gradient-to-r from-cyan-500/10 to-purple-500/10 backdrop-blur-sm rounded-xl p-4 border border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSelectAll}
                  className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors font-medium flex items-center gap-2"
                  type="button"
                >
                  {selectedClips.size === filteredClips.filter((c) => c.status === 'pending').length ? (
                    <>
                      <X className="w-4 h-4" />
                      Deselect All
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Select All Pending
                    </>
                  )}
                </motion.button>
                <span className="text-white/60">
                  {selectedClips.size} selected
                </span>
              </div>

              <div className="flex items-center gap-3">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleBulkAction('reject')}
                  disabled={selectedClips.size === 0 || bulkProcessing}
                  className="px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 transition-colors font-medium flex items-center gap-2 disabled:opacity-50"
                  type="button"
                >
                  <X className="w-4 h-4" />
                  Reject Selected
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleBulkAction('approve')}
                  disabled={selectedClips.size === 0 || bulkProcessing}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 hover:shadow-lg hover:shadow-green-500/20 transition-all font-bold flex items-center gap-2 disabled:opacity-50"
                  type="button"
                >
                  {bulkProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Approve Selected
                    </>
                  )}
                </motion.button>
              </div>
            </div>

            {/* Bulk Result Message */}
            <AnimatePresence>
              {bulkResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`mt-4 p-3 rounded-lg ${
                    bulkResult.success
                      ? 'bg-green-500/20 border border-green-500/40'
                      : 'bg-red-500/20 border border-red-500/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {bulkResult.success ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                    <p className={bulkResult.success ? 'text-green-300' : 'text-red-300'}>
                      {bulkResult.message}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Clips List */}
      <div className="max-w-7xl mx-auto px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
          </div>
        ) : filteredClips.length === 0 ? (
          <div className="text-center py-20">
            <AlertCircle className="w-16 h-16 text-white/40 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white/80 mb-2">No clips found</h3>
            <p className="text-white/60">
              {filter === 'pending'
                ? 'No pending clips to review'
                : slotFilter !== 'all'
                ? `No ${filter === 'all' ? '' : filter} clips in Slot ${slotFilter}`
                : `No ${filter} clips at the moment`}
            </p>
          </div>
        ) : (
          <div className="grid gap-6">
            <AnimatePresence>
              {filteredClips.map((clip) => (
                <motion.div
                  key={clip.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  className={`bg-white/5 backdrop-blur-sm rounded-xl border overflow-hidden ${
                    selectedClips.has(clip.id) ? 'border-cyan-500/50 ring-2 ring-cyan-500/20' : 'border-white/10'
                  }`}
                >
                  <div className="grid md:grid-cols-[300px,1fr] gap-6 p-6">
                    {/* Video Preview */}
                    <div className="relative aspect-[9/16] max-w-[300px] mx-auto rounded-xl overflow-hidden bg-black">
                      {/* Selection Checkbox for pending clips */}
                      {clip.status === 'pending' && (
                        <motion.button
                          whileTap={{ scale: 0.9 }}
                          onClick={() => handleSelectClip(clip.id)}
                          className={`absolute top-2 left-2 z-10 w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                            selectedClips.has(clip.id)
                              ? 'bg-cyan-500 text-white'
                              : 'bg-black/50 backdrop-blur-sm border border-white/30 hover:bg-white/20'
                          }`}
                          type="button"
                        >
                          {selectedClips.has(clip.id) && <Check className="w-5 h-5" />}
                        </motion.button>
                      )}
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
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            clip.slot_position === slotInfo?.currentSlot
                              ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                              : clip.slot_position < (slotInfo?.currentSlot || 0)
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : 'bg-white/10'
                          }`}>
                            📍 Slot {clip.slot_position}
                            {clip.slot_position === slotInfo?.currentSlot && ' (Voting)'}
                            {clip.slot_position < (slotInfo?.currentSlot || 0) && ' (Locked)'}
                          </span>
                          <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium">
                            👍 {clip.vote_count} votes
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <Image
                            src={clip.avatar_url}
                            alt={clip.username}
                            width={40}
                            height={40}
                            className="w-10 h-10 rounded-full bg-white/10"
                            unoptimized={clip.avatar_url?.includes('dicebear') || clip.avatar_url?.endsWith('.svg')}
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
                        {/* Assign Winner Button - Only for active clips in current voting slot */}
                        {clip.status === 'active' && clip.slot_position === slotInfo?.currentSlot && (
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => openWinnerModal(clip)}
                            disabled={processingClip === clip.id}
                            className="py-3 px-4 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 font-bold hover:shadow-lg hover:shadow-yellow-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            type="button"
                            title="Assign as winner for this slot"
                          >
                            <Crown className="w-5 h-5" />
                          </motion.button>
                        )}

                        {/* Unlock Slot Button - For clips in locked slots (winners) */}
                        {(clip.status === 'locked' || (clip.slot_position < (slotInfo?.currentSlot || 0) && clip.status === 'active')) && (
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleUnlockSlot(clip)}
                            disabled={processingClip === clip.id}
                            className="py-3 px-4 rounded-xl bg-purple-500/20 border border-purple-500/40 font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            type="button"
                            title="Unlock this slot and remove winner"
                          >
                            <Unlock className="w-5 h-5" />
                          </motion.button>
                        )}

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

      </>
      )}

      {/* FEATURE FLAGS TAB CONTENT */}
      {activeTab === 'features' && (
        <div className="max-w-7xl mx-auto px-4 py-6">
          {/* Feature Flags Header */}
          <div className="mb-6">
            <h2 className="text-xl font-bold mb-2">Feature Flags</h2>
            <p className="text-white/60">Toggle features on/off without code changes. Changes take effect immediately.</p>
          </div>

          {loadingFlags ? (
            <div className="flex items-center justify-center py-20">
              <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
            </div>
          ) : featureFlags.length === 0 ? (
            <div className="text-center py-20">
              <AlertCircle className="w-16 h-16 text-white/40 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white/80 mb-2">No feature flags found</h3>
              <p className="text-white/60">Run the migration SQL to create feature flags.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Group by category */}
              {['growth', 'engagement', 'monetization', 'safety', 'general'].map((category) => {
                const categoryFlags = featureFlags.filter((f) => f.category === category);
                if (categoryFlags.length === 0) return null;

                const categoryIcons: Record<string, React.ReactNode> = {
                  growth: <Zap className="w-5 h-5 text-green-400" />,
                  engagement: <Users className="w-5 h-5 text-cyan-400" />,
                  monetization: <DollarSign className="w-5 h-5 text-yellow-400" />,
                  safety: <Shield className="w-5 h-5 text-red-400" />,
                  general: <Settings className="w-5 h-5 text-white/60" />,
                };

                const categoryColors: Record<string, string> = {
                  growth: 'from-green-500/20 to-emerald-500/20 border-green-500/30',
                  engagement: 'from-cyan-500/20 to-blue-500/20 border-cyan-500/30',
                  monetization: 'from-yellow-500/20 to-orange-500/20 border-yellow-500/30',
                  safety: 'from-red-500/20 to-pink-500/20 border-red-500/30',
                  general: 'from-white/10 to-white/5 border-white/20',
                };

                return (
                  <div key={category} className="space-y-3">
                    <div className="flex items-center gap-2">
                      {categoryIcons[category]}
                      <h3 className="text-lg font-bold capitalize">{category}</h3>
                    </div>

                    <div className="grid gap-3">
                      {categoryFlags.map((flag) => (
                        <motion.div
                          key={flag.id}
                          whileHover={{ scale: 1.01 }}
                          className={`bg-gradient-to-r ${categoryColors[category]} backdrop-blur-sm rounded-xl p-4 border`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-bold">{flag.name}</h4>
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  flag.enabled
                                    ? 'bg-green-500/30 text-green-300'
                                    : 'bg-white/10 text-white/50'
                                }`}>
                                  {flag.enabled ? 'ON' : 'OFF'}
                                </span>
                              </div>
                              <p className="text-sm text-white/60">{flag.description}</p>
                              {flag.enabled && Object.keys(flag.config || {}).length > 0 && (
                                <div className="mt-2 text-xs text-white/40 font-mono">
                                  Config: {JSON.stringify(flag.config)}
                                </div>
                              )}
                            </div>

                            <motion.button
                              whileTap={{ scale: 0.9 }}
                              onClick={() => handleToggleFeature(flag)}
                              disabled={togglingFlag === flag.key}
                              className={`p-3 rounded-xl transition-all ${
                                flag.enabled
                                  ? 'bg-green-500 hover:bg-green-600'
                                  : 'bg-white/10 hover:bg-white/20'
                              } disabled:opacity-50`}
                              type="button"
                            >
                              {togglingFlag === flag.key ? (
                                <RefreshCw className="w-6 h-6 animate-spin" />
                              ) : flag.enabled ? (
                                <ToggleRight className="w-6 h-6" />
                              ) : (
                                <ToggleLeft className="w-6 h-6" />
                              )}
                            </motion.button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Info Box */}
          <div className="mt-8 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
            <p className="text-sm text-blue-300">
              <strong>Note:</strong> Feature flags control which features are available to users.
              Disabled features will be hidden from the UI. Some features may require additional
              database migrations before they can be enabled.
            </p>
          </div>
        </div>
      )}

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

      {/* Assign Winner Modal */}
      <AnimatePresence>
        {winnerCandidate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={closeWinnerModal}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 rounded-2xl border border-yellow-500/30 p-6 max-w-lg w-full"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-yellow-500/20">
                    <Crown className="w-6 h-6 text-yellow-400" />
                  </div>
                  <h2 className="text-2xl font-bold">Assign Winner</h2>
                </div>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={closeWinnerModal}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                  type="button"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              {/* Clip Preview */}
              <div className="bg-white/5 rounded-xl p-4 mb-6 border border-white/10">
                <div className="flex gap-4">
                  {/* Thumbnail - only use Image for actual images, not video URLs */}
                  <div className="relative w-24 h-32 rounded-lg overflow-hidden bg-black flex-shrink-0">
                    {winnerCandidate.thumbnail_url && !winnerCandidate.thumbnail_url.match(/\.(mp4|webm|mov|quicktime)$/i) ? (
                      <Image
                        src={winnerCandidate.thumbnail_url}
                        alt={winnerCandidate.title || 'Clip thumbnail'}
                        fill
                        sizes="96px"
                        className="object-cover"
                      />
                    ) : winnerCandidate.video_url ? (
                      <video
                        src={winnerCandidate.video_url}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/40">
                        <Film className="w-8 h-8" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1">
                    <h3 className="font-bold text-lg mb-1">{winnerCandidate.title}</h3>
                    <p className="text-white/60 text-sm mb-2">by {winnerCandidate.username}</p>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-2 py-1 bg-white/10 rounded-full text-xs">
                        {winnerCandidate.genre}
                      </span>
                      <span className="px-2 py-1 bg-cyan-500/20 text-cyan-400 rounded-full text-xs">
                        {winnerCandidate.vote_count} votes
                      </span>
                      <span className="px-2 py-1 bg-orange-500/20 text-orange-400 rounded-full text-xs">
                        Slot {winnerCandidate.slot_position}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warning */}
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6">
                <p className="text-sm text-yellow-300">
                  <strong>Warning:</strong> This will manually assign this clip as the winner for slot {slotInfo?.currentSlot}.
                  The slot will be locked and voting will advance to the next slot.
                </p>
              </div>

              {/* Result Message */}
              <AnimatePresence>
                {winnerResult && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`mb-6 p-4 rounded-xl ${
                      winnerResult.success
                        ? 'bg-green-500/20 border border-green-500/40'
                        : 'bg-red-500/20 border border-red-500/40'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {winnerResult.success ? (
                        <Trophy className="w-5 h-5 text-green-400" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-red-400" />
                      )}
                      <p className={winnerResult.success ? 'text-green-300' : 'text-red-300'}>
                        {winnerResult.message}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Actions */}
              <div className="flex gap-3">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={closeWinnerModal}
                  disabled={assigningWinner}
                  className="flex-1 py-3 rounded-xl bg-white/10 font-medium hover:bg-white/20 transition-colors disabled:opacity-50"
                  type="button"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleAssignWinner}
                  disabled={assigningWinner || winnerResult?.success}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 font-bold
                           hover:shadow-lg hover:shadow-yellow-500/20 transition-all disabled:opacity-50
                           flex items-center justify-center gap-2"
                  type="button"
                >
                  {assigningWinner ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Assigning...
                    </>
                  ) : winnerResult?.success ? (
                    <>
                      <Check className="w-5 h-5" />
                      Done!
                    </>
                  ) : (
                    <>
                      <Crown className="w-5 h-5" />
                      Confirm Winner
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Season Modal */}
      <AnimatePresence>
        {showCreateSeason && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowCreateSeason(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 rounded-2xl border border-white/20 p-6 max-w-md w-full"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Layers className="w-6 h-6 text-cyan-400" />
                  Create New Season
                </h2>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowCreateSeason(false)}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                  type="button"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-4">
                {/* Season Label */}
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Season Name *
                  </label>
                  <input
                    type="text"
                    value={newSeasonLabel}
                    onChange={(e) => setNewSeasonLabel(e.target.value)}
                    maxLength={50}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                             placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors"
                    placeholder="e.g., Season 2, Summer Edition"
                  />
                </div>

                {/* Total Slots */}
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Total Slots
                  </label>
                  <input
                    type="number"
                    value={newSeasonSlots}
                    onChange={(e) => setNewSeasonSlots(Math.max(1, Math.min(200, Number(e.target.value))))}
                    min={1}
                    max={200}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                             focus:border-cyan-400 focus:outline-none transition-colors"
                  />
                  <p className="text-xs text-white/40 mt-1">Number of story slots (1-200)</p>
                </div>

                {/* Info */}
                <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                  <p className="text-sm text-cyan-300">
                    This will finish the current active season (if any) and create a new one.
                    Voting timer starts when the first clip is uploaded.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowCreateSeason(false)}
                  disabled={creatingSeason}
                  className="flex-1 py-3 rounded-xl bg-white/10 font-medium hover:bg-white/20 transition-colors disabled:opacity-50"
                  type="button"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleCreateSeason}
                  disabled={creatingSeason || !newSeasonLabel.trim()}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500 font-bold
                           hover:shadow-lg hover:shadow-cyan-500/20 transition-all disabled:opacity-50
                           flex items-center justify-center gap-2"
                  type="button"
                >
                  {creatingSeason ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Layers className="w-5 h-5" />
                      Create & Activate
                    </>
                  )}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Cleanup Modal */}
      <AnimatePresence>
        {showBulkCleanup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => !bulkCleanupProcessing && setShowBulkCleanup(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 rounded-2xl border border-red-500/30 p-6 max-w-md w-full"
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold flex items-center gap-2 text-red-400">
                  <Trash2 className="w-6 h-6" />
                  Fresh Start
                </h2>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowBulkCleanup(false)}
                  disabled={bulkCleanupProcessing}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
                  type="button"
                >
                  <X className="w-5 h-5" />
                </motion.button>
              </div>

              <div className="space-y-4">
                {/* Warning */}
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                  <p className="text-sm text-red-300 font-medium mb-2">
                    This will permanently delete:
                  </p>
                  <ul className="text-sm text-red-200/80 space-y-1 ml-4 list-disc">
                    <li>All existing seasons ({seasons.length} total)</li>
                    <li>All clips and votes</li>
                    <li>All slot data</li>
                  </ul>
                </div>

                {/* New Season Name */}
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    New Season Name
                  </label>
                  <input
                    type="text"
                    value={newSeason1Label}
                    onChange={(e) => setNewSeason1Label(e.target.value)}
                    maxLength={50}
                    disabled={bulkCleanupProcessing}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                             placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors
                             disabled:opacity-50"
                    placeholder="Season 1"
                  />
                </div>

                {/* What will happen */}
                <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                  <p className="text-sm text-cyan-300">
                    A fresh &ldquo;{newSeason1Label || 'Season 1'}&rdquo; will be created with 75 slots and activated immediately.
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowBulkCleanup(false)}
                  disabled={bulkCleanupProcessing}
                  className="flex-1 py-3 rounded-xl bg-white/10 font-medium hover:bg-white/20 transition-colors disabled:opacity-50"
                  type="button"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleBulkCleanup}
                  disabled={bulkCleanupProcessing || !newSeason1Label.trim()}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-red-500 to-orange-500 font-bold
                           hover:shadow-lg hover:shadow-red-500/20 transition-all disabled:opacity-50
                           flex items-center justify-center gap-2"
                  type="button"
                >
                  {bulkCleanupProcessing ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Cleaning...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-5 h-5" />
                      Delete All & Create New
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
