// app/api/admin/bulk/route.ts
// Bulk operations for admin (approve/reject multiple clips)

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

/**
 * POST /api/admin/bulk
 * Perform bulk operations on clips
 *
 * Body: {
 *   action: 'approve' | 'reject' | 'delete',
 *   clipIds: string[]
 * }
 */
export async function POST(request: NextRequest) {
  // Rate limit bulk operations: 50 per minute (prevent accidental mass operations)
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const adminAuth = await checkAdminAuth();

  try {
    const body = await request.json();
    const { action, clipIds } = body;

    if (!action || !['approve', 'reject', 'delete'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be: approve, reject, or delete' },
        { status: 400 }
      );
    }

    if (!clipIds || !Array.isArray(clipIds) || clipIds.length === 0) {
      return NextResponse.json(
        { error: 'clipIds must be a non-empty array' },
        { status: 400 }
      );
    }

    if (clipIds.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 clips per bulk operation' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    let updatedCount = 0;
    let hasErrors = false;

    if (action === 'approve') {
      const { data, error } = await supabase
        .from('tournament_clips')
        .update({ status: 'active' })
        .in('id', clipIds)
        .eq('status', 'pending')
        .select('id');

      if (error) {
        console.error('[BULK] Approve error:', error);
        hasErrors = true;
      } else {
        updatedCount = data?.length || 0;
      }
    } else if (action === 'reject') {
      const { data, error } = await supabase
        .from('tournament_clips')
        .update({ status: 'rejected' })
        .in('id', clipIds)
        .eq('status', 'pending')
        .select('id');

      if (error) {
        console.error('[BULK] Reject error:', error);
        hasErrors = true;
      } else {
        updatedCount = data?.length || 0;
      }
    } else if (action === 'delete') {
      // First get clip info for logging
      const { data: _clips } = await supabase
        .from('tournament_clips')
        .select('id, title')
        .in('id', clipIds);

      // Remove from story_slots winners
      await supabase
        .from('story_slots')
        .update({ winner_tournament_clip_id: null })
        .in('winner_tournament_clip_id', clipIds);

      // Delete the clips
      const { data, error } = await supabase
        .from('tournament_clips')
        .delete()
        .in('id', clipIds)
        .select('id');

      if (error) {
        console.error('[BULK] Delete error:', error);
        hasErrors = true;
      } else {
        updatedCount = data?.length || 0;
      }
    }

    // Log the bulk action
    await logAdminAction(request, {
      action: 'bulk_action',
      resourceType: 'clip',
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        bulkAction: action,
        clipIds,
        updatedCount,
        hasErrors,
      },
    });

    return NextResponse.json({
      success: !hasErrors,
      action,
      requested: clipIds.length,
      updated: updatedCount,
      // Don't expose internal error details - just indicate if there were errors
      message: hasErrors ? 'Some operations failed' : undefined,
    });
  } catch (error) {
    console.error('Bulk operation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
