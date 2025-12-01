// app/api/admin/moderation/route.ts
// Admin Moderation API - Approve/reject clips in moderation queue
// Requires admin authentication

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface ModerationQueueItem {
  id: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string;
  genre: string;
  slot_position: number;
  submitted_at: string;
  moderation_status: 'pending' | 'approved' | 'rejected';
}

/**
 * GET /api/admin/moderation
 * Get clips in moderation queue
 *
 * Query params:
 * - status?: 'pending' | 'approved' | 'rejected' | 'all' (default: 'pending')
 * - page?: number (default: 1)
 * - limit?: number (default: 20, max: 100)
 */
export async function GET(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);
    
    const status = searchParams.get('status') || 'pending';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('tournament_clips')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: true });

    if (status !== 'all') {
      query = query.eq('moderation_status', status);
    }

    const { data: clips, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[GET /api/admin/moderation] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch moderation queue' },
        { status: 500 }
      );
    }

    // Enrich clips
    const enrichedClips: ModerationQueueItem[] = (clips || []).map((clip) => ({
      id: clip.id,
      video_url: clip.video_url,
      thumbnail_url: clip.thumbnail_url,
      username: clip.username || 'Creator',
      avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${clip.username || 'user'}`,
      genre: clip.genre || 'Unknown',
      slot_position: clip.slot_position,
      submitted_at: clip.created_at,
      moderation_status: clip.moderation_status || 'pending',
    }));

    return NextResponse.json({
      queue: enrichedClips,
      total: count || 0,
      page,
      page_size: limit,
      has_more: (count || 0) > offset + limit,
    }, { status: 200 });
  } catch (err: any) {
    console.error('[GET /api/admin/moderation] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/moderation/approve
 * Approve a clip
 *
 * Body: {
 *   clip_id: string,
 *   admin_notes?: string
 * }
 */
export async function POST(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const { clip_id, admin_notes } = body;

    if (!clip_id) {
      return NextResponse.json(
        { error: 'clip_id is required' },
        { status: 400 }
      );
    }

    const updates: any = {
      moderation_status: 'approved',
      status: 'active', // Set status to active so clip appears in voting
      moderated_at: new Date().toISOString(),
    };

    if (admin_notes) {
      updates.admin_notes = admin_notes;
    }

    const { data: clip, error } = await supabase
      .from('tournament_clips')
      .update(updates)
      .eq('id', clip_id)
      .select()
      .single();

    if (error || !clip) {
      console.error('[POST /api/admin/moderation/approve] error:', error);
      return NextResponse.json(
        { error: 'Failed to approve clip' },
        { status: 500 }
      );
    }

    // TODO: Send notification to creator

    return NextResponse.json({
      success: true,
      clip,
      message: 'Clip approved successfully',
    }, { status: 200 });
  } catch (err: any) {
    console.error('[POST /api/admin/moderation/approve] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/moderation/reject
 * Reject a clip
 *
 * Body: {
 *   clip_id: string,
 *   reason?: string
 * }
 */
export async function DELETE(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const { clip_id, reason } = body;

    if (!clip_id) {
      return NextResponse.json(
        { error: 'clip_id is required' },
        { status: 400 }
      );
    }

    const updates: any = {
      moderation_status: 'rejected',
      status: 'rejected', // Set status to rejected so clip doesn't appear in voting
      moderated_at: new Date().toISOString(),
    };

    if (reason) {
      updates.rejection_reason = reason;
    }

    const { data: clip, error } = await supabase
      .from('tournament_clips')
      .update(updates)
      .eq('id', clip_id)
      .select()
      .single();

    if (error || !clip) {
      console.error('[DELETE /api/admin/moderation/reject] error:', error);
      return NextResponse.json(
        { error: 'Failed to reject clip' },
        { status: 500 }
      );
    }

    // TODO: Send notification to creator with reason

    return NextResponse.json({
      success: true,
      clip,
      message: 'Clip rejected successfully',
    }, { status: 200 });
  } catch (err: any) {
    console.error('[DELETE /api/admin/moderation/reject] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/moderation/batch
 * Batch approve or reject multiple clips
 *
 * Body: {
 *   clip_ids: string[],
 *   action: 'approve' | 'reject',
 *   reason?: string (for reject)
 * }
 */
export async function PATCH(req: NextRequest) {
  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const { clip_ids, action, reason } = body;

    if (!clip_ids || !Array.isArray(clip_ids) || clip_ids.length === 0) {
      return NextResponse.json(
        { error: 'clip_ids array is required' },
        { status: 400 }
      );
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { error: 'action must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    const updates: any = {
      moderation_status: action === 'approve' ? 'approved' : 'rejected',
      status: action === 'approve' ? 'active' : 'rejected', // Set status for voting visibility
      moderated_at: new Date().toISOString(),
    };

    if (action === 'reject' && reason) {
      updates.rejection_reason = reason;
    }

    const { data: clips, error } = await supabase
      .from('tournament_clips')
      .update(updates)
      .in('id', clip_ids)
      .select();

    if (error) {
      console.error('[PATCH /api/admin/moderation/batch] error:', error);
      return NextResponse.json(
        { error: 'Failed to batch update clips' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      updated_count: clips?.length || 0,
      message: `${clips?.length || 0} clips ${action}d successfully`,
    }, { status: 200 });
  } catch (err: any) {
    console.error('[PATCH /api/admin/moderation/batch] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
