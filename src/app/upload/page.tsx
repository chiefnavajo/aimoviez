'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Upload, Check, X, Loader2, AlertCircle, BookOpen, User, Play, Volume2, VolumeX, Plus, Heart, Trophy } from 'lucide-react';
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
  { id: 'scifi', name: 'Sci-Fi', emoji: '🚀', color: 'from-blue-500 to-cyan-500' },
  { id: 'romance', name: 'Romance', emoji: '❤️', color: 'from-pink-500 to-rose-500' },
  { id: 'animation', name: 'Animation', emoji: '🎨', color: 'from-indigo-500 to-purple-500' },
  { id: 'horror', name: 'Horror', emoji: '👻', color: 'from-gray-600 to-gray-900' },
  { id: 'other', name: 'Other', emoji: '🎬', color: 'from-cyan-500 to-purple-500' },
];

const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB - Supabase limit
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
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStartTime, setUploadStartTime] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const addLog = (msg: string) => {
    console.log('[UPLOAD]', msg);
    setDebugLog(prev => [...prev.slice(-10), `${new Date().toLocaleTimeString()}: ${msg}`]);
  };

  const validateVideo = async (file: File): Promise<string[]> => {
    const errors: string[] = [];
    if (file.size > MAX_VIDEO_SIZE) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      errors.push(`Video too large (${sizeMB}MB). Maximum: 50MB. Tip: Compress your video - 8-second clips should be under 20MB.`);
    }
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
    setVideo(file);
    setVideoPreview(URL.createObjectURL(file));
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
    setUploadStartTime(Date.now());
    setErrors([]);
    setDebugLog([]);

    // Detect device
    const isAndroid = /android/i.test(navigator.userAgent);
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    addLog(`Device: ${isAndroid ? 'Android' : isIOS ? 'iOS' : 'Desktop'}`);
    addLog(`File: ${video.name} (${(video.size / 1024 / 1024).toFixed(2)}MB)`);

    // Fake progress for Android (XHR progress events unreliable)
    let fakeProgressInterval: NodeJS.Timeout | null = null;
    
    if (isAndroid) {
      addLog('Starting fake progress for Android');
      let fakeProgress = 0;
      fakeProgressInterval = setInterval(() => {
        // Slowly increment to 85%, then wait for real completion
        if (fakeProgress < 85) {
          fakeProgress += Math.random() * 3 + 1;
          setUploadProgress(Math.min(fakeProgress, 85));
        }
      }, 500);
    }

    try {
      // Create FormData
      const formData = new FormData();
      formData.append('video', video);
      formData.append('genre', genre);
      formData.append('title', `Clip by ${Date.now()}`); // Default title
      formData.append('description', '');
      addLog('FormData created, starting XHR');

      // Use XMLHttpRequest for upload progress tracking
      const xhr = new XMLHttpRequest();
      
      // Track upload progress (works on desktop, unreliable on Android)
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 90;
          addLog(`Progress: ${Math.round(percentComplete)}% (${e.loaded}/${e.total})`);
          if (!isAndroid) {
            setUploadProgress(percentComplete);
          }
        }
      });

      // Handle completion
      const uploadPromise = new Promise<{ success: boolean; error?: string; data?: any }>((resolve, reject) => {
        xhr.addEventListener('load', () => {
          addLog(`XHR load: status=${xhr.status}`);
          // Clear fake progress interval
          if (fakeProgressInterval) clearInterval(fakeProgressInterval);
          
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              addLog(`Response: success=${data.success}`);
              // Check if API actually returned success
              if (data.success === true) {
                resolve({ success: true, data });
              } else {
                // API returned 200 but with an error
                addLog(`API error: ${data.error || data.message}`);
                resolve({ success: false, error: data.error || data.message || 'Upload failed on server' });
              }
            } catch (e) {
              addLog('Failed to parse response');
              resolve({ success: false, error: 'Invalid response from server' });
            }
          } else {
            addLog(`HTTP error: ${xhr.status}`);
            try {
              const data = JSON.parse(xhr.responseText);
              resolve({ success: false, error: data.error || 'Upload failed' });
            } catch (e) {
              resolve({ success: false, error: `Upload failed (${xhr.status})` });
            }
          }
        });

        xhr.addEventListener('error', (e) => {
          addLog(`XHR error event: ${JSON.stringify(e)}`);
          if (fakeProgressInterval) clearInterval(fakeProgressInterval);
          resolve({ success: false, error: 'Network error. Please check your connection.' });
        });

        xhr.addEventListener('abort', () => {
          addLog('XHR aborted');
          if (fakeProgressInterval) clearInterval(fakeProgressInterval);
          resolve({ success: false, error: 'Upload cancelled' });
        });

        xhr.addEventListener('readystatechange', () => {
          addLog(`ReadyState: ${xhr.readyState}`);
        });
        
        // Timeout after 60 seconds for mobile
        setTimeout(() => {
          if (fakeProgressInterval) clearInterval(fakeProgressInterval);
          if (xhr.readyState !== 4) {
            addLog('Timeout after 60s - aborting');
            xhr.abort();
            resolve({ success: false, error: 'Upload timed out. Try a smaller file or better connection.' });
          }
        }, 60000);
      });

      // Start upload
      addLog('Sending XHR request...');
      xhr.open('POST', '/api/upload');
      xhr.send(formData);

      // Wait for completion
      const result = await uploadPromise;

      if (!result.success) {
        const errorMsg = result.error || result.data?.error || 'Upload failed';
        console.error('Upload failed:', errorMsg, result);
        throw new Error(errorMsg);
      }

      // Verify the response has the expected data
      if (!result.data || result.data.success !== true) {
        const errorMsg = result.data?.error || 'Upload completed but verification failed';
        console.error('Upload verification failed:', result.data);
        throw new Error(errorMsg);
      }

      console.log('Upload successful:', result.data);

      // Success - complete progress bar
      setUploadProgress(100);
      setTimeout(() => { 
        setStep(3); 
        setTimeout(() => router.push('/dashboard'), 3000); 
      }, 500);
    } catch (error) {
      console.error('Upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Upload failed. Please try again.';
      setErrors([errorMessage]);
      setIsUploading(false);
      setUploadProgress(0);
      setUploadStartTime(null);
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
                  <p className="text-xs text-white/40">MP4, WebM, MOV • Max 8 seconds • Max 50MB</p>
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
              <h1 className="text-2xl font-black mb-2">Choose a Genre</h1>
              <p className="text-white/60">What category best fits your clip?</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {GENRES.map((g) => (
                <motion.button key={g.id} whileTap={{ scale: 0.95 }} onClick={() => setGenre(g.id)} className={`p-4 rounded-xl border-2 transition-all ${genre === g.id ? 'border-cyan-500 bg-cyan-500/20' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                  <span className="text-2xl mb-2 block">{g.emoji}</span>
                  <span className="font-bold">{g.name}</span>
                </motion.button>
              ))}
            </div>

            {/* Submit Button */}
            <motion.button whileTap={{ scale: 0.98 }} onClick={handleSubmit} disabled={!genre || isUploading} className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 ${genre && !isUploading ? 'bg-gradient-to-r from-cyan-500 to-purple-500' : 'bg-white/10 text-white/40'}`}>
              {isUploading ? <><Loader2 className="w-5 h-5 animate-spin" />Uploading...</> : 'Submit Clip'}
            </motion.button>

            {isUploading && (
              <div className="space-y-2">
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500" initial={{ width: 0 }} animate={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-xs text-white/60 text-center">
                  {uploadProgress < 90 
                    ? `Uploading... ${Math.round(uploadProgress)}%` 
                    : uploadProgress < 100 
                      ? 'Processing on server...' 
                      : 'Complete!'}
                </p>
                <p className="text-xs text-white/40 text-center">
                  {uploadStartTime && uploadProgress < 100 && (
                    <>Please wait, this may take a minute on mobile</>
                  )}
                </p>
                {/* Debug log - visible on screen */}
                <div className="mt-4 p-3 bg-black/50 rounded-lg border border-white/10 max-h-40 overflow-y-auto">
                  <p className="text-[10px] text-cyan-400 font-mono mb-1">Debug Log:</p>
                  {debugLog.map((log, i) => (
                    <p key={i} className="text-[10px] text-white/60 font-mono">{log}</p>
                  ))}
                </div>
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
