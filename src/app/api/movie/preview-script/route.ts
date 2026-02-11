// POST /api/movie/preview-script
// Stateless script preview: calls Claude to generate scenes from source text
// No database writes — returns scenes JSON for client-side preview

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Script generation can take time

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { MovieScriptPreviewSchema, parseBody } from '@/lib/validations';
import { generateMovieScript, estimateMovieCredits } from '@/lib/movie-script-generator';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

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
      return NextResponse.json({ error: 'AI Movie Generation is not enabled' }, { status: 403 });
    }

    // Check access (admin or granted)
    if (!user.is_admin) {
      const { data: access } = await supabase
        .from('movie_access')
        .select('is_active, expires_at')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();

      if (!access) {
        return NextResponse.json({ error: 'Movie generation access not granted' }, { status: 403 });
      }

      if (access.expires_at && new Date(access.expires_at) < new Date()) {
        return NextResponse.json({ error: 'Movie generation access has expired' }, { status: 403 });
      }
    }

    // Validate body
    const body = await req.json();
    const parsed = parseBody(MovieScriptPreviewSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { source_text, model, style, target_duration_minutes } = parsed.data;

    // Generate script with Claude (no DB writes)
    const result = await generateMovieScript(source_text, {
      model,
      style,
      targetDurationMinutes: target_duration_minutes,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: `Script generation failed: ${result.error}` },
        { status: 500 }
      );
    }

    const { script } = result;
    const estimatedCredits = estimateMovieCredits(script.total_scenes, model, false);

    return NextResponse.json({
      scenes: script.scenes,
      total_scenes: script.total_scenes,
      estimated_duration_seconds: script.estimated_duration_seconds,
      estimated_credits: estimatedCredits,
      summary: script.summary,
    });
  } catch (err) {
    console.error('[POST /api/movie/preview-script] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
