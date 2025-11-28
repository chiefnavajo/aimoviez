'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowLeft, Heart, Share2, Volume2, VolumeX, Play, Pause, BookOpen, Plus, Trophy, User, MessageCircle, Flag } from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';

// ============================================================================
// CLIP DETAIL PAGE - TikTok Style with Desktop Sidebar
// ============================================================================

interface ClipData {
  id: string;
  video_url: string;
  username: string;
  avatar_url: string;
  vote_count: number;
  genre: string;
  slot_position: number;
  season_number: number;
  status: 'voting' | 'locked' | 'pending';
  created_at: string;
}

const MOCK_CLIP: ClipData = {
  id: 'clip-1',
  video_url: 'https://dxixqdmqomqzhilmdfzg.supabase.co/storage/v1/object/public/videos/spooky-ghost.mp4',
  username: 'veo3_creator',
  avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=veo3',
  vote_count: 4521,
  genre: 'Horror',
  slot_position: 5,
  season_number: 2,
  status: 'voting',
  created_at: '2024-11-25T10:00:00Z',
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

export default function ClipDetailPage() {
  const params = useParams();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [clip] = useState<ClipData>(MOCK_CLIP);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteCount, setVoteCount] = useState(clip.vote_count);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleVote = () => {
    if (!hasVoted) {
      setHasVoted(true);
      setVoteCount(v => v + 1);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({ title: `Check out this clip by @${clip.username}`, url: window.location.href });
    } catch {
      navigator.clipboard.writeText(window.location.href);
    }
  };

  const renderClipContent = () => (
    <div className="relative w-full h-full bg-black flex items-center justify-center">
      {/* Video */}
      <div className="relative w-full max-w-[400px] md:max-w-[450px] aspect-[9/16] mx-auto">
        <video
          ref={videoRef}
          src={clip.video_url}
          className="w-full h-full object-cover rounded-xl md:rounded-2xl"
          autoPlay
          loop
          muted={isMuted}
          playsInline
          onClick={togglePlay}
        />
        
        {/* Play/Pause Overlay */}
        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl md:rounded-2xl">
            <Play className="w-16 h-16 text-white" fill="white" />
          </div>
        )}

        {/* Top Bar */}
        <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between">
          <button onClick={() => router.back()} className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="px-3 py-1.5 rounded-full bg-black/50 text-sm font-bold">
            {clip.status === 'voting' && <span className="text-orange-400">🔴 LIVE</span>}
            {clip.status === 'locked' && <span className="text-cyan-400">🏆 Winner</span>}
          </div>
        </div>

        {/* Right Actions */}
        <div className="absolute right-3 bottom-20 flex flex-col items-center gap-4">
          {/* Avatar */}
          <Link href={`/profile/${clip.username}`}>
            <div className="relative">
              <img src={clip.avatar_url} alt={clip.username} className="w-12 h-12 rounded-full border-2 border-white" />
            </div>
          </Link>

          {/* Vote */}
          <motion.button whileTap={{ scale: 0.9 }} onClick={handleVote} className="flex flex-col items-center gap-1">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${hasVoted ? 'bg-pink-500' : 'bg-white/20'}`}>
              <Heart className="w-6 h-6" fill={hasVoted ? 'white' : 'none'} />
            </div>
            <span className="text-xs font-bold">{formatNumber(voteCount)}</span>
          </motion.button>

          {/* Comment */}
          <button className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <MessageCircle className="w-6 h-6" />
            </div>
            <span className="text-xs">Chat</span>
          </button>

          {/* Share */}
          <button onClick={handleShare} className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <Share2 className="w-6 h-6" />
            </div>
            <span className="text-xs">Share</span>
          </button>

          {/* Mute */}
          <button onClick={() => setIsMuted(!isMuted)} className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>

        {/* Bottom Info */}
        <div className="absolute bottom-0 left-0 right-16 p-4">
          <Link href={`/profile/${clip.username}`} className="font-bold text-lg mb-1 block">@{clip.username}</Link>
          <p className="text-sm text-white/70">Season {clip.season_number} • Slot #{clip.slot_position} • {clip.genre}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Desktop Layout */}
      <div className="hidden md:flex h-screen">
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
            <Link href="/upload"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Plus className="w-6 h-6" /><span>Upload</span></div></Link>
            <Link href="/leaderboard"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Trophy className="w-6 h-6" /><span>Leaderboard</span></div></Link>
            <Link href="/profile"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><User className="w-6 h-6" /><span>Profile</span></div></Link>
          </nav>
        </div>
        <div className="flex-1 overflow-hidden">{renderClipContent()}</div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden h-screen">
        {renderClipContent()}
        <BottomNavigation />
      </div>
    </div>
  );
}
