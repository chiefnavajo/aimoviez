// app/api/admin/slots/route.ts
// Admin Slots API - Manage slot statuses and winners
// Requires admin authentication

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/admin/slots
 * Get all slots for a season or active season
 *
 * Query params:
 * - season_id?: string (optional, defaults to active season)
 * - simple?: 'true' (returns just currentSlot, totalSlots, seasonStatus for admin panel)
 */
export async function GET(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);
    const season_id = searchParams.get('season_id');
    const simple = searchParams.get('simple') === 'true';

    // Get active season
    const { data: activeSeason } = await supabase
      .from('seasons')
      .select('id, status, total_slots')
      .eq('status', 'active')
      .maybeSingle();

    if (!activeSeason) {
      // Return empty state if no active season
      return NextResponse.json({
        ok: true,
        currentSlot: 0,
        totalSlots: 75,
        seasonStatus: 'none',
        clipsInSlot: 0,
        slots: [],
      }, { status: 200 });
    }

    const targetSeasonId = season_id || activeSeason.id;
    const totalSlots = activeSeason.total_slots || 75;

    // Get current voting slot
    const { data: votingSlot } = await supabase
      .from('story_slots')
      .select('slot_position, voting_started_at, voting_ends_at, voting_duration_hours')
      .eq('season_id', targetSeasonId)
      .eq('status', 'voting')
      .maybeSingle();

    const currentSlot = votingSlot?.slot_position || 0;
    const votingEndsAt = votingSlot?.voting_ends_at || null;
    const votingStartedAt = votingSlot?.voting_started_at || null;
    const votingDurationHours = votingSlot?.voting_duration_hours || 24;

    // Calculate time remaining
    let timeRemainingSeconds: number | null = null;
    if (votingEndsAt) {
      const endTime = new Date(votingEndsAt).getTime();
      const now = Date.now();
      timeRemainingSeconds = Math.max(0, Math.floor((endTime - now) / 1000));
    }

    // Get clips in current slot
    const { count: clipsInSlot } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('slot_position', currentSlot);

    // If simple mode, return just the summary
    if (simple || !searchParams.has('season_id')) {
      return NextResponse.json({
        ok: true,
        currentSlot,
        totalSlots,
        seasonStatus: activeSeason.status,
        clipsInSlot: clipsInSlot || 0,
        season_id: targetSeasonId,
        // Timer info
        votingEndsAt,
        votingStartedAt,
        votingDurationHours,
        timeRemainingSeconds,
      }, { status: 200 });
    }

    // Full mode: fetch all slots with details
    const { data: slots, error } = await supabase
      .from('story_slots')
      .select('*')
      .eq('season_id', targetSeasonId)
      .order('slot_position', { ascending: true });

    if (error) {
      console.error('[GET /api/admin/slots] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch slots' },
        { status: 500 }
      );
    }

    // Get clip counts and winner details for each slot
    const enrichedSlots = await Promise.all(
      (slots || []).map(async (slot) => {
        // Get clips for this slot
        const { data: clips } = await supabase
          .from('tournament_clips')
          .select('id, vote_count, username, thumbnail_url')
          .eq('slot_position', slot.slot_position)
          .order('vote_count', { ascending: false })
          .limit(5);

        const clip_count = clips?.length || 0;
        const top_clips = clips || [];

        // Get winner details if locked
        let winner_details = null;
        if (slot.winner_tournament_clip_id) {
          const winnerClip = clips?.find((c) => c.id === slot.winner_tournament_clip_id);
          if (winnerClip) {
            winner_details = {
              clip_id: winnerClip.id,
              username: winnerClip.username,
              thumbnail_url: winnerClip.thumbnail_url,
              vote_count: winnerClip.vote_count,
            };
          }
        }

        return {
          ...slot,
          clip_count,
          top_clips: top_clips.slice(0, 3), // Top 3 for preview
          winner_details,
        };
      })
    );

    return NextResponse.json({
      ok: true,
      slots: enrichedSlots,
      season_id: targetSeasonId,
      currentSlot,
      totalSlots,
      seasonStatus: activeSeason.status,
      clipsInSlot: clipsInSlot || 0,
    }, { status: 200 });
  } catch (err: any) {
    console.error('[GET /api/admin/slots] Unexpected error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/slots
 * Update slot status or set winner
 *
 * Body: {
 *   slot_id: string,
 *   status?: 'upcoming' | 'voting' | 'locked' | 'archived',
 *   winning_clip_id?: string (for locking a slot)
 * }
 */
export async function PATCH(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const { slot_id, status, winning_clip_id } = body;

    if (!slot_id) {
      return NextResponse.json(
        { error: 'slot_id is required' },
        { status: 400 }
      );
    }

    // Build update object
    const updates: any = {};
    
    if (status) {
      // If setting to 'voting', ensure only one slot is voting
      if (status === 'voting') {
        const { data: slot } = await supabase
          .from('story_slots')
          .select('season_id')
          .eq('id', slot_id)
          .single();

        if (slot) {
          // Set all other slots in this season to non-voting
          await supabase
            .from('story_slots')
            .update({ status: 'upcoming' })
            .eq('season_id', slot.season_id)
            .eq('status', 'voting')
            .neq('id', slot_id);
        }
      }

      updates.status = status;
    }

    if (winning_clip_id !== undefined) {
      updates.winner_tournament_clip_id = winning_clip_id;
      // If setting a winner, auto-lock the slot
      if (winning_clip_id && !status) {
        updates.status = 'locked';
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      );
    }

    const { data: slot, error } = await supabase
      .from('story_slots')
      .update(updates)
      .eq('id', slot_id)
      .select()
      .single();

    if (error || !slot) {
      console.error('[PATCH /api/admin/slots] error:', error);
      return NextResponse.json(
        { error: 'Failed to update slot' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      slot,
      message: 'Slot updated successfully',
    }, { status: 200 });
  } catch (err: any) {
    console.error('[PATCH /api/admin/slots] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/slots/auto-lock
 * Automatically lock a slot with the highest voted clip
 *
 * Body: {
 *   slot_position: number
 * }
 */
export async function POST(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const { slot_position } = body;

    if (!slot_position) {
      return NextResponse.json(
        { error: 'slot_position is required' },
        { status: 400 }
      );
    }

    // Get active season
    const { data: activeSeason } = await supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active')
      .single();

    if (!activeSeason) {
      return NextResponse.json(
        { error: 'No active season found' },
        { status: 404 }
      );
    }

    // Get the slot
    const { data: slot } = await supabase
      .from('story_slots')
      .select('*')
      .eq('season_id', activeSeason.id)
      .eq('slot_position', slot_position)
      .single();

    if (!slot) {
      return NextResponse.json(
        { error: 'Slot not found' },
        { status: 404 }
      );
    }

    // Get highest voted clip for this slot
    const { data: topClip } = await supabase
      .from('tournament_clips')
      .select('*')
      .eq('slot_position', slot_position)
      .order('vote_count', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!topClip) {
      return NextResponse.json(
        { error: 'No clips found for this slot' },
        { status: 404 }
      );
    }

    // Lock the slot with winner
    const { data: updatedSlot, error } = await supabase
      .from('story_slots')
      .update({
        status: 'locked',
        winner_tournament_clip_id: topClip.id,
      })
      .eq('id', slot.id)
      .select()
      .single();

    if (error) {
      console.error('[POST /api/admin/slots/auto-lock] error:', error);
      return NextResponse.json(
        { error: 'Failed to lock slot' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      slot: updatedSlot,
      winner: {
        clip_id: topClip.id,
        username: topClip.username,
        vote_count: topClip.vote_count,
      },
      message: `Slot #${slot_position} locked with winning clip`,
    }, { status: 200 });
  } catch (err: any) {
    console.error('[POST /api/admin/slots/auto-lock] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
