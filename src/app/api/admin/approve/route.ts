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
      .select('slot_position')
      .eq('season_id', currentClip.season_id)
      .eq('status', 'voting')
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    // Update clip status to 'active' and set slot_position to current voting slot
    const updateData: { status: string; updated_at: string; slot_position?: number } = {
      status: 'active',
      updated_at: new Date().toISOString()
    };

    // If there's an active voting slot, assign the clip to it
    if (activeSlot?.slot_position) {
      updateData.slot_position = activeSlot.slot_position;
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
        assignedToSlot: activeSlot?.slot_position || null,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Clip approved successfully',
      clip: data,
    });
  } catch (error) {
    console.error('POST /api/admin/approve error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
