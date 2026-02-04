// app/api/admin/pinned-characters/route.ts
// Admin API for managing pinned characters (GET/POST/DELETE)

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, requireAdminWithAuth } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';
import { getStorageProvider } from '@/lib/storage';
import { extractFrameAtTimestamp, uploadPinnedFrame } from '@/lib/storage/frame-upload';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

/**
 * GET /api/admin/pinned-characters?season_id=X
 * List pinned characters for a season
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const { searchParams } = new URL(req.url);
  const seasonId = searchParams.get('season_id');

  if (!seasonId) {
    return NextResponse.json({ error: 'season_id is required' }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: characters, error } = await supabase
    .from('pinned_characters')
    .select('*')
    .eq('season_id', seasonId)
    .order('element_index', { ascending: true });

  if (error) {
    console.error('[GET /api/admin/pinned-characters] error:', error);
    return NextResponse.json({ error: 'Failed to fetch pinned characters' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, characters: characters || [] });
}

/**
 * POST /api/admin/pinned-characters
 * Pin a new character from a clip frame
 */
export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const adminResult = await requireAdminWithAuth();
  if (adminResult instanceof NextResponse) return adminResult;
  const auth = adminResult;

  try {
    const body = await req.json();
    const { season_id, source_clip_id, frame_timestamp, label, element_index } = body;

    if (!season_id || typeof season_id !== 'string') {
      return NextResponse.json({ error: 'season_id is required' }, { status: 400 });
    }
    if (!source_clip_id || typeof source_clip_id !== 'string') {
      return NextResponse.json({ error: 'source_clip_id is required' }, { status: 400 });
    }
    const elemIdx = typeof element_index === 'number' ? element_index : 1;
    if (elemIdx < 1 || elemIdx > 4) {
      return NextResponse.json({ error: 'element_index must be 1-4' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Check for existing pin at this index
    const { data: existing } = await supabase
      .from('pinned_characters')
      .select('id')
      .eq('season_id', season_id)
      .eq('element_index', elemIdx)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: `Element ${elemIdx} already pinned for this season. Delete it first.` },
        { status: 409 }
      );
    }

    // Get the source clip
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, last_frame_url')
      .eq('id', source_clip_id)
      .single();

    if (clipError || !clip) {
      return NextResponse.json({ error: 'Source clip not found' }, { status: 404 });
    }

    let frontalImageUrl: string;

    if (frame_timestamp != null && typeof frame_timestamp === 'number') {
      // Extract frame at specified timestamp
      if (!clip.video_url) {
        return NextResponse.json({ error: 'Source clip has no video URL' }, { status: 400 });
      }

      const buffer = await extractFrameAtTimestamp(clip.video_url, frame_timestamp);

      // Get storage provider
      const { data: r2Flag } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'r2_storage')
        .maybeSingle();

      const provider = await getStorageProvider(
        (r2Flag as { enabled?: boolean } | null)?.enabled ?? false
      );

      frontalImageUrl = await uploadPinnedFrame(
        season_id, elemIdx, 'frontal', buffer, provider
      );
    } else {
      // Use existing last_frame_url
      if (!clip.last_frame_url) {
        return NextResponse.json(
          { error: 'Clip has no last_frame_url. Provide frame_timestamp to extract a specific frame.' },
          { status: 400 }
        );
      }
      frontalImageUrl = clip.last_frame_url;
    }

    // Validate the frontal image URL is reachable
    try {
      const headRes = await fetch(frontalImageUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      });
      if (!headRes.ok) {
        return NextResponse.json(
          { error: 'Frontal image URL is not reachable' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Failed to verify frontal image URL' },
        { status: 400 }
      );
    }

    // Insert pinned character
    const { data: pinned, error: insertError } = await supabase
      .from('pinned_characters')
      .insert({
        season_id,
        element_index: elemIdx,
        label: label || null,
        frontal_image_url: frontalImageUrl,
        source_clip_id,
        source_frame_timestamp: frame_timestamp ?? null,
        pinned_by: auth.userId,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[POST /api/admin/pinned-characters] insert error:', insertError);
      return NextResponse.json({ error: 'Failed to pin character' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, character: pinned }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/admin/pinned-characters] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/pinned-characters?id=X
 * Delete (unpin) a character
 */
export async function DELETE(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const supabase = getSupabase();

  const { error } = await supabase
    .from('pinned_characters')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[DELETE /api/admin/pinned-characters] error:', error);
    return NextResponse.json({ error: 'Failed to delete pinned character' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: 'Character unpinned' });
}
