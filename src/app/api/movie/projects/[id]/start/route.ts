// POST /api/movie/projects/[id]/start
// Approve script and begin scene generation

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

    // Verify project ownership and status
    const { data: project } = await supabase
      .from('movie_projects')
      .select('id, status, user_id, total_scenes, estimated_credits, model')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.status !== 'script_ready') {
      return NextResponse.json(
        { error: `Cannot start generation from '${project.status}' status. Script must be ready first.` },
        { status: 400 }
      );
    }

    // Verify scenes exist
    const { count: sceneCount } = await supabase
      .from('movie_scenes')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);

    if (!sceneCount || sceneCount === 0) {
      return NextResponse.json(
        { error: 'No scenes found. Generate a script first.' },
        { status: 400 }
      );
    }

    // Check concurrent generation limit (max 2 per user)
    const { count: activeProjects } = await supabase
      .from('movie_projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'generating');

    if ((activeProjects || 0) >= 2) {
      return NextResponse.json(
        { error: 'Maximum 2 concurrent movie generations allowed. Wait for a project to finish or pause one.' },
        { status: 400 }
      );
    }

    // Check user has at least some credits (full check happens per-scene in cron)
    if ((user.balance_credits || 0) < 5) {
      return NextResponse.json(
        { error: 'Insufficient credits to start generation. Credits are deducted per scene.' },
        { status: 400 }
      );
    }

    // Start generation: set status and current_scene to 1 (atomic check)
    const { error: updateError, count: updated } = await supabase
      .from('movie_projects')
      .update({
        status: 'generating',
        current_scene: 1,
        error_message: null,
      })
      .eq('id', projectId)
      .eq('status', 'script_ready');

    if (updateError) {
      console.error('[start] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to start generation' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Generation started. The cron job will process scenes sequentially.',
      total_scenes: sceneCount,
      estimated_credits: project.estimated_credits,
    });
  } catch (err) {
    console.error('[POST /api/movie/projects/[id]/start] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
