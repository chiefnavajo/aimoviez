// GET /api/movie/access
// Check current user's movie generation access status

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = getSupabase();

    // Look up user
    const { data: user } = await supabase
      .from('users')
      .select('id, is_admin')
      .eq('email', session.user.email)
      .single();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'ai_movie_generation')
      .single();

    if (!flag?.enabled) {
      return NextResponse.json({
        has_access: false,
        reason: 'feature_disabled',
      });
    }

    // Admins always have access
    if (user.is_admin) {
      return NextResponse.json({
        has_access: true,
        is_admin: true,
        max_projects: 100,
        max_scenes_per_project: 300,
        expires_at: null,
      });
    }

    // Check movie_access table
    const { data: access } = await supabase
      .from('movie_access')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (!access) {
      return NextResponse.json({
        has_access: false,
        reason: 'not_granted',
      });
    }

    // Check expiration
    if (access.expires_at && new Date(access.expires_at) < new Date()) {
      return NextResponse.json({
        has_access: false,
        reason: 'expired',
        expired_at: access.expires_at,
      });
    }

    // Count existing projects
    const { count: projectCount } = await supabase
      .from('movie_projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    return NextResponse.json({
      has_access: true,
      is_admin: false,
      max_projects: access.max_projects,
      max_scenes_per_project: access.max_scenes_per_project,
      projects_used: projectCount || 0,
      expires_at: access.expires_at,
    });
  } catch (err) {
    console.error('[GET /api/movie/access] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
