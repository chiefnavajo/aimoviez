'use client';

// ============================================================================
// UPLOAD PAGE - MATCHING DASHBOARD/STORY STYLE (FIXED)
// ============================================================================
// Features:
// ✅ Black background with transparent overlays
// ✅ TikTok-style bottom navigation
// ✅ Drag & drop with video preview
// ✅ Video validation (8s max, 100MB max)
// ✅ Smooth animations with Framer Motion
// ✅ Matches dashboard and story board design
// ✅ Fixed TypeScript errors
// ============================================================================

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { 
  Upload, 
  Check, 
  X, 
  Loader2, 
  AlertCircle,
  BookOpen,
  User,
  Play,
  Volume2,
  VolumeX,
  Plus
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface UploadFormData {
  video: File | null;
  genre: string;
  title: string;
  description: string;
}

interface GenreType {
  id: string;
  name: string;
  emoji: string;
  color: string;
  bg: string;
  border: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const GENRES: GenreType[] = [
  { id: 'action', name: 'Action', emoji: '💥', color: 'from-red-500 to-orange-500', bg: 'bg-red-500/20', border: 'border-red-500/40' },
  { id: 'comedy', name: 'Comedy', emoji: '😂', color: 'from-yellow-500 to-amber-500', bg: 'bg-yellow-500/20', border: 'border-yellow-500/40' },
  { id: 'thriller', name: 'Thriller', emoji: '🔪', color: 'from-purple-500 to-pink-500', bg: 'bg-purple-500/20', border: 'border-purple-500/40' },
  { id: 'scifi', name: 'Sci-Fi', emoji: '🚀', color: 'from-blue-500 to-cyan-500', bg: 'bg-cyan-500/20', border: 'border-cyan-500/40' },
  { id: 'romance', name: 'Romance', emoji: '❤️', color: 'from-pink-500 to-rose-500', bg: 'bg-pink-500/20', border: 'border-pink-500/40' },
  { id: 'animation', name: 'Animation', emoji: '🎨', color: 'from-indigo-500 to-purple-500', bg: 'bg-indigo-500/20', border: 'border-indigo-500/40' },
  { id: 'horror', name: 'Horror', emoji: '👻', color: 'from-gray-600 to-gray-900', bg: 'bg-gray-500/20', border: 'border-gray-500/40' },
  { id: 'other', name: 'Other', emoji: '🎬', color: 'from-cyan-500 to-purple-500', bg: 'bg-cyan-500/20', border: 'border-cyan-500/40' },
];

const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_DURATION = 8.5; // 8 seconds + 0.5s tolerance
const MIN_DURATION = 0.5;

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // State
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [formData, setFormData] = useState<UploadFormData>({
    video: null,
    genre: '',
    title: '',
    description: '',
  });
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  // ============================================================================
  // VIDEO VALIDATION
  // ============================================================================

  const getVideoDuration = (file: File): Promise<number> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      video.onerror = () => reject(new Error('Could not read video'));
      video.src = URL.createObjectURL(file);
    });
  };

  const validateVideo = async (file: File): Promise<string[]> => {
    const validationErrors: string[] = [];

    // Check file type
    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (!validTypes.includes(file.type)) {
      validationErrors.push('Invalid format. Use MP4, MOV, or WebM');
    }

    // Check file size
    if (file.size > MAX_VIDEO_SIZE) {
      validationErrors.push(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 100MB`);
    }

    // Check duration
    try {
      const duration = await getVideoDuration(file);
      setVideoDuration(duration);
      if (duration > MAX_DURATION) {
        validationErrors.push(`Video too long (${duration.toFixed(1)}s). Max: 8 seconds`);
      }
      if (duration < MIN_DURATION) {
        validationErrors.push(`Video too short (${duration.toFixed(1)}s). Min: 0.5 seconds`);
      }
    } catch {
      validationErrors.push('Could not validate video duration');
    }

    return validationErrors;
  };

  // ============================================================================
  // FILE HANDLING
  // ============================================================================

  const handleFileSelect = async (file: File) => {
    setErrors([]);
    
    const validationErrors = await validateVideo(file);
    
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    // Create preview
    const previewUrl = URL.createObjectURL(file);
    setVideoPreview(previewUrl);
    setFormData({ ...formData, video: file });
    setStep(2);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // ============================================================================
  // UPLOAD
  // ============================================================================

  const handleUpload = async () => {
    if (!formData.video || !formData.genre || !formData.title) {
      setErrors(['Please fill in all required fields']);
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setErrors([]);

    const data = new FormData();
    data.append('video', formData.video);
    data.append('genre', formData.genre);
    data.append('title', formData.title);
    data.append('description', formData.description || '');

    try {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          // Success!
          setStep(3);
          setTimeout(() => {
            router.push('/dashboard');
          }, 3000);
        } else {
          try {
            const response = JSON.parse(xhr.responseText);
            setErrors([response.error || 'Upload failed']);
          } catch {
            setErrors(['Upload failed']);
          }
        }
        setIsUploading(false);
      });

      xhr.addEventListener('error', () => {
        setErrors(['Network error. Please try again.']);
        setIsUploading(false);
      });

      xhr.open('POST', '/api/upload');
      xhr.send(data);
    } catch (error) {
      setErrors(['Upload failed. Please try again.']);
      setIsUploading(false);
    }
  };

  // ============================================================================
  // RESET
  // ============================================================================

  const resetForm = () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setFormData({ video: null, genre: '', title: '', description: '' });
    setVideoPreview(null);
    setVideoDuration(0);
    setErrors([]);
    setStep(1);
    setUploadProgress(0);
    setIsPlaying(false);
  };

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-black/80 backdrop-blur-lg border-b border-white/10">
        <div className="flex items-center justify-between px-4 py-4">
          <Link href="/dashboard">
            <motion.button whileTap={{ scale: 0.9 }} className="p-2 -ml-2" type="button">
              <X className="w-6 h-6 text-white/80" />
            </motion.button>
          </Link>
          <div className="flex items-center gap-2">
            <Upload size={20} className="text-cyan-400" />
            <span className="font-bold">Upload Clip</span>
          </div>
          <div className="w-10" /> {/* Spacer */}
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center gap-2 pb-3">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1 w-16 rounded-full transition-all ${
                s <= step ? 'bg-gradient-to-r from-cyan-500 to-purple-500' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 pb-24">
        <AnimatePresence mode="wait">
          {/* STEP 1: Select Video */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <h1 className="text-2xl font-bold">Upload Your 8s Clip</h1>
                <p className="text-white/60">Max 8 seconds · MP4, MOV, WebM · 100MB max</p>
              </div>

              {/* Drop Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative aspect-[9/16] max-w-[280px] mx-auto rounded-2xl border-2 border-dashed
                  flex flex-col items-center justify-center gap-4 cursor-pointer
                  transition-all duration-300
                  ${isDragging 
                    ? 'border-cyan-400 bg-cyan-400/10 scale-105' 
                    : 'border-white/30 bg-white/5 hover:border-cyan-400/50 hover:bg-white/10'
                  }
                `}
              >
                <motion.div
                  animate={{ scale: isDragging ? 1.1 : 1 }}
                  className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center backdrop-blur-sm"
                >
                  <Upload className="w-8 h-8 text-cyan-400" />
                </motion.div>
                <div className="text-center px-4">
                  <p className="font-medium drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                    {isDragging ? 'Drop your video here' : 'Tap to select video'}
                  </p>
                  <p className="text-sm text-white/50 mt-1">or drag and drop</p>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  onChange={handleInputChange}
                  className="hidden"
                />
              </div>

              {/* Errors */}
              {errors.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 space-y-2 backdrop-blur-sm"
                >
                  {errors.map((error, i) => (
                    <div key={i} className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {error}
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Tips */}
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 space-y-3">
                <h3 className="font-medium text-cyan-400">Tips for great clips:</h3>
                <ul className="space-y-2 text-sm text-white/70">
                  <li className="flex items-start gap-2">
                    <span className="text-green-400">✓</span>
                    Vertical format (9:16) works best
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400">✓</span>
                    Keep action in the center
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400">✓</span>
                    Good lighting makes a difference
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400">✓</span>
                    8 seconds to make an impact!
                  </li>
                </ul>
              </div>
            </motion.div>
          )}

          {/* STEP 2: Add Details */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2">
                <h1 className="text-2xl font-bold">Add Details</h1>
                <p className="text-white/60">Tell us about your clip</p>
              </div>

              {/* Video Preview */}
              {videoPreview && (
                <div className="relative aspect-[9/16] max-w-[200px] mx-auto rounded-xl overflow-hidden bg-black border border-white/10 shadow-2xl">
                  <video
                    ref={videoRef}
                    src={videoPreview}
                    className="w-full h-full object-cover"
                    muted={isMuted}
                    loop
                    playsInline
                    onClick={togglePlayPause}
                  />
                  
                  {/* Play/Pause Overlay */}
                  {!isPlaying && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none"
                    >
                      <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <Play className="w-8 h-8 text-white ml-1" />
                      </div>
                    </motion.div>
                  )}
                  
                  {/* Duration Badge */}
                  <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm px-2 py-1 rounded text-xs font-medium">
                    {videoDuration.toFixed(1)}s
                  </div>
                  
                  {/* Mute/Unmute Button */}
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsMuted(!isMuted);
                    }}
                    className="absolute bottom-2 left-2 p-2 bg-black/70 backdrop-blur-sm rounded-full"
                    type="button"
                  >
                    {isMuted ? (
                      <VolumeX className="w-4 h-4 text-white" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-white" />
                    )}
                  </motion.button>
                  
                  {/* Remove Button */}
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={resetForm}
                    className="absolute top-2 right-2 p-2 bg-black/70 backdrop-blur-sm rounded-full hover:bg-red-500/30 transition-colors"
                    type="button"
                  >
                    <X className="w-4 h-4" />
                  </motion.button>
                </div>
              )}

              {/* Genre Selection */}
              <div className="space-y-3">
                <label className="block font-medium text-white/90">Genre *</label>
                <div className="grid grid-cols-4 gap-2">
                  {GENRES.map((genre) => (
                    <motion.button
                      key={genre.id}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setFormData({ ...formData, genre: genre.id })}
                      className={`
                        p-3 rounded-xl text-center transition-all
                        ${formData.genre === genre.id
                          ? `${genre.bg} ${genre.border} border-2 scale-105 shadow-lg`
                          : 'bg-white/10 border-2 border-transparent hover:bg-white/20'
                        }
                      `}
                      type="button"
                    >
                      <div className="text-2xl mb-1">{genre.emoji}</div>
                      <div className="text-xs font-medium">{genre.name}</div>
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div className="space-y-2">
                <label className="block font-medium text-white/90">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Give your clip a catchy title"
                  maxLength={50}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                           placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors backdrop-blur-sm"
                />
                <div className="text-xs text-white/40 text-right">{formData.title.length}/50</div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label className="block font-medium text-white/90">Description (optional)</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What's happening in your clip?"
                  maxLength={200}
                  rows={3}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white
                           placeholder-white/40 focus:border-cyan-400 focus:outline-none transition-colors resize-none backdrop-blur-sm"
                />
                <div className="text-xs text-white/40 text-right">{formData.description.length}/200</div>
              </div>

              {/* Errors */}
              {errors.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 backdrop-blur-sm"
                >
                  {errors.map((error, i) => (
                    <div key={i} className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  ))}
                </motion.div>
              )}

              {/* Actions */}
              <div className="flex gap-3">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={resetForm}
                  className="flex-1 py-3 rounded-xl bg-white/10 font-medium hover:bg-white/20 transition-colors backdrop-blur-sm"
                  type="button"
                >
                  Start Over
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={handleUpload}
                  disabled={!formData.genre || !formData.title || isUploading}
                  className={`
                    flex-1 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2
                    ${formData.genre && formData.title && !isUploading
                      ? 'bg-gradient-to-r from-cyan-500 to-purple-500 hover:shadow-lg hover:shadow-cyan-500/20'
                      : 'bg-white/20 text-white/50 cursor-not-allowed'
                    }
                  `}
                  type="button"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      {uploadProgress}%
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      Upload
                    </>
                  )}
                </motion.button>
              </div>

              {/* Upload Progress Bar */}
              {isUploading && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="space-y-2"
                >
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden backdrop-blur-sm">
                    <motion.div
                      className="h-full bg-gradient-to-r from-cyan-500 to-purple-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-white/60 text-center">Uploading your clip...</p>
                </motion.div>
              )}
            </motion.div>
          )}

          {/* STEP 3: Success */}
          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 10 }}
                className="w-24 h-24 rounded-full bg-gradient-to-br from-green-400 to-cyan-500 flex items-center justify-center"
              >
                <Check className="w-12 h-12 text-white" />
              </motion.div>

              <div className="space-y-2">
                <h1 className="text-2xl font-bold">Upload Complete! 🎉</h1>
                <p className="text-white/60">Your clip is pending review</p>
              </div>

              <div className="bg-white/5 rounded-xl p-4 max-w-xs backdrop-blur-sm">
                <p className="text-sm text-white/70">
                  Once approved, your clip will appear in the voting arena and compete for a spot in the movie!
                </p>
              </div>

              <p className="text-sm text-white/40">Redirecting to voting arena...</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Navigation - Matching Dashboard Style */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black border-t border-white/10">
        <div className="flex items-center justify-around px-4 py-2">
          <Link href="/story">
            <motion.div whileTap={{ scale: 0.9 }} className="flex flex-col items-center gap-1 py-2 px-6">
              <BookOpen className="w-6 h-6 text-white/70" />
              <span className="text-white/60 text-xs">Story</span>
            </motion.div>
          </Link>
          
          <div className="flex flex-col items-center gap-1 py-2 px-6">
            <Plus className="w-7 h-7 text-white" />
            <span className="text-white text-xs font-medium">Upload</span>
          </div>
          
          <Link href="/profile">
            <motion.div whileTap={{ scale: 0.9 }} className="flex flex-col items-center gap-1 py-2 px-6">
              <User className="w-6 h-6 text-white/70" />
              <span className="text-white/60 text-xs">Profile</span>
            </motion.div>
          </Link>
        </div>
      </nav>
    </div>
  );
}
