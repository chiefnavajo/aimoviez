'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowLeft, Heart, Share2, Volume2, VolumeX, Play, BookOpen, Plus, Trophy, User, MessageCircle, Loader2, Flag } from 'lucide-react';
import toast from 'react-hot-toast';
import ReportModal from '@/components/ReportModal';
import BottomNavigation from '@/components/BottomNavigation';
import CommentsSection from '@/components/CommentsSection';

// ============================================================================
// CLIP DETAIL PAGE - Client Component
// ============================================================================

interface ClipData {
  id: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string;
  title: string;
  description: string;
  vote_count: number;
  weighted_score: number;
  genre: string;
  slot_position: number;
  status: 'pending' | 'active' | 'voting' | 'locked' | 'rejected';
  is_winner: boolean;
  created_at: string;
}

interface ClipAPIResponse {
  clip: ClipData;
  user_vote: {
    has_voted: boolean;
  };
  season: {
    id: string;
    name: string;
    status: string;
  } | null;
  slot: {
    id: string;
    slot_position: number;
    status: string;
    voting_ends_at: string | null;
  } | null;
  stats: {
    comment_count: number;
    view_count: number;
    rank_in_slot: number;
    total_clips_in_slot: number;
  };
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

interface ClipPageClientProps {
  clipId: string;
}

export default function ClipPageClient({ clipId }: ClipPageClientProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [clip, setClip] = useState<ClipData | null>(null);
  const [stats, setStats] = useState<ClipAPIResponse['stats'] | null>(null);
  const [season, setSeason] = useState<ClipAPIResponse['season'] | null>(null);
  const [slot, setSlot] = useState<ClipAPIResponse['slot'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteCount, setVoteCount] = useState(0);
  const [showComments, setShowComments] = useState(false);
  const [isVoting, setIsVoting] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  // Fetch clip data
  useEffect(() => {
    async function fetchClip() {
      if (!clipId) return;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/clip/${clipId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('Clip not found');
          } else {
            setError('Failed to load clip');
          }
          return;
        }

        const data: ClipAPIResponse = await res.json();
        setClip(data.clip);
        setStats(data.stats);
        setSeason(data.season);
        setSlot(data.slot);
        setVoteCount(data.clip.vote_count);
        setHasVoted(data.user_vote.has_voted);
      } catch (err) {
        console.error('Failed to fetch clip:', err);
        setError('Failed to load clip');
      } finally {
        setLoading(false);
      }
    }

    fetchClip();
  }, [clipId]);

  // Auto-play video when clip loads
  useEffect(() => {
    if (clip && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [clip]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleVote = async () => {
    if (!clip || hasVoted || isVoting) return;

    setIsVoting(true);
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId: clip.id }),
      });

      const data = await res.json().catch(() => ({ success: false, error: 'Failed to vote' }));

      if (data.success) {
        setHasVoted(true);
        setVoteCount(data.newScore || voteCount + 1);
      } else if (data.code === 'ALREADY_VOTED') {
        setHasVoted(true);
      }
    } catch (err) {
      console.error('Vote failed:', err);
    } finally {
      setIsVoting(false);
    }
  };

  const handleShare = async () => {
    if (!clip) return;
    try {
      await navigator.share({ title: `Check out this clip by @${clip.username}`, url: window.location.href });
      toast.success('Shared!');
    } catch (error) {
      // User cancelled or native share not available
      if (error instanceof Error && error.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(window.location.href);
          toast.success('Link copied!');
        } catch {
          toast.error('Failed to share');
        }
      } else {
        // Try clipboard as fallback
        try {
          await navigator.clipboard.writeText(window.location.href);
          toast.success('Link copied!');
        } catch {
          toast.error('Failed to copy link');
        }
      }
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-white/50" />
      </div>
    );
  }

  // Error state
  if (error || !clip) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
        <p className="text-white/50">{error || 'Clip not found'}</p>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition"
        >
          Go Back
        </button>
      </div>
    );
  }

  // Determine if voting is allowed
  const canVote = slot?.status === 'voting' && !hasVoted && clip.status === 'voting';

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
            {clip.status === 'voting' && <span className="text-orange-400">LIVE</span>}
            {clip.status === 'locked' && clip.is_winner && <span className="text-cyan-400">WINNER</span>}
            {clip.status === 'pending' && <span className="text-yellow-400">PENDING</span>}
            {clip.status === 'rejected' && <span className="text-red-400">REJECTED</span>}
            {clip.status === 'active' && !clip.is_winner && <span className="text-white/50">ENDED</span>}
          </div>
        </div>

        {/* Right Actions */}
        <div className="absolute right-3 bottom-20 flex flex-col items-center gap-4">
          {/* Avatar */}
          <Link href={`/profile/${clip.username}`}>
            <div className="relative">
              <Image src={clip.avatar_url} alt={clip.username} width={48} height={48} className="w-12 h-12 rounded-full border-2 border-white" unoptimized={clip.avatar_url?.includes('dicebear')} />
            </div>
          </Link>

          {/* Vote Button */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => handleVote()}
            disabled={!canVote || isVoting}
            className="flex flex-col items-center gap-1"
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
              hasVoted
                ? 'bg-pink-500'
                : canVote ? 'bg-white/20 hover:bg-pink-500/50' : 'bg-white/10'
            }`}>
              {isVoting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Heart className="w-6 h-6" fill={hasVoted ? 'white' : 'none'} />
              )}
            </div>
            <span className="text-xs font-bold">{formatNumber(voteCount)}</span>
          </motion.button>

          {/* Comment */}
          <button onClick={() => setShowComments(true)} className="flex flex-col items-center gap-1">
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

          {/* Report */}
          <button onClick={() => setShowReportModal(true)} className="flex flex-col items-center gap-1">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center hover:bg-red-500/30 transition-colors">
              <Flag className="w-5 h-5" />
            </div>
          </button>

          {/* Mute */}
          <button onClick={() => setIsMuted(!isMuted)} className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>

        {/* Bottom Info */}
        <div className="absolute bottom-0 left-0 right-16 p-4">
          <Link href={`/profile/${clip.username}`} className="font-bold text-lg mb-1 block">@{clip.username}</Link>
          {clip.title && <p className="text-sm text-white/90 mb-1">{clip.title}</p>}
          <p className="text-sm text-white/70">
            {season?.name || 'Season'} • Slot #{clip.slot_position} • {clip.genre}
            {stats && stats.rank_in_slot > 0 && (
              <span className="ml-2">• Rank {stats.rank_in_slot}/{stats.total_clips_in_slot}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Desktop Layout */}
      <div className="hidden md:flex h-screen">
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

      {/* Comments Panel */}
      <CommentsSection
        clipId={clip.id}
        isOpen={showComments}
        onClose={() => setShowComments(false)}
        clipUsername={clip.username}
      />

      {/* Report Modal */}
      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        type="clip"
        targetId={clip.id}
        targetName={clip.title}
      />
    </div>
  );
}
