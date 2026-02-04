// app/api/admin/pinned-characters/[id]/angles/route.ts
// Add additional reference angles to a pinned character

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';
import { getStorageProvider } from '@/lib/storage';
import { extractFrameAtTimestamp, uploadPinnedFrame } from '@/lib/storage/frame-upload';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

/**
 * POST /api/admin/pinned-characters/[id]/angles
 * Add a reference angle from another clip/frame
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { id: pinnedCharId } = await context.params;
    const body = await req.json();
    const { source_clip_id, frame_timestamp } = body;

    if (!source_clip_id || typeof source_clip_id !== 'string') {
      return NextResponse.json({ error: 'source_clip_id is required' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Get the pinned character
    const { data: pinned, error: pinnedError } = await supabase
      .from('pinned_characters')
      .select('*')
      .eq('id', pinnedCharId)
      .single();

    if (pinnedError || !pinned) {
      return NextResponse.json({ error: 'Pinned character not found' }, { status: 404 });
    }

    // Max 6 reference images (Kling O1 limit: 7 total inputs including frontal)
    const currentRefs = pinned.reference_image_urls || [];
    if (currentRefs.length >= 6) {
      return NextResponse.json(
        { error: 'Maximum 6 reference angles reached' },
        { status: 400 }
      );
    }

    // Get source clip
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, last_frame_url')
      .eq('id', source_clip_id)
      .single();

    if (clipError || !clip) {
      return NextResponse.json({ error: 'Source clip not found' }, { status: 404 });
    }

    let angleUrl: string;

    if (frame_timestamp != null && typeof frame_timestamp === 'number') {
      if (!clip.video_url) {
        return NextResponse.json({ error: 'Source clip has no video URL' }, { status: 400 });
      }

      const buffer = await extractFrameAtTimestamp(clip.video_url, frame_timestamp);

      const { data: r2Flag } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'r2_storage')
        .maybeSingle();

      const provider = await getStorageProvider(
        (r2Flag as { enabled?: boolean } | null)?.enabled ?? false
      );

      angleUrl = await uploadPinnedFrame(
        pinned.season_id,
        pinned.element_index,
        `angle_${currentRefs.length}`,
        buffer,
        provider
      );
    } else {
      if (!clip.last_frame_url) {
        return NextResponse.json(
          { error: 'Clip has no last_frame_url. Provide frame_timestamp.' },
          { status: 400 }
        );
      }
      angleUrl = clip.last_frame_url;
    }

    // Append to reference_image_urls array
    const updatedRefs = [...currentRefs, angleUrl];

    const { data: updated, error: updateError } = await supabase
      .from('pinned_characters')
      .update({ reference_image_urls: updatedRefs })
      .eq('id', pinnedCharId)
      .select()
      .single();

    if (updateError) {
      console.error('[POST angles] update error:', updateError);
      return NextResponse.json({ error: 'Failed to add angle' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, character: updated }, { status: 201 });
  } catch (err) {
    console.error('[POST angles] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
