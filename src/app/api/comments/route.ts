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
import { getSessionFast } from '@/lib/session-store';
import { broadcastCommentEvent } from '@/lib/realtime-broadcast';
import { pushCommentEvent, type CommentQueueEvent } from '@/lib/comment-event-queue';

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }
  return { url, key };
}

// Feature flag cache (shared across handlers within a single invocation)
async function getCommentFeatureFlags(supabase: SupabaseClient): Promise<Record<string, boolean>> {
  try {
    const { data } = await supabase
      .from('feature_flags')
      .select('key, enabled')
      .in('key', ['redis_session_store', 'async_comments', 'realtime_broadcast']);
    const flags: Record<string, boolean> = {};
    data?.forEach((f: { key: string; enabled: boolean }) => { flags[f.key] = f.enabled; });
    return flags;
  } catch {
    return {};
  }
}

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

async function getUserInfo(
  req: NextRequest,
  supabase: SupabaseClient,
  redisSessionEnabled: boolean = false
) {
  const deviceKey = getUserKey(req);
  let username = `User${deviceKey.substring(0, 6)}`;
  let avatar_url = generateAvatarUrl(deviceKey);
  let userId: string | null = null;
  let isAuthenticated = false;

  try {
    // Redis session store path: single Redis read (~2ms)
    if (redisSessionEnabled) {
      const sessionData = await getSessionFast(req, true);
      if (sessionData) {
        userId = sessionData.userId;
        username = sessionData.username || username;
        avatar_url = sessionData.avatarUrl
          ? getAvatarUrl(sessionData.avatarUrl, sessionData.username || '')
          : generateAvatarUrl(sessionData.userId);
        isAuthenticated = true;
      }
    } else {
      // Original path: getServerSession + Supabase query
      const session = await getServerSession(authOptions);
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
          userId = userData.id;
          username = userData.username;
          avatar_url = getAvatarUrl(userData.avatar_url, userData.username);
          isAuthenticated = true;
        }
      }
    }
  } catch (err) {
    // Fall back to generated username/avatar
    console.error('[getUserInfo] Error getting session:', err);
  }

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
    const { url, key } = getSupabaseConfig();
    const supabase = createClient(url, key);
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

    const flags = await getCommentFeatureFlags(supabase);
    const userInfo = await getUserInfo(req, supabase, flags['redis_session_store'] ?? false);

    // Fetch paginated replies for a specific parent comment
    const parentId = searchParams.get('parentId');
    if (parentId) {
      const replyOffset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));
      const replyLimit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '50', 10), 100));

      const { data: replies, error: replyError, count: replyCount } = await supabase
        .from('comments')
        .select('id, clip_id, user_key, username, avatar_url, comment_text, likes_count, parent_comment_id, created_at, updated_at', { count: 'exact' })
        .eq('parent_comment_id', parentId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .range(replyOffset, replyOffset + replyLimit - 1);

      if (replyError) {
        console.error('[GET /api/comments] reply fetch error:', replyError);
        return NextResponse.json({ error: 'Failed to fetch replies' }, { status: 500 });
      }

      const { data: userLikes } = await supabase
        .from('comment_likes')
        .select('comment_id')
        .eq('user_key', userInfo.userKey);
      const likedIds = new Set(userLikes?.map((l) => l.comment_id) || []);

      const enrichedReplies = (replies || []).map((reply) => ({
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
        is_liked: likedIds.has(reply.id),
      }));

      return NextResponse.json({
        replies: enrichedReplies,
        total: replyCount || 0,
        has_more: (replyCount || 0) > replyOffset + replyLimit,
      }, { status: 200 });
    }

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 100));
    const sort = (searchParams.get('sort') || 'newest') as 'newest' | 'top';
    const offset = (page - 1) * limit;

    // Build query for top-level comments (no parent)
    // Filter by moderation_status if column exists, fall back gracefully if not
    let query = supabase
      .from('comments')
      .select('id, clip_id, user_key, username, avatar_url, comment_text, likes_count, parent_comment_id, created_at, updated_at, is_deleted', { count: 'exact' })
      .eq('clip_id', clipId)
      .is('parent_comment_id', null)
      .eq('is_deleted', false)
      .or('moderation_status.is.null,moderation_status.eq.approved');

    if (sort === 'newest') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order('likes_count', { ascending: false });
    }

    let { data: topLevelComments, error, count } = await query
      .range(offset, offset + limit - 1);

    // If moderation_status column doesn't exist, retry without the filter
    if (error && (error.code === 'PGRST204' || error.message?.includes('moderation_status'))) {
      console.warn('[GET /api/comments] moderation_status column not found, falling back without filter');
      const fallbackQuery = supabase
        .from('comments')
        .select('id, clip_id, user_key, username, avatar_url, comment_text, likes_count, parent_comment_id, created_at, updated_at, is_deleted', { count: 'exact' })
        .eq('clip_id', clipId)
        .is('parent_comment_id', null)
        .eq('is_deleted', false);

      if (sort === 'newest') {
        fallbackQuery.order('created_at', { ascending: false });
      } else {
        fallbackQuery.order('likes_count', { ascending: false });
      }

      const fallback = await fallbackQuery.range(offset, offset + limit - 1);
      topLevelComments = fallback.data;
      error = fallback.error;
      count = fallback.count;
    }

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

    // Group replies by parent comment ID and track totals
    const repliesByParent = new Map<string, typeof allReplies>();
    const totalRepliesByParent = new Map<string, number>();
    (allReplies || []).forEach((reply) => {
      const pid = reply.parent_comment_id;
      totalRepliesByParent.set(pid, (totalRepliesByParent.get(pid) || 0) + 1);
      if (!repliesByParent.has(pid)) {
        repliesByParent.set(pid, []);
      }
      const parentReplies = repliesByParent.get(pid)!;
      // Initially return up to 5 replies per comment
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
        total_replies: totalRepliesByParent.get(comment.id) || 0,
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
    const { url, key } = getSupabaseConfig();
    const supabase = createClient(url, key);
    const flags = await getCommentFeatureFlags(supabase);
    const userInfo = await getUserInfo(req, supabase, flags['redis_session_store'] ?? false);

    // FIX: Require authentication for posting comments (prevent anonymous spam)
    if (!userInfo.isAuthenticated) {
      return NextResponse.json(
        { error: 'Authentication required to post comments' },
        { status: 401 }
      );
    }

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

    const now = new Date().toISOString();
    const sanitizedUsername = sanitizeText(userInfo.username);

    // --- Async comment path: queue for later DB persistence ---
    if (flags['async_comments']) {
      const tempId = crypto.randomUUID();
      const event: CommentQueueEvent = {
        eventId: tempId,
        clipId,
        userKey: userInfo.userKey,
        action: 'create',
        timestamp: Date.now(),
        data: {
          commentText: sanitizedComment,
          parentCommentId: parent_comment_id || undefined,
          username: sanitizedUsername,
          avatarUrl: userInfo.avatar_url,
        },
      };

      await pushCommentEvent(event);

      // Broadcast new comment event
      if (flags['realtime_broadcast']) {
        broadcastCommentEvent(clipId, 'new-comment', {
          id: tempId,
          username: sanitizedUsername,
          avatarUrl: userInfo.avatar_url,
          commentText: sanitizedComment,
          parentCommentId: parent_comment_id || null,
        });
      }

      // Fire-and-forget: Notify parent comment author about the reply (async path)
      if (parent_comment_id) {
        (async () => {
          try {
            const { createNotification } = await import('@/lib/notifications');
            const { data: parentComment } = await supabase
              .from('comments')
              .select('user_key, username')
              .eq('id', parent_comment_id)
              .maybeSingle();

            if (parentComment && parentComment.user_key !== userInfo.userKey) {
              await createNotification({
                user_key: parentComment.user_key,
                type: 'comment_received',
                title: 'New reply',
                message: `@${sanitizedUsername} replied to your comment`,
                action_url: `/clip/${clipId}`,
                metadata: { clipId, commentId: tempId, parentCommentId: parent_comment_id },
              });
            }
          } catch (e) {
            console.error('[comments] Reply notification error (non-fatal):', e);
          }
        })();
      }

      return NextResponse.json({
        success: true,
        comment: {
          id: tempId,
          clip_id: clipId,
          user_key: userInfo.userKey,
          username: sanitizedUsername,
          avatar_url: userInfo.avatar_url,
          comment_text: sanitizedComment,
          likes_count: 0,
          parent_comment_id: parent_comment_id || null,
          created_at: now,
          updated_at: now,
          is_own: true,
          is_liked: false,
          replies: [],
        },
      }, { status: 201 });
    }

    // --- Sync path: direct DB insert (existing behavior) ---
    const insertData = {
      clip_id: clipId,
      user_key: userInfo.userKey,
      username: sanitizedUsername,
      avatar_url: userInfo.avatar_url,
      comment_text: sanitizedComment,
      parent_comment_id: parent_comment_id || null,
      created_at: now,
      updated_at: now,
    };

    const { data: comment, error } = await supabase
      .from('comments')
      .insert(insertData)
      .select()
      .single();

    if (error || !comment) {
      console.error('[POST /api/comments] error:', error);
      return NextResponse.json(
        { error: 'Failed to create comment. Please try again.' },
        { status: 500 }
      );
    }

    // Broadcast new comment event (sync path)
    if (flags['realtime_broadcast']) {
      broadcastCommentEvent(clipId, 'new-comment', {
        id: comment.id,
        username: sanitizedUsername,
        avatarUrl: userInfo.avatar_url,
        commentText: sanitizedComment,
        parentCommentId: parent_comment_id || null,
      });
    }

    // Fire-and-forget: Notify parent comment author about the reply
    if (parent_comment_id) {
      (async () => {
        try {
          const { createNotification } = await import('@/lib/notifications');
          const { data: parentComment } = await supabase
            .from('comments')
            .select('user_key, username')
            .eq('id', parent_comment_id)
            .maybeSingle();

          if (parentComment && parentComment.user_key !== userInfo.userKey) {
            await createNotification({
              user_key: parentComment.user_key,
              type: 'comment_received',
              title: 'New reply',
              message: `@${sanitizedUsername} replied to your comment`,
              action_url: `/clip/${clipId}`,
              metadata: { clipId, commentId: comment.id, parentCommentId: parent_comment_id },
            });
          }
        } catch (e) {
          console.error('[comments] Reply notification error (non-fatal):', e);
        }
      })();
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
    const { url, key } = getSupabaseConfig();
    const supabase = createClient(url, key);
    const flags = await getCommentFeatureFlags(supabase);
    const userInfo = await getUserInfo(req, supabase, flags['redis_session_store'] ?? false);

    // Require authentication for likes to prevent fingerprint-spoofing abuse
    if (!userInfo.isAuthenticated) {
      return NextResponse.json(
        { error: 'Authentication required to like comments' },
        { status: 401 }
      );
    }

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
      .select('likes_count, clip_id')
      .eq('id', comment_id)
      .single();

    // Broadcast like/unlike event
    if (flags['realtime_broadcast'] && comment?.clip_id) {
      broadcastCommentEvent(comment.clip_id, 'comment-liked', {
        commentId: comment_id,
        likesCount: comment?.likes_count || 0,
      });
    }

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
    const { url, key } = getSupabaseConfig();
    const supabase = createClient(url, key);
    const flags = await getCommentFeatureFlags(supabase);
    const userInfo = await getUserInfo(req, supabase, flags['redis_session_store'] ?? false);

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

    // Broadcast comment deletion
    if (flags['realtime_broadcast'] && comment?.clip_id) {
      broadcastCommentEvent(comment.clip_id, 'comment-deleted', {
        commentId: comment_id,
      });
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
