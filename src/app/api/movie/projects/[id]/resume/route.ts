// POST /api/movie/projects/[id]/resume
// Resume a paused project

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = await rateLimit(req, 'ai_generate');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const csrfError = await requireCsrf(req);
    if (csrfError) return csrfError;

    const supabase = getSupabase();

    const { data: user } = await supabase
      .from('users')
      .select('id, balance_credits')
      .eq('email', session.user.email)
      .single();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { id: projectId } = await params;

    const { data: project } = await supabase
      .from('movie_projects')
      .select('id, status, user_id, current_scene, total_scenes, completed_scenes')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.status !== 'paused') {
      return NextResponse.json(
        { error: `Cannot resume project in '${project.status}' status` },
        { status: 400 }
      );
    }

    // Check credits
    if ((user.balance_credits || 0) < 5) {
      return NextResponse.json(
        { error: 'Insufficient credits to resume generation' },
        { status: 400 }
      );
    }

    // Check concurrent limit
    const { count: activeProjects } = await supabase
      .from('movie_projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'generating');

    if ((activeProjects || 0) >= 2) {
      return NextResponse.json(
        { error: 'Maximum 2 concurrent movie generations allowed' },
        { status: 400 }
      );
    }

    await supabase
      .from('movie_projects')
      .update({ status: 'generating', error_message: null })
      .eq('id', projectId)
      .eq('status', 'paused');

    return NextResponse.json({
      success: true,
      message: 'Generation resumed.',
      current_scene: project.current_scene,
      remaining_scenes: project.total_scenes - project.completed_scenes,
    });
  } catch (err) {
    console.error('[POST /api/movie/projects/[id]/resume] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
