// app/api/internal/extract-frame/route.ts
// ============================================================================
// FRAME EXTRACTION — Server-side last-frame extraction using ffmpeg-static.
// Called fire-and-forget from winner selection paths.
// Auth: CRON_SECRET bearer token (not user-facing).
// ============================================================================

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createClient } from '@supabase/supabase-js';
import { getStorageProvider } from '@/lib/storage';
import { uploadFrame } from '@/lib/storage/frame-upload';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function POST(req: NextRequest) {
  // Auth: require CRON_SECRET
  const authError = verifyCronAuth(req.headers.get('authorization'));
  if (authError) return authError;

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

  // FIX: Validate UUID format to prevent path traversal in temp file paths
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof clipId !== 'string' || !uuidRegex.test(clipId)) {
    return NextResponse.json({ error: 'Invalid clipId format' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Temp file paths for this extraction
  const inputPath = path.join(tmpdir(), `extract_input_${clipId}.mp4`);
  const outputPath = path.join(tmpdir(), `extract_output_${clipId}.jpg`);

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

    // 2. Download video to temp file
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

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    console.log(`[extract-frame] Video downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    await writeFile(inputPath, videoBuffer);

    // 3. Extract last frame using ffmpeg-static
    const ffmpegPath = (await import('ffmpeg-static')).default;
    if (!ffmpegPath) {
      return NextResponse.json({ error: 'ffmpeg binary not found' }, { status: 500 });
    }

    try {
      // Try extracting the last frame (-sseof -0.1 = 0.1s before end)
      await execFileAsync(ffmpegPath, [
        '-sseof', '-0.1',
        '-i', inputPath,
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
        outputPath,
      ]);
    } catch {
      // Fallback: extract first frame
      console.warn(`[extract-frame] -sseof failed, using first frame as fallback for clip ${clipId}`);
      await execFileAsync(ffmpegPath, [
        '-i', inputPath,
        '-frames:v', '1',
        '-q:v', '2',
        '-y',
        outputPath,
      ]);
    }

    const finalFrameData = new Uint8Array(await readFile(outputPath));

    if (finalFrameData.length === 0) {
      return NextResponse.json({ error: 'Frame extraction produced empty output' }, { status: 500 });
    }

    console.log(`[extract-frame] Frame extracted: ${(finalFrameData.length / 1024).toFixed(0)}KB`);

    // 4. Determine storage provider
    const { data: r2Flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'r2_storage')
      .maybeSingle();

    const provider = await getStorageProvider((r2Flag as { enabled?: boolean } | null)?.enabled ?? false);

    // 5. Upload frame
    console.log(`[extract-frame] Uploading frame to ${provider}...`);
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
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
