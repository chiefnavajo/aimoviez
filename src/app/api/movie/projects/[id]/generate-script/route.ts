// POST /api/movie/projects/[id]/generate-script
// Triggers Claude to generate a movie script from the project's source text

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Script generation can take time

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { generateMovieScript, estimateMovieCredits } from '@/lib/movie-script-generator';

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
      .select('id')
      .eq('email', session.user.email)
      .single();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { id: projectId } = await params;

    // Fetch project (owner check + status check)
    const { data: project } = await supabase
      .from('movie_projects')
      .select('id, user_id, status, source_text, model, style, voice_id, aspect_ratio, target_duration_minutes')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.status !== 'draft' && project.status !== 'script_ready') {
      return NextResponse.json(
        { error: `Cannot generate script for project in '${project.status}' status` },
        { status: 400 }
      );
    }

    // Update status to script_generating (atomic — prevents double-submit)
    const { count: updated } = await supabase
      .from('movie_projects')
      .update({ status: 'script_generating' })
      .eq('id', projectId)
      .in('status', ['draft', 'script_ready']);

    if (!updated || updated === 0) {
      return NextResponse.json(
        { error: 'Script generation already in progress' },
        { status: 409 }
      );
    }

    // Generate script with Claude
    const result = await generateMovieScript(project.source_text, {
      model: project.model,
      style: project.style,
      voiceId: project.voice_id,
      aspectRatio: project.aspect_ratio,
      targetDurationMinutes: project.target_duration_minutes || 10,
    });

    if (!result.ok) {
      // Revert status
      await supabase
        .from('movie_projects')
        .update({ status: 'draft', error_message: result.error })
        .eq('id', projectId);

      return NextResponse.json(
        { error: `Script generation failed: ${result.error}` },
        { status: 500 }
      );
    }

    const { script } = result;

    // Enforce max scenes per project
    const { data: access } = await supabase
      .from('movie_access')
      .select('max_scenes_per_project')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    const maxScenes = access?.max_scenes_per_project || 150;
    if (script.scenes.length > maxScenes) {
      script.scenes = script.scenes.slice(0, maxScenes);
      script.total_scenes = maxScenes;
    }

    // Calculate credit estimate
    const estimatedCredits = estimateMovieCredits(
      script.total_scenes,
      project.model,
      !!project.voice_id
    );

    // Delete any existing scenes (for re-generation)
    await supabase
      .from('movie_scenes')
      .delete()
      .eq('project_id', projectId);

    // Insert scenes
    const scenesToInsert = script.scenes.map((scene) => ({
      project_id: projectId,
      scene_number: scene.scene_number,
      scene_title: scene.scene_title,
      video_prompt: scene.video_prompt,
      narration_text: scene.narration_text,
      status: 'pending',
    }));

    const { error: insertError } = await supabase
      .from('movie_scenes')
      .insert(scenesToInsert);

    if (insertError) {
      console.error('[generate-script] Scene insert error:', insertError);
      await supabase
        .from('movie_projects')
        .update({ status: 'draft', error_message: 'Failed to save scenes' })
        .eq('id', projectId);

      return NextResponse.json({ error: 'Failed to save generated scenes' }, { status: 500 });
    }

    // Update project with script data and new status
    await supabase
      .from('movie_projects')
      .update({
        status: 'script_ready',
        script_data: script,
        total_scenes: script.total_scenes,
        estimated_credits: estimatedCredits,
        error_message: null,
      })
      .eq('id', projectId);

    return NextResponse.json({
      success: true,
      total_scenes: script.total_scenes,
      estimated_duration_seconds: script.estimated_duration_seconds,
      estimated_credits: estimatedCredits,
      summary: script.summary,
      claude_cost_cents: result.costCents,
    });
  } catch (err) {
    console.error('[POST /api/movie/projects/[id]/generate-script] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
