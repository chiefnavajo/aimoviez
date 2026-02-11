// GET /api/admin/movies/access — List all users with movie access
// POST /api/admin/movies/access — Grant movie access to a user

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';
import { logAdminAction } from '@/lib/audit-log';
import { MovieAccessGrantSchema, parseBody } from '@/lib/validations';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

// =============================================================================
// GET: List all users with movie access
// =============================================================================

export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'admin_read');
  if (rateLimitResponse) return rateLimitResponse;

  const authResult = await requireAdminWithAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = getSupabase();

    const { data: accessRecords, error } = await supabase
      .from('movie_access')
      .select(`
        id,
        user_id,
        max_projects,
        max_scenes_per_project,
        is_active,
        expires_at,
        created_at,
        granted_by
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/admin/movies/access] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch access records' }, { status: 500 });
    }

    // Enrich with user info
    const userIds = [...new Set((accessRecords || []).map(r => r.user_id))];
    const { data: users } = await supabase
      .from('users')
      .select('id, email, username')
      .in('id', userIds);

    const userMap = new Map(users?.map(u => [u.id, u]) || []);

    const enriched = (accessRecords || []).map(record => ({
      ...record,
      user_email: userMap.get(record.user_id)?.email || 'unknown',
      username: userMap.get(record.user_id)?.username || 'unknown',
    }));

    return NextResponse.json({ access_records: enriched });
  } catch (err) {
    console.error('[GET /api/admin/movies/access] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// =============================================================================
// POST: Grant movie access to a user
// =============================================================================

export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'admin_sensitive');
  if (rateLimitResponse) return rateLimitResponse;

  const authResult = await requireAdminWithAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = getSupabase();

    const body = await req.json();
    const parsed = parseBody(MovieAccessGrantSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { email, max_projects, max_scenes_per_project, expires_at } = parsed.data;

    // Look up user by email
    const { data: targetUser } = await supabase
      .from('users')
      .select('id, email, username')
      .eq('email', email)
      .single();

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found with that email' }, { status: 404 });
    }

    const user_id = targetUser.id;

    // Upsert access record
    const { data: accessRecord, error: upsertError } = await supabase
      .from('movie_access')
      .upsert({
        user_id,
        granted_by: authResult.userId,
        max_projects,
        max_scenes_per_project,
        is_active: true,
        expires_at: expires_at || null,
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (upsertError) {
      console.error('[POST /api/admin/movies/access] Upsert error:', upsertError);
      return NextResponse.json({ error: 'Failed to grant access' }, { status: 500 });
    }

    // Audit log
    await logAdminAction(req, {
      action: 'movie_access_grant',
      resourceType: 'movie_access',
      resourceId: user_id,
      adminEmail: authResult.email || 'unknown',
      adminId: authResult.userId || undefined,
      details: {
        target_user_email: targetUser.email,
        max_projects,
        max_scenes_per_project,
        expires_at: expires_at || null,
      },
    });

    return NextResponse.json({
      success: true,
      access: {
        ...accessRecord,
        user_email: targetUser.email,
        username: targetUser.username,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/admin/movies/access] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
