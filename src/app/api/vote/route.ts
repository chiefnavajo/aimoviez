// app/api/vote/route.ts
// AiMoviez · 8SEC MADNESS
// VOTING SYSTEM:
//   - 1 vote per clip per user (no multi-voting on same clip)
//   - Can vote on multiple clips in same round
//   - Daily limit: 200 votes

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
// Note: Redis seen-tracking removed for scalability
// Using view_count + random jitter for fair distribution instead
import { verifyCaptcha, getClientIp } from '@/lib/captcha';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

// Only log in development (never log sensitive data in production)
const isDev = process.env.NODE_ENV === 'development';
const debugLog = isDev ? console.log.bind(console) : () => {};

const _CLIP_POOL_SIZE = 30;  // How many clips to fetch per batch
const CLIPS_PER_SESSION = 8;  // Show 8 clips per initial request
const MAX_CLIPS_PER_REQUEST = 20;  // Max clips for pagination requests
const DAILY_VOTE_LIMIT = 200;
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
  clips: 45 * 1000,       // 45 seconds for clips (optimized from 15s)
  featureFlags: 5 * 60 * 1000,  // 5 minutes for feature flags (rarely change)
};

// Maximum cache entries to prevent unbounded memory growth
const MAX_CLIPS_CACHE_ENTRIES = 20;

// Feature flags cache - reduces 3 queries per vote to 1 query every 5 minutes
interface FeatureFlagsCache {
  data: Record<string, boolean> | null;
  expires: number;
}

const featureFlagsCache: FeatureFlagsCache = {
  data: null,
  expires: 0,
};

async function getFeatureFlags(supabase: SupabaseClient): Promise<Record<string, boolean>> {
  // Return cached flags if not expired
  if (featureFlagsCache.data && Date.now() < featureFlagsCache.expires) {
    return featureFlagsCache.data;
  }

  // Fetch all feature flags in ONE query
  const { data: flags, error } = await supabase
    .from('feature_flags')
    .select('key, enabled');

  if (error || !flags) {
    console.warn('[getFeatureFlags] Failed to fetch flags:', error?.message);
    // Return empty object on error (all flags default to false)
    return featureFlagsCache.data || {};
  }

  // Convert array to key-value object
  const flagsMap: Record<string, boolean> = {};
  flags.forEach((flag: { key: string; enabled: boolean }) => {
    flagsMap[flag.key] = flag.enabled ?? false;
  });

  // Cache for 5 minutes
  featureFlagsCache.data = flagsMap;
  featureFlagsCache.expires = Date.now() + CACHE_TTL.featureFlags;

  return flagsMap;
}

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

  // Enforce cache size limit to prevent unbounded memory growth
  if (cache.clips.size >= MAX_CLIPS_CACHE_ENTRIES) {
    // Evict oldest/first entry (FIFO eviction)
    const firstKey = cache.clips.keys().next().value;
    if (firstKey) {
      cache.clips.delete(firstKey);
    }
  }

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

// VoteType for database compatibility (only standard used now)
type VoteType = 'standard';

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
  status: 'upcoming' | 'voting' | 'locked' | 'waiting_for_clips';
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
  created_at?: string | null;
  view_count?: number | null;
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
  comment_count?: number; // Number of comments on this clip
}

