// app/api/teams/route.ts
// Teams API - List teams (leaderboard) and create new teams

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * GET /api/teams
 * Get team leaderboard or user's current team
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') || 'leaderboard';

    // Get user's team
    if (mode === 'my-team') {
      const session = await getServerSession(authOptions);
      if (!session?.user?.userId) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }

      const { data: team, error } = await supabase.rpc('get_user_team', {
        p_user_id: session.user.userId,
      });

      if (error) {
        console.error('[GET /api/teams] get_user_team error:', error);
        return NextResponse.json({ error: 'Failed to get team' }, { status: 500 });
      }

      // Fetch the user's membership details (role, joined_at)
      let membership = null;
      if (team?.id) {
        const { data: memberRow } = await supabase
          .from('team_members')
          .select('role, joined_at')
          .eq('team_id', team.id)
          .eq('user_id', session.user.userId)
          .single();
        if (memberRow) {
          membership = { role: memberRow.role, joined_at: memberRow.joined_at };
        }
      }

      return NextResponse.json({ ok: true, team, membership });
    }

    // Get leaderboard
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const { data: teams, error } = await supabase.rpc('get_team_leaderboard', {
      p_limit: limit,
      p_offset: offset,
    });

    if (error) {
      console.error('[GET /api/teams] get_team_leaderboard error:', error);
      return NextResponse.json({ error: 'Failed to get teams' }, { status: 500 });
    }

    // Get total count
    const { count } = await supabase
      .from('teams')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      ok: true,
      teams: teams || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[GET /api/teams] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/teams
 * Create a new team
 */
export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const { name, description } = body;

    // Validate name
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 });
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 30) {
      return NextResponse.json(
        { error: 'Team name must be 2-30 characters' },
        { status: 400 }
      );
    }

    // Check for inappropriate content (basic filter)
    const nameLC = trimmedName.toLowerCase();
    const blockedWords = ['fuck', 'shit', 'ass', 'dick', 'pussy', 'nigger', 'faggot'];
    if (blockedWords.some(word => nameLC.includes(word))) {
      return NextResponse.json(
        { error: 'Team name contains inappropriate content' },
        { status: 400 }
      );
    }

    // Validate description
    const trimmedDesc = description?.trim() || null;
    if (trimmedDesc && trimmedDesc.length > 200) {
      return NextResponse.json(
        { error: 'Description must be under 200 characters' },
        { status: 400 }
      );
    }

    // Create team via RPC
    const { data: team, error } = await supabase.rpc('create_team', {
      p_name: trimmedName,
      p_description: trimmedDesc,
      p_leader_id: session.user.userId,
    });

    if (error) {
      console.error('[POST /api/teams] create_team error:', error);
      if (error.message?.includes('already in a team')) {
        return NextResponse.json(
          { error: 'You are already in a team. Leave your current team first.' },
          { status: 400 }
        );
      }
      if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
        return NextResponse.json(
          { error: 'A team with this name already exists' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, team }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/teams] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
