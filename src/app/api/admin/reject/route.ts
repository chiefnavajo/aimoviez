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

    // Get current clip status for audit log
    const { data: currentClip } = await supabase
      .from('tournament_clips')
      .select('status, username')
      .eq('id', clipId)
      .single();

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
