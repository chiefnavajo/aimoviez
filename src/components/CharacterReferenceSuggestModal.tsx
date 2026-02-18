'use client';

// ============================================================================
// CHARACTER REFERENCE SUGGEST MODAL
// Users can suggest reference angles for pinned characters by picking frames
// from winner clips. Suggestions go through admin moderation.
// ============================================================================

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Play,
  Pause,
  Loader2,
  Check,
  AlertCircle,
  Image as ImageIcon,
} from 'lucide-react';
import { useCsrf } from '@/hooks/useCsrf';

// ============================================================================
// TYPES
// ============================================================================

interface SuggestModalProps {
  character: {
    id: string;
    label: string | null;
    element_index: number;
    frontal_image_url: string;
    reference_count: number;
  };
  seasonId: string;
  onClose: () => void;
  onSubmitted: () => void;
}

interface WinnerClip {
  id: string;
  title: string;
  video_url: string;
  last_frame_url: string | null;
  slot_position: number;
}

interface ExistingSuggestion {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  image_url: string;
  created_at: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function CharacterReferenceSuggestModal({
  character,
  seasonId,
  onClose,
  onSubmitted,
}: SuggestModalProps) {
  const { getHeaders } = useCsrf();

  // Clip list state
  const [clips, setClips] = useState<WinnerClip[]>([]);
  const [loadingClips, setLoadingClips] = useState(true);

  // Selection state
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [timestamp, setTimestamp] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);

