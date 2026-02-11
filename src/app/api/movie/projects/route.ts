// GET /api/movie/projects — List user's movie projects
// POST /api/movie/projects — Create a new movie project

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { MovieProjectCreateSchema, parseBody } from '@/lib/validations';
import { estimateMovieCredits } from '@/lib/movie-script-generator';
import { MODEL_DURATION_SECONDS } from '@/lib/ai-video';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

// =============================================================================
// SHARED: Verify user has movie access
// =============================================================================

async function verifyMovieAccess(supabase: ReturnType<typeof getSupabase>, userId: string, isAdmin: boolean) {
  // Check feature flag
  const { data: flag } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'ai_movie_generation')
    .single();

  if (!flag?.enabled) {
    return { allowed: false as const, error: 'AI Movie Generation is not enabled', status: 403 };
  }

  // Admins always have access
  if (isAdmin) {
    return { allowed: true as const, maxProjects: 100, maxScenesPerProject: 300 };
  }

  // Check granted access
  const { data: access } = await supabase
    .from('movie_access')
    .select('max_projects, max_scenes_per_project, is_active, expires_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single();

  if (!access) {
    return { allowed: false as const, error: 'Movie generation access not granted', status: 403 };
  }

  if (access.expires_at && new Date(access.expires_at) < new Date()) {
    return { allowed: false as const, error: 'Movie generation access has expired', status: 403 };
  }

  return {
    allowed: true as const,
    maxProjects: access.max_projects,
    maxScenesPerProject: access.max_scenes_per_project,
  };
}

// =============================================================================
// GET: List user's projects
// =============================================================================

export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabase = getSupabase();

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .single();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const { data: projects, error } = await supabase
      .from('movie_projects')
      .select('id, title, description, model, status, total_scenes, completed_scenes, estimated_credits, spent_credits, target_duration_minutes, created_at, updated_at, completed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[GET /api/movie/projects] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
    }

    return NextResponse.json({ projects: projects || [] });
  } catch (err) {
    console.error('[GET /api/movie/projects] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// =============================================================================
// POST: Create a new project
// =============================================================================

export async function POST(req: NextRequest) {
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

    // Look up user
    const { data: user } = await supabase
      .from('users')
      .select('id, is_admin')
      .eq('email', session.user.email)
      .single();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify access
    const access = await verifyMovieAccess(supabase, user.id, user.is_admin);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Check project count limit
    const { count: existingCount } = await supabase
      .from('movie_projects')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if ((existingCount || 0) >= access.maxProjects) {
      return NextResponse.json(
        { error: `Maximum ${access.maxProjects} projects allowed. Delete old projects to create new ones.` },
        { status: 400 }
      );
    }

    // Validate body
    const body = await req.json();
    const parsed = parseBody(MovieProjectCreateSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { title, description, source_text, model, style, voice_id, aspect_ratio, target_duration_minutes } = parsed.data;

    // Estimate scene count and credits
    const sceneDuration = MODEL_DURATION_SECONDS[model] || 5;
    const totalSeconds = target_duration_minutes * 60;
    const estimatedScenes = Math.ceil(totalSeconds / sceneDuration);
    const estimatedCredits = estimateMovieCredits(estimatedScenes, model, !!voice_id);

    // Create project
    const { data: project, error: insertError } = await supabase
      .from('movie_projects')
      .insert({
        user_id: user.id,
        title,
        description,
        source_text,
        model,
        style: style || null,
        voice_id: voice_id || null,
        aspect_ratio,
        target_duration_minutes,
        status: 'draft',
        estimated_credits: estimatedCredits,
        total_scenes: estimatedScenes,
      })
      .select('id, title, status, estimated_credits, total_scenes, created_at')
      .single();

    if (insertError) {
      console.error('[POST /api/movie/projects] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      project,
    }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/movie/projects] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
