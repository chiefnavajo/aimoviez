// GET /api/admin/movies/projects
// List all movie projects (admin view)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'admin_read');
  if (rateLimitResponse) return rateLimitResponse;

  const authResult = await requireAdminWithAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = getSupabase();
    const { searchParams } = new URL(req.url);

    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let query = supabase
      .from('movie_projects')
      .select('id, user_id, title, model, status, total_scenes, completed_scenes, estimated_credits, spent_credits, created_at, updated_at, completed_at', { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: projects, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[GET /api/admin/movies/projects] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
    }

    // Enrich with user info
    const userIds = [...new Set((projects || []).map(p => p.user_id))];
    const { data: users } = await supabase
      .from('users')
      .select('id, email, username')
      .in('id', userIds);

    const userMap = new Map(users?.map(u => [u.id, u]) || []);

    const enriched = (projects || []).map(project => ({
      ...project,
      user_email: userMap.get(project.user_id)?.email || 'unknown',
      username: userMap.get(project.user_id)?.username || 'unknown',
    }));

    return NextResponse.json({
      projects: enriched,
      total: count || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[GET /api/admin/movies/projects] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