interface VotingStateResponse {
  clips: ClientClip[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: {
    standard: number;
  };
  votedClipIds: string[];
  currentSlot: number;
  totalSlots: number;
  streak: number;
  // Timer info
  votingEndsAt: string | null;
  votingStartedAt: string | null;
  timeRemainingSeconds: number | null;
  // Pagination info (uses excludeIds approach, not offset)
  totalClipsInSlot: number;
  clipsShown: number;
  hasMoreClips: boolean;
  // Season status info
  seasonStatus?: 'active' | 'finished' | 'none';
  finishedSeasonName?: string;
  // Waiting for clips status
  waitingForClips?: boolean;
}

interface VoteResponseBody {
  success: boolean;
  newScore: number;
  clipId: string;
  totalVotesToday?: number;
  remainingVotes?: {
    standard: number;
  };
  error?: string;
}

// =========================
// Helpers
// =========================

// Get today's date string in YYYY-MM-DD format
function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

async function getUserVotesToday(
  supabase: SupabaseClient,
  voterKey: string
): Promise<{ votes: VoteRow[]; count: number; error?: string }> {
  // Use PostgreSQL-compatible date format for reliable comparison
  // This avoids timezone/precision issues with JavaScript date calculations
  const todayDateStr = getTodayDateString();
  const filterDate = new Date(todayDateStr).toISOString();

  debugLog('[getUserVotesToday] Query filter date:', todayDateStr);

  const { data, error } = await supabase
    .from('votes')
    .select('clip_id, vote_weight, vote_type, created_at, slot_position')
    .eq('voter_key', voterKey)
    .gte('created_at', filterDate);

  debugLog('[getUserVotesToday] Votes found:', data?.length || 0);
  if (data && data.length > 0) {
    debugLog('[getUserVotesToday] Sample vote timestamp:', data[0].created_at);
  }

  if (error) {
    console.error('[vote] getUserVotesToday error:', error);
    return { votes: [], count: 0, error: 'Failed to fetch vote history' };
  }

  const votes = (data as VoteRow[]) || [];
  // Sum vote_weight to get total votes consumed (each standard vote = 1)
  // Note: legacy votes may have different weights for backwards compatibility
  const totalWeight = votes.reduce((sum, vote) => sum + (vote.vote_weight ?? 1), 0);

  debugLog('[getUserVotesToday] Total weight calculated:', totalWeight);

  return { votes, count: totalWeight };
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

async function _hasVotedOnClip(
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

// Legacy database-based seen tracking (kept for fallback/analytics)
// Primary seen tracking now uses Redis Bloom filters for scalability
async function _getSeenClipIds(
  supabase: SupabaseClient,
  voterKey: string,
  slotPosition: number,
  seasonId: string
): Promise<Set<string>> {
  try {
    // Optimized: Join clip_views with tournament_clips to filter by slot in one query
    // This avoids fetching all views and then filtering in JS
    const { data } = await supabase
      .from('clip_views')
      .select(`
        clip_id,
        tournament_clips!inner(slot_position, season_id)
      `)
      .eq('voter_key', voterKey)
      .eq('tournament_clips.slot_position', slotPosition)
      .eq('tournament_clips.season_id', seasonId);

    const seenIds = new Set<string>();
    for (const view of (data || [])) {
      seenIds.add(view.clip_id);
    }

    return seenIds;
  } catch (error) {
    // Fallback: If join fails, try simpler query
    console.warn('[vote] getSeenClipIds join failed, using fallback:', error);
    try {
      const { data } = await supabase
        .from('clip_views')
        .select('clip_id')
        .eq('voter_key', voterKey);

      return new Set((data || []).map(v => v.clip_id));
    } catch {
      return new Set();
    }
  }
}

// =========================
// GET /api/vote
// =========================

export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  // Parse pagination parameters
  const { searchParams } = new URL(req.url);
  const limit = Math.min(MAX_CLIPS_PER_REQUEST, Math.max(1, parseInt(searchParams.get('limit') || String(CLIPS_PER_SESSION), 10)));

  // Client can optionally pass excludeIds for immediate deduplication (before server-side check)
  const excludeIdsParam = searchParams.get('excludeIds') || '';
  const clientExcludeIds = excludeIdsParam ? excludeIdsParam.split(',').filter(id => id.length > 0) : [];

  // Flag to force showing new clips (skip seen tracking)
  const forceNew = searchParams.get('forceNew') === 'true';

  const supabase = createSupabaseServerClient();
  const voterKey = getVoterKey(req);

  // Get logged-in user's ID if available for secure vote tracking
  let effectiveVoterKey = voterKey;
  try {
    const session = await getServerSession(authOptions);
    debugLog('[GET /api/vote] Session check:', session ? 'HAS SESSION' : 'NO SESSION');
    if (session?.user?.email) {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('email', session.user.email)
        .single();
      debugLog('[GET /api/vote] User lookup:', userData ? 'found' : `error=${userError?.message}`);
      if (userData) {
        effectiveVoterKey = `user_${userData.id}`;
      }
    }
  } catch (err) {
    debugLog('[GET /api/vote] Session error:', err);
    // No session - use device fingerprint
  }
  debugLog('[GET /api/vote] Using voter key type:', effectiveVoterKey.startsWith('user_') ? 'authenticated' : 'device');

  try {
    // 1. Get user's votes today
    const { votes: _userVotesToday, count: totalVotesToday } = await getUserVotesToday(
      supabase,
      effectiveVoterKey
    );
    debugLog('[GET /api/vote] totalVotesToday:', totalVotesToday);

    // DEBUG: Check vote count in development only
    if (isDev) {
      const { data: debugVotes } = await supabase
        .from('votes')
        .select('created_at, vote_weight')
        .eq('voter_key', effectiveVoterKey)
        .order('created_at', { ascending: false })
        .limit(5);
      debugLog('[GET /api/vote] DEBUG votes in DB:', debugVotes?.length || 0);
    }

    const dailyRemaining = Math.max(0, DAILY_VOTE_LIMIT - totalVotesToday);

    // 2. Get active Season (with caching)
    let season = getCached<SeasonRow>('activeSeason');
    let seasonError = null;

    if (!season) {
      const result = await supabase
        .from('seasons')
        .select('id, total_slots, status')
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
      // Check if there's a recently finished season
      const { data: finishedSeason } = await supabase
        .from('seasons')
        .select('id, label, status')
        .eq('status', 'finished')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const empty: VotingStateResponse = {
        clips: [],
        totalVotesToday,
        userRank: 0,
        remainingVotes: {
          standard: dailyRemaining,
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
        seasonStatus: finishedSeason ? 'finished' : 'none',
        finishedSeasonName: finishedSeason?.label || undefined,
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
      // First try to find a voting slot
      const result = await supabase
        .from('story_slots')
        .select('id, season_id, slot_position, status, genre, voting_ends_at, voting_started_at')
        .eq('season_id', seasonRow.id)
        .eq('status', 'voting')
        .order('slot_position', { ascending: true })
        .limit(1)
        .maybeSingle();

      storySlot = result.data;
      slotError = result.error;

      // If no voting slot, check for waiting_for_clips slot
      if (!storySlot && !slotError) {
        const waitingResult = await supabase
          .from('story_slots')
          .select('id, season_id, slot_position, status, genre, voting_ends_at, voting_started_at')
          .eq('season_id', seasonRow.id)
          .eq('status', 'waiting_for_clips')
          .order('slot_position', { ascending: true })
          .limit(1)
          .maybeSingle();

        storySlot = waitingResult.data;
        slotError = waitingResult.error;
      }

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

    // 4. Get user's votes in current slot
    const slotVotesResult = await getUserVotesInSlot(supabase, effectiveVoterKey, activeSlot.slot_position);
    // For GET, we can proceed with empty votes if there's an error (graceful degradation)
    const slotVotes = slotVotesResult.votes;
    const votedClipIds = slotVotes.map(v => v.clip_id);
    const votedIdsSet = new Set(votedClipIds);

    // 5. Get total clip count for this slot (lightweight query)
    // Status can be 'active' or 'competing' (both are valid for voting)
    // Filter by season_id to ensure correct clips for this season
    const { count: totalClipCount, error: countError } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('slot_position', activeSlot.slot_position)
      .eq('season_id', seasonRow.id)
      .eq('status', 'active');

    if (countError) {
      console.error('[GET /api/vote] countError:', countError);
    }

    const totalClipsInSlot = totalClipCount ?? 0;

    // 5.5 Client exclusions (passed from frontend for session deduplication)
    // This is the ONLY deduplication needed - no per-user server storage required
    const allExcludeIds = new Set(clientExcludeIds);

    // 6. Fetch clips using RANDOMIZED FAIR DISTRIBUTION
    // ============================================================================
    // Scalability approach: Use view_count + random jitter instead of per-user tracking
    //
    // Why this scales to millions:
    // - No per-user storage (Redis or DB)
    // - view_count naturally balances exposure (low-view clips get priority)
    // - Random jitter ensures variety (different clips each request)
    // - Client-side exclusion handles session deduplication
    // ============================================================================

    // Convert client exclude IDs to array for RPC
    const excludeIdsArray = Array.from(allExcludeIds);

    // Calculate fetch limit (fetch more than needed to allow for client filtering)
    const fetchLimit = Math.min(limit * 3, 60);

    let availableClips: TournamentClipRow[] = [];

    // Try RPC first (database-side randomization is more efficient)
    const { data: rpcClips, error: rpcError } = await supabase.rpc(
        'get_clips_randomized',
        {
          p_slot_position: activeSlot.slot_position,
          p_season_id: seasonRow.id,
          p_exclude_ids: excludeIdsArray,
          p_limit: fetchLimit,
          p_jitter: 50, // Random jitter added to view_count for variety
        }
      );

      if (rpcError?.code === '42883' || rpcError?.code === 'PGRST202') {
        // RPC not available - fallback to simple query with client-side shuffle
        console.warn('[GET /api/vote] get_clips_randomized RPC not found, using fallback');

        const { data: fallbackClips, error: fallbackError } = await supabase
          .from('tournament_clips')
          .select('id, thumbnail_url, video_url, username, avatar_url, genre, slot_position, vote_count, weighted_score, hype_score, created_at, view_count')
          .eq('slot_position', activeSlot.slot_position)
          .eq('season_id', seasonRow.id)
          .eq('status', 'active')
          .order('view_count', { ascending: true, nullsFirst: true })
          .limit(fetchLimit);

        if (fallbackError) {
          console.error('[GET /api/vote] fallbackError:', fallbackError);
          const empty: VotingStateResponse = {
            clips: [],
            totalVotesToday,
            userRank: 0,
            remainingVotes: { standard: dailyRemaining },
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

        // Filter out client-excluded clips
        availableClips = (fallbackClips || [])
          .filter(clip => !allExcludeIds.has(clip.id)) as TournamentClipRow[];

        // Shuffle since fallback doesn't have DB-side randomization
        for (let i = availableClips.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [availableClips[i], availableClips[j]] = [availableClips[j], availableClips[i]];
        }
      } else if (rpcError) {
        console.error('[GET /api/vote] RPC error:', rpcError);
        const empty: VotingStateResponse = {
          clips: [],
          totalVotesToday,
          userRank: 0,
          remainingVotes: { standard: dailyRemaining },
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
    } else {
      // RPC succeeded - clips already randomized by DB
      availableClips = (rpcClips || []) as TournamentClipRow[];
    }

    // Take only the requested limit
    const clipPool = availableClips.slice(0, limit);

    if (clipPool.length === 0) {
      // No clips at all in this slot - check if waiting for clips
      const isWaitingForClips = activeSlot.status === 'waiting_for_clips';
      const empty: VotingStateResponse = {
        clips: [],
        totalVotesToday,
        userRank: 0,
        remainingVotes: {
          standard: dailyRemaining,
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
        waitingForClips: isWaitingForClips,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    // 7. Use all fetched clips (already paginated by DB query)
    // Clips are already ordered by created_at from the DB query
    const sampledClips = clipPool;  // No additional slicing needed - DB handles pagination

    // 8. Record clip views for analytics and view_count increment
    // Note: Redis seen-tracking removed for scalability - using view_count + jitter instead
    const clipIdsToRecord = sampledClips.map(c => c.id);
    if (clipIdsToRecord.length > 0) {
      // Record in database for view_count tracking (fire and forget - non-blocking)
      recordClipViews(supabase, effectiveVoterKey, clipIdsToRecord).catch(() => {});
    }

    // 8.5 Fetch comment counts for sampled clips (optimized with single batch query)
    const commentCountsMap = new Map<string, number>();
    if (clipIdsToRecord.length > 0) {
      // Try RPC first (most efficient - database-side aggregation)
      const { data: commentCounts, error: rpcError } = await supabase
        .rpc('get_comment_counts', { clip_ids: clipIdsToRecord })
        .select('clip_id, count');

      if (commentCounts && Array.isArray(commentCounts) && !rpcError) {
        commentCounts.forEach((c: { clip_id: string; count: number }) => {
          commentCountsMap.set(c.clip_id, c.count);
        });
      } else {
        // Fallback: Single batch query instead of N+1 individual queries
        // Fetch all comments for all clips in ONE query, then count in JS
        const { data: allComments } = await supabase
          .from('comments')
          .select('clip_id')
          .in('clip_id', clipIdsToRecord)
          .eq('is_deleted', false)
          .is('parent_comment_id', null);

        // Initialize all clips with 0 count
        clipIdsToRecord.forEach(id => commentCountsMap.set(id, 0));

        // Count comments per clip in JavaScript (O(n) - much faster than N queries)
        if (allComments) {
          allComments.forEach((comment: { clip_id: string }) => {
            const current = commentCountsMap.get(comment.clip_id) || 0;
            commentCountsMap.set(comment.clip_id, current + 1);
          });
        }
      }
    }

    // 9. Map clips for frontend
    const clipsForClient: ClientClip[] = sampledClips.map((row, index) => {
      const voteCount = row.vote_count ?? 0;
      const weightedScore = row.weighted_score ?? voteCount;
      const hype = row.hype_score ?? weightedScore ?? voteCount;
      const segmentIndex = (row.slot_position ?? activeSlot.slot_position ?? 1) - 1;

      return {
        id: row.id,
        clip_id: row.id,
        user_id: voterKey,
        thumbnail_url: row.thumbnail_url || '',
        video_url: row.video_url || '',
        vote_count: voteCount,
        weighted_score: weightedScore,
        rank_in_track: index + 1,
        user: {
          username: row.username || 'Creator',
          avatar_url: row.avatar_url || fallbackAvatar(row.id),
          badge_level: 'CREATOR',
        },
        genre: normalizeGenre(row.genre ?? activeSlot.genre ?? 'COMEDY'),
        duration: 8,
        round_number: 1,
        total_rounds: totalSlots,
        segment_index: segmentIndex,
        hype_score: hype,
        is_featured: false,
        is_creator_followed: false,
        has_voted: votedIdsSet.has(row.id),
        comment_count: commentCountsMap.get(row.id) || 0,
      };
    });

    // Calculate pagination info (based on server-side seen tracking)
    const totalSeen = allExcludeIds.size + sampledClips.length;
    const hasMoreClips = totalSeen < totalClipsInSlot;

    const response: VotingStateResponse = {
      clips: clipsForClient,
      totalVotesToday,
      userRank: 0,
      remainingVotes: {
        standard: dailyRemaining,
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
      hasMoreClips,
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

    // Fetch all feature flags with caching (1 query every 5 min instead of 3 per request)
    const featureFlags = await getFeatureFlags(supabase);

    // Verify CAPTCHA token if provided (bot protection)
    const captchaRequired = featureFlags['require_captcha_voting'] ?? false;

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
        // SECURITY: Log error codes server-side, don't expose to client
        console.warn('[POST /api/vote] CAPTCHA verification failed:', captchaResult.error_codes);
        return NextResponse.json(
          {
            success: false,
            error: 'CAPTCHA verification failed. Please try again.',
            code: 'CAPTCHA_FAILED',
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

    const { clipId } = validation.data;

    const voterKey = getVoterKey(req);

    // Get logged-in user's ID if available (from JWT - no DB query needed)
    let loggedInUserId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      // userId is cached in the JWT token by auth-options.ts
      if (session?.user?.userId) {
        loggedInUserId = session.user.userId;
      }
    } catch {
      // No session - continue with voterKey only
    }

    // Check if authentication is required for voting (from cached feature flags)
    const requireAuth = featureFlags['require_auth_voting'] ?? false;

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
    debugLog('[POST /api/vote] Auth type:', loggedInUserId ? 'authenticated' : 'device');

    // 1. Check multi-vote mode feature flag (from cached feature flags)
    const multiVoteEnabled = featureFlags['multi_vote_mode'] ?? false;
    debugLog('[POST /api/vote] multiVoteEnabled:', multiVoteEnabled);

    // NOTE: We removed the check-then-insert pattern here because it has a race condition.
    // Instead, we rely on the database unique constraint and atomic RPC function.
    // If the RPC function is not available, we fall back to direct insert which will
    // fail with a unique constraint violation (handled below) if already voted.

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

    // Standard votes always have weight of 1
    const weight = 1;

    // Check if this vote would exceed the daily limit
    if (totalVotesToday + weight > DAILY_VOTE_LIMIT) {
      return NextResponse.json(
        {
          success: false,
          error: 'Daily vote limit reached (200 votes)',
          code: 'DAILY_LIMIT',
          totalVotesToday,
          remaining: 0,
        },
        { status: 429 }
      );
    }

    // 4. Get clip's slot position, season, and status for validation
    const { data: clipData, error: clipFetchError } = await supabase
      .from('tournament_clips')
      .select('slot_position, season_id, vote_count, weighted_score, status')
      .eq('id', clipId)
      .maybeSingle();

    if (clipFetchError || !clipData) {
      console.error('[POST /api/vote] clipFetchError:', clipFetchError);
      return NextResponse.json(
        { success: false, error: 'Clip not found' },
        { status: 404 }
      );
    }

    // SECURITY: Validate clip status - only allow voting on active clips
    if (clipData.status !== 'active') {
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

    // 4.5 Validate clip is in the currently active voting slot
    // Get the active slot for the clip's season (voting or waiting_for_clips)
    const { data: activeSlot, error: slotError } = await supabase
      .from('story_slots')
      .select('slot_position, status')
      .eq('season_id', clipData.season_id)
      .in('status', ['voting', 'waiting_for_clips'])
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (slotError) {
      console.error('[POST /api/vote] slotError:', slotError);
      return NextResponse.json(
        { success: false, error: 'Failed to verify voting slot' },
        { status: 500 }
      );
    }

    if (!activeSlot) {
      return NextResponse.json(
        {
          success: false,
          error: 'No active voting slot',
          code: 'NO_ACTIVE_SLOT',
        },
        { status: 400 }
      );
    }

    // SECURITY: Reject votes when slot is waiting for clips
    if (activeSlot.status === 'waiting_for_clips') {
      return NextResponse.json(
        {
          success: false,
          error: 'Voting is paused - waiting for clips to be uploaded',
          code: 'WAITING_FOR_CLIPS',
        },
        { status: 400 }
      );
    }

    // SECURITY: Verify clip is in the currently voting slot
    if (clipData.slot_position !== activeSlot.slot_position) {
      return NextResponse.json(
        {
          success: false,
          error: 'Clip is not in the current voting slot',
          code: 'WRONG_SLOT',
          currentSlot: activeSlot.slot_position,
          clipSlot: clipData.slot_position,
        },
        { status: 400 }
      );
    }

    // 5. Check vote risk (for fraud detection)
    // Note: vote weight was already calculated above (before daily limit check)
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
    // Explicitly set created_at from JavaScript to ensure consistent timestamp comparison
    // This avoids timezone/precision mismatches between JS Date and PostgreSQL NOW()
    const voteCreatedAt = new Date().toISOString();

    const todayDateStr = getTodayDateString();
    const filterDate = new Date(todayDateStr).toISOString();
    debugLog('[POST /api/vote] TIMESTAMP DEBUG:', {
      voteCreatedAt,
      willMatch: voteCreatedAt >= filterDate,
    });

    // RACE CONDITION FIX: Use atomic RPC function for insert
    // This prevents concurrent POST requests from causing duplicate votes
    // The RPC function uses INSERT ... ON CONFLICT and SELECT FOR UPDATE for thread safety
    const { data: insertResult, error: rpcError } = await supabase.rpc(
      'insert_vote_atomic',
      {
        p_clip_id: String(clipId),
        p_voter_key: String(effectiveVoterKey),
        p_user_id: loggedInUserId ? String(loggedInUserId) : null,
        p_vote_weight: weight,
        p_vote_type: 'standard',
        p_slot_position: slotPosition,
        p_flagged: voteRisk.flagged || false,
        p_multi_vote_mode: multiVoteEnabled,
        p_is_power_vote: false,
      }
    );

    debugLog('[POST /api/vote] RPC insert_vote_atomic result:', insertResult);

    if (rpcError) {
      console.error('[POST /api/vote] RPC error:', rpcError, 'code:', rpcError.code, 'message:', rpcError.message);
      console.error('[POST /api/vote] RPC params:', {
        p_clip_id: clipId,
        p_voter_key: effectiveVoterKey.slice(0, 20) + '...',
        p_multi_vote_mode: multiVoteEnabled,
      });

      // CRITICAL: Do NOT use legacy fallback - it has race conditions
      // 42883 = PostgreSQL "function does not exist"
      // PGRST202 = PostgREST "function not found in schema cache"
      if (rpcError.code === '42883' || rpcError.code === 'PGRST202') {
        console.error('[POST /api/vote] CRITICAL: insert_vote_atomic RPC function not found. Please run the migration: fix-vote-insert-race-condition.sql');
        return NextResponse.json(
          {
            success: false,
            error: 'Vote system not configured. Please contact support.',
            code: 'RPC_NOT_FOUND',
            debug: { errorCode: rpcError.code, errorMessage: rpcError.message }
          },
          { status: 503 }
        );
      }

      // Other RPC errors - return failure
      return NextResponse.json(
        { success: false, error: 'Failed to insert vote', debug: { errorCode: rpcError.code, errorMessage: rpcError.message, errorDetails: rpcError.details } },
        { status: 500 }
      );
    } else {
      // RPC succeeded - check the result
      const result = insertResult?.[0];

      if (result?.error_code === 'ALREADY_VOTED') {
        return NextResponse.json(
          {
            success: false,
            error: 'Already voted on this clip',
            code: 'ALREADY_VOTED',
          },
          { status: 409 }
        );
      }

      debugLog('[POST /api/vote] Vote recorded:', {
        voteId: result?.vote_id,
        wasNewVote: result?.was_new_vote,
        finalWeight: result?.final_vote_weight,
      });
    }

    // 7. Vote count update is handled by database trigger (on_vote_insert)
    // The RPC function returns the updated score atomically, so use that instead of a separate query
    // This eliminates the race condition where we read stale data after trigger runs
    const rpcResult = insertResult?.[0];
    const newWeightedScore = rpcResult?.new_weighted_score ?? ((clipData.weighted_score ?? 0) + weight);

    // 8. Calculate remaining votes
    const newTotalVotesToday = totalVotesToday + weight;

    const response: VoteResponseBody = {
      success: true,
      clipId,
      newScore: newWeightedScore,
      totalVotesToday: newTotalVotesToday,
      remainingVotes: {
        standard: Math.max(0, DAILY_VOTE_LIMIT - newTotalVotesToday),
      },
    };

    // Audit log for flagged votes
    if (voteRisk.flagged) {
      const logger = createRequestLogger('vote', req);
      logAudit(logger, {
        action: 'vote_cast',
        userId: loggedInUserId || undefined,
        resourceType: 'clip',
        resourceId: clipId,
        details: {
          slotPosition,
          flagged: voteRisk.flagged,
          riskScore: voteRisk.riskScore,
          totalVotesToday: newTotalVotesToday,
        },
        ip: req.headers.get('x-forwarded-for')?.split(',')[0] || undefined,
        userAgent: req.headers.get('user-agent') || undefined,
      });
    }

    // Real-time updates are now handled by Supabase Realtime
    // When the vote_count column updates, Supabase broadcasts to all subscribers

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
  newScore: number;
  totalVotesToday: number;
  remainingVotes: {
    standard: number;
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

    // Use cached userId from JWT (same as POST - no extra DB query needed)
    let loggedInUserId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      // userId is cached in the JWT token by auth-options.ts
      if (session?.user?.userId) {
        loggedInUserId = session.user.userId;
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
      // 42883 = PostgreSQL "function does not exist"
      // PGRST202 = PostgREST "function not found in schema cache"
      if (rpcError.code === '42883' || rpcError.code === 'PGRST202') {
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

        return NextResponse.json({
          success: true,
          clipId,
          newScore: newWeightedScore,
          totalVotesToday: newTotalVotesToday,
          remainingVotes: {
            standard: Math.max(0, DAILY_VOTE_LIMIT - newTotalVotesToday),
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

    const response: RevokeResponseBody = {
      success: true,
      clipId,
      newScore: newWeightedScore,
      totalVotesToday: newTotalVotesToday,
      remainingVotes: {
        standard: Math.max(0, DAILY_VOTE_LIMIT - newTotalVotesToday),
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
