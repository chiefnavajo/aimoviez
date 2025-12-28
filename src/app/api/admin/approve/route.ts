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

    // Get current clip status for audit log
    const { data: currentClip } = await supabase
      .from('tournament_clips')
      .select('status, username, season_id')
      .eq('id', clipId)
      .single();

    if (!currentClip) {
      return NextResponse.json(
        { error: 'Clip not found' },
        { status: 404 }
      );
    }

    // Get the current active voting slot for this season
    const { data: activeSlot } = await supabase
      .from('story_slots')
      .select('id, slot_position, status')
      .eq('season_id', currentClip.season_id)
      .in('status', ['voting', 'waiting_for_clips'])
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    // Update clip status to 'active' and set slot_position to current voting slot
    const updateData: { status: string; updated_at: string; slot_position?: number } = {
      status: 'active',
      updated_at: new Date().toISOString()
    };

    let resumedVoting = false;

    // If there's an active voting slot or waiting_for_clips slot
    if (activeSlot?.slot_position != null) {
      updateData.slot_position = activeSlot.slot_position;

      // If slot is waiting_for_clips, activate voting now that we have a clip
      if (activeSlot.status === 'waiting_for_clips') {
        console.log(`[approve] Resuming voting on slot ${activeSlot.slot_position} - clip approved`);

        // Get voting duration from previous locked slot (or default 24h)
        const { data: previousSlot } = await supabase
          .from('story_slots')
          .select('voting_duration_hours')
          .eq('season_id', currentClip.season_id)
          .eq('status', 'locked')
          .order('slot_position', { ascending: false })
          .limit(1)
          .maybeSingle();

        const durationHours = previousSlot?.voting_duration_hours || 24;
        const now = new Date();
        const votingEndsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

        const { error: activateError } = await supabase
          .from('story_slots')
          .update({
            status: 'voting',
            voting_started_at: now.toISOString(),
            voting_ends_at: votingEndsAt.toISOString(),
            voting_duration_hours: durationHours,
          })
          .eq('id', activeSlot.id);

        if (activateError) {
          console.error('[approve] Failed to activate waiting slot:', activateError);
        } else {
          resumedVoting = true;
        }
      } else if (activeSlot.status === 'voting') {
        // Verify slot is still voting (race condition check)
        const { data: verifySlot } = await supabase
          .from('story_slots')
          .select('status')
          .eq('id', activeSlot.id)
          .single();

        if (verifySlot?.status !== 'voting') {
          // Slot was locked between our queries - find the new voting/waiting slot
          console.warn(`[approve] Slot ${activeSlot.slot_position} status changed, finding new slot`);

          const { data: newActiveSlot } = await supabase
            .from('story_slots')
            .select('id, slot_position, status')
            .eq('season_id', currentClip.season_id)
            .in('status', ['voting', 'waiting_for_clips'])
            .order('slot_position', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (newActiveSlot?.slot_position != null) {
            updateData.slot_position = newActiveSlot.slot_position;
            // Handle waiting_for_clips for the new slot too
            if (newActiveSlot.status === 'waiting_for_clips') {
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
                .eq('id', newActiveSlot.id);
              resumedVoting = true;
            }
          } else {
            delete updateData.slot_position;
          }
        }
      }
    }

    const { data, error } = await supabase
      .from('tournament_clips')
      .update(updateData)
      .eq('id', clipId)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to approve clip' },
        { status: 500 }
      );
    }

    // Audit log the action - use actual assigned slot from updateData
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
        assignedToSlot: updateData.slot_position ?? null,
        resumedVoting,
      },
    });

    // Build response message
    let message = 'Clip approved';
    if (updateData.slot_position) {
      message = `Clip approved and assigned to slot ${updateData.slot_position}`;
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
      assignedToSlot: updateData.slot_position ?? null,
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
