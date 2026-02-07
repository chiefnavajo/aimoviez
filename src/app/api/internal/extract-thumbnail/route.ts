// app/api/internal/extract-thumbnail/route.ts
// ============================================================================
// THUMBNAIL EXTRACTION — Server-side first-frame extraction using ffmpeg-static.
// Called fire-and-forget from clip registration paths.
// Auth: CRON_SECRET bearer token (not user-facing).
// Optionally triggers visual learning after extraction.
// ============================================================================

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 minutes for video download + extraction + visual analysis

import { NextRequest, NextResponse } from 'next/server';
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
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { clipId?: string; videoUrl?: string; seasonId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { clipId, videoUrl, seasonId } = body;
  if (!clipId) {
    return NextResponse.json({ error: 'clipId required' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Temp file paths for this extraction
  const inputPath = path.join(tmpdir(), `thumb_input_${clipId}.mp4`);
  const outputPath = path.join(tmpdir(), `thumb_output_${clipId}.jpg`);

  try {
    // 1. Look up the clip
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url, season_id, vote_count, status')
      .eq('id', clipId)
      .single();

    if (clipError || !clip) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
    }

    // Use provided videoUrl or fall back to clip's video_url
    const sourceVideoUrl = videoUrl || clip.video_url;
    const sourceSeasonId = seasonId || clip.season_id;

    if (!sourceVideoUrl) {
      return NextResponse.json({ error: 'Clip has no video_url' }, { status: 400 });
    }

    // Check if thumbnail is already a real image (not same as video_url)
    // If thumbnail_url exists and differs from video_url, it might be a real thumbnail
    const isRealThumbnail = clip.thumbnail_url &&
      clip.thumbnail_url !== clip.video_url &&
      (clip.thumbnail_url.includes('.jpg') || clip.thumbnail_url.includes('.jpeg') || clip.thumbnail_url.includes('.png'));

    if (isRealThumbnail) {
      console.log(`[extract-thumbnail] Clip ${clipId} already has a real thumbnail, skipping extraction`);
      return NextResponse.json({
        success: true,
        thumbnailUrl: clip.thumbnail_url,
        skipped: true,
      });
    }

    // 2. Download video to temp file
    console.log(`[extract-thumbnail] Downloading video for clip ${clipId}...`);
    const videoRes = await fetch(sourceVideoUrl, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!videoRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch video: ${videoRes.status}` },
        { status: 502 }
      );
    }

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    console.log(`[extract-thumbnail] Video downloaded: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    await writeFile(inputPath, videoBuffer);

    // 3. Extract first frame using ffmpeg-static
    const ffmpegPath = (await import('ffmpeg-static')).default;
    if (!ffmpegPath) {
      return NextResponse.json({ error: 'ffmpeg binary not found' }, { status: 500 });
    }

    // Extract first frame
    await execFileAsync(ffmpegPath, [
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', '2', // High quality JPEG
      '-y',
      outputPath,
    ]);

    const thumbnailData = new Uint8Array(await readFile(outputPath));

    if (thumbnailData.length === 0) {
      return NextResponse.json({ error: 'Thumbnail extraction produced empty output' }, { status: 500 });
    }

    console.log(`[extract-thumbnail] Thumbnail extracted: ${(thumbnailData.length / 1024).toFixed(0)}KB`);

    // 4. Determine storage provider
    const { data: r2Flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'r2_storage')
      .maybeSingle();

    const provider = await getStorageProvider((r2Flag as { enabled?: boolean } | null)?.enabled ?? false);

    // 5. Upload thumbnail (use 'thumbnail' prefix to differentiate from last_frame)
    console.log(`[extract-thumbnail] Uploading thumbnail to ${provider}...`);
    const thumbnailUrl = await uploadFrame(`thumb_${clipId}`, thumbnailData, provider);

    // 6. Update clip row with the thumbnail URL
    const { error: updateError } = await supabase
      .from('tournament_clips')
      .update({ thumbnail_url: thumbnailUrl } as Record<string, unknown>)
      .eq('id', clipId);

    if (updateError) {
      console.error(`[extract-thumbnail] DB update failed for clip ${clipId}:`, updateError);
      return NextResponse.json({ error: 'Failed to save thumbnail URL' }, { status: 500 });
    }

    console.log(`[extract-thumbnail] Thumbnail saved: ${thumbnailUrl}`);

    // 7. Optionally trigger visual learning (only for winner clips)
    let visualLearningResult: { processed: boolean; error?: string; skipped?: boolean } = { processed: false };
    const isWinner = clip.status === 'winner' || clip.status === 'locked';

    const { data: visualFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'visual_learning')
      .maybeSingle();

    if (visualFlag?.enabled && sourceSeasonId && isWinner) {
      try {
        const { extractVisualFeatures, storeClipVisuals } = await import('@/lib/visual-learning');
        const features = await extractVisualFeatures(thumbnailUrl);

        if (features) {
          await storeClipVisuals({
            clipId,
            seasonId: sourceSeasonId,
            thumbnailUrl,
            features,
            voteCount: clip.vote_count || 0,
            isWinner: clip.status === 'winner' || clip.status === 'locked',
          });
          visualLearningResult = { processed: true };
          console.log(`[extract-thumbnail] Visual features extracted and stored for clip ${clipId}`);
        } else {
          visualLearningResult = { processed: false, error: 'Feature extraction returned null' };
        }
      } catch (visualErr) {
        console.warn(`[extract-thumbnail] Visual learning failed for clip ${clipId}:`, visualErr);
        visualLearningResult = {
          processed: false,
          error: visualErr instanceof Error ? visualErr.message : 'Unknown error',
        };
      }
    } else if (visualFlag?.enabled && !isWinner) {
      console.log(`[extract-thumbnail] Skipping visual learning for non-winner clip ${clipId} (status: ${clip.status})`);
      visualLearningResult = { processed: false, skipped: true };
    }

    return NextResponse.json({
      success: true,
      thumbnailUrl,
      visualLearning: visualLearningResult,
    });
  } catch (err) {
    console.error(`[extract-thumbnail] Error for clip ${clipId}:`, err);
    return NextResponse.json(
      { error: 'Thumbnail extraction failed' },
      { status: 500 }
    );
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
