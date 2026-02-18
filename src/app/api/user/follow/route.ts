// app/api/user/follow/route.ts
// Follow/Unfollow API - Manage follow relationships between users
// SECURITY: Requires authentication

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(url, key);
}

// UUID validation helper
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/user/follow
 * Follow a user
 * Body: { userId: string }
 */
export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;
  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  try {
    // Require authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { userId: targetUserId } = body;

    if (!targetUserId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Validate targetUserId is a valid UUID
    if (!UUID_REGEX.test(targetUserId)) {
      return NextResponse.json(
        { error: 'Invalid userId format' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get current user
    const { data: currentUser } = await supabase
      .from('users')
      .select('id, username')
      .eq('email', session.user.email)
      .single();

    if (!currentUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Can't follow yourself
    if (currentUser.id === targetUserId) {
      return NextResponse.json(
        { error: 'Cannot follow yourself' },
        { status: 400 }
      );
    }

    // Check if target user exists
    const { data: targetUser } = await supabase
      .from('users')
      .select('id, username')
      .eq('id', targetUserId)
      .single();

    if (!targetUser) {
      return NextResponse.json(
        { error: 'Target user not found' },
        { status: 404 }
      );
    }

    // Use upsert to prevent race condition (check-then-insert)
    // onConflict will handle duplicates gracefully
    const { error: insertError } = await supabase
      .from('followers')
      .upsert(
        {
          follower_id: currentUser.id,
          following_id: targetUserId,
        },
        {
          onConflict: 'follower_id,following_id',
          ignoreDuplicates: true,
        }
      );

    if (insertError) {
      // Handle unique constraint violation (should be rare with upsert)
      if (insertError.code === '23505') {
        return NextResponse.json({
          success: true,
          isFollowing: true,
          message: `Already following @${targetUser.username}`,
        });
      }
      console.error('[POST /api/user/follow] Insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to follow user' },
        { status: 500 }
      );
    }

    // The trigger will update followers_count automatically

    // Fire-and-forget: Notify target user about new follower
    import('@/lib/notifications').then(({ createNotification }) => {
      createNotification({
        user_key: `user_${targetUserId}`,
        type: 'new_follower',
        title: 'New follower',
        message: `@${currentUser.username} started following you`,
        action_url: `/profile/${currentUser.id}`,
        metadata: { followerId: currentUser.id },
      }).catch(e => console.error('[follow] Notification error (non-fatal):', e));
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      isFollowing: true,
      message: `Now following @${targetUser.username}`,
    });
  } catch (err) {
    console.error('[POST /api/user/follow] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/follow
 * Unfollow a user
 * Query: ?userId=xxx
 */
export async function DELETE(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;
  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  try {
    // Require authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get('userId');

    if (!targetUserId) {
      return NextResponse.json(
        { error: 'userId query parameter is required' },
        { status: 400 }
      );
    }

    // Validate targetUserId is a valid UUID
    if (!UUID_REGEX.test(targetUserId)) {
      return NextResponse.json(
        { error: 'Invalid userId format' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Get current user
    const { data: currentUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .single();

    if (!currentUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Delete follow relationship
    const { error: deleteError } = await supabase
      .from('followers')
      .delete()
      .eq('follower_id', currentUser.id)
      .eq('following_id', targetUserId);

    if (deleteError) {
      console.error('[DELETE /api/user/follow] Delete error:', deleteError);
      return NextResponse.json(
        { error: 'Failed to unfollow user' },
        { status: 500 }
      );
    }

    // The trigger will update followers_count automatically

    return NextResponse.json({
      success: true,
      isFollowing: false,
      message: 'Unfollowed successfully',
    });
  } catch (err) {
    console.error('[DELETE /api/user/follow] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
