// PATCH /api/movie/projects/[id]/scenes
// Batch edit scene prompts/narration before starting generation

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { MovieSceneUpdateSchema, parseBody } from '@/lib/validations';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function PATCH(
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

    // Verify project ownership and status
    const { data: project } = await supabase
      .from('movie_projects')
      .select('id, status, user_id')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Only allow editing scenes when script is ready or paused
    if (project.status !== 'script_ready' && project.status !== 'paused') {
      return NextResponse.json(
        { error: `Cannot edit scenes when project is in '${project.status}' status` },
        { status: 400 }
      );
    }

    // Validate body
    const body = await req.json();
    const parsed = parseBody(MovieSceneUpdateSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // Update each scene
    let updated = 0;
    const errors: string[] = [];

    for (const sceneUpdate of parsed.data.scenes) {
      const updateFields: Record<string, unknown> = {};
      if (sceneUpdate.video_prompt !== undefined) updateFields.video_prompt = sceneUpdate.video_prompt;
      if (sceneUpdate.narration_text !== undefined) updateFields.narration_text = sceneUpdate.narration_text;
      if (sceneUpdate.scene_title !== undefined) updateFields.scene_title = sceneUpdate.scene_title;

      if (Object.keys(updateFields).length === 0) continue;

      const { error: updateError } = await supabase
        .from('movie_scenes')
        .update(updateFields)
        .eq('project_id', projectId)
        .eq('scene_number', sceneUpdate.scene_number);

      if (updateError) {
        console.error(`[PATCH /api/movie/projects/[id]/scenes] Scene ${sceneUpdate.scene_number} update error:`, updateError.message);
        errors.push(`Scene ${sceneUpdate.scene_number}: update failed`);
      } else {
        updated++;
      }
    }

    if (errors.length > 0 && updated === 0) {
      return NextResponse.json(
        { error: 'Failed to update scenes' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      updated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[PATCH /api/movie/projects/[id]/scenes] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
