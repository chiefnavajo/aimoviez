// GET /api/movie/projects/[id] — Get project detail with scenes
// DELETE /api/movie/projects/[id] — Delete project (draft/completed/failed only)

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

async function getUserId(supabase: ReturnType<typeof getSupabase>, email: string): Promise<string | null> {
  const { data } = await supabase.from('users').select('id').eq('email', email).single();
  return data?.id || null;
}

// =============================================================================
// GET: Project detail with scenes
// =============================================================================

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = getSupabase();
    const userId = await getUserId(supabase, session.user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { id: projectId } = await params;

    // Fetch project (owner check)
    const { data: project, error: projectError } = await supabase
      .from('movie_projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Fetch scenes
    const { data: scenes } = await supabase
      .from('movie_scenes')
      .select('id, scene_number, scene_title, video_prompt, narration_text, status, video_url, public_video_url, last_frame_url, duration_seconds, credit_cost, error_message, retry_count, created_at, completed_at')
      .eq('project_id', projectId)
      .order('scene_number', { ascending: true });

    return NextResponse.json({
      project: {
        ...project,
        // Don't expose raw source_text in detail view (it can be huge)
        source_text: project.source_text ? `${project.source_text.slice(0, 500)}${project.source_text.length > 500 ? '...' : ''}` : null,
        source_text_length: project.source_text?.length || 0,
      },
      scenes: scenes || [],
    });
  } catch (err) {
    console.error('[GET /api/movie/projects/[id]] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// =============================================================================
// DELETE: Delete project (only draft/completed/failed/cancelled)
// =============================================================================

export async function DELETE(
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
    const userId = await getUserId(supabase, session.user.email);
    if (!userId) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { id: projectId } = await params;

    // Fetch project (owner check)
    const { data: project } = await supabase
      .from('movie_projects')
      .select('id, status, user_id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Only allow deletion of non-active projects
    const deletableStatuses = ['draft', 'script_ready', 'completed', 'failed', 'cancelled'];
    if (!deletableStatuses.includes(project.status)) {
      return NextResponse.json(
        { error: `Cannot delete project in '${project.status}' status. Pause or cancel it first.` },
        { status: 400 }
      );
    }

    // Delete project (cascade deletes scenes)
    const { error: deleteError } = await supabase
      .from('movie_projects')
      .delete()
      .eq('id', projectId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('[DELETE /api/movie/projects/[id]] Error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted: projectId });
  } catch (err) {
    console.error('[DELETE /api/movie/projects/[id]] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
