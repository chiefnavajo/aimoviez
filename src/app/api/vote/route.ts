import { NextResponse } from 'next/server';

type Genre = 'COMEDY' | 'THRILLER' | 'ACTION' | 'ANIMATION';

interface Clip {
  id: string;
  clip_id: string;
  user_id: string;
  thumbnail_url: string;
  video_url?: string;
  vote_count: number;
  weighted_score: number;
  rank_in_track: number;
  user: {
    username: string;
    avatar_url: string;
    badge_level?: string;
  };
  genre: Genre;
  duration: number;
  round_number: number;
  total_rounds: number;
  segment_index: number;
  hype_score: number;
  is_featured?: boolean;
  is_creator_followed?: boolean;
}

type VoteType = 'standard' | 'super' | 'mega';

interface VotingState {
  clips: Clip[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: {
    standard: number;
    super: number;
    mega: number;
  };
  streak: number;
}

// PROSTE MOCK DANE – tylko do localhost
const mockClips: Clip[] = [
  {
    id: '1',
    clip_id: 'clip1',
    user_id: 'user1',
    thumbnail_url: 'https://images.pexels.com/photos/6898859/pexels-photo-6898859.jpeg',
    video_url: 'https://videos.pexels.com/video-files/6898859/6898859-uhd_2560_1440_24fps.mp4',
    vote_count: 12,
    weighted_score: 15,
    rank_in_track: 1,
    user: {
      username: 'neon_creator',
      avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=neon',
      badge_level: 'PRO',
    },
    genre: 'COMEDY',
    duration: 8,
    round_number: 1,
    total_rounds: 10,
    segment_index: 0,
    hype_score: 120,
    is_featured: true,
    is_creator_followed: true,
  },
  {
    id: '2',
    clip_id: 'clip2',
    user_id: 'user2',
    thumbnail_url: 'https://images.pexels.com/photos/6898850/pexels-photo-6898850.jpeg',
    video_url: 'https://videos.pexels.com/video-files/6898850/6898850-uhd_2560_1440_24fps.mp4',
    vote_count: 8,
    weighted_score: 9,
    rank_in_track: 2,
    user: {
      username: 'thrillseeker',
      avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=thrill',
      badge_level: 'STUDIO',
    },
    genre: 'THRILLER',
    duration: 8,
    round_number: 1,
    total_rounds: 10,
    segment_index: 1,
    hype_score: 95,
  },
  {
    id: '3',
    clip_id: 'clip3',
    user_id: 'user3',
    thumbnail_url: 'https://images.pexels.com/photos/6898852/pexels-photo-6898852.jpeg',
    video_url: 'https://videos.pexels.com/video-files/6898852/6898852-uhd_2560_1440_24fps.mp4',
    vote_count: 5,
    weighted_score: 6,
    rank_in_track: 3,
    user: {
      username: 'action_master',
      avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=action',
    },
    genre: 'ACTION',
    duration: 8,
    round_number: 1,
    total_rounds: 10,
    segment_index: 2,
    hype_score: 70,
  },
];

let votingState: VotingState = {
  clips: mockClips,
  totalVotesToday: 0,
  userRank: 128,
  remainingVotes: {
    standard: 100,
    super: 10,
    mega: 3,
  },
  streak: 1,
};

// GET /api/vote?trackId=track-main
export async function GET(request: Request) {
  // możesz wyciągnąć trackId, ale na razie go ignorujemy
  // const { searchParams } = new URL(request.url);
  // const trackId = searchParams.get('trackId');

  return NextResponse.json(votingState);
}

// POST /api/vote
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    clipId?: string;
    voteType?: VoteType;
  } | null;

  if (!body?.clipId) {
    return NextResponse.json(
      { success: false, message: 'Missing clipId' },
      { status: 400 },
    );
  }

  const voteType: VoteType = body.voteType ?? 'standard';
  const multiplier =
    voteType === 'mega' ? 10 : voteType === 'super' ? 5 : 1;

  const clipIndex = votingState.clips.findIndex(
    (c) => c.clip_id === body.clipId,
  );

  if (clipIndex === -1) {
    return NextResponse.json(
      { success: false, message: 'Clip not found' },
      { status: 404 },
    );
  }

  // Prosta logika głosowania w pamięci
  const clip = votingState.clips[clipIndex];
  const newVoteCount = clip.vote_count + 1;
  const newHype = clip.hype_score + 5 * multiplier;

  votingState = {
    ...votingState,
    clips: votingState.clips.map((c, i) =>
      i === clipIndex
        ? {
            ...c,
            vote_count: newVoteCount,
            hype_score: newHype,
          }
        : c,
    ),
    totalVotesToday: votingState.totalVotesToday + 1,
  };

  return NextResponse.json({
    success: true,
    voteType,
    clipId: body.clipId,
    newScore: newHype,
  });
}
