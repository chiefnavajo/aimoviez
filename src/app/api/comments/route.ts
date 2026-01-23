// app/api/comments/route.ts
// Comments API - Manage comments on clips

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import {
  CreateCommentSchema,
  LikeCommentSchema,
  DeleteCommentSchema,
  parseBody,
} from '@/lib/validations';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeComment, sanitizeText } from '@/lib/sanitize';
import { getAvatarUrl, generateAvatarUrl } from '@/lib/utils';

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
  const deviceKey = getUserKey(req);
  let username = `User${deviceKey.substring(0, 6)}`;
  let avatar_url = generateAvatarUrl(deviceKey);
  let userId: string | null = null;
  let isAuthenticated = false;

  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('id, username, avatar_url')
        .eq('email', session.user.email)
        .single<UserData>();

      if (userError && userError.code !== 'PGRST116') {
        // PGRST116 is "not found" which is expected for users without profiles
        console.error('[getUserInfo] Error fetching user data:', userError);
      }

      if (userData) {
        // Use authenticated user data
        userId = userData.id;
        username = userData.username;
        avatar_url = getAvatarUrl(userData.avatar_url, userData.username);
        isAuthenticated = true;
      }
    }
  } catch (err) {
    // Fall back to generated username/avatar
    console.error('[getUserInfo] Error getting session:', err);
  }

  // Use user ID if authenticated, otherwise fall back to device key
  const userKey = userId ? `user_${userId}` : deviceKey;

  return {
    userKey,
    userId,
    username,
    avatar_url,
    isAuthenticated,
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
 *
 * Query params:
 * - clipId: string (required)
 * - countOnly?: boolean (if true, returns only { count: number })
 * - page?: number (default: 1)
 * - limit?: number (default: 20, max: 100)
 * - sort?: 'newest' | 'top' (default: 'newest')
 */
export async function GET(req: NextRequest) {
  // Rate limiting for reads
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);
    const clipId = searchParams.get('clipId');
    const countOnly = searchParams.get('countOnly') === 'true';

    if (!clipId) {
      return NextResponse.json({ error: 'clipId is required' }, { status: 400 });
    }

    // Fast path: return only the count
    if (countOnly) {
      const { count, error } = await supabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('clip_id', clipId)
        .eq('is_deleted', false);

      if (error) {
        console.error('[GET /api/comments] count error:', error);
        return NextResponse.json({ count: 0 }, { status: 200 });
      }

      return NextResponse.json({ count: count || 0 }, { status: 200 });
    }

    const userInfo = await getUserInfo(req, supabase);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 100));
    const sort = (searchParams.get('sort') || 'newest') as 'newest' | 'top';
    const offset = (page - 1) * limit;

    // Build query for top-level comments (no parent)
    // Note: moderation_status filter removed - column may not exist in all deployments
    // If moderation is needed, run the migration-comment-moderation.sql first
    let query = supabase
      .from('comments')
      .select('id, clip_id, user_key, username, avatar_url, comment_text, likes_count, parent_comment_id, created_at, updated_at, is_deleted', { count: 'exact' })
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

    // PERFORMANCE FIX: Batch fetch all replies in a single query instead of N+1
    // Previously: 1 query per comment = N+1 queries
    // Now: 1 query for all replies = 2 total queries
    const commentIds = (topLevelComments || []).map((c) => c.id);
    const { data: allReplies } = await supabase
      .from('comments')
      .select('id, clip_id, user_key, username, avatar_url, comment_text, likes_count, parent_comment_id, created_at, updated_at')
      .in('parent_comment_id', commentIds)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });

    // Group replies by parent comment ID
    const repliesByParent = new Map<string, typeof allReplies>();
    (allReplies || []).forEach((reply) => {
      const parentId = reply.parent_comment_id;
      if (!repliesByParent.has(parentId)) {
        repliesByParent.set(parentId, []);
      }
      const parentReplies = repliesByParent.get(parentId)!;
      // Limit to 5 replies per comment (same as before)
      if (parentReplies.length < 5) {
        parentReplies.push(reply);
      }
    });

    // Build enriched comments with their replies
    const enrichedComments = (topLevelComments || []).map((comment) => {
      const replies = repliesByParent.get(comment.id) || [];

      const enrichedReplies: Comment[] = replies.map((reply) => ({
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
    });

    const response: CommentsResponse = {
      comments: enrichedComments,
      total: count || 0,
      page,
      page_size: limit,
      has_more: (count || 0) > offset + limit,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[GET /api/clip/comments] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/comments
 * Create a new comment
 * 
 * Body: {
 *   clipId: string,
 *   comment_text: string,
 *   parent_comment_id?: string (for replies)
 * }
 */
export async function POST(req: NextRequest) {
  // Rate limiting for comments
  const rateLimitResponse = await rateLimit(req, 'comment');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userInfo = await getUserInfo(req, supabase);
    const body = await req.json();

    // Validate request body with Zod
    const validation = parseBody(CreateCommentSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { clipId, comment_text, parent_comment_id } = validation.data;

    // Sanitize comment text to prevent XSS
    const sanitizedComment = sanitizeComment(comment_text);
    if (!sanitizedComment) {
      return NextResponse.json(
        { error: 'Comment text cannot be empty' },
        { status: 400 }
      );
    }

    // Prepare insert data
    const insertData = {
      clip_id: clipId,
      user_key: userInfo.userKey,
      username: sanitizeText(userInfo.username), // Sanitize username too
      avatar_url: userInfo.avatar_url,
      comment_text: sanitizedComment,
      parent_comment_id: parent_comment_id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: comment, error } = await supabase
      .from('comments')
      .insert(insertData)
      .select()
      .single();

    if (error || !comment) {
      // SECURITY: Log full error server-side, return generic message to client
      console.error('[POST /api/comments] error:', error);
      return NextResponse.json(
        { error: 'Failed to create comment. Please try again.' },
        { status: 500 }
      );
    }

    // TODO: Create notification for clip owner

    return NextResponse.json({
      success: true,
      comment: {
        ...comment,
        is_own: true,
        is_liked: false,
        replies: [],
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/clip/comments] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/comments
 * Like or unlike a comment
 * 
 * Body: {
 *   comment_id: string,
 *   action: 'like' | 'unlike'
 * }
 */
export async function PATCH(req: NextRequest) {
  // Rate limiting for comment likes
  const rateLimitResponse = await rateLimit(req, 'comment');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userInfo = await getUserInfo(req, supabase);
    const body = await req.json();

    // Validate request body with Zod
    const validation = parseBody(LikeCommentSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { comment_id, action } = validation.data;

    if (action === 'like') {
      // Insert like (will auto-increment likes_count via trigger)
      const { error } = await supabase
        .from('comment_likes')
        .insert({
          comment_id,
          user_key: userInfo.userKey,
          created_at: new Date().toISOString(),
        });

      if (error) {
        // Might be duplicate - that's ok
        if (error.code !== '23505') { // unique violation
          console.error('[PATCH /api/comments] like error:', error);
        }
      }
    } else {
      // action === 'unlike' (already validated by Zod)
      const { error } = await supabase
        .from('comment_likes')
        .delete()
        .eq('comment_id', comment_id)
        .eq('user_key', userInfo.userKey);

      if (error) {
        console.error('[PATCH /api/comments] unlike error:', error);
      }
    }

    // Get updated comment
    const { data: comment } = await supabase
      .from('comments')
      .select('likes_count')
      .eq('id', comment_id)
      .single();

    return NextResponse.json({
      success: true,
      comment_id,
      likes_count: comment?.likes_count || 0,
    }, { status: 200 });
  } catch (err) {
    console.error('[PATCH /api/clip/comments] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/comments
 * Delete own comment (soft delete)
 * SECURITY: Requires authentication - users can only delete their own comments
 *
 * Body: {
 *   comment_id: string
 * }
 */
export async function DELETE(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'comment');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userInfo = await getUserInfo(req, supabase);

    // SECURITY: Require authentication for comment deletion
    // Double-check both isAuthenticated AND userId to prevent device fingerprint bypass
    if (!userInfo.isAuthenticated || !userInfo.userId) {
      return NextResponse.json(
        { error: 'Authentication required to delete comments' },
        { status: 401 }
      );
    }

    const body = await req.json();

    // Validate request body with Zod
    const validation = parseBody(DeleteCommentSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { comment_id } = validation.data;

    // Soft delete (set is_deleted = true)
    // Uses authenticated userKey which is based on user ID, not device fingerprint
    const { data: comment, error } = await supabase
      .from('comments')
      .update({ is_deleted: true })
      .eq('id', comment_id)
      .eq('user_key', userInfo.userKey) // Secure: uses user_${userId} not device key
      .select()
      .single();

    if (error || !comment) {
      // Don't reveal if comment exists but belongs to someone else
      return NextResponse.json(
        { error: 'Comment not found or you do not have permission to delete it' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Comment deleted successfully',
    }, { status: 200 });
  } catch (err: unknown) {
    console.error('[DELETE /api/comments] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Failed to delete comment' },
      { status: 500 }
    );
  }
}
