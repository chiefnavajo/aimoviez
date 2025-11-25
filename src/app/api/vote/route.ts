// app/api/vote/route.ts
// AiMoviez · 8SEC MADNESS
// Mikro-voting per urządzenie + aktywny Season/slot + limit 200 głosów/dzień

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const CLIP_POOL_SIZE = 30;
const DAILY_VOTE_LIMIT = 200;

// =========================
// Supabase client (server)
// =========================

function createSupabaseServerClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      '[vote] Missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables'
    );
  }

  return createClient(supabaseUrl, supabaseKey);
}

// =========================
// Typy DB / API
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
}

interface VoteRow {
  clip_id: string;
  vote_weight: number | null;
  created_at: string;
}

// To, co oczekuje frontend (VotingState)
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
  streak: number;
}

interface VoteResponseBody {
  success: boolean;
  newScore: number;
  voteType: VoteType;
  clipId: string;
  totalVotesToday?: number;
  remainingVotes?: number;
}

// =========================
// Helpery
// =========================

function startOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function getUserVotesToday(
  supabase: SupabaseClient,
  voterKey: string
): Promise<{ votes: VoteRow[]; count: number }> {
  const startOfToday = startOfTodayUTC().toISOString();

  const { data, error, count } = await supabase
    .from('votes')
    .select('clip_id, vote_weight, created_at', { count: 'exact' })
    .eq('voter_key', voterKey)
    .gte('created_at', startOfToday);

  if (error) {
    console.error('[GET /api/vote] getUserVotesToday error:', error);
    return { votes: [], count: 0 };
  }

  return { votes: (data as VoteRow[]) || [], count: count ?? 0 };
}

