// app/api/internal/extract-frame/route.ts
// ============================================================================
// FRAME EXTRACTION — Server-side last-frame extraction using ffmpeg-wasm.
// Called fire-and-forget from winner selection paths.
// Auth: CRON_SECRET bearer token (not user-facing).
// ============================================================================

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Pro — ffmpeg-wasm needs time

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStorageProvider } from '@/lib/storage';
import { uploadFrame } from '@/lib/storage/frame-upload';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  // Auth: require CRON_SECRET
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { clipId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { clipId } = body;
  if (!clipId) {
    return NextResponse.json({ error: 'clipId required' }, { status: 400 });
  }

  const supabase = getSupabase();

  try {
    // 1. Look up the clip
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, status, last_frame_url')
      .eq('id', clipId)
      .single();

    if (clipError || !clip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    if (clip.status !== 'locked') {
      return NextResponse.json({ error: 'Clip is not locked (not a winner)' }, { status: 400 });
    }

    if (clip.last_frame_url) {
      return NextResponse.json({ success: true, lastFrameUrl: clip.last_frame_url, skipped: true });
    }

    if (!clip.video_url) {
      return NextResponse.json({ error: 'Clip has no video_url' }, { status: 400 });
    }

    // 2. Download video into memory
    console.log(`[extract-frame] Downloading video for clip ${clipId}...`);
    const videoRes = await fetch(clip.video_url, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!videoRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch video: ${videoRes.status}` },
        { status: 502 }
      );
    }

    const videoBuffer = new Uint8Array(await videoRes.arrayBuffer());
    console.log(`[extract-frame] Video downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    // 3. Extract last frame using ffmpeg-wasm
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load();

    await ffmpeg.writeFile('input.mp4', videoBuffer);

    // Seek to 0.1s before end, extract 1 frame as high-quality JPEG
    await ffmpeg.exec([
      '-sseof', '-0.1',
      '-i', 'input.mp4',
      '-frames:v', '1',
      '-q:v', '2',
      'output.jpg',
    ]);

    const frameData = await ffmpeg.readFile('output.jpg');

    let finalFrameData: Uint8Array;

    if (!(frameData instanceof Uint8Array) || frameData.length === 0) {
      // Fallback: try extracting from the very end without -sseof
      await ffmpeg.exec([
        '-i', 'input.mp4',
        '-frames:v', '1',
        '-q:v', '2',
        '-update', '1',
        'fallback.jpg',
      ]);

      const fallbackData = await ffmpeg.readFile('fallback.jpg');
      if (!(fallbackData instanceof Uint8Array) || fallbackData.length === 0) {
        return NextResponse.json({ error: 'Frame extraction produced empty output' }, { status: 500 });
      }

      console.warn(`[extract-frame] -sseof failed, using first frame as fallback for clip ${clipId}`);
      finalFrameData = fallbackData;
    } else {
      finalFrameData = frameData;
    }

    // 4. Determine storage provider
    const { data: r2Flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'r2_storage')
      .maybeSingle();

    const provider = await getStorageProvider((r2Flag as { enabled?: boolean } | null)?.enabled ?? false);

    // 5. Upload frame
    console.log(`[extract-frame] Uploading frame (${(finalFrameData.length / 1024).toFixed(0)}KB) to ${provider}...`);
    const frameUrl = await uploadFrame(clipId, finalFrameData, provider);

    // 6. Update clip row with the frame URL
    const { error: updateError } = await supabase
      .from('tournament_clips')
      .update({ last_frame_url: frameUrl } as Record<string, unknown>)
      .eq('id', clipId);

    if (updateError) {
      console.error(`[extract-frame] DB update failed for clip ${clipId}:`, updateError);
      return NextResponse.json({ error: 'Failed to save frame URL' }, { status: 500 });
    }

    console.log(`[extract-frame] Success: ${frameUrl}`);
    return NextResponse.json({ success: true, lastFrameUrl: frameUrl });
  } catch (err) {
    console.error(`[extract-frame] Error for clip ${clipId}:`, err);
    return NextResponse.json(
      { error: 'Frame extraction failed' },
      { status: 500 }
    );
  }
}
