// app/api/admin/comments/route.ts
// Admin Comment Moderation API

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface ModerationQueueComment {
  id: string;
  clip_id: string;
  username: string;
  avatar_url: string;
  comment_text: string;
  likes_count: number;
  parent_comment_id: string | null;
  created_at: string;
  moderation_status: 'pending' | 'approved' | 'rejected' | 'flagged';
  moderation_reason: string | null;
  clip_title: string | null;
  clip_thumbnail: string | null;
}

/**
 * GET /api/admin/comments
 * Get comment moderation queue
 *
 * Query params:
 * - status: 'pending' | 'flagged' | 'all' (default: 'all')
 * - limit: number (default: 50)
 * - offset: number (default: 0)
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);

    const status = searchParams.get('status') || 'all';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query
    let query = supabase
      .from('comments')
      .select(`
        id,
        clip_id,
        username,
        avatar_url,
        comment_text,
        likes_count,
        parent_comment_id,
        created_at,
        moderation_status,
        moderation_reason
      `, { count: 'exact' })
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    // Filter by status
    if (status === 'pending') {
      query = query.eq('moderation_status', 'pending');
    } else if (status === 'flagged') {
      query = query.eq('moderation_status', 'flagged');
    } else if (status !== 'all') {
      query = query.in('moderation_status', ['pending', 'flagged']);
    }

    const { data: comments, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[GET /api/admin/comments] Error:', error);
      return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
    }

    // Get clip info for each comment
    const clipIds = [...new Set((comments || []).map(c => c.clip_id))];
    const { data: clips } = await supabase
      .from('tournament_clips')
      .select('id, title, thumbnail_url')
      .in('id', clipIds);

    const clipMap = new Map(clips?.map(c => [c.id, c]) || []);

    const enrichedComments: ModerationQueueComment[] = (comments || []).map(c => ({
      ...c,
      moderation_status: c.moderation_status || 'approved',
      clip_title: clipMap.get(c.clip_id)?.title || null,
      clip_thumbnail: clipMap.get(c.clip_id)?.thumbnail_url || null,
    }));

    // Get counts by status
    const { data: statusCounts } = await supabase
      .from('comments')
      .select('moderation_status')
      .eq('is_deleted', false)
      .in('moderation_status', ['pending', 'flagged']);

    const counts = {
      pending: statusCounts?.filter(c => c.moderation_status === 'pending').length || 0,
      flagged: statusCounts?.filter(c => c.moderation_status === 'flagged').length || 0,
      total: count || 0,
    };

    return NextResponse.json({
      comments: enrichedComments,
      counts,
      pagination: {
        limit,
        offset,
        total: count || 0,
        has_more: (offset + limit) < (count || 0),
      },
    });
  } catch (err) {
    console.error('[GET /api/admin/comments] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/comments
 * Moderate a comment (approve/reject/flag)
 *
 * Body:
 * - commentId: string (required)
 * - action: 'approve' | 'reject' | 'flag' (required)
 * - reason?: string (optional, for reject/flag)
 */
export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const body = await req.json();
    const { commentId, action, reason } = body;

    if (!commentId || !action) {
      return NextResponse.json(
        { error: 'commentId and action are required' },
        { status: 400 }
      );
    }

    if (!['approve', 'reject', 'flag'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be approve, reject, or flag' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get admin user ID
    const { data: adminUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .single();

    if (!adminUser) {
      return NextResponse.json({ error: 'Admin user not found' }, { status: 404 });
    }

    // Perform moderation action
    const updateData: Record<string, unknown> = {
      moderated_by: adminUser.id,
      moderated_at: new Date().toISOString(),
    };

    switch (action) {
      case 'approve':
        updateData.moderation_status = 'approved';
        updateData.moderation_reason = null;
        break;
      case 'reject':
        updateData.moderation_status = 'rejected';
        updateData.moderation_reason = reason || 'Rejected by admin';
        updateData.is_deleted = true;
        break;
      case 'flag':
        updateData.moderation_status = 'flagged';
        updateData.moderation_reason = reason || 'Flagged for review';
        break;
    }

    const { error } = await supabase
      .from('comments')
      .update(updateData)
      .eq('id', commentId);

    if (error) {
      console.error('[POST /api/admin/comments] Error:', error);
      return NextResponse.json({ error: 'Failed to moderate comment' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      action,
      commentId,
    });
  } catch (err) {
    console.error('[POST /api/admin/comments] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/comments
 * Bulk delete/reject comments
 *
 * Body:
 * - commentIds: string[] (required)
 */
export async function DELETE(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const body = await req.json();
    const { commentIds } = body;

    if (!Array.isArray(commentIds) || commentIds.length === 0) {
      return NextResponse.json(
        { error: 'commentIds array is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get admin user ID
    const { data: adminUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .single();

    const { error } = await supabase
      .from('comments')
      .update({
        is_deleted: true,
        moderation_status: 'rejected',
        moderation_reason: 'Bulk deleted by admin',
        moderated_by: adminUser?.id,
        moderated_at: new Date().toISOString(),
      })
      .in('id', commentIds);

    if (error) {
      console.error('[DELETE /api/admin/comments] Error:', error);
      return NextResponse.json({ error: 'Failed to delete comments' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deleted: commentIds.length,
    });
  } catch (err) {
    console.error('[DELETE /api/admin/comments] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
