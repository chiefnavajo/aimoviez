// app/api/admin/users/[id]/route.ts
// Individual user management (view details, ban/unban)

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
 * GET /api/admin/users/[id]
 * Get detailed user info
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit check - use read limit for viewing user details
  const rateLimitResponse = await rateLimit(request, 'admin_read');
  if (rateLimitResponse) return rateLimitResponse;

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
 * Update user (ban/unban, update role, change username)
 *
 * Body: {
 *   action: 'ban' | 'unban' | 'make_admin' | 'remove_admin' | 'update_username',
 *   reason?: string (for ban),
 *   username?: string (for update_username)
 * }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit check - use sensitive limit for ban/role actions
  const rateLimitResponse = await rateLimit(request, 'admin_sensitive');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const adminAuth = await checkAdminAuth();

  try {
    const { id } = await params;
    const body = await request.json();
    const { action, reason, username } = body;

    if (!action || !['ban', 'unban', 'make_admin', 'remove_admin', 'update_username'].includes(action)) {
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
    let auditAction: 'ban_user' | 'unban_user' | 'grant_admin' | 'revoke_admin' | 'update_username';

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
      case 'update_username':
        // Validate username
        if (!username || typeof username !== 'string') {
          return NextResponse.json(
            { error: 'Username is required' },
            { status: 400 }
          );
        }
        const cleanUsername = username.toLowerCase().trim();
        if (cleanUsername.length < 3 || cleanUsername.length > 20) {
          return NextResponse.json(
            { error: 'Username must be 3-20 characters' },
            { status: 400 }
          );
        }
        if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
          return NextResponse.json(
            { error: 'Username can only contain lowercase letters, numbers, and underscores' },
            { status: 400 }
          );
        }
        // Check if username is already taken
        const { data: existingUser } = await supabase
          .from('users')
          .select('id')
          .eq('username', cleanUsername)
          .neq('id', id)
          .single();
        if (existingUser) {
          return NextResponse.json(
            { error: 'Username is already taken' },
            { status: 400 }
          );
        }
        updateData = { username: cleanUsername };
        auditAction = 'update_username';
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

    const actionMessages: Record<string, string> = {
      ban: 'banned',
      unban: 'unbanned',
      make_admin: 'promoted to admin',
      remove_admin: 'removed from admin',
      update_username: `username changed to @${updateData.username}`,
    };

    return NextResponse.json({
      success: true,
      action,
      userId: id,
      newUsername: action === 'update_username' ? updateData.username : undefined,
      message: `User ${actionMessages[action]}`,
    });
  } catch (error) {
    console.error('User update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
