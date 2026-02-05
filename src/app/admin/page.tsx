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
  Crosshair,
  Search,
} from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useCsrf } from '@/hooks/useCsrf';
import BottomNavigation from '@/components/BottomNavigation';

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
  is_ai_generated?: boolean;
  ai_prompt?: string;
  ai_model?: string;
}

interface Season {
  id: string;
  label: string;
  description?: string;
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
  { id: 'sci-fi', name: 'Sci-Fi', emoji: '🚀' },
  { id: 'romance', name: 'Romance', emoji: '❤️' },
  { id: 'animation', name: 'Animation', emoji: '🎨' },
  { id: 'horror', name: 'Horror', emoji: '👻' },
  { id: 'drama', name: 'Drama', emoji: '🎭' },
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

  // God Mode state
  const [showFreeAssign, setShowFreeAssign] = useState(false);
  const [freeAssignClipId, setFreeAssignClipId] = useState<string>('');
  const [freeAssignTargetSlot, setFreeAssignTargetSlot] = useState<number | ''>(1);
  const [freeAssigning, setFreeAssigning] = useState(false);
  const [freeAssignResult, setFreeAssignResult] = useState<{ success: boolean; message: string } | null>(null);
  const [allSlots, setAllSlots] = useState<{ slot_position: number; status: string; winner_tournament_clip_id: string | null; winner_username?: string; clip_count?: number }[]>([]);
  const [freeAssignSearch, setFreeAssignSearch] = useState('');
  type GodModeAction = 'assign' | 'change_status' | 'change_slot_status' | 'reorganize';
  const [godModeAction, setGodModeAction] = useState<GodModeAction>('assign');
  const [godModeNewStatus, setGodModeNewStatus] = useState<'pending' | 'active' | 'rejected'>('active');
  const [godModeSlotPosition, setGodModeSlotPosition] = useState<number | ''>(1);
  const [godModeSlotNewStatus, setGodModeSlotNewStatus] = useState<'voting' | 'waiting_for_clips' | 'upcoming'>('waiting_for_clips');

