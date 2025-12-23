'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Upload, Check, Loader2, AlertCircle, BookOpen, User, Volume2, VolumeX, Plus, Heart, Trophy, LogIn, ArrowLeft } from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';
import { useAuth, AuthGuard } from '@/hooks/useAuth';
import { useCsrf } from '@/hooks/useCsrf';
import { signIn } from 'next-auth/react';

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
  { id: 'scifi', name: 'Sci-Fi', emoji: '🚀', color: 'from-blue-500 to-cyan-500' },
  { id: 'romance', name: 'Romance', emoji: '❤️', color: 'from-pink-500 to-rose-500' },
  { id: 'animation', name: 'Animation', emoji: '🎨', color: 'from-indigo-500 to-purple-500' },
  { id: 'horror', name: 'Horror', emoji: '👻', color: 'from-gray-600 to-gray-900' },
  { id: 'other', name: 'Other', emoji: '🎬', color: 'from-cyan-500 to-purple-500' },
];

const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB - Supabase limit
const MAX_DURATION = 8.5;

// ============================================================================
// HELPERS
// ============================================================================

function _generateFilename(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  const ext = originalName.split('.').pop()?.toLowerCase() || 'mp4';
  return `clip_${timestamp}_${random}.${ext}`;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

function UploadPageContent() {
  const router = useRouter();
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const { post: csrfPost, ensureToken } = useCsrf();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [video, setVideo] = useState<File | null>(null);
  const [genre, setGenre] = useState('');
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Season status check
  const [seasonStatus, setSeasonStatus] = useState<'loading' | 'active' | 'ended' | 'none'>('loading');
  const [finishedSeasonName, setFinishedSeasonName] = useState<string | null>(null);

  // Check season status on mount
  useEffect(() => {
    async function checkSeasonStatus() {
      try {
        const res = await fetch('/api/vote');
        const data = await res.json();

        if (data.seasonStatus === 'finished') {
          setSeasonStatus('ended');
          setFinishedSeasonName(data.finishedSeasonName || null);
        } else if (data.currentSlot > 0) {
          setSeasonStatus('active');
        } else {
          setSeasonStatus('none');
        }
      } catch {
        // If check fails, allow upload attempt (backend will validate)
        setSeasonStatus('active');
      }
    }
    checkSeasonStatus();
  }, []);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  const addLog = (msg: string) => {
    setDebugLog(prev => [...prev.slice(-15), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  const validateVideo = async (file: File): Promise<string[]> => {
    const errors: string[] = [];
    if (file.size > MAX_VIDEO_SIZE) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      errors.push(`Video too large (${sizeMB}MB). Maximum: 50MB.`);
    }
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
      errors.push('Only MP4, WebM, or MOV allowed');
    }
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        if (video.duration > MAX_DURATION) {
          errors.push(`Video must be 8 seconds or less (yours: ${video.duration.toFixed(1)}s)`);
        }
        setVideoDuration(video.duration);
        resolve(errors);
      };
      video.onerror = () => { 
        errors.push('Could not read video file'); 
        resolve(errors); 
      };
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
    setVideo(file);
    setVideoPreview(URL.createObjectURL(file));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  // ============================================================================
  // UPLOAD VIA SIGNED URL (Bypasses Vercel 4.5MB limit)
  // 1. Get signed URL from server (requires auth)
  // 2. Upload directly to Supabase using signed URL
  // 3. Register clip metadata via API
  // ============================================================================

  const handleSubmit = async () => {
    if (!video || !genre) return;

    // Double-check authentication
    if (!isAuthenticated) {
      setErrors(['You must be logged in to upload clips']);
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus('Starting upload...');
    setErrors([]);
    setDebugLog([]);

    const isAndroid = /android/i.test(navigator.userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    addLog(`Device: ${isAndroid ? 'Android' : isIOS ? 'iOS' : 'Desktop'}`);
    addLog(`File: ${video.name} (${(video.size / 1024 / 1024).toFixed(2)}MB)`);

    try {
      // STEP 1: Get signed upload URL from server
      addLog('Step 1: Getting upload permission...');
      setUploadStatus('Preparing upload...');

      // Ensure CSRF token is available before making request
      await ensureToken();

      const signedUrlResult = await csrfPost<{ success: boolean; signedUrl?: string; publicUrl?: string; error?: string }>('/api/upload/signed-url', {
        filename: video.name,
        contentType: video.type,
      });

      if (!signedUrlResult.success || !signedUrlResult.signedUrl || !signedUrlResult.publicUrl) {
        addLog(`Failed to get upload URL: ${signedUrlResult.error}`);
        throw new Error(signedUrlResult.error || 'Failed to get upload permission');
      }

      addLog('Got signed upload URL');
      const { signedUrl, publicUrl } = signedUrlResult;

      // STEP 2: Upload directly to Supabase using signed URL
      addLog('Step 2: Uploading to storage...');
      setUploadStatus('Uploading video...');

      // Simulate progress while uploading
      const startTime = Date.now();
      const estimatedUploadTime = (video.size / 1024 / 1024) * 2000; // ~2 sec per MB

      // Clear any existing interval first
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }

      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const estimatedProgress = Math.min(80, (elapsed / estimatedUploadTime) * 80);
        setUploadProgress(estimatedProgress);
      }, 200);

      // Upload using the signed URL
      const uploadResponse = await fetch(signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': video.type,
        },
        body: video,
      });

      // Clear interval after upload completes
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        addLog(`Storage upload failed: ${uploadResponse.status} ${errorText}`);
        throw new Error(`Storage upload failed: ${uploadResponse.status}`);
      }

      addLog('Video uploaded to storage');
      setUploadProgress(85);

      // STEP 3: Register clip in database
      addLog('Step 3: Saving to database...');
      setUploadStatus('Saving clip info...');

      const registerResult = await csrfPost<{ success: boolean; error?: string }>('/api/upload/register', {
        videoUrl: publicUrl,
        genre,
        title: `Clip ${Date.now()}`,
        description: '',
        duration: videoDuration, // Send duration for server-side validation
      });

      if (!registerResult.success) {
        addLog(`Database save failed: ${registerResult.error}`);
        throw new Error(registerResult.error || 'Failed to save clip info');
      }

      addLog('SUCCESS! Clip saved to database');
      setUploadProgress(100);
      setUploadStatus('Complete!');

      // Success - go to step 3
      setTimeout(() => {
        setStep(3);
        setTimeout(() => router.push('/dashboard'), 3000);
      }, 500);

    } catch (error) {
      // Clear progress interval on error
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      console.error('Upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed. Please try again.';
      addLog(`ERROR: ${errorMessage}`);
      setErrors([errorMessage]);
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStatus('');
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  // Loading state
  if (authLoading || seasonStatus === 'loading') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60">Loading...</p>
        </div>
      </div>
    );
  }

  // Season ended or no active season - uploads closed
  if (seasonStatus === 'ended' || seasonStatus === 'none') {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="text-6xl mb-4">
              {seasonStatus === 'ended' ? '🏆' : '⏳'}
            </div>
            <div>
              <h1 className="text-2xl font-black mb-2">
                {seasonStatus === 'ended'
                  ? `${finishedSeasonName || 'Season'} Complete!`
                  : 'Uploads Coming Soon'}
              </h1>
              <p className="text-white/60">
                {seasonStatus === 'ended'
                  ? 'This season has ended. Check out the winning clips and stay tuned for the next season!'
                  : 'No active season right now. Check back soon for the next season!'}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Link
                href="/story"
                className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold text-lg text-center"
              >
                Watch the Story
              </Link>
              <Link
                href="/leaderboard"
                className="w-full py-4 bg-white/10 border border-white/20 rounded-xl font-bold text-center"
              >
                View Leaderboard
              </Link>
            </div>
          </motion.div>
        </div>
        <BottomNavigation />
      </div>
    );
  }

  // Login required screen
  const renderLoginRequired = () => (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
          <LogIn className="w-10 h-10 text-cyan-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black mb-2">Sign In Required</h1>
          <p className="text-white/60">You need to be signed in to upload clips and compete in the global movie.</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => signIn('google')}
          className="w-full py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold text-lg flex items-center justify-center gap-3"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </motion.button>
        <p className="text-xs text-white/60">
          By signing in, you agree to our{' '}
          <a href="/terms" className="text-cyan-400 hover:underline">Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" className="text-cyan-400 hover:underline">Privacy Policy</a>.
        </p>
      </motion.div>
    </div>
  );

  const renderUploadContent = () => (
    <div className="max-w-2xl mx-auto px-4 md:px-6 pt-14 pb-8 md:py-8">
      <AnimatePresence mode="wait">
        {/* Not authenticated - show login */}
        {!isAuthenticated && renderLoginRequired()}

        {/* STEP 1: Select Video */}
        {isAuthenticated && step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <div className="text-center mb-6 sm:mb-8">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-black mb-2">Upload Your 8-Second Clip</h1>
              <p className="text-sm sm:text-base text-white/60">Compete for a spot in the global movie</p>
            </div>

            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-2xl p-4 sm:p-8 md:p-12 text-center cursor-pointer transition-all ${isDragging ? 'border-cyan-500 bg-cyan-500/10' : 'border-white/20 hover:border-white/40 bg-white/5'}`}
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
                  <p className="text-xs text-white/60">MP4, WebM, MOV • Max 8 seconds • Max 50MB</p>
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
        {isAuthenticated && step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
            <button onClick={() => setStep(1)} className="text-white/60 hover:text-white flex items-center gap-2">← Back</button>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-black mb-2">Choose a Genre</h1>
              <p className="text-white/60">What category best fits your clip?</p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3" role="radiogroup" aria-label="Select genre for your clip">
              {GENRES.map((g) => (
                <motion.button
                  key={g.id}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setGenre(g.id)}
                  role="radio"
                  aria-checked={genre === g.id}
                  aria-label={`${g.name} genre`}
                  className={`p-3 sm:p-4 rounded-xl border-2 transition-all ${genre === g.id ? 'border-cyan-500 bg-cyan-500/20' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                >
                  <span className="text-xl sm:text-2xl mb-1 sm:mb-2 block" aria-hidden="true">{g.emoji}</span>
                  <span className="font-bold text-sm sm:text-base">{g.name}</span>
                </motion.button>
              ))}
            </div>

            {/* Debug log - only visible during upload errors in development */}
            {process.env.NODE_ENV === 'development' && debugLog.length > 0 && (
              <div className="mt-4 p-3 bg-black/50 rounded-lg border border-white/10 max-h-60 overflow-y-auto">
                <p className="text-[10px] text-cyan-400 font-mono mb-1">Debug Log (dev only):</p>
                {debugLog.map((log, i) => (
                  <p key={i} className="text-[10px] text-white/60 font-mono">{log}</p>
                ))}
              </div>
            )}

            {/* Submit Button */}
            <motion.button 
              whileTap={{ scale: 0.98 }} 
              onClick={handleSubmit} 
              disabled={!genre || isUploading} 
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 ${genre && !isUploading ? 'bg-gradient-to-r from-cyan-500 to-purple-500' : 'bg-white/10 text-white/60'}`}
            >
              {isUploading ? <><Loader2 className="w-5 h-5 animate-spin" />{uploadStatus || 'Uploading...'}</> : 'Submit Clip'}
            </motion.button>

            {isUploading && (
              <div className="space-y-2">
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-gradient-to-r from-cyan-500 to-purple-500" 
                    initial={{ width: 0 }} 
                    animate={{ width: `${uploadProgress}%` }} 
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <p className="text-xs text-white/60 text-center">
                  {uploadProgress < 90 
                    ? `Uploading to storage... ${Math.round(uploadProgress)}%` 
                    : uploadProgress < 100 
                      ? 'Saving to database...' 
                      : 'Complete!'}
                </p>
              </div>
            )}

            {/* Errors */}
            {errors.length > 0 && !isUploading && (
              <div className="p-4 bg-red-500/20 border border-red-500/40 rounded-xl">
                {errors.map((error, i) => (
                  <div key={i} className="flex items-center gap-2 text-red-400 text-sm"><AlertCircle className="w-4 h-4" />{error}</div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* STEP 3: Success */}
        {isAuthenticated && step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-6">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 10 }} className="w-24 h-24 rounded-full bg-gradient-to-br from-green-400 to-cyan-500 flex items-center justify-center">
              <Check className="w-12 h-12 text-white" />
            </motion.div>
            <div><h1 className="text-2xl font-bold">Upload Complete! 🎉</h1><p className="text-white/60">Your clip is pending review</p></div>
            <p className="text-sm text-white/60">Redirecting to voting arena...</p>
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
          <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 mb-4">
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
        {/* Cyberpunk Back Button */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          whileHover={{ scale: 1.05 }}
          onClick={() => router.back()}
          className="absolute top-3 left-3 z-30 p-[2px] rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 shadow-[0_0_15px_rgba(59,130,246,0.5),0_0_30px_rgba(147,51,234,0.3)] hover:shadow-[0_0_20px_rgba(59,130,246,0.7),0_0_40px_rgba(147,51,234,0.5)] transition-all duration-300"
        >
          <div className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-cyan-400/30">
            <ArrowLeft className="w-4 h-4 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,1)]" />
          </div>
        </motion.button>

        {renderUploadContent()}
        <BottomNavigation />
      </div>
    </div>
  );
}

// Wrap with AuthGuard for protected route
export default function UploadPage() {
  return (
    <AuthGuard>
      <UploadPageContent />
    </AuthGuard>
  );
}
