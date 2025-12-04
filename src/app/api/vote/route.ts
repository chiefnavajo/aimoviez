// app/api/vote/route.ts
// AiMoviez · 8SEC MADNESS
// HYBRID VOTING SYSTEM:
//   - 1 vote per clip per user (no multi-voting on same clip)
//   - Can vote on multiple clips in same round  
//   - Daily limit: 200 votes
//   - Super vote (3x): 1 per round
//   - Mega vote (10x): 1 per round

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import _crypto from 'crypto';
import { VoteRequestSchema, parseBody } from '@/lib/validations';
import { rateLimit } from '@/lib/rate-limit';
import {
  generateDeviceKey,
  extractDeviceSignals,
  assessDeviceRisk,
  shouldFlagVote,
} from '@/lib/device-fingerprint';
import { createRequestLogger, logAudit } from '@/lib/logger';
import { verifyCaptcha, getClientIp } from '@/lib/captcha';
import { broadcastVoteUpdate } from '@/lib/pusher-server';

const CLIP_POOL_SIZE = 30;
const CLIPS_PER_SESSION = 8;  // Show 8 random clips per request
const DAILY_VOTE_LIMIT = 200;
const SUPER_VOTES_PER_SLOT = 1;
const MEGA_VOTES_PER_SLOT = 1;
const FRESH_CLIP_HOURS = 2;   // Clips < 2 hours old get boost

// =========================
// In-memory cache for frequently accessed data
// =========================
interface CacheEntry<T> {
  data: T;
  expires: number;
}

const cache = {
  activeSeason: null as CacheEntry<any> | null,
  activeSlot: null as CacheEntry<any> | null,
  clips: new Map<string, CacheEntry<any>>(),
};

const CACHE_TTL = {
  season: 60 * 1000,      // 1 minute for season
  slot: 30 * 1000,        // 30 seconds for active slot
  clips: 15 * 1000,       // 15 seconds for clips
};

function getCached<T>(key: 'activeSeason' | 'activeSlot', fallback?: T): T | null {
  const entry = cache[key];
  if (entry && Date.now() < entry.expires) {
    return entry.data as T;
  }
  return fallback || null;
}

function setCache(key: 'activeSeason' | 'activeSlot', data: any, ttl: number) {
  cache[key] = { data, expires: Date.now() + ttl };
}

function _getCachedClips(slotPosition: number): any[] | null {
  const key = `slot_${slotPosition}`;
  const entry = cache.clips.get(key);
  if (entry && Date.now() < entry.expires) {
    return entry.data;
  }
  cache.clips.delete(key);
  return null;
}

function _setCachedClips(slotPosition: number, data: any[]) {
  const key = `slot_${slotPosition}`;
  cache.clips.set(key, { data, expires: Date.now() + CACHE_TTL.clips });
}

// =========================
// Supabase client (server)
// =========================

function createSupabaseServerClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      '[vote] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables'
    );
  }

  return createClient(supabaseUrl, supabaseKey);
}

// =========================
// Types
// =========================

type VoteType = 'standard' | 'super' | 'mega';

interface SeasonRow {
  id: string;
  status: 'draft' | 'active' | 'finished';
  label?: string | null;
  total_slots?: number | null;
}

interface StorySlotRow {
  id: string;
  season_id: string;
  slot_position: number;
  status: 'upcoming' | 'voting' | 'locked';
  genre: string | null;
  winner_tournament_clip_id?: string | null;
  voting_started_at?: string | null;
  voting_ends_at?: string | null;
  voting_duration_hours?: number | null;
}

interface TournamentClipRow {
  id: string;
  slot_position: number | null;
  thumbnail_url: string | null;
  video_url: string | null;
  username: string | null;
  avatar_url?: string | null;
  genre: string | null;
  vote_count: number | null;
  weighted_score: number | null;
  hype_score?: number | null;
  round_number?: number | null;
  total_rounds?: number | null;
  segment_index?: number | null;
  badge_level?: string | null;
  view_count?: number | null;
  created_at?: string | null;
}

interface VoteRow {
  clip_id: string;
  vote_weight: number | null;
  vote_type: VoteType | null;
  created_at: string;
  slot_position: number | null;
}

// Client response types
interface ClientClip {
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
  has_voted?: boolean; // NEW: indicates if user already voted on this clip
}