  // Slot reorganization state
  const [reorgSelectedSlots, setReorgSelectedSlots] = useState<Set<number>>(new Set());
  const [reorgProcessing, setReorgProcessing] = useState(false);
  const [reorgResult, setReorgResult] = useState<{ success: boolean; message: string } | null>(null);
  const [reorgMode, setReorgMode] = useState<'delete' | 'swap'>('delete');
  const [reorgShowConfirm, setReorgShowConfirm] = useState(false);
  const [reorgPreview, setReorgPreview] = useState<{
    slotsToDelete: Array<{ slot_position: number; status: string }>;
    clipsToDelete: Array<{ id: string; title: string; username: string; slot_position: number }>;
    shiftAmount: number;
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
  const [newSeasonDescription, setNewSeasonDescription] = useState('');
  const [newSeasonSlots, setNewSeasonSlots] = useState(75);

  // Edit season description state
  const [editingDescription, setEditingDescription] = useState(false);
  const [editDescriptionText, setEditDescriptionText] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);

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
          description: newSeasonDescription.trim(),
          total_slots: newSeasonSlots,
          auto_activate: true,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`${data.message}`);
        setShowCreateSeason(false);
        setNewSeasonLabel('');
        setNewSeasonDescription('');
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
        headers: getHeaders(),
        credentials: 'include',
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
  // EDIT SEASON DESCRIPTION
  // ============================================================================

  const handleEditDescription = (seasonId: string) => {
    const season = seasons.find(s => s.id === seasonId);
    if (!season) return;
    setEditDescriptionText(season.description || '');
    setEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    if (seasonFilter === 'all') return;

    setSavingDescription(true);
    try {
      const response = await fetch('/api/admin/seasons', {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          season_id: seasonFilter,
          description: editDescriptionText.trim(),
        }),
      });

      const data = await response.json();
      if (data.success) {
        fetchSeasons();
        setEditingDescription(false);
      } else {
        alert(`Error: ${data.error || 'Failed to update description'}`);
      }
    } catch (error) {
      console.error('Failed to update description:', error);
      alert('Network error - failed to update description');
    } finally {
      setSavingDescription(false);
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
        headers: getHeaders(),
        credentials: 'include',
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
        headers: getHeaders(),
        credentials: 'include',
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
  // FREE ASSIGN CLIP TO SLOT
  // ============================================================================

  const openFreeAssignModal = async () => {
    setShowFreeAssign(true);
    setFreeAssignClipId('');
    setFreeAssignTargetSlot(1);
    setFreeAssignResult(null);
    setFreeAssignSearch('');

    // Fetch all slots: first get season_id, then fetch full slot list
    try {
      const simpleRes = await fetch('/api/admin/slots');
      const simpleData = await simpleRes.json();
      if (simpleData.ok && simpleData.season_id) {
        const fullRes = await fetch(`/api/admin/slots?season_id=${simpleData.season_id}`);
        const fullData = await fullRes.json();
        if (fullData.ok && fullData.slots) {
          setAllSlots(fullData.slots.map((s: { slot_position: number; status: string; winner_tournament_clip_id: string | null; winner_details?: { username?: string; clip_id?: string }; clip_count?: number }) => ({
            slot_position: s.slot_position,
            status: s.status,
            winner_tournament_clip_id: s.winner_tournament_clip_id,
            winner_username: s.winner_details?.username,
            clip_count: s.clip_count,
          })));
        }
      }
    } catch (error) {
      console.error('Failed to fetch slots:', error);
    }
  };

  const closeFreeAssignModal = () => {
    setShowFreeAssign(false);
    setFreeAssignClipId('');
    setFreeAssignResult(null);
    setGodModeAction('assign');
    setGodModeNewStatus('active');
    setGodModeSlotPosition(1);
    setGodModeSlotNewStatus('voting');
    // Reset reorganization state
    setReorgSelectedSlots(new Set());
    setReorgResult(null);
    setReorgMode('delete');
    setReorgPreview(null);
    setReorgShowConfirm(false);
  };

  const handleFreeAssign = async () => {
    if (!freeAssignClipId || !freeAssignTargetSlot) return;

    setFreeAssigning(true);
    setFreeAssignResult(null);

    try {
      const response = await fetch('/api/admin/assign-clip-to-slot', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          clipId: freeAssignClipId,
          targetSlotPosition: freeAssignTargetSlot,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        let msg = data.message || 'Clip assigned successfully';
        if (data.sourceSlotCleared) {
          msg += ` | Source slot ${data.sourceSlotCleared} → ${data.sourceSlotNewStatus}`;
        }
        if (data.previousWinnerReverted) {
          msg += ' | Previous winner reverted to active';
        }
        if (data.activeClipsRemaining > 0) {
          msg += ` | ${data.activeClipsRemaining} active clips remain in slot`;
        }
        setFreeAssignResult({ success: true, message: msg });
        fetchSlotInfo();
        fetchClips();
        setTimeout(() => {
          closeFreeAssignModal();
        }, 2500);
      } else {
        setFreeAssignResult({
          success: false,
          message: data.error || 'Failed to assign clip',
        });
      }
    } catch (error) {
      console.error('Failed to free-assign clip:', error);
      setFreeAssignResult({
        success: false,
        message: 'Network error - failed to assign clip',
      });
    }

    setFreeAssigning(false);
  };

  const handleChangeStatus = async () => {
    if (!freeAssignClipId || !godModeNewStatus) return;

    setFreeAssigning(true);
    setFreeAssignResult(null);

    try {
      const response = await fetch('/api/admin/update-clip-status', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          clipId: freeAssignClipId,
          newStatus: godModeNewStatus,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        let msg = data.message || 'Status changed';
        if (data.slotCleared) {
          msg += ` | Slot ${data.slotCleared} → ${data.slotNewStatus}`;
        }
        setFreeAssignResult({ success: true, message: msg });
        fetchSlotInfo();
        fetchClips();
        setTimeout(() => closeFreeAssignModal(), 2500);
      } else {
        setFreeAssignResult({ success: false, message: data.error || 'Failed to change status' });
      }
    } catch (error) {
      console.error('God mode status change failed:', error);
      setFreeAssignResult({ success: false, message: 'Network error' });
    }

    setFreeAssigning(false);
  };

  const handleChangeSlotStatus = async () => {
    if (!godModeSlotPosition) return;

    setFreeAssigning(true);
    setFreeAssignResult(null);

    try {
      const response = await fetch('/api/admin/update-slot-status', {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          slotPosition: godModeSlotPosition,
          newStatus: godModeSlotNewStatus,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        let msg = data.message || 'Slot status changed';
        if (data.winnerClipReverted) {
          msg += ' | Winner clip reverted to active';
        }
        if (data.activeClipCount != null) {
          msg += ` | ${data.activeClipCount} active clips in slot`;
        }
        if (data.warning) {
          msg += ` | ⚠ ${data.warning}`;
        }
        setFreeAssignResult({ success: true, message: msg });
        fetchSlotInfo();
        fetchClips();
        setTimeout(() => closeFreeAssignModal(), 2500);
      } else {
        setFreeAssignResult({ success: false, message: data.error || 'Failed to change slot status' });
      }
    } catch (error) {
      console.error('God mode slot status change failed:', error);
      setFreeAssignResult({ success: false, message: 'Network error' });
    }

    setFreeAssigning(false);
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
    const currentVotingSlot = slotInfo?.currentSlot || 0;
    const hasActiveVoting = currentVotingSlot > clip.slot_position;

    let confirmMsg = `Unlock slot ${clip.slot_position}?\n\nThis will:\n- Remove "${clip.title}" as the winner\n- Set slot ${clip.slot_position} back to "voting" status`;
    if (hasActiveVoting) {
      confirmMsg += `\n- ⚠️ PAUSE voting on Slot ${currentVotingSlot} (will be deactivated)`;
    }
    confirmMsg += `\n- Optionally revert the clip to "pending"\n\nDo you also want to revert the clip to pending status?`;

    const revertToPending = confirm(confirmMsg);

    // Second confirmation for the unlock action itself
    let secondConfirm = `Confirm: Unlock slot ${clip.slot_position} and remove winner?`;
    if (hasActiveVoting) {
      secondConfirm += `\n\n⚠️ This will pause voting on Slot ${currentVotingSlot}!`;
    }
    if (!confirm(secondConfirm)) {
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
        let message = `Slot ${clip.slot_position} unlocked successfully!`;
        if (data.clipReverted) message += '\nClip reverted to pending.';
        if (data.deactivatedSlot) message += `\nSlot ${data.deactivatedSlot} voting was paused.`;
        alert(message);
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
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
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
            <Link href="/admin/characters">
              <motion.button
                whileTap={{ scale: 0.95 }}
                className="px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 bg-white/10 text-white/70 hover:bg-white/20"
                type="button"
              >
                <Crosshair className="w-4 h-4" />
                Characters
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

            {/* Action Buttons - Grid on mobile, flex on desktop */}
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 sm:gap-3 w-full md:w-auto">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={fetchSlotInfo}
                className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors col-span-2 sm:col-span-1 flex items-center justify-center gap-2 sm:w-auto"
                type="button"
                title="Refresh slot info"
              >
                <RefreshCw className="w-5 h-5" />
                <span className="sm:hidden">Refresh</span>
              </motion.button>

              {/* Reset Season Button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleResetSeason}
                disabled={resettingSeason || fullResetting || !slotInfo}
                className="px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 font-bold
                         hover:shadow-lg hover:shadow-yellow-500/20 transition-all disabled:opacity-50
                         flex items-center justify-center gap-2 text-sm sm:text-base"
                type="button"
                title="Reset season to slot 1"
              >
                {resettingSeason ? (
                  <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden xs:inline">Reset</span>
                  </>
                )}
              </motion.button>

              {/* Full Clean Reset Button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleFullCleanReset}
                disabled={resettingSeason || fullResetting || !slotInfo}
                className="px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl bg-gradient-to-r from-red-600 to-red-800 font-bold
                         hover:shadow-lg hover:shadow-red-500/20 transition-all disabled:opacity-50
                         flex items-center justify-center gap-2 border border-red-400/50 text-sm sm:text-base"
                type="button"
                title="Complete reset: clears all votes and resets everything"
              >
                {fullResetting ? (
                  <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span className="hidden xs:inline">Full Reset</span>
                  </>
                )}
              </motion.button>

              {/* Advance Slot Button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleAdvanceSlot}
                disabled={advancingSlot || !slotInfo || slotInfo.seasonStatus !== 'active'}
                className="px-3 py-2.5 sm:px-6 sm:py-3 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 font-bold
                         hover:shadow-lg hover:shadow-orange-500/20 transition-all disabled:opacity-50
                         flex items-center justify-center gap-2 col-span-2 text-sm sm:text-base"
                type="button"
              >
                {advancingSlot ? (
                  <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                ) : (
                  <>
                    <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
                    <span>Advance Slot</span>
                  </>
                )}
              </motion.button>

              {/* God Mode Button */}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={openFreeAssignModal}
                disabled={!slotInfo || slotInfo.seasonStatus !== 'active'}
                className="px-3 py-2.5 sm:px-4 sm:py-3 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 font-bold
                         hover:shadow-lg hover:shadow-purple-500/20 transition-all disabled:opacity-50
                         flex items-center justify-center gap-2 col-span-2 text-sm sm:text-base"
                type="button"
                title="Full clip control: assign to slot or change status"
              >
                <Crown className="w-4 h-4 sm:w-5 sm:h-5" />
                <span>God Mode</span>
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

              <div className="flex flex-col sm:flex-row flex-1 gap-2 sm:gap-3">
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
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-orange-500 font-bold
                           hover:shadow-lg hover:shadow-red-500/20 transition-all disabled:opacity-50
                           flex items-center justify-center gap-2 whitespace-nowrap"
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
      <div className="max-w-7xl mx-auto px-4 py-4 space-y-3">
        {/* Status Filter - Horizontal scroll on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
          {(['all', 'pending', 'active', 'locked', 'rejected'] as FilterStatus[]).map((status) => (
            <motion.button
              key={status}
              whileTap={{ scale: 0.95 }}
              onClick={() => setFilter(status)}
              className={`px-3 sm:px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-all text-sm sm:text-base ${
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

        {/* Season & Slot Filters - Stack on mobile */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Season Filter */}
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-white/60 text-sm whitespace-nowrap">Season:</span>
            <select
              value={seasonFilter}
              onChange={(e) => setSeasonFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-white/10 text-white border border-white/20 outline-none focus:border-cyan-500 transition text-sm"
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
          </div>

          {/* Slot Filter */}
          <div className="flex items-center gap-2 sm:ml-auto">
            <span className="text-white/60 text-sm whitespace-nowrap">Slot:</span>
            <select
              value={slotFilter}
              onChange={(e) => {
                const val = e.target.value;
                setSlotFilter(val === 'all' ? 'all' : val === 'locked' ? 'locked' : Number(val));
              }}
              className="px-3 py-2 rounded-lg bg-white/10 text-white border border-white/20 outline-none focus:border-cyan-500 transition text-sm"
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

        {/* Season Action Buttons - Scrollable on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
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
                className={`px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg transition-all font-medium text-xs sm:text-sm flex items-center gap-1 whitespace-nowrap ${
                  isArchived
                    ? 'bg-green-500/20 border border-green-500/40 hover:bg-green-500/30 text-green-300'
                    : 'bg-orange-500/20 border border-orange-500/40 hover:bg-orange-500/30 text-orange-300'
                } disabled:opacity-50`}
                type="button"
                title={isArchived ? 'Unarchive season (make visible to users)' : 'Archive season (hide from users)'}
              >
                {archivingSeason ? (
                  <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
                ) : isArchived ? (
                  <ArchiveRestore className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                ) : (
                  <Archive className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                )}
                <span className="hidden sm:inline">{isArchived ? 'Unarchive' : 'Archive'}</span>
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
                className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg transition-all font-medium text-xs sm:text-sm flex items-center gap-1 bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-300 disabled:opacity-50 whitespace-nowrap"
                type="button"
                title="Permanently delete season and all its data"
              >
                {deletingSeason ? (
                  <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                )}
                <span className="hidden sm:inline">Delete</span>
              </motion.button>
            );
          })()}
          {/* Finish Season Early Button - only show when there's an active season */}
          {seasons.some(s => s.status === 'active') && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleFinishSeason}
              disabled={finishingSeason || deletingSeason || archivingSeason}
              className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg transition-all font-medium text-xs sm:text-sm flex items-center gap-1 bg-yellow-500/20 border border-yellow-500/40 hover:bg-yellow-500/30 text-yellow-300 disabled:opacity-50 whitespace-nowrap"
              type="button"
              title="Finish the active season early (keeps all data)"
            >
              {finishingSeason ? (
                <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                <Flag className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              )}
              <span className="hidden sm:inline">Finish</span>
            </motion.button>
          )}
          {/* Edit Description Button - show when a specific season is selected */}
          {seasonFilter !== 'all' && (
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => handleEditDescription(seasonFilter)}
              className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg transition-all font-medium text-xs sm:text-sm flex items-center gap-1 bg-purple-500/20 border border-purple-500/40 hover:bg-purple-500/30 text-purple-300 whitespace-nowrap"
              type="button"
              title="Edit the story description shown on the Story page"
            >
              <Edit className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Description</span>
            </motion.button>
          )}
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowBulkCleanup(true)}
            className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg transition-all font-medium text-xs sm:text-sm flex items-center gap-1 bg-red-500/20 border border-red-500/40 hover:bg-red-500/30 text-red-300 whitespace-nowrap"
            type="button"
            title="Delete all seasons and start fresh with Season 1"
          >
            <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Fresh Start</span>
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowCreateSeason(true)}
            className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 transition-all font-medium text-xs sm:text-sm flex items-center gap-1 whitespace-nowrap"
            type="button"
          >
            <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>New Season</span>
          </motion.button>
        </div>
      </div>

      {/* Inline Description Editor */}
      <AnimatePresence>
        {editingDescription && seasonFilter !== 'all' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="max-w-7xl mx-auto px-4"
          >
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 mt-2">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-purple-300">Story Description (typewriter intro on Story page)</label>
                <button
                  onClick={() => setEditingDescription(false)}
                  className="text-white/40 hover:text-white/70 transition-colors"
                  type="button"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <textarea
                value={editDescriptionText}
                onChange={(e) => setEditDescriptionText(e.target.value)}
                maxLength={200}
                rows={2}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm
                         placeholder-white/40 focus:border-purple-400 focus:outline-none transition-colors resize-none"
                placeholder="e.g., In a world where clips battle for glory..."
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-white/40">{editDescriptionText.length}/200</span>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleSaveDescription}
                  disabled={savingDescription}
                  className="px-4 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-400 text-white text-sm font-medium
                           transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  type="button"
                >
                  {savingDescription ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  Save
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                    <div className="flex flex-col justify-between min-w-0">
                      <div className="space-y-4">
                        <div>
                          <h3 className="text-lg sm:text-xl font-bold mb-1 truncate">
                            {clip.is_ai_generated && (
                              <span className="inline-block mr-2 px-2 py-0.5 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded text-xs font-medium align-middle">AI</span>
                            )}
                            {clip.title}
                          </h3>
                          <p className="text-white/60 text-sm line-clamp-2">{clip.description || 'No description'}</p>
                          {clip.is_ai_generated && clip.ai_prompt && (
                            <p className="text-purple-400/60 text-xs mt-1 line-clamp-1">Prompt: {clip.ai_prompt}</p>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium">
                            🎭 {clip.genre}
                          </span>
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            clip.slot_position == null
                              ? 'bg-white/10'
                              : clip.slot_position === slotInfo?.currentSlot
                              ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                              : clip.slot_position < (slotInfo?.currentSlot || 0)
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : 'bg-white/10'
                          }`}>
                            {clip.slot_position == null ? '📍 No slot' : `📍 Slot ${clip.slot_position}`}
                            {clip.slot_position != null && clip.slot_position === slotInfo?.currentSlot && ' (Voting)'}
                            {clip.slot_position != null && clip.slot_position < (slotInfo?.currentSlot || 0) && ' (Locked)'}
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

                      {/* Action Buttons - Grid on mobile */}
                      <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3 mt-4">
                        {/* Assign Winner Button - Only for active clips in current voting slot */}
                        {clip.status === 'active' && clip.slot_position === slotInfo?.currentSlot && (
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => openWinnerModal(clip)}
                            disabled={processingClip === clip.id}
                            className="py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl bg-gradient-to-r from-yellow-500 to-amber-500 font-bold hover:shadow-lg hover:shadow-yellow-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm sm:text-base"
                            type="button"
                            title="Assign as winner for this slot"
                          >
                            <Crown className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span className="sm:hidden">Winner</span>
                          </motion.button>
                        )}

                        {/* Unlock Slot Button - For winning clips in locked slots */}
                        {clip.status === 'locked' && (
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleUnlockSlot(clip)}
                            disabled={processingClip === clip.id}
                            className="py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl bg-purple-500/20 border border-purple-500/40 font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm sm:text-base"
                            type="button"
                            title="Unlock this slot and remove winner"
                          >
                            <Unlock className="w-4 h-4 sm:w-5 sm:h-5" />
                            <span className="sm:hidden">Unlock</span>
                          </motion.button>
                        )}

                        {/* Edit Button - Always visible */}
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => openEditModal(clip)}
                          disabled={processingClip === clip.id}
                          className="sm:flex-1 py-2.5 sm:py-3 px-3 rounded-xl bg-blue-500/20 border border-blue-500/40 font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm sm:text-base"
                          type="button"
                        >
                          <Edit className="w-4 h-4 sm:w-5 sm:h-5" />
                          Edit
                        </motion.button>

                        {/* Delete Button */}
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleDelete(clip.id)}
                          disabled={processingClip === clip.id}
                          className="py-2.5 sm:py-3 px-3 sm:px-4 rounded-xl bg-red-500/20 border border-red-500/40 font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm sm:text-base"
                          type="button"
                        >
                          <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                          <span className="sm:hidden">Delete</span>
                        </motion.button>

                        {/* Approve/Reject - Only for pending */}
                        {clip.status === 'pending' && (
                          <>
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleReject(clip.id)}
                              disabled={processingClip === clip.id}
                              className="sm:flex-1 py-2.5 sm:py-3 px-3 rounded-xl bg-red-500/20 border border-red-500/40 font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm sm:text-base"
                              type="button"
                            >
                              <X className="w-4 h-4 sm:w-5 sm:h-5" />
                              Reject
                            </motion.button>

                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={() => handleApprove(clip.id)}
                              disabled={processingClip === clip.id}
                              className="sm:flex-1 py-2.5 sm:py-3 px-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 font-bold hover:shadow-lg hover:shadow-green-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2 col-span-2 sm:col-span-1 text-sm sm:text-base"
                              type="button"
                            >
                              <Check className="w-4 h-4 sm:w-5 sm:h-5" />
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
              {['growth', 'engagement', 'monetization', 'safety', 'performance', 'realtime', 'ai', 'general'].map((category) => {
                const categoryFlags = featureFlags.filter((f) => f.category === category);
                if (categoryFlags.length === 0) return null;

                const categoryIcons: Record<string, React.ReactNode> = {
                  growth: <Zap className="w-5 h-5 text-green-400" />,
                  engagement: <Users className="w-5 h-5 text-cyan-400" />,
                  monetization: <DollarSign className="w-5 h-5 text-yellow-400" />,
                  safety: <Shield className="w-5 h-5 text-red-400" />,
                  performance: <Zap className="w-5 h-5 text-purple-400" />,
                  realtime: <Zap className="w-5 h-5 text-orange-400" />,
                  ai: <Crosshair className="w-5 h-5 text-pink-400" />,
                  general: <Settings className="w-5 h-5 text-white/60" />,
                };

                const categoryColors: Record<string, string> = {
                  growth: 'from-green-500/20 to-emerald-500/20 border-green-500/30',
                  engagement: 'from-cyan-500/20 to-blue-500/20 border-cyan-500/30',
                  monetization: 'from-yellow-500/20 to-orange-500/20 border-yellow-500/30',
                  safety: 'from-red-500/20 to-pink-500/20 border-red-500/30',
                  performance: 'from-purple-500/20 to-violet-500/20 border-purple-500/30',
                  realtime: 'from-orange-500/20 to-amber-500/20 border-orange-500/30',
                  ai: 'from-pink-500/20 to-fuchsia-500/20 border-pink-500/30',
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

      {/* Free Assign Modal */}
      <AnimatePresence>
        {showFreeAssign && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={closeFreeAssignModal}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 rounded-2xl border border-purple-500/30 p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/20">
                    <Crown className="w-6 h-6 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">God Mode</h3>
                    <p className="text-xs text-white/50">Full clip & slot control</p>
                  </div>
                </div>
                <button
                  onClick={closeFreeAssignModal}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5 text-white/60" />
                </button>
              </div>

              {/* Clip Selection — hidden for slot status tab */}
              {godModeAction !== 'change_slot_status' && godModeAction !== 'reorganize' && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-white/70 mb-2">Select Clip</label>
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <input
                      type="text"
                      value={freeAssignSearch}
                      onChange={(e) => setFreeAssignSearch(e.target.value)}
                      placeholder="Search by title or username..."
                      className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm
                               placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-white/5">
                    {clips
                      .filter((c) => {
                        const search = freeAssignSearch.toLowerCase();
                        return !search || c.title.toLowerCase().includes(search) || c.username.toLowerCase().includes(search);
                      })
                      .slice(0, 50)
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setFreeAssignClipId(c.id)}
                          className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-white/10 transition-colors border-b border-white/5 last:border-b-0 ${
                            freeAssignClipId === c.id ? 'bg-purple-500/20 border-l-2 border-l-purple-400' : ''
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{c.title}</p>
                            <p className="text-xs text-white/50">@{c.username} · Slot {c.slot_position} · {c.status}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            c.status === 'locked' ? 'bg-green-500/20 text-green-400' :
                            c.status === 'active' ? 'bg-blue-500/20 text-blue-400' :
                            c.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {c.status}
                          </span>
                        </button>
                      ))}
                    {clips.filter((c) => {
                      const search = freeAssignSearch.toLowerCase();
                      return !search || c.title.toLowerCase().includes(search) || c.username.toLowerCase().includes(search);
                    }).length === 0 && (
                      <p className="text-center text-white/30 text-sm py-4">No clips found</p>
                    )}
                  </div>
                </div>
              )}

              {/* Action Tabs */}
              <div className="flex gap-1 mb-4 p-1 bg-white/5 rounded-lg">
                <button
                  onClick={() => { setGodModeAction('assign'); setFreeAssignResult(null); }}
                  className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                    godModeAction === 'assign' ? 'bg-purple-500/30 text-purple-300' : 'text-white/50 hover:text-white/70'
                  }`}
                >
                  Assign
                </button>
                <button
                  onClick={() => { setGodModeAction('change_status'); setFreeAssignResult(null); }}
                  className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                    godModeAction === 'change_status' ? 'bg-purple-500/30 text-purple-300' : 'text-white/50 hover:text-white/70'
                  }`}
                >
                  Status
                </button>
                <button
                  onClick={() => { setGodModeAction('change_slot_status'); setFreeAssignResult(null); }}
                  className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                    godModeAction === 'change_slot_status' ? 'bg-purple-500/30 text-purple-300' : 'text-white/50 hover:text-white/70'
                  }`}
                >
                  Slot
                </button>
                <button
                  onClick={() => { setGodModeAction('reorganize'); setFreeAssignResult(null); setReorgResult(null); }}
                  className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
                    godModeAction === 'reorganize' ? 'bg-red-500/30 text-red-300' : 'text-white/50 hover:text-white/70'
                  }`}
                >
                  Reorg
                </button>
              </div>

              {/* Assign to Slot Panel */}
              {godModeAction === 'assign' && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-white/70 mb-2">Assign to Slot</label>
                    <input
                      type="number"
                      min={1}
                      max={slotInfo?.totalSlots || 75}
                      value={freeAssignTargetSlot}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setFreeAssignTargetSlot('');
                        } else {
                          const num = parseInt(val);
                          if (!isNaN(num)) setFreeAssignTargetSlot(Math.max(1, Math.min(slotInfo?.totalSlots || 75, num)));
                        }
                      }}
                      onBlur={() => { if (freeAssignTargetSlot === '') setFreeAssignTargetSlot(1); }}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm
                               focus:outline-none focus:border-purple-500/50"
                    />
                    {(() => {
                      const targetInfo = allSlots.find((s) => s.slot_position === freeAssignTargetSlot);
                      if (targetInfo) {
                        return (
                          <div className="mt-2 p-2 rounded-lg bg-white/5 text-xs text-white/60">
                            Slot {freeAssignTargetSlot}: <span className={
                              targetInfo.status === 'locked' ? 'text-green-400' :
                              targetInfo.status === 'voting' ? 'text-blue-400' :
                              targetInfo.status === 'waiting_for_clips' ? 'text-yellow-400' :
                              'text-white/40'
                            }>{targetInfo.status}</span>
                            {targetInfo.winner_username && (
                              <> · Winner: @{targetInfo.winner_username}</>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  {/* Assign Warnings */}
                  {freeAssignClipId && freeAssignTargetSlot && (() => {
                    const warnings: string[] = [];
                    const selectedClip = clips.find((c) => c.id === freeAssignClipId);
                    const targetInfo = allSlots.find((s) => s.slot_position === freeAssignTargetSlot);

                    if (targetInfo?.winner_tournament_clip_id && targetInfo.winner_tournament_clip_id !== freeAssignClipId) {
                      warnings.push(`Slot ${freeAssignTargetSlot} has a winner (${targetInfo.winner_username || 'unknown'}) — will be reverted to active`);
                    }
                    if (selectedClip) {
                      const sourceSlot = allSlots.find((s) => s.winner_tournament_clip_id === freeAssignClipId && s.slot_position !== freeAssignTargetSlot);
                      if (sourceSlot) {
                        warnings.push(`Clip is winner of slot ${sourceSlot.slot_position} — that slot will be cleared`);
                      }
                    }
                    if (targetInfo?.status === 'voting') {
                      warnings.push(`Slot ${freeAssignTargetSlot} is currently voting — voting will stop`);
                    }

                    if (warnings.length === 0) return null;

                    return (
                      <div className="mb-4 space-y-2">
                        {warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-yellow-300">{w}</p>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Change Status Panel */}
              {godModeAction === 'change_status' && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-white/70 mb-2">New Status</label>
                    <div className="flex gap-2">
                      {(['pending', 'active', 'rejected'] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setGodModeNewStatus(s)}
                          className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                            godModeNewStatus === s
                              ? s === 'pending' ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300'
                                : s === 'active' ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                                : 'bg-red-500/20 border-red-500/50 text-red-300'
                              : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                          }`}
                        >
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Status Change Warnings */}
                  {freeAssignClipId && (() => {
                    const warnings: string[] = [];
                    const selectedClip = clips.find((c) => c.id === freeAssignClipId);

                    if (selectedClip?.status === godModeNewStatus) {
                      warnings.push(`Clip is already "${godModeNewStatus}" — no change will occur`);
                    }
                    if (selectedClip?.status === 'locked') {
                      const ownerSlot = allSlots.find((s) => s.winner_tournament_clip_id === freeAssignClipId);
                      if (ownerSlot) {
                        warnings.push(`This clip is winner of Slot ${ownerSlot.slot_position} — that slot will lose its winner`);
                      }
                    }

                    if (warnings.length === 0) return null;

                    return (
                      <div className="mb-4 space-y-2">
                        {warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-yellow-300">{w}</p>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Change Slot Status Panel */}
              {godModeAction === 'change_slot_status' && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-white/70 mb-2">Slot Number</label>
                    <input
                      type="number"
                      min={1}
                      max={slotInfo?.totalSlots || 75}
                      value={godModeSlotPosition}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '') {
                          setGodModeSlotPosition('');
                        } else {
                          const num = parseInt(val);
                          if (!isNaN(num)) setGodModeSlotPosition(Math.max(1, Math.min(slotInfo?.totalSlots || 75, num)));
                        }
                      }}
                      onBlur={() => { if (godModeSlotPosition === '') setGodModeSlotPosition(1); }}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm
                               focus:outline-none focus:border-purple-500/50"
                    />
                    {(() => {
                      const targetInfo = allSlots.find((s) => s.slot_position === godModeSlotPosition);
                      if (targetInfo) {
                        return (
                          <div className="mt-2 p-2 rounded-lg bg-white/5 text-xs text-white/60">
                            Slot {godModeSlotPosition}: <span className={
                              targetInfo.status === 'locked' ? 'text-green-400' :
                              targetInfo.status === 'voting' ? 'text-blue-400' :
                              targetInfo.status === 'waiting_for_clips' ? 'text-yellow-400' :
                              'text-white/40'
                            }>{targetInfo.status}</span>
                            {targetInfo.winner_username && (
                              <> · Winner: @{targetInfo.winner_username}</>
                            )}
                            {targetInfo.clip_count !== undefined && (
                              <> · ~{targetInfo.clip_count} clips</>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-white/70 mb-2">New Status</label>
                    <div className="flex gap-2">
                      {([
                        { value: 'voting', label: 'Voting', activeClass: 'bg-blue-500/20 border-blue-500/50 text-blue-300' },
                        { value: 'waiting_for_clips', label: 'Waiting', activeClass: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300' },
                        { value: 'upcoming', label: 'Upcoming', activeClass: 'bg-white/10 border-white/30 text-white/70' },
                      ] as const).map((s) => (
                        <button
                          key={s.value}
                          onClick={() => setGodModeSlotNewStatus(s.value as 'voting' | 'waiting_for_clips' | 'upcoming')}
                          className={`flex-1 px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                            godModeSlotNewStatus === s.value
                              ? s.activeClass
                              : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Slot Status Warnings */}
                  {(() => {
                    const warnings: string[] = [];
                    const targetInfo = allSlots.find((s) => s.slot_position === godModeSlotPosition);

                    if (targetInfo) {
                      if (targetInfo.status === godModeSlotNewStatus) {
                        warnings.push(`Slot is already "${godModeSlotNewStatus}" — no change will occur`);
                      }
                      if (targetInfo.status === 'locked' && targetInfo.winner_username) {
                        warnings.push(`Slot ${godModeSlotPosition} has winner @${targetInfo.winner_username} — winner will be reverted to active`);
                      }
                      if (godModeSlotNewStatus === 'voting') {
                        const otherVoting = allSlots.find((s) => s.status === 'voting' && s.slot_position !== godModeSlotPosition);
                        if (otherVoting) {
                          warnings.push(`Slot ${otherVoting.slot_position} is also voting — proceed with caution`);
                        }
                      }
                    }

                    if (warnings.length === 0) return null;

                    return (
                      <div className="mb-4 space-y-2">
                        {warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-yellow-300">{w}</p>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}

              {/* Reorganize Slots Panel */}
              {godModeAction === 'reorganize' && (
                <>
                  {/* Mode Toggle */}
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={() => { setReorgMode('delete'); setReorgSelectedSlots(new Set()); setReorgResult(null); }}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        reorgMode === 'delete' ? 'bg-red-500/30 text-red-300 border border-red-500/50' : 'bg-white/5 text-white/50 hover:bg-white/10'
                      }`}
                    >
                      Delete & Shift
                    </button>
                    <button
                      onClick={() => { setReorgMode('swap'); setReorgSelectedSlots(new Set()); setReorgResult(null); }}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        reorgMode === 'swap' ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50' : 'bg-white/5 text-white/50 hover:bg-white/10'
                      }`}
                    >
                      Swap Slots
                    </button>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-white/70 mb-2">
                      {reorgMode === 'delete' ? 'Select Slots to Delete' : 'Select 2 Slots to Swap'}
                    </label>
                    <p className="text-xs text-white/40 mb-3">
                      {reorgMode === 'delete'
                        ? 'Click slots to select. Remaining slots will shift down to fill gaps.'
                        : 'Click exactly 2 slots to swap their positions.'}
                    </p>

                    {/* Slot Grid - All slots (scrollable) */}
                    <div className="max-h-48 overflow-y-auto border border-white/10 rounded-lg p-2 mb-3">
                      <div className="grid grid-cols-10 gap-1">
                        {Array.from({ length: slotInfo?.totalSlots || 75 }, (_, i) => i + 1).map((pos) => {
                          const slotData = allSlots.find(s => s.slot_position === pos);
                          const isSelected = reorgSelectedSlots.has(pos);
                          const isLocked = slotData?.status === 'locked';
                          const isVoting = slotData?.status === 'voting';
                          const isWaiting = slotData?.status === 'waiting_for_clips';

                          // In swap mode, limit to 2 selections
                          const canSelect = reorgMode === 'swap' ? (isSelected || reorgSelectedSlots.size < 2) : true;

                          return (
                            <button
                              key={pos}
                              onClick={() => {
                                if (!canSelect && !isSelected) return;
                                const newSet = new Set(reorgSelectedSlots);
                                if (isSelected) {
                                  newSet.delete(pos);
                                } else {
                                  newSet.add(pos);
                                }
                                setReorgSelectedSlots(newSet);
                                setReorgResult(null);
                              }}
                              disabled={!slotData || isVoting || (!canSelect && !isSelected)}
                              className={`
                                w-7 h-7 rounded text-[10px] font-medium transition-all
                                ${!slotData
                                  ? 'bg-gray-800/30 text-gray-600 cursor-not-allowed'
                                  : isSelected
                                    ? reorgMode === 'delete'
                                      ? 'bg-red-500 text-white ring-2 ring-red-400'
                                      : 'bg-blue-500 text-white ring-2 ring-blue-400'
                                    : isLocked
                                      ? 'bg-green-500/30 text-green-300 hover:bg-green-500/50'
                                      : isVoting
                                        ? 'bg-yellow-500/30 text-yellow-300 cursor-not-allowed'
                                        : isWaiting
                                          ? 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30'
                                          : 'bg-white/10 text-white/40 hover:bg-white/20'
                                }
                                ${(!canSelect && !isSelected) || !slotData ? 'opacity-30 cursor-not-allowed' : ''}
                              `}
                              title={slotData ? `Slot ${pos}: ${slotData.status}${slotData.winner_username ? ` (@${slotData.winner_username})` : ''}` : `Slot ${pos}: does not exist`}
                            >
                              {pos}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Legend */}
                    <div className="flex flex-wrap gap-3 text-[10px] text-white/40 mb-3">
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500/30"></span> Locked</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500/30"></span> Voting</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500/20"></span> Waiting</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-white/10"></span> Upcoming</span>
                      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-800/30 opacity-30"></span> No slot</span>
                    </div>

                    {/* Selected slots summary - Delete mode */}
                    {reorgMode === 'delete' && reorgSelectedSlots.size > 0 && (
                      <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 mb-3">
                        <p className="text-sm text-red-300 mb-1">
                          <strong>{reorgSelectedSlots.size}</strong> slot(s) selected:
                          <span className="ml-2 text-white/70">
                            {Array.from(reorgSelectedSlots).sort((a, b) => a - b).join(', ')}
                          </span>
                        </p>
                        <p className="text-xs text-white/50">
                          Slots after will shift down by {reorgSelectedSlots.size}.
                        </p>
                      </div>
                    )}

                    {/* Selected slots summary - Swap mode */}
                    {reorgMode === 'swap' && reorgSelectedSlots.size > 0 && (
                      <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 mb-3">
                        <p className="text-sm text-blue-300">
                          {reorgSelectedSlots.size === 1
                            ? `Selected slot ${Array.from(reorgSelectedSlots)[0]} — select one more to swap`
                            : `Swap slot ${Array.from(reorgSelectedSlots).sort((a, b) => a - b)[0]} ↔ slot ${Array.from(reorgSelectedSlots).sort((a, b) => a - b)[1]}`
                          }
                        </p>
                      </div>
                    )}

                    {/* Clear selection button */}
                    {reorgSelectedSlots.size > 0 && (
                      <button
                        onClick={() => setReorgSelectedSlots(new Set())}
                        className="text-xs text-white/50 hover:text-white/70 underline"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>

                  {/* Reorganize Result */}
                  {reorgResult && (
                    <div className={`mb-4 p-3 rounded-lg text-sm ${
                      reorgResult.success
                        ? 'bg-green-500/20 border border-green-500/30 text-green-300'
                        : 'bg-red-500/20 border border-red-500/30 text-red-300'
                    }`}>
                      {reorgResult.message}
                    </div>
                  )}
                </>
              )}

              {/* Result Message */}
              <AnimatePresence>
                {freeAssignResult && godModeAction !== 'reorganize' && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`mb-4 p-3 rounded-lg text-sm ${
                      freeAssignResult.success
                        ? 'bg-green-500/20 border border-green-500/30 text-green-300'
                        : 'bg-red-500/20 border border-red-500/30 text-red-300'
                    }`}
                  >
                    {freeAssignResult.message}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={closeFreeAssignModal}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 text-white/70 font-medium hover:bg-white/20 transition-colors"
                >
                  Cancel
                </button>
                {godModeAction === 'assign' ? (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleFreeAssign}
                    disabled={!freeAssignClipId || !freeAssignTargetSlot || freeAssigning || freeAssignResult?.success === true}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 font-bold
                             hover:shadow-lg hover:shadow-purple-500/20 transition-all disabled:opacity-50
                             flex items-center justify-center gap-2"
                  >
                    {freeAssigning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Assigning...
                      </>
                    ) : freeAssignResult?.success ? (
                      <>
                        <Check className="w-4 h-4" />
                        Done!
                      </>
                    ) : (
                      <>
                        <Crosshair className="w-4 h-4" />
                        Assign to Slot
                      </>
                    )}
                  </motion.button>
                ) : godModeAction === 'change_status' ? (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleChangeStatus}
                    disabled={!freeAssignClipId || freeAssigning || freeAssignResult?.success === true}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 font-bold
                             hover:shadow-lg hover:shadow-purple-500/20 transition-all disabled:opacity-50
                             flex items-center justify-center gap-2"
                  >
                    {freeAssigning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Changing...
                      </>
                    ) : freeAssignResult?.success ? (
                      <>
                        <Check className="w-4 h-4" />
                        Done!
                      </>
                    ) : (
                      <>
                        <Crown className="w-4 h-4" />
                        Change Status
                      </>
                    )}
                  </motion.button>
                ) : godModeAction === 'reorganize' ? (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={async () => {
                      if (reorgMode === 'delete') {
                        if (reorgSelectedSlots.size === 0) return;
                        // Fetch preview first
                        setReorgProcessing(true);
                        try {
                          const previewRes = await fetch(`/api/admin/slots/reorganize?action=delete_and_shift&positions=${Array.from(reorgSelectedSlots).join(',')}`);
                          const previewData = await previewRes.json();
                          if (previewData.slotsToDelete) {
                            setReorgPreview({
                              slotsToDelete: previewData.slotsToDelete,
                              clipsToDelete: previewData.clipsToDelete || [],
                              shiftAmount: previewData.shiftAmount,
                            });
                            setReorgShowConfirm(true);
                          }
                        } catch {
                          setReorgResult({ success: false, message: 'Failed to load preview' });
                        }
                        setReorgProcessing(false);
                      } else if (reorgMode === 'swap') {
                        if (reorgSelectedSlots.size !== 2) return;
                        const [slotA, slotB] = Array.from(reorgSelectedSlots).sort((a, b) => a - b);
                        setReorgProcessing(true);
                        setReorgResult(null);
                        try {
                          const response = await fetch('/api/admin/slots/reorganize', {
                            method: 'POST',
                            headers: getHeaders(),
                            body: JSON.stringify({
                              action: 'swap_slots',
                              slot_a_position: slotA,
                              slot_b_position: slotB,
                            }),
                          });
                          const data = await response.json();
                          if (data.success) {
                            setReorgResult({ success: true, message: data.message });
                            setReorgSelectedSlots(new Set());
                            // Refresh slots data and slot info
                            const slotsRes = await fetch('/api/admin/slots?simple=false');
                            const slotsData = await slotsRes.json();
                            if (slotsData.ok && slotsData.slots) {
                              setAllSlots(slotsData.slots.map((s: { slot_position: number; status: string; winner_tournament_clip_id: string | null; winner_details?: { username: string }; clip_count?: number }) => ({
                                slot_position: s.slot_position,
                                status: s.status,
                                winner_tournament_clip_id: s.winner_tournament_clip_id,
                                winner_username: s.winner_details?.username,
                                clip_count: s.clip_count,
                              })));
                            }
                            fetchSlotInfo();
                          } else {
                            setReorgResult({ success: false, message: data.error || 'Failed to swap slots' });
                          }
                        } catch {
                          setReorgResult({ success: false, message: 'Network error' });
                        }
                        setReorgProcessing(false);
                      }
                    }}
                    disabled={
                      (reorgMode === 'delete' && reorgSelectedSlots.size === 0) ||
                      (reorgMode === 'swap' && reorgSelectedSlots.size !== 2) ||
                      reorgProcessing ||
                      reorgResult?.success === true
                    }
                    className={`flex-1 px-4 py-2.5 rounded-xl font-bold transition-all disabled:opacity-50
                             flex items-center justify-center gap-2 ${
                               reorgMode === 'delete'
                                 ? 'bg-gradient-to-r from-red-500 to-orange-500 hover:shadow-lg hover:shadow-red-500/20'
                                 : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:shadow-lg hover:shadow-blue-500/20'
                             }`}
                  >
                    {reorgProcessing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        {reorgMode === 'delete' ? 'Loading preview...' : 'Swapping...'}
                      </>
                    ) : reorgResult?.success ? (
                      <>
                        <Check className="w-4 h-4" />
                        Done!
                      </>
                    ) : reorgMode === 'delete' ? (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Delete & Shift
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Swap Slots
                      </>
                    )}
                  </motion.button>
                ) : (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={handleChangeSlotStatus}
                    disabled={!godModeSlotPosition || freeAssigning || freeAssignResult?.success === true}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 font-bold
                             hover:shadow-lg hover:shadow-purple-500/20 transition-all disabled:opacity-50
                             flex items-center justify-center gap-2"
                  >
                    {freeAssigning ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Changing...
                      </>
                    ) : freeAssignResult?.success ? (
                      <>
                        <Check className="w-4 h-4" />
                        Done!
                      </>
                    ) : (
                      <>
                        <Layers className="w-4 h-4" />
                        Change Slot Status
                      </>
                    )}
                  </motion.button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slot Reorganization Confirmation Modal */}
      <AnimatePresence>
        {reorgShowConfirm && reorgPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm"
            onClick={() => setReorgShowConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 rounded-2xl border border-red-500/30 p-6 max-w-md w-full"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-red-500/20">
                  <AlertCircle className="w-6 h-6 text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Confirm Deletion</h3>
                  <p className="text-sm text-white/60">This action cannot be undone</p>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                {/* Slots to delete */}
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-sm font-medium text-red-300 mb-2">
                    Deleting {reorgPreview.slotsToDelete.length} slot(s):
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {reorgPreview.slotsToDelete.map(slot => (
                      <span key={slot.slot_position} className="px-2 py-1 bg-red-500/20 rounded text-xs text-red-300">
                        #{slot.slot_position} ({slot.status})
                      </span>
                    ))}
                  </div>
                </div>

                {/* Clips to delete */}
                {reorgPreview.clipsToDelete.length > 0 && (
                  <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p className="text-sm font-medium text-white/70 mb-2">
                      {reorgPreview.clipsToDelete.length} clip(s) will be deleted:
                    </p>
                    <div className="max-h-24 overflow-y-auto space-y-1">
                      {reorgPreview.clipsToDelete.map(clip => (
                        <div key={clip.id} className="text-xs text-white/50">
                          Slot {clip.slot_position}: &quot;{clip.title}&quot; by @{clip.username}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Shift info */}
                <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
                  <p className="text-sm text-orange-300">
                    Remaining slots will shift down by {reorgPreview.shiftAmount} position(s).
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setReorgShowConfirm(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 text-white/70 font-medium hover:bg-white/20 transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={async () => {
                    setReorgShowConfirm(false);
                    setReorgProcessing(true);
                    setReorgResult(null);
                    try {
                      const response = await fetch('/api/admin/slots/reorganize', {
                        method: 'POST',
                        headers: getHeaders(),
                        body: JSON.stringify({
                          action: 'delete_and_shift',
                          slot_positions_to_delete: Array.from(reorgSelectedSlots),
                        }),
                      });
                      const data = await response.json();
                      if (data.success) {
                        setReorgResult({ success: true, message: data.message });
                        setReorgSelectedSlots(new Set());
                        setReorgPreview(null);
                        // Refresh slots data and slot info
                        const slotsRes = await fetch('/api/admin/slots?simple=false');
                        const slotsData = await slotsRes.json();
                        if (slotsData.ok && slotsData.slots) {
                          setAllSlots(slotsData.slots.map((s: { slot_position: number; status: string; winner_tournament_clip_id: string | null; winner_details?: { username: string }; clip_count?: number }) => ({
                            slot_position: s.slot_position,
                            status: s.status,
                            winner_tournament_clip_id: s.winner_tournament_clip_id,
                            winner_username: s.winner_details?.username,
                            clip_count: s.clip_count,
                          })));
                        }
                        fetchSlotInfo();
                      } else {
                        setReorgResult({ success: false, message: data.error || 'Failed to reorganize slots' });
                      }
                    } catch {
                      setReorgResult({ success: false, message: 'Network error' });
                    }
                    setReorgProcessing(false);
                  }}
                  disabled={reorgProcessing}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 font-bold hover:bg-red-600 transition-colors
                           flex items-center justify-center gap-2"
                >
                  {reorgProcessing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Delete & Shift
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

                {/* Story Description */}
                <div>
                  <label className="block text-sm font-medium text-white/90 mb-2">
                    Story Description
                  </label>
                  <textarea
                    value={newSeasonDescription}
                    onChange={(e) => setNewSeasonDescription(e.target.value)}
                    maxLength={200}
                    rows={3}
                    className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                             placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors resize-none"
                    placeholder="e.g., In a world where clips battle for glory..."
                  />
                  <p className="text-xs text-white/40 mt-1">Typewriter intro shown on Story page (optional)</p>
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

      {/* Bottom Navigation */}
      <BottomNavigation />

      {/* Spacer for bottom nav */}
      <div className="h-20 md:hidden" />
    </div>
  );
}
