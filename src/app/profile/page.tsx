'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { signOut } from 'next-auth/react';
import {
  User, Trophy, Flame, Film, Settings as SettingsIcon,
  TrendingUp, Calendar, Award, Lock, PlayCircle,
  Clock, Bell, LogOut, Heart,
  ChevronRight, BookOpen, Plus, ShieldCheck, Play, Sparkles,
  Download, Pin, PinOff, AlertTriangle
} from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';
import ReferralSection from '@/components/ReferralSection';
import { useAuth, AuthGuard } from '@/hooks/useAuth';
import { useAdminAuth } from '@/hooks/useAdminAuth';

// ============================================================================
// TYPES
// ============================================================================

interface UserStats {
  totalVotesCast: number;
  votesToday: number;
  votingStreak: number;
  rank: number;
  level: number;
  xp: number;
  nextLevelXp: number;
  clipsUploaded: number;
  clipsLocked: number;
}

interface UserClip {
  id: string;
  video_url: string;
  thumbnail_url?: string;
  slot_position: number;
  status: 'pending' | 'approved' | 'voting' | 'locked' | 'rejected' | 'eliminated';
  vote_count: number;
  genre: string;
  season_number: number;
  created_at: string;
  is_pinned: boolean;
  eliminated_at: string | null;
  elimination_reason: string | null;
  video_deleted_at: string | null;
  days_until_deletion: number | null;
}

interface VotingHistoryItem {
  clip_id: string;
  creator_username: string;
  creator_avatar: string;
  voted_at: string;
  slot_position: number;
}

interface Badge {
  id: string;
  name: string;
  icon: string;
  description: string;
  unlocked: boolean;
  progress?: number;
  target?: number;
}

