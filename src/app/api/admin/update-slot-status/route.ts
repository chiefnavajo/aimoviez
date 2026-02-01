// app/api/admin/update-slot-status/route.ts
// God Mode: Change any slot's status with automatic unlock cleanup
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';

const VALID_SLOT_STATUSES = ['voting', 'waiting_for_clips', 'upcoming'] as const;
type SlotStatus = typeof VALID_SLOT_STATUSES[number];

function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('[update-slot-status] Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * POST /api/admin/update-slot-status
 * Change any slot's status with automatic unlock cleanup
 *
 * Body: {
 *   slotPosition: number    - Slot position (1-based)
 *   newStatus: string        - "voting" | "waiting_for_clips" | "upcoming"
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
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { slotPosition, newStatus } = body;

    // 2. Validate inputs
    if (
      slotPosition == null ||
      typeof slotPosition !== 'number' ||
      !Number.isInteger(slotPosition) ||
      slotPosition < 1
    ) {
      return NextResponse.json(
        { ok: false, error: 'slotPosition must be a positive integer' },
        { status: 400 }
      );
    }

    if (!newStatus || !VALID_SLOT_STATUSES.includes(newStatus as SlotStatus)) {
      return NextResponse.json(
        { ok: false, error: `newStatus must be one of: ${VALID_SLOT_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    // 3. Fetch active season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('id, status, total_slots')
      .eq('status', 'active')
      .maybeSingle();

    if (seasonError) {
      console.error('[update-slot-status] seasonError:', seasonError);
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

    const totalSlots = season.total_slots ?? 75;
    if (slotPosition > totalSlots) {
      return NextResponse.json(
        { ok: false, error: `slotPosition ${slotPosition} exceeds season total of ${totalSlots}` },
        { status: 400 }
      );
    }

    // 4. Fetch slot
    const { data: slot, error: slotError } = await supabase
      .from('story_slots')
      .select('id, slot_position, status, winner_tournament_clip_id, voting_started_at, voting_ends_at, voting_duration_hours')
      .eq('season_id', season.id)
      .eq('slot_position', slotPosition)
      .maybeSingle();

    if (slotError) {
      console.error('[update-slot-status] slotError:', slotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch slot' },
        { status: 500 }
      );
    }

    if (!slot) {
      return NextResponse.json(
        { ok: false, error: `Slot ${slotPosition} not found in active season` },
        { status: 404 }
      );
    }

    // 5. No-op check
    if (slot.status === newStatus) {
      return NextResponse.json({
        ok: true,
        message: `Slot ${slotPosition} is already ${newStatus}`,
        noOp: true,
      });
    }

    const previousStatus = slot.status;
    let winnerClipReverted: string | null = null;
    let activeClipCount: number | null = null;
    let warning: string | null = null;

    // 6. If slot is currently locked — unlock cleanup
    if (slot.status === 'locked' && slot.winner_tournament_clip_id) {
      // Revert winner clip to active
      const { error: revertError } = await supabase
        .from('tournament_clips')
        .update({ status: 'active' })
        .eq('id', slot.winner_tournament_clip_id);

      if (revertError) {
        console.error('[update-slot-status] revertError:', revertError);
        return NextResponse.json(
          { ok: false, error: 'Failed to revert winner clip' },
          { status: 500 }
        );
      }

      // Clear winner from slot
      const { error: clearError } = await supabase
        .from('story_slots')
        .update({ winner_tournament_clip_id: null })
        .eq('id', slot.id);

      if (clearError) {
        console.error('[update-slot-status] clearError:', clearError);
        return NextResponse.json(
          { ok: false, error: 'Failed to clear slot winner' },
          { status: 500 }
        );
      }

      winnerClipReverted = slot.winner_tournament_clip_id;
      console.log(`[update-slot-status] Slot ${slotPosition} winner ${slot.winner_tournament_clip_id} reverted to active`);
    }

    // 7. Build update payload based on target status
    let updatePayload: Record<string, unknown> = { status: newStatus };

    if (newStatus === 'voting') {
      // Count active clips in this slot
      const { count } = await supabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', slotPosition)
        .eq('season_id', season.id)
        .eq('status', 'active');

      activeClipCount = count || 0;

      if (activeClipCount === 0) {
        return NextResponse.json(
          { ok: false, error: `No active clips in slot ${slotPosition} — cannot start voting. Approve clips first or use 'waiting_for_clips'.` },
          { status: 400 }
        );
      }

      // Check for other voting slots
      const { data: otherVoting } = await supabase
        .from('story_slots')
        .select('slot_position')
        .eq('season_id', season.id)
        .eq('status', 'voting')
        .neq('id', slot.id)
        .maybeSingle();

      if (otherVoting) {
        warning = `Slot ${otherVoting.slot_position} is also voting in this season`;
      }

      // Set voting timer
      const now = new Date();
      const votingEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      updatePayload = {
        status: newStatus,
        voting_started_at: now.toISOString(),
        voting_ends_at: votingEndsAt.toISOString(),
        voting_duration_hours: 24,
      };
    } else {
      // waiting_for_clips or upcoming — clear timers
      updatePayload = {
        status: newStatus,
        voting_started_at: null,
        voting_ends_at: null,
        voting_duration_hours: null,
      };
    }

    // 8. Update slot status
    const { error: updateError } = await supabase
      .from('story_slots')
      .update(updatePayload)
      .eq('id', slot.id);

    if (updateError) {
      console.error('[update-slot-status] updateError:', updateError);
      return NextResponse.json(
        { ok: false, error: 'Failed to update slot status' },
        { status: 500 }
      );
    }

    console.log(`[update-slot-status] Slot ${slotPosition} changed from ${previousStatus} to ${newStatus}`);

    // 9. Broadcast update
    try {
      const broadcastPayload = {
        slotId: slot.id,
        slotPosition,
        clipId: winnerClipReverted || '',
        seasonId: season.id,
        timestamp: new Date().toISOString(),
      };

      const channel = supabase.channel('story-updates', {
        config: { broadcast: { ack: true } },
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Channel subscription timeout'));
        }, 5000);

        channel.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timeout);
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timeout);
            reject(new Error(`Channel failed: ${status} - ${err?.message || 'unknown'}`));
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
      console.error('[update-slot-status] Broadcast error (non-fatal):', broadcastError);
    }

    // 10. Audit log
    await logAdminAction(req, {
      action: 'god_mode_slot_status_change',
      resourceType: 'slot',
      resourceId: slot.id,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        slotPosition,
        previousStatus,
        newStatus,
        winnerClipReverted,
        activeClipCount,
        warning,
      },
    });

    // 11. Response
    return NextResponse.json({
      ok: true,
      message: `Slot ${slotPosition} changed from ${previousStatus} to ${newStatus}`,
      slotPosition,
      previousStatus,
      newStatus,
      winnerClipReverted,
      activeClipCount,
      warning,
    });
  } catch (err: unknown) {
    console.error('[update-slot-status] Unexpected error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
