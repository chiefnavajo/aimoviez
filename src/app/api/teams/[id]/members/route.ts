// app/api/teams/[id]/members/route.ts
// Team Members API - List, kick members, leave team

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
 * GET /api/teams/[id]/members
 * List team members
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

    const { data: members, error } = await supabase
      .from('team_members')
      .select(`
        id,
        role,
        contribution_xp,
        contribution_votes,
        last_active_date,
        joined_at,
        users:user_id (
          id,
          username,
          avatar_url,
          level,
          xp
        )
      `)
      .eq('team_id', teamId)
      .order('joined_at');

    if (error) {
      console.error('[GET /api/teams/[id]/members] error:', error);
      return NextResponse.json({ error: 'Failed to get members' }, { status: 500 });
    }

    // Flatten and sort by role hierarchy (leader > officer > member)
    const roleOrder: Record<string, number> = { leader: 0, officer: 1, member: 2 };
    const flatMembers = (members?.map(m => ({
      id: m.id,
      role: m.role,
      contribution_xp: m.contribution_xp,
      contribution_votes: m.contribution_votes,
      last_active_date: m.last_active_date,
      joined_at: m.joined_at,
      user: m.users,
    })) || []).sort((a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3));

    return NextResponse.json({ ok: true, members: flatMembers });
  } catch (err) {
    console.error('[GET /api/teams/[id]/members] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/teams/[id]/members
 * Leave team or kick member (leader/officer only for kick)
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
    const targetUserId = searchParams.get('user_id');

    // If no target user, user is leaving their own team
    if (!targetUserId || targetUserId === session.user.userId) {
      const { data: result, error } = await supabase.rpc('leave_team', {
        p_user_id: session.user.userId,
      });

      if (error) {
        console.error('[DELETE /api/teams/[id]/members] leave_team error:', error);
        if (error.message?.includes('not in a team')) {
          return NextResponse.json({ error: 'You are not in a team' }, { status: 400 });
        }
        return NextResponse.json({ error: 'Failed to leave team' }, { status: 500 });
      }

      return NextResponse.json({ ok: true, message: 'Left team successfully' });
    }

    // Kicking another member - check permissions
    const { data: requesterMembership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', session.user.userId)
      .single();

    if (!requesterMembership) {
      return NextResponse.json({ error: 'You are not in this team' }, { status: 403 });
    }

    if (requesterMembership.role !== 'leader' && requesterMembership.role !== 'officer') {
      return NextResponse.json(
        { error: 'Only leader or officers can kick members' },
        { status: 403 }
      );
    }

    // Get target member
    const { data: targetMembership } = await supabase
      .from('team_members')
      .select('role, users:user_id(username)')
      .eq('team_id', teamId)
      .eq('user_id', targetUserId)
      .single();

    if (!targetMembership) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Can't kick leader
    if (targetMembership.role === 'leader') {
      return NextResponse.json({ error: 'Cannot kick team leader' }, { status: 403 });
    }

    // Officers can't kick other officers
    if (requesterMembership.role === 'officer' && targetMembership.role === 'officer') {
      return NextResponse.json({ error: 'Officers cannot kick other officers' }, { status: 403 });
    }

    // Remove member
    const { error: deleteError } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', targetUserId);

    if (deleteError) {
      console.error('[DELETE /api/teams/[id]/members] kick error:', deleteError);
      return NextResponse.json({ error: 'Failed to kick member' }, { status: 500 });
    }

    // Decrement member_count on the team
    const { data: team } = await supabase
      .from('teams')
      .select('member_count')
      .eq('id', teamId)
      .single();

    if (team) {
      await supabase
        .from('teams')
        .update({ member_count: Math.max(0, (team.member_count || 1) - 1) })
        .eq('id', teamId);
    }

    const targetUsername = (targetMembership.users as unknown as { username: string } | null)?.username || 'Member';
    return NextResponse.json({
      ok: true,
      message: `${targetUsername} has been removed from the team`,
    });
  } catch (err) {
    console.error('[DELETE /api/teams/[id]/members] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/teams/[id]/members
 * Promote/demote member (leader only)
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
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
    const body = await req.json();
    const { user_id: targetUserId, role: newRole } = body;

    if (!targetUserId || !newRole) {
      return NextResponse.json({ error: 'user_id and role are required' }, { status: 400 });
    }

    if (!['member', 'officer'].includes(newRole)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Check if requester is team leader
    const { data: team } = await supabase
      .from('teams')
      .select('leader_id')
      .eq('id', teamId)
      .single();

    if (!team || team.leader_id !== session.user.userId) {
      return NextResponse.json({ error: 'Only team leader can change roles' }, { status: 403 });
    }

    // Can't change own role
    if (targetUserId === session.user.userId) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
    }

    // Update member role
    const { data: updated, error: updateError } = await supabase
      .from('team_members')
      .update({ role: newRole })
      .eq('team_id', teamId)
      .eq('user_id', targetUserId)
      .select('id');

    if (updateError) {
      console.error('[PATCH /api/teams/[id]/members] error:', updateError);
      return NextResponse.json({ error: 'Failed to update role' }, { status: 500 });
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Member not found in this team' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: `Member role updated to ${newRole}`,
    });
  } catch (err) {
    console.error('[PATCH /api/teams/[id]/members] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
