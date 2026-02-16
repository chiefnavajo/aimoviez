// app/api/teams/[id]/invites/route.ts
// Team Invites API - Create, list, revoke invite codes

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/teams/[id]/invites
 * List active invites for team
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

    // Check if user is in this team
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', session.user.userId)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'You are not in this team' }, { status: 403 });
    }

    // Get active invites
    const { data: invites, error } = await supabase
      .from('team_invites')
      .select(`
        id,
        invite_code,
        max_uses,
        uses,
        expires_at,
        created_at,
        invited_by,
        users:invited_by (username)
      `)
      .eq('team_id', teamId)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/teams/[id]/invites] error:', error);
      return NextResponse.json({ error: 'Failed to get invites' }, { status: 500 });
    }

    // Filter out maxed out invites and flatten response
    const activeInvites = invites
      ?.filter(i => i.max_uses === null || i.uses < i.max_uses)
      .map(i => ({
        id: i.id,
        code: i.invite_code,
        max_uses: i.max_uses,
        uses: i.uses,
        expires_at: i.expires_at,
        created_at: i.created_at,
        created_by: (i.users as unknown as { username: string } | null)?.username,
      })) || [];

    return NextResponse.json({ ok: true, invites: activeInvites });
  } catch (err) {
    console.error('[GET /api/teams/[id]/invites] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/teams/[id]/invites
 * Create a new invite code
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'api');
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

    // Check if user is in this team with permissions
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', session.user.userId)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'You are not in this team' }, { status: 403 });
    }

    // Check team size
    const { data: team } = await supabase
      .from('teams')
      .select('member_count')
      .eq('id', teamId)
      .single();

    if (team && team.member_count >= 5) {
      return NextResponse.json({ error: 'Team is full (max 5 members)' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const rawMaxUses = typeof body.max_uses === 'number' ? body.max_uses : 5;
    const rawExpiresInDays = typeof body.expires_in_days === 'number' ? body.expires_in_days : 7;
    const maxUses = Math.max(1, Math.min(rawMaxUses, 10));
    const expiresInDays = Math.max(1, Math.min(rawExpiresInDays, 30));

    // Generate unique code
    const { data: codeData } = await supabase.rpc('generate_invite_code');
    const inviteCode = codeData || generateFallbackCode();

    // Create invite
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const { data: invite, error } = await supabase
      .from('team_invites')
      .insert({
        team_id: teamId,
        invited_by: session.user.userId,
        invite_code: inviteCode,
        max_uses: maxUses,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /api/teams/[id]/invites] error:', error);
      return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
    }

    // Generate shareable link
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://aimoviez.com';
    const shareLink = `${baseUrl}/team/join?code=${inviteCode}`;

    return NextResponse.json({
      ok: true,
      invite: {
        id: invite.id,
        code: invite.invite_code,
        max_uses: invite.max_uses,
        expires_at: invite.expires_at,
        share_link: shareLink,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/teams/[id]/invites] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/teams/[id]/invites
 * Revoke an invite code
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'api');
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
    const { searchParams } = new URL(req.url);
    const inviteId = searchParams.get('invite_id');

    if (!inviteId) {
      return NextResponse.json({ error: 'invite_id is required' }, { status: 400 });
    }

    // Check if user is in this team with permissions
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', session.user.userId)
      .single();

    if (!membership || membership.role === 'member') {
      return NextResponse.json(
        { error: 'Only leader or officers can revoke invites' },
        { status: 403 }
      );
    }

    // Delete invite
    const { error } = await supabase
      .from('team_invites')
      .delete()
      .eq('id', inviteId)
      .eq('team_id', teamId);

    if (error) {
      console.error('[DELETE /api/teams/[id]/invites] error:', error);
      return NextResponse.json({ error: 'Failed to revoke invite' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: 'Invite revoked' });
  } catch (err) {
    console.error('[DELETE /api/teams/[id]/invites] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Fallback code generator if RPC fails
function generateFallbackCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
