// app/api/vote/route.ts
// AiMoviez · 8SEC MADNESS
// Mikro-voting per urządzenie + aktywny Season/slot

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const CLIP_POOL_SIZE = 30;
const DAILY_VOTE_LIMIT = 200;

// --- Supabase client (server-side) ---

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
} else {
  supabase = createClient(supabaseUrl, supabaseKey);
}

// --- Typy z bazy ---

interface SeasonRow {
  id: string;
  status: 'draft' | 'active' | 'finished';
  label?: string;
  total_slots?: number;
}

interface StorySlotRow {
  id: string;
  season_id: string;
  slot_position: number;
  status: 'upcoming' | 'voting' | 'locked';
  genre: string | null;
}

interface TournamentClipRow {
  id: string;
  slot_position: number;
  thumbnail_url: string | null;
  video_url: string | null;
  username: string | null;
  genre: string | null;
  vote_count: number | null;
  weighted_score: number | null;
  hype_score: number | null;
  round_number?: number | null;
  total_rounds?: number | null;
  segment_index?: number | null;
  badge_level?: string | null;
  avatar_url?: string | null;
}

interface VoteRow {
  clip_id: string;
  vote_weight: number;
  created_at: string;
}

// --- Typ odpowiedzi do frontu (dashboard) ---

interface VotingStateResponse {
  clips: any[];
  totalVotesToday: number;
  userRank: number;
  remainingVotes: {
    standard: number;
    super: number;
    mega: number;
  };
  streak: number;
}

type VoteType = 'standard' | 'super' | 'mega';

// =========================
// Helpers
// =========================

function getStartOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// proste „ID użytkownika” z IP + user-agent;
function getVoterKey(req: NextRequest): string {
  const ip =
    req.headers.get('x-forwarded-for') ||
    req.headers.get('x-real-ip') ||
    '0.0.0.0';

  const ua = req.headers.get('user-agent') || 'unknown';

  const raw = `${ip}|${ua}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return `device_${Math.abs(hash)}`;
}

// używamy kolumny voter_key (NIE user_id)
async function getUserVotesToday(
  supabase: SupabaseClient,
  voterKey: string
): Promise<VoteRow[]> {
  const todayISO = getStartOfTodayISO();

  const { data, error } = await supabase
    .from('votes')
    .select('clip_id, vote_weight, created_at')
    .eq('voter_key', voterKey)
    .gte('created_at', todayISO);

  if (error) {
    console.error('[getUserVotesToday] error:', error);
    return [];
  }

  return (data || []) as VoteRow[];
}

// =========================
// GET /api/vote
// =========================

export async function GET(req: NextRequest) {
  if (!supabase) {
    return NextResponse.json(
      {
        clips: [],
        totalVotesToday: 0,
        userRank: 0,
        remainingVotes: {
          standard: DAILY_VOTE_LIMIT,
          super: 0,
          mega: 0,
        },
        streak: 1,
      } satisfies VotingStateResponse,
      { status: 500 }
    );
  }

  try {
    const voterKey = getVoterKey(req);

    // 1) Aktywny sezon
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
        totalVotesToday: 0,
        userRank: 0,
        remainingVotes: {
          standard: DAILY_VOTE_LIMIT,
          super: 0,
          mega: 0,
        },
        streak: 1,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    // 2) Slot z status = 'voting'
    const { data: slot, error: slotError } = await supabase
      .from('story_slots')
      .select('*')
      .eq('season_id', season.id)
      .eq('status', 'voting')
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (slotError) {
      console.error('[GET /api/vote] slotError:', slotError);
    }

    if (!slot) {
      const empty: VotingStateResponse = {
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
      return NextResponse.json(empty, { status: 200 });
    }

    const storySlot = slot as StorySlotRow;

    // 3) Klipy dla tego slotu
    const { data: clipsRaw, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('*')
      .eq('slot_position', storySlot.slot_position)
      .order('created_at', { ascending: true })
      .limit(CLIP_POOL_SIZE);

    if (clipsError) {
      console.error('[GET /api/vote] clipsError:', clipsError);
      const empty: VotingStateResponse = {
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
      return NextResponse.json(empty, { status: 200 });
    }

    const allClips = (clipsRaw || []) as TournamentClipRow[];

    if (allClips.length === 0) {
      const empty: VotingStateResponse = {
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
      return NextResponse.json(empty, { status: 200 });
    }

    // 4) Głosy usera dziś (po voter_key)
    const userVotesToday = await getUserVotesToday(supabase, voterKey);
    const totalVotesToday = userVotesToday.length;
    const dailyRemaining = Math.max(0, DAILY_VOTE_LIMIT - totalVotesToday);

    const votedIds = new Set(userVotesToday.map((v) => v.clip_id));

    // 5) Których klipów user jeszcze nie ocenił
    const remainingClips = allClips.filter((clip) => !votedIds.has(clip.id));

    // jeśli user obejrzał wszystkie, i tak zwracamy listę
    const baseClips = remainingClips.length > 0 ? remainingClips : allClips;

    // 6) Mapowanie do formatu frontowego
    const clipsForClient = baseClips.map((row, index) => {
      const username = row.username || 'Creator';
      const avatar =
        row.avatar_url ||
        `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(
          username
        )}`;

      return {
        id: row.id,
        clip_id: row.id,
        user_id: voterKey,
        thumbnail_url: row.thumbnail_url || row.video_url || '',
        video_url: row.video_url || row.thumbnail_url || '',
        vote_count: row.vote_count ?? 0,
        weighted_score: row.weighted_score ?? row.vote_count ?? 0,
        rank_in_track: index + 1,
        user: {
          username,
          avatar_url: avatar,
          badge_level: row.badge_level ?? 'CREATOR',
        },
        genre: (row.genre as any) ?? (storySlot.genre as any) ?? 'COMEDY',
        duration: row.round_number ?? 8,
        round_number: row.round_number ?? 1,
        total_rounds: (season as SeasonRow).total_slots ?? 75,
        segment_index: (row.segment_index ?? storySlot.slot_position ?? 1) - 1,
        hype_score: row.hype_score ?? row.vote_count ?? 0,
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
    console.error('[GET /api/vote] unexpected error:', error);
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
  if (!supabase) {
    return NextResponse.json(
      { success: false, error: 'Supabase not configured' },
      { status: 500 }
    );
  }

  try {
    const voterKey = getVoterKey(req);
    const body = await req.json().catch(() => null);

    if (!body || !body.clipId) {
      return NextResponse.json(
        { success: false, error: 'clipId is required' },
        { status: 400 }
      );
    }

    const clipId = body.clipId as string;
    const voteType: VoteType = body.voteType ?? 'standard';

    // 1) sprawdzamy dzisiejszy limit 200 (po voter_key)
    const userVotesToday = await getUserVotesToday(supabase, voterKey);
    const totalVotesToday = userVotesToday.length;

    if (totalVotesToday >= DAILY_VOTE_LIMIT) {
      return NextResponse.json(
        {
          success: false,
          error: 'Daily vote limit reached',
        },
        { status: 429 }
      );
    }

    // 2) waga głosu – na przyszłość do hype_score
    const weight = voteType === 'mega' ? 10 : voteType === 'super' ? 3 : 1;

    // 3) zapis głosu – UZUPEŁNIAMY voter_key (kluczowe!)
    const { error: voteError } = await supabase.from('votes').insert({
      clip_id: clipId,
      voter_key: voterKey,
      vote_weight: weight,
      user_id: voterKey,
    });

    // 🔥 if duplicate (unique idx_votes_voter_clip) → traktujemy jako success
    if (voteError && (voteError as any).code !== '23505') {
      console.error('[POST /api/vote] voteError:', voteError);
      return NextResponse.json(
        { success: false, error: 'Failed to save vote' },
        { status: 500 }
      );
    }

    // 4) przeliczamy łączną liczbę głosów na ten clip (unikalne wiersze)
    const { count, error: countError } = await supabase
      .from('votes')
      .select('*', { count: 'exact', head: true })
      .eq('clip_id', clipId);

    if (countError) {
      console.error('[POST /api/vote] countError:', countError);
    }

    const newScore = count ?? 0;
    const newTotalVotesToday = totalVotesToday + 1;

    return NextResponse.json(
      {
        success: true,
        clipId,
        voteType,
        newScore,
        totalVotesToday: newTotalVotesToday,
        remainingVotes: Math.max(0, DAILY_VOTE_LIMIT - newTotalVotesToday),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in POST /api/vote', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cast vote' },
      { status: 500 }
    );
  }
}
