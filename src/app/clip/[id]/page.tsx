'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Heart, Share2, MoreVertical, Play, Pause,
  MessageCircle, Trophy, Clock, User, Flag, Loader2, Send
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ============================================================================
// CLIP DETAIL PAGE
// ============================================================================
// Individual clip view with playback, stats, comments, and voting
// ============================================================================

interface ClipDetail {
  id: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string;
  genre: string;
  slot_position: number;
  vote_count: number;
  hype_score: number;
  rank_in_track: number;
  status: 'pending' | 'approved' | 'voting' | 'locked' | 'rejected';
  created_at: string;
  uploader_key: string;
}

interface Comment {
  id: string;
  user: string;
  avatar: string;
  text: string;
  likes: number;
  created_at: string;
}

export default function ClipDetailPage() {
  const router = useRouter();
  const params = useParams();
  const clipId = params?.id as string;
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [hasVoted, setHasVoted] = useState(false);

  // Fetch clip details
  const { data: clip, isLoading } = useQuery<ClipDetail>({
    queryKey: ['clip-detail', clipId],
    queryFn: async () => {
      const response = await fetch(`/api/clip/${clipId}`);
      if (!response.ok) throw new Error('Failed to fetch clip');
      return response.json();
    },
  });

  // Fetch comments
  const { data: comments } = useQuery<Comment[]>({
    queryKey: ['clip-comments', clipId],
    queryFn: async () => {
      const response = await fetch(`/api/clip/${clipId}/comments`);
      if (!response.ok) throw new Error('Failed to fetch comments');
      return response.json();
    },
    enabled: showComments,
  });

  // Check if user already voted
  useEffect(() => {
    const voterKey = localStorage.getItem('voter_key') || '';
    const votedClips = JSON.parse(localStorage.getItem('voted_clips_today') || '[]');
    setHasVoted(votedClips.includes(clipId));
  }, [clipId]);

  // Vote mutation
  const voteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId, voteType: 'standard' }),
      });
      if (!response.ok) throw new Error('Failed to vote');
      return response.json();
    },
    onSuccess: () => {
      setHasVoted(true);
      
      // Track in localStorage
      const votedClips = JSON.parse(localStorage.getItem('voted_clips_today') || '[]');
      votedClips.push(clipId);
      localStorage.setItem('voted_clips_today', JSON.stringify(votedClips));

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['clip-detail', clipId] });

      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    },
  });

  // Post comment mutation
  const commentMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await fetch(`/api/clip/${clipId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error('Failed to post comment');
      return response.json();
    },
    onSuccess: () => {
      setNewComment('');
      queryClient.invalidateQueries({ queryKey: ['clip-comments', clipId] });
    },
  });

  // Toggle play/pause
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  };

  // Share clip
  const handleShare = async () => {
    if (navigator.share && clip) {
      try {
        await navigator.share({
          title: clip.title,
          text: `Check out "${clip.title}" by @${clip.username} on AiMoviez!`,
          url: window.location.href,
        });
      } catch (err) {
        console.log('Share cancelled');
      }
    }
  };

  // Handle video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-cyan-500 animate-spin" />
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Clip not found</h2>
          <button
            onClick={() => router.back()}
            className="px-6 py-3 bg-cyan-500 rounded-xl font-bold"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-black/80 backdrop-blur-xl border-b border-white/10 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all"
            >
              <Share2 className="w-5 h-5" />
            </button>
            <button className="w-10 h-10 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all">
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto">
        {/* Video Player */}
        <div className="relative w-full aspect-[9/16] max-h-[80vh] mx-auto bg-black">
          <video
            ref={videoRef}
            src={clip.video_url}
            poster={clip.thumbnail_url}
            loop
            onClick={togglePlay}
            className="w-full h-full object-contain"
          />

          {/* Play/Pause Overlay */}
          <AnimatePresence>
            {!isPlaying && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                onClick={togglePlay}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center hover:bg-white/30 transition-all"
              >
                <Play className="w-10 h-10 ml-1" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* Status Badge */}
          <div className="absolute top-4 left-4">
            <div className={`px-4 py-2 rounded-xl font-bold text-sm ${
              clip.status === 'locked' 
                ? 'bg-green-500 text-black'
                : clip.status === 'voting'
                ? 'bg-orange-500 text-black'
                : 'bg-white/20 backdrop-blur-md'
            }`}>
              {clip.status === 'locked' && 'ðŸ”’ Locked In'}
              {clip.status === 'voting' && 'ðŸ”¥ Voting Now'}
              {clip.status === 'approved' && 'âœ… Approved'}
              {clip.status === 'pending' && 'â³ Pending'}
            </div>
          </div>
        </div>

        {/* Clip Info */}
        <div className="px-4 py-6">
          {/* Title & Description */}
          <div className="mb-6">
            <h1 className="text-2xl font-black mb-2">{clip.title}</h1>
            {clip.description && (
              <p className="text-white/80">{clip.description}</p>
            )}
          </div>

          {/* Creator Info */}
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 p-0.5">
              <div className="w-full h-full rounded-full overflow-hidden bg-black">
                <img src={clip.avatar_url} alt={clip.username} className="w-full h-full object-cover" />
              </div>
            </div>
            <div className="flex-1">
              <div className="font-bold">@{clip.username}</div>
              <div className="text-sm text-white/60">Creator</div>
            </div>
            <button className="px-6 py-2 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold">
              Follow
            </button>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <StatBox
              icon={Heart}
              label="Votes"
              value={clip.vote_count.toLocaleString()}
            />
            <StatBox
              icon={Trophy}
              label="Rank"
              value={`#${clip.rank_in_track}`}
            />
            <StatBox
              icon={Play}
              label="Slot"
              value={`#${clip.slot_position}`}
            />
            <StatBox
              icon={Clock}
              label="Genre"
              value={clip.genre}
            />
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => !hasVoted && voteMutation.mutate()}
              disabled={hasVoted || clip.status !== 'voting'}
              className={`px-6 py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                hasVoted
                  ? 'bg-white/10 text-white/40 cursor-not-allowed'
                  : clip.status === 'voting'
                  ? 'bg-gradient-to-r from-pink-500 to-rose-500 hover:shadow-lg hover:shadow-pink-500/50'
                  : 'bg-white/10 text-white/40 cursor-not-allowed'
              }`}
            >
              <Heart className={`w-5 h-5 ${hasVoted ? 'fill-current' : ''}`} />
              {hasVoted ? 'Voted' : clip.status === 'voting' ? 'Vote' : 'Not Voting'}
            </motion.button>

            <button
              onClick={() => setShowComments(!showComments)}
              className="px-6 py-4 bg-white/10 hover:bg-white/20 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
            >
              <MessageCircle className="w-5 h-5" />
              Comments ({comments?.length || 0})
            </button>
          </div>

          {/* Comments Section */}
          <AnimatePresence>
            {showComments && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-white/10 pt-6"
              >
                <h3 className="text-lg font-bold mb-4">Comments</h3>

                {/* Comment Input */}
                <div className="flex gap-3 mb-6">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5" />
                  </div>
                  <div className="flex-1 flex gap-2">
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder="Add a comment..."
                      className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:border-cyan-500 focus:outline-none"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newComment.trim()) {
                          commentMutation.mutate(newComment);
                        }
                      }}
                    />
                    <button
                      onClick={() => newComment.trim() && commentMutation.mutate(newComment)}
                      disabled={!newComment.trim() || commentMutation.isPending}
                      className="px-4 py-3 bg-cyan-500 hover:bg-cyan-600 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Comments List */}
                <div className="space-y-4">
                  {comments && comments.length > 0 ? (
                    comments.map((comment) => (
                      <div key={comment.id} className="flex gap-3">
                        <div className="w-10 h-10 rounded-full bg-white/10 flex-shrink-0 overflow-hidden">
                          <img src={comment.avatar} alt={comment.user} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-sm">@{comment.user}</span>
                            <span className="text-xs text-white/40">
                              {new Date(comment.created_at).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-sm text-white/80 mb-2">{comment.text}</p>
                          <button className="text-xs text-white/60 hover:text-white/80 flex items-center gap-1">
                            <Heart className="w-3 h-3" />
                            {comment.likes}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-white/60 text-sm">
                      No comments yet. Be the first to comment!
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Report Button */}
          <div className="mt-6 pt-6 border-t border-white/10">
            <button className="text-sm text-white/40 hover:text-white/60 flex items-center gap-2">
              <Flag className="w-4 h-4" />
              Report this clip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper Component
function StatBox({ icon: Icon, label, value }: any) {
  return (
    <div className="p-4 bg-white/5 rounded-xl text-center">
      <Icon className="w-5 h-5 text-cyan-500 mx-auto mb-2" />
      <div className="text-lg font-black">{value}</div>
      <div className="text-xs text-white/60">{label}</div>
    </div>
  );
}
