'use client';

// Demo page for EnhancedUploadArea component
// Shows how to integrate the enhanced upload area with form submission

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Film, Upload as UploadIcon, Sparkles } from 'lucide-react';
import EnhancedUploadArea from '@/components/EnhancedUploadArea';
import { GenreBadge, GENRES, GENRE_META } from '@/lib/genre';
import { Genre } from '@/types';

interface VideoMetadata {
  duration: number;
  size: number;
  width: number;
  height: number;
  aspectRatio: string;
}

export default function EnhancedUploadDemo() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<Genre>('comedy');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleFileSelect = (file: File, metadata: VideoMetadata) => {
    console.log('File selected:', file.name);
    console.log('Metadata:', metadata);
    setSelectedFile(file);
    setVideoMetadata(metadata);
  };

  const handleSubmit = async () => {
    if (!selectedFile || !title.trim()) {
      alert('Please select a video and enter a title');
      return;
    }

    setIsSubmitting(true);

    // Simulate upload
    const formData = new FormData();
    formData.append('video', selectedFile);
    formData.append('title', title);
    formData.append('description', description);
    formData.append('genre', selectedGenre);

    try {
      // Replace this with your actual upload endpoint
      // const response = await fetch('/api/upload', {
      //   method: 'POST',
      //   body: formData,
      // });

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('Upload payload:', {
        file: selectedFile.name,
        title,
        description,
        genre: selectedGenre,
        metadata: videoMetadata
      });

      setShowSuccess(true);
      
      // Reset form after success
      setTimeout(() => {
        setSelectedFile(null);
        setVideoMetadata(null);
        setTitle('');
        setDescription('');
        setSelectedGenre('comedy');
        setShowSuccess(false);
      }, 3000);

    } catch (error) {
      console.error('Upload failed:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#050510] via-[#0a0a1f] to-[#050510] text-white py-12 px-4">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-violet-500 blur-xl opacity-50" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center border border-white/10 backdrop-blur-sm">
                <Film size={32} className="text-cyan-400" />
              </div>
            </div>
          </div>
          
          <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-cyan-400 via-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            Upload Your Scene
          </h1>
          
          <p className="text-lg text-white/60 max-w-2xl mx-auto">
            Share your 8-second masterpiece with the world. Upload, customize, and compete!
          </p>
        </motion.div>

        {/* Main Upload Form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-8"
        >
          
          {/* Upload Area */}
          <div className="bg-white/5 backdrop-blur-lg rounded-3xl p-6 border border-white/10 shadow-2xl">
            <div className="flex items-center gap-2 mb-6">
              <UploadIcon size={24} className="text-cyan-400" />
              <h2 className="text-xl font-bold">Video Upload</h2>
            </div>
            
            <EnhancedUploadArea 
              onFileSelect={handleFileSelect}
              maxSizeMB={100}
              maxDurationSeconds={8}
              minDurationSeconds={0.5}
              acceptedFormats={['video/mp4', 'video/quicktime', 'video/webm']}
            />
          </div>

          {/* Video Details Form */}
          {selectedFile && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 backdrop-blur-lg rounded-3xl p-6 border border-white/10 shadow-2xl space-y-6"
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={24} className="text-violet-400" />
                <h2 className="text-xl font-bold">Video Details</h2>
              </div>

              {/* Title Input */}
              <div className="space-y-2">
                <label htmlFor="title" className="block text-sm font-medium text-white/80">
                  Title <span className="text-red-400">*</span>
                </label>
                <input
                  id="title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Epic Chase Scene"
                  maxLength={50}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent transition-all"
                />
                <p className="text-xs text-white/60">
                  {title.length}/50 characters
                </p>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <label htmlFor="description" className="block text-sm font-medium text-white/80">
                  Description <span className="text-white/40">(optional)</span>
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's happening in your scene?"
                  maxLength={200}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-transparent transition-all resize-none"
                />
                <p className="text-xs text-white/60">
                  {description.length}/200 characters
                </p>
              </div>

              {/* Genre Selector */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-white/80">
                  Genre <span className="text-red-400">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {GENRES.map((genre) => {
                    const meta = GENRE_META[genre];
                    const isSelected = selectedGenre === genre;
                    
                    return (
                      <button
                        key={genre}
                        onClick={() => setSelectedGenre(genre)}
                        className={`
                          flex items-center gap-2 px-4 py-3 rounded-xl border-2 font-medium
                          transition-all duration-300
                          ${isSelected
                            ? `${meta.bg} ${meta.border} ${meta.text} ${meta.glow} scale-105`
                            : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:border-white/20'
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

              {/* Submit Button */}
              <div className="pt-4">
                <button
                  onClick={handleSubmit}
                  disabled={!selectedFile || !title.trim() || isSubmitting}
                  className={`
                    w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-bold text-lg
                    transition-all duration-300
                    ${!selectedFile || !title.trim() || isSubmitting
                      ? 'bg-white/10 text-white/40 cursor-not-allowed'
                      : 'bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white hover:shadow-lg hover:shadow-cyan-500/50 hover:scale-[1.02] active:scale-[0.98]'
                    }
                  `}
                >
                  {isSubmitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : showSuccess ? (
                    <>
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>Upload Successful!</span>
                    </>
                  ) : (
                    <>
                      <UploadIcon size={20} />
                      <span>Submit Your Scene</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* Info Cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid md:grid-cols-3 gap-4"
          >
            <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-bold mb-2">8 Seconds</h3>
              <p className="text-sm text-white/60">
                Keep it short, sweet, and impactful. Every frame counts!
              </p>
            </div>

            <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10">
              <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="font-bold mb-2">Vertical Format</h3>
              <p className="text-sm text-white/60">
                9:16 aspect ratio works best for mobile viewing
              </p>
            </div>

            <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-6 border border-white/10">
              <div className="w-12 h-12 rounded-xl bg-fuchsia-500/20 flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-fuchsia-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="font-bold mb-2">High Quality</h3>
              <p className="text-sm text-white/60">
                Up to 100MB. Use MP4, MOV, or WebM format
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
