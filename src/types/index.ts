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
