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

// Helper to auto-create the next season when one finishes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createNextSeason(
  supabase: any,
  finishedSeasonId: string
): Promise<{ success: boolean; newSeasonId?: string; newSeasonLabel?: string; error?: string }> {
  try {
    // Get the finished season's details
    const { data: finishedSeason } = await supabase
      .from('seasons')
      .select('label, total_slots')
      .eq('id', finishedSeasonId)
      .single();

    if (!finishedSeason) {
      return { success: false, error: 'Could not find finished season' };
    }

    // Parse season number from label (e.g., "Season 1 – Genesis" -> 1)
    const labelMatch = finishedSeason.label?.match(/Season\s*(\d+)/i);
    const seasonNumber = labelMatch ? parseInt(labelMatch[1], 10) + 1 : 2;
    const newLabel = `Season ${seasonNumber}`;
    const totalSlots = finishedSeason.total_slots || 75;

    // Create new season with 'active' status
    const { data: newSeason, error: seasonError } = await supabase
      .from('seasons')
      .insert({
        label: newLabel,
        total_slots: totalSlots,
        status: 'active',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (seasonError || !newSeason) {
      console.error('[auto-advance] Failed to create new season:', seasonError);
      return { success: false, error: 'Failed to create new season' };
    }

    // Create slots for the new season
    const slots = Array.from({ length: totalSlots }, (_, i) => ({
      season_id: newSeason.id,
      slot_position: i + 1,
      status: i === 0 ? 'voting' : 'upcoming', // First slot starts voting
      voting_started_at: i === 0 ? new Date().toISOString() : null,
      voting_ends_at: i === 0 ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
      voting_duration_hours: 24,
      created_at: new Date().toISOString(),
    }));

    const { error: slotsError } = await supabase
      .from('story_slots')
      .insert(slots);

    if (slotsError) {
      console.error('[auto-advance] Failed to create slots for new season:', slotsError);
      // Clean up the season if slots failed
      await supabase.from('seasons').delete().eq('id', newSeason.id);
      return { success: false, error: 'Failed to create slots for new season' };
    }

    console.log(`[auto-advance] Auto-created ${newLabel} with ${totalSlots} slots`);
    return { success: true, newSeasonId: newSeason.id, newSeasonLabel: newLabel };
  } catch (err) {
    console.error('[auto-advance] Error creating next season:', err);
    return { success: false, error: 'Unexpected error creating next season' };
  }
}

export async function GET(req: NextRequest) {
  // Verify request is from Vercel Cron
  // Vercel sends this header automatically for cron jobs
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Check for Vercel's CRON_SECRET verification
  // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // If CRON_SECRET is set but doesn't match, reject
    console.error('[auto-advance] Invalid CRON_SECRET');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // If no CRON_SECRET is set, allow for development/testing
  if (!cronSecret) {
    console.warn('[auto-advance] CRON_SECRET not configured - running without auth');
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
          // No clips in slot - mark as locked (empty) and finish season
          // This prevents zombie voting slots with no clips
          console.log(`[auto-advance] Slot ${slot.slot_position} has no clips - marking as locked and finishing season`);

          await supabase
            .from('story_slots')
            .update({ status: 'locked' })
            .eq('id', slot.id);

          // Finish the season since there are no more clips to vote on
          await supabase
            .from('seasons')
            .update({ status: 'finished' })
            .eq('id', slot.season_id);

          // Auto-create next season
          const nextSeasonResult = await createNextSeason(supabase, slot.season_id);

          results.push({
            slot_position: slot.slot_position,
            status: 'finished_empty',
            reason: 'No clips in slot - season finished',
            next_season_created: nextSeasonResult.success,
            next_season_label: nextSeasonResult.newSeasonLabel,
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
        const { data: movedClips } = await supabase
          .from('tournament_clips')
          .update({
            slot_position: nextSlotPosition,
            vote_count: 0,  // Reset votes for new round
            weighted_score: 0,
            hype_score: 0,
          })
          .eq('slot_position', slot.slot_position)
          .eq('season_id', slot.season_id)
          .eq('status', 'active')  // Only move active clips (not the locked winner)
          .select('id');

        const clipsMovedCount = movedClips?.length ?? 0;

        // Check if this was the last slot OR if no clips remain
        const totalSlots = slot.seasons?.total_slots || 75;
        const nextPosition = slot.slot_position + 1;

        // Finish season if: reached max slots OR no more clips to vote on
        if (nextPosition > totalSlots || clipsMovedCount === 0) {
          // Finish the season
          await supabase
            .from('seasons')
            .update({ status: 'finished' })
            .eq('id', slot.season_id);

          const reason = nextPosition > totalSlots
            ? 'Season completed!'
            : 'No more clips to vote on - season finished';

          // Auto-create next season
          const nextSeasonResult = await createNextSeason(supabase, slot.season_id);

          results.push({
            slot_position: slot.slot_position,
            status: 'finished',
            winner_clip_id: topClip.id,
            winner_username: topClip.username,
            message: reason,
            clips_remaining: clipsMovedCount,
            next_season_created: nextSeasonResult.success,
            next_season_label: nextSeasonResult.newSeasonLabel,
          });
          continue;
        }

        // Activate next slot with new timer (only if there are clips to vote on)
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
          next_ends_at: votingEndsAt.toISOString(),
          clips_in_next_slot: clipsMovedCount
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
