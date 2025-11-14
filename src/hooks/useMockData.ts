// Mock data provider with simple local state

import { useState, useEffect, useCallback } from 'react';
import { 
  Clip, 
  Leader, 
  Round, 
  TimelineSegment, 
  HypeStats, 
  UploadPayload,
  UserProfile,
  Genre 
} from '@/types';

// Generate mock data
function generateMockData() {
  const now = new Date();
  const closesAt = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours from now

  const round: Round = {
    id: 'round-12',
    segmentNumber: 12,
    totalSegments: 75,
    genre: 'thriller',
    opensAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    closesAt,
    status: 'open'
  };

  const clips: Clip[] = [
    {
      id: 'clip-1',
      title: 'Midnight Chase',
      user: { id: 'u1', name: 'Alex Chen', avatar: 'https://i.pravatar.cc/150?img=1' },
      genre: 'thriller',
      votes: 1247,
      previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?w=400&h=711&fit=crop',
      duration: 8,
      aspect: '9:16',
      uploadedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000)
    },
    {
      id: 'clip-2',
      title: 'Comedy Gold',
      user: { id: 'u2', name: 'Sarah Kim', avatar: 'https://i.pravatar.cc/150?img=5' },
      genre: 'comedy',
      votes: 892,
      previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=400&h=711&fit=crop',
      duration: 8,
      aspect: '9:16',
      uploadedAt: new Date(now.getTime() - 2.5 * 60 * 60 * 1000)
    },
    {
      id: 'clip-3',
      title: 'Explosion Scene',
      user: { id: 'u3', name: 'Marcus Rey', avatar: 'https://i.pravatar.cc/150?img=12' },
      genre: 'action',
      votes: 2103,
      previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=400&h=711&fit=crop',
      duration: 8,
      aspect: '9:16',
      uploadedAt: new Date(now.getTime() - 3.2 * 60 * 60 * 1000)
    },
    {
      id: 'clip-4',
      title: 'Anime Vibes',
      user: { id: 'u4', name: 'Yuki Tanaka', avatar: 'https://i.pravatar.cc/150?img=20' },
      genre: 'animation',
      votes: 1567,
      previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&h=711&fit=crop',
      duration: 8,
      aspect: '9:16',
      uploadedAt: new Date(now.getTime() - 2.8 * 60 * 60 * 1000)
    },
    {
      id: 'clip-5',
      title: 'Dark Alley',
      user: { id: 'u5', name: 'Luna Park', avatar: 'https://i.pravatar.cc/150?img=9' },
      genre: 'thriller',
      votes: 1834,
      previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1518676590629-3dcbd9c5a5c9?w=400&h=711&fit=crop',
      duration: 8,
      aspect: '9:16',
      uploadedAt: new Date(now.getTime() - 1.5 * 60 * 60 * 1000)
    },
    {
      id: 'clip-6',
      title: 'Dance Break',
      user: { id: 'u6', name: 'Rio Santos', avatar: 'https://i.pravatar.cc/150?img=33' },
      genre: 'comedy',
      votes: 945,
      previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
      thumbnailUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=400&h=711&fit=crop',
      duration: 8,
      aspect: '9:16',
      uploadedAt: new Date(now.getTime() - 1.8 * 60 * 60 * 1000)
    }
  ];

  const leaders: Leader[] = [
    { id: 'u3', user: { id: 'u3', name: 'Marcus Rey', avatar: 'https://i.pravatar.cc/150?img=12' }, votesTotal: 24567, rank: 1, badges: ['🔥 Trending', '💥 Action Master'], xp: 12450 },
    { id: 'u5', user: { id: 'u5', name: 'Luna Park', avatar: 'https://i.pravatar.cc/150?img=9' }, votesTotal: 21034, rank: 2, badges: ['😱 Thriller Queen'], xp: 11200 },
    { id: 'u4', user: { id: 'u4', name: 'Yuki Tanaka', avatar: 'https://i.pravatar.cc/150?img=20' }, votesTotal: 18923, rank: 3, badges: ['🎨 Animation Pro'], xp: 10100 },
    { id: 'u1', user: { id: 'u1', name: 'Alex Chen', avatar: 'https://i.pravatar.cc/150?img=1' }, votesTotal: 16789, rank: 4, badges: ['🎬 Director'], xp: 8900 },
    { id: 'u2', user: { id: 'u2', name: 'Sarah Kim', avatar: 'https://i.pravatar.cc/150?img=5' }, votesTotal: 15234, rank: 5, badges: ['🎭 Comedy Star'], xp: 8200 }
  ];

  const timeline: TimelineSegment[] = Array.from({ length: 75 }, (_, i) => {
    const segment = i + 1;
    if (segment < 12) {
      return {
        segment,
        status: 'done' as const,
        thumbUrl: `https://images.unsplash.com/photo-${1500000000000 + segment}?w=80&h=142&fit=crop`,
        genre: (['comedy', 'thriller', 'action', 'animation'] as Genre[])[segment % 4]
      };
    } else if (segment === 12) {
      return { segment, status: 'open' as const };
    } else {
      return { segment, status: 'upcoming' as const };
    }
  });

  const hypeStats: HypeStats = {
    liveUsers: 1284,
    totalVotesToday: 45623,
    clipsSubmitted: 89
  };

  const userProfile: UserProfile = {
    id: 'current-user',
    name: 'Demo Creator',
    avatar: 'https://i.pravatar.cc/150?img=68',
    xp: 2450,
    totalVotes: 3421,
    clipsSubmitted: 12,
    badges: ['🎬 Rising Star', '🔥 Consistent'],
    hasUploadedThisRound: false
  };

  return { round, clips, leaders, timeline, hypeStats, userProfile };
}

export function useMockData() {
  const [data, setData] = useState(() => generateMockData());
  const [liveUsers, setLiveUsers] = useState(data.hypeStats.liveUsers);

  // Simulate live user count jitter
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveUsers(prev => {
        const change = Math.floor(Math.random() * 20) - 10;
        return Math.max(1000, Math.min(2000, prev + change));
      });
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  /**
   * Vote for a clip (optimistic update)
   */
  const vote = useCallback((clipId: string) => {
    setData(prev => ({
      ...prev,
      clips: prev.clips.map(clip =>
        clip.id === clipId
          ? { ...clip, votes: clip.votes + 1 }
          : clip
      )
    }));
  }, []);

  /**
   * Upload a clip (mock)
   */
  const uploadClip = useCallback((payload: UploadPayload) => {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const newClip: Clip = {
          id: `clip-${Date.now()}`,
          title: payload.title,
          user: data.userProfile,
          genre: payload.genre,
          votes: 0,
          previewUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          thumbnailUrl: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=400&h=711&fit=crop',
          duration: 8,
          aspect: '9:16',
          uploadedAt: new Date()
        };

        setData(prev => ({
          ...prev,
          clips: [...prev.clips, newClip],
          userProfile: {
            ...prev.userProfile,
            hasUploadedThisRound: true,
            clipsSubmitted: prev.userProfile.clipsSubmitted + 1
          }
        }));

        resolve();
      }, 2000);
    });
  }, [data.userProfile]);

  /**
   * Refresh all data
   */
  const refresh = useCallback(() => {
    setData(generateMockData());
  }, []);

  return {
    round: data.round,
    clips: data.clips,
    leaders: data.leaders,
    timeline: data.timeline,
    hypeStats: { ...data.hypeStats, liveUsers },
    userProfile: data.userProfile,
    vote,
    uploadClip,
    refresh
  };
}
