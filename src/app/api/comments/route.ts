// app/api/comments/route.ts
// Comments API - Manage comments on clips
// Handles likes_count manually (no DB triggers needed)

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import crypto from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getUserKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

interface UserData {
  id: string;
  username: string;
  avatar_url: string | null;
}

async function getUserInfo(req: NextRequest, supabase: SupabaseClient) {
  const userKey = getUserKey(req);
  let username = `User${userKey.substring(0, 6)}`;
  let avatar_url = `https://api.dicebear.com/7.x/avataaars/svg?seed=${userKey}`;
  
  try {
    const session = await getServerSession();
    if (session?.user?.email) {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, username, avatar_url')
        .eq('email', session.user.email)
        .single<UserData>();
      
      if (userError && userError.code !== 'PGRST116') {
        console.error('[getUserInfo] Error fetching user data:', userError);
      }
      
      if (userData) {
        username = userData.username;
        avatar_url = userData.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userData.username}`;
      }
    }
  } catch (err) {
    console.error('[getUserInfo] Error getting session:', err);
  }
  
  return {
    userKey,
    username,
    avatar_url,
  };
}

interface Comment {
  id: string;
  clip_id: string;
  user_key: string;
  username: string;
  avatar_url: string;
  comment_text: string;
  likes_count: number;
  parent_comment_id?: string;
  created_at: string;
  updated_at: string;
  is_own: boolean;
  is_liked: boolean;
  replies?: Comment[];
}

interface CommentsResponse {
  comments: Comment[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

/**
 * GET /api/comments
 * Fetch comments for a clip
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userInfo = await getUserInfo(req, supabase);
    const { searchParams } = new URL(req.url);
    const clipId = searchParams.get('clipId');
    
    if (!clipId) {
      return NextResponse.json({ error: 'clipId is required' }, { status: 400 });
    }
    
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const sort = (searchParams.get('sort') || 'newest') as 'newest' | 'top';
    const offset = (page - 1) * limit;

    // Build query for top-level comments (no parent)
    let query = supabase
      .from('comments')
      .select('*', { count: 'exact' })
      .eq('clip_id', clipId)
      .is('parent_comment_id', null)
      .eq('is_deleted', false);

    if (sort === 'newest') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order('likes_count', { ascending: false });
    }

    const { data: topLevelComments, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[GET /api/comments] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch comments' },
        { status: 500 }
      );
    }

    // Get user's likes
    const { data: userLikes } = await supabase
      .from('comment_likes')
      .select('comment_id')
      .eq('user_key', userInfo.userKey);

    const likedCommentIds = new Set(userLikes?.map((l) => l.comment_id) || []);

    // Fetch replies for each top-level comment
    const enrichedComments = await Promise.all(
      (topLevelComments || []).map(async (comment) => {
        const { data: replies } = await supabase
          .from('comments')
          .select('*')
          .eq('parent_comment_id', comment.id)
          .eq('is_deleted', false)
          .order('created_at', { ascending: true })
          .limit(5);

        const enrichedReplies: Comment[] = (replies || []).map((reply) => ({
          id: reply.id,
          clip_id: reply.clip_id,
          user_key: reply.user_key || '',
          username: reply.username,
          avatar_url: reply.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${reply.username}`,
          comment_text: reply.comment_text,
          likes_count: reply.likes_count || 0,
          parent_comment_id: reply.parent_comment_id,
          created_at: reply.created_at,
          updated_at: reply.updated_at,
          is_own: reply.user_key === userInfo.userKey,
          is_liked: likedCommentIds.has(reply.id),
        }));

        return {
          id: comment.id,
          clip_id: comment.clip_id,
          user_key: comment.user_key || '',
          username: comment.username,
          avatar_url: comment.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.username}`,
          comment_text: comment.comment_text,
          likes_count: comment.likes_count || 0,
          created_at: comment.created_at,
          updated_at: comment.updated_at,
          is_own: comment.user_key === userInfo.userKey,
          is_liked: likedCommentIds.has(comment.id),
          replies: enrichedReplies,
        };
      })
    );

    const response: CommentsResponse = {
      comments: enrichedComments,
      total: count || 0,
      page,
      page_size: limit,
      has_more: (count || 0) > offset + limit,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[GET /api/comments] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * POST /api/comments
 * Create a new comment
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userInfo = await getUserInfo(req, supabase);
    const body = await req.json();

    const { clipId, comment_text, parent_comment_id } = body;

    if (!clipId) {
      return NextResponse.json(
        { error: 'clipId is required' },
        { status: 400 }
      );
    }

    if (!comment_text || comment_text.trim().length === 0) {
      return NextResponse.json(
        { error: 'Comment text is required' },
        { status: 400 }
      );
    }

    if (comment_text.length > 500) {
      return NextResponse.json(
        { error: 'Comment is too long (max 500 characters)' },
        { status: 400 }
      );
    }

    const insertData = {
      clip_id: clipId,
      user_key: userInfo.userKey,
      username: userInfo.username,
      avatar_url: userInfo.avatar_url,
      comment_text: comment_text.trim(),
      parent_comment_id: parent_comment_id || null,
      likes_count: 0,
      is_deleted: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: comment, error } = await supabase
      .from('comments')
      .insert(insertData)
      .select()
      .single();

    if (error || !comment) {
      console.error('[POST /api/comments] error:', error);
      return NextResponse.json(
        { error: 'Failed to create comment', details: error?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      comment: {
        ...comment,
        is_own: true,
        is_liked: false,
        replies: [],
      },
    }, { status: 201 });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[POST /api/comments] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/comments
 * Like or unlike a comment (handles likes_count manually - no DB triggers needed)
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userInfo = await getUserInfo(req, supabase);
    const body = await req.json();

    const { comment_id, action } = body;

    if (!comment_id || !action) {
      return NextResponse.json(
        { error: 'comment_id and action are required' },
        { status: 400 }
      );
    }

    if (action === 'like') {
      // Check if already liked
      const { data: existingLike } = await supabase
        .from('comment_likes')
        .select('id')
        .eq('comment_id', comment_id)
        .eq('user_key', userInfo.userKey)
        .maybeSingle();

      if (existingLike) {
        // Already liked, just return current count
        const { data: comment } = await supabase
          .from('comments')
          .select('likes_count')
          .eq('id', comment_id)
          .single();

        return NextResponse.json({
          success: true,
          comment_id,
          likes_count: comment?.likes_count || 0,
          already_liked: true,
        }, { status: 200 });
      }

      // Insert like record
      const { error: likeError } = await supabase
        .from('comment_likes')
        .insert({
          comment_id,
          user_key: userInfo.userKey,
          created_at: new Date().toISOString(),
        });

      if (likeError) {
        console.error('[PATCH /api/comments] like insert error:', likeError);
        return NextResponse.json(
          { error: 'Failed to like comment' },
          { status: 500 }
        );
      }

      // Get current count and increment
      const { data: currentComment } = await supabase
        .from('comments')
        .select('likes_count')
        .eq('id', comment_id)
        .single();

      const newCount = (currentComment?.likes_count || 0) + 1;

      await supabase
        .from('comments')
        .update({ likes_count: newCount })
        .eq('id', comment_id);

      return NextResponse.json({
        success: true,
        comment_id,
        likes_count: newCount,
      }, { status: 200 });

    } else if (action === 'unlike') {
      // Check if liked
      const { data: existingLike } = await supabase
        .from('comment_likes')
        .select('id')
        .eq('comment_id', comment_id)
        .eq('user_key', userInfo.userKey)
        .maybeSingle();

      if (!existingLike) {
        // Not liked, just return current count
        const { data: comment } = await supabase
          .from('comments')
          .select('likes_count')
          .eq('id', comment_id)
          .single();

        return NextResponse.json({
          success: true,
          comment_id,
          likes_count: comment?.likes_count || 0,
          not_liked: true,
        }, { status: 200 });
      }

      // Delete like record
      const { error: unlikeError } = await supabase
        .from('comment_likes')
        .delete()
        .eq('comment_id', comment_id)
        .eq('user_key', userInfo.userKey);

      if (unlikeError) {
        console.error('[PATCH /api/comments] unlike delete error:', unlikeError);
        return NextResponse.json(
          { error: 'Failed to unlike comment' },
          { status: 500 }
        );
      }

      // Get current count and decrement
      const { data: currentComment } = await supabase
        .from('comments')
        .select('likes_count')
        .eq('id', comment_id)
        .single();

      const newCount = Math.max(0, (currentComment?.likes_count || 0) - 1);

      await supabase
        .from('comments')
        .update({ likes_count: newCount })
        .eq('id', comment_id);

      return NextResponse.json({
        success: true,
        comment_id,
        likes_count: newCount,
      }, { status: 200 });

    } else {
      return NextResponse.json(
        { error: 'action must be "like" or "unlike"' },
        { status: 400 }
      );
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PATCH /api/comments] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/comments
 * Delete own comment (soft delete)
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userInfo = await getUserInfo(req, supabase);
    const body = await req.json();

    const { comment_id } = body;

    if (!comment_id) {
      return NextResponse.json(
        { error: 'comment_id is required' },
        { status: 400 }
      );
    }

    const { data: comment, error } = await supabase
      .from('comments')
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', comment_id)
      .eq('user_key', userInfo.userKey)
      .select()
      .single();

    if (error || !comment) {
      console.error('[DELETE /api/comments] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete comment or comment not found' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Comment deleted successfully',
    }, { status: 200 });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[DELETE /api/comments] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
