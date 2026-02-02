// app/api/admin/approve/route.ts
// ============================================================================
// ADMIN API - Approve Clip
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
    const { clipId } = body;

    if (!clipId) {
      return NextResponse.json(
        { error: 'Clip ID is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get current clip status for audit log (before approval)
    const { data: currentClip } = await supabase
      .from('tournament_clips')
      .select('status, username, season_id, user_id')
      .eq('id', clipId)
      .single();

    if (!currentClip) {
      return NextResponse.json(
        { error: 'Clip not found' },
        { status: 404 }
      );
    }

    // Use atomic RPC function to prevent race conditions
    // This locks the clip and slot rows during the operation
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      'admin_approve_clip_atomic',
      {
        p_clip_id: clipId,
        p_admin_id: adminAuth.userId || null,
      }
    );

    // Fallback to legacy method if RPC doesn't exist
    let data;
    let resumedVoting = false;
    let assignedSlot: number | null = null;

    if (rpcError?.code === '42883' || rpcError?.code === 'PGRST202') {
      // RPC function not found - use legacy method with warning
      console.warn('[approve] Using legacy method - please run fix-critical-issues-2025-01.sql migration');

      // Get the current active voting slot for this season
      const { data: activeSlot } = await supabase
        .from('story_slots')
        .select('id, slot_position, status')
        .eq('season_id', currentClip.season_id)
        .in('status', ['voting', 'waiting_for_clips'])
        .order('slot_position', { ascending: true })
        .limit(1)
        .maybeSingle();

      const updateData: { status: string; updated_at: string; slot_position?: number } = {
        status: 'active',
        updated_at: new Date().toISOString()
      };

      if (activeSlot?.slot_position != null) {
        updateData.slot_position = activeSlot.slot_position;
        assignedSlot = activeSlot.slot_position;

        if (activeSlot.status === 'waiting_for_clips') {
          const durationHours = 24;
          const now = new Date();
          const votingEndsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

          await supabase
            .from('story_slots')
            .update({
              status: 'voting',
              voting_started_at: now.toISOString(),
              voting_ends_at: votingEndsAt.toISOString(),
              voting_duration_hours: durationHours,
            })
            .eq('id', activeSlot.id);
          resumedVoting = true;
        }
      }

      const { data: updateResult, error: updateError } = await supabase
        .from('tournament_clips')
        .update(updateData)
        .eq('id', clipId)
        .select()
        .single();

      if (updateError) {
        console.error('Database error:', updateError);
        return NextResponse.json(
          { error: 'Failed to approve clip' },
          { status: 500 }
        );
      }
      data = updateResult;
    } else if (rpcError) {
      console.error('RPC error:', rpcError);
      return NextResponse.json(
        { error: 'Failed to approve clip' },
        { status: 500 }
      );
    } else {
      // RPC succeeded
      const result = rpcResult?.[0];
      if (!result?.success) {
        return NextResponse.json(
          { error: result?.error_message || 'Failed to approve clip' },
          { status: 500 }
        );
      }
      assignedSlot = result.assigned_slot;
      resumedVoting = result.resumed_voting;

      // Fetch updated clip for response
      const { data: updatedClip } = await supabase
        .from('tournament_clips')
        .select()
        .eq('id', clipId)
        .single();
      data = updatedClip;
    }

    // Audit log the action
    await logAdminAction(request, {
      action: 'approve_clip',
      resourceType: 'clip',
      resourceId: clipId,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        previousStatus: currentClip?.status,
        newStatus: 'active',
        clipOwner: currentClip?.username,
        assignedToSlot: assignedSlot,
        resumedVoting,
      },
    });

    // Fire-and-forget: Notify clip owner about approval
    if (currentClip?.user_id) {
      import('@/lib/notifications').then(({ createNotification }) => {
        createNotification({
          user_key: `user_${currentClip.user_id}`,
          type: 'clip_approved',
          title: 'Clip approved!',
          message: assignedSlot
            ? `Your clip has been approved and assigned to slot ${assignedSlot}`
            : 'Your clip has been approved',
          action_url: '/dashboard',
          metadata: { clipId, assignedSlot },
        }).catch(e => console.error('[approve] Notification error (non-fatal):', e));
      }).catch(() => {});
    }

    // Build response message
    let message = 'Clip approved';
    if (assignedSlot) {
      message = `Clip approved and assigned to slot ${assignedSlot}`;
      if (resumedVoting) {
        message += '. Voting has resumed!';
      }
    } else {
      message = 'Clip approved (no active voting slot to assign)';
    }

    return NextResponse.json({
      success: true,
      message,
      clip: data,
      assignedToSlot: assignedSlot,
      resumedVoting,
    });
  } catch (error) {
    console.error('POST /api/admin/approve error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
