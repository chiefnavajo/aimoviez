// app/api/teams/[id]/messages/route.ts
// Team Messages/Chat API - Get messages, send messages

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeText } from '@/lib/sanitize';
import { requireCsrf } from '@/lib/csrf';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/teams/[id]/messages
 * Get recent team messages
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id: teamId } = await context.params;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);

    // Check if user is in this team
    const { data: membership } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', session.user.userId)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'You are not in this team' }, { status: 403 });
    }

    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const before = searchParams.get('before'); // cursor for pagination

    let query = supabase
      .from('team_messages')
      .select(`
        id,
        message,
        created_at,
        user_id,
        username,
        users:user_id (avatar_url)
      `)
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: messages, error } = await query;

    if (error) {
      console.error('[GET /api/teams/[id]/messages] error:', error);
      return NextResponse.json({ error: 'Failed to get messages' }, { status: 500 });
    }

    // Flatten and reverse for chronological order
    const flatMessages = messages?.map(m => ({
      id: m.id,
      message: m.message,
      created_at: m.created_at,
      user_id: m.user_id,
      username: m.username,
      avatar_url: (m.users as unknown as { avatar_url: string } | null)?.avatar_url,
    })).reverse() || [];

    return NextResponse.json({
      ok: true,
      messages: flatMessages,
      has_more: messages?.length === limit,
    });
  } catch (err) {
    console.error('[GET /api/teams/[id]/messages] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/teams/[id]/messages
 * Send a message to team chat
 */
export async function POST(req: NextRequest, context: RouteContext) {
  // Stricter rate limit for chat (15/min)
  const rateLimitResponse = await rateLimit(req, 'comment');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // CSRF protection
    const csrfError = await requireCsrf(req);
    if (csrfError) return csrfError;

    const { id: teamId } = await context.params;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if user is in this team
    const { data: membership } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', session.user.userId)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'You are not in this team' }, { status: 403 });
    }

    const body = await req.json();
    const { message } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const trimmedMessage = message.trim();
    if (trimmedMessage.length === 0 || trimmedMessage.length > 500) {
      return NextResponse.json(
        { error: 'Message must be 1-500 characters' },
        { status: 400 }
      );
    }

    // FIX: Sanitize message to prevent XSS attacks
    const sanitizedMessage = sanitizeText(trimmedMessage);
    if (sanitizedMessage.length === 0) {
      return NextResponse.json(
        { error: 'Message contains invalid content' },
        { status: 400 }
      );
    }

    // Get user's username
    const { data: user } = await supabase
      .from('users')
      .select('username')
      .eq('id', session.user.userId)
      .single();

    const username = user?.username || 'Anonymous';

    // Insert message
    const { data: newMessage, error } = await supabase
      .from('team_messages')
      .insert({
        team_id: teamId,
        user_id: session.user.userId,
        username: username,
        message: sanitizedMessage,  // FIX: Use sanitized message
      })
      .select(`
        id,
        message,
        created_at,
        user_id,
        username
      `)
      .single();

    if (error) {
      console.error('[POST /api/teams/[id]/messages] error:', error);
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }

    // Update member's last active date
    await supabase
      .from('team_members')
      .update({ last_active_date: new Date().toISOString().split('T')[0] })
      .eq('team_id', teamId)
      .eq('user_id', session.user.userId);

    return NextResponse.json({
      ok: true,
      message: {
        ...newMessage,
        avatar_url: session.user.image || null,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/teams/[id]/messages] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
