'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Plus, Trash2, X, Upload, Camera, Loader2, AlertCircle } from 'lucide-react';
import { useCsrf } from '@/hooks/useCsrf';

export interface UserCharacter {
  id: string;
  label: string;
  frontal_image_url: string;
  reference_count: number;
  appearance_description: string | null;
  usage_count: number;
}

interface UserCharacterManagerProps {
  characters: UserCharacter[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUploadClick: () => void;
  onAngleAdded: (characterId: string, newCount: number) => void;
  maxSelectable: number;
}

export default function UserCharacterManager({
  characters,
  selectedIds,
  onToggle,
  onDelete,
  onUploadClick,
  onAngleAdded,
  maxSelectable,
}: UserCharacterManagerProps) {
  const { ensureToken } = useCsrf();
  const [previewChar, setPreviewChar] = useState<UserCharacter | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [angleUploading, setAngleUploading] = useState(false);
  const [angleError, setAngleError] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setIsDeleting(id);
    try {
      await ensureToken();
      const csrfToken = document.cookie.split(';').find(c => c.trim().startsWith('csrf-token='))?.split('=')[1] || '';
      const res = await fetch(`/api/ai/characters?id=${id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
        credentials: 'include',
      });
      if (res.ok) {
        onDelete(id);
        setPreviewChar(null);
      }
    } catch {
      // Non-critical
    } finally {
      setIsDeleting(null);
      setConfirmDelete(null);
    }
  };

  const handleAngleUpload = async (characterId: string, file: File) => {
    setAngleError(null);
    setAngleUploading(true);
    try {
      await ensureToken();
      const csrfToken = document.cookie.split(';').find(c => c.trim().startsWith('csrf-token='))?.split('=')[1] || '';

      // Get signed URL
      const urlRes = await fetch('/api/ai/characters/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.success) throw new Error(urlData.error || 'Failed to get upload URL');

      // Upload
      const uploadRes = await fetch(urlData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('Upload failed');

      // Register angle
      const angleRes = await fetch(`/api/ai/characters/${characterId}/angles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({ image_url: urlData.publicUrl }),
      });
      const angleData = await angleRes.json();
      if (!angleRes.ok || !angleData.ok) throw new Error(angleData.error || 'Failed to add angle');

      onAngleAdded(characterId, angleData.reference_count);
    } catch (err) {
      setAngleError(err instanceof Error ? err.message : 'Failed to add angle');
    } finally {
      setAngleUploading(false);
    }
  };

  if (characters.length === 0) {
    return (
      <div className="border border-purple-500/20 rounded-xl bg-purple-500/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-purple-300">My Characters</span>
        </div>
        <button
          onClick={onUploadClick}
          className="w-full py-4 border-2 border-dashed border-purple-500/30 rounded-xl flex flex-col items-center gap-2 text-purple-300/70 hover:border-purple-500/50 hover:text-purple-300 transition"
        >
          <Plus className="w-6 h-6" />
          <span className="text-sm">Upload your character</span>
          <span className="text-xs text-white/40">Put your face in AI videos</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border border-purple-500/20 rounded-xl overflow-hidden bg-purple-500/5">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-purple-500/10">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-purple-300">My Characters</span>
          <span className="text-xs text-white/50">({selectedIds.size} selected)</span>
        </div>
        <button
          onClick={onUploadClick}
          className="flex items-center gap-1 px-2.5 py-1 bg-purple-500/20 border border-purple-500/40 rounded-lg text-xs text-purple-300 hover:bg-purple-500/30 transition"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {/* Character grid */}
      <div className="p-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {characters.map((char) => {
            const isSelected = selectedIds.has(char.id);
            const canSelect = isSelected || selectedIds.size < maxSelectable;
            return (
              <button
                key={char.id}
                onClick={() => setPreviewChar(char)}
                className={`flex flex-col items-center p-2 sm:p-3 rounded-lg transition-all ${
                  isSelected
                    ? 'bg-purple-500/20 border-2 border-purple-500'
                    : 'bg-white/5 border-2 border-transparent opacity-60 hover:opacity-80'
                }`}
              >
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={char.frontal_image_url}
                    alt={char.label}
                    className={`w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover ${
                      isSelected ? 'ring-2 ring-purple-500' : 'grayscale'
                    }`}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canSelect) onToggle(char.id);
                    }}
                    className={`absolute -top-1 -right-1 w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-purple-500 text-white hover:bg-purple-400'
                        : canSelect
                        ? 'bg-white/30 text-white/60 hover:bg-white/50'
                        : 'bg-white/10 text-white/20 cursor-not-allowed'
                    }`}
                    aria-label={isSelected ? `Deselect ${char.label}` : `Select ${char.label}`}
                  >
                    {isSelected ? <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <span className="text-sm font-bold">+</span>}
                  </button>
                </div>
                <p className={`text-xs sm:text-sm mt-1.5 font-medium truncate w-full text-center ${
                  isSelected ? 'text-purple-300' : 'text-white/40'
                }`}>
                  {char.label}
                </p>
                {char.reference_count > 0 && (
                  <p className="text-[10px] text-white/30">
                    {char.reference_count} angle{char.reference_count !== 1 ? 's' : ''}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-white/40 mt-3">
          Tap to preview · Select characters to include in your video
        </p>
      </div>

      {/* Preview Modal */}
      <AnimatePresence>
        {previewChar && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            onClick={() => { setPreviewChar(null); setAngleError(null); }}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 rounded-2xl p-4 max-w-sm w-full border border-purple-500/30 shadow-2xl space-y-4"
            >
              {/* Large image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewChar.frontal_image_url}
                alt={previewChar.label}
                className="w-full aspect-square object-cover rounded-xl"
              />

              {/* Info */}
              <div className="text-center">
                <h3 className="text-lg font-bold text-purple-300">{previewChar.label}</h3>
                {previewChar.reference_count > 0 && (
                  <p className="text-xs text-white/40 mt-1">
                    {previewChar.reference_count} reference angle{previewChar.reference_count !== 1 ? 's' : ''}
                  </p>
                )}
                {previewChar.appearance_description && (
                  <p className="text-sm text-white/50 italic mt-2">{previewChar.appearance_description}</p>
                )}
                <p className="text-xs text-white/30 mt-1">Used {previewChar.usage_count} time{previewChar.usage_count !== 1 ? 's' : ''}</p>
              </div>

              {/* Angle upload */}
              {previewChar.reference_count < 6 && (
                <div>
                  <label className="flex items-center justify-center gap-2 py-2.5 border border-purple-500/30 rounded-xl text-purple-300 text-sm cursor-pointer hover:bg-purple-500/10 transition">
                    {angleUploading ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Adding angle...</>
                    ) : (
                      <><Camera className="w-4 h-4" /> Add Reference Angle ({previewChar.reference_count}/6)</>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={angleUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleAngleUpload(previewChar.id, f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {angleError && (
                    <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {angleError}
                    </p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const canSelect = selectedIds.has(previewChar.id) || selectedIds.size < maxSelectable;
                    if (canSelect) {
                      onToggle(previewChar.id);
                      setPreviewChar(null);
                    }
                  }}
                  className={`flex-1 py-3 rounded-xl font-medium transition-colors text-sm ${
                    selectedIds.has(previewChar.id)
                      ? 'bg-white/10 text-white/70 hover:bg-white/20'
                      : 'bg-purple-500 text-white hover:bg-purple-400'
                  }`}
                >
                  {selectedIds.has(previewChar.id) ? 'Deselect' : 'Select'}
                </button>

                {/* Delete */}
                {confirmDelete === previewChar.id ? (
                  <button
                    onClick={() => handleDelete(previewChar.id)}
                    disabled={isDeleting === previewChar.id}
                    className="flex-1 py-3 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors text-sm flex items-center justify-center gap-1"
                  >
                    {isDeleting === previewChar.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <><Trash2 className="w-4 h-4" /> Confirm</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(previewChar.id)}
                    className="px-4 py-3 rounded-xl bg-white/5 text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}

                <button
                  onClick={() => { setPreviewChar(null); setAngleError(null); setConfirmDelete(null); }}
                  className="px-4 py-3 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 transition-colors text-sm"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
