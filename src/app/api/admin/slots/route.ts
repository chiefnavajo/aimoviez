// app/api/admin/slots/route.ts
// Admin Slots API - Manage slot statuses and winners
// Requires admin authentication

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';

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
  // Rate limit check
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);
    const season_id = searchParams.get('season_id');
    const simple = searchParams.get('simple') === 'true';

    // Get target season - either by ID or first active season
    let targetSeason = null;

    if (season_id) {
      // Fetch specific season by ID
      const { data } = await supabase
        .from('seasons')
        .select('id, status, total_slots')
        .eq('id', season_id)
        .maybeSingle();
      targetSeason = data;
    } else {
      // Fallback to first active season
      const { data } = await supabase
        .from('seasons')
        .select('id, status, total_slots')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      targetSeason = data;
    }

    if (!targetSeason) {
      // Return empty state if no season found
      return NextResponse.json({
        ok: true,
        currentSlot: 0,
        totalSlots: 75,
        seasonStatus: 'none',
        clipsInSlot: 0,
        slots: [],
      }, { status: 200 });
    }

    const targetSeasonId = targetSeason.id;
    const totalSlots = targetSeason.total_slots || 75;
    const seasonStatus = targetSeason.status;

    // Get current voting or waiting_for_clips slot
    let slotStatus: 'upcoming' | 'voting' | 'locked' | 'waiting_for_clips' = 'upcoming';
    let votingSlot = null;

    // First check for voting slot
    const { data: activeVotingSlot } = await supabase
      .from('story_slots')
      .select('slot_position, status, voting_started_at, voting_ends_at, voting_duration_hours')
      .eq('season_id', targetSeasonId)
      .eq('status', 'voting')
      .maybeSingle();

    if (activeVotingSlot) {
      votingSlot = activeVotingSlot;
      slotStatus = 'voting';
    } else {
      // Check for waiting_for_clips slot
      const { data: waitingSlot } = await supabase
        .from('story_slots')
        .select('slot_position, status, voting_started_at, voting_ends_at, voting_duration_hours')
        .eq('season_id', targetSeasonId)
        .eq('status', 'waiting_for_clips')
        .maybeSingle();

      if (waitingSlot) {
        votingSlot = waitingSlot;
        slotStatus = 'waiting_for_clips';
      }
    }

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

    // Get clips in current slot (only count active/approved clips that are actually competing)
    const { count: clipsInSlot } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('slot_position', currentSlot)
      .eq('season_id', targetSeasonId)
      .eq('status', 'active');

    // If simple mode, return just the summary
    if (simple || !searchParams.has('season_id')) {
      return NextResponse.json({
        ok: true,
        currentSlot,
        totalSlots,
        seasonStatus,
        slotStatus,
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
      .select('id, slot_position, status, season_id, winner_tournament_clip_id, voting_started_at, voting_ends_at, voting_duration_hours, created_at, direction_voting_status, direction_voting_ends_at, winning_direction_id')
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
          .eq('season_id', targetSeasonId)
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
      seasonStatus,
      slotStatus,
      clipsInSlot: clipsInSlot || 0,
    }, { status: 200 });
  } catch (err) {
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
 *   status?: 'upcoming' | 'voting' | 'locked' | 'archived' | 'waiting_for_clips',
 *   winning_clip_id?: string (for locking a slot),
 *   unlock?: boolean (to unlock a locked slot - clears winner and sets to voting),
 *   revert_clip_to_pending?: boolean (when unlocking, also set the winning clip back to pending)
 * }
 */
