// app/api/cron/auto-advance/route.ts
// ============================================
// AUTO-ADVANCE CRON JOB
// Checks for expired voting slots and advances them
// Call this via Vercel Cron or external service every minute
// ============================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }
  
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  // REQUIRED: Verify cron secret for security
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Fail if CRON_SECRET is not configured
  if (!cronSecret) {
    console.error('[auto-advance] CRON_SECRET not configured');
    return NextResponse.json({ error: 'Service not configured' }, { status: 503 });
  }

  // Validate authorization header
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseClient();

  try {
    // 1. Find expired voting slots
    const { data: expiredSlots, error: findError } = await supabase
      .from('story_slots')
      .select('*, seasons!inner(id, status, total_slots)')
      .eq('status', 'voting')
      .eq('seasons.status', 'active')
      .lt('voting_ends_at', new Date().toISOString())
      .order('slot_position', { ascending: true });

    if (findError) {
      console.error('[auto-advance] Find error:', findError);
      return NextResponse.json({ error: 'Failed to find expired slots' }, { status: 500 });
    }

    if (!expiredSlots || expiredSlots.length === 0) {
      return NextResponse.json({ 
        ok: true, 
        message: 'No expired slots to advance',
        checked_at: new Date().toISOString()
      });
    }

    const results = [];

    // 2. Process each expired slot
    for (const slot of expiredSlots) {
      try {
        // Get highest voted clip for this slot (filter by season_id for safety)
        const { data: topClip } = await supabase
          .from('tournament_clips')
          .select('id, weighted_score, vote_count, username')
          .eq('slot_position', slot.slot_position)
          .eq('season_id', slot.season_id)
          .eq('status', 'active')
          .order('weighted_score', { ascending: false, nullsFirst: false })
          .order('vote_count', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        if (!topClip) {
          // No clips in slot - skip but log
          results.push({
            slot_position: slot.slot_position,
            status: 'skipped',
            reason: 'No clips in slot'
          });
          continue;
        }

        // Lock the current slot with winner
        const { error: lockError } = await supabase
          .from('story_slots')
          .update({
            status: 'locked',
            winner_tournament_clip_id: topClip.id,
          })
          .eq('id', slot.id);

        if (lockError) {
          console.error('[auto-advance] Lock error:', lockError);
          results.push({
            slot_position: slot.slot_position,
            status: 'error',
            reason: 'Failed to lock slot'
          });
          continue;
        }

        // Update clip status: winner gets 'locked'
        await supabase
          .from('tournament_clips')
          .update({ status: 'locked' })
          .eq('id', topClip.id);

        // Move losing clips to next slot (they continue competing)
        const nextSlotPosition = slot.slot_position + 1;
        await supabase
          .from('tournament_clips')
          .update({
            slot_position: nextSlotPosition,
            vote_count: 0,  // Reset votes for new round
            weighted_score: 0,
            hype_score: 0,
          })
          .eq('slot_position', slot.slot_position)
          .eq('season_id', slot.season_id)
          .eq('status', 'active');  // Only move active clips (not the locked winner)

        // Check if this was the last slot
        const totalSlots = slot.seasons?.total_slots || 75;
        const nextPosition = slot.slot_position + 1;

        if (nextPosition > totalSlots) {
          // Finish the season
          await supabase
            .from('seasons')
            .update({ status: 'finished' })
            .eq('id', slot.season_id);

          results.push({
            slot_position: slot.slot_position,
            status: 'finished',
            winner_clip_id: topClip.id,
            winner_username: topClip.username,
            message: 'Season completed!'
          });
          continue;
        }

        // Activate next slot with new timer
        const durationHours = slot.voting_duration_hours || 24;
        const now = new Date();
        const votingEndsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

        const { error: nextError } = await supabase
          .from('story_slots')
          .update({
            status: 'voting',
            voting_started_at: now.toISOString(),
            voting_ends_at: votingEndsAt.toISOString(),
            voting_duration_hours: durationHours,
          })
          .eq('season_id', slot.season_id)
          .eq('slot_position', nextPosition);

        if (nextError) {
          console.error('[auto-advance] Next slot error:', nextError);
          results.push({
            slot_position: slot.slot_position,
            status: 'partial',
            reason: 'Locked but failed to activate next slot',
            winner_clip_id: topClip.id
          });
          continue;
        }

        results.push({
          slot_position: slot.slot_position,
          status: 'advanced',
          winner_clip_id: topClip.id,
          winner_username: topClip.username,
          winner_score: topClip.weighted_score,
          next_slot: nextPosition,
          next_ends_at: votingEndsAt.toISOString()
        });

      } catch (slotError) {
        console.error('[auto-advance] Slot processing error:', slotError);
        results.push({
          slot_position: slot.slot_position,
          status: 'error',
          reason: 'Processing exception'
        });
      }
    }

    return NextResponse.json({
      ok: true,
      processed: results.length,
      results,
      checked_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('[auto-advance] Unexpected error:', error);
    return NextResponse.json({ 
      ok: false, 
      error: 'Unexpected error during auto-advance' 
    }, { status: 500 });
  }
}

// POST endpoint for manual trigger from admin
export async function POST(req: NextRequest) {
  return GET(req);
}
