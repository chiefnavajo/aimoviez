// POST /api/movie/projects/[id]/pause
// Pause generation after current scene completes

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
  const rateLimitResponse = await rateLimit(req, 'api');
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
      .select('id')
      .eq('email', session.user.email)
      .single();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { id: projectId } = await params;

    const { data: project } = await supabase
      .from('movie_projects')
      .select('id, status, user_id, current_scene, completed_scenes')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.status !== 'generating') {
      return NextResponse.json(
        { error: `Cannot pause project in '${project.status}' status` },
        { status: 400 }
      );
    }

    await supabase
      .from('movie_projects')
      .update({ status: 'paused' })
      .eq('id', projectId);

    return NextResponse.json({
      success: true,
      message: 'Project paused. Current scene will finish processing.',
      completed_scenes: project.completed_scenes,
    });
  } catch (err) {
    console.error('[POST /api/movie/projects/[id]/pause] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
