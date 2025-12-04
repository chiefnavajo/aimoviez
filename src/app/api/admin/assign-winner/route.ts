// app/api/admin/assign-winner/route.ts
// Manually assign a winning clip for the active slot
// Requires admin authentication
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';

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

  // Get admin info for audit logging
  const adminAuth = await checkAdminAuth();

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

    // 4. Try atomic transaction first (if RPC exists), fall back to individual updates
    const nextPosition = activeSlot.slot_position + 1;
    const durationHours = activeSlot.voting_duration_hours || 24;

    let nextSlotInfo = null;
    let clipsMovedCount = 0;
    let seasonFinished = false;

    // Try atomic RPC first
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'assign_winner_atomic',
      {
        p_clip_id: clipId,
        p_slot_id: activeSlot.id,
        p_season_id: season.id,
        p_next_slot_position: nextPosition,
        p_voting_duration_hours: durationHours,
        p_advance_slot: advanceSlot,
      }
    );

    if (!rpcError && rpcResult && rpcResult.length > 0 && rpcResult[0].success) {
      // RPC succeeded - use its results
      const result = rpcResult[0];
      clipsMovedCount = result.clips_moved || 0;
      seasonFinished = result.season_finished || false;

      if (!seasonFinished && result.next_slot_position) {
        const now = new Date();
        const votingEndsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
        nextSlotInfo = {
          position: result.next_slot_position,
          votingEndsAt: votingEndsAt.toISOString(),
        };
      }
    } else {
      // RPC not available or failed - fall back to individual updates
      if (rpcError && rpcError.code !== '42883') {
        console.error('[assign-winner] RPC error:', rpcError);
      } else {
        console.warn('[assign-winner] Using legacy method - please run fix-admin-winner-transaction.sql migration');
      }

      // Legacy: Lock the current slot with the selected winner
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

      // Legacy: Mark the winning clip as 'locked'
      const { error: lockClipError } = await supabase
        .from('tournament_clips')
        .update({ status: 'locked' })
        .eq('id', clipId);

      if (lockClipError) {
        console.error('[assign-winner] lockClipError:', lockClipError);
      }

      // Legacy: If advanceSlot is true, set up the next slot
      if (advanceSlot) {
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
          seasonFinished = true;
        } else {
          // Set next slot to voting
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
      }
    }

    // Handle season finished case
    if (seasonFinished) {
      // Audit log the action
      await logAdminAction(req, {
        action: 'assign_winner',
        resourceType: 'clip',
        resourceId: clipId,
        adminEmail: adminAuth.email || 'unknown',
        adminId: adminAuth.userId || undefined,
        details: {
          clipTitle: clip.title,
          clipOwner: clip.username,
          slotPosition: activeSlot.slot_position,
          voteCount: clip.vote_count,
          seasonFinished: true,
        },
      });

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

    // Audit log the action
    await logAdminAction(req, {
      action: 'assign_winner',
      resourceType: 'clip',
      resourceId: clipId,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        clipTitle: clip.title,
        clipOwner: clip.username,
        slotPosition: activeSlot.slot_position,
        voteCount: clip.vote_count,
        advancedSlot: advanceSlot,
        nextSlotPosition: nextSlotInfo?.position || null,
        clipsMovedCount,
      },
    });

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
