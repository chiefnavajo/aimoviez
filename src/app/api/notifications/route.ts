// app/api/notifications/route.ts
// Notifications API - User notifications system

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getDeviceFingerprintKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

async function getUserKey(req: NextRequest): Promise<string> {
  const session = await getServerSession(authOptions);
  if (session?.user?.userId) {
    return `user_${session.user.userId}`;
  }
  return getDeviceFingerprintKey(req);
}

type NotificationType = 
  | 'clip_approved'
  | 'clip_rejected'
  | 'clip_locked_in'
  | 'slot_voting_started'
  | 'achievement_unlocked'
  | 'daily_goal_reached'
  | 'new_follower'
  | 'comment_received'
  | 'system_announcement';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  action_url?: string;
  metadata: any;
  is_read: boolean;
  created_at: string;
  read_at?: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

/**
 * GET /api/notifications
 * Fetch user's notifications
 * 
 * Query params:
 * - filter?: 'all' | 'unread' (default: 'all')
 * - page?: number (default: 1)
 * - limit?: number (default: 20, max: 100)
 */
export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userKey = await getUserKey(req);
    const { searchParams } = new URL(req.url);
    
    const filter = searchParams.get('filter') || 'all';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('notifications')
      .select('id, type, title, message, action_url, metadata, is_read, created_at, read_at', { count: 'exact' })
      .eq('user_key', userKey)
      .order('created_at', { ascending: false });

    if (filter === 'unread') {
      query = query.eq('is_read', false);
    }

    const { data: notifications, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[GET /api/notifications] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch notifications' },
        { status: 500 }
      );
    }

    // Get unread count
    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_key', userKey)
      .eq('is_read', false);

    const response: NotificationsResponse = {
      notifications: notifications || [],
      unread_count: unreadCount || 0,
      total: count || 0,
      page,
      page_size: limit,
      has_more: (count || 0) > offset + limit,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[GET /api/notifications] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/notifications
 * Create a new notification (system use)
 * 
 * Body: {
 *   user_key: string,
 *   type: NotificationType,
 *   title: string,
 *   message: string,
 *   action_url?: string,
 *   metadata?: any
 * }
 */
export async function POST(req: NextRequest) {
  // Only admins/system can create notifications for users
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const {
      user_key,
      type,
      title,
      message,
      action_url,
      metadata = {},
    } = body;

    if (!user_key || !type || !title || !message) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        user_key,
        type,
        title,
        message,
        action_url,
        metadata,
        is_read: false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !notification) {
      console.error('[POST /api/notifications] error:', error);
      return NextResponse.json(
        { error: 'Failed to create notification' },
        { status: 500 }
      );
    }

    // TODO: Send push notification via FCM/APNS if enabled

    return NextResponse.json({
      success: true,
      notification,
    }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/notifications] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/notifications
 * Mark notification(s) as read
 * 
 * Body: {
 *   notification_ids?: string[], // Mark specific notifications
 *   mark_all_read?: boolean      // Or mark all as read
 * }
 */
export async function PATCH(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userKey = await getUserKey(req);
    const body = await req.json();

    const { notification_ids, mark_all_read } = body;

    if (!notification_ids && !mark_all_read) {
      return NextResponse.json(
        { error: 'Either notification_ids or mark_all_read must be provided' },
        { status: 400 }
      );
    }

    const updates = {
      is_read: true,
      read_at: new Date().toISOString(),
    };

    let query = supabase
      .from('notifications')
      .update(updates)
      .eq('user_key', userKey);

    if (notification_ids && Array.isArray(notification_ids)) {
      query = query.in('id', notification_ids);
    }

    const { data: notifications, error } = await query.select();

    if (error) {
      console.error('[PATCH /api/notifications] error:', error);
      return NextResponse.json(
        { error: 'Failed to update notifications' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      updated_count: notifications?.length || 0,
    }, { status: 200 });
  } catch (err) {
    console.error('[PATCH /api/notifications] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/notifications
 * Delete notification(s)
 * 
 * Body: {
 *   notification_ids: string[]
 * }
 */
export async function DELETE(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userKey = await getUserKey(req);
    const body = await req.json();

    const { notification_ids } = body;

    if (!notification_ids || !Array.isArray(notification_ids)) {
      return NextResponse.json(
        { error: 'notification_ids array is required' },
        { status: 400 }
      );
    }

    if (notification_ids.length > 500) {
      return NextResponse.json(
        { error: 'Maximum 500 notifications per delete' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('user_key', userKey)
      .in('id', notification_ids);

    if (error) {
      console.error('[DELETE /api/notifications] error:', error);
      return NextResponse.json(
        { error: 'Failed to delete notifications' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${notification_ids.length} notification(s) deleted`,
    }, { status: 200 });
  } catch (err) {
    console.error('[DELETE /api/notifications] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Note: createNotification helper moved to @/lib/notifications.ts
