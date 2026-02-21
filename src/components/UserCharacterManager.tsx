'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Plus, Trash2, X, Upload, Loader2, AlertCircle, Eye, Camera } from 'lucide-react';
import { useCsrf } from '@/hooks/useCsrf';

export interface UserCharacter {
  id: string;
  label: string;
  frontal_image_url: string;
  reference_image_urls: string[];
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
  onAngleAdded: (characterId: string, newCount: number, referenceImageUrls: string[]) => void;
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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [isDeletingAngle, setIsDeletingAngle] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setIsDeleting(id);
    setDeleteError(null);
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
      } else {
        setDeleteError('Failed to delete. Please try again.');
      }
    } catch {
      setDeleteError('Network error. Please try again.');
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

      const urls = angleData.reference_image_urls || [];
      onAngleAdded(characterId, angleData.reference_count, urls);
      if (previewChar?.id === characterId) {
        setPreviewChar(prev => prev ? { ...prev, reference_count: angleData.reference_count, reference_image_urls: urls } : null);
      }
    } catch (err) {
      setAngleError(err instanceof Error ? err.message : 'Failed to add angle');
    } finally {
      setAngleUploading(false);
    }
  };

  const handleDeleteAngle = async (characterId: string, imageUrl: string) => {
    setAngleError(null);
    setIsDeletingAngle(imageUrl);
    try {
      await ensureToken();
      const csrfToken = document.cookie.split(';').find(c => c.trim().startsWith('csrf-token='))?.split('=')[1] || '';
      const res = await fetch(`/api/ai/characters/${characterId}/angles`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({ image_url: imageUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to remove angle');
      }
      const urls = data.reference_image_urls || [];
      onAngleAdded(characterId, data.reference_count, urls);
      if (previewChar?.id === characterId) {
        setPreviewChar(prev => prev ? { ...prev, reference_count: data.reference_count, reference_image_urls: urls } : null);
      }
    } catch (err) {
      setAngleError(err instanceof Error ? err.message : 'Failed to remove angle');
    } finally {
      setIsDeletingAngle(null);
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
                onClick={() => { if (canSelect) onToggle(char.id); }}
                className={`flex flex-col items-center p-2 sm:p-3 rounded-lg transition-all touch-manipulation ${
                  isSelected
                    ? 'bg-purple-500/20 border-2 border-purple-500'
                    : canSelect
                    ? 'bg-white/5 border-2 border-transparent opacity-60 hover:opacity-80 active:opacity-100'
                    : 'bg-white/5 border-2 border-transparent opacity-40'
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
                  {isSelected && (
                    <div className="absolute -top-1 -right-1 w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center bg-purple-500 text-white">
                      <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                  )}
                  {/* Preview button — larger circle on mobile, hidden on desktop */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewChar(char);
                    }}
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex sm:hidden items-center justify-center bg-white/20 text-white/70 hover:bg-white/40 active:bg-white/50 transition-colors touch-manipulation"
                    aria-label={`Preview ${char.label}`}
                  >
                    <Eye className="w-4 h-4" />
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
                {/* Desktop-only details button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewChar(char);
                  }}
                  className="hidden sm:flex items-center gap-1 mt-1 text-[11px] text-white/40 hover:text-purple-300 transition-colors"
                >
                  <Eye className="w-3 h-3" /> Details
                </button>
              </button>
            );
          })}
        </div>

        <p className="text-xs text-white/40 mt-3">
          <span className="sm:hidden">Tap to select · <Eye className="w-3 h-3 inline" /> for details</span>
          <span className="hidden sm:inline">Click to select · &quot;Details&quot; for preview &amp; angles</span>
        </p>
      </div>

      {/* Preview Modal — backdrop and content are siblings to avoid mobile touch issues */}
      <AnimatePresence>
        {previewChar && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/80"
              onClick={() => { setPreviewChar(null); setAngleError(null); setDeleteError(null); setConfirmDelete(null); }}
              aria-hidden="true"
            />
            {/* Modal content */}
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="fixed inset-0 z-[51] flex items-center justify-center p-4 pointer-events-none"
              role="dialog"
              aria-modal="true"
            >
              <div className="pointer-events-auto bg-gray-900 rounded-2xl p-4 max-w-sm w-full border border-purple-500/30 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto touch-manipulation">
              {/* Large image — tap for fullscreen */}
              <button onClick={() => setFullscreenImage(previewChar.frontal_image_url)} className="w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewChar.frontal_image_url}
                  alt={previewChar.label}
                  className="w-full aspect-square object-cover rounded-xl hover:opacity-90 transition"
                />
              </button>

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

              {/* Reference angle thumbnails — grid with tap-to-fullscreen + delete */}
              {previewChar.reference_image_urls.length > 0 && (
                <div>
                  <p className="text-xs text-white/40 mb-2">Reference Angles <span className="text-white/25">· tap to enlarge</span></p>
                  <div className="grid grid-cols-4 gap-2">
                    {/* Frontal image (not deletable) */}
                    <div className="flex flex-col items-center">
                      <button
                        onClick={() => setFullscreenImage(previewChar.frontal_image_url)}
                        className="relative w-full aspect-square rounded-lg overflow-hidden border-2 border-purple-500/50 hover:border-purple-400 transition"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewChar.frontal_image_url} alt="Front" className="w-full h-full object-cover" />
                      </button>
                      <span className="text-[10px] text-purple-300/70 mt-1">Front</span>
                    </div>
                    {/* Angle images (deletable) */}
                    {previewChar.reference_image_urls.map((url, i) => {
                      const angleLabels = ['Left', 'Right', 'Rear', 'Extra', 'Extra', 'Extra'];
                      return (
                        <div key={url} className="flex flex-col items-center">
                          <button
                            onClick={() => setFullscreenImage(url)}
                            className="relative w-full aspect-square rounded-lg overflow-hidden border border-white/10 hover:border-white/30 transition group"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`${angleLabels[i]} angle`}
                              className={`w-full h-full object-cover ${isDeletingAngle === url ? 'opacity-30' : ''}`}
                            />
                            {/* Delete X button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteAngle(previewChar.id, url);
                              }}
                              disabled={isDeletingAngle !== null}
                              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-white/70 flex items-center justify-center opacity-70 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-red-500/80 hover:text-white transition-all touch-manipulation"
                              aria-label={`Remove ${angleLabels[i]} angle`}
                            >
                              {isDeletingAngle === url ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <X className="w-3 h-3" />
                              )}
                            </button>
                          </button>
                          <span className="text-[10px] text-white/30 mt-1">{angleLabels[i]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Add angle — camera + gallery */}
              {previewChar.reference_count < 6 && (
                <div className="space-y-2">
                  <p className="text-xs text-white/40">Add Angle ({previewChar.reference_count}/6)</p>
                  <div className="flex gap-2">
                    {/* Take Photo — mobile only (capture="user" is ignored on desktop) */}
                    <label className="flex-1 flex sm:hidden items-center justify-center gap-2 py-2.5 border border-purple-500/30 rounded-xl text-purple-300 text-sm cursor-pointer hover:bg-purple-500/10 transition touch-manipulation">
                      {angleUploading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</>
                      ) : (
                        <><Camera className="w-4 h-4" /> Take Photo</>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="user"
                        className="hidden"
                        disabled={angleUploading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleAngleUpload(previewChar.id, f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {/* Upload from file/gallery — always visible */}
                    <label className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-purple-500/30 rounded-xl text-purple-300 text-sm cursor-pointer hover:bg-purple-500/10 transition touch-manipulation">
                      {angleUploading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</>
                      ) : (
                        <><Upload className="w-4 h-4" /> Upload Angle</>
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
                  </div>
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
                  className={`flex-1 py-3 rounded-xl font-medium transition-colors text-sm touch-manipulation ${
                    selectedIds.has(previewChar.id)
                      ? 'bg-white/10 text-white/70 hover:bg-white/20 active:bg-white/30'
                      : 'bg-purple-500 text-white hover:bg-purple-400 active:bg-purple-300'
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
                  onClick={() => { setPreviewChar(null); setAngleError(null); setConfirmDelete(null); setDeleteError(null); }}
                  className="px-4 py-3 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 transition-colors text-sm"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {deleteError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {deleteError}
                </p>
              )}
            </div>
          </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Fullscreen image viewer */}
      <AnimatePresence>
        {fullscreenImage && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/95"
              onClick={() => setFullscreenImage(null)}
              aria-hidden="true"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="pointer-events-auto relative max-w-lg w-full max-h-[80vh]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fullscreenImage}
                  alt="Enlarged view"
                  className="w-full h-full object-contain rounded-xl"
                  onClick={() => setFullscreenImage(null)}
                />
                <button
                  onClick={() => setFullscreenImage(null)}
                  className="absolute top-2 right-2 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition touch-manipulation"
                  aria-label="Close fullscreen view"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
