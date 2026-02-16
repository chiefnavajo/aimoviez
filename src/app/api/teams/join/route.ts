// app/api/teams/join/route.ts
// Join team via invite code

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/teams/join
 * Join a team using an invite code
 */
export async function POST(req: NextRequest) {
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

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();
    const { code } = body;

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Invite code is required' }, { status: 400 });
    }

    // Clean up code (remove spaces, uppercase)
    const cleanCode = code.trim().toUpperCase().replace(/\s/g, '');

    if (cleanCode.length < 6 || cleanCode.length > 12) {
      return NextResponse.json({ error: 'Invalid invite code format' }, { status: 400 });
    }

    // Join team via RPC
    const { data: team, error } = await supabase.rpc('join_team_via_code', {
      p_user_id: session.user.userId,
      p_invite_code: cleanCode,
    });

    if (error) {
      console.error('[POST /api/teams/join] join_team_via_code error:', error);

      if (error.message?.includes('already in a team')) {
        return NextResponse.json(
          { error: 'You are already in a team. Leave your current team first.' },
          { status: 400 }
        );
      }
      if (error.message?.includes('Invalid or expired')) {
        return NextResponse.json(
          { error: 'Invalid or expired invite code' },
          { status: 400 }
        );
      }
      if (error.message?.includes('full')) {
        return NextResponse.json(
          { error: 'Team is full (max 5 members)' },
          { status: 400 }
        );
      }

      return NextResponse.json({ error: 'Failed to join team' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      team,
      message: `Welcome to ${team?.name || 'the team'}!`,
    });
  } catch (err) {
    console.error('[POST /api/teams/join] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
