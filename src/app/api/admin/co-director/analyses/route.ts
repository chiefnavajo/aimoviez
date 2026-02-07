// app/api/admin/co-director/analyses/route.ts
// View story analysis history
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

/**
 * GET /api/admin/co-director/analyses?season_id=X
 * List all story analyses for a season
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const { searchParams } = new URL(req.url);
  const seasonId = searchParams.get('season_id');

  if (!seasonId) {
    return NextResponse.json({ error: 'season_id is required' }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: analyses, error } = await supabase
    .from('story_analyses')
    .select(`
      id,
      season_id,
      slot_position,
      analysis,
      model_used,
      input_token_count,
      output_token_count,
      cost_cents,
      triggered_by,
      created_at,
      updated_at
    `)
    .eq('season_id', seasonId)
    .order('slot_position', { ascending: false });

  if (error) {
    console.error('[GET analyses] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch analyses' }, { status: 500 });
  }

  // Get user info for triggered_by
  const userIds = [...new Set((analyses || []).map(a => a.triggered_by).filter(Boolean))];
  let userMap: Record<string, string> = {};

  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, username, email')
      .in('id', userIds);

    if (users) {
      userMap = users.reduce((acc, u) => {
        acc[u.id] = u.username || u.email || 'Unknown';
        return acc;
      }, {} as Record<string, string>);
    }
  }

  // Enrich analyses with user names
  const enrichedAnalyses = (analyses || []).map(a => ({
    ...a,
    triggered_by_name: a.triggered_by ? userMap[a.triggered_by] : null,
  }));

  return NextResponse.json({
    ok: true,
    analyses: enrichedAnalyses,
  });
}
