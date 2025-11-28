'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { 
  User, Trophy, Flame, Film, Settings as SettingsIcon,
  TrendingUp, Calendar, Award, Lock, PlayCircle,
  CheckCircle, Clock, Bell, LogOut, Heart,
  ChevronRight, BookOpen, Plus
} from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';

// ============================================================================
// TYPES & MOCK DATA
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
  slot_position: number;
  status: 'pending' | 'approved' | 'voting' | 'locked' | 'rejected';
  vote_count: number;
  genre: string;
  season_number: number;
  created_at: string;
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

const MOCK_STATS: UserStats = {
  totalVotesCast: 1247,
  votesToday: 42,
  votingStreak: 5,
  rank: 156,
  level: 7,
  xp: 1247,
  nextLevelXp: 2000,
  clipsUploaded: 3,
  clipsLocked: 1,
};

const MOCK_CLIPS: UserClip[] = [
  { id: 'my-clip-1', video_url: 'https://dxixqdmqomqzhilmdfzg.supabase.co/storage/v1/object/public/videos/spooky-ghost.mp4', slot_position: 3, status: 'locked', vote_count: 2341, genre: 'Horror', season_number: 1, created_at: '2024-11-15T10:00:00Z' },
  { id: 'my-clip-2', video_url: 'https://dxixqdmqomqzhilmdfzg.supabase.co/storage/v1/object/public/videos/ballet-dancer.mp4', slot_position: 6, status: 'voting', vote_count: 892, genre: 'Comedy', season_number: 2, created_at: '2024-11-25T14:30:00Z' },
];

