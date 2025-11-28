// Core type definitions for AiMoviez | 8SEC MADNESS

export const GENRES = ['comedy', 'thriller', 'action', 'animation'] as const;
export type Genre = typeof GENRES[number];

export interface UserMini {
  id: string;
  name: string;
  avatar: string;
}

export interface Clip {
  id: string;
  title: string;
  user: UserMini;
  genre: Genre;
  votes: number;
  previewUrl: string;
  thumbnailUrl: string;
  duration: number; // seconds
  aspect: '9:16';
  uploadedAt: Date;
}

export interface Leader {
  id: string;
  user: UserMini;
  votesTotal: number;
  rank: number;
  badges: string[];
  xp: number;
}

export interface TimelineSegment {
  segment: number;
  status: 'done' | 'open' | 'upcoming';
  thumbUrl?: string;
  genre?: Genre;
  winnerClipId?: string;
}

export interface Round {
  id: string;
  segmentNumber: number;
  totalSegments: number;
  genre: Genre;
  opensAt: Date;
  closesAt: Date;
  status: 'open' | 'closed' | 'upcoming';
}

export interface HypeStats {
  liveUsers: number;
  totalVotesToday: number;
  clipsSubmitted: number;
}

export interface UploadPayload {
  file: File;
  title: string;
  genre: Genre;
}

export interface UserProfile {
  id: string;
  name: string;
  avatar: string;
  xp: number;
  totalVotes: number;
  clipsSubmitted: number;
  badges: string[];
  hasUploadedThisRound: boolean;
}

// =========================
// HYBRID VOTING SYSTEM TYPES
// =========================

export type VoteType = 'standard' | 'super' | 'mega';

export interface RemainingVotes {
  standard: number;  // Daily limit remaining (out of 200)
  super: number;     // Per-round super votes remaining (1 per round)
  mega: number;      // Per-round mega votes remaining (1 per round)
}

export interface VotingClip {
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
  genre: 'COMEDY' | 'THRILLER' | 'ACTION' | 'ANIMATION';
  duration: number;
  round_number: number;
  total_rounds: number;
  segment_index: number;
  hype_score: number;
  is_featured?: boolean;
  is_creator_followed?: boolean;
  has_voted?: boolean;  // True if user already voted on this clip
}

export interface VotingState {
  clips: VotingClip[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: RemainingVotes;
  votedClipIds: string[];  // Clips user has voted on in current slot
  currentSlot: number;     // Current slot position (1-75)
  totalSlots: number;      // Total slots in movie (75)
  streak: number;
}

export interface VoteResponse {
  success: boolean;
  clipId: string;
  voteType: VoteType;
  newScore: number;
  totalVotesToday?: number;
  remainingVotes?: RemainingVotes;
  error?: string;
  code?: 'ALREADY_VOTED' | 'DAILY_LIMIT' | 'SUPER_LIMIT' | 'MEGA_LIMIT';
}
