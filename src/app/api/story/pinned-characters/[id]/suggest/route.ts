// app/api/story/pinned-characters/[id]/suggest/route.ts
// User-facing API — suggest reference angles for pinned characters

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // ffmpeg frame extraction needs time

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { parseBody, SuggestClipFrameSchema } from '@/lib/validations';
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
 * POST /api/story/pinned-characters/[id]/suggest
 * Submit a reference angle suggestion (frame from winner clip)
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'upload');
  if (rateLimitResponse) return rateLimitResponse;

  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    const { id: pinnedCharId } = await context.params;

    // Check both feature flags
    const { data: flags } = await supabase
      .from('feature_flags')
      .select('key, enabled')
      .in('key', ['character_pinning', 'character_reference_suggestions']);

    const flagMap = new Map((flags || []).map(f => [f.key, f.enabled]));
    if (!flagMap.get('character_pinning') || !flagMap.get('character_reference_suggestions')) {
      return NextResponse.json({ error: 'Feature not enabled' }, { status: 403 });
    }

    // Get user ID
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Daily limit check (3 per day)
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const { count: todayCount } = await supabase
      .from('character_reference_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', oneDayAgo);

    const maxPerDay = 3;
    if ((todayCount || 0) >= maxPerDay) {
      return NextResponse.json(
        { error: 'Daily suggestion limit reached', remaining: 0 },
        { status: 429 }
      );
    }

    // Validate request body
    const body = await req.json();
    const parsed = parseBody(SuggestClipFrameSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { source_clip_id, frame_timestamp } = parsed.data;

    // Validate pinned character exists and is active
    const { data: pinned, error: pinnedError } = await supabase
      .from('pinned_characters')
      .select('id, season_id, element_index, label, is_active, reference_image_urls')
      .eq('id', pinnedCharId)
      .single();

    if (pinnedError || !pinned) {
      return NextResponse.json({ error: 'Character not found' }, { status: 404 });
    }

    if (!pinned.is_active) {
      return NextResponse.json({ error: 'Character is not active' }, { status: 400 });
    }

    // Validate source clip exists and is a winner/locked clip
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, last_frame_url, status')
      .eq('id', source_clip_id)
      .single();

    if (clipError || !clip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    if (clip.status !== 'locked' && clip.status !== 'winner') {
      return NextResponse.json({ error: 'Can only suggest frames from winner clips' }, { status: 400 });
    }

    // Extract frame
    let imageUrl: string;
    let storageKey: string | null = null;

    if (frame_timestamp != null) {
      if (!clip.video_url) {
        return NextResponse.json({ error: 'Clip has no video URL' }, { status: 400 });
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

      const suffix = `sug_${crypto.randomUUID().slice(0, 8)}`;
      storageKey = `pinned/${pinned.season_id}/${pinned.element_index}_${suffix}.jpg`;

      imageUrl = await uploadPinnedFrame(
        pinned.season_id,
        pinned.element_index,
        suffix,
        buffer,
        provider
      );
    } else {
      // Use clip's last frame
      if (!clip.last_frame_url) {
        return NextResponse.json(
          { error: 'Clip has no last frame. Please provide a timestamp.' },
          { status: 400 }
        );
      }
      imageUrl = clip.last_frame_url;
    }

    // Insert suggestion
    const { data: suggestion, error: insertError } = await supabase
      .from('character_reference_suggestions')
      .insert({
        pinned_character_id: pinnedCharId,
        user_id: user.id,
        season_id: pinned.season_id,
        source_clip_id,
        frame_timestamp: frame_timestamp ?? null,
        image_url: imageUrl,
        storage_key: storageKey,
        status: 'pending',
      })
      .select('id, status, image_url, created_at')
      .single();

    if (insertError) {
      console.error('[POST suggest] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to submit suggestion' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      suggestion,
      remaining: maxPerDay - (todayCount || 0) - 1,
    }, { status: 201 });
  } catch (err) {
    console.error('[POST suggest] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/story/pinned-characters/[id]/suggest
 * Get current user's suggestions for this character
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    const { id: pinnedCharId } = await context.params;

    // Get user ID
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get daily remaining count
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const { count: todayCount } = await supabase
      .from('character_reference_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', oneDayAgo);

    // Get user's suggestions for this character
    const { data: suggestions, error } = await supabase
      .from('character_reference_suggestions')
      .select('id, status, image_url, created_at, admin_notes')
      .eq('pinned_character_id', pinnedCharId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET suggest] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      suggestions: suggestions || [],
      remaining: Math.max(0, 3 - (todayCount || 0)),
    });
  } catch (err) {
    console.error('[GET suggest] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
