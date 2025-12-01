// app/api/admin/reset-season/route.ts
// Reset a season for clean voting test
// Requires admin authentication
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/admin/reset-season
 * Reset active season for clean testing
 *
 * Body: {
 *   clear_votes?: boolean (default: false) - Clear all votes
 *   reset_clip_counts?: boolean (default: false) - Reset vote counts on clips
 *   start_slot?: number (default: 1) - Which slot to start voting on
 * }
 */
export async function POST(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json().catch(() => ({}));

    const {
      clear_votes = false,
      reset_clip_counts = false,
      start_slot = 1,
    } = body;

    // 1. Get active season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('id, label, total_slots, status')
      .eq('status', 'active')
      .maybeSingle();

    if (seasonError) {
      console.error('[reset-season] seasonError:', seasonError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch active season', details: seasonError.message },
        { status: 500 }
      );
    }

    if (!season) {
      return NextResponse.json(
        { ok: false, error: 'No active season found' },
        { status: 404 }
      );
    }

    // 2. Reset all story_slots for this season to 'upcoming'
    const { error: resetSlotsError } = await supabase
      .from('story_slots')
      .update({
        status: 'upcoming',
        winner_tournament_clip_id: null,
        voting_started_at: null,
        voting_ends_at: null,
      })
      .eq('season_id', season.id);

    if (resetSlotsError) {
      console.error('[reset-season] resetSlotsError:', resetSlotsError);
      return NextResponse.json(
        { ok: false, error: 'Failed to reset slots', details: resetSlotsError.message },
        { status: 500 }
      );
    }

    // 3. Set the start_slot to 'voting' with timer
    const now = new Date();
    const votingEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const { data: votingSlot, error: setVotingError } = await supabase
      .from('story_slots')
      .update({
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: votingEndsAt.toISOString(),
        voting_duration_hours: 24,
      })
      .eq('season_id', season.id)
      .eq('slot_position', start_slot)
      .select()
      .maybeSingle();

    if (setVotingError) {
      console.error('[reset-season] setVotingError:', setVotingError);
      return NextResponse.json(
        { ok: false, error: 'Failed to set voting slot', details: setVotingError.message },
        { status: 500 }
      );
    }

    // 4. Optionally reset vote counts on clips AND reset clip statuses
    if (reset_clip_counts) {
      // Reset all clips: vote counts to 0, status to 'active', move to slot 1
      const { error: resetClipsError } = await supabase
        .from('tournament_clips')
        .update({
          vote_count: 0,
          weighted_score: 0,
          status: 'active',
          slot_position: start_slot,
        })
        .neq('status', 'rejected'); // Don't touch rejected clips

      if (resetClipsError) {
        console.error('[reset-season] resetClipsError:', resetClipsError);
        // Non-fatal, continue
      } else {
        console.log('[reset-season] Reset all clip counts, statuses, and positions');
      }
    }

    // 5. Optionally clear votes
    if (clear_votes) {
      const { error: clearVotesError } = await supabase
        .from('votes')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

      if (clearVotesError) {
        console.error('[reset-season] clearVotesError:', clearVotesError);
        // Non-fatal, continue
      }
    }

    // 6. Get clips available for the voting slot
    const { data: clipsInSlot, count: clipCount } = await supabase
      .from('tournament_clips')
      .select('id, username, vote_count, genre, thumbnail_url', { count: 'exact' })
      .eq('slot_position', start_slot)
      .order('vote_count', { ascending: false })
      .limit(10);

    return NextResponse.json({
      ok: true,
      message: `Season "${season.label || 'Season'}" reset successfully`,
      season_id: season.id,
      voting_slot: start_slot,
      voting_ends_at: votingEndsAt.toISOString(),
      clips_in_slot: clipCount || 0,
      top_clips: clipsInSlot || [],
      actions: {
        slots_reset: true,
        votes_cleared: clear_votes,
        clip_counts_reset: reset_clip_counts,
      },
    }, { status: 200 });

  } catch (err: any) {
    console.error('[reset-season] Unexpected error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