interface VotingStateResponse {
  clips: ClientClip[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: {
    standard: number;
    super: number;
    mega: number;
  };
  votedClipIds: string[];
  currentSlot: number;
  totalSlots: number;
  streak: number;
  // Timer info
  votingEndsAt: string | null;
  votingStartedAt: string | null;
  timeRemainingSeconds: number | null;
  // Sampling info
  totalClipsInSlot: number;
  clipsShown: number;
  hasMoreClips: boolean;
}

interface VoteResponseBody {
  success: boolean;
  newScore: number;
  voteType: VoteType;
  clipId: string;
  totalVotesToday?: number;
  remainingVotes?: {
    standard: number;
    super: number;
    mega: number;
  };
  error?: string;
}

// =========================
// Helpers
// =========================

function startOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function getUserVotesToday(
  supabase: SupabaseClient,
  voterKey: string
): Promise<{ votes: VoteRow[]; count: number; error?: string }> {
  const startOfToday = startOfTodayUTC().toISOString();

  const { data, error, count } = await supabase
    .from('votes')
    .select('clip_id, vote_weight, vote_type, created_at, slot_position', { count: 'exact' })
    .eq('voter_key', voterKey)
    .gte('created_at', startOfToday);

  if (error) {
    console.error('[vote] getUserVotesToday error:', error);
    // Return error flag so caller can handle appropriately
    return { votes: [], count: 0, error: 'Failed to fetch vote history' };
  }

  return { votes: (data as VoteRow[]) || [], count: count ?? 0 };
}

async function getUserVotesInSlot(
  supabase: SupabaseClient,
  voterKey: string,
  slotPosition: number
): Promise<{ votes: VoteRow[]; error?: string }> {
  const { data, error } = await supabase
    .from('votes')
    .select('clip_id, vote_weight, vote_type, created_at, slot_position')
    .eq('voter_key', voterKey)
    .eq('slot_position', slotPosition);

  if (error) {
    console.error('[vote] getUserVotesInSlot error:', error);
    return { votes: [], error: 'Failed to fetch slot votes' };
  }

  return { votes: (data as VoteRow[]) || [] };
}

async function hasVotedOnClip(
  supabase: SupabaseClient,
  voterKey: string,
  clipId: string
): Promise<{ hasVoted: boolean; error?: string }> {
  const { data, error } = await supabase
    .from('votes')
    .select('id')
    .eq('voter_key', voterKey)
    .eq('clip_id', clipId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[vote] hasVotedOnClip error:', error);
    // SECURITY: Return error so we don't allow duplicate votes on DB failure
    return { hasVoted: false, error: 'Failed to check vote status' };
  }

  return { hasVoted: !!data };
}

interface VoteDetails {
  id: string;
  vote_weight: number;
  vote_type: VoteType;
  slot_position: number;
}

async function getVoteOnClip(
  supabase: SupabaseClient,
  voterKey: string,
  clipId: string
): Promise<VoteDetails | null> {
  const { data, error } = await supabase
    .from('votes')
    .select('id, vote_weight, vote_type, slot_position')
    .eq('voter_key', voterKey)
    .eq('clip_id', clipId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[vote] getVoteOnClip error:', error);
    return null;
  }

  if (!data) return null;

  return {
    id: data.id,
    vote_weight: data.vote_weight ?? 1,
    vote_type: data.vote_type ?? 'standard',
    slot_position: data.slot_position ?? 1,
  };
}

function getVoterKey(req: NextRequest): string {
  // Use enhanced device fingerprinting
  return generateDeviceKey(req);
}

// Check if vote should be flagged for suspicious activity
function checkVoteRisk(req: NextRequest): { flagged: boolean; riskScore: number; reasons: string[] } {
  const signals = extractDeviceSignals(req);
  const risk = assessDeviceRisk(signals);
  return {
    flagged: shouldFlagVote(signals),
    riskScore: risk.score,
    reasons: risk.reasons,
  };
}

function fallbackAvatar(seed: string) {
  return `https://api.dicebear.com/8.x/thumbs/svg?seed=${encodeURIComponent(seed)}`;
}

function normalizeGenre(genre: string | null | undefined): ClientClip['genre'] {
  if (!genre) return 'COMEDY';
  const upper = genre.toUpperCase();
  if (upper === 'THRILLER') return 'THRILLER';
  if (upper === 'ACTION') return 'ACTION';
  if (upper === 'ANIMATION') return 'ANIMATION';
  return 'COMEDY';
}

function calculateRemainingSpecialVotes(
  slotVotes: VoteRow[]
): { super: number; mega: number } {
  const superUsed = slotVotes.filter(v => v.vote_type === 'super').length;
  const megaUsed = slotVotes.filter(v => v.vote_type === 'mega').length;

  return {
    super: Math.max(0, SUPER_VOTES_PER_SLOT - superUsed),
    mega: Math.max(0, MEGA_VOTES_PER_SLOT - megaUsed),
  };
}

// =========================
// Smart Clip Sampling
// =========================

function calculateTimeRemaining(votingEndsAt: string | null): number | null {
  if (!votingEndsAt) return null;
  const endTime = new Date(votingEndsAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((endTime - now) / 1000));
}

function _smartSampleClips(
  allClips: TournamentClipRow[],
  votedClipIds: Set<string>,
  seenClipIds: Set<string>,
  count: number
): TournamentClipRow[] {
  // Separate clips into categories
  const unvotedUnseen: TournamentClipRow[] = [];
  const unvotedSeen: TournamentClipRow[] = [];
  const voted: TournamentClipRow[] = [];

  const now = new Date();
  const freshCutoff = new Date(now.getTime() - FRESH_CLIP_HOURS * 60 * 60 * 1000);

  for (const clip of allClips) {
    if (votedClipIds.has(clip.id)) {
      voted.push(clip);
    } else if (seenClipIds.has(clip.id)) {
      unvotedSeen.push(clip);
    } else {
      unvotedUnseen.push(clip);
    }
  }

  // Sort unvoted clips by priority:
  // 1. Fresh clips (< 2 hours old) first
  // 2. Lower view count = higher priority (fairness)
  // 3. Random shuffle within each tier
  const sortByPriority = (clips: TournamentClipRow[]) => {
    return clips
      .map(clip => {
        const createdAt = clip.created_at ? new Date(clip.created_at) : new Date(0);
        const isFresh = createdAt > freshCutoff;
        const viewCount = clip.view_count ?? 0;
        // Lower score = higher priority
        const priorityScore = (isFresh ? 0 : 1000) + viewCount + Math.random() * 10;
        return { clip, priorityScore };
      })
      .sort((a, b) => a.priorityScore - b.priorityScore)
      .map(x => x.clip);
  };

  // Build result: prioritize unvoted unseen, then unvoted seen
  const sorted = [
    ...sortByPriority(unvotedUnseen),
    ...sortByPriority(unvotedSeen),
  ];

  // Take requested count
  const result = sorted.slice(0, count);

  // If not enough unvoted clips, fill with voted ones (so user sees progress)
  if (result.length < count && voted.length > 0) {
    const remaining = count - result.length;
    // Shuffle voted clips
    const shuffledVoted = voted.sort(() => Math.random() - 0.5);
    result.push(...shuffledVoted.slice(0, remaining));
  }

  // Final shuffle to mix it up
  return result.sort(() => Math.random() - 0.5);
}

async function recordClipViews(
  supabase: SupabaseClient,
  voterKey: string,
  clipIds: string[]
): Promise<void> {
  if (clipIds.length === 0) return;

  try {
    // Record views
    const viewRecords = clipIds.map(clip_id => ({
      clip_id,
      voter_key: voterKey,
      viewed_at: new Date().toISOString(),
    }));

    // Upsert to avoid duplicates (ignore if view already exists)
    await supabase
      .from('clip_views')
      .upsert(viewRecords, { ignoreDuplicates: true });

    // Note: view_count increment can be handled by a database trigger if needed
  } catch (error) {
    console.error('[vote] recordClipViews error:', error);
    // Non-critical, don't fail the request
  }
}

async function _getSeenClipIds(
  supabase: SupabaseClient,
  voterKey: string,
  slotPosition: number
): Promise<Set<string>> {
  try {
    // Get clips user has seen in this slot (from clip_views)
    const { data } = await supabase
      .from('clip_views')
      .select('clip_id')
      .eq('voter_key', voterKey);

    // Also get clip IDs for this slot to filter
    const { data: slotClips } = await supabase
      .from('tournament_clips')
      .select('id')
      .eq('slot_position', slotPosition);

    const slotClipIds = new Set((slotClips || []).map(c => c.id));
    const seenIds = new Set<string>();

    for (const view of (data || [])) {
      if (slotClipIds.has(view.clip_id)) {
        seenIds.add(view.clip_id);
      }
    }

    return seenIds;
  } catch (error) {
    console.error('[vote] getSeenClipIds error:', error);
    return new Set();
  }
}

// =========================
// GET /api/vote
// =========================

export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  const supabase = createSupabaseServerClient();
  const voterKey = getVoterKey(req);