// Default empty stats
const EMPTY_STATS: UserStats = {
  totalVotesCast: 0,
  votesToday: 0,
  votingStreak: 0,
  rank: 0,
  level: 1,
  xp: 0,
  nextLevelXp: 100,
  clipsUploaded: 0,
  clipsLocked: 0,
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

function ProfilePageContent() {
  const { user, session } = useAuth();
  const { isAdmin } = useAdminAuth();
  const [activeTab, setActiveTab] = useState<'stats' | 'clips' | 'history' | 'settings'>('stats');
  const [stats, setStats] = useState<UserStats | null>(null);
  const [clips, setClips] = useState<UserClip[]>([]);
  const [history, setHistory] = useState<VotingHistoryItem[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [settings, setSettings] = useState({ notifications: true, autoplay: true });
  const [pinLoading, setPinLoading] = useState<string | null>(null);
  const [username, setUsername] = useState('User');
  const [avatarUrl, setAvatarUrl] = useState(`https://api.dicebear.com/7.x/avataaars/svg?seed=User`);

  // Get username and avatar from user profile or session (client-side only)
  useEffect(() => {
    const storedUsername = typeof window !== 'undefined' ? localStorage.getItem('username') : null;
    const storedAvatar = typeof window !== 'undefined' ? localStorage.getItem('avatar_url') : null;
    
    const finalUsername = user?.username || session?.user?.username || storedUsername || 'User';
    const finalAvatarUrl = user?.avatar_url || session?.user?.image || storedAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${finalUsername}`;
    
    setUsername(finalUsername);
    setAvatarUrl(finalAvatarUrl);
  }, [user, session]);

  const _avatarSeed = avatarUrl.includes('seed=') ? avatarUrl.split('seed=')[1] : username;

  // Fetch real data from APIs
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch stats
        const statsRes = await fetch('/api/profile/stats');
        if (statsRes.ok) {
          const statsData = await statsRes.json();

          // Update username/avatar from API response if available
          if (statsData.user?.username && statsData.user.username !== username) {
            setUsername(statsData.user.username);
            if (typeof window !== 'undefined') {
              localStorage.setItem('username', statsData.user.username);
            }
          }
          if (statsData.user?.avatar_url) {
            setAvatarUrl(statsData.user.avatar_url);
            if (typeof window !== 'undefined') {
              localStorage.setItem('avatar_url', statsData.user.avatar_url);
            }
          }

          setStats({
            totalVotesCast: statsData.stats?.total_votes || 0,
            votesToday: statsData.stats?.votes_today || 0,
            votingStreak: statsData.stats?.current_streak || 0,
            rank: statsData.stats?.global_rank || 0,
            level: statsData.user?.level || 1,
            xp: statsData.user?.current_xp || 0,
            nextLevelXp: statsData.user?.xp_for_next_level || 100,
            clipsUploaded: statsData.stats?.clips_uploaded || 0,
            clipsLocked: statsData.stats?.clips_locked_in || 0,
          });

          // Map badges with proper emoji decoding
          const mappedBadges = (statsData.badges || []).map((badge: any) => ({
            id: badge.id,
            name: badge.name,
            icon: badge.icon,
            description: badge.description,
            unlocked: badge.unlocked,
            progress: badge.progress,
            target: badge.target,
          }));
          setBadges(mappedBadges);
        }

        // Fetch clips
        const clipsRes = await fetch('/api/profile/clips');
        if (clipsRes.ok) {
          const clipsData = await clipsRes.json();
          const mappedClips = (clipsData.clips || []).map((clip: any) => {
            // Map API status to display status
            let displayStatus: UserClip['status'] = 'approved';
            if (clip.status === 'locked_in') displayStatus = 'locked';
            else if (clip.status === 'competing') displayStatus = 'voting';
            else if (clip.status === 'eliminated') displayStatus = 'eliminated';
            else if (clip.status === 'pending') displayStatus = 'pending';

            return {
              id: clip.id,
              video_url: clip.video_url,
              thumbnail_url: clip.thumbnail_url,
              slot_position: clip.slot_position,
              status: displayStatus,
              vote_count: clip.vote_count || 0,
              genre: clip.genre || 'Unknown',
              season_number: 1,
              created_at: clip.created_at,
              is_pinned: clip.is_pinned ?? false,
              eliminated_at: clip.eliminated_at ?? null,
              elimination_reason: clip.elimination_reason ?? null,
              video_deleted_at: clip.video_deleted_at ?? null,
              days_until_deletion: clip.days_until_deletion ?? null,
            };
          });
          setClips(mappedClips);
        }

        // Fetch history
        const historyRes = await fetch('/api/profile/history?limit=20');
        if (historyRes.ok) {
          const historyData = await historyRes.json();
          const mappedHistory = (historyData.history || []).map((item: any) => ({
            clip_id: item.clip?.id || '',
            creator_username: item.clip?.username || 'Creator',
            creator_avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.clip?.username || 'default'}`,
            voted_at: item.created_at,
            slot_position: item.clip?.slot_position || 0,
          }));
          setHistory(mappedHistory);
        }
      } catch (err) {
        console.error('Failed to fetch profile data:', err);
        setError('Failed to load profile data. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [username, retryCount]);

  // Retry function for error state
  const handleRetry = () => {
    setError(null);
    setRetryCount(prev => prev + 1);
  };

  // Pin toggle handler
  const handlePinToggle = async (clipId: string) => {
    if (pinLoading) return;
    setPinLoading(clipId);
    try {
      const res = await fetch('/api/profile/clips/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clipId }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setClips(prev => prev.map(c =>
          c.id === clipId ? { ...c, is_pinned: data.is_pinned, days_until_deletion: data.is_pinned ? null : c.days_until_deletion } : c
        ));
      } else {
        alert(data.error || 'Failed to update pin');
      }
    } catch {
      alert('Failed to update pin');
    } finally {
      setPinLoading(null);
    }
  };

  const levelProgress = stats ? (stats.xp / stats.nextLevelXp) * 100 : 0;
  const displayStats = stats || EMPTY_STATS;
  const displayBadges = badges;

  // Shared tab content
  const renderTabContent = () => (
    <>
      {activeTab === 'stats' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Award className="w-5 h-5 text-yellow-500 animate-subtle-float" />
              <span className="text-gradient-premium">Badges</span>
            </h2>
            {displayBadges.length === 0 ? (
              <div className="text-center py-8 glass-card">
                <Award className="w-12 h-12 mx-auto mb-3 text-white/60" />
                <p className="text-white/60">Start voting to unlock badges!</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 gap-3">
                {displayBadges.map((badge, idx) => (
                  <motion.div
                    key={badge.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.05, duration: 0.3 }}
                    whileHover={{ scale: badge.unlocked ? 1.05 : 1, y: badge.unlocked ? -2 : 0 }}
                    className={`relative flex flex-col items-center p-4 rounded-xl transition-all cursor-default group min-h-[120px] ${
                      badge.unlocked
                        ? 'glass-card glow-cyan'
                        : 'bg-white/5 border border-white/10'
                    }`}
                  >
                    {/* Badge icon - larger and always visible */}
                    <span className={`text-3xl mb-3 flex-shrink-0 ${badge.unlocked ? 'drop-shadow-lg' : 'grayscale opacity-50'}`}>{badge.icon}</span>

                    {/* Badge name - larger text */}
                    <span className={`text-xs font-semibold text-center leading-tight mb-1 ${!badge.unlocked ? 'text-white/50' : ''}`}>{badge.name}</span>

                    {/* Lock indicator for locked badges - small icon below name */}
                    {!badge.unlocked && (
                      <div className="flex items-center gap-1 mt-1">
                        <Lock className="w-3 h-3 text-white/40" />
                        <span className="text-[10px] text-white/40">Locked</span>
                      </div>
                    )}

                    {/* Progress bar for locked badges with progress */}
                    {!badge.unlocked && badge.progress !== undefined && badge.target && badge.target > 0 && (
                      <div className="w-full mt-auto pt-2">
                        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-purple-500"
                            style={{ width: `${Math.min((badge.progress / badge.target) * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-white/50 mt-1 block text-center">{badge.progress}/{badge.target}</span>
                      </div>
                    )}

                    {/* Tooltip on hover */}
                    <div className="absolute -bottom-14 left-1/2 -translate-x-1/2 px-3 py-2 bg-black/95 rounded-lg text-xs text-white/90 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 border border-white/20 shadow-lg">
                      {badge.description}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
          {displayBadges.filter(b => !b.unlocked && b.progress !== undefined && b.target && b.target > 0).length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-cyan-500" />
                In Progress
              </h2>
              <div className="space-y-3">
                {displayBadges.filter(b => !b.unlocked && b.progress !== undefined && b.target && b.target > 0).map((badge, idx) => {
                  const progressPercent = Math.min(Math.round((badge.progress! / badge.target!) * 100), 100);
                  return (
                    <motion.div
                      key={badge.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1, duration: 0.3 }}
                      className="glass-card glass-card-hover p-4"
                    >
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                          <span className="text-xl">{badge.icon}</span>
                        </div>
                        <div className="flex-1">
                          <div className="font-bold">{badge.name}</div>
                          <div className="text-xs text-white/50">{badge.description}</div>
                        </div>
                        <span className="text-sm font-bold text-cyan-400">{progressPercent}%</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2.5 bg-white/10 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 shimmer-bar rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${progressPercent}%` }}
                            transition={{ duration: 0.8, ease: "easeOut" }}
                          />
                        </div>
                        <span className="text-xs text-white/60 min-w-[50px] text-right">{badge.progress}/{badge.target}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Referral Section */}
          <ReferralSection />
        </div>
      )}

      {activeTab === 'clips' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">My Clips ({clips.length})</h2>
            <Link href="/upload">
              <motion.button whileTap={{ scale: 0.95 }} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full text-sm font-bold">
                <Plus className="w-4 h-4" />
                Upload
              </motion.button>
            </Link>
          </div>
          {clips.length === 0 ? (
            <div className="text-center py-12">
              <Film className="w-16 h-16 mx-auto mb-4 text-white/60" />
              <p className="text-white/60 mb-4">No clips uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {clips.map((clip) => <ClipCard key={clip.id} clip={clip} onPinToggle={handlePinToggle} />)}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold">Recent Votes</h2>
          {history.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-16 h-16 mx-auto mb-4 text-white/60" />
              <p className="text-white/60">No voting history yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item, idx) => (
                <Link key={`${item.clip_id}-${idx}`} href={`/profile/${item.creator_username}`}>
                  <motion.div whileTap={{ scale: 0.98 }} className="flex items-center gap-4 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
                    <Image src={item.creator_avatar} alt={item.creator_username} width={48} height={48} className="rounded-full bg-white/10" unoptimized={item.creator_avatar?.includes('dicebear')} />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold truncate">@{item.creator_username}</div>
                      <div className="text-sm text-white/60">Slot #{item.slot_position} • {new Date(item.voted_at).toLocaleDateString()}</div>
                    </div>
                    <Heart className="w-4 h-4 text-pink-500" fill="#ec4899" />
                    <ChevronRight className="w-5 h-5 text-white/60" />
                  </motion.div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold">Settings</h2>
          <div className="space-y-3">
            <SettingToggle icon={Bell} title="Notifications" description="Get updates about your clips" value={settings.notifications} onChange={(v) => setSettings({ ...settings, notifications: v })} />
            <SettingToggle icon={PlayCircle} title="Autoplay Videos" description="Automatically play clips" value={settings.autoplay} onChange={(v) => setSettings({ ...settings, autoplay: v })} />
          </div>
          <div className="space-y-2">
            <Link href="/story"><div className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition"><div className="flex items-center gap-3"><BookOpen className="w-5 h-5 text-cyan-500" /><span>Watch Story</span></div><ChevronRight className="w-5 h-5 text-white/60" /></div></Link>
            <Link href="/leaderboard"><div className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition"><div className="flex items-center gap-3"><Trophy className="w-5 h-5 text-yellow-500" /><span>Leaderboard</span></div><ChevronRight className="w-5 h-5 text-white/60" /></div></Link>
            <Link href="/settings"><div className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition"><div className="flex items-center gap-3"><SettingsIcon className="w-5 h-5 text-white/60" /><span>Settings & Privacy</span></div><ChevronRight className="w-5 h-5 text-white/60" /></div></Link>
          </div>

          {/* Admin Section - Only visible to admins */}
          {isAdmin && (
            <div className="p-4 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/30 rounded-xl">
              <h3 className="font-bold text-purple-400 mb-3 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" />
                Admin Access
              </h3>
              <Link href="/admin">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  className="w-full px-4 py-3 bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 rounded-lg font-bold flex items-center justify-center gap-2 transition-all"
                >
                  <ShieldCheck className="w-5 h-5" />
                  Admin Dashboard
                </motion.button>
              </Link>
            </div>
          )}
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <h3 className="font-bold text-red-500 mb-3">Account</h3>
            <button
              onClick={async () => {
                // Clear cached user profile on sign out
                localStorage.removeItem('user_profile');
                // Set flag to skip intro on return (persists through logout)
                localStorage.setItem('hasUsedAppBefore', 'true');
                // Wait for signOut to complete before redirecting to avoid race conditions
                await signOut({ redirect: false });
                window.location.href = '/?from=logout';
              }}
              className="w-full px-4 py-3 bg-red-500 hover:bg-red-600 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
            <button
              onClick={async () => {
                if (confirm('Clear all local data? This will sign you out.')) {
                  localStorage.clear();
                  sessionStorage.clear();
                  await signOut({ redirect: false });
                  window.location.href = '/';
                }
              }} 
              className="w-full px-4 py-3 mt-2 bg-white/5 hover:bg-white/10 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors text-white/70"
            >
              Clear All Data
            </button>
          </div>
        </div>
      )}
    </>
  );

  // Tab buttons
  const tabButtons = [
    { id: 'stats', label: 'Stats', icon: TrendingUp },
    { id: 'clips', label: 'Clips', icon: Film },
    { id: 'history', label: 'History', icon: Calendar },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {/* Desktop Layout */}
      <div className="hidden md:flex h-screen">
        {/* Left Sidebar */}
        <div className="w-56 h-full flex flex-col py-4 px-3 border-r border-white/10">
          <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 mb-4">
            <span className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-[#3CF2FF] to-[#FF00C7]">AiMoviez</span>
          </Link>
          <nav className="flex-1 space-y-1">
            <Link href="/dashboard"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Heart className="w-6 h-6" /><span>Vote Now</span></div></Link>
            <Link href="/story"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><BookOpen className="w-6 h-6" /><span>Story</span></div></Link>
            <Link href="/watch"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Play className="w-6 h-6" /><span>Watch</span></div></Link>
            <Link href="/upload"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Plus className="w-6 h-6" /><span>Upload</span></div></Link>
            <Link href="/create"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Sparkles className="w-6 h-6" /><span>AI Create</span></div></Link>
            <Link href="/leaderboard"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Trophy className="w-6 h-6" /><span>Leaderboard</span></div></Link>
            <Link href="/profile"><div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-white/10 text-white border border-white/10"><User className="w-6 h-6" /><span className="font-semibold">Profile</span></div></Link>
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/20 via-purple-900/20 to-pink-900/20" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
            <div className="relative z-10 max-w-4xl mx-auto px-6 pt-8 pb-6">
              <div className="flex items-start gap-6 mb-6">
                <div className="relative flex-shrink-0">
                  {/* Outer glow ring */}
                  <div className="absolute -inset-2 rounded-full avatar-glow-ring opacity-60" />
                  {/* Animated gradient border */}
                  <div className="w-28 h-28 rounded-full gradient-border-animated p-[3px] relative">
                    <Image src={avatarUrl} alt="Avatar" fill sizes="112px" className="rounded-full bg-black object-cover" unoptimized={avatarUrl?.includes('dicebear')} />
                  </div>
                  {/* Level badge with gold glow */}
                  <motion.div
                    whileHover={{ scale: 1.1 }}
                    className="absolute -bottom-2 -right-2 w-12 h-12 bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500 rounded-full flex items-center justify-center font-black text-lg border-4 border-black shadow-lg glow-gold"
                  >
                    {displayStats.level}
                  </motion.div>
                </div>
                <div className="flex-1 pt-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h1 className="text-3xl font-black mb-2">@{username}</h1>
                      <div className="flex items-center gap-4 text-sm text-white/60 mb-4">
                        <div className="flex items-center gap-1"><Trophy className="w-4 h-4 text-yellow-500" /><span>Rank #{displayStats.rank}</span></div>
                        <div className="flex items-center gap-1"><Flame className="w-4 h-4 text-orange-500" /><span>{displayStats.votingStreak} day streak</span></div>
                      </div>
                      <div className="max-w-md">
                        <div className="flex items-center justify-between text-xs text-white/60 mb-1.5">
                          <span className="font-medium">Level {displayStats.level}</span>
                          <span>{displayStats.xp} / {displayStats.nextLevelXp} XP</span>
                        </div>
                        <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden relative">
                          <motion.div
                            className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 shimmer-bar rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${levelProgress}%` }}
                            transition={{ duration: 0.8, ease: "easeOut" }}
                          />
                          {levelProgress >= 90 && (
                            <div className="absolute inset-0 animate-soft-pulse rounded-full" />
                          )}
                        </div>
                      </div>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      onClick={async () => {
                        localStorage.setItem('hasUsedAppBefore', 'true');
                        await signOut({ redirect: false });
                        window.location.href = '/?from=logout';
                      }}
                      className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg font-medium flex items-center gap-2 transition-colors text-red-400"
                    >
                      <LogOut className="w-4 h-4" />
                      <span className="hidden sm:inline">Sign Out</span>
                    </motion.button>
                  </div>
                </div>
              </div>
              {loading ? (
                <ProfileStatsSkeleton />
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <p className="text-red-400 text-sm">{error}</p>
                  <button
                    onClick={handleRetry}
                    className="px-4 py-2 bg-cyan-500/20 border border-cyan-500/50 rounded-lg text-cyan-400 text-sm hover:bg-cyan-500/30 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  <StatBox icon={Heart} label="Today" value={displayStats.votesToday} subValue="/200" index={0} iconColor="text-pink-500" />
                  <StatBox icon={TrendingUp} label="Total" value={formatNumber(displayStats.totalVotesCast)} index={1} iconColor="text-cyan-500" />
                  <StatBox icon={Film} label="Clips" value={displayStats.clipsUploaded} index={2} iconColor="text-purple-500" />
                  <StatBox icon={Trophy} label="Wins" value={displayStats.clipsLocked} index={3} iconColor="text-yellow-500" />
                </div>
              )}
            </div>
          </div>
          <div className="border-b border-white/10 sticky top-0 z-20 bg-black/90 backdrop-blur-xl">
            <div className="max-w-4xl mx-auto px-6 flex">
              {tabButtons.map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setActiveTab(id as any)} className={`flex items-center gap-2 py-4 px-6 text-sm font-medium transition-all border-b-2 ${activeTab === id ? 'border-cyan-500 text-white' : 'border-transparent text-white/50 hover:text-white/70'}`}>
                  <Icon className="w-4 h-4" />{label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-w-4xl mx-auto px-6 py-6">{renderTabContent()}</div>
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="md:hidden pb-24">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/20 via-purple-900/20 to-pink-900/20" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />
          <div className="relative z-10 px-4 pt-6 pb-6">
            <div className="flex items-start gap-5 mb-6">
              <div className="relative flex-shrink-0">
                {/* Outer glow ring */}
                <div className="absolute -inset-1.5 rounded-full avatar-glow-ring opacity-50" />
                {/* Animated gradient border */}
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full gradient-border-animated p-[2px] relative">
                  <Image src={avatarUrl} alt="Avatar" fill sizes="(max-width: 640px) 64px, 80px" className="rounded-full bg-black object-cover" unoptimized={avatarUrl?.includes('dicebear')} />
                </div>
                {/* Level badge */}
                <motion.div
                  whileTap={{ scale: 1.1 }}
                  className="absolute -bottom-1 -right-1 w-6 h-6 sm:w-8 sm:h-8 bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500 rounded-full flex items-center justify-center font-black text-xs sm:text-sm border-2 sm:border-4 border-black glow-gold"
                >
                  {displayStats.level}
                </motion.div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between mb-1">
                  <h1 className="text-xl font-black truncate">@{username}</h1>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={async () => {
                      localStorage.setItem('hasUsedAppBefore', 'true');
                      await signOut({ redirect: false });
                      window.location.href = '/?from=logout';
                    }}
                    className="p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg transition-colors"
                  >
                    <LogOut className="w-4 h-4 text-red-400" />
                  </motion.button>
                </div>
                <div className="flex items-center gap-3 text-sm text-white/60 mb-3 flex-wrap">
                  <div className="flex items-center gap-1"><Trophy className="w-4 h-4 text-yellow-500" /><span>#{displayStats.rank}</span></div>
                  <div className="flex items-center gap-1"><Flame className="w-4 h-4 text-orange-500" /><span>{displayStats.votingStreak} day streak</span></div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs text-white/60 mb-1">
                    <span className="font-medium">Level {displayStats.level}</span>
                    <span>{displayStats.xp} / {displayStats.nextLevelXp} XP</span>
                  </div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden relative">
                    <motion.div
                      className="h-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 shimmer-bar rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${levelProgress}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                </div>
              </div>
            </div>
            {loading ? (
              <ProfileStatsSkeleton />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <StatBox icon={Heart} label="Today" value={displayStats.votesToday} subValue="/200" index={0} iconColor="text-pink-500" />
                <StatBox icon={TrendingUp} label="Total" value={formatNumber(displayStats.totalVotesCast)} index={1} iconColor="text-cyan-500" />
                <StatBox icon={Film} label="Clips" value={displayStats.clipsUploaded} index={2} iconColor="text-purple-500" />
                <StatBox icon={Trophy} label="Wins" value={displayStats.clipsLocked} index={3} iconColor="text-yellow-500" />
              </div>
            )}
          </div>
        </div>
        <div className="border-b border-white/10 sticky top-0 z-20 bg-black/90 backdrop-blur-xl px-4">
          <div className="flex">
            {tabButtons.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setActiveTab(id as any)} className={`flex-1 flex items-center justify-center gap-1 py-3 text-sm font-medium border-b-2 ${activeTab === id ? 'border-cyan-500 text-white' : 'border-transparent text-white/50'}`}>
                <Icon className="w-4 h-4" /><span className="hidden xs:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="px-4 py-6">{renderTabContent()}</div>
        <BottomNavigation />
      </div>
    </div>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function StatBox({ icon: Icon, label, value, subValue, index = 0, iconColor = 'text-cyan-500' }: { icon: any; label: string; value: number | string; subValue?: string; index?: number; iconColor?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      whileHover={{ y: -2, scale: 1.02 }}
      className="glass-card glass-card-hover p-3 text-center group cursor-default"
    >
      <div className={`w-8 h-8 mx-auto mb-2 rounded-lg bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors`}>
        <Icon className={`w-4 h-4 ${iconColor} group-hover:scale-110 transition-transform`} />
      </div>
      <div className="text-lg font-black">{value}{subValue && <span className="text-xs text-white/60">{subValue}</span>}</div>
      <div className="text-[10px] text-white/60 uppercase tracking-wide">{label}</div>
    </motion.div>
  );
}

function ClipCard({ clip, onPinToggle }: { clip: UserClip; onPinToggle?: (clipId: string) => void }) {
  const isVideoDeleted = !!clip.video_deleted_at;
  const isEliminated = clip.status === 'eliminated';

  const statusConfig: Record<UserClip['status'], { color: string; bg: string; label: string; glow?: string }> = {
    pending: { color: 'text-yellow-500', bg: 'bg-yellow-500/20', label: 'Pending' },
    approved: { color: 'text-green-500', bg: 'bg-green-500/20', label: 'Approved' },
    voting: { color: 'text-orange-500', bg: 'bg-orange-500/20', label: 'LIVE', glow: 'animate-soft-pulse' },
    locked: { color: 'text-cyan-500', bg: 'bg-cyan-500/20', label: 'Winner', glow: 'glow-cyan' },
    rejected: { color: 'text-red-500', bg: 'bg-red-500/20', label: 'Eliminated' },
    eliminated: { color: 'text-gray-500', bg: 'bg-gray-500/20', label: clip.elimination_reason === 'season_ended' ? 'Season Ended' : `Lost Slot #${clip.slot_position}` },
  };
  const config = statusConfig[clip.status] || statusConfig.approved;

  // Check if thumbnail is an actual image (not a video URL used as placeholder)
  const isActualImage = clip.thumbnail_url &&
    !clip.thumbnail_url.match(/\.(mp4|webm|mov|quicktime)$/i) &&
    clip.thumbnail_url !== clip.video_url;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01, y: -2 }}
      className={`flex gap-4 p-4 glass-card glass-card-hover ${config.glow || ''}`}
    >
      <Link href={`/clip/${clip.id}`} className="w-20 h-28 rounded-lg overflow-hidden bg-white/10 flex-shrink-0 relative group">
        {isVideoDeleted ? (
          <div className="w-full h-full flex items-center justify-center bg-white/5">
            <AlertTriangle className="w-8 h-8 text-white/30" />
          </div>
        ) : isActualImage ? (
          <Image src={clip.thumbnail_url!} alt="Clip thumbnail" fill sizes="80px" className="object-cover" />
        ) : (
          <video src={clip.video_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
        )}
        {!isVideoDeleted && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <PlayCircle className="w-8 h-8 text-white/80" />
          </div>
        )}
        {clip.is_pinned && (
          <div className="absolute top-1 left-1 w-5 h-5 bg-cyan-500 rounded-full flex items-center justify-center">
            <Pin className="w-3 h-3 text-white" />
          </div>
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <Link href={`/clip/${clip.id}`} className="min-w-0">
            <div className="text-sm text-white/60 truncate">Slot #{clip.slot_position}</div>
            <div className="font-bold">{clip.genre}</div>
          </Link>
          <div className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${config.bg} ${config.color} ${clip.status === 'voting' ? 'animate-pulse' : ''}`}>
            {config.label}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Heart className="w-4 h-4 text-pink-500" fill="#ec4899" />
          <span className="font-bold">{formatNumber(clip.vote_count)} votes</span>
        </div>
        <div className="text-xs text-white/60 mt-1">{new Date(clip.created_at).toLocaleDateString()}</div>

        {/* Elimination actions: download, pin, countdown */}
        {isEliminated && !isVideoDeleted && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <a
              href={clip.video_url}
              download
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onPinToggle?.(clip.id);
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                clip.is_pinned
                  ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              {clip.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
              {clip.is_pinned ? 'Unpin' : 'Pin'}
            </button>
            {!clip.is_pinned && clip.days_until_deletion !== null && (
              <span className={`text-xs font-medium ${clip.days_until_deletion <= 3 ? 'text-red-400' : 'text-white/50'}`}>
                {clip.days_until_deletion} day{clip.days_until_deletion !== 1 ? 's' : ''} left
              </span>
            )}
          </div>
        )}
        {isVideoDeleted && (
          <div className="text-xs text-white/40 mt-2">Video deleted</div>
        )}
      </div>
    </motion.div>
  );
}

function SettingToggle({ icon: Icon, title, description, value, onChange }: { icon: any; title: string; description: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl">
      <div className="flex items-center gap-3"><Icon className="w-5 h-5 text-cyan-500" /><div><div className="font-medium">{title}</div><div className="text-xs text-white/50">{description}</div></div></div>
      <button onClick={() => onChange(!value)} className={`w-12 h-6 rounded-full transition-all ${value ? 'bg-cyan-500' : 'bg-white/20'}`}>
        <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform ${value ? 'translate-x-6' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function ProfileStatsSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-2 md:gap-3">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="p-3 rounded-2xl bg-white/5 border border-white/10 text-center"
        >
          <div className="w-8 h-8 mx-auto mb-2 rounded-lg bg-white/10 animate-pulse" />
          <div className="h-5 w-10 mx-auto bg-white/10 rounded animate-pulse mb-1" />
          <div className="h-2 w-12 mx-auto bg-white/10 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

// Wrap with AuthGuard for protected route
export default function ProfilePage() {
  return (
    <AuthGuard>
      <ProfilePageContent />
    </AuthGuard>
  );
}
