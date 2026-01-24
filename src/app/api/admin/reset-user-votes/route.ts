// app/api/admin/reset-user-votes/route.ts
// Reset votes for a specific user
// Requires admin authentication

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/admin/reset-user-votes
 * Reset votes for a specific user
 *
 * Body: {
 *   username: string - Username to search for and reset votes
 * }
 */
export async function POST(req: NextRequest) {
  // Rate limit: 50 admin actions per minute
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  // Get admin info for audit logging
  const adminAuth = await checkAdminAuth();

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { username } = body;

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Username is required' },
        { status: 400 }
      );
    }

    // Strip leading @ if present (users might type @username)
    const trimmedUsername = username.trim().replace(/^@/, '');

    // 1. Find user by username
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, email')
      .ilike('username', trimmedUsername)
      .maybeSingle();

    if (userError) {
      console.error('[reset-user-votes] userError:', userError);
      return NextResponse.json(
        { ok: false, error: 'Failed to search for user', details: userError.message },
        { status: 500 }
      );
    }

    if (!user) {
      return NextResponse.json(
        { ok: false, error: `User "${trimmedUsername}" not found` },
        { status: 404 }
      );
    }

    // 2. Build voter_key for authenticated user
    const voterKey = `user_${user.id}`;

    // 3. Count votes before deletion
    const { count: voteCount } = await supabase
      .from('votes')
      .select('id', { count: 'exact', head: true })
      .eq('voter_key', voterKey);

    // 4. Delete all votes for this user
    const { error: deleteError } = await supabase
      .from('votes')
      .delete()
      .eq('voter_key', voterKey);

    if (deleteError) {
      console.error('[reset-user-votes] deleteError:', deleteError);
      return NextResponse.json(
        { ok: false, error: 'Failed to delete votes', details: deleteError.message },
        { status: 500 }
      );
    }

    // 5. Audit log the action
    await logAdminAction(req, {
      action: 'reset_user_votes',
      resourceType: 'user',
      resourceId: user.id,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        username: user.username,
        userEmail: user.email,
        votesDeleted: voteCount || 0,
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Successfully reset ${voteCount || 0} vote(s) for user "${user.username}"`,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      votes_deleted: voteCount || 0,
    }, { status: 200 });

  } catch (err: unknown) {
    console.error('[reset-user-votes] Unexpected error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
