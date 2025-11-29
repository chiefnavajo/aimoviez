// app/api/admin/advance-slot/route.ts
// Zamknięcie aktualnego slotu i przejście do następnego
// Requires admin authentication
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';

function createSupabaseServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('[advance-slot] Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
}

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
  winner_tournament_clip_id?: string | null;
  voting_duration_hours?: number | null;
}

interface TournamentClipRow {
  id: string;
  slot_position: number;
  vote_count: number | null;
  weighted_score: number | null;
}

export async function POST(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

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
      console.error('[advance-slot] seasonError:', seasonError);
      return NextResponse.json(
        { ok: false, error: 'Failed to load active season' },
        { status: 500 }
      );
    }

    if (!season) {
      return NextResponse.json(
        { ok: false, error: 'No active season found' },
        { status: 400 }
      );
    }

    const seasonRow = season as SeasonRow;

    // 2. Aktywny slot (status = 'voting')
    const { data: slot, error: slotError } = await supabase
      .from('story_slots')
      .select('*')
      .eq('season_id', seasonRow.id)
      .eq('status', 'voting')
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (slotError) {
      console.error('[advance-slot] slotError:', slotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to load active slot' },
        { status: 500 }
      );
    }

    if (!slot) {
      return NextResponse.json(
        { ok: false, error: 'No active slot with status=voting' },
        { status: 400 }
      );
    }

    const storySlot = slot as StorySlotRow;

    // 3. OPTIMIZED: Get winner directly from database (single query, no JS loop)
    const { data: winner, error: winnerError } = await supabase
      .from('tournament_clips')
      .select('id, slot_position, vote_count, weighted_score')
      .eq('slot_position', storySlot.slot_position)
      .order('weighted_score', { ascending: false, nullsFirst: false })
      .order('vote_count', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (winnerError) {
      console.error('[advance-slot] winnerError:', winnerError);
      return NextResponse.json(
        { ok: false, error: 'Failed to find winner for active slot' },
        { status: 500 }
      );
    }

    if (!winner) {
      return NextResponse.json(
        {
          ok: false,
          error: 'No clips found for current slot – cannot choose winner',
        },
        { status: 400 }
      );
    }

    // 5. Zamknij aktywny slot: status = 'locked', ustaw winner_tournament_clip_id
    const { error: updateSlotError } = await supabase
      .from('story_slots')
      .update({
        status: 'locked',
        winner_tournament_clip_id: winner.id,
      })
      .eq('id', storySlot.id);

    if (updateSlotError) {
      console.error('[advance-slot] updateSlotError:', updateSlotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to lock current slot' },
        { status: 500 }
      );
    }

    // 6. Przygotuj następny slot
    const nextPosition = storySlot.slot_position + 1;

    // Jeśli nie znamy total_slots, spróbujmy z SeasonRow.total_slots, inaczej przyjmij 75
    const totalSlots = seasonRow.total_slots ?? 75;

    if (nextPosition > totalSlots) {
      // Nie ma kolejnego slotu – kończymy Season
      const { error: finishSeasonError } = await supabase
        .from('seasons')
        .update({ status: 'finished' })
        .eq('id', seasonRow.id);

      if (finishSeasonError) {
        console.error('[advance-slot] finishSeasonError:', finishSeasonError);
        return NextResponse.json(
          {
            ok: false,
            error:
              'Current slot locked, but failed to mark season as finished',
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          ok: true,
          finished: true,
          message: 'Last slot locked, season finished',
          winnerClipId: winner.id,
        },
        { status: 200 }
      );
    }

    // 7. Ustaw następny slot na 'voting' with timer
    const durationHours = storySlot.voting_duration_hours || 24;
    const now = new Date();
    const votingEndsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

    const { data: nextSlot, error: nextSlotError } = await supabase
      .from('story_slots')
      .update({ 
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: votingEndsAt.toISOString(),
        voting_duration_hours: durationHours,
      })
      .eq('season_id', seasonRow.id)
      .eq('slot_position', nextPosition)
      .select('*')
      .maybeSingle();

    if (nextSlotError) {
      console.error('[advance-slot] nextSlotError:', nextSlotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to activate next slot' },
        { status: 500 }
      );
    }

    if (!nextSlot) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No next slot found to set as voting – data inconsistency in story_slots',
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        finished: false,
        currentSlotLocked: storySlot.slot_position,
        winnerClipId: winner.id,
        nextSlotPosition: nextPosition,
        votingEndsAt: votingEndsAt.toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[advance-slot] Unexpected error:', error);
    return NextResponse.json(
      { ok: false, error: 'Unexpected error during advance-slot' },
      { status: 500 }
    );
  }
}
