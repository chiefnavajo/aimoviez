'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Upload, Loader2, AlertCircle, User, Camera, ImageIcon, CheckCircle } from 'lucide-react';
import { useCsrf } from '@/hooks/useCsrf';

interface CreatedCharacter {
  id: string;
  label: string;
  frontal_image_url: string;
  reference_image_urls: string[];
  appearance_description: string | null;
  reference_count: number;
  usage_count: number;
}

interface UserCharacterUploadModalProps {
  onClose: () => void;
  onCreated: (character: CreatedCharacter) => void;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const CAPTURE_STEPS = [
  { label: 'Left Profile', instruction: 'Turn your head to the LEFT', emoji: '👈' },
  { label: 'Right Profile', instruction: 'Turn your head to the RIGHT', emoji: '👉' },
  { label: 'Three-Quarter Rear', instruction: 'Turn AWAY and look slightly over your shoulder', emoji: '🔄' },
];

function compressImage(file: File, maxDim = 1024, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Compression failed')),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image')); };
    img.src = url;
  });
}

export default function UserCharacterUploadModal({ onClose, onCreated }: UserCharacterUploadModalProps) {
  const { ensureToken } = useCsrf();

  // --- Phase 1: Upload frontal photo ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Phase 2: Guided reference capture ---
  const [phase, setPhase] = useState<'upload' | 'capture'>('upload');
  const [createdChar, setCreatedChar] = useState<CreatedCharacter | null>(null);
  const [captureStep, setCaptureStep] = useState(0);
  const [capturePreview, setCapturePreview] = useState<string | null>(null);
  const [captureBlob, setCaptureBlob] = useState<Blob | null>(null);
  const [captureUploading, setCaptureUploading] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const captureInputRef = useRef<HTMLInputElement>(null);

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (capturePreview) URL.revokeObjectURL(capturePreview);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getCsrfToken = () =>
    document.cookie.split(';').find(c => c.trim().startsWith('csrf-token='))?.split('=')[1] || '';

  // =========================================================================
  // Phase 1 handlers
  // =========================================================================

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

    const img = new Image();
    const objectUrl = URL.createObjectURL(selected);
    img.onload = () => {
      if (img.width < 256 || img.height < 256) {
        setError('Image must be at least 256x256 pixels');
        URL.revokeObjectURL(objectUrl);
        return;
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
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
      const csrfToken = getCsrfToken();

      // Step 1: Get signed upload URL
      const urlRes = await fetch('/api/ai/characters/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
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
      if (!uploadRes.ok) throw new Error('Failed to upload image');

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

      const character: CreatedCharacter = {
        id: createData.character.id,
        label: createData.character.label,
        frontal_image_url: createData.character.frontal_image_url,
        reference_image_urls: [],
        appearance_description: createData.character.appearance_description || null,
        reference_count: 0,
        usage_count: 0,
      };

      // Notify parent immediately so character appears in list
      onCreated(character);
      setCreatedChar(character);

      // Transition to capture phase
      setPhase('capture');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  // =========================================================================
  // Phase 2 handlers
  // =========================================================================

  const handleCaptureSelect = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setCaptureError('Please use JPEG, PNG, or WebP images');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setCaptureError('Image must be under 10MB');
      return;
    }
    setCaptureError(null);
    try {
      const compressed = await compressImage(file);
      const url = URL.createObjectURL(compressed);
      if (capturePreview) URL.revokeObjectURL(capturePreview);
      setCapturePreview(url);
      setCaptureBlob(compressed);
    } catch {
      setCaptureError('Could not process image. Please try again.');
    }
  };

  const handleCaptureConfirm = async () => {
    if (!captureBlob || !createdChar) return;
    setCaptureUploading(true);
    setCaptureError(null);
    try {
      await ensureToken();
      const csrfToken = getCsrfToken();
      const compressedFile = new File([captureBlob], `angle-${captureStep}.jpg`, { type: 'image/jpeg' });

      // Get signed URL
      const urlRes = await fetch('/api/ai/characters/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({ filename: compressedFile.name, contentType: 'image/jpeg' }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok || !urlData.success) throw new Error(urlData.error || 'Failed to get upload URL');

      // Upload
      const uploadRes = await fetch(urlData.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: compressedFile,
      });
      if (!uploadRes.ok) throw new Error('Upload failed');

      // Register angle
      const angleRes = await fetch(`/api/ai/characters/${createdChar.id}/angles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        credentials: 'include',
        body: JSON.stringify({ image_url: urlData.publicUrl }),
      });
      const angleData = await angleRes.json();
      if (!angleRes.ok || !angleData.ok) throw new Error(angleData.error || 'Failed to add angle');

      // Update created char with new angles
      const updatedChar = {
        ...createdChar,
        reference_count: angleData.reference_count,
        reference_image_urls: angleData.reference_image_urls || [],
      };
      setCreatedChar(updatedChar);
      onCreated(updatedChar);

      // Clean up and advance
      if (capturePreview) URL.revokeObjectURL(capturePreview);
      setCapturePreview(null);
      setCaptureBlob(null);

      if (captureStep < 2) {
        setCaptureStep(prev => prev + 1);
      } else {
        setCaptureStep(3); // done
      }
    } catch {
      setCaptureError('Upload failed. Please try again.');
    } finally {
      setCaptureUploading(false);
    }
  };

  const handleClose = () => {
    if (capturePreview) URL.revokeObjectURL(capturePreview);
    onClose();
  };

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/80"
        onClick={handleClose}
        aria-hidden="true"
      />
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="fixed inset-0 z-[51] flex items-center justify-center p-4 pointer-events-none"
        role="dialog"
        aria-modal="true"
      >
        <div className="pointer-events-auto bg-gray-900 rounded-2xl p-5 max-w-sm w-full border border-purple-500/30 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto touch-manipulation">

        {phase === 'upload' ? (
          /* =============================================================== */
          /* Phase 1: Upload frontal photo + name                            */
          /* =============================================================== */
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-purple-300">Upload Character</h3>
              <button onClick={handleClose} className="p-1.5 text-white/40 hover:text-white/70 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Image upload area */}
            {previewUrl ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="relative aspect-square rounded-xl border-2 border-dashed border-purple-500/50 cursor-pointer transition-colors flex items-center justify-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover rounded-xl" />
              </div>
            ) : (
              <div className="rounded-xl border-2 border-dashed border-white/20 p-6">
                <User className="w-12 h-12 mx-auto text-white/30 mb-3" />
                <p className="text-xs text-white/30 text-center mb-4">JPEG, PNG, or WebP (max 5MB)</p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-purple-600/80 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
                  >
                    <Camera className="w-4 h-4" />
                    Take Photo
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 text-sm font-medium transition-colors"
                  >
                    <ImageIcon className="w-4 h-4" />
                    Gallery
                  </button>
                </div>
              </div>
            )}
            <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={handleFileSelect} className="hidden" />
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileSelect} className="hidden" />

            {/* Tips */}
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
              <p className="text-xs text-purple-300 font-medium mb-1">Tips for best results:</p>
              <ul className="text-xs text-white/50 space-y-0.5 list-disc list-inside">
                <li>Clear frontal photo, good lighting</li>
                <li>Neutral expression, face clearly visible</li>
                <li>No sunglasses or heavy obstructions</li>
              </ul>
            </div>

            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 100))}
              placeholder="Character name (required)"
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500"
            />

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              placeholder="Describe appearance (optional) — e.g. 'Tall woman with red hair, green eyes, wearing a leather jacket'"
              rows={2}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-purple-500 resize-none"
            />

            {error && (
              <div className="p-2 bg-red-500/20 border border-red-500/40 rounded-lg text-red-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-3 h-3 shrink-0" /> {error}
              </div>
            )}

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
                <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
              ) : (
                <><Upload className="w-4 h-4" /> Save Character</>
              )}
            </button>
          </>
        ) : (
          /* =============================================================== */
          /* Phase 2: Guided reference angle capture                         */
          /* =============================================================== */
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-purple-300">
                {captureStep >= 3 ? 'All Done!' : 'Add Reference Angles'}
              </h3>
              <button onClick={handleClose} className="p-1.5 text-white/40 hover:text-white/70 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Character thumbnail + name */}
            {createdChar && (
              <div className="flex items-center gap-3 bg-white/5 rounded-lg p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={createdChar.frontal_image_url}
                  alt={createdChar.label}
                  className="w-12 h-12 rounded-lg object-cover border border-purple-500/50"
                />
                <div>
                  <p className="text-sm font-medium text-white">{createdChar.label}</p>
                  <p className="text-xs text-white/40">
                    {captureStep >= 3
                      ? `${createdChar.reference_count} reference angles saved`
                      : 'Take 3 photos from different angles for better AI results'}
                  </p>
                </div>
              </div>
            )}

            {/* Hidden capture input */}
            <input
              ref={captureInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="user"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleCaptureSelect(f);
                e.target.value = '';
              }}
            />

            {captureStep >= 3 ? (
              /* Done state */
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 text-center space-y-3">
                <CheckCircle className="w-10 h-10 text-green-400 mx-auto" />
                <p className="text-sm text-green-400 font-medium">3 reference photos saved!</p>
                <p className="text-xs text-white/40">Your character is ready for AI video generation</p>
                <button
                  onClick={handleClose}
                  className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl text-white text-sm font-medium hover:opacity-90 transition"
                >
                  Done
                </button>
              </div>
            ) : (
              /* Guided step */
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4 space-y-3">
                {/* Progress dots */}
                <div className="flex items-center justify-center gap-2">
                  {CAPTURE_STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={`w-2.5 h-2.5 rounded-full transition-colors ${
                        i < captureStep ? 'bg-green-400' : i === captureStep ? 'bg-purple-400' : 'bg-white/20'
                      }`}
                    />
                  ))}
                </div>

                <p className="text-xs text-purple-300 font-medium text-center">
                  Step {captureStep + 1} of 3: {CAPTURE_STEPS[captureStep].label}
                </p>
                <p className="text-center text-lg py-1">
                  <span className="text-2xl mr-2">{CAPTURE_STEPS[captureStep].emoji}</span>
                  <span className="text-white/70 text-sm">{CAPTURE_STEPS[captureStep].instruction}</span>
                </p>

                {capturePreview ? (
                  /* Preview */
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={capturePreview} alt="Preview" className="w-full aspect-square object-cover rounded-lg" />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (capturePreview) URL.revokeObjectURL(capturePreview);
                          setCapturePreview(null);
                          setCaptureBlob(null);
                          setCaptureError(null);
                        }}
                        disabled={captureUploading}
                        className="flex-1 py-2.5 border border-white/20 rounded-lg text-white/60 text-sm hover:bg-white/10 transition disabled:opacity-50"
                      >
                        Retake
                      </button>
                      <button
                        onClick={handleCaptureConfirm}
                        disabled={captureUploading}
                        className="flex-1 py-2.5 bg-purple-500 rounded-lg text-white text-sm hover:bg-purple-400 transition disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {captureUploading ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                        ) : (
                          'Use This'
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Camera trigger */
                  <button
                    onClick={() => captureInputRef.current?.click()}
                    className="w-full py-3 bg-purple-500/20 border border-purple-500/40 rounded-lg text-purple-300 text-sm hover:bg-purple-500/30 transition flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" /> Take or choose a photo
                  </button>
                )}

                {captureError && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {captureError}
                  </p>
                )}
              </div>
            )}

            {/* Skip button */}
            {captureStep < 3 && (
              <button
                onClick={handleClose}
                disabled={captureUploading}
                className="w-full py-2.5 text-white/40 text-sm hover:text-white/60 transition disabled:opacity-50"
              >
                Skip — I&apos;ll add angles later
              </button>
            )}
          </>
        )}

        </div>
      </motion.div>
    </>
  );
}
