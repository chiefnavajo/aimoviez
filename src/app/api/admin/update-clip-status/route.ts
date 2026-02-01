// app/api/admin/update-clip-status/route.ts
// God Mode: Change any clip's status with automatic slot cleanup
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = ['pending', 'active', 'rejected'] as const;
type ClipStatus = typeof VALID_STATUSES[number];

function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('[update-clip-status] Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * POST /api/admin/update-clip-status
 * Change any clip's status with automatic slot cleanup when unlocking
 *
 * Body: {
 *   clipId: string       - UUID of the clip
 *   newStatus: string     - "pending" | "active" | "rejected"
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

    const { clipId, newStatus } = body;

    // 2. Validate inputs
    if (!clipId || typeof clipId !== 'string' || !UUID_REGEX.test(clipId)) {
      return NextResponse.json(
        { ok: false, error: 'clipId must be a valid UUID' },
        { status: 400 }
      );
    }

    if (!newStatus || !VALID_STATUSES.includes(newStatus as ClipStatus)) {
      return NextResponse.json(
        { ok: false, error: `newStatus must be one of: ${VALID_STATUSES.join(', ')}` },
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
      console.error('[update-clip-status] seasonError:', seasonError);
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

    // 4. Fetch clip
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, title, username, slot_position, status, vote_count, season_id')
      .eq('id', clipId)
      .maybeSingle();

    if (clipError) {
      console.error('[update-clip-status] clipError:', clipError);
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

    if (clip.season_id !== season.id) {
      return NextResponse.json(
        { ok: false, error: 'Clip belongs to a different season' },
        { status: 400 }
      );
    }

    // 5. No-op check
    if (clip.status === newStatus) {
      return NextResponse.json({
        ok: true,
        message: `Clip "${clip.title}" is already ${newStatus}`,
        noOp: true,
      });
    }

    const previousStatus = clip.status;
    let slotCleared: number | null = null;
    let slotNewStatus: string | null = null;

    // 6. If clip is currently locked — need slot cleanup
    if (clip.status === 'locked') {
      // Find slot where this clip is winner
      const { data: sourceSlot } = await supabase
        .from('story_slots')
        .select('id, slot_position, status')
        .eq('season_id', season.id)
        .eq('winner_tournament_clip_id', clipId)
        .maybeSingle();

      if (sourceSlot) {
        slotCleared = sourceSlot.slot_position;

        // Clear winner from slot
        const { error: clearError } = await supabase
          .from('story_slots')
          .update({ winner_tournament_clip_id: null })
          .eq('id', sourceSlot.id);

        if (clearError) {
          console.error('[update-clip-status] clearError:', clearError);
          return NextResponse.json(
            { ok: false, error: 'Failed to clear slot winner' },
            { status: 500 }
          );
        }

        // Count remaining active clips in that slot (exclude this clip)
        const { count: activeCount } = await supabase
          .from('tournament_clips')
          .select('id', { count: 'exact', head: true })
          .eq('slot_position', sourceSlot.slot_position)
          .eq('season_id', season.id)
          .eq('status', 'active')
          .neq('id', clipId);

        if (activeCount && activeCount > 0) {
          // Active clips exist — set slot to voting
          const now = new Date();
          const votingEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

          await supabase
            .from('story_slots')
            .update({
              status: 'voting',
              voting_started_at: now.toISOString(),
              voting_ends_at: votingEndsAt.toISOString(),
              voting_duration_hours: 24,
            })
            .eq('id', sourceSlot.id);

          slotNewStatus = 'voting';
        } else {
          // No active clips — set to waiting_for_clips
          await supabase
            .from('story_slots')
            .update({
              status: 'waiting_for_clips',
              voting_started_at: null,
              voting_ends_at: null,
              voting_duration_hours: null,
            })
            .eq('id', sourceSlot.id);

          slotNewStatus = 'waiting_for_clips';
        }

        console.log(`[update-clip-status] Slot ${sourceSlot.slot_position} cleared → ${slotNewStatus}`);

        // Broadcast so story page updates
        try {
          const broadcastPayload = {
            slotId: sourceSlot.id,
            slotPosition: sourceSlot.slot_position,
            clipId: clipId,
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
          console.error('[update-clip-status] Broadcast error (non-fatal):', broadcastError);
        }
      } else {
        console.warn(`[update-clip-status] Clip ${clipId} is locked but not winner of any slot — proceeding anyway`);
      }
    }

    // 7. Update clip status
    const { error: updateError } = await supabase
      .from('tournament_clips')
      .update({ status: newStatus })
      .eq('id', clipId);

    if (updateError) {
      console.error('[update-clip-status] updateError:', updateError);
      return NextResponse.json(
        { ok: false, error: 'Failed to update clip status' },
        { status: 500 }
      );
    }

    console.log(`[update-clip-status] Clip "${clip.title}" changed from ${previousStatus} to ${newStatus}`);

    // 8. Audit log
    await logAdminAction(req, {
      action: 'god_mode_status_change',
      resourceType: 'clip',
      resourceId: clipId,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        clipId,
        clipTitle: clip.title,
        clipUsername: clip.username,
        previousStatus,
        newStatus,
        slotCleared,
        slotNewStatus,
      },
    });

    // 9. Response
    return NextResponse.json({
      ok: true,
      message: `Changed "${clip.title}" from ${previousStatus} to ${newStatus}`,
      clipId,
      clipTitle: clip.title,
      previousStatus,
      newStatus,
      slotCleared,
      slotNewStatus,
    });
  } catch (err: unknown) {
    console.error('[update-clip-status] Unexpected error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
