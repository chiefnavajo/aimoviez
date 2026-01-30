// app/api/user/block/route.ts
// Block/unblock users

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
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
 * GET /api/user/block
 * Get list of blocked users
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = getSupabaseClient();
    const checkUserId = request.nextUrl.searchParams.get('userId');

    // Single-user check: GET /api/user/block?userId=xxx
    if (checkUserId) {
      const { data, error } = await supabase
        .from('user_blocks')
        .select('id')
        .eq('blocker_id', session.user.userId)
        .eq('blocked_id', checkUserId)
        .maybeSingle();

      if (error) {
        if (error.code === '42P01') {
          return NextResponse.json({ blocked: false });
        }
        throw error;
      }

      return NextResponse.json({ blocked: !!data });
    }

    // Full list: GET /api/user/block
    const { data: blocks, error } = await supabase
      .from('user_blocks')
      .select(`
        id,
        blocked_id,
        created_at,
        blocked:users!user_blocks_blocked_id_fkey(
          id,
          username,
          avatar_url
        )
      `)
      .eq('blocker_id', session.user.userId)
      .order('created_at', { ascending: false });

    if (error) {
      // If table doesn't exist, return empty array
      if (error.code === '42P01') {
        return NextResponse.json({ blocks: [] });
      }
      throw error;
    }

    return NextResponse.json({ blocks: blocks || [] });
  } catch (error) {
    console.error('Get blocks error:', error);
    return NextResponse.json(
      { error: 'Failed to get blocked users' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/block
 * Block a user
 * Body: { userId: string }
 */
export async function POST(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    if (userId === session.user.userId) {
      return NextResponse.json(
        { error: 'Cannot block yourself' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Check if user exists
    const { data: targetUser } = await supabase
      .from('users')
      .select('id, username')
      .eq('id', userId)
      .single();

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Create block
    const { error: insertError } = await supabase
      .from('user_blocks')
      .insert({
        blocker_id: session.user.userId,
        blocked_id: userId,
      });

    if (insertError) {
      if (insertError.code === '42P01') {
        console.error('user_blocks table does not exist — block action lost');
        return NextResponse.json(
          { error: 'Block feature temporarily unavailable.' },
          { status: 500 }
        );
      }
      // Duplicate block
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'User is already blocked' },
          { status: 400 }
        );
      }
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      message: `Blocked ${targetUser.username}`,
    });
  } catch (error) {
    console.error('Block user error:', error);
    return NextResponse.json(
      { error: 'Failed to block user' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/block
 * Unblock a user
 * Query: userId
 */
export async function DELETE(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    const { error: deleteError } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', session.user.userId)
      .eq('blocked_id', userId);

    if (deleteError) {
      if (deleteError.code === '42P01') {
        console.error('user_blocks table does not exist — unblock action lost');
        return NextResponse.json(
          { error: 'Block feature temporarily unavailable.' },
          { status: 500 }
        );
      }
      throw deleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unblock user error:', error);
    return NextResponse.json(
      { error: 'Failed to unblock user' },
      { status: 500 }
    );
  }
}

