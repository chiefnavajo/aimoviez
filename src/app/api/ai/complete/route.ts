// POST /api/ai/complete
// Prepares a completed AI generation for tournament submission.
// Returns a signed upload URL so the client can transfer the video
// from fal.ai to our permanent storage before registering it.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { getStorageProvider, getSignedUploadUrl as getProviderSignedUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  // Rate limiting (upload tier — strict)
  const rateLimitResponse = await rateLimit(request, 'upload');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // 1. Authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // 2. CSRF protection
    const csrfError = await requireCsrf(request);
    if (csrfError) return csrfError;

    // 3. Parse request body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { generationId } = body;
    if (!generationId || typeof generationId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'generationId is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // 4. Look up user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // 5. Look up generation (verify ownership)
    const { data: gen, error: genError } = await supabase
      .from('ai_generations')
      .select('id, status, video_url, completed_at, storage_key, complete_initiated_at, clip_id')
      .eq('id', generationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (genError || !gen) {
      return NextResponse.json(
        { success: false, error: 'Generation not found' },
        { status: 404 }
      );
    }

    // 6. Must be completed
    if (gen.status !== 'completed') {
      return NextResponse.json(
        { success: false, error: 'Generation not ready' },
        { status: 400 }
      );
    }

    // 6b. Must have a video URL
    if (!gen.video_url) {
      return NextResponse.json(
        { success: false, error: 'Video URL missing from generation' },
        { status: 500 }
      );
    }

    // 7. Check 7-day TTL on fal.ai hosted videos
    if (gen.completed_at) {
      const completedAt = new Date(gen.completed_at);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - completedAt.getTime() > sevenDaysMs) {
        return NextResponse.json(
          { success: false, error: 'Video expired, please regenerate' },
          { status: 410 }
        );
      }
    }

    // 8. Check for active season (use .limit(1) not .single())
    const { data: seasons } = await supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!seasons?.length) {
      return NextResponse.json(
        { success: false, error: 'No active season' },
        { status: 400 }
      );
    }

    // 9. Check for active slot
    const { data: slots } = await supabase
      .from('story_slots')
      .select('id')
      .eq('season_id', seasons[0].id)
      .in('status', ['voting', 'waiting_for_clips'])
      .order('slot_position', { ascending: true })
      .limit(1);

    if (!slots?.length) {
      return NextResponse.json(
        { success: false, error: 'No available slot' },
        { status: 400 }
      );
    }

    // 10. Atomic double-complete guard
    // H14: If complete_initiated_at was set more than 10 minutes ago but no storage_key exists,
    // the previous attempt failed — reset so the user can retry
    if (gen.complete_initiated_at && !gen.storage_key) {
      const initiatedAt = new Date(gen.complete_initiated_at).getTime();
      const tenMinutesMs = 10 * 60 * 1000;
      if (Date.now() - initiatedAt > tenMinutesMs) {
        await supabase
          .from('ai_generations')
          .update({ complete_initiated_at: null })
          .eq('id', gen.id);
        console.info('[AI_COMPLETE] Reset stale complete_initiated_at for retry:', gen.id);
        // Re-read to get fresh state
        gen.complete_initiated_at = null;
      }
    }

    const { data: guardRows, error: guardError } = await supabase
      .from('ai_generations')
      .update({ complete_initiated_at: new Date().toISOString() })
      .eq('id', gen.id)
      .is('complete_initiated_at', null)
      .select();

    if (guardError || !guardRows?.length) {
      console.warn('[AI_COMPLETE] Double-complete guard triggered:', gen.id);
      return NextResponse.json(
        { success: false, error: 'Already being processed' },
        { status: 409 }
      );
    }

    // 11. Get storage provider (check R2 feature flag)
    const { data: r2Flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'r2_storage')
      .maybeSingle();

    const storageProvider = await getStorageProvider(r2Flag?.enabled ?? false);

    // 12. Generate unique storage key
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    const uniqueFilename = `clip_${timestamp}_${random}.mp4`;

    // 13. Get signed upload URL
    const result = await getProviderSignedUrl(uniqueFilename, 'video/mp4', storageProvider);

    // 14. Store storage_key on the generation row
    const { error: updateError } = await supabase
      .from('ai_generations')
      .update({ storage_key: uniqueFilename })
      .eq('id', gen.id);

    if (updateError) {
      console.error('[AI_COMPLETE] Failed to update storage_key:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to prepare upload. Please try again.' },
        { status: 500 }
      );
    }

    console.info('[AI_COMPLETE] Signed URL generated for generation:', gen.id);

    return NextResponse.json({
      success: true,
      falVideoUrl: gen.video_url,
      signedUploadUrl: result.signedUrl,
      storageKey: uniqueFilename,
    });
  } catch (error) {
    console.error('[AI_COMPLETE] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Completion failed. Please try again.' },
      { status: 500 }
    );
  }
}
