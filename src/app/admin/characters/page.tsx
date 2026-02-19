'use client';

// ============================================================================
// ADMIN — Character Pinning Management
// Pin character references for consistent AI generation via Kling O1
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Crosshair,
  Plus,
  Trash2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Play,
  Pause,
  Check,
  AlertCircle,
} from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useCsrf } from '@/hooks/useCsrf';

// ============================================================================
// TYPES
// ============================================================================

interface PinnedCharacter {
  id: string;
  season_id: string;
  element_index: number;
  label: string | null;
  appearance_description: string | null;
  frontal_image_url: string;
  reference_image_urls: string[];
  source_clip_id: string | null;
  source_frame_timestamp: number | null;
  usage_count: number;
  is_active: boolean;
  created_at: string;
}

interface Season {
  id: string;
  label: string;
  status: string;
}

interface WinnerClip {
  id: string;
  title: string;
  video_url: string;
  last_frame_url: string | null;
  slot_position: number;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function CharacterPinningPage() {
  const { isLoading: authLoading, isAdmin } = useAdminAuth();
  const { getHeaders } = useCsrf();

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [characters, setCharacters] = useState<PinnedCharacter[]>([]);
  const [winnerClips, setWinnerClips] = useState<WinnerClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pin modal state
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinClipId, setPinClipId] = useState<string | null>(null);
  const [pinLabel, setPinLabel] = useState('');
  const [pinAppearanceDesc, setPinAppearanceDesc] = useState('');
  const [pinElementIndex, setPinElementIndex] = useState(1);
  const [pinTimestamp, setPinTimestamp] = useState<number | null>(null);
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Inline edit state for appearance description
  const [editingDescId, setEditingDescId] = useState<string | null>(null);
  const [editingDescValue, setEditingDescValue] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);

  // Suggestion queue state
  const [suggestions, setSuggestions] = useState<Array<{
    id: string;
    status: string;
    image_url: string;
    source_clip_id: string;
    created_at: string;
    character: { id: string; label: string | null; element_index: number; frontal_image_url: string; current_refs: number };
    user: { id: string; username: string | null; avatar_url: string | null };
  }>>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [showRejectInput, setShowRejectInput] = useState<string | null>(null);

  // Angle modal state
  const [showAngleModal, setShowAngleModal] = useState(false);
  const [angleCharId, setAngleCharId] = useState<string | null>(null);
  const [angleClipId, setAngleClipId] = useState<string | null>(null);
  const [angleTimestamp, setAngleTimestamp] = useState<number | null>(null);
  const [addingAngle, setAddingAngle] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  useEffect(() => {
    if (!isAdmin) return;
    fetchSeasons();
  }, [isAdmin]);

  useEffect(() => {
    if (selectedSeason) {
      fetchCharacters(selectedSeason);
      fetchWinnerClips(selectedSeason);
      fetchSuggestions(selectedSeason);
    }
  }, [selectedSeason]);

  async function fetchSeasons() {
    try {
      const res = await fetch('/api/admin/seasons', { headers: await getHeaders() });
      const data = await res.json();
      if (data.seasons) {
        setSeasons(data.seasons);
        // Auto-select active season
        const active = data.seasons.find((s: Season) => s.status === 'active');
        if (active) setSelectedSeason(active.id);
        else if (data.seasons.length > 0) setSelectedSeason(data.seasons[0].id);
      }
    } catch {
      setError('Failed to load seasons');
    } finally {
      setLoading(false);
    }
  }

  async function fetchCharacters(seasonId: string) {
    try {
      const res = await fetch(`/api/admin/pinned-characters?season_id=${seasonId}`, {
        headers: await getHeaders(),
      });
      const data = await res.json();
      if (data.ok) {
        setCharacters(data.characters || []);
      }
    } catch {
      console.error('Failed to fetch pinned characters');
    }
  }

  async function fetchWinnerClips(seasonId: string) {
    try {
      const res = await fetch(`/api/admin/clips?season_id=${seasonId}&status=locked`, {
        headers: await getHeaders(),
      });
      const data = await res.json();
      if (data.clips) {
        setWinnerClips(data.clips.map((c: Record<string, unknown>) => ({
          id: c.id as string,
          title: c.title as string,
          video_url: c.video_url as string,
          last_frame_url: (c.last_frame_url as string | null) || null,
          slot_position: c.slot_position as number,
        })));
      }
    } catch {
      console.error('Failed to fetch winner clips');
    }
  }

  async function fetchSuggestions(seasonId: string) {
    try {
      const res = await fetch(`/api/admin/pinned-characters/suggestions?season_id=${seasonId}&status=pending`, {
        headers: await getHeaders(),
      });
      const data = await res.json();
      if (data.ok) {
        setSuggestions(data.suggestions || []);
      }
    } catch {
      console.error('Failed to fetch suggestions');
    }
  }

  // ============================================================================
  // ACTIONS
  // ============================================================================

  async function handleApproveSuggestion(suggestionId: string) {
    setReviewingId(suggestionId);
    try {
      const res = await fetch('/api/admin/pinned-characters/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getHeaders()) },
        body: JSON.stringify({ suggestion_id: suggestionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to approve');
        return;
      }
      if (selectedSeason) {
        fetchCharacters(selectedSeason);
        fetchSuggestions(selectedSeason);
      }
    } catch {
      alert('Network error');
    } finally {
      setReviewingId(null);
    }
  }

  async function handleRejectSuggestion(suggestionId: string, notes?: string) {
    setReviewingId(suggestionId);
    try {
      const res = await fetch('/api/admin/pinned-characters/suggestions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(await getHeaders()) },
        body: JSON.stringify({ suggestion_id: suggestionId, admin_notes: notes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to reject');
        return;
      }
      setShowRejectInput(null);
      setRejectNotes('');
      if (selectedSeason) fetchSuggestions(selectedSeason);
    } catch {
      alert('Network error');
    } finally {
      setReviewingId(null);
    }
  }

  async function handlePin() {
    if (!pinClipId || !selectedSeason) return;
    setPinning(true);
    setPinError(null);

    try {
      const res = await fetch('/api/admin/pinned-characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getHeaders()) },
        body: JSON.stringify({
          season_id: selectedSeason,
          source_clip_id: pinClipId,
          frame_timestamp: pinTimestamp,
          label: pinLabel || undefined,
          appearance_description: pinAppearanceDesc || undefined,
          element_index: pinElementIndex,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setPinError(data.error || 'Failed to pin character');
        return;
      }

      setShowPinModal(false);
      setPinClipId(null);
      setPinLabel('');
      setPinAppearanceDesc('');
      setPinTimestamp(null);
      fetchCharacters(selectedSeason);
    } catch {
      setPinError('Network error');
    } finally {
      setPinning(false);
    }
  }

  async function handleDelete(charId: string) {
    if (!confirm('Unpin this character? Existing generations are not affected.')) return;

    try {
      const res = await fetch(`/api/admin/pinned-characters?id=${charId}`, {
        method: 'DELETE',
        headers: await getHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to delete character');
        return;
      }
      if (selectedSeason) fetchCharacters(selectedSeason);
    } catch {
      alert('Failed to delete');
    }
  }

  async function handleAddAngle() {
    if (!angleCharId || !angleClipId) return;
    setAddingAngle(true);

    try {
      const res = await fetch(`/api/admin/pinned-characters/${angleCharId}/angles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getHeaders()) },
        body: JSON.stringify({
          source_clip_id: angleClipId,
          frame_timestamp: angleTimestamp,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to add angle');
        return;
      }

      setShowAngleModal(false);
      setAngleCharId(null);
      setAngleClipId(null);
      setAngleTimestamp(null);
      if (selectedSeason) fetchCharacters(selectedSeason);
    } catch {
      alert('Network error');
    } finally {
      setAddingAngle(false);
    }
  }

  async function handleSaveDescription(charId: string, description: string) {
    setSavingDesc(true);
    try {
      const res = await fetch('/api/admin/pinned-characters', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getHeaders()) },
        body: JSON.stringify({ id: charId, appearance_description: description }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to update description');
        return;
      }
      setEditingDescId(null);
      setEditingDescValue('');
      if (selectedSeason) fetchCharacters(selectedSeason);
    } catch {
      alert('Network error');
    } finally {
      setSavingDesc(false);
    }
  }

  // ============================================================================
  // COMPUTED
  // ============================================================================

  const usedIndices = new Set(characters.map(c => c.element_index));
  const availableIndices = [1, 2, 3, 4].filter(i => !usedIndices.has(i));

  // ============================================================================
  // RENDER
  // ============================================================================

  if (authLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/60">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="p-2 -ml-2 hover:bg-white/10 rounded-lg transition">
              <ArrowLeft className="w-5 h-5 text-white/60" />
            </Link>
            <div className="flex items-center gap-2">
              <Crosshair className="w-5 h-5 text-yellow-500" />
              <h1 className="text-xl font-bold">Character Pinning</h1>
            </div>
          </div>

          {/* Season selector */}
          <div className="mt-3">
            <select
              value={selectedSeason || ''}
              onChange={(e) => setSelectedSeason(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white"
            >
              {seasons.map(s => (
                <option key={s.id} value={s.id} className="bg-gray-900">
                  {s.label} ({s.status})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-red-400">{error}</div>
        ) : (
          <>
            {/* Pinned Characters */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  Pinned Characters ({characters.length}/4)
                </h2>
                {availableIndices.length > 0 && (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      setPinClipId(null);
                      setPinLabel('');
                      setPinAppearanceDesc('');
                      setPinTimestamp(null);
                      setPinError(null);
                      setPinElementIndex(availableIndices[0]);
                      setShowPinModal(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-lg font-medium hover:bg-yellow-500/30 transition"
                    type="button"
                  >
                    <Plus className="w-4 h-4" />
                    Pin Character
                  </motion.button>
                )}
              </div>

              {characters.length === 0 ? (
                <div className="text-center py-8 bg-white/5 rounded-xl border border-white/10">
                  <Crosshair className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-white/40">No characters pinned for this season</p>
                  <p className="text-white/30 text-sm mt-1">Pin characters from winning clips to enable consistent AI generation</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {characters.map(char => (
                    <div key={char.id} className="bg-white/5 border border-white/10 rounded-xl p-4">
                      <div className="flex items-start gap-4">
                        {/* Frontal image */}
                        <div className="relative w-24 h-24 rounded-lg overflow-hidden flex-shrink-0 border border-yellow-500/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={char.frontal_image_url}
                            alt={char.label || `Element ${char.element_index}`}
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[10px] font-bold text-yellow-400">
                            @Element{char.element_index}
                          </div>
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-white">
                              {char.label || `Element ${char.element_index}`}
                            </h3>
                            {char.is_active ? (
                              <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Active</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded">Inactive</span>
                            )}
                          </div>
                          <p className="text-xs text-white/40">
                            {char.reference_image_urls?.length || 0} reference angles |
                            Used {char.usage_count} times
                          </p>

                          {/* Appearance description */}
                          {editingDescId === char.id ? (
                            <div className="mt-2 space-y-1">
                              <textarea
                                value={editingDescValue}
                                onChange={(e) => setEditingDescValue(e.target.value)}
                                placeholder="e.g., tall alien with blue skin and glowing green eyes"
                                className="w-full bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-xs text-white"
                                rows={2}
                                maxLength={500}
                              />
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleSaveDescription(char.id, editingDescValue)}
                                  disabled={savingDesc}
                                  className="px-2 py-1 text-[10px] bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition disabled:opacity-50"
                                  type="button"
                                >
                                  {savingDesc ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={() => { setEditingDescId(null); setEditingDescValue(''); }}
                                  className="px-2 py-1 text-[10px] bg-white/10 rounded hover:bg-white/20 transition"
                                  type="button"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-1 flex items-start gap-1">
                              {char.appearance_description ? (
                                <p className="text-xs text-white/50 italic">{char.appearance_description}</p>
                              ) : (
                                <p className="text-xs text-white/30">No appearance description</p>
                              )}
                              <button
                                onClick={() => {
                                  setEditingDescId(char.id);
                                  setEditingDescValue(char.appearance_description || '');
                                }}
                                className="text-[10px] text-yellow-400/60 hover:text-yellow-400 ml-1 flex-shrink-0"
                                type="button"
                              >
                                Edit
                              </button>
                            </div>
                          )}

                          {/* Reference angle thumbnails */}
                          {char.reference_image_urls?.length > 0 && (
                            <div className="flex gap-2 mt-2">
                              {char.reference_image_urls.map((url, i) => (
                                <div key={i} className="w-12 h-12 rounded-lg overflow-hidden border border-white/20">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={url} alt={`Angle ${i + 1}`} className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 flex-shrink-0">
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => {
                              setAngleCharId(char.id);
                              setShowAngleModal(true);
                            }}
                            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition"
                            title="Add reference angle"
                            type="button"
                          >
                            <ImageIcon className="w-4 h-4" />
                          </motion.button>
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => handleDelete(char.id)}
                            className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition"
                            title="Delete pin"
                            type="button"
                          >
                            <Trash2 className="w-4 h-4" />
                          </motion.button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Suggested References (moderation queue) */}
            {suggestions.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    Suggested References
                    <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded-full text-xs">
                      {suggestions.length} pending
                    </span>
                  </h2>
                </div>

                <div className="grid gap-3">
                  {suggestions.map(s => (
                    <div key={s.id} className="bg-white/5 border border-purple-500/20 rounded-xl p-4">
                      <div className="flex items-start gap-4">
                        {/* Suggested image */}
                        <div className="w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 border border-purple-500/30">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.image_url} alt="Suggested angle" className="w-full h-full object-cover" />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium">
                              For: {s.character.label || `Element ${s.character.element_index}`}
                            </span>
                            <span className="text-xs text-white/40">
                              ({s.character.current_refs}/6 refs)
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-white/50">
                            {s.user.avatar_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={s.user.avatar_url} alt="" className="w-4 h-4 rounded-full" />
                            )}
                            <span>{s.user.username || 'Unknown user'}</span>
                            <span className="text-white/30">·</span>
                            <span>{new Date(s.created_at).toLocaleDateString()}</span>
                          </div>

                          {/* Character frontal for comparison */}
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-[10px] text-white/30">Current frontal:</span>
                            <div className="w-8 h-8 rounded overflow-hidden border border-yellow-500/20">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={s.character.frontal_image_url} alt="" className="w-full h-full object-cover" />
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleApproveSuggestion(s.id)}
                            disabled={reviewingId === s.id || s.character.current_refs >= 6}
                            className="px-3 py-1.5 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30 transition disabled:opacity-50 flex items-center gap-1"
                            type="button"
                          >
                            {reviewingId === s.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                            Approve
                          </button>
                          {showRejectInput === s.id ? (
                            <div className="space-y-1">
                              <input
                                value={rejectNotes}
                                onChange={(e) => setRejectNotes(e.target.value)}
                                placeholder="Reason (optional)"
                                className="w-full bg-white/10 border border-white/20 rounded px-2 py-1 text-xs"
                              />
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleRejectSuggestion(s.id, rejectNotes)}
                                  disabled={reviewingId === s.id}
                                  className="flex-1 px-2 py-1 text-[10px] bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition disabled:opacity-50"
                                  type="button"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => { setShowRejectInput(null); setRejectNotes(''); }}
                                  className="px-2 py-1 text-[10px] bg-white/10 rounded hover:bg-white/20 transition"
                                  type="button"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setShowRejectInput(s.id)}
                              disabled={reviewingId === s.id}
                              className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition disabled:opacity-50 flex items-center gap-1"
                              type="button"
                            >
                              <Trash2 className="w-3 h-3" />
                              Reject
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Winner Clips (source material) */}
            <section>
              <h2 className="text-lg font-semibold mb-4">
                Winner Clips ({winnerClips.length})
              </h2>
              <p className="text-white/40 text-sm mb-4">
                Select a winning clip to pin a character from it.
              </p>

              {winnerClips.length === 0 ? (
                <p className="text-white/30 text-center py-8">No locked clips for this season</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {winnerClips.map(clip => (
                    <div key={clip.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        {clip.last_frame_url && (
                          <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={clip.last_frame_url} alt="" className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{clip.title || 'Untitled'}</p>
                          <p className="text-xs text-white/40">Slot {clip.slot_position}</p>
                        </div>
                        {availableIndices.length > 0 && (
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={() => {
                              setPinClipId(clip.id);
                              setPinElementIndex(availableIndices[0]);
                              setPinLabel('');
                              setPinAppearanceDesc('');
                              setPinTimestamp(null);
                              setPinError(null);
                              setShowPinModal(true);
                            }}
                            className="px-3 py-1.5 text-xs bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 transition"
                            type="button"
                          >
                            Pin
                          </motion.button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Pin Character Modal */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/20 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold">Pin Character</h3>

            {/* Video preview with frame scrubber */}
            {pinClipId && (() => {
              const clip = winnerClips.find(c => c.id === pinClipId);
              if (!clip) return null;
              return (
                <div className="space-y-3">
                  <video
                    ref={videoRef}
                    src={clip.video_url}
                    className="w-full max-h-[40vh] object-contain rounded-lg bg-black"
                    muted
                    playsInline
                    onTimeUpdate={() => {
                      if (videoRef.current) {
                        setPinTimestamp(videoRef.current.currentTime);
                      }
                    }}
                    onLoadedMetadata={() => {
                      if (videoRef.current) {
                        setVideoDuration(videoRef.current.duration);
                      }
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                  {/* Custom video controls */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (videoRef.current) {
                          if (isPlaying) {
                            videoRef.current.pause();
                          } else {
                            videoRef.current.play();
                          }
                        }
                      }}
                      className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition"
                    >
                      {isPlaying ? (
                        <Pause className="w-5 h-5" />
                      ) : (
                        <Play className="w-5 h-5" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={videoDuration || 1}
                      step={0.01}
                      value={pinTimestamp || 0}
                      onChange={(e) => {
                        const time = parseFloat(e.target.value);
                        setPinTimestamp(time);
                        if (videoRef.current) {
                          videoRef.current.currentTime = time;
                        }
                      }}
                      className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-yellow-400"
                    />
                    <span className="text-xs text-white/60 min-w-[50px] text-right">
                      {(pinTimestamp || 0).toFixed(2)}s
                    </span>
                  </div>
                  <p className="text-xs text-white/40">
                    Scrub to find the best character frame, then click Pin.
                  </p>
                  <button
                    onClick={() => setPinTimestamp(null)}
                    className="text-xs text-white/40 hover:text-white/60"
                    type="button"
                  >
                    Or use last frame (no timestamp)
                  </button>
                </div>
              );
            })()}

            <div>
              <label className="text-sm text-white/60 block mb-1">Character Label</label>
              <input
                value={pinLabel}
                onChange={(e) => setPinLabel(e.target.value)}
                placeholder="e.g., Main Robot, Companion Cat"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-sm text-white/60 block mb-1">Appearance Description (optional)</label>
              <textarea
                value={pinAppearanceDesc}
                onChange={(e) => setPinAppearanceDesc(e.target.value)}
                placeholder="e.g., tall alien with blue skin and glowing green eyes"
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm"
                rows={2}
                maxLength={500}
              />
              <p className="text-[10px] text-white/30 mt-0.5">Used in AI prompt when generating videos with this character</p>
            </div>

            <div>
              <label className="text-sm text-white/60 block mb-1">Element Index</label>
              <select
                value={pinElementIndex}
                onChange={(e) => setPinElementIndex(Number(e.target.value))}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white"
              >
                {availableIndices.map(i => (
                  <option key={i} value={i} className="bg-gray-900">
                    @Element{i}
                  </option>
                ))}
              </select>
            </div>

            {pinError && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {pinError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowPinModal(false)}
                className="flex-1 py-2 bg-white/10 rounded-lg font-medium hover:bg-white/20 transition"
                type="button"
              >
                Cancel
              </button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handlePin}
                disabled={pinning || !pinClipId}
                className="flex-1 py-2 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-lg font-medium hover:bg-yellow-500/30 transition disabled:opacity-50 flex items-center justify-center gap-2"
                type="button"
              >
                {pinning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Pin
              </motion.button>
            </div>
          </div>
        </div>
      )}

      {/* Add Angle Modal */}
      {showAngleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/20 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold">Add Reference Angle</h3>
            <p className="text-sm text-white/40">Select a clip to extract an additional angle from.</p>

            <div className="max-h-48 overflow-y-auto space-y-2">
              {winnerClips.map(clip => (
                <button
                  key={clip.id}
                  onClick={() => setAngleClipId(clip.id)}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg transition text-left ${
                    angleClipId === clip.id ? 'bg-yellow-500/20 border border-yellow-500/30' : 'bg-white/5 hover:bg-white/10 border border-transparent'
                  }`}
                  type="button"
                >
                  {clip.last_frame_url && (
                    <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={clip.last_frame_url} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <span className="text-sm truncate">{clip.title || `Slot ${clip.slot_position}`}</span>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowAngleModal(false); setAngleCharId(null); setAngleClipId(null); }}
                className="flex-1 py-2 bg-white/10 rounded-lg font-medium hover:bg-white/20 transition"
                type="button"
              >
                Cancel
              </button>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleAddAngle}
                disabled={addingAngle || !angleClipId}
                className="flex-1 py-2 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 rounded-lg font-medium hover:bg-yellow-500/30 transition disabled:opacity-50 flex items-center justify-center gap-2"
                type="button"
              >
                {addingAngle ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                Add Angle
              </motion.button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
