// Core type definitions for AiMoviez | 8SEC MADNESS

export const GENRES = ['thriller', 'comedy', 'action', 'sci-fi', 'romance', 'animation', 'horror', 'drama'] as const;
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
// VOTING SYSTEM TYPES
// =========================

export interface RemainingVotes {
  standard: number;  // Daily limit remaining (out of 200)
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
  genre: 'THRILLER' | 'COMEDY' | 'ACTION' | 'SCI-FI' | 'ROMANCE' | 'ANIMATION' | 'HORROR' | 'DRAMA';
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
  newScore: number;
  totalVotesToday?: number;
  remainingVotes?: RemainingVotes;
  error?: string;
  code?: 'ALREADY_VOTED' | 'DAILY_LIMIT';
}

// =========================
// API CACHE TYPES
// =========================

export interface CacheEntry<T> {
  data: T;
  expires: number;
}

// =========================
// DATABASE TYPES (Supabase)
// =========================

export interface DbSeason {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
}

export interface DbSlot {
  id: string;
  season_id: string;
  slot_position: number;
  genre: string;
  status: 'upcoming' | 'voting' | 'locked' | 'archived' | 'waiting_for_clips';
  voting_starts_at: string | null;
  voting_ends_at: string | null;
  winner_clip_id: string | null;
  created_at: string;
}

export interface DbClip {
  id: string;
  user_id: string;
  slot_id: string;
  video_url: string;
  thumbnail_url: string;
  duration: number;
  status: 'pending' | 'active' | 'locked' | 'eliminated' | 'rejected';
  vote_count: number;
  weighted_score: number;
  is_pinned?: boolean;
  eliminated_at?: string | null;
  elimination_reason?: string | null;
  video_deleted_at?: string | null;
  created_at: string;
}

export interface DbUser {
  id: string;
  username: string;
  avatar_url: string | null;
  xp: number;
  badge_level: string | null;
  created_at: string;
}

export interface DbNotification {
  id: string;
  user_key: string;
  type: string;
  title: string;
  message: string;
  action_url: string | null;
  metadata: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

// =========================
// LEADERBOARD TYPES
// =========================

export interface LeaderboardCreator {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  badgeLevel: string | null;
  totalClips: number;
  totalVotes: number;
  avgVotesPerClip: number;
  topClipVotes: number;
  winCount: number;
}

export interface LeaderboardVoter {
  rank: number;
  oddsOfWinning: number;
  username: string;
  avatarUrl: string | null;
  badgeLevel: string | null;
  totalVotes: number;
  clipsVotedOn: number;
  streak: number;
}

export interface LeaderboardClip {
  rank: number;
  clipId: string;
  thumbnailUrl: string;
  videoUrl: string;
  voteCount: number;
  weightedScore: number;
  creator: {
    userId: string;
    username: string;
    avatarUrl: string | null;
    badgeLevel: string | null;
  };
  slotPosition: number;
  genre: string;
}

// =========================
// AI VIDEO GENERATION TYPES
// =========================

export type AIModel = 'kling-2.6' | 'veo3-fast' | 'hailuo-2.3' | 'sora-2';
export type AIStyle = 'cinematic' | 'anime' | 'realistic' | 'abstract' | 'noir' | 'retro' | 'neon';
export type AIGenerationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired';
export type AIStage = 'queued' | 'generating' | 'ready' | 'failed';

export interface AIGeneration {
  id: string;
  user_id: string;
  status: AIGenerationStatus;
  stage: AIStage;
  prompt: string;
  model: AIModel;
  style?: AIStyle;
  genre?: string;
  video_url?: string;
  clip_id?: string;
  error_message?: string;
  created_at: string;
  completed_at?: string;
}

export interface AIVideoConfig {
  default_model: AIModel;
  max_daily_free: number;
  available_models: AIModel[];
  max_prompt_length: number;
  daily_cost_limit_cents: number;
  monthly_cost_limit_cents: number;
  keyword_blocklist: string[];
  style_prompt_prefixes: Record<string, string>;
}

// =========================
// DREAM TEAMS TYPES
// =========================

export type TeamRole = 'leader' | 'officer' | 'member';

export interface TeamMember {
  id: string;
  role: TeamRole;
  contribution_xp: number;
  contribution_votes: number;
  last_active_date: string | null;
  joined_at: string;
  user: {
    id: string;
    username: string;
    avatar_url: string | null;
    level: number;
    xp: number;
  };
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  leader_id: string;
  level: number;
  total_xp: number;
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface TeamWithStats extends Team {
  combined_votes: number;
  combined_wins: number;
  rank?: number;
  members?: TeamMember[];
  leader_username?: string;
  leader_avatar_url?: string | null;
}

export interface TeamInvite {
  id: string;
  code: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  created_at: string;
  created_by: string;
  share_link?: string;
}

export interface TeamMessage {
  id: string;
  message: string;
  created_at: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
}

export interface TeamLeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  logo_url: string | null;
  level: number;
  total_xp: number;
  current_streak: number;
  member_count: number;
  combined_votes: number;
  combined_wins: number;
  leader_username: string;
}
