// app/api/admin/assign-winner/route.ts
// Manually assign a winning clip for the active slot
// Requires admin authentication
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';

function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('[assign-winner] Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * POST /api/admin/assign-winner
 * Manually assign a winner for the current voting slot
 *
 * Body: {
 *   clipId: string - The ID of the clip to set as winner
 *   advanceSlot?: boolean (default: true) - Whether to advance to the next slot
 * }
 */
export async function POST(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const supabase = createSupabaseServerClient();

  try {
    const body = await req.json().catch(() => ({}));
    const { clipId, advanceSlot = true } = body;

    if (!clipId) {
      return NextResponse.json(
        { ok: false, error: 'clipId is required' },
        { status: 400 }
      );
    }

    // 1. Get active season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('id, status, total_slots')
      .eq('status', 'active')
      .maybeSingle();

    if (seasonError) {
      console.error('[assign-winner] seasonError:', seasonError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch active season' },
        { status: 500 }
      );
    }

    if (!season) {
      return NextResponse.json(
        { ok: false, error: 'No active season found' },
        { status: 404 }
      );
    }

    // 2. Get active voting slot
    const { data: activeSlot, error: slotError } = await supabase
      .from('story_slots')
      .select('id, slot_position, voting_duration_hours')
      .eq('season_id', season.id)
      .eq('status', 'voting')
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (slotError) {
      console.error('[assign-winner] slotError:', slotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch active slot' },
        { status: 500 }
      );
    }

    if (!activeSlot) {
      return NextResponse.json(
        { ok: false, error: 'No active voting slot found' },
        { status: 400 }
      );
    }

    // 3. Verify the clip exists and is in the current slot
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, title, username, slot_position, status, vote_count')
      .eq('id', clipId)
      .maybeSingle();

    if (clipError) {
      console.error('[assign-winner] clipError:', clipError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch clip' },
        { status: 500 }
      );
    }

    if (!clip) {
      return NextResponse.json(
        { ok: false, error: 'Clip not found' },
        { status: 404 }
      );
    }

    if (clip.slot_position !== activeSlot.slot_position) {
      return NextResponse.json(
        {
          ok: false,
          error: `Clip is in slot ${clip.slot_position}, but current voting slot is ${activeSlot.slot_position}`
        },
        { status: 400 }
      );
    }

    if (clip.status !== 'active') {
      return NextResponse.json(
        { ok: false, error: `Cannot select clip with status "${clip.status}" as winner. Only "active" clips can win.` },
        { status: 400 }
      );
    }

    // 4. Lock the current slot with the selected winner
    const { error: lockSlotError } = await supabase
      .from('story_slots')
      .update({
        status: 'locked',
        winner_tournament_clip_id: clipId,
      })
      .eq('id', activeSlot.id);

    if (lockSlotError) {
      console.error('[assign-winner] lockSlotError:', lockSlotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to lock slot with winner' },
        { status: 500 }
      );
    }

    // 5. Mark the winning clip as 'locked'
    const { error: lockClipError } = await supabase
      .from('tournament_clips')
      .update({ status: 'locked' })
      .eq('id', clipId);

    if (lockClipError) {
      console.error('[assign-winner] lockClipError:', lockClipError);
      // Non-fatal, continue
    }

    // 6. If advanceSlot is true, set up the next slot
    let nextSlotInfo = null;
    let clipsMovedCount = 0;

    if (advanceSlot) {
      const nextPosition = activeSlot.slot_position + 1;
      const totalSlots = season.total_slots ?? 75;

      if (nextPosition > totalSlots) {
        // Season is finished
        const { error: finishError } = await supabase
          .from('seasons')
          .update({ status: 'finished' })
          .eq('id', season.id);

        if (finishError) {
          console.error('[assign-winner] finishError:', finishError);
        }

        return NextResponse.json({
          ok: true,
          message: `Winner assigned: "${clip.title}" by ${clip.username}. Season finished!`,
          winnerClipId: clipId,
          winnerTitle: clip.title,
          winnerUsername: clip.username,
          slotLocked: activeSlot.slot_position,
          seasonFinished: true,
        });
      }

      // Set next slot to voting
      const durationHours = activeSlot.voting_duration_hours || 24;
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
        .eq('season_id', season.id)
        .eq('slot_position', nextPosition)
        .select('id, slot_position')
        .maybeSingle();

      if (nextSlotError) {
        console.error('[assign-winner] nextSlotError:', nextSlotError);
      } else if (nextSlot) {
        nextSlotInfo = {
          position: nextSlot.slot_position,
          votingEndsAt: votingEndsAt.toISOString(),
        };
      }

      // Move non-winning clips to next slot with reset votes
      const { data: movedClips, error: moveError } = await supabase
        .from('tournament_clips')
        .update({
          slot_position: nextPosition,
          vote_count: 0,
          weighted_score: 0,
        })
        .eq('slot_position', activeSlot.slot_position)
        .eq('status', 'active')
        .neq('id', clipId)
        .select('id');

      if (moveError) {
        console.error('[assign-winner] moveError:', moveError);
      } else {
        clipsMovedCount = movedClips?.length ?? 0;
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Winner assigned: "${clip.title}" by ${clip.username}`,
      winnerClipId: clipId,
      winnerTitle: clip.title,
      winnerUsername: clip.username,
      winnerVotes: clip.vote_count,
      slotLocked: activeSlot.slot_position,
      nextSlot: nextSlotInfo,
      clipsMovedToNextSlot: clipsMovedCount,
    });

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[assign-winner] Unexpected error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
