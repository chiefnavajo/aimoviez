// app/api/admin/users/[id]/route.ts
// Individual user management (view details, ban/unban)

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

/**
 * GET /api/admin/users/[id]
 * Get detailed user info
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { id } = await params;
    const supabase = getSupabaseClient();

    // Get user profile
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, display_name, email, avatar_url, bio, level, xp, total_votes_cast, total_votes_received, clips_uploaded, clips_locked, followers_count, following_count, is_admin, is_banned, banned_at, ban_reason, created_at, updated_at')
      .eq('id', id)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get user's clips
    const { data: clips, count: clipCount } = await supabase
      .from('tournament_clips')
      .select('id, title, status, vote_count, created_at', { count: 'exact' })
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Get user's vote count
    const { count: voteCount } = await supabase
      .from('votes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id);

    // Get user's comment count
    const { count: commentCount } = await supabase
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id);

    // Get recent activity (last 10 actions)
    const { data: recentVotes } = await supabase
      .from('votes')
      .select('id, clip_id, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(5);

    return NextResponse.json({
      success: true,
      user: {
        ...user,
        stats: {
          clips: clipCount || 0,
          votes: voteCount || 0,
          comments: commentCount || 0,
        },
        recentClips: clips || [],
        recentVotes: recentVotes || [],
      },
    });
  } catch (error) {
    console.error('User detail error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/users/[id]
 * Update user (ban/unban, update role)
 *
 * Body: {
 *   action: 'ban' | 'unban' | 'make_admin' | 'remove_admin',
 *   reason?: string (for ban)
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const adminAuth = await checkAdminAuth();

  try {
    const { id } = await params;
    const body = await request.json();
    const { action, reason } = body;

    if (!action || !['ban', 'unban', 'make_admin', 'remove_admin'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get current user info
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, email, is_banned, is_admin')
      .eq('id', id)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Prevent self-modification for certain actions
    if (adminAuth.userId === id && (action === 'ban' || action === 'remove_admin')) {
      return NextResponse.json(
        { error: 'Cannot perform this action on yourself' },
        { status: 400 }
      );
    }

    let updateData: Record<string, unknown> = {};
    let auditAction: 'ban_user' | 'unban_user' | 'grant_admin' | 'revoke_admin';

    switch (action) {
      case 'ban':
        updateData = {
          is_banned: true,
          banned_at: new Date().toISOString(),
          ban_reason: reason || 'No reason provided',
        };
        auditAction = 'ban_user';
        break;
      case 'unban':
        updateData = {
          is_banned: false,
          banned_at: null,
          ban_reason: null,
        };
        auditAction = 'unban_user';
        break;
      case 'make_admin':
        updateData = { is_admin: true };
        auditAction = 'grant_admin';
        break;
      case 'remove_admin':
        updateData = { is_admin: false };
        auditAction = 'revoke_admin';
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    const { error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      console.error('User update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update user' },
        { status: 500 }
      );
    }

    // Log the action
    await logAdminAction(request, {
      action: auditAction,
      resourceType: 'user',
      resourceId: id,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        targetUsername: user.username,
        targetEmail: user.email,
        reason: reason || undefined,
      },
    });

    return NextResponse.json({
      success: true,
      action,
      userId: id,
      message: `User ${action === 'ban' ? 'banned' : action === 'unban' ? 'unbanned' : action === 'make_admin' ? 'promoted to admin' : 'removed from admin'}`,
    });
  } catch (error) {
    console.error('User update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
