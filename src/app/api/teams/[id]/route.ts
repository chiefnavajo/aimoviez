// app/api/teams/[id]/route.ts
// Team by ID API - Get, update, delete team

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/teams/[id]
 * Get team details with members
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

    const { data: team, error } = await supabase.rpc('get_team_with_stats', {
      p_team_id: teamId,
    });

    if (error) {
      console.error('[GET /api/teams/[id]] get_team_with_stats error:', error);
      return NextResponse.json({ error: 'Failed to get team' }, { status: 500 });
    }

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, team });
  } catch (err) {
    console.error('[GET /api/teams/[id]] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/teams/[id]
 * Update team (leader only)
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id: teamId } = await context.params;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if user is team leader
    const { data: team } = await supabase
      .from('teams')
      .select('leader_id')
      .eq('id', teamId)
      .single();

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    if (team.leader_id !== session.user.userId) {
      return NextResponse.json({ error: 'Only team leader can update team' }, { status: 403 });
    }

    const body = await req.json();
    const updateData: Record<string, unknown> = {};

    // Validate and add fields to update
    if (body.name !== undefined) {
      const trimmedName = typeof body.name === 'string' ? body.name.trim() : '';
      if (!trimmedName || trimmedName.length < 2 || trimmedName.length > 30) {
        return NextResponse.json(
          { error: 'Team name must be 2-30 characters' },
          { status: 400 }
        );
      }
      // Profanity filter
      const nameLC = trimmedName.toLowerCase();
      const blockedWords = ['fuck', 'shit', 'ass', 'dick', 'pussy', 'nigger', 'faggot'];
      if (blockedWords.some(word => nameLC.includes(word))) {
        return NextResponse.json(
          { error: 'Team name contains inappropriate content' },
          { status: 400 }
        );
      }
      updateData.name = trimmedName;
    }

    if (body.description !== undefined) {
      const trimmedDesc = body.description?.trim() || null;
      if (trimmedDesc && trimmedDesc.length > 200) {
        return NextResponse.json(
          { error: 'Description must be under 200 characters' },
          { status: 400 }
        );
      }
      updateData.description = trimmedDesc;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    updateData.updated_at = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('teams')
      .update(updateData)
      .eq('id', teamId);

    if (updateError) {
      console.error('[PATCH /api/teams/[id]] update error:', updateError);
      if (updateError.message?.includes('unique') || updateError.message?.includes('duplicate')) {
        return NextResponse.json(
          { error: 'A team with this name already exists' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: 'Failed to update team' }, { status: 500 });
    }

    // Return updated team
    const { data: updatedTeam } = await supabase.rpc('get_team_with_stats', {
      p_team_id: teamId,
    });

    return NextResponse.json({ ok: true, team: updatedTeam });
  } catch (err) {
    console.error('[PATCH /api/teams/[id]] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/teams/[id]
 * Disband team (leader only)
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id: teamId } = await context.params;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if user is team leader
    const { data: team } = await supabase
      .from('teams')
      .select('leader_id, name')
      .eq('id', teamId)
      .single();

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    if (team.leader_id !== session.user.userId) {
      return NextResponse.json({ error: 'Only team leader can disband team' }, { status: 403 });
    }

    // Delete team (cascades to members, invites, messages)
    const { error: deleteError } = await supabase
      .from('teams')
      .delete()
      .eq('id', teamId);

    if (deleteError) {
      console.error('[DELETE /api/teams/[id]] delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to disband team' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Team "${team.name}" has been disbanded`,
    });
  } catch (err) {
    console.error('[DELETE /api/teams/[id]] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