export async function PATCH(req: NextRequest) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const { slot_id, status, winning_clip_id, unlock, revert_clip_to_pending } = body;

    if (!slot_id) {
      return NextResponse.json(
        { error: 'slot_id is required' },
        { status: 400 }
      );
    }

    // ========================================================================
    // UNLOCK SLOT - Special action to revert a locked slot
    // ========================================================================
    if (unlock === true) {
      // Get the slot to unlock
      const { data: slotToUnlock } = await supabase
        .from('story_slots')
        .select('id, season_id, slot_position, status, winner_tournament_clip_id')
        .eq('id', slot_id)
        .single();

      if (!slotToUnlock) {
        return NextResponse.json(
          { error: 'Slot not found' },
          { status: 404 }
        );
      }

      if (slotToUnlock.status !== 'locked') {
        return NextResponse.json(
          { error: `Slot is not locked (current status: ${slotToUnlock.status})` },
          { status: 400 }
        );
      }

      const previousWinnerId = slotToUnlock.winner_tournament_clip_id;

      // Check if there's already a voting slot in this season
      const { data: existingVotingSlot } = await supabase
        .from('story_slots')
        .select('id, slot_position')
        .eq('season_id', slotToUnlock.season_id)
        .eq('status', 'voting')
        .maybeSingle();

      // Determine if the unlocked slot should become the new voting slot
      // Rule: The lowest-positioned unlocked slot should be voting
      const unlockedSlotPosition = slotToUnlock.slot_position;
      const shouldBecomeVoting = !existingVotingSlot || unlockedSlotPosition < existingVotingSlot.slot_position;

      let deactivatedSlot: { slot_position: number } | null = null;
      let movedClipsCount = 0;

      if (existingVotingSlot && shouldBecomeVoting) {
        // Unlocked slot has lower position - it should become voting
        // Move clips from the existing voting slot to the unlocked slot
        const { data: clipsToMove, error: fetchClipsError } = await supabase
          .from('tournament_clips')
          .select('id')
          .eq('slot_position', existingVotingSlot.slot_position)
          .in('status', ['pending', 'active']);

        if (fetchClipsError) {
          console.error('[PATCH /api/admin/slots] Failed to fetch clips to move:', fetchClipsError);
        } else if (clipsToMove && clipsToMove.length > 0) {
          const { error: moveClipsError } = await supabase
            .from('tournament_clips')
            .update({
              slot_position: unlockedSlotPosition,
              segment_index: unlockedSlotPosition
            })
            .eq('slot_position', existingVotingSlot.slot_position)
            .in('status', ['pending', 'active']);

          if (moveClipsError) {
            console.error('[PATCH /api/admin/slots] Failed to move clips:', moveClipsError);
          } else {
            movedClipsCount = clipsToMove.length;
            console.log(`[PATCH /api/admin/slots] Moved ${movedClipsCount} clips from slot ${existingVotingSlot.slot_position} to slot ${unlockedSlotPosition}`);
          }
        }

        // Deactivate the existing voting slot (set to upcoming)
        const { error: deactivateError } = await supabase
          .from('story_slots')
          .update({
            status: 'upcoming',
            voting_started_at: null,
            voting_ends_at: null,
          })
          .eq('id', existingVotingSlot.id);

        if (deactivateError) {
          console.error('[PATCH /api/admin/slots] Failed to deactivate existing voting slot:', deactivateError);
          return NextResponse.json(
            { error: 'Failed to deactivate current voting slot' },
            { status: 500 }
          );
        }

        deactivatedSlot = { slot_position: existingVotingSlot.slot_position };
        console.log(`[PATCH /api/admin/slots] Deactivated slot ${existingVotingSlot.slot_position} (was voting, lower slot ${unlockedSlotPosition} unlocked)`);
      }

      // Unlock the slot: clear winner and set appropriate status
      // If this slot should be voting (lowest position), set to 'voting'
      // If a lower slot is already voting, set this to 'upcoming' (waiting its turn)
      const newStatus = shouldBecomeVoting ? 'voting' : 'upcoming';
      const updateData: Record<string, unknown> = {
        status: newStatus,
        winner_tournament_clip_id: null,
      };

      // Only set voting timestamps if this slot becomes the voting slot
      if (shouldBecomeVoting) {
        updateData.voting_started_at = new Date().toISOString();
        updateData.voting_ends_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
      } else {
        updateData.voting_started_at = null;
        updateData.voting_ends_at = null;
      }

      const { data: unlockedSlot, error: unlockError } = await supabase
        .from('story_slots')
        .update(updateData)
        .eq('id', slot_id)
        .select()
        .single();

      if (unlockError) {
        console.error('[PATCH /api/admin/slots] unlock error:', unlockError);
        return NextResponse.json(
          { error: 'Failed to unlock slot' },
          { status: 500 }
        );
      }

      // H5: Always revert the winning clip — default to 'active', or 'pending' if requested
      let clipReverted = false;
      if (previousWinnerId) {
        const revertStatus = revert_clip_to_pending ? 'pending' : 'active';
        const { error: clipError } = await supabase
          .from('tournament_clips')
          .update({ status: revertStatus, updated_at: new Date().toISOString() })
          .eq('id', previousWinnerId);

        if (clipError) {
          console.warn('[PATCH /api/admin/slots] Failed to revert clip status:', clipError);
        } else {
          clipReverted = true;
        }
      }

      console.log(`[PATCH /api/admin/slots] Unlocked slot ${unlockedSlotPosition}, status: ${newStatus}, previous winner: ${previousWinnerId}, clip reverted: ${clipReverted}, deactivated slot: ${deactivatedSlot?.slot_position || 'none'}, moved clips: ${movedClipsCount}`);

      // Build response message based on what happened
      let message: string;
      if (shouldBecomeVoting) {
        message = `Slot #${unlockedSlotPosition} unlocked and set to voting`;
      } else {
        message = `Slot #${unlockedSlotPosition} unlocked and set to upcoming (slot ${existingVotingSlot!.slot_position} is currently voting)`;
      }

      return NextResponse.json({
        success: true,
        slot: unlockedSlot,
        message,
        newStatus,
        previousWinnerId,
        clipReverted,
        movedClipsCount,
        ...(existingVotingSlot && !shouldBecomeVoting && {
          currentVotingSlot: existingVotingSlot.slot_position,
          info: `Slot ${existingVotingSlot.slot_position} remains as the active voting slot (lower position)`,
        }),
        ...(deactivatedSlot && {
          deactivatedSlot: deactivatedSlot.slot_position,
          warning: `Slot ${deactivatedSlot.slot_position} was deactivated, ${movedClipsCount} clip(s) moved to slot ${unlockedSlotPosition}`,
        }),
      }, { status: 200 });
    }

    // ========================================================================
    // NORMAL UPDATE - status change or set winner
    // ========================================================================

    // Build update object
    const updates: Record<string, unknown> = {};
    let previousVotingSlot: { id: string; slot_position: number } | null = null;

    if (status) {
      // Get the slot we're trying to update
      const { data: targetSlot } = await supabase
        .from('story_slots')
        .select('season_id, slot_position, status')
        .eq('id', slot_id)
        .single();

      if (!targetSlot) {
        return NextResponse.json(
          { error: 'Slot not found' },
          { status: 404 }
        );
      }

      // Validate status transitions
      if (status === 'voting' && targetSlot.status === 'locked') {
        return NextResponse.json(
          { error: 'Cannot change locked slot back to voting. Use reset-season instead.' },
          { status: 400 }
        );
      }

      // If setting to 'voting', check for existing voting slot
      if (status === 'voting') {
        const { data: existingVotingSlot } = await supabase
          .from('story_slots')
          .select('id, slot_position')
          .eq('season_id', targetSlot.season_id)
          .eq('status', 'voting')
          .neq('id', slot_id)
          .maybeSingle();

        if (existingVotingSlot) {
          // Check if force flag is provided
          const force = body.force === true;

          if (!force) {
            return NextResponse.json(
              {
                error: `Slot ${existingVotingSlot.slot_position} is already in voting status. Only one slot can be voting at a time.`,
                existingVotingSlot: existingVotingSlot.slot_position,
                hint: 'Set force: true to override and set the existing voting slot to upcoming.'
              },
              { status: 409 } // Conflict
            );
          }

          // Force mode: Set existing voting slot to upcoming
          const { error: resetError } = await supabase
            .from('story_slots')
            .update({ status: 'upcoming' })
            .eq('id', existingVotingSlot.id);

          if (resetError) {
            console.error('[PATCH /api/admin/slots] Failed to reset existing voting slot:', resetError);
            return NextResponse.json(
              { error: 'Failed to reset existing voting slot' },
              { status: 500 }
            );
          }

          previousVotingSlot = existingVotingSlot;
          console.log(`[PATCH /api/admin/slots] Force mode: Reset slot ${existingVotingSlot.slot_position} to upcoming`);
        }
      }

      updates.status = status;

      // If setting to 'voting', also set voting timestamps
      if (status === 'voting') {
        updates.voting_started_at = new Date().toISOString();
        updates.voting_ends_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
      }
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

    // H4: If a winning_clip_id was set (slot auto-locked), also lock the clip
    if (winning_clip_id && updates.status === 'locked') {
      await supabase
        .from('tournament_clips')
        .update({ status: 'locked', updated_at: new Date().toISOString() })
        .eq('id', winning_clip_id);
    }

    return NextResponse.json({
      success: true,
      slot,
      message: 'Slot updated successfully',
      ...(previousVotingSlot && {
        warning: `Slot ${previousVotingSlot.slot_position} was reset to upcoming`,
        previousVotingSlot: previousVotingSlot.slot_position,
      }),
    }, { status: 200 });
  } catch (err) {
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
  // Rate limit check
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

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
      .select('id, slot_position, status, season_id')
      .eq('season_id', activeSeason.id)
      .eq('slot_position', slot_position)
      .single();

    if (!slot) {
      return NextResponse.json(
        { error: 'Slot not found' },
        { status: 404 }
      );
    }

    // Get highest voted ACTIVE clip for this slot in the current season
    const { data: topClip } = await supabase
      .from('tournament_clips')
      .select('id, username, vote_count')
      .eq('slot_position', slot_position)
      .eq('season_id', activeSeason.id)
      .eq('status', 'active')
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

    // H3: Also lock the winning clip's status to 'locked'
    await supabase
      .from('tournament_clips')
      .update({ status: 'locked', updated_at: new Date().toISOString() })
      .eq('id', topClip.id);

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
  } catch (err) {
    console.error('[POST /api/admin/slots/auto-lock] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
