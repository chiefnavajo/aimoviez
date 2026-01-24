'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { User, Trophy, Film, Heart, ArrowLeft, Share2, Lock, CheckCircle, BookOpen, Plus, Flag, Ban, MoreVertical, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import BottomNavigation from '@/components/BottomNavigation';
import ReportModal from '@/components/ReportModal';

// ============================================================================
// CREATOR PROFILE PAGE - View other creators
// ============================================================================

interface CreatorProfile {
  id: string;
  username: string;
  avatar_url: string;
  level: number;
  total_votes_received: number;
  clips_uploaded: number;
  clips_locked: number;
  followers: number;
  is_following: boolean;
}

interface CreatorClip {
  id: string;
  video_url: string;
  thumbnail_url: string;
  vote_count: number;
  status: 'voting' | 'locked' | 'pending' | 'active';
  slot_position: number;
  season_number: number;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

export default function CreatorProfilePage() {
  const params = useParams();
  const router = useRouter();
  const creatorId = params.id as string;

  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [clips, setClips] = useState<CreatorClip[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blocking, setBlocking] = useState(false);

  useEffect(() => {
    async function fetchCreatorData() {
      setLoading(true);
      try {
        // Fetch creator profile and clips from API
        const response = await fetch(`/api/creator/${encodeURIComponent(creatorId)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.creator) {
            setCreator({
              id: data.creator.id || creatorId,
              username: data.creator.username || creatorId,
              avatar_url: data.creator.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${creatorId}`,
              level: data.creator.level || 1,
              total_votes_received: data.creator.total_votes_received || 0,
              clips_uploaded: data.creator.clips_uploaded || 0,
              clips_locked: data.creator.clips_locked || 0,
              followers: data.creator.followers_count || 0,
              is_following: data.creator.is_following || false,
            });
            setIsFollowing(data.creator.is_following || false);
          }
          if (data.clips) {
            setClips(data.clips.map((clip: any) => ({
              id: clip.id,
              video_url: clip.video_url || '',
              thumbnail_url: clip.thumbnail_url || clip.video_url || '',
              vote_count: clip.vote_count || 0,
              status: clip.status || 'active',
              slot_position: clip.slot_position || 1,
              season_number: 1,
            })));
          }
        } else {
          // Fallback: create basic profile from username
          setCreator({
            id: creatorId,
            username: creatorId,
            avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${creatorId}`,
            level: 1,
            total_votes_received: 0,
            clips_uploaded: 0,
            clips_locked: 0,
            followers: 0,
            is_following: false,
          });
          setClips([]);
        }
      } catch (error) {
        console.error('Failed to fetch creator data:', error);
        // Fallback on error
        setCreator({
          id: creatorId,
          username: creatorId,
          avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${creatorId}`,
          level: 1,
          total_votes_received: 0,
          clips_uploaded: 0,
          clips_locked: 0,
          followers: 0,
          is_following: false,
        });
        setClips([]);
      }
      setLoading(false);
    }

    fetchCreatorData();
  }, [creatorId]);

  const [followLoading, setFollowLoading] = useState(false);

  const handleFollow = async () => {
    if (!creator || followLoading) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        // Unfollow
        const res = await fetch(`/api/user/follow?userId=${creator.id}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setIsFollowing(false);
          setCreator({ ...creator, followers: Math.max(0, creator.followers - 1) });
          toast.success('Unfollowed');
        } else {
          const data = await res.json();
          toast.error(data.error || 'Failed to unfollow');
        }
      } else {
        // Follow
        const res = await fetch('/api/user/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: creator.id }),
        });
        if (res.ok) {
          setIsFollowing(true);
          setCreator({ ...creator, followers: creator.followers + 1 });
          toast.success(`Following @${creator.username}`);
        } else {
          const data = await res.json();
          toast.error(data.error || 'Failed to follow');
        }
      }
    } catch (err) {
      console.error('Follow error:', err);
      toast.error('Something went wrong');
    } finally {
      setFollowLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({ title: `@${creator?.username} on AiMoviez`, url: window.location.href });
      toast.success('Shared!');
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(window.location.href);
          toast.success('Link copied!');
        } catch {
          toast.error('Failed to share');
        }
      }
    }
  };

  const handleBlock = async () => {
    if (!creator) return;
    setBlocking(true);
    try {
      if (isBlocked) {
        await fetch(`/api/user/block?userId=${creator.id}`, { method: 'DELETE' });
        setIsBlocked(false);
      } else {
        await fetch('/api/user/block', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: creator.id }),
        });
        setIsBlocked(true);
      }
    } catch (error) {
      console.error('Block/unblock error:', error);
    }
    setBlocking(false);
    setShowMoreMenu(false);
  };

  if (loading) return <div className="min-h-screen bg-black flex items-center justify-center"><div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!creator) return <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white"><User className="w-16 h-16 text-white/30 mb-4" /><p className="text-xl font-bold mb-2">Creator not found</p><Link href="/story" className="text-cyan-400 hover:underline">Back to Story</Link></div>;

  const renderProfileContent = () => (
    <>
      {/* Header */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/30 via-purple-900/30 to-pink-900/30" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
        
        <div className="relative z-20 flex items-center justify-between px-4 md:px-6 pt-12 md:pt-6 pb-4">
          <button onClick={() => router.back()} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"><ArrowLeft className="w-5 h-5" /></button>
          <div className="relative">
            <button onClick={() => setShowMoreMenu(!showMoreMenu)} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center"><MoreVertical className="w-5 h-5" /></button>
            {showMoreMenu && (
              <div className="absolute right-0 top-12 w-48 bg-gray-900 border border-white/20 rounded-xl overflow-hidden shadow-xl z-50">
                <button onClick={handleShare} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors text-left">
                  <Share2 className="w-4 h-4" /><span>Share Profile</span>
                </button>
                <button onClick={() => { setShowReportModal(true); setShowMoreMenu(false); }} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors text-left text-red-400">
                  <Flag className="w-4 h-4" /><span>Report User</span>
                </button>
                <button onClick={handleBlock} disabled={blocking} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/10 transition-colors text-left text-orange-400">
                  {blocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                  <span>{isBlocked ? 'Unblock User' : 'Block User'}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="relative z-10 px-4 md:px-6 pb-6">
          <div className="flex flex-col items-center mb-6">
            <div className="relative mb-3">
              <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 p-1 relative">
                <Image src={creator.avatar_url} alt={creator.username} fill sizes="112px" className="rounded-full bg-black object-cover" unoptimized={creator.avatar_url?.includes('dicebear')} />
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 md:w-12 md:h-12 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full flex items-center justify-center font-black text-sm md:text-base border-4 border-black">{creator.level}</div>
            </div>
            <h1 className="text-2xl md:text-3xl font-black mb-1">@{creator.username}</h1>
            <div className="flex items-center gap-6 mt-3">
              <div className="text-center"><div className="text-xl font-black">{creator.clips_uploaded}</div><div className="text-xs text-white/60">Clips</div></div>
              <div className="text-center"><div className="text-xl font-black">{formatNumber(creator.followers)}</div><div className="text-xs text-white/60">Followers</div></div>
              <div className="text-center"><div className="text-xl font-black">{creator.clips_locked}</div><div className="text-xs text-white/60">Wins</div></div>
            </div>
          </div>
          <div className="flex gap-3 max-w-xs mx-auto">
            <motion.button whileTap={{ scale: 0.95 }} onClick={handleFollow} disabled={followLoading} className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 ${isFollowing ? 'bg-white/10 border border-white/20' : 'bg-gradient-to-r from-cyan-500 to-purple-500'}`}>
              {followLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isFollowing ? <><CheckCircle className="w-4 h-4" />Following</> : <><User className="w-4 h-4" />Follow</>}
            </motion.button>
            <motion.button whileTap={{ scale: 0.95 }} onClick={handleShare} className="px-6 py-3 rounded-xl font-bold text-sm bg-white/10 border border-white/20"><Share2 className="w-4 h-4" /></motion.button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="px-4 md:px-6 mb-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4"><Heart className="w-5 h-5 text-pink-500 mb-2" /><div className="text-2xl font-black">{formatNumber(creator.total_votes_received)}</div><div className="text-xs text-white/60">Total Votes</div></div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4"><Trophy className="w-5 h-5 text-yellow-500 mb-2" /><div className="text-2xl font-black">{creator.clips_locked}</div><div className="text-xs text-white/60">Locked Clips</div></div>
        </div>
      </div>

      {/* Clips Section */}
      <div className="px-4 md:px-6 pb-24 md:pb-8">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Film className="w-5 h-5 text-cyan-500" />Clips ({clips.length})</h2>
        {clips.length === 0 ? (
          <div className="text-center py-12 text-white/60"><Film className="w-16 h-16 mx-auto mb-4 text-white/20" /><p>No clips uploaded yet</p></div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {clips.map((clip) => {
              // Check if thumbnail is an actual image (not a video URL used as placeholder)
              const isActualImage = clip.thumbnail_url &&
                !clip.thumbnail_url.match(/\.(mp4|webm|mov|quicktime)$/i) &&
                clip.thumbnail_url !== clip.video_url;

              return (
              <Link key={clip.id} href={`/clip/${clip.id}`}>
                <motion.div whileTap={{ scale: 0.95 }} className="relative aspect-[9/16] rounded-lg overflow-hidden bg-white/10">
                  {isActualImage ? (
                    <Image src={clip.thumbnail_url} alt="" fill sizes="(max-width: 768px) 33vw, 20vw" className="object-cover" />
                  ) : (
                    <video src={clip.video_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  {clip.status === 'locked' && <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-cyan-500/80 flex items-center gap-1"><Lock className="w-3 h-3" /><span className="text-[10px] font-bold">Winner</span></div>}
                  {(clip.status === 'voting' || clip.status === 'active') && <div className="absolute top-2 left-2 px-2 py-1 rounded-full bg-orange-500/80 flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /><span className="text-[10px] font-bold">LIVE</span></div>}
                  <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1 text-white text-xs font-bold"><Heart className="w-3 h-3" fill="white" />{formatNumber(clip.vote_count)}</div>
                </motion.div>
              </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Desktop Layout */}
      <div className="hidden md:flex h-screen">
        <div className="w-56 h-full flex flex-col py-4 px-3 border-r border-white/10">
          <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 mb-4"><span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7]">AiMoviez</span></Link>
          <Link href="/dashboard" className="mb-4"><motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl bg-gradient-to-r from-[#3CF2FF] via-[#A020F0] to-[#FF00C7] text-white font-bold shadow-lg"><Heart className="w-5 h-5" fill="white" /><span>Vote Now</span></motion.div></Link>
          <nav className="flex-1 space-y-1">
            <Link href="/story"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><BookOpen className="w-6 h-6" /><span>Story</span></div></Link>
            <Link href="/upload"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Plus className="w-6 h-6" /><span>Upload</span></div></Link>
            <Link href="/leaderboard"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Trophy className="w-6 h-6" /><span>Leaderboard</span></div></Link>
            <Link href="/profile"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><User className="w-6 h-6" /><span>Profile</span></div></Link>
          </nav>
        </div>
        <div className="flex-1 overflow-y-auto"><div className="max-w-2xl mx-auto">{renderProfileContent()}</div></div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden">
        {renderProfileContent()}
        <BottomNavigation />
      </div>

      {/* Report Modal */}
      <ReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        type="user"
        targetId={creator.id}
        targetName={creator.username}
      />

      {/* Click outside to close menu */}
      {showMoreMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
      )}
    </div>
  );
}
