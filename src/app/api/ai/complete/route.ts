// POST /api/ai/complete
// Prepares a completed AI generation for tournament submission.
// Without narration: returns a signed upload URL so the client can transfer the video.
// With narration: server-side downloads, merges audio, uploads, and returns public URL.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { getStorageProvider, getSignedUploadUrl as getProviderSignedUrl, getPublicVideoUrl } from '@/lib/storage';
import { MODELS } from '@/lib/ai-video';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Extended for narration merge (download + ffmpeg + upload)

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

    const { generationId, narrationAudioBase64 } = body;
    if (!generationId || typeof generationId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'generationId is required' },
        { status: 400 }
      );
    }

    const hasNarration = typeof narrationAudioBase64 === 'string' && narrationAudioBase64.length > 0;

    // Prevent DoS: limit base64 audio to ~10MB decoded (13.3MB base64)
    if (hasNarration && (narrationAudioBase64 as string).length > 15_000_000) {
      return NextResponse.json(
        { success: false, error: 'Narration audio too large (max 10MB)' },
        { status: 413 }
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

    // 5. Look up generation (verify ownership, include model for audio merge)
    const { data: gen, error: genError } = await supabase
      .from('ai_generations')
      .select('id, status, video_url, completed_at, storage_key, complete_initiated_at, clip_id, model, genre')
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

    // 8. Check for active season (genre-aware for multi-genre)
    let seasonQuery = supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active');
    if (gen.genre) {
      seasonQuery = seasonQuery.eq('genre', gen.genre.toLowerCase());
    }
    const { data: seasons } = await seasonQuery
      .order('created_at', { ascending: true })
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
    const random = crypto.randomBytes(8).toString('hex');
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

    // =========================================================================
    // NARRATION MERGE PATH
    // When narrationAudioBase64 is provided, the server downloads the video,
    // merges the audio track, uploads the result, and returns the public URL.
    // =========================================================================

    if (hasNarration) {
      const inputPath = path.join(tmpdir(), `merge_video_${gen.id}.mp4`);
      const audioPath = path.join(tmpdir(), `merge_audio_${gen.id}.mp3`);
      const outputPath = path.join(tmpdir(), `merge_output_${gen.id}.mp4`);

      try {
        // 15a. Download video from fal.ai
        console.info('[AI_COMPLETE] Downloading video for narration merge:', gen.id);
        const videoRes = await fetch(gen.video_url, {
          signal: AbortSignal.timeout(30_000),
        });

        if (!videoRes.ok) {
          return NextResponse.json(
            { success: false, error: `Failed to download video: ${videoRes.status}` },
            { status: 502 }
          );
        }

        const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
        await writeFile(inputPath, videoBuffer);

        // 15b. Decode narration audio from base64
        const audioBuffer = Buffer.from(narrationAudioBase64 as string, 'base64');
        await writeFile(audioPath, audioBuffer);

        // 15c. Merge with ffmpeg-static
        const ffmpegPath = (await import('ffmpeg-static')).default;
        if (!ffmpegPath) {
          return NextResponse.json(
            { success: false, error: 'ffmpeg binary not found' },
            { status: 500 }
          );
        }

        const modelConfig = MODELS[gen.model];
        const videoHasAudio = modelConfig?.supportsAudio ?? false;

        if (videoHasAudio) {
          // Mix existing video audio with narration
          // duration=first keeps full video length even if narration is shorter
          await execFileAsync(ffmpegPath, [
            '-i', inputPath,
            '-i', audioPath,
            '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first',
            '-c:v', 'copy',
            '-map', '0:v:0',
            '-y',
            outputPath,
          ]);
        } else {
          // No existing audio — add narration as the only audio track
          // Video plays full length; narration ends when it ends (silence after)
          await execFileAsync(ffmpegPath, [
            '-i', inputPath,
            '-i', audioPath,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-y',
            outputPath,
          ]);
        }

        // 15d. Read merged file and upload to storage via signed URL
        const mergedBuffer = await readFile(outputPath);
        console.info(`[AI_COMPLETE] Merged video: ${(mergedBuffer.length / 1024 / 1024).toFixed(1)}MB`);

        const uploadRes = await fetch(result.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'video/mp4' },
          body: mergedBuffer,
          signal: AbortSignal.timeout(30_000),
        });

        if (!uploadRes.ok) {
          console.error('[AI_COMPLETE] Merged upload failed:', uploadRes.status);
          return NextResponse.json(
            { success: false, error: 'Failed to upload merged video' },
            { status: 502 }
          );
        }

        const publicUrl = getPublicVideoUrl(uniqueFilename, storageProvider);
        console.info('[AI_COMPLETE] Narration merge complete for generation:', gen.id);

        return NextResponse.json({
          success: true,
          storageKey: uniqueFilename,
          publicUrl,
        });
      } catch (mergeError) {
        console.error('[AI_COMPLETE] Narration merge error:', mergeError);
        return NextResponse.json(
          { success: false, error: 'Audio merge failed. Please try again without narration.' },
          { status: 500 }
        );
      } finally {
        // Cleanup temp files
        await unlink(inputPath).catch(() => {});
        await unlink(audioPath).catch(() => {});
        await unlink(outputPath).catch(() => {});
      }
    }

    // =========================================================================
    // STANDARD PATH (no narration) — return signed URL for client upload
    // =========================================================================

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
