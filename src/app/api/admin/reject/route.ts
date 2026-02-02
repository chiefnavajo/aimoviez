// app/api/admin/reject/route.ts
// ============================================================================
// ADMIN API - Reject Clip
// Requires admin authentication
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

export async function POST(request: NextRequest) {
  // Rate limit: 50 admin actions per minute
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  // Get admin info for audit logging
  const adminAuth = await checkAdminAuth();

  try {
    const body = await request.json();
    const { clipId, reason } = body;

    if (!clipId) {
      return NextResponse.json(
        { error: 'Clip ID is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get current clip status for validation and audit log
    const { data: currentClip } = await supabase
      .from('tournament_clips')
      .select('status, username, slot_position, season_id, user_id')
      .eq('id', clipId)
      .single();

    // H7: Validate clip state before rejecting
    if (currentClip?.status === 'locked') {
      return NextResponse.json(
        { error: 'Cannot reject a locked clip (story winner). Unlock the slot first.' },
        { status: 409 }
      );
    }

    if (currentClip?.status === 'rejected') {
      return NextResponse.json({
        success: true,
        message: 'Clip is already rejected',
        clip: currentClip,
      });
    }

    // Track if we need slot cleanup (rejecting an active clip in a voting slot)
    const wasActive = currentClip?.status === 'active';
    const hadSlot = currentClip?.slot_position != null;
    const hadSeason = currentClip?.season_id != null;

    // Update clip status to 'rejected'
    const { data, error } = await supabase
      .from('tournament_clips')
      .update({
        status: 'rejected',
        updated_at: new Date().toISOString()
      })
      .eq('id', clipId)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to reject clip' },
        { status: 500 }
      );
    }

    // H7: Slot cleanup — if this was the last active clip in a voting slot, reset to waiting_for_clips
    if (wasActive && hadSlot && hadSeason) {
      const { count } = await supabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('slot_position', currentClip!.slot_position)
        .eq('season_id', currentClip!.season_id)
        .eq('status', 'active');

      if (count === 0) {
        const { data: currentSlot } = await supabase
          .from('story_slots')
          .select('status')
          .eq('season_id', currentClip!.season_id)
          .eq('slot_position', currentClip!.slot_position)
          .maybeSingle();

        if (currentSlot?.status === 'voting') {
          await supabase
            .from('story_slots')
            .update({
              status: 'waiting_for_clips',
              voting_started_at: null,
              voting_ends_at: null,
            })
            .eq('season_id', currentClip!.season_id)
            .eq('slot_position', currentClip!.slot_position);

          console.log(`[admin/reject] Last active clip in voting Slot ${currentClip!.slot_position} rejected — reset slot to waiting_for_clips`);
        }
      }
    }

    // Audit log the action
    await logAdminAction(request, {
      action: 'reject_clip',
      resourceType: 'clip',
      resourceId: clipId,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        previousStatus: currentClip?.status,
        newStatus: 'rejected',
        clipOwner: currentClip?.username,
        reason: reason || null,
      },
    });

    // Fire-and-forget: Notify clip owner about rejection
    if (currentClip?.user_id) {
      import('@/lib/notifications').then(({ createNotification }) => {
        createNotification({
          user_key: `user_${currentClip.user_id}`,
          type: 'clip_rejected',
          title: 'Clip not approved',
          message: reason
            ? `Your clip was not approved: ${reason}`
            : 'Your clip was not approved. Check guidelines for details.',
          action_url: '/profile',
          metadata: { clipId, reason: reason || null },
        }).catch(e => console.error('[reject] Notification error (non-fatal):', e));
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: 'Clip rejected successfully',
      clip: data,
    });
  } catch (error) {
    console.error('POST /api/admin/reject error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
