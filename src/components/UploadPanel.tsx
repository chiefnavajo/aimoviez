'use client';

// UploadPanel - Upload UI with drag-drop, genre selector, and validation

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, X, CheckCircle, Loader } from 'lucide-react';
import { Genre, UploadPayload } from '@/types';
import { GenreBadge, GENRES, GENRE_META } from '@/lib/genre';

interface UploadPanelProps {
  onSubmit: (payload: UploadPayload) => Promise<void>;
  hasUploadedThisRound: boolean;
}

export default function UploadPanel({ onSubmit, hasUploadedThisRound }: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState<Genre>('comedy');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('video/')) {
      setFile(droppedFile);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleSubmit = async () => {
    if (!file || !title.trim() || hasUploadedThisRound) return;

    setIsUploading(true);
    setUploadProgress(0);

    // Simulate upload progress
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 10;
      });
    }, 200);

    try {
      await onSubmit({ file, title: title.trim(), genre });
      
      clearInterval(progressInterval);
      setUploadProgress(100);
      setShowSuccess(true);

      // Reset after success
      setTimeout(() => {
        setFile(null);
        setTitle('');
        setGenre('comedy');
        setShowSuccess(false);
        setIsUploading(false);
        setUploadProgress(0);
      }, 2000);

    } catch (error) {
      clearInterval(progressInterval);
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  if (hasUploadedThisRound && !isUploading) {
    return (
      <div className="p-6 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl">
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
          <CheckCircle size={48} className="text-green-400" />
          <h3 className="text-lg font-bold text-white">
            Clip Submitted!
          </h3>
          <p className="text-sm text-white/60 max-w-xs">
            You&apos;ve already submitted your clip for this round. Come back for the next one!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 shadow-2xl">
      <div className="space-y-6">
        
        {/* Header */}
        <div>
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Upload size={24} className="text-cyan-400" />
            Upload Your 8-Second Scene
          </h3>
          <p className="text-sm text-white/60 mt-1">
            One clip per round. Make it count!
          </p>
        </div>

        {/* File Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
            transition-all duration-300
            ${isDragging 
              ? 'border-cyan-400 bg-cyan-500/10' 
              : 'border-white/20 hover:border-cyan-400/50 hover:bg-white/5'
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
            aria-label="Upload video file"
          />

          {file ? (
            <div className="space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle size={24} className="text-green-400" />
              </div>
              <p className="text-sm font-medium text-white truncate">
                {file.name}
              </p>
              <p className="text-xs text-white/60">
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </p>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                }}
                className="text-xs text-red-400 hover:text-red-300 underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-cyan-500/20 flex items-center justify-center">
                <Upload size={24} className="text-cyan-400" />
              </div>
              <p className="text-sm font-medium text-white">
                Drop your video here or click to browse
              </p>
              <p className="text-xs text-white/60">
                MP4, MOV, WEBM • Max 50MB • 8 seconds • Vertical (9:16)
              </p>
            </div>
          )}
        </div>

        {/* Title Input */}
        <div>
          <label htmlFor="clip-title" className="block text-sm font-medium text-white/80 mb-2">
            Clip Title
          </label>
          <input
            id="clip-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Epic Chase Scene"
            maxLength={50}
            className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/60 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent transition-all"
          />
          <p className="text-xs text-white/60 mt-1">
            {title.length}/50 characters
          </p>
        </div>

        {/* Genre Selector */}
        <div>
          <label className="block text-sm font-medium text-white/80 mb-2">
            Genre
          </label>
          <div className="grid grid-cols-2 gap-2">
            {GENRES.map((g) => {
              const meta = GENRE_META[g];
              const isSelected = genre === g;
              
              return (
                <button
                  key={g}
                  onClick={() => setGenre(g)}
                  className={`
                    flex items-center gap-2 px-4 py-3 rounded-xl border-2 font-medium
                    transition-all duration-300
                    ${isSelected
                      ? `${meta.bg} ${meta.border} ${meta.text} ${meta.glow}`
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                    }
                  `}
                >
                  <span className="text-xl">{meta.emoji}</span>
                  <span className="text-sm">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Upload Progress */}
        <AnimatePresence>
          {isUploading && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/80">Uploading...</span>
                  <span className="text-cyan-400 font-mono">{uploadProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${uploadProgress}%` }}
                    transition={{ duration: 0.3 }}
                    className="h-full bg-gradient-to-r from-cyan-500 to-violet-500"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success Message */}
        <AnimatePresence>
          {showSuccess && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-500/20 border border-green-500/40"
            >
              <CheckCircle size={20} className="text-green-400" />
              <span className="text-sm text-green-400 font-medium">
                Submitted for this round!
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={!file || !title.trim() || isUploading || hasUploadedThisRound}
          className={`
            w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold text-lg
            transition-all duration-300
            ${!file || !title.trim() || isUploading || hasUploadedThisRound
              ? 'bg-white/10 text-white/40 cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white hover:shadow-lg hover:shadow-cyan-500/50'
            }
            focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050510]
          `}
        >
          {isUploading ? (
            <>
              <Loader size={20} className="animate-spin" />
              <span>Uploading...</span>
            </>
          ) : (
            <>
              <Upload size={20} />
              <span>Submit Your Scene</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