function getVoterKey(req: NextRequest): string {
  const ip =
    (req.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '0.0.0.0';
  const ua = req.headers.get('user-agent') || 'unknown-ua';
  const raw = `${ip}|${ua}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `device_${hash}`;
}

function fallbackAvatar(seed: string) {
  // prosty fallback – możesz podmienić na swój identicon
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
// GET /api/vote
// =========================

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const voterKey = getVoterKey(req);

  try {
    // 1. Głosy usera dzisiaj
    const { votes: userVotesToday, count: totalVotesToday } = await getUserVotesToday(
      supabase,
      voterKey
    );
    const dailyRemaining = Math.max(0, DAILY_VOTE_LIMIT - totalVotesToday);

    // 2. Aktywny Season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

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
          super: 0,
          mega: 0,
        },
        streak: 1,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    const seasonRow = season as SeasonRow;

    // 3. Aktywny slot (status = 'voting')
    const { data: storySlot, error: slotError } = await supabase
      .from('story_slots')
      .select('*')
      .eq('season_id', seasonRow.id)
      .eq('status', 'voting')
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

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
          super: 0,
          mega: 0,
        },
        streak: 1,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    const activeSlot = storySlot as StorySlotRow;

    // 4. Klipy w tym slocie
    const { data: clips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('*')
      .eq('slot_position', activeSlot.slot_position)
      .order('created_at', { ascending: true })
      .limit(CLIP_POOL_SIZE);

    if (clipsError) {
      console.error('[GET /api/vote] clipsError:', clipsError);
      const empty: VotingStateResponse = {
        clips: [],
        totalVotesToday,
        userRank: 0,
        remainingVotes: {
          standard: dailyRemaining,
          super: 0,
          mega: 0,
        },
        streak: 1,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    const allClips = (clips as TournamentClipRow[]) || [];

    if (allClips.length === 0) {
      const empty: VotingStateResponse = {
        clips: [],
        totalVotesToday,
        userRank: 0,
        remainingVotes: {
          standard: dailyRemaining,
          super: 0,
          mega: 0,
        },
        streak: 1,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    // 5. Usuń klipy, na które user już głosował dziś (per device/voter_key)
    const votedIds = new Set(userVotesToday.map((v) => v.clip_id));
    const remainingClips = allClips.filter((clip) => !votedIds.has(clip.id));

    const baseClips = remainingClips.length > 0 ? remainingClips : allClips;

    // 6. Mapowanie na strukturę frontu
    const clipsForClient: ClientClip[] = baseClips.map((row, index) => {
      const voteCount = row.vote_count ?? 0;
      const weightedScore = row.weighted_score ?? voteCount;
      const hype = row.hype_score ?? weightedScore ?? voteCount;
      const segmentIndex = (row.segment_index ?? activeSlot.slot_position ?? 1) - 1;
      const totalRounds = seasonRow.total_slots ?? 75;

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
        total_rounds: totalRounds,
        segment_index: segmentIndex,
        hype_score: hype,
        is_featured: false,
        is_creator_followed: false,
      };
    });

    const response: VotingStateResponse = {
      clips: clipsForClient,
      totalVotesToday,
      userRank: 0,
      remainingVotes: {
        standard: dailyRemaining,
        super: 0,
        mega: 0,
      },
      streak: 1,
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
        super: 0,
        mega: 0,
      },
      streak: 1,
    };
    return NextResponse.json(fallback, { status: 500 });
  }
}

// =========================
// POST /api/vote
// =========================

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();

  try {
    const body = await req.json();
    const clipId: string | undefined = body?.clipId;
    const voteType: VoteType = body?.voteType ?? 'standard';

    if (!clipId) {
      return NextResponse.json(
        { success: false, error: 'Missing clipId' },
        { status: 400 }
      );
    }

    const voterKey = getVoterKey(req);

    // 1. Sprawdź, ile głosów dziś
    const { count: totalVotesToday } = await getUserVotesToday(supabase, voterKey);

    if (totalVotesToday >= DAILY_VOTE_LIMIT) {
      return NextResponse.json(
        {
          success: false,
          error: 'Daily vote limit reached',
          totalVotesToday,
        },
        { status: 429 }
      );
    }

    // 2. Waga głosu
    const weight: number =
      voteType === 'mega' ? 10 : voteType === 'super' ? 3 : 1;

    // 3. Zapis głosu do votes
    const { error: insertError } = await supabase.from('votes').insert({
      clip_id: clipId,
      voter_key: voterKey,
      user_id: voterKey, // na razie user per urządzenie; później można podmienić na supabase auth user.id
      vote_weight: weight,
    });

    if (insertError) {
      console.error('[POST /api/vote] insertError:', insertError);
      return NextResponse.json(
        { success: false, error: 'Failed to insert vote' },
        { status: 500 }
      );
    }

    // 4. Zaktualizuj statystyki klipu (vote_count, weighted_score)
    const { data: clipRow, error: clipError } = await supabase
      .from('tournament_clips')
      .select('vote_count, weighted_score')
      .eq('id', clipId)
      .maybeSingle();

    if (clipError) {
      console.error('[POST /api/vote] clipError:', clipError);
    }

    const currentVoteCount = (clipRow?.vote_count ?? 0) + 1;
    const currentWeightedScore =
      (clipRow?.weighted_score ?? clipRow?.vote_count ?? 0) + weight;

    const { error: updateClipError } = await supabase
      .from('tournament_clips')
      .update({
        vote_count: currentVoteCount,
        weighted_score: currentWeightedScore,
      })
      .eq('id', clipId);

    if (updateClipError) {
      console.error('[POST /api/vote] updateClipError:', updateClipError);
    }

    const newTotalVotesToday = totalVotesToday + 1;

    const response: VoteResponseBody = {
      success: true,
      clipId,
      voteType,
      newScore: currentWeightedScore,
      totalVotesToday: newTotalVotesToday,
      remainingVotes: Math.max(0, DAILY_VOTE_LIMIT - newTotalVotesToday),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('Error in POST /api/vote', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cast vote' },
      { status: 500 }
    );
  }
}