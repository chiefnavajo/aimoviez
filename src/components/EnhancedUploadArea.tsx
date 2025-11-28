'use client';

// Enhanced Upload Area - Modern drag-drop interface with video preview and validation
// Features:
// - Visual drag-and-drop with animations
// - Video preview player
// - Real-time validation (duration, size, format)
// - Progress indication
// - Error handling with clear feedback

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, 
  X, 
  CheckCircle, 
  AlertCircle,
  FileVideo,
  Play,
  Pause,
  Volume2,
  VolumeX
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface EnhancedUploadAreaProps {
  onFileSelect: (file: File, metadata: VideoMetadata) => void;
  maxSizeMB?: number;
  maxDurationSeconds?: number;
  minDurationSeconds?: number;
  acceptedFormats?: string[];
  className?: string;
}

interface VideoMetadata {
  duration: number;
  size: number;
  width: number;
  height: number;
  aspectRatio: string;
}

interface ValidationError {
  type: 'size' | 'duration' | 'format' | 'general';
  message: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_ACCEPTED_FORMATS = ['video/mp4', 'video/quicktime', 'video/webm'];
const ASPECT_RATIO_9_16 = 9 / 16;

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function EnhancedUploadArea({
  onFileSelect,
  maxSizeMB = 100,
  maxDurationSeconds = 8,
  minDurationSeconds = 0.5,
  acceptedFormats = DEFAULT_ACCEPTED_FORMATS,
  className = ''
}: EnhancedUploadAreaProps) {
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // State
  const [file, setFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);

  // ============================================================================
  // VIDEO VALIDATION
  // ============================================================================

  const getVideoMetadata = (file: File): Promise<VideoMetadata> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      video.onloadedmetadata = () => {
        const metadata: VideoMetadata = {
          duration: video.duration,
          size: file.size,
          width: video.videoWidth,
          height: video.videoHeight,
          aspectRatio: (video.videoWidth / video.videoHeight).toFixed(2)
        };
        
        URL.revokeObjectURL(video.src);
        resolve(metadata);
      };
      
      video.onerror = () => {
        URL.revokeObjectURL(video.src);
        reject(new Error('Could not load video metadata'));
      };
      
      video.src = URL.createObjectURL(file);
    });
  };

  const validateFile = async (file: File): Promise<ValidationError[]> => {
    const validationErrors: ValidationError[] = [];

    // Format check
    if (!acceptedFormats.includes(file.type)) {
      validationErrors.push({
        type: 'format',
        message: `Invalid format. Please use ${acceptedFormats.map(f => f.split('/')[1].toUpperCase()).join(', ')}`
      });
    }

    // Size check
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > maxSizeMB) {
      validationErrors.push({
        type: 'size',
        message: `File too large (${sizeMB.toFixed(1)}MB). Maximum: ${maxSizeMB}MB`
      });
    }

    // Get and validate metadata
    try {
      const meta = await getVideoMetadata(file);
      setMetadata(meta);

      // Duration check
      if (meta.duration > maxDurationSeconds) {
        validationErrors.push({
          type: 'duration',
          message: `Video too long (${meta.duration.toFixed(1)}s). Maximum: ${maxDurationSeconds}s`
        });
      }

      if (meta.duration < minDurationSeconds) {
        validationErrors.push({
          type: 'duration',
          message: `Video too short (${meta.duration.toFixed(1)}s). Minimum: ${minDurationSeconds}s`
        });
      }

      // Aspect ratio check (warn if not 9:16)
      const aspectRatio = meta.width / meta.height;
      if (Math.abs(aspectRatio - ASPECT_RATIO_9_16) > 0.1) {
        validationErrors.push({
          type: 'general',
          message: `Recommended aspect ratio is 9:16 (vertical). Your video is ${meta.width}x${meta.height}`
        });
      }

    } catch (error) {
      validationErrors.push({
        type: 'general',
        message: 'Could not validate video. File may be corrupted.'
      });
    }

    return validationErrors;
  };

  // ============================================================================
  // FILE HANDLING
  // ============================================================================

  const handleFileProcessing = async (selectedFile: File) => {
    setErrors([]);
    setIsValidating(true);

    // Validate
    const validationErrors = await validateFile(selectedFile);
    setIsValidating(false);

    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      // Still show preview but with errors
      const previewUrl = URL.createObjectURL(selectedFile);
      setVideoPreview(previewUrl);
      setFile(selectedFile);
      return;
    }

    // Success - create preview and notify parent
    const previewUrl = URL.createObjectURL(selectedFile);
    setVideoPreview(previewUrl);
    setFile(selectedFile);
    
    if (metadata) {
      onFileSelect(selectedFile, metadata);
    }
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileProcessing(selectedFile);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('video/')) {
      handleFileProcessing(droppedFile);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleRemove = () => {
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
    }
    setFile(null);
    setVideoPreview(null);
    setMetadata(null);
    setErrors([]);
    setIsPlaying(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // ============================================================================
  // VIDEO PLAYBACK CONTROLS
  // ============================================================================

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className={`space-y-4 ${className}`}>
      
      {/* Drop Zone / Preview */}
      <AnimatePresence mode="wait">
        {!file ? (
          // UPLOAD ZONE
          <motion.div
            key="upload-zone"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer
              transition-all duration-300 ease-out
              ${isDragging 
                ? 'border-cyan-400 bg-cyan-500/10 scale-105 shadow-lg shadow-cyan-500/20' 
                : 'border-white/20 hover:border-cyan-400/50 hover:bg-white/5'
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedFormats.join(',')}
              onChange={handleFileSelect}
              className="hidden"
              aria-label="Upload video file"
            />

            {/* Upload Icon */}
            <motion.div
              animate={{ 
                y: isDragging ? -10 : 0,
                scale: isDragging ? 1.1 : 1
              }}
              className="mb-4"
            >
              <div className="relative w-20 h-20 mx-auto">
                {/* Outer glow ring */}
                <motion.div
                  animate={{ 
                    scale: isDragging ? [1, 1.2, 1] : 1,
                    opacity: isDragging ? [0.5, 0.8, 0.5] : 0.3
                  }}
                  transition={{ 
                    repeat: isDragging ? Infinity : 0,
                    duration: 2
                  }}
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-500 to-violet-500 blur-xl"
                />
                
                {/* Icon container */}
                <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center backdrop-blur-sm border border-white/10">
                  <Upload size={32} className="text-cyan-400" />
                </div>
              </div>
            </motion.div>

            {/* Text */}
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-white">
                {isDragging ? 'Drop your video here' : 'Upload your video'}
              </h3>
              <p className="text-sm text-white/60">
                Drag and drop or click to browse
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-white/40 pt-2">
                <FileVideo size={14} />
                <span>
                  MP4, MOV, WEBM • Max {maxSizeMB}MB • {minDurationSeconds}-{maxDurationSeconds}s • Vertical (9:16)
                </span>
              </div>
            </div>

            {/* Animated border pulse */}
            {isDragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 rounded-2xl border-2 border-cyan-400 pointer-events-none"
              >
                <motion.div
                  animate={{ 
                    scale: [1, 1.05, 1],
                    opacity: [0.5, 0.8, 0.5]
                  }}
                  transition={{ 
                    repeat: Infinity,
                    duration: 1.5
                  }}
                  className="absolute inset-0 rounded-2xl bg-cyan-500/10"
                />
              </motion.div>
            )}
          </motion.div>
        ) : (
          // VIDEO PREVIEW
          <motion.div
            key="video-preview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="relative"
          >
            {/* Video Container */}
            <div className="relative aspect-[9/16] max-w-md mx-auto rounded-2xl overflow-hidden bg-black border-2 border-white/10 shadow-2xl">
              
              {/* Video Player */}
              <video
                ref={videoRef}
                src={videoPreview || undefined}
                className="w-full h-full object-cover"
                muted={isMuted}
                loop
                playsInline
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />

              {/* Overlay Controls */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/50 pointer-events-none" />
              
              {/* Play/Pause Button */}
              <button
                onClick={togglePlay}
                className="absolute inset-0 flex items-center justify-center group pointer-events-auto"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: isPlaying ? 0 : 1 }}
                  className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border-2 border-white/40 group-hover:bg-white/30 transition-colors"
                >
                  <Play size={28} className="text-white ml-1" />
                </motion.div>
              </button>

              {/* Top Controls */}
              <div className="absolute top-4 left-4 right-4 flex items-start justify-between pointer-events-auto">
                {/* File Info */}
                <div className="bg-black/70 backdrop-blur-sm rounded-xl px-3 py-2 border border-white/20">
                  <p className="text-xs font-medium text-white truncate max-w-[150px]">
                    {file.name}
                  </p>
                  <p className="text-xs text-white/60">
                    {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>

                {/* Remove Button */}
                <button
                  onClick={handleRemove}
                  className="p-2 rounded-xl bg-red-500/20 backdrop-blur-sm border border-red-500/40 hover:bg-red-500/30 transition-colors"
                >
                  <X size={18} className="text-red-400" />
                </button>
              </div>

              {/* Bottom Controls */}
              <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-auto">
                {/* Duration Badge */}
                {metadata && (
                  <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/20">
                    <span className="text-sm font-mono text-white">
                      {metadata.duration.toFixed(1)}s
                    </span>
                  </div>
                )}

                {/* Mute Toggle */}
                <button
                  onClick={toggleMute}
                  className="p-2 rounded-lg bg-black/70 backdrop-blur-sm border border-white/20 hover:bg-white/10 transition-colors"
                >
                  {isMuted ? (
                    <VolumeX size={18} className="text-white/80" />
                  ) : (
                    <Volume2 size={18} className="text-cyan-400" />
                  )}
                </button>
              </div>

              {/* Validating Overlay */}
              {isValidating && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center pointer-events-auto">
                  <div className="text-center space-y-2">
                    <div className="w-12 h-12 mx-auto border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
                    <p className="text-sm text-white/80">Validating video...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Metadata Display */}
            {metadata && !isValidating && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 grid grid-cols-3 gap-2"
              >
                <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3 border border-white/10 text-center">
                  <p className="text-xs text-white/60 mb-1">Resolution</p>
                  <p className="text-sm font-mono text-white">
                    {metadata.width}x{metadata.height}
                  </p>
                </div>
                <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3 border border-white/10 text-center">
                  <p className="text-xs text-white/60 mb-1">Aspect Ratio</p>
                  <p className="text-sm font-mono text-white">
                    {metadata.aspectRatio}
                  </p>
                </div>
                <div className="bg-white/5 backdrop-blur-sm rounded-xl p-3 border border-white/10 text-center">
                  <p className="text-xs text-white/60 mb-1">Size</p>
                  <p className="text-sm font-mono text-white">
                    {(metadata.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Errors */}
      <AnimatePresence>
        {errors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-2"
          >
            {errors.map((error, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`
                  flex items-start gap-3 p-4 rounded-xl border backdrop-blur-sm
                  ${error.type === 'general' 
                    ? 'bg-yellow-500/10 border-yellow-500/40' 
                    : 'bg-red-500/10 border-red-500/40'
                  }
                `}
              >
                <AlertCircle 
                  size={20} 
                  className={error.type === 'general' ? 'text-yellow-400 mt-0.5' : 'text-red-400 mt-0.5'} 
                />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${error.type === 'general' ? 'text-yellow-400' : 'text-red-400'}`}>
                    {error.type === 'general' ? 'Warning' : 'Error'}
                  </p>
                  <p className="text-sm text-white/80 mt-0.5">
                    {error.message}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success Indicator */}
      {file && errors.length === 0 && !isValidating && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/40 backdrop-blur-sm"
        >
          <CheckCircle size={20} className="text-green-400" />
          <div>
            <p className="text-sm font-medium text-green-400">Video is ready!</p>
            <p className="text-xs text-white/60 mt-0.5">
              Your video passed all validation checks
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
