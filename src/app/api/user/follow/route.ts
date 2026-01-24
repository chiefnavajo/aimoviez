// app/api/user/follow/route.ts
// Follow/Unfollow API - Manage follow relationships between users
// SECURITY: Requires authentication

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/user/follow
 * Follow a user
 * Body: { userId: string }
 */
export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'write');
  if (rateLimitResponse) return rateLimitResponse;

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

    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // Check if already following
    const { data: existingFollow } = await supabase
      .from('followers')
      .select('id')
      .eq('follower_id', currentUser.id)
      .eq('following_id', targetUserId)
      .maybeSingle();

    if (existingFollow) {
      return NextResponse.json(
        { error: 'Already following this user', isFollowing: true },
        { status: 400 }
      );
    }

    // Create follow relationship
    const { error: insertError } = await supabase
      .from('followers')
      .insert({
        follower_id: currentUser.id,
        following_id: targetUserId,
      });

    if (insertError) {
      console.error('[POST /api/user/follow] Insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to follow user' },
        { status: 500 }
      );
    }

    // The trigger will update followers_count automatically

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
  const rateLimitResponse = await rateLimit(req, 'write');
  if (rateLimitResponse) return rateLimitResponse;

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

    const supabase = createClient(supabaseUrl, supabaseKey);

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
