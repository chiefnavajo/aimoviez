// app/api/admin/assign-clip-to-slot/route.ts
// Free clip assignment: assign ANY clip to ANY slot
// Admin "God Mode" for fixing mistakes and rebuilding the story
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('[assign-clip-to-slot] Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * POST /api/admin/assign-clip-to-slot
 * Assign any clip to any slot — "God Mode Story Editor"
 *
 * Body: {
 *   clipId: string      - UUID of the clip to assign
 *   targetSlotPosition: number - Slot position (1-based)
 * }
 */
export async function POST(req: NextRequest) {
  // 1. Auth + rate limit
  const rateLimitResponse = await rateLimit(req, 'admin_write');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const adminAuth = await checkAdminAuth();
  const supabase = createSupabaseServerClient();

  try {
    // Parse body
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { clipId, targetSlotPosition } = body;

    // 2. Validate inputs
    if (!clipId || typeof clipId !== 'string' || !UUID_REGEX.test(clipId)) {
      return NextResponse.json(
        { ok: false, error: 'clipId must be a valid UUID' },
        { status: 400 }
      );
    }

    if (
      targetSlotPosition == null ||
      typeof targetSlotPosition !== 'number' ||
      !Number.isInteger(targetSlotPosition) ||
      targetSlotPosition < 1
    ) {
      return NextResponse.json(
        { ok: false, error: 'targetSlotPosition must be a positive integer' },
        { status: 400 }
      );
    }

    // 3. Fetch clip first to get its season_id (allows operating on non-active seasons)
    const { data: clipCheck, error: clipCheckError } = await supabase
      .from('tournament_clips')
      .select('id, season_id')
      .eq('id', clipId)
      .single();

    if (clipCheckError || !clipCheck) {
      console.error('[assign-clip-to-slot] clipCheckError:', clipCheckError);
      return NextResponse.json(
        { ok: false, error: 'Clip not found' },
        { status: 404 }
      );
    }

    // 4. Fetch clip's season (derive from clip, not query active season)
    // This allows fixing slots in non-active seasons too
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('id, status, total_slots')
      .eq('id', clipCheck.season_id)
      .single();

    if (seasonError) {
      console.error('[assign-clip-to-slot] seasonError:', seasonError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch clip season' },
        { status: 500 }
      );
    }

    if (!season) {
      return NextResponse.json(
        { ok: false, error: 'Clip season not found' },
        { status: 404 }
      );
    }

    // 5. Validate slot position range
    const totalSlots = season.total_slots ?? 75;
    if (targetSlotPosition > totalSlots) {
      return NextResponse.json(
        { ok: false, error: `targetSlotPosition ${targetSlotPosition} exceeds season total of ${totalSlots}` },
        { status: 400 }
      );
    }

    // 6. Fetch full clip details (with extra fields for audit log)
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, title, username, slot_position, status, vote_count, weighted_score, hype_score, season_id')
      .eq('id', clipId)
      .single();

    if (clipError || !clip) {
      console.error('[assign-clip-to-slot] clipError:', clipError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch clip details' },
        { status: 500 }
      );
    }

    // 6. Fetch target slot
    const { data: targetSlot, error: targetSlotError } = await supabase
      .from('story_slots')
      .select('id, slot_position, status, winner_tournament_clip_id')
      .eq('season_id', season.id)
      .eq('slot_position', targetSlotPosition)
      .maybeSingle();

    if (targetSlotError) {
      console.error('[assign-clip-to-slot] targetSlotError:', targetSlotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch target slot' },
        { status: 500 }
      );
    }

    if (!targetSlot) {
      return NextResponse.json(
        { ok: false, error: `Slot ${targetSlotPosition} not found in active season` },
        { status: 404 }
      );
    }

    // 7. No-op check
    if (targetSlot.winner_tournament_clip_id === clipId) {
      return NextResponse.json({
        ok: true,
        message: `Clip "${clip.title}" is already the winner of slot ${targetSlotPosition}`,
        noOp: true,
      });
    }

    // Track state for audit log
    let sourceSlotCleared: number | null = null;
    let sourceSlotNewStatus: string | null = null;
    let previousWinnerReverted: string | null = null;
    let activeClipsRemaining = 0;

    // 8. Source slot cleanup — if clip is currently a winner in a DIFFERENT slot
    const { data: sourceSlot } = await supabase
      .from('story_slots')
      .select('id, slot_position, status')
      .eq('season_id', season.id)
      .eq('winner_tournament_clip_id', clipId)
      .neq('slot_position', targetSlotPosition)
      .maybeSingle();

    if (sourceSlot) {
      sourceSlotCleared = sourceSlot.slot_position;

      // Clear winner from source slot
      const { error: clearSourceError } = await supabase
        .from('story_slots')
        .update({ winner_tournament_clip_id: null })
        .eq('id', sourceSlot.id);

      if (clearSourceError) {
        console.error('[assign-clip-to-slot] clearSourceError:', clearSourceError);
        return NextResponse.json(
          { ok: false, error: 'Failed to clear source slot' },
          { status: 500 }
        );
      }

      // Count remaining active clips in source slot
      const { count: activeCount } = await supabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', sourceSlot.slot_position)
        .eq('season_id', season.id)
        .eq('status', 'active');

      if (activeCount && activeCount > 0) {
        // Active clips exist — set source slot to voting
        const now = new Date();
        const votingEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const { error: votingError } = await supabase
          .from('story_slots')
          .update({
            status: 'voting',
            voting_started_at: now.toISOString(),
            voting_ends_at: votingEndsAt.toISOString(),
            voting_duration_hours: 24,
          })
          .eq('id', sourceSlot.id);

        if (votingError) {
          console.error('[assign-clip-to-slot] votingError:', votingError);
        }
        sourceSlotNewStatus = 'voting';
      } else {
        // No active clips — set to waiting_for_clips
        const { error: waitingError } = await supabase
          .from('story_slots')
          .update({
            status: 'waiting_for_clips',
            voting_started_at: null,
            voting_ends_at: null,
            voting_duration_hours: null,
          })
          .eq('id', sourceSlot.id);

        if (waitingError) {
          console.error('[assign-clip-to-slot] waitingError:', waitingError);
        }
        sourceSlotNewStatus = 'waiting_for_clips';
      }

      console.log(`[assign-clip-to-slot] Source slot ${sourceSlot.slot_position} cleared → ${sourceSlotNewStatus}`);
    }

    // 9. Target slot cleanup — revert existing winner to active
    if (targetSlot.winner_tournament_clip_id && targetSlot.winner_tournament_clip_id !== clipId) {
      previousWinnerReverted = targetSlot.winner_tournament_clip_id;

      const { error: revertError } = await supabase
        .from('tournament_clips')
        .update({ status: 'active' })
        .eq('id', targetSlot.winner_tournament_clip_id);

      if (revertError) {
        console.error('[assign-clip-to-slot] revertError:', revertError);
      }

      console.log(`[assign-clip-to-slot] Previous winner ${targetSlot.winner_tournament_clip_id} reverted to active`);
    }

    // Count active clips remaining in target slot (for warning)
    const { count: targetActiveCount } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('slot_position', targetSlotPosition)
      .eq('season_id', season.id)
      .eq('status', 'active')
      .neq('id', clipId);

    activeClipsRemaining = targetActiveCount || 0;

    // 10. Assign clip to target slot
    const { error: updateClipError } = await supabase
      .from('tournament_clips')
      .update({
        status: 'locked',
        slot_position: targetSlotPosition,
        segment_index: targetSlotPosition,
      })
      .eq('id', clipId);

    if (updateClipError) {
      console.error('[assign-clip-to-slot] updateClipError:', updateClipError);
      return NextResponse.json(
        { ok: false, error: 'Failed to update clip' },
        { status: 500 }
      );
    }

    const { error: updateSlotError } = await supabase
      .from('story_slots')
      .update({
        status: 'locked',
        winner_tournament_clip_id: clipId,
        voting_started_at: null,
        voting_ends_at: null,
        voting_duration_hours: null,
      })
      .eq('id', targetSlot.id);

    if (updateSlotError) {
      console.error('[assign-clip-to-slot] updateSlotError:', updateSlotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to update target slot' },
        { status: 500 }
      );
    }

    console.log(`[assign-clip-to-slot] Assigned clip "${clip.title}" to slot ${targetSlotPosition}`);

    // 11. Broadcast winner-selected event
    try {
      const broadcastPayload = {
        slotId: targetSlot.id,
        slotPosition: targetSlotPosition,
        clipId: clipId,
        seasonId: season.id,
        timestamp: new Date().toISOString(),
      };

      const channel = supabase.channel('story-updates', {
        config: { broadcast: { ack: true } },
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Channel subscription timeout after 5s'));
        }, 5000);

        channel.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timeout);
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timeout);
            reject(new Error(`Channel subscription failed: ${status} - ${err?.message || 'unknown'}`));
          }
        });
      });

      await channel.send({
        type: 'broadcast',
        event: 'winner-selected',
        payload: broadcastPayload,
      });

      await new Promise(resolve => setTimeout(resolve, 250));
      await channel.unsubscribe();
    } catch (broadcastError) {
      console.error('[assign-clip-to-slot] Broadcast error (non-fatal):', broadcastError);
    }

    // 12. Audit log
    await logAdminAction(req, {
      action: 'free_assign_clip',
      resourceType: 'slot',
      resourceId: targetSlot.id,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        clipId,
        clipTitle: clip.title,
        clipUsername: clip.username,
        clipPreviousStatus: clip.status,
        clipPreviousSlot: clip.slot_position,
        clipPreviousVoteCount: clip.vote_count,
        targetSlotPosition,
        targetSlotPreviousStatus: targetSlot.status,
        sourceSlotCleared,
        sourceSlotNewStatus,
        previousWinnerReverted,
        activeClipsRemaining,
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Assigned "${clip.title}" by ${clip.username} to slot ${targetSlotPosition}`,
      clipId,
      clipTitle: clip.title,
      clipUsername: clip.username,
      targetSlotPosition,
      sourceSlotCleared,
      sourceSlotNewStatus,
      previousWinnerReverted,
      activeClipsRemaining,
    });
  } catch (err: unknown) {
    console.error('[assign-clip-to-slot] Unexpected error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
