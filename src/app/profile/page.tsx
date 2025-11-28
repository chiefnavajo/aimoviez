'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  User, Trophy, Flame, Film, Settings as SettingsIcon,
  TrendingUp, Calendar, Award, Star, Lock, PlayCircle,
  CheckCircle, Clock, XCircle, Bell, Globe, LogOut
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import BottomNavigation from '@/components/BottomNavigation';

// ============================================================================
// PROFILE PAGE
// ============================================================================
// User stats, uploaded clips, voting history, and settings
// ============================================================================

interface UserStats {
  totalVotesCast: number;
  votesToday: number;
  votingStreak: number;
  rank: number;
  level: number;
  xp: number;
  nextLevelXp: number;
  badges: Badge[];
}

interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlockedAt: string;
}

interface UserClip {
  id: string;
  title: string;
  thumbnail_url: string;
  video_url: string;
  slot_position: number;
  status: 'pending' | 'approved' | 'voting' | 'locked' | 'rejected';
  vote_count: number;
  genre: string;
  created_at: string;
}

interface VotingHistory {
  clip_id: string;
  clip_title: string;
  thumbnail_url: string;
  voted_at: string;
  slot_position: number;
}

export default function ProfilePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'stats' | 'clips' | 'history' | 'settings'>('stats');
  const [voterKey, setVoterKey] = useState('');

  // Get voter key
  useEffect(() => {
    let key = localStorage.getItem('voter_key');
    if (!key) {
      key = `voter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('voter_key', key);
    }
    setVoterKey(key);
  }, []);

  // Fetch user stats
  const { data: stats, isLoading: statsLoading } = useQuery<UserStats>({
    queryKey: ['profile-stats', voterKey],
    queryFn: async () => {
      const response = await fetch(`/api/profile/stats?voterKey=${voterKey}`);
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
    enabled: !!voterKey,
  });

  // Fetch user clips
  const { data: userClips } = useQuery<UserClip[]>({
    queryKey: ['profile-clips', voterKey],
    queryFn: async () => {
      const response = await fetch(`/api/profile/clips?voterKey=${voterKey}`);
      if (!response.ok) throw new Error('Failed to fetch clips');
      return response.json();
    },
    enabled: !!voterKey,
  });

  // Fetch voting history
  const { data: votingHistory } = useQuery<VotingHistory[]>({
    queryKey: ['profile-history', voterKey],
    queryFn: async () => {
      const response = await fetch(`/api/profile/history?voterKey=${voterKey}`);
      if (!response.ok) throw new Error('Failed to fetch history');
      return response.json();
    },
    enabled: !!voterKey && activeTab === 'history',
  });

  // Settings
  const [settings, setSettings] = useState({
    notifications: true,
    language: 'en',
    theme: 'dark',
  });

  const saveSettings = useMutation({
    mutationFn: async (newSettings: typeof settings) => {
      localStorage.setItem('user_settings', JSON.stringify(newSettings));
      return newSettings;
    },
    onSuccess: (data) => {
      setSettings(data);
      alert('Settings saved!');
    },
  });

  const levelProgress = stats ? (stats.xp / stats.nextLevelXp) * 100 : 0;

  return (
    <div className="min-h-screen bg-black text-white pb-24">
      {/* Header with Profile Card */}
      <div className="relative">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-900/20 via-purple-900/20 to-pink-900/20" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black" />

        {/* Content */}
        <div className="relative z-10 max-w-4xl mx-auto px-4 pt-8 pb-6">
          {/* Avatar & Basic Info */}
          <div className="flex items-start gap-6 mb-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500 p-1">
                <div className="w-full h-full rounded-full bg-black flex items-center justify-center">
                  <User className="w-12 h-12 text-white" />
                </div>
              </div>
              {/* Level badge */}
              <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full flex items-center justify-center font-black border-4 border-black">
                {stats?.level || 1}
              </div>
            </div>

            <div className="flex-1">
              <h1 className="text-2xl font-black mb-1">
                {voterKey.substring(0, 12)}
              </h1>
              <div className="flex items-center gap-2 text-sm text-white/60 mb-3">
                <Trophy className="w-4 h-4" />
                <span>Rank #{stats?.rank?.toLocaleString() || 'â€”'}</span>
                <span>â€¢</span>
                <Flame className="w-4 h-4 text-orange-500" />
                <span>{stats?.votingStreak || 0} day streak</span>
              </div>

              {/* Level Progress */}
              <div className="mb-2">
                <div className="flex items-center justify-between text-xs text-white/60 mb-1">
                  <span>Level {stats?.level || 1}</span>
                  <span>{stats?.xp || 0} / {stats?.nextLevelXp || 100} XP</span>
                </div>
                <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-cyan-500 to-purple-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${levelProgress}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3">
            <StatBox
              icon={TrendingUp}
              label="Votes Today"
              value={stats?.votesToday.toString() || '0'}
              max="200"
            />
            <StatBox
              icon={Trophy}
              label="Total Votes"
              value={stats?.totalVotesCast.toLocaleString() || '0'}
            />
            <StatBox
              icon={Film}
              label="Clips Uploaded"
              value={userClips?.length.toString() || '0'}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/10 sticky top-0 z-20 bg-black/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto hide-scrollbar">
            {[
              { id: 'stats', label: 'Stats', icon: TrendingUp },
              { id: 'clips', label: 'My Clips', icon: Film },
              { id: 'history', label: 'History', icon: Calendar },
              { id: 'settings', label: 'Settings', icon: SettingsIcon },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-6 py-4 border-b-2 transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-cyan-500 text-white'
                    : 'border-transparent text-white/60 hover:text-white/80'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* STATS TAB */}
        {activeTab === 'stats' && (
          <div className="space-y-6">
            {/* Badges */}
            <div>
              <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                <Award className="w-5 h-5 text-yellow-500" />
                Badges ({stats?.badges?.length || 0})
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
                {stats?.badges && stats.badges.length > 0 ? (
                  stats.badges.map((badge) => (
                    <motion.div
                      key={badge.id}
                      whileHover={{ scale: 1.05 }}
                      className="aspect-square rounded-2xl bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border-2 border-yellow-500/30 p-4 flex flex-col items-center justify-center text-center"
                    >
                      <div className="text-3xl mb-2">{badge.icon}</div>
                      <div className="text-xs font-bold">{badge.name}</div>
                    </motion.div>
                  ))
                ) : (
                  <div className="col-span-full text-center py-8 text-white/60">
                    No badges yet. Keep voting to unlock achievements!
                  </div>
                )}
              </div>
            </div>

            {/* Stats Grid */}
            <div>
              <h2 className="text-lg font-bold mb-4">Detailed Stats</h2>
              <div className="grid grid-cols-2 gap-4">
                <DetailedStat label="Total Votes Cast" value={stats?.totalVotesCast.toLocaleString() || '0'} />
                <DetailedStat label="Votes Today" value={`${stats?.votesToday || 0} / 200`} />
                <DetailedStat label="Voting Streak" value={`${stats?.votingStreak || 0} days`} />
                <DetailedStat label="Global Rank" value={`#${stats?.rank?.toLocaleString() || 'â€”'}`} />
                <DetailedStat label="Level" value={stats?.level?.toString() || '1'} />
                <DetailedStat label="Total XP" value={stats?.xp?.toLocaleString() || '0'} />
              </div>
            </div>

            {/* Achievements Progress */}
            <div>
              <h2 className="text-lg font-bold mb-4">Next Achievements</h2>
              <div className="space-y-3">
                <AchievementProgress
                  title="First 100 Votes"
                  current={stats?.totalVotesCast || 0}
                  target={100}
                  reward="ðŸ† Bronze Voter Badge"
                />
                <AchievementProgress
                  title="7-Day Streak"
                  current={stats?.votingStreak || 0}
                  target={7}
                  reward="ðŸ”¥ Streak Master Badge"
                />
                <AchievementProgress
                  title="Upload 5 Clips"
                  current={userClips?.length || 0}
                  target={5}
                  reward="ðŸŽ¬ Creator Badge"
                />
              </div>
            </div>
          </div>
        )}

        {/* MY CLIPS TAB */}
        {activeTab === 'clips' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">My Clips ({userClips?.length || 0})</h2>
              <button
                onClick={() => router.push('/upload')}
                className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold"
              >
                + Upload New
              </button>
            </div>

            {!userClips || userClips.length === 0 ? (
              <div className="text-center py-12">
                <Film className="w-16 h-16 mx-auto mb-4 text-white/20" />
                <p className="text-white/60 mb-4">No clips uploaded yet</p>
                <button
                  onClick={() => router.push('/upload')}
                  className="px-6 py-3 bg-cyan-500 hover:bg-cyan-600 rounded-xl font-bold"
                >
                  Upload Your First Clip
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {userClips.map((clip) => (
                  <ClipCard key={clip.id} clip={clip} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* VOTING HISTORY TAB */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold">Voting History</h2>

            {!votingHistory || votingHistory.length === 0 ? (
              <div className="text-center py-12 text-white/60">
                <Calendar className="w-16 h-16 mx-auto mb-4 text-white/20" />
                <p>No voting history yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {votingHistory.map((item, idx) => (
                  <div
                    key={`${item.clip_id}-${idx}`}
                    className="flex items-center gap-4 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all"
                  >
                    <div className="w-16 h-24 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
                      <img 
                        src={item.thumbnail_url} 
                        alt={item.clip_title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1">
                      <div className="font-bold mb-1">{item.clip_title}</div>
                      <div className="text-sm text-white/60">
                        Slot #{item.slot_position} â€¢ {new Date(item.voted_at).toLocaleDateString()}
                      </div>
                    </div>
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <h2 className="text-lg font-bold">Settings</h2>

            {/* Notifications */}
            <div className="p-6 bg-white/5 rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-cyan-500" />
                  <div>
                    <div className="font-bold">Notifications</div>
                    <div className="text-sm text-white/60">Get updates about your clips</div>
                  </div>
                </div>
                <label className="relative inline-block w-12 h-6">
                  <input
                    type="checkbox"
                    checked={settings.notifications}
                    onChange={(e) => setSettings({ ...settings, notifications: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-full h-full bg-white/20 peer-checked:bg-cyan-500 rounded-full transition-all" />
                  <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-6" />
                </label>
              </div>
            </div>

            {/* Language */}
            <div className="p-6 bg-white/5 rounded-2xl">
              <div className="flex items-center gap-3 mb-3">
                <Globe className="w-5 h-5 text-cyan-500" />
                <div className="font-bold">Language</div>
              </div>
              <select
                value={settings.language}
                onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl"
              >
                <option value="en">English</option>
                <option value="es">EspaÃ±ol</option>
                <option value="fr">FranÃ§ais</option>
                <option value="de">Deutsch</option>
              </select>
            </div>

            {/* Save Button */}
            <button
              onClick={() => saveSettings.mutate(settings)}
              className="w-full px-6 py-4 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-xl font-bold"
            >
              Save Settings
            </button>

            {/* Danger Zone */}
            <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-2xl">
              <h3 className="font-bold text-red-500 mb-4">Danger Zone</h3>
              <button className="w-full px-6 py-3 bg-red-500 hover:bg-red-600 rounded-xl font-bold flex items-center justify-center gap-2">
                <LogOut className="w-5 h-5" />
                Clear All Data
              </button>
            </div>
          </div>
        )}
      </div>

      <BottomNavigation />
    </div>
  );
}

// Helper Components
function StatBox({ icon: Icon, label, value, max }: any) {
  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-4">
      <Icon className="w-5 h-5 text-cyan-500 mb-2" />
      <div className="text-2xl font-black">{value}</div>
      {max && <div className="text-xs text-white/40">/ {max}</div>}
      <div className="text-xs text-white/60 mt-1">{label}</div>
    </div>
  );
}

function DetailedStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 bg-white/5 rounded-xl">
      <div className="text-sm text-white/60 mb-1">{label}</div>
      <div className="text-xl font-black">{value}</div>
    </div>
  );
}

function AchievementProgress({ title, current, target, reward }: any) {
  const progress = Math.min((current / target) * 100, 100);
  const isComplete = current >= target;

  return (
    <div className="p-4 bg-white/5 rounded-xl">
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold">{title}</span>
        {isComplete && <CheckCircle className="w-5 h-5 text-green-500" />}
      </div>
      <div className="text-sm text-white/60 mb-2">{reward}</div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-purple-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-white/60 w-16 text-right">
          {current}/{target}
        </span>
      </div>
    </div>
  );
}

function ClipCard({ clip }: { clip: UserClip }) {
  const statusConfig = {
    pending: { icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Pending' },
    approved: { icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-500/10', label: 'Approved' },
    voting: { icon: PlayCircle, color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Voting' },
    locked: { icon: Lock, color: 'text-cyan-500', bg: 'bg-cyan-500/10', label: 'Locked In' },
    rejected: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10', label: 'Rejected' },
  };

  const config = statusConfig[clip.status];
  const StatusIcon = config.icon;

  return (
    <div className="flex gap-4 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
      <div className="w-24 h-36 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
        <img src={clip.thumbnail_url} alt={clip.title} className="w-full h-full object-cover" />
      </div>
      <div className="flex-1">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="font-bold mb-1">{clip.title}</h3>
            <div className="text-sm text-white/60">
              Slot #{clip.slot_position} â€¢ {clip.genre}
            </div>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${config.bg}`}>
            <StatusIcon className={`w-4 h-4 ${config.color}`} />
            <span className={`text-sm font-bold ${config.color}`}>{config.label}</span>
          </div>
        </div>
        {clip.status === 'voting' || clip.status === 'locked' ? (
          <div className="flex items-center gap-2 text-sm">
            <Trophy className="w-4 h-4 text-yellow-500" />
            <span className="font-bold">{clip.vote_count.toLocaleString()} votes</span>
          </div>
        ) : null}
        <div className="text-xs text-white/40 mt-2">
          Uploaded {new Date(clip.created_at).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}