  // Get logged-in user's ID if available for secure vote tracking
  let effectiveVoterKey = voterKey;
  try {
    const { getServerSession } = await import('next-auth');
    const session = await getServerSession();
    if (session?.user?.email) {
      const { data: userData } = await supabase
        .from('users')
        .select('id')
        .eq('email', session.user.email)
        .single();
      if (userData) {
        effectiveVoterKey = `user_${userData.id}`;
      }
    }
  } catch {
    // No session - use device fingerprint
  }

  try {
    // 1. Get user's votes today
    const { votes: _userVotesToday, count: totalVotesToday } = await getUserVotesToday(
      supabase,
      effectiveVoterKey
    );
    const dailyRemaining = Math.max(0, DAILY_VOTE_LIMIT - totalVotesToday);

    // 2. Get active Season (with caching)
    let season = getCached<SeasonRow>('activeSeason');
    let seasonError = null;

    if (!season) {
      const result = await supabase
        .from('seasons')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      season = result.data;
      seasonError = result.error;

      if (season) {
        setCache('activeSeason', season, CACHE_TTL.season);
      }
    }

    if (seasonError) {
      console.error('[GET /api/vote] seasonError:', seasonError);
    }

    if (!season) {
      const empty: VotingStateResponse = {
        clips: [],
        totalVotesToday,
        userRank: 0,
        remainingVotes: {
          standard: dailyRemaining,
          super: SUPER_VOTES_PER_SLOT,
          mega: MEGA_VOTES_PER_SLOT,
        },
        votedClipIds: [],
        currentSlot: 0,
        totalSlots: 75,
        streak: 1,
        votingEndsAt: null,
        votingStartedAt: null,
        timeRemainingSeconds: null,
        totalClipsInSlot: 0,
        clipsShown: 0,
        hasMoreClips: false,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    const seasonRow = season as SeasonRow;
    const totalSlots = seasonRow.total_slots ?? 75;

    // 3. Get active slot (status = 'voting') with caching
    let storySlot = getCached<StorySlotRow>('activeSlot');
    let slotError = null;

    // Validate cached slot is for current season
    if (storySlot && storySlot.season_id !== seasonRow.id) {
      storySlot = null;
    }

    if (!storySlot) {
      const result = await supabase
        .from('story_slots')
        .select('*')
        .eq('season_id', seasonRow.id)
        .eq('status', 'voting')
        .order('slot_position', { ascending: true })
        .limit(1)
        .maybeSingle();

      storySlot = result.data;
      slotError = result.error;

      if (storySlot) {
        setCache('activeSlot', storySlot, CACHE_TTL.slot);
      }
    }

    if (slotError) {
      console.error('[GET /api/vote] storySlotError:', slotError);
    }

    if (!storySlot) {
      const empty: VotingStateResponse = {
        clips: [],
        totalVotesToday,
        userRank: 0,
        remainingVotes: {
          standard: dailyRemaining,
          super: SUPER_VOTES_PER_SLOT,
          mega: MEGA_VOTES_PER_SLOT,
        },
        votedClipIds: [],
        currentSlot: 0,
        totalSlots,
        streak: 1,
        votingEndsAt: null,
        votingStartedAt: null,
        timeRemainingSeconds: null,
        totalClipsInSlot: 0,
        clipsShown: 0,
        hasMoreClips: false,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    const activeSlot = storySlot as StorySlotRow;

    // 4. Get user's votes in current slot (for special vote tracking)
    const slotVotesResult = await getUserVotesInSlot(supabase, effectiveVoterKey, activeSlot.slot_position);
    // For GET, we can proceed with empty votes if there's an error (graceful degradation)
    const slotVotes = slotVotesResult.votes;
    const votedClipIds = slotVotes.map(v => v.clip_id);
    const specialVotesRemaining = calculateRemainingSpecialVotes(slotVotes);
    const votedIdsSet = new Set(votedClipIds);

    // 5. Get total clip count for this slot (lightweight query)
    const { count: totalClipCount, error: countError } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', seasonRow.id)
      .eq('slot_position', activeSlot.slot_position)
      .eq('status', 'active');

    if (countError) {
      console.error('[GET /api/vote] countError:', countError);
    }

    const totalClipsInSlot = totalClipCount ?? 0;

    // 6. Fetch ALL active clips for this slot (both voted and unvoted)
    // This ensures user can always navigate between clips and revoke votes
    // Filter by season_id to only get clips from the current active season
    const { data: allClips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('*')
      .eq('season_id', seasonRow.id)
      .eq('slot_position', activeSlot.slot_position)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(CLIP_POOL_SIZE);

    console.log('[GET /api/vote] Query params:', {
      season_id: seasonRow.id,
      slot_position: activeSlot.slot_position,
      status: 'active',
      clipsFound: allClips?.length || 0,
      clipsError: clipsError?.message || null,
    });

    if (clipsError) {
      console.error('[GET /api/vote] clipsError:', clipsError);
      const empty: VotingStateResponse = {
        clips: [],
        totalVotesToday,
        userRank: 0,
        remainingVotes: {
          standard: dailyRemaining,
          super: specialVotesRemaining.super,
          mega: specialVotesRemaining.mega,
        },
        votedClipIds,
        currentSlot: activeSlot.slot_position,
        totalSlots,
        streak: 1,
        votingEndsAt: activeSlot.voting_ends_at || null,
        votingStartedAt: activeSlot.voting_started_at || null,
        timeRemainingSeconds: calculateTimeRemaining(activeSlot.voting_ends_at || null),
        totalClipsInSlot: 0,
        clipsShown: 0,
        hasMoreClips: false,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    const clipPool = (allClips as TournamentClipRow[]) || [];

    if (clipPool.length === 0) {
      // No clips at all in this slot
      const empty: VotingStateResponse = {
        clips: [],
        totalVotesToday,
        userRank: 0,
        remainingVotes: {
          standard: dailyRemaining,
          super: specialVotesRemaining.super,
          mega: specialVotesRemaining.mega,
        },
        votedClipIds,
        currentSlot: activeSlot.slot_position,
        totalSlots,
        streak: 1,
        votingEndsAt: activeSlot.voting_ends_at || null,
        votingStartedAt: activeSlot.voting_started_at || null,
        timeRemainingSeconds: calculateTimeRemaining(activeSlot.voting_ends_at || null),
        totalClipsInSlot: 0,
        clipsShown: 0,
        hasMoreClips: false,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    // 7. Take clips in consistent order (no shuffle to prevent video rotation on refetch)
    // Clips are already ordered by created_at from the DB query
    const sampledClips = clipPool.slice(0, CLIPS_PER_SESSION);

    // 8. Record clip views (non-blocking, for analytics only)
    const clipIdsToRecord = sampledClips.map(c => c.id);
    if (clipIdsToRecord.length > 0) {
      // Fire and forget - don't await, don't block response
      recordClipViews(supabase, effectiveVoterKey, clipIdsToRecord).catch(() => {});
    }

    // 9. Map clips for frontend
    const clipsForClient: ClientClip[] = sampledClips.map((row, index) => {
      const voteCount = row.vote_count ?? 0;
      const weightedScore = row.weighted_score ?? voteCount;
      const hype = row.hype_score ?? weightedScore ?? voteCount;
      const segmentIndex = (row.segment_index ?? activeSlot.slot_position ?? 1) - 1;

      return {
        id: row.id,
        clip_id: row.id,
        user_id: voterKey,
        thumbnail_url: row.thumbnail_url || row.video_url || '',
        video_url: row.video_url || row.thumbnail_url || '',
        vote_count: voteCount,
        weighted_score: weightedScore,
        rank_in_track: index + 1,
        user: {
          username: row.username || 'Creator',
          avatar_url: row.avatar_url || fallbackAvatar(row.id),
          badge_level: row.badge_level ?? 'CREATOR',
        },
        genre: normalizeGenre(row.genre ?? activeSlot.genre ?? 'COMEDY'),
        duration: row.round_number ?? 8,
        round_number: row.round_number ?? 1,
        total_rounds: totalSlots,
        segment_index: segmentIndex,
        hype_score: hype,
        is_featured: false,
        is_creator_followed: false,
        has_voted: votedIdsSet.has(row.id),
      };
    });

    const response: VotingStateResponse = {
      clips: clipsForClient,
      totalVotesToday,
      userRank: 0,
      remainingVotes: {
        standard: dailyRemaining,
        super: specialVotesRemaining.super,
        mega: specialVotesRemaining.mega,
      },
      votedClipIds,
      currentSlot: activeSlot.slot_position,
      totalSlots,
      streak: 1,
      votingEndsAt: activeSlot.voting_ends_at || null,
      votingStartedAt: activeSlot.voting_started_at || null,
      timeRemainingSeconds: calculateTimeRemaining(activeSlot.voting_ends_at || null),
      totalClipsInSlot,
      clipsShown: sampledClips.length,
      hasMoreClips: totalClipsInSlot > votedClipIds.length,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error in GET /api/vote', error);
    const fallback: VotingStateResponse = {
      clips: [],
      totalVotesToday: 0,
      userRank: 0,
      remainingVotes: {
        standard: DAILY_VOTE_LIMIT,
        super: SUPER_VOTES_PER_SLOT,
        mega: MEGA_VOTES_PER_SLOT,
      },
      votedClipIds: [],
      currentSlot: 0,
      totalSlots: 75,
      streak: 1,
      votingEndsAt: null,
      votingStartedAt: null,
      timeRemainingSeconds: null,
      totalClipsInSlot: 0,
      clipsShown: 0,
      hasMoreClips: false,
    };
    return NextResponse.json(fallback, { status: 500 });
  }
}

// =========================
// POST /api/vote
// =========================

export async function POST(req: NextRequest) {
  // Rate limiting for votes (stricter)
  const rateLimitResponse = await rateLimit(req, 'vote');
  if (rateLimitResponse) return rateLimitResponse;

  const supabase = createSupabaseServerClient();

  try {
    const body = await req.json();

    // Verify CAPTCHA token if provided (bot protection)
    // CAPTCHA is required when the feature flag is enabled
    const { data: captchaFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'require_captcha_voting')
      .maybeSingle();

    const captchaRequired = captchaFlag?.enabled ?? false;

    if (captchaRequired) {
      const captchaToken = body.captchaToken;
      if (!captchaToken) {
        return NextResponse.json(
          {
            success: false,
            error: 'CAPTCHA verification required',
            code: 'CAPTCHA_REQUIRED',
          },
          { status: 400 }
        );
      }

      const clientIp = getClientIp(req.headers);
      const captchaResult = await verifyCaptcha(captchaToken, clientIp);

      if (!captchaResult.success) {
        console.warn('[POST /api/vote] CAPTCHA verification failed:', captchaResult.error_codes);
        return NextResponse.json(
          {
            success: false,
            error: 'CAPTCHA verification failed',
            code: 'CAPTCHA_FAILED',
            details: captchaResult.error_codes,
          },
          { status: 400 }
        );
      }
    }

    // Validate request body with Zod
    const validation = parseBody(VoteRequestSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const { clipId, voteType } = validation.data;

    const voterKey = getVoterKey(req);

    // Get logged-in user's ID if available
    let loggedInUserId: string | null = null;
    let _userEmail: string | null = null;
    try {
      const { getServerSession } = await import('next-auth');
      const session = await getServerSession();
      if (session?.user?.email) {
        _userEmail = session.user.email;
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('email', session.user.email)
          .single();
        if (userData) {
          loggedInUserId = userData.id;
        }
      }
    } catch {
      // No session - continue with voterKey only
    }

    // Check if authentication is required for voting (security feature flag)
    const { data: authRequiredFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'require_auth_voting')
      .maybeSingle();

    const requireAuth = authRequiredFlag?.enabled ?? false;

    if (requireAuth && !loggedInUserId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Authentication required to vote',
          code: 'AUTH_REQUIRED',
        },
        { status: 401 }
      );
    }

    // Use authenticated user ID for vote tracking when available (more secure)
    // Fall back to device fingerprint only if auth not required
    const effectiveVoterKey = loggedInUserId ? `user_${loggedInUserId}` : voterKey;

    // 1. Check multi-vote mode feature flag
    const { data: multiVoteFlag, error: flagError } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'multi_vote_mode')
      .maybeSingle();

    if (flagError) {
      console.warn('[POST /api/vote] Failed to fetch multi_vote_mode flag:', flagError.message);
    }

    // Handle various truthy values (boolean true, string "true", number 1, etc.)
    const multiVoteEnabled = Boolean(multiVoteFlag?.enabled);
    console.log('[POST /api/vote] Multi-vote mode:', { multiVoteEnabled, rawValue: multiVoteFlag?.enabled, flagData: multiVoteFlag });

    // 2. Check if already voted on this clip (skip if multi-vote mode is ON)
    if (!multiVoteEnabled) {
      const voteCheckResult = await hasVotedOnClip(supabase, effectiveVoterKey, clipId);
      // SECURITY: If we can't verify vote status, reject the request
      if (voteCheckResult.error) {
        console.error('[POST /api/vote] Failed to check vote status:', voteCheckResult.error);
        return NextResponse.json(
          {
            success: false,
            error: 'Unable to process vote. Please try again.',
            code: 'DB_ERROR',
          },
          { status: 503 }
        );
      }
      if (voteCheckResult.hasVoted) {
        return NextResponse.json(
          {
            success: false,
            error: 'Already voted on this clip',
            code: 'ALREADY_VOTED',
            clipId,
          },
          { status: 409 } // Conflict
        );
      }
    }

    // 3. Check daily vote limit
    const votesTodayResult = await getUserVotesToday(supabase, effectiveVoterKey);
    // SECURITY: If we can't verify daily votes, reject the request
    if (votesTodayResult.error) {
      console.error('[POST /api/vote] Failed to check daily votes:', votesTodayResult.error);
      return NextResponse.json(
        {
          success: false,
          error: 'Unable to process vote. Please try again.',
          code: 'DB_ERROR',
        },
        { status: 503 }
      );
    }
    const totalVotesToday = votesTodayResult.count;

    if (totalVotesToday >= DAILY_VOTE_LIMIT) {
      return NextResponse.json(
        {
          success: false,
          error: 'Daily vote limit reached (200 votes)',
          code: 'DAILY_LIMIT',
          totalVotesToday,
        },
        { status: 429 }
      );
    }

    // 4. Get clip's slot position and status for validation
    const { data: clipData, error: clipFetchError } = await supabase
      .from('tournament_clips')
      .select('slot_position, vote_count, weighted_score, status')
      .eq('id', clipId)
      .maybeSingle();

    if (clipFetchError || !clipData) {
      console.error('[POST /api/vote] clipFetchError:', clipFetchError);
      return NextResponse.json(
        { success: false, error: 'Clip not found' },
        { status: 404 }
      );
    }

    // SECURITY: Validate clip status - only allow voting on approved/active clips
    const invalidStatuses = ['rejected', 'archived', 'pending', 'removed'];
    if (clipData.status && invalidStatuses.includes(clipData.status.toLowerCase())) {
      return NextResponse.json(
        {
          success: false,
          error: 'Cannot vote on this clip',
          code: 'INVALID_CLIP_STATUS',
        },
        { status: 400 }
      );
    }

    const slotPosition = clipData.slot_position ?? 1;

    // 5. For super/mega votes: check if already used in this slot
    if (voteType === 'super' || voteType === 'mega') {
      const slotVotesResult = await getUserVotesInSlot(supabase, effectiveVoterKey, slotPosition);
      // SECURITY: If we can't verify slot votes, reject special votes
      if (slotVotesResult.error) {
        console.error('[POST /api/vote] Failed to check slot votes:', slotVotesResult.error);
        return NextResponse.json(
          {
            success: false,
            error: 'Unable to process special vote. Please try again.',
            code: 'DB_ERROR',
          },
          { status: 503 }
        );
      }
      const specialRemaining = calculateRemainingSpecialVotes(slotVotesResult.votes);

      if (voteType === 'super' && specialRemaining.super <= 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Super vote already used this round',
            code: 'SUPER_LIMIT',
          },
          { status: 429 }
        );
      }

      if (voteType === 'mega' && specialRemaining.mega <= 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Mega vote already used this round',
            code: 'MEGA_LIMIT',
          },
          { status: 429 }
        );
      }
    }

    // 5. Calculate vote weight
    const weight: number =
      voteType === 'mega' ? 10 : voteType === 'super' ? 3 : 1;

    // 5.5. Check vote risk (for fraud detection)
    const voteRisk = checkVoteRisk(req);
    if (voteRisk.riskScore >= 70) {
      // High risk - log but still allow (could be legitimate user behind VPN/proxy)
      console.warn('[POST /api/vote] High risk vote detected:', {
        voterKey: effectiveVoterKey.slice(0, 8) + '...',
        riskScore: voteRisk.riskScore,
        reasons: voteRisk.reasons,
      });
    }

    // 6. Insert vote
    // - voter_key: uses effectiveVoterKey (user ID if logged in, device fingerprint otherwise)
    // - user_id: only set if logged in (null for anonymous users)
    // - flagged: true if suspicious activity detected
    //
    // When multi_vote_mode is enabled, we update the existing vote instead of failing
    // This allows users to "add" to their vote weight on the same clip
    const voteData = {
      clip_id: clipId,
      voter_key: effectiveVoterKey,
      user_id: loggedInUserId, // null if not logged in
      vote_weight: weight,
      vote_type: voteType,
      slot_position: slotPosition,
      flagged: voteRisk.flagged || undefined, // Only set if flagged
    };

    let insertError;

    if (multiVoteEnabled) {
      // In multi-vote mode, update existing vote to add weight, or insert new
      // First try to update existing vote
      const { data: existingVote } = await supabase
        .from('votes')
        .select('id, vote_weight')
        .eq('clip_id', clipId)
        .eq('voter_key', effectiveVoterKey)
        .maybeSingle();

      if (existingVote) {
        // Update existing vote - add to the weight
        const { error } = await supabase
          .from('votes')
          .update({
            vote_weight: existingVote.vote_weight + weight,
            vote_type: voteType, // Update to latest vote type
          })
          .eq('id', existingVote.id);
        insertError = error;

        // Also update clip's weighted_score directly since trigger won't fire on update
        if (!error) {
          await supabase
            .from('tournament_clips')
            .update({
              vote_count: (clipData?.vote_count || 0) + 1,
              weighted_score: (clipData?.weighted_score || 0) + weight,
            })
            .eq('id', clipId);
        }
      } else {
        // No existing vote, insert new
        const { error } = await supabase.from('votes').insert(voteData);
        insertError = error;
      }
    } else {
      // Normal mode - just insert (unique constraint will reject duplicates)
      const { error } = await supabase.from('votes').insert(voteData);
      insertError = error;
    }

    if (insertError) {
      console.error('[POST /api/vote] insertError:', insertError);

      // Check for unique constraint violation
      if (insertError.code === '23505') {
        return NextResponse.json(
          {
            success: false,
            error: 'Already voted on this clip',
            code: 'ALREADY_VOTED',
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { success: false, error: 'Failed to insert vote' },
        { status: 500 }
      );
    }

    // 7. Vote count update is handled by database trigger (on_vote_insert)
    // The trigger atomically increments:
    //   - vote_count by 1 (number of votes)
    //   - weighted_score by vote_weight (1, 3, or 10)
    // We calculate the expected new score for the response
    const newVoteCount = (clipData.vote_count ?? 0) + 1;
    const newWeightedScore = (clipData.weighted_score ?? 0) + weight;

    // 8. Calculate remaining votes
    const newTotalVotesToday = totalVotesToday + 1;
    const slotVotesAfterResult = await getUserVotesInSlot(supabase, effectiveVoterKey, slotPosition);
    // Non-critical: if this fails, we still return success but with estimated values
    const specialRemaining = calculateRemainingSpecialVotes(slotVotesAfterResult.votes);

    const response: VoteResponseBody = {
      success: true,
      clipId,
      voteType,
      newScore: newWeightedScore,
      totalVotesToday: newTotalVotesToday,
      remainingVotes: {
        standard: Math.max(0, DAILY_VOTE_LIMIT - newTotalVotesToday),
        super: specialRemaining.super,
        mega: specialRemaining.mega,
      },
    };

    // Audit log for votes (especially flagged or special votes)
    if (voteRisk.flagged || voteType !== 'standard') {
      const logger = createRequestLogger('vote', req);
      logAudit(logger, {
        action: 'vote_cast',
        userId: loggedInUserId || undefined,
        resourceType: 'clip',
        resourceId: clipId,
        details: {
          voteType,
          weight,
          slotPosition,
          flagged: voteRisk.flagged,
          riskScore: voteRisk.riskScore,
          totalVotesToday: newTotalVotesToday,
        },
        ip: req.headers.get('x-forwarded-for')?.split(',')[0] || undefined,
        userAgent: req.headers.get('user-agent') || undefined,
      });
    }

    // Broadcast real-time vote update to all connected clients
    // This runs async and doesn't block the response
    broadcastVoteUpdate(clipId, newVoteCount).catch(() => {
      // Silently ignore broadcast errors - vote was still successful
    });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error in POST /api/vote', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cast vote' },
      { status: 500 }
    );
  }
}

// =========================
// DELETE /api/vote - Revoke Vote
// =========================

interface RevokeResponseBody {
  success: boolean;
  clipId: string;
  revokedVoteType: VoteType;
  newScore: number;
  totalVotesToday: number;
  remainingVotes: {
    standard: number;
    super: number;
    mega: number;
  };
  error?: string;
}

export async function DELETE(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'vote');
  if (rateLimitResponse) return rateLimitResponse;

  const supabase = createSupabaseServerClient();

  try {
    const body = await req.json();
    const clipId = body.clipId;

    if (!clipId || typeof clipId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'clipId is required' },
        { status: 400 }
      );
    }

    const voterKey = getVoterKey(req);

    // SECURITY FIX: Apply same auth logic as POST to prevent spoofing
    let loggedInUserId: string | null = null;
    try {
      const { getServerSession } = await import('next-auth');
      const session = await getServerSession();
      if (session?.user?.email) {
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('email', session.user.email)
          .single();
        if (userData) {
          loggedInUserId = userData.id;
        }
      }
    } catch {
      // No session - continue with voterKey only
    }

    // Use authenticated user ID when available (more secure than device fingerprint)
    const effectiveVoterKey = loggedInUserId ? `user_${loggedInUserId}` : voterKey;

    // RACE CONDITION FIX: Use atomic RPC function for delete
    // This prevents concurrent DELETE requests from causing negative vote counts
    // The RPC function uses SELECT FOR UPDATE to lock the row during deletion
    const { data: deleteResult, error: rpcError } = await supabase.rpc(
      'delete_vote_atomic',
      {
        p_voter_key: effectiveVoterKey,
        p_clip_id: clipId,
      }
    );

    if (rpcError) {
      console.error('[DELETE /api/vote] RPC error:', rpcError);

      // Fallback to traditional method if RPC doesn't exist yet
      // This allows the app to work before the migration is run
      if (rpcError.code === '42883') {
        // Function does not exist - use legacy method with logging
        console.warn('[DELETE /api/vote] Using legacy delete method - please run fix-vote-delete-race-condition.sql migration');

        // Legacy: Get existing vote
        const existingVote = await getVoteOnClip(supabase, effectiveVoterKey, clipId);
        if (!existingVote) {
          return NextResponse.json(
            { success: false, error: 'No vote found to revoke', code: 'NOT_VOTED', clipId },
            { status: 404 }
          );
        }

        // Legacy: Delete vote (trigger will update counts if it exists)
        const { error: deleteError } = await supabase
          .from('votes')
          .delete()
          .eq('id', existingVote.id);

        if (deleteError) {
          console.error('[DELETE /api/vote] deleteError:', deleteError);
          return NextResponse.json(
            { success: false, error: 'Failed to revoke vote' },
            { status: 500 }
          );
        }

        // Get updated clip stats
        const { data: clipData } = await supabase
          .from('tournament_clips')
          .select('weighted_score')
          .eq('id', clipId)
          .maybeSingle();

        const newWeightedScore = clipData?.weighted_score ?? 0;

        // Calculate remaining votes
        const votesTodayResult = await getUserVotesToday(supabase, effectiveVoterKey);
        const newTotalVotesToday = votesTodayResult.count;
        const slotVotesAfterResult = await getUserVotesInSlot(supabase, effectiveVoterKey, existingVote.slot_position);
        const specialRemaining = calculateRemainingSpecialVotes(slotVotesAfterResult.votes);

        return NextResponse.json({
          success: true,
          clipId,
          revokedVoteType: existingVote.vote_type,
          newScore: newWeightedScore,
          totalVotesToday: newTotalVotesToday,
          remainingVotes: {
            standard: Math.max(0, DAILY_VOTE_LIMIT - newTotalVotesToday),
            super: specialRemaining.super,
            mega: specialRemaining.mega,
          },
        }, { status: 200 });
      }

      return NextResponse.json(
        { success: false, error: 'Failed to revoke vote' },
        { status: 500 }
      );
    }

    // Check if vote was found and deleted
    if (!deleteResult || deleteResult.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No vote found to revoke',
          code: 'NOT_VOTED',
          clipId,
        },
        { status: 404 }
      );
    }

    const deletedVote = deleteResult[0];
    const newWeightedScore = deletedVote.new_weighted_score;

    // 5. Calculate remaining votes (vote is now restored)
    // Non-critical: if these fail, we still return success with fallback values
    const votesTodayResult = await getUserVotesToday(supabase, effectiveVoterKey);
    const newTotalVotesToday = votesTodayResult.count;
    const slotVotesAfterResult = await getUserVotesInSlot(
      supabase,
      effectiveVoterKey,
      deletedVote.slot_position
    );
    const specialRemaining = calculateRemainingSpecialVotes(slotVotesAfterResult.votes);

    const response: RevokeResponseBody = {
      success: true,
      clipId,
      revokedVoteType: deletedVote.vote_type as VoteType,
      newScore: newWeightedScore,
      totalVotesToday: newTotalVotesToday,
      remainingVotes: {
        standard: Math.max(0, DAILY_VOTE_LIMIT - newTotalVotesToday),
        super: specialRemaining.super,
        mega: specialRemaining.mega,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error in DELETE /api/vote', error);
    return NextResponse.json(
      { success: false, error: 'Failed to revoke vote' },
      { status: 500 }
    );
  }
}