const MOCK_HISTORY: VotingHistoryItem[] = [
  { clip_id: 'hist-1', creator_username: 'veo3_creator', creator_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=veo3', voted_at: '2024-11-28T10:30:00Z', slot_position: 5 },
  { clip_id: 'hist-2', creator_username: 'dance_master', creator_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ballet', voted_at: '2024-11-28T09:15:00Z', slot_position: 5 },
  { clip_id: 'hist-3', creator_username: 'film_wizard', creator_avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=wizard', voted_at: '2024-11-27T18:45:00Z', slot_position: 4 },
];

const MOCK_BADGES: Badge[] = [
  { id: 'first-vote', name: 'First Vote', icon: '🎬', description: 'Cast your first vote', unlocked: true },
  { id: 'streak-7', name: '7 Day Streak', icon: '🔥', description: 'Vote 7 days in a row', unlocked: false, progress: 5, target: 7 },
  { id: 'daily-goal', name: 'Daily Goal', icon: '🎯', description: 'Cast 200 votes in one day', unlocked: false, progress: 42, target: 200 },
  { id: 'creator', name: 'Creator', icon: '🎥', description: 'Upload your first clip', unlocked: true },
  { id: 'winner', name: 'Winner', icon: '🏆', description: 'Win a slot', unlocked: true },
  { id: 'top-100', name: 'Top 100', icon: '⭐', description: 'Reach top 100', unlocked: false },
];

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ProfilePage() {
  const [activeTab, setActiveTab] = useState<'stats' | 'clips' | 'history' | 'settings'>('stats');
  const [stats] = useState<UserStats>(MOCK_STATS);
  const [clips] = useState<UserClip[]>(MOCK_CLIPS);
  const [history] = useState<VotingHistoryItem[]>(MOCK_HISTORY);
  const [badges] = useState<Badge[]>(MOCK_BADGES);
  const [username, setUsername] = useState('');
  const [avatarSeed, setAvatarSeed] = useState('');
  const [settings, setSettings] = useState({ notifications: true, autoplay: true });

  useEffect(() => {
    let storedUsername = localStorage.getItem('aimoviez_username');
    let storedSeed = localStorage.getItem('aimoviez_avatar_seed');
    if (!storedUsername) {
      storedUsername = `User${Math.random().toString(36).substring(2, 8)}`;
      localStorage.setItem('aimoviez_username', storedUsername);
    }
    if (!storedSeed) {
      storedSeed = Math.random().toString(36).substring(2, 10);
      localStorage.setItem('aimoviez_avatar_seed', storedSeed);
    }
    setUsername(storedUsername);
    setAvatarSeed(storedSeed);
  }, []);

  const levelProgress = (stats.xp / stats.nextLevelXp) * 100;

  // Shared tab content
  const renderTabContent = () => (
    <>
      {activeTab === 'stats' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Award className="w-5 h-5 text-yellow-500" />
              Badges
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {badges.map((badge) => (
                <div key={badge.id} className={`flex flex-col items-center p-3 rounded-xl ${badge.unlocked ? 'bg-white/10' : 'bg-white/5 opacity-50'}`}>
                  <span className="text-2xl mb-1">{badge.icon}</span>
                  <span className="text-[10px] font-medium text-center">{badge.name}</span>
                  {!badge.unlocked && badge.progress !== undefined && (
                    <span className="text-[9px] text-white/50 mt-1">{badge.progress}/{badge.target}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="text-lg font-bold mb-4">In Progress</h2>
            <div className="space-y-3">
              {badges.filter(b => !b.unlocked && b.progress !== undefined).map((badge) => (
                <div key={badge.id} className="p-4 bg-white/5 rounded-xl">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xl">{badge.icon}</span>
                    <div className="flex-1">
                      <div className="font-bold">{badge.name}</div>
                      <div className="text-xs text-white/50">{badge.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500" style={{ width: `${(badge.progress! / badge.target!) * 100}%` }} />
                    </div>
                    <span className="text-xs text-white/60">{badge.progress}/{badge.target}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
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
              <Film className="w-16 h-16 mx-auto mb-4 text-white/20" />
              <p className="text-white/60 mb-4">No clips uploaded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {clips.map((clip) => <ClipCard key={clip.id} clip={clip} />)}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold">Recent Votes</h2>
          {history.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-16 h-16 mx-auto mb-4 text-white/20" />
              <p className="text-white/60">No voting history yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item, idx) => (
                <Link key={`${item.clip_id}-${idx}`} href={`/profile/${item.creator_username}`}>
                  <motion.div whileTap={{ scale: 0.98 }} className="flex items-center gap-4 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
                    <img src={item.creator_avatar} alt={item.creator_username} className="w-12 h-12 rounded-full bg-white/10" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold truncate">@{item.creator_username}</div>
                      <div className="text-sm text-white/60">Slot #{item.slot_position} • {new Date(item.voted_at).toLocaleDateString()}</div>
                    </div>
                    <Heart className="w-4 h-4 text-pink-500" fill="#ec4899" />
                    <ChevronRight className="w-5 h-5 text-white/40" />
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
            <Link href="/story"><div className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition"><div className="flex items-center gap-3"><BookOpen className="w-5 h-5 text-cyan-500" /><span>Watch Story</span></div><ChevronRight className="w-5 h-5 text-white/40" /></div></Link>
            <Link href="/leaderboard"><div className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition"><div className="flex items-center gap-3"><Trophy className="w-5 h-5 text-yellow-500" /><span>Leaderboard</span></div><ChevronRight className="w-5 h-5 text-white/40" /></div></Link>
          </div>
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <h3 className="font-bold text-red-500 mb-3">Danger Zone</h3>
            <button onClick={() => { if (confirm('Clear all local data?')) { localStorage.clear(); window.location.reload(); } }} className="w-full px-4 py-3 bg-red-500 hover:bg-red-600 rounded-lg font-bold flex items-center justify-center gap-2">
              <LogOut className="w-5 h-5" />
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
            <Link href="/upload"><div className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-white/5 text-white/70 transition"><Plus className="w-6 h-6" /><span>Upload</span></div></Link>
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
                  <div className="w-28 h-28 rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 p-1">
                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}`} alt="Avatar" className="w-full h-full rounded-full bg-black" />
                  </div>
                  <div className="absolute -bottom-2 -right-2 w-12 h-12 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full flex items-center justify-center font-black text-lg border-4 border-black">{stats.level}</div>
                </div>
                <div className="flex-1 pt-2">
                  <h1 className="text-3xl font-black mb-2">@{username}</h1>
                  <div className="flex items-center gap-4 text-sm text-white/60 mb-4">
                    <div className="flex items-center gap-1"><Trophy className="w-4 h-4 text-yellow-500" /><span>Rank #{stats.rank}</span></div>
                    <div className="flex items-center gap-1"><Flame className="w-4 h-4 text-orange-500" /><span>{stats.votingStreak} day streak</span></div>
                  </div>
                  <div className="max-w-md">
                    <div className="flex items-center justify-between text-xs text-white/60 mb-1"><span>Level {stats.level}</span><span>{stats.xp} / {stats.nextLevelXp} XP</span></div>
                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                      <motion.div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500" initial={{ width: 0 }} animate={{ width: `${levelProgress}%` }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <StatBox icon={Heart} label="Today" value={stats.votesToday} subValue="/200" />
                <StatBox icon={TrendingUp} label="Total" value={formatNumber(stats.totalVotesCast)} />
                <StatBox icon={Film} label="Clips" value={stats.clipsUploaded} />
                <StatBox icon={Trophy} label="Wins" value={stats.clipsLocked} />
              </div>
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
          <div className="relative z-10 px-4 pt-12 pb-6">
            <div className="flex items-start gap-5 mb-6">
              <div className="relative flex-shrink-0">
                <div className="w-20 h-20 rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 p-1">
                  <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarSeed}`} alt="Avatar" className="w-full h-full rounded-full bg-black" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full flex items-center justify-center font-black text-sm border-4 border-black">{stats.level}</div>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-black mb-1 truncate">@{username}</h1>
                <div className="flex items-center gap-3 text-sm text-white/60 mb-3 flex-wrap">
                  <div className="flex items-center gap-1"><Trophy className="w-4 h-4 text-yellow-500" /><span>#{stats.rank}</span></div>
                  <div className="flex items-center gap-1"><Flame className="w-4 h-4 text-orange-500" /><span>{stats.votingStreak} day streak</span></div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs text-white/60 mb-1"><span>Level {stats.level}</span><span>{stats.xp} / {stats.nextLevelXp} XP</span></div>
                  <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                    <motion.div className="h-full bg-gradient-to-r from-cyan-500 to-purple-500" initial={{ width: 0 }} animate={{ width: `${levelProgress}%` }} />
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <StatBox icon={Heart} label="Today" value={stats.votesToday} subValue="/200" />
              <StatBox icon={TrendingUp} label="Total" value={formatNumber(stats.totalVotesCast)} />
              <StatBox icon={Film} label="Clips" value={stats.clipsUploaded} />
              <StatBox icon={Trophy} label="Wins" value={stats.clipsLocked} />
            </div>
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

function StatBox({ icon: Icon, label, value, subValue }: { icon: any; label: string; value: number | string; subValue?: string }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-center">
      <Icon className="w-4 h-4 text-cyan-500 mx-auto mb-1" />
      <div className="text-lg font-black">{value}{subValue && <span className="text-xs text-white/40">{subValue}</span>}</div>
      <div className="text-[10px] text-white/60">{label}</div>
    </div>
  );
}

function ClipCard({ clip }: { clip: UserClip }) {
  const statusConfig = {
    pending: { color: 'text-yellow-500', bg: 'bg-yellow-500/20', label: 'Pending' },
    approved: { color: 'text-green-500', bg: 'bg-green-500/20', label: 'Approved' },
    voting: { color: 'text-orange-500', bg: 'bg-orange-500/20', label: 'LIVE' },
    locked: { color: 'text-cyan-500', bg: 'bg-cyan-500/20', label: 'Winner' },
    rejected: { color: 'text-red-500', bg: 'bg-red-500/20', label: 'Rejected' },
  };
  const config = statusConfig[clip.status];
  return (
    <div className="flex gap-4 p-4 bg-white/5 rounded-xl">
      <div className="w-20 h-28 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
        <video src={clip.video_url} className="w-full h-full object-cover" muted preload="metadata" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="text-sm text-white/60 truncate">Season {clip.season_number} • Slot #{clip.slot_position}</div>
            <div className="font-bold">{clip.genre}</div>
          </div>
          <div className={`flex-shrink-0 px-2 py-1 rounded-full text-xs font-bold ${config.bg} ${config.color}`}>{config.label}</div>
        </div>
        <div className="flex items-center gap-2 text-sm"><Heart className="w-4 h-4 text-pink-500" fill="#ec4899" /><span className="font-bold">{formatNumber(clip.vote_count)} votes</span></div>
        <div className="text-xs text-white/40 mt-1">{new Date(clip.created_at).toLocaleDateString()}</div>
      </div>
    </div>
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
