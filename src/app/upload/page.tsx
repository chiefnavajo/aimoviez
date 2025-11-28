'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Upload, Check, Loader2, AlertCircle, BookOpen, User, Volume2, VolumeX, Plus, Heart, Trophy } from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

interface GenreType {
  id: string;
  name: string;
  emoji: string;
  color: string;
}

const GENRES: GenreType[] = [
  { id: 'action', name: 'Action', emoji: '💥', color: 'from-red-500 to-orange-500' },
  { id: 'comedy', name: 'Comedy', emoji: '😂', color: 'from-yellow-500 to-amber-500' },
  { id: 'thriller', name: 'Thriller', emoji: '🔪', color: 'from-purple-500 to-pink-500' },
  { id: 'animation', name: 'Animation', emoji: '🎨', color: 'from-indigo-500 to-purple-500' },
];

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_DURATION = 8.5;

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [video, setVideo] = useState<File | null>(null);
  const [genre, setGenre] = useState('');
  const [title, setTitle] = useState('');
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  // Cleanup video preview URL on unmount
  useEffect(() => {
    return () => {
      if (videoPreview) {
        URL.revokeObjectURL(videoPreview);
      }
    };
  }, [videoPreview]);

  const validateVideo = async (file: File): Promise<string[]> => {
    const errors: string[] = [];
    if (file.size > MAX_VIDEO_SIZE) errors.push('Video must be under 100MB');
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) errors.push('Only MP4, WebM, or MOV allowed');
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        if (video.duration > MAX_DURATION) errors.push(`Video must be 8 seconds or less (yours: ${video.duration.toFixed(1)}s)`);
        setVideoDuration(video.duration);
        resolve(errors);
      };
      video.onerror = () => { errors.push('Could not read video file'); resolve(errors); };
      video.src = URL.createObjectURL(file);
    });
  };

  const handleFileSelect = async (file: File) => {
    const validationErrors = await validateVideo(file);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors([]);
    
    // Clean up previous preview URL to prevent memory leaks
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }
    
    setVideo(file);
    setVideoPreview(URL.createObjectURL(file));
    // Auto-populate title from filename (without extension)
    const autoTitle = file.name.replace(/\.[^/.]+$/, '').slice(0, 50);
    setTitle(autoTitle);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleSubmit = async () => {
    if (!video || !genre) return;
    setIsUploading(true);
    setUploadProgress(0);
    setErrors([]);

    try {
      // Create form data for upload
      const formData = new FormData();
      formData.append('video', video);
      formData.append('genre', genre);
      formData.append('title', title.trim());
      formData.append('description', '');

      // Simulate progress while uploading
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 5, 85));
      }, 300);

      // Call the real upload API
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Upload failed');
      }

      // Success!
      setUploadProgress(100);
      setStep(3);
      
      // Redirect to dashboard after showing success
      setTimeout(() => router.push('/dashboard'), 3000);

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed. Please try again.';
      setErrors([errorMessage]);
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const renderUploadContent = () => (
    <div className="max-w-2xl mx-auto px-4 md:px-6 py-8">
      <AnimatePresence mode="wait">
        {/* STEP 1: Select Video */}
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <div className="text-center mb-8">
              <h1 className="text-2xl md:text-3xl font-black mb-2">Upload Your 8-Second Clip</h1>
              <p className="text-white/60">Compete for a spot in the global movie</p>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-2xl p-8 md:p-12 text-center cursor-pointer transition-all ${isDragging ? 'border-cyan-500 bg-cyan-500/10' : 'border-white/20 hover:border-white/40 bg-white/5'}`}
            >
              {videoPreview ? (
                <div className="relative aspect-[9/16] max-h-[400px] mx-auto rounded-xl overflow-hidden">
                  <video ref={videoRef} src={videoPreview} className="w-full h-full object-cover" autoPlay loop muted={isMuted} playsInline />
                  <button onClick={(e) => { e.stopPropagation(); setIsMuted(!isMuted); }} className="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>
                  <div className="absolute bottom-4 left-4 px-3 py-1 rounded-full bg-black/50 text-sm">{videoDuration.toFixed(1)}s</div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="text-lg font-bold mb-1">Drop your video here</p>
                    <p className="text-sm text-white/50">or click to browse</p>
                  </div>
                  <p className="text-xs text-white/40">MP4, WebM, MOV • Max 8 seconds • Max 100MB</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
            </div>

            {/* Errors */}
            {errors.length > 0 && (
              <div className="p-4 bg-red-500/20 border border-red-500/40 rounded-xl">
                {errors.map((error, i) => (
                  <div key={i} className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle className="w-4 h-4" />{error}</div>
                ))}
              </div>
            )}

            {/* Continue Button */}
            {video && errors.length === 0 && (
              <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} onClick={() => setStep(2)} className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold text-lg">
                Continue
              </motion.button>
            )}
          </motion.div>
        )}

        {/* STEP 2: Select Genre */}
        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <button onClick={() => setStep(1)} className="text-white/60 hover:text-white flex items-center gap-2">← Back</button>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-black mb-2">Add Details</h1>
              <p className="text-white/60">Give your clip a title and genre</p>
            </div>

            {/* Title Input */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Clip Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 50))}
                placeholder="Give your clip a catchy title..."
                className="w-full px-4 py-3 bg-white/5 border border-white/20 rounded-xl text-white placeholder-white/40 focus:border-cyan-500 focus:outline-none transition-colors"
                maxLength={50}
              />
              <p className="text-xs text-white/40 mt-1 text-right">{title.length}/50</p>
            </div>

            {/* Genre Selection */}
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">Genre</label>
              <div className="grid grid-cols-2 gap-3">
              {GENRES.map((g) => (
                <motion.button key={g.id} whileTap={{ scale: 0.95 }} onClick={() => setGenre(g.id)} className={`p-4 rounded-xl border-2 transition-all ${genre === g.id ? 'border-cyan-500 bg-cyan-500/20' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                  <span className="text-2xl mb-2 block">{g.emoji}</span>
                  <span className="font-bold">{g.name}</span>
                </motion.button>
              ))}
              </div>
            </div>

            {/* Errors */}
            {errors.length > 0 && (
              <div className="p-4 bg-red-500/20 border border-red-500/40 rounded-xl">
                {errors.map((error, i) => (
                  <div key={i} className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>
                ))}
              </div>
            )}

            {/* Submit Button */}
            <motion.button whileTap={{ scale: 0.98 }} onClick={handleSubmit} disabled={!genre || !title.trim() || isUploading} className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 ${genre && title.trim() && !isUploading ? 'bg-gradient-to-r from-cyan-500 to-purple-500' : 'bg-white/10 text-white/40'}`}>
              {isUploading ? <><Loader2 className="w-5 h-5 animate-spin" />Uploading...</> : 'Submit Clip'}
            </motion.button>

            {isUploading && (
              <div className="space-y-2">
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500" initial={{ width: 0 }} animate={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-xs text-white/60 text-center">Uploading your clip...</p>
              </div>
            )}
          </motion.div>
        )}

        {/* STEP 3: Success */}
        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 10 }} className="w-24 h-24 rounded-full bg-gradient-to-br from-green-400 to-cyan-500 flex items-center justify-center">
              <Check className="w-12 h-12 text-white" />
            </motion.div>
            <div><h1 className="text-2xl font-bold">Upload Complete! 🎉</h1><p className="text-white/60">Your clip is pending review</p></div>
            <p className="text-sm text-white/40">Redirecting to voting arena...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Desktop Layout */}
      <div className="hidden md:flex h-screen">
        {/* Left Sidebar */}
        <div className="w-56 h-full flex flex-col py-4 px-3 border-r border-white/10">
          <Link href="/" className="flex items-center gap-2 px-3 py-2 mb-4">
            <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7]">AiMoviez</span>
          </Link>
          <Link href="/dashboard" className="mb-4">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] text-white font-bold shadow-lg">
              <Heart className="w-5 h-5" fill="white" /><span>Vote Now</span>
            </motion.div>
          </Link>
          <nav className="flex-1 space-y-1">
            <Link href="/story"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><BookOpen className="w-6 h-6" /><span>Story</span></div></Link>
            <Link href="/upload"><div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-white/10 text-white border border-white/10"><Plus className="w-6 h-6" /><span className="font-semibold">Upload</span></div></Link>
            <Link href="/leaderboard"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Trophy className="w-6 h-6" /><span>Leaderboard</span></div></Link>
            <Link href="/profile"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><User className="w-6 h-6" /><span>Profile</span></div></Link>
          </nav>
        </div>
        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">{renderUploadContent()}</div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden pb-20">
        {renderUploadContent()}
        <BottomNavigation />
      </div>
    </div>
  );
}
