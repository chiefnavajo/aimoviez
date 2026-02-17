// app/api/profile/clips/pin/route.ts
// Toggle pin status on an eliminated clip to preserve it from deletion

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const MAX_PINNED_CLIPS = 5;

/**
 * POST /api/profile/clips/pin
 * Toggle pin on an eliminated clip
 * Body: { clipId: string }
 */
export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from session
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const csrfError = await requireCsrf(req);
    if (csrfError) return csrfError;

    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .single();

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { clipId } = body;
    if (!clipId) {
      return NextResponse.json({ error: 'clipId is required' }, { status: 400 });
    }

    // Verify the clip belongs to the user and is eligible for pinning
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, user_id, status, is_pinned, video_deleted_at')
      .eq('id', clipId)
      .single();

    if (clipError || !clip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    if (clip.user_id !== userData.id) {
      return NextResponse.json({ error: 'Not your clip' }, { status: 403 });
    }

    if (clip.status !== 'eliminated') {
      return NextResponse.json(
        { error: 'Only eliminated clips can be pinned' },
        { status: 400 }
      );
    }

    if (clip.video_deleted_at) {
      return NextResponse.json(
        { error: 'Video has already been deleted' },
        { status: 400 }
      );
    }

    const newPinnedState = !clip.is_pinned;

    // If pinning (not unpinning), check the limit
    if (newPinnedState) {
      const { count } = await supabase
        .from('tournament_clips')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userData.id)
        .eq('is_pinned', true);

      if ((count ?? 0) >= MAX_PINNED_CLIPS) {
        return NextResponse.json(
          { error: `Maximum ${MAX_PINNED_CLIPS} pinned clips allowed` },
          { status: 400 }
        );
      }
    }

    // Toggle pin
    const { error: updateError } = await supabase
      .from('tournament_clips')
      .update({ is_pinned: newPinnedState })
      .eq('id', clipId);

    if (updateError) {
      console.error('[pin] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update pin status' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      clipId,
      is_pinned: newPinnedState,
    });
  } catch (err) {
    console.error('[pin] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