  // Suggestion state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  // Existing suggestions
  const [existingSuggestions, setExistingSuggestions] = useState<ExistingSuggestion[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  useEffect(() => {
    fetchClips();
    fetchExistingSuggestions();
  }, []);

  async function fetchClips() {
    try {
      // Fetch story data and extract locked clips for the season
      const res = await fetch('/api/story');
      const data = await res.json();
      if (data.seasons) {
        const season = data.seasons.find((s: Record<string, unknown>) => s.id === seasonId);
        if (season?.slots) {
          const lockedClips = (season.slots as Array<Record<string, unknown>>)
            .filter((slot) => slot.status === 'locked' && slot.winning_clip)
            .map((slot) => {
              const clip = slot.winning_clip as Record<string, unknown>;
              return {
                id: clip.id as string,
                title: (clip.username as string) || `Slot ${slot.slot_position}`,
                video_url: clip.video_url as string,
                last_frame_url: (clip.thumbnail_url as string | null) || null,
                slot_position: slot.slot_position as number,
              };
            });
          setClips(lockedClips);
        }
      }
    } catch {
      // Non-critical, clips list may be empty
    } finally {
      setLoadingClips(false);
    }
  }

  async function fetchExistingSuggestions() {
    try {
      const res = await fetch(`/api/story/pinned-characters/${character.id}/suggest`);
      const data = await res.json();
      if (data.ok) {
        setExistingSuggestions(data.suggestions || []);
        setRemaining(data.remaining ?? null);
      }
    } catch {
      // Non-critical
    }
  }

  // ============================================================================
  // ACTIONS
  // ============================================================================

  async function handleSubmit() {
    if (!selectedClipId) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/story/pinned-characters/${character.id}/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getHeaders()),
        },
        body: JSON.stringify({
          source_clip_id: selectedClipId,
          frame_timestamp: timestamp,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to submit suggestion');
        return;
      }

      setSuccess(true);
      setRemaining(data.remaining ?? null);
      onSubmitted();

      // Auto-close after 2 seconds
      setTimeout(() => onClose(), 2000);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  const selectedClip = clips.find(c => c.id === selectedClipId);

  const statusColors = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    approved: 'bg-green-500/20 text-green-400',
    rejected: 'bg-red-500/20 text-red-400',
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 rounded-2xl max-w-md w-full border border-purple-500/30 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={character.frontal_image_url}
              alt={character.label || `Element ${character.element_index}`}
              className="w-10 h-10 rounded-lg object-cover border border-yellow-500/30"
            />
            <div>
              <h3 className="font-bold text-white">Suggest Reference</h3>
              <p className="text-xs text-white/50">
                {character.label || `Element ${character.element_index}`}
                {' · '}{character.reference_count}/6 angles
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-lg transition"
          >
            <X className="w-5 h-5 text-white/60" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Success State */}
          {success ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                <Check className="w-6 h-6 text-green-400" />
              </div>
              <p className="font-medium text-green-400">Suggestion Submitted!</p>
              <p className="text-sm text-white/50 mt-1">
                An admin will review your suggestion.
              </p>
            </div>
          ) : (
            <>
              {/* Daily limit indicator */}
              {remaining !== null && (
                <div className={`text-xs px-3 py-1.5 rounded-lg ${
                  remaining > 0
                    ? 'bg-purple-500/10 text-purple-300'
                    : 'bg-red-500/10 text-red-400'
                }`}>
                  {remaining > 0
                    ? `${remaining} suggestion${remaining !== 1 ? 's' : ''} remaining today`
                    : 'Daily suggestion limit reached'}
                </div>
              )}

              {/* Clip Selection */}
              <div>
                <label className="text-sm text-white/60 block mb-2">Select a winner clip</label>
                {loadingClips ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                  </div>
                ) : clips.length === 0 ? (
                  <p className="text-sm text-white/40 text-center py-4">
                    No winner clips available for this season
                  </p>
                ) : (
                  <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {clips.map(clip => (
                      <button
                        key={clip.id}
                        onClick={() => {
                          setSelectedClipId(clip.id);
                          setTimestamp(0);
                          setIsPlaying(false);
                        }}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg transition text-left ${
                          selectedClipId === clip.id
                            ? 'bg-purple-500/20 border border-purple-500/30'
                            : 'bg-white/5 hover:bg-white/10 border border-transparent'
                        }`}
                        type="button"
                      >
                        {clip.last_frame_url && (
                          <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={clip.last_frame_url} alt="" className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm truncate block">{clip.title}</span>
                          <span className="text-xs text-white/40">Slot {clip.slot_position}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Video Scrubber */}
              {selectedClip && selectedClip.video_url && (
                <div className="space-y-3">
                  <label className="text-sm text-white/60 block">Pick the best frame</label>
                  <video
                    ref={videoRef}
                    src={selectedClip.video_url}
                    className="w-full max-h-[35vh] object-contain rounded-lg bg-black"
                    muted
                    playsInline
                    onTimeUpdate={() => {
                      if (videoRef.current) {
                        setTimestamp(videoRef.current.currentTime);
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
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={videoDuration || 1}
                      step={0.01}
                      value={timestamp}
                      onChange={(e) => {
                        const time = parseFloat(e.target.value);
                        setTimestamp(time);
                        if (videoRef.current) {
                          videoRef.current.currentTime = time;
                        }
                      }}
                      className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
                    />
                    <span className="text-xs text-white/60 min-w-[50px] text-right">
                      {timestamp.toFixed(2)}s
                    </span>
                  </div>
                  <p className="text-xs text-white/40">
                    Scrub to find a clear shot of the character, then submit.
                  </p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 bg-white/10 rounded-xl font-medium hover:bg-white/20 transition text-sm"
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !selectedClipId || remaining === 0}
                  className="flex-1 py-2.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-xl font-medium hover:bg-purple-500/30 transition disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  type="button"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ImageIcon className="w-4 h-4" />
                  )}
                  Submit Suggestion
                </button>
              </div>

              {/* Existing Suggestions */}
              {existingSuggestions.length > 0 && (
                <div>
                  <label className="text-xs text-white/40 block mb-2">Your suggestions</label>
                  <div className="flex gap-2 flex-wrap">
                    {existingSuggestions.map(s => (
                      <div key={s.id} className="relative">
                        <div className="w-12 h-12 rounded-lg overflow-hidden border border-white/20">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.image_url} alt="" className="w-full h-full object-cover" />
                        </div>
                        <span className={`absolute -top-1 -right-1 text-[8px] px-1 py-0.5 rounded-full ${statusColors[s.status]}`}>
                          {s.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
