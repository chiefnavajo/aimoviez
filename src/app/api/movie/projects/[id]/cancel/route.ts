// POST /api/movie/projects/[id]/cancel
// Cancel generation permanently

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
      .select('id, status, user_id, completed_scenes, spent_credits')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const cancellableStatuses = ['generating', 'paused', 'script_generating', 'script_ready'];
    if (!cancellableStatuses.includes(project.status)) {
      return NextResponse.json(
        { error: `Cannot cancel project in '${project.status}' status` },
        { status: 400 }
      );
    }

    // Mark non-completed scenes as skipped
    await supabase
      .from('movie_scenes')
      .update({ status: 'skipped' })
      .eq('project_id', projectId)
      .in('status', ['pending', 'generating', 'narrating', 'merging']);

    // Update project status (atomic check)
    await supabase
      .from('movie_projects')
      .update({ status: 'cancelled' })
      .eq('id', projectId)
      .in('status', ['generating', 'paused', 'script_generating', 'script_ready']);

    return NextResponse.json({
      success: true,
      message: 'Project cancelled.',
      completed_scenes: project.completed_scenes,
      credits_spent: project.spent_credits,
    });
  } catch (err) {
    console.error('[POST /api/movie/projects/[id]/cancel] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
