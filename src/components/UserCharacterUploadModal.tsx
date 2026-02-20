'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Upload, Loader2, AlertCircle, User } from 'lucide-react';
import { useCsrf } from '@/hooks/useCsrf';

interface UserCharacterUploadModalProps {
  onClose: () => void;
  onCreated: (character: {
    id: string;
    label: string;
    frontal_image_url: string;
    reference_image_urls: string[];
    appearance_description: string | null;
    reference_count: number;
    usage_count: number;
  }) => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function UserCharacterUploadModal({ onClose, onCreated }: UserCharacterUploadModalProps) {
  const { ensureToken } = useCsrf();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clean up blob URL on unmount or when replaced
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setError(null);

    if (!ACCEPTED_TYPES.includes(selected.type)) {
      setError('Please use JPEG, PNG, or WebP images');
      return;
    }

    if (selected.size > MAX_FILE_SIZE) {
      setError('Image must be under 5MB');
      return;
    }

    // Check minimum dimensions
    const img = new Image();
    const objectUrl = URL.createObjectURL(selected);
    img.onload = () => {
      if (img.width < 256 || img.height < 256) {
        setError('Image must be at least 256x256 pixels');
        URL.revokeObjectURL(objectUrl);
        return;
      }
      setFile(selected);
      setPreviewUrl(objectUrl);
    };
    img.onerror = () => {
      setError('Could not read image file');
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  };

  const handleSubmit = async () => {
    if (!file || !label.trim()) {
      setError('Please select an image and enter a name');
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      await ensureToken();
      const csrfToken = document.cookie.split(';').find(c => c.trim().startsWith('csrf-token='))?.split('=')[1] || '';

      // Step 1: Get signed upload URL
      const urlRes = await fetch('/api/ai/characters/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
        }),
      });

      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.success) {
        throw new Error(urlData.error || 'Failed to get upload URL');
      }

      // Step 2: Upload directly to storage
      const uploadRes = await fetch(urlData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload image');
      }

      // Step 3: Create character record
      const createRes = await fetch('/api/ai/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({
          label: label.trim(),
          frontal_image_url: urlData.publicUrl,
          appearance_description: description.trim() || undefined,
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok || !createData.ok) {
        throw new Error(createData.error || 'Failed to create character');
      }

      onCreated({
        id: createData.character.id,
        label: createData.character.label,
        frontal_image_url: createData.character.frontal_image_url,
        reference_image_urls: [],
        appearance_description: createData.character.appearance_description || null,
        reference_count: 0,
        usage_count: 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      {/* Backdrop — sibling to avoid mobile touch issues */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/80"
        onClick={onClose}
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
        <div className="pointer-events-auto bg-gray-900 rounded-2xl p-5 max-w-sm w-full border border-purple-500/30 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto touch-manipulation">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-purple-300">Upload Character</h3>
          <button onClick={onClose} className="p-1.5 text-white/40 hover:text-white/70 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Image upload area */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className={`relative aspect-square rounded-xl border-2 border-dashed cursor-pointer transition-colors flex items-center justify-center ${
            previewUrl ? 'border-purple-500/50' : 'border-white/20 hover:border-purple-500/40'
          }`}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview" className="w-full h-full object-cover rounded-xl" />
          ) : (
            <div className="text-center p-6">
              <User className="w-12 h-12 mx-auto text-white/30 mb-3" />
              <p className="text-sm text-white/50 mb-1">Tap to select a photo</p>
              <p className="text-xs text-white/30">JPEG, PNG, or WebP (max 5MB)</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Tips */}
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
          <p className="text-xs text-purple-300 font-medium mb-1">Tips for best results:</p>
          <ul className="text-xs text-white/50 space-y-0.5 list-disc list-inside">
            <li>Clear frontal photo, good lighting</li>
            <li>Neutral expression, face clearly visible</li>
            <li>No sunglasses or heavy obstructions</li>
          </ul>
        </div>

        {/* Label input */}
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 100))}
          placeholder="Character name (required)"
          className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500"
        />

        {/* Description textarea */}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          placeholder="Describe appearance (optional) — e.g. 'Tall woman with red hair, green eyes, wearing a leather jacket'"
          rows={2}
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500 resize-none"
        />

        {/* Error */}
        {error && (
          <div className="p-2 bg-red-500/20 border border-red-500/40 rounded-lg text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-3 h-3 shrink-0" /> {error}
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!file || !label.trim() || isUploading}
          className={`w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition ${
            file && label.trim() && !isUploading
              ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:opacity-90'
              : 'bg-white/10 text-white/40 cursor-not-allowed'
          }`}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" /> Save Character
            </>
          )}
        </button>
        </div>
      </motion.div>
    </>
  );
}
