// app/api/story/route.ts
// Zwraca zaakceptowane segmenty (winners) dla aktywnego Season – pod Story player

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[story] Missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables'
  );
}

function createSupabaseServerClient() {
  return createClient(supabaseUrl!, supabaseKey!);
}

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
  video_url: string | null;
  thumbnail_url: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface StorySegment {
  slot_position: number;
  clip_id: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string | null;
}

interface StoryResponse {
  seasonLabel: string;
  totalSlots: number;
  lockedSlots: number;
  segments: StorySegment[];
}

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServerClient();

  try {
    // 1. Aktywny Season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (seasonError) {
      console.error('[GET /api/story] seasonError:', seasonError);
      return NextResponse.json(
        { error: 'Failed to load active season' },
        { status: 500 }
      );
    }

    if (!season) {
      const empty: StoryResponse = {
        seasonLabel: 'No active season',
        totalSlots: 0,
        lockedSlots: 0,
        segments: [],
      };
      return NextResponse.json(empty, { status: 200 });
    }

    const seasonRow = season as SeasonRow;
    const totalSlots = seasonRow.total_slots ?? 75;

    // 2. Sloty z winnerem (status = 'locked' i winner_tournament_clip_id IS NOT NULL)
    const { data: slots, error: slotsError } = await supabase
      .from('story_slots')
      .select('*')
      .eq('season_id', seasonRow.id)
      .eq('status', 'locked')
      .not('winner_tournament_clip_id', 'is', null)
      .order('slot_position', { ascending: true });

    if (slotsError) {
      console.error('[GET /api/story] slotsError:', slotsError);
      return NextResponse.json(
        { error: 'Failed to load story slots' },
        { status: 500 }
      );
    }

    const lockedSlotsRows = (slots as StorySlotRow[]) || [];
    const lockedSlotsCount = lockedSlotsRows.length;

    if (lockedSlotsCount === 0) {
      const empty: StoryResponse = {
        seasonLabel: seasonRow.label ?? 'Active season',
        totalSlots,
        lockedSlots: 0,
        segments: [],
      };
      return NextResponse.json(empty, { status: 200 });
    }

    const winnerIds = lockedSlotsRows
      .map((s) => s.winner_tournament_clip_id)
      .filter((id): id is string => !!id);

    // 3. Pobierz klipy-winners z tournament_clips
    const { data: clips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url, username, avatar_url')
      .in('id', winnerIds);

    if (clipsError) {
      console.error('[GET /api/story] clipsError:', clipsError);
      return NextResponse.json(
        { error: 'Failed to load winner clips' },
        { status: 500 }
      );
    }

    const clipRows = (clips as TournamentClipRow[]) || [];

    // Zbuduj mapę clipId -> clip
    const clipMap = new Map<string, TournamentClipRow>();
    for (const c of clipRows) {
      clipMap.set(c.id, c);
    }

    // 4. Zbuduj listę segmentów w kolejności slot_position
    const segments: StorySegment[] = lockedSlotsRows
      .map((slot) => {
        const clipId = slot.winner_tournament_clip_id!;
        const clip = clipMap.get(clipId);
        if (!clip) return null;

        return {
          slot_position: slot.slot_position,
          clip_id: clip.id,
          video_url: clip.video_url || '',
          thumbnail_url: clip.thumbnail_url || '',
          username: clip.username || 'creator',
          avatar_url: clip.avatar_url,
        };
      })
      .filter((s): s is StorySegment => s !== null);

    const response: StoryResponse = {
      seasonLabel: seasonRow.label ?? 'Active season',
      totalSlots,
      lockedSlots: segments.length,
      segments,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[GET /api/story] Unexpected error:', error);
    const fallback: StoryResponse = {
      seasonLabel: 'Error',
      totalSlots: 0,
      lockedSlots: 0,
      segments: [],
    };
    return NextResponse.json(fallback, { status: 500 });
  }
}
