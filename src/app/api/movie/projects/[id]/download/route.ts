// GET /api/movie/projects/[id]/download
// Get signed download URL for the final movie MP4

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
      .select('id, status, user_id, title, final_video_url, total_duration_seconds')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (project.status !== 'completed') {
      return NextResponse.json(
        { error: 'Movie is not yet completed' },
        { status: 400 }
      );
    }

    if (!project.final_video_url) {
      return NextResponse.json(
        { error: 'Final video not available yet' },
        { status: 404 }
      );
    }

    // If it's a storage path, generate a signed URL
    const storageKey = `movies/${projectId}/final.mp4`;
    const { data: signedUrl } = await supabase.storage
      .from('videos')
      .createSignedUrl(storageKey, 3600); // 1 hour expiry

    return NextResponse.json({
      download_url: signedUrl?.signedUrl || project.final_video_url,
      title: project.title,
      duration_seconds: project.total_duration_seconds,
      expires_in_seconds: 3600,
    });
  } catch (err) {
    console.error('[GET /api/movie/projects/[id]/download] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
