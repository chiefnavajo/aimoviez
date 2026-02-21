// =============================================================================
// CRON: Process Movie Scenes
// Runs every 2 minutes. Picks up projects in 'generating' status and processes
// one scene at a time: pending → generating → narrating → merging → completed.
// Scene 1 uses text-to-video; scene 2+ uses image-to-video with previous frame.
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createClient } from '@supabase/supabase-js';
import {
  startGeneration,
  startImageToVideoGeneration,
  getModelConfig,
  checkFalStatus,
  MODEL_DURATION_SECONDS,
  getCreditCost,
} from '@/lib/ai-video';
import { extractFrameAtTimestamp, uploadFrameWithKey } from '@/lib/storage/frame-upload';
import { getStorageProvider, getSignedUploadUrl, getPublicVideoUrl } from '@/lib/storage';
import { generateNarration } from '@/lib/elevenlabs';
import type { NarrationConfig } from '@/lib/elevenlabs';
import path from 'path';
import crypto from 'crypto';
import { tmpdir } from 'os';
import { writeFile, readFile, unlink } from 'fs/promises';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

const MAX_RETRIES = 3;
const LOCK_JOB_NAME = 'process_movie_scenes';

// =============================================================================
// MAIN HANDLER
// =============================================================================

export async function GET(req: NextRequest) {
  // 1. Auth
  const authError = verifyCronAuth(req.headers.get('authorization'));
  if (authError) return authError;

  const supabase = getSupabase();

  // 2. Distributed lock
  const lockId = `movie-scenes-${Date.now()}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 300_000).toISOString();

  await supabase
    .from('cron_locks')
    .delete()
    .eq('job_name', LOCK_JOB_NAME)
    .lt('expires_at', now);

  const { error: lockError } = await supabase
    .from('cron_locks')
    .insert({
      job_name: LOCK_JOB_NAME,
      lock_id: lockId,
      acquired_at: now,
      expires_at: expiresAt,
    });

  if (lockError) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Lock held' }, { status: 202 });
  }

  let processed = 0;
  let errors = 0;

  try {
    // 3. Find projects in 'generating' status (max 10 per run)
    const { data: projects } = await supabase
      .from('movie_projects')
      .select('id, user_id, model, style, voice_id, current_scene, total_scenes, completed_scenes, spent_credits')
      .eq('status', 'generating')
      .order('updated_at', { ascending: true })
      .limit(10);

    if (!projects || projects.length === 0) {
      return NextResponse.json({ ok: true, message: 'No generating projects', processed: 0 });
    }

    for (const project of projects) {
      try {
        const result = await processProjectScene(supabase, project);
        if (result.processed) processed++;
        if (result.error) errors++;
      } catch (err) {
        console.error(`[process-movie-scenes] Error on project ${project.id}:`, err);
        errors++;
      }
    }

    return NextResponse.json({ ok: true, processed, errors, projects: projects.length });
  } catch (err) {
    console.error('[process-movie-scenes] Unexpected error:', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  } finally {
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', LOCK_JOB_NAME)
      .eq('lock_id', lockId);
  }
}

// =============================================================================
// PROCESS ONE PROJECT'S CURRENT SCENE
// =============================================================================

interface ProjectRow {
  id: string;
  user_id: string;
  model: string;
  style: string | null;
  voice_id: string | null;
  current_scene: number;
  total_scenes: number;
  completed_scenes: number;
  spent_credits: number;
}

async function processProjectScene(
  supabase: ReturnType<typeof getSupabase>,
  project: ProjectRow
): Promise<{ processed: boolean; error?: boolean }> {
  // Get current scene
  const { data: scene } = await supabase
    .from('movie_scenes')
    .select('*')
    .eq('project_id', project.id)
    .eq('scene_number', project.current_scene)
    .single();

  if (!scene) {
    // No more scenes — project may be complete
    await checkProjectCompletion(supabase, project);
    return { processed: true };
  }

  // Route based on scene status
  switch (scene.status) {
    case 'pending':
      return handlePendingScene(supabase, project, scene);
    case 'generating':
      return handleGeneratingScene(supabase, project, scene);
    case 'narrating':
      return handleNarratingScene(supabase, project, scene);
    case 'merging':
      return handleMergingScene(supabase, project, scene);
    case 'completed':
      // Advance to next scene
      await advanceToNextScene(supabase, project);
      return { processed: true };
    case 'failed':
      // Retry or fail project
      if (scene.retry_count < MAX_RETRIES) {
        await supabase
          .from('movie_scenes')
          .update({ status: 'pending', error_message: null, retry_count: scene.retry_count + 1 })
          .eq('id', scene.id);
        return { processed: true };
      }
      await failProject(supabase, project.id, `Scene ${scene.scene_number} failed after ${MAX_RETRIES} retries: ${scene.error_message}`);
      return { processed: false, error: true };
    default:
      return { processed: false };
  }
}

// =============================================================================
// SCENE STATUS HANDLERS
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePendingScene(supabase: ReturnType<typeof getSupabase>, project: ProjectRow, scene: any) {
  const modelConfig = getModelConfig(project.model);
  const creditCost = await getCreditCost(project.model, supabase); // From model_pricing DB table

  // If video was already generated (e.g. webhook completed but merging failed),
  // skip straight to next phase without re-submitting or re-charging
  if (scene.video_url) {
    await supabase
      .from('movie_scenes')
      .update({ status: project.voice_id ? 'narrating' : 'merging' })
      .eq('id', scene.id);
    return { processed: true };
  }

  // 1a. Create ai_generations record first (needed for credit deduction reference)
  const placeholderRequestId = 'placeholder_movie_' + crypto.randomUUID();
  const { data: earlyGenRecord, error: earlyGenError } = await supabase
    .from('ai_generations')
    .insert({
      user_id: project.user_id,
      fal_request_id: placeholderRequestId,
      status: 'pending',
      prompt: scene.video_prompt.slice(0, 2000),
      model: project.model,
      style: project.style,
      generation_mode: scene.scene_number === 1 ? 'text-to-video' : 'image-to-video',
      credit_deducted: false,
      credit_amount: creditCost,
    })
    .select('id')
    .single();

  if (earlyGenError || !earlyGenRecord) {
    console.error('[process-movie-scenes] Failed to create generation record:', earlyGenError?.message);
    await supabase.from('movie_scenes').update({ status: 'failed', error_message: 'Failed to create generation record' }).eq('id', scene.id);
    return { processed: false, error: true };
  }

  // 1b. Deduct credits with generation reference (enables proper refund path)
  const { data: deductResult } = await supabase.rpc('deduct_credits', {
    p_user_id: project.user_id,
    p_amount: creditCost,
    p_generation_id: earlyGenRecord.id,
  });

  if (!deductResult?.success) {
    // Insufficient credits — clean up generation record, pause project
    await supabase.from('ai_generations').update({ status: 'failed', error_message: 'Insufficient credits' }).eq('id', earlyGenRecord.id);
    await supabase
      .from('movie_projects')
      .update({ status: 'paused', error_message: 'Insufficient credits. Add more credits and resume.' })
      .eq('id', project.id);
    return { processed: false, error: true };
  }

  // Mark credits as deducted
  await supabase.from('ai_generations').update({ credit_deducted: true }).eq('id', earlyGenRecord.id);

  // Update scene credit cost and project spent_credits
  await supabase
    .from('movie_scenes')
    .update({ credit_cost: creditCost })
    .eq('id', scene.id);

  // FIX: Use atomic SQL increment via RPC to prevent lost updates under concurrency.
  // Previously this was a read-then-write pattern that could lose updates when
  // multiple scenes for different projects were processed concurrently.
  const { error: incrSpentError } = await supabase.rpc('increment_movie_project_field', {
    p_project_id: project.id,
    p_field: 'spent_credits',
    p_amount: creditCost,
  });

  // Fallback: if the RPC doesn't exist, use optimistic read-modify-write with CAS guard
  if (incrSpentError) {
    const { data: freshProject } = await supabase
      .from('movie_projects')
      .select('spent_credits')
      .eq('id', project.id)
      .single();
    const oldVal = freshProject?.spent_credits || 0;
    const { error: casError } = await supabase
      .from('movie_projects')
      .update({ spent_credits: oldVal + creditCost })
      .eq('id', project.id)
      .eq('spent_credits', oldVal); // CAS: only update if value hasn't changed
    if (casError) {
      console.warn('[process-movie-scenes] CAS conflict on spent_credits, retrying once');
      const { data: retry } = await supabase
        .from('movie_projects')
        .select('spent_credits')
        .eq('id', project.id)
        .single();
      await supabase
        .from('movie_projects')
        .update({ spent_credits: (retry?.spent_credits || 0) + creditCost })
        .eq('id', project.id);
    }
  }

  // 2. Get previous scene's last frame for continuity (scene 2+)
  let previousFrameUrl: string | null = null;
  if (scene.scene_number > 1) {
    const { data: prevScene } = await supabase
      .from('movie_scenes')
      .select('last_frame_url')
      .eq('project_id', project.id)
      .eq('scene_number', scene.scene_number - 1)
      .single();
    previousFrameUrl = prevScene?.last_frame_url || null;
  }

  // 3. Submit to fal.ai
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/ai/webhook`;

  try {
    let requestId: string;

    if (scene.scene_number === 1 || !previousFrameUrl) {
      // Text-to-video for scene 1 (or fallback if no frame)
      const result = await startGeneration(
        project.model,
        scene.video_prompt,
        project.style || undefined,
        webhookUrl
      );
      requestId = result.requestId;
    } else {
      // Image-to-video for scene 2+ with previous frame
      const result = await startImageToVideoGeneration(
        project.model,
        scene.video_prompt,
        previousFrameUrl,
        project.style || undefined,
        webhookUrl
      );
      requestId = result.requestId;
    }

    // 4. Update ai_generations record with real fal_request_id
    await supabase
      .from('ai_generations')
      .update({
        fal_request_id: requestId,
        status: 'processing',
        generation_mode: scene.scene_number === 1 || !previousFrameUrl ? 'text-to-video' : 'image-to-video',
        image_url: previousFrameUrl,
      })
      .eq('id', earlyGenRecord.id);

    // 5. Update scene status
    await supabase
      .from('movie_scenes')
      .update({
        status: 'generating',
        ai_generation_id: earlyGenRecord.id,
      })
      .eq('id', scene.id);

    console.log(`[process-movie-scenes] Scene ${scene.scene_number}/${project.total_scenes} submitted for project ${project.id} (${scene.scene_number === 1 ? 'text-to-video' : 'image-to-video'})`);
    return { processed: true };
  } catch (err) {
    console.error(`[process-movie-scenes] Generation submit error for scene ${scene.scene_number}:`, err);

    // Refund credits using proper refund path (with generation reference)
    try {
      await supabase.rpc('refund_credits', {
        p_user_id: project.user_id,
        p_generation_id: earlyGenRecord.id,
      });
      // Mark generation as failed
      await supabase.from('ai_generations').update({ status: 'failed', error_message: 'fal.ai submission failed' }).eq('id', earlyGenRecord.id);
      // FIX: Use atomic decrement instead of stale project.spent_credits
      const { error: decrError } = await supabase.rpc('increment_movie_project_field', {
        p_project_id: project.id,
        p_field: 'spent_credits',
        p_amount: -creditCost,
      });
      if (decrError) {
        // Fallback: refetch and update
        const { data: refundProject } = await supabase
          .from('movie_projects')
          .select('spent_credits')
          .eq('id', project.id)
          .single();
        await supabase
          .from('movie_projects')
          .update({ spent_credits: Math.max(0, (refundProject?.spent_credits || 0) - creditCost) })
          .eq('id', project.id);
      }
    } catch {
      console.error('[process-movie-scenes] Credit refund failed for scene', scene.scene_number);
    }

    await supabase
      .from('movie_scenes')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Generation submit failed' })
      .eq('id', scene.id);
    return { processed: false, error: true };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleGeneratingScene(supabase: ReturnType<typeof getSupabase>, project: ProjectRow, scene: any) {
  // Check if ai_generation is complete
  if (!scene.ai_generation_id) {
    await supabase
      .from('movie_scenes')
      .update({ status: 'failed', error_message: 'No generation record found' })
      .eq('id', scene.id);
    return { processed: false, error: true };
  }

  const { data: gen } = await supabase
    .from('ai_generations')
    .select('id, status, video_url, fal_request_id')
    .eq('id', scene.ai_generation_id)
    .single();

  if (!gen) {
    await supabase
      .from('movie_scenes')
      .update({ status: 'failed', error_message: 'Generation record not found' })
      .eq('id', scene.id);
    return { processed: false, error: true };
  }

  if (gen.status === 'completed' && gen.video_url) {
    // Generation done — move to narration or merging
    await supabase
      .from('movie_scenes')
      .update({
        video_url: gen.video_url,
        status: project.voice_id ? 'narrating' : 'merging',
      })
      .eq('id', scene.id);
    return { processed: true };
  }

  if (gen.status === 'failed' || gen.status === 'expired') {
    await supabase
      .from('movie_scenes')
      .update({ status: 'failed', error_message: 'Video generation failed or timed out' })
      .eq('id', scene.id);
    return { processed: false, error: true };
  }

  // Still processing — poll fal.ai status as fallback
  if (gen.status === 'pending' || gen.status === 'processing') {
    try {
      const falStatus = await checkFalStatus(project.model, gen.fal_request_id);
      if (falStatus.status === 'COMPLETED' && falStatus.videoUrl) {
        // Webhook may have been missed — update directly
        await supabase
          .from('ai_generations')
          .update({ status: 'completed', video_url: falStatus.videoUrl, completed_at: new Date().toISOString() })
          .eq('id', gen.id);
        await supabase
          .from('movie_scenes')
          .update({ video_url: falStatus.videoUrl, status: project.voice_id ? 'narrating' : 'merging' })
          .eq('id', scene.id);
        return { processed: true };
      }
    } catch {
      // Polling failed — will retry next cron run
    }
  }

  // Still in progress — skip this project, check again in 2 min
  return { processed: false };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleNarratingScene(supabase: ReturnType<typeof getSupabase>, project: ProjectRow, scene: any) {
  if (!project.voice_id || !scene.narration_text) {
    // Skip narration
    await supabase
      .from('movie_scenes')
      .update({ status: 'merging' })
      .eq('id', scene.id);
    return { processed: true };
  }

  try {
    // Get narration config from feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('config')
      .eq('key', 'elevenlabs_narration')
      .single();

    const narrationConfig = flag?.config as NarrationConfig | undefined;
    if (!narrationConfig) {
      throw new Error('Narration not configured');
    }

    // Generate narration audio
    const narrationResult = await generateNarration(
      scene.narration_text,
      project.voice_id,
      narrationConfig
    );

    if (!narrationResult.audioBuffer || narrationResult.audioBuffer.length === 0) {
      throw new Error('No audio returned from narration');
    }

    // Convert buffer to base64 for merge function
    const audioBase64 = narrationResult.audioBuffer.toString('base64');

    // Merge narration with video
    const mergedUrl = await mergeNarrationWithVideo(
      scene.video_url,
      audioBase64,
      project.id,
      scene.scene_number,
      project.model
    );

    await supabase
      .from('movie_scenes')
      .update({ video_url: mergedUrl, status: 'merging' })
      .eq('id', scene.id);

    return { processed: true };
  } catch (err) {
    console.error(`[process-movie-scenes] Narration error for scene ${scene.scene_number}:`, err);
    // Skip narration on failure, continue with original video
    await supabase
      .from('movie_scenes')
      .update({ status: 'merging', error_message: 'Narration failed, using video without voiceover' })
      .eq('id', scene.id);
    return { processed: true };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleMergingScene(supabase: ReturnType<typeof getSupabase>, project: ProjectRow, scene: any) {
  if (!scene.video_url) {
    await supabase
      .from('movie_scenes')
      .update({ status: 'failed', error_message: 'No video URL for merging' })
      .eq('id', scene.id);
    return { processed: false, error: true };
  }

  try {
    // 1. Upload scene video to permanent storage
    const storageProvider = await getStorageProvider(false); // Use default provider
    const storageKey = `movies/${project.id}/scene_${String(scene.scene_number).padStart(3, '0')}.mp4`;

    const { signedUrl } = await getSignedUploadUrl(storageKey, 'video/mp4', storageProvider);

    // Download from fal.ai
    const videoRes = await fetch(scene.video_url, { signal: AbortSignal.timeout(30_000) });
    if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    // Upload to permanent storage
    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: videoBuffer,
      signal: AbortSignal.timeout(30_000),
    });

    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);

    const publicUrl = getPublicVideoUrl(storageKey, storageProvider);

    // 2. Extract last frame for continuity to next scene
    const sceneDuration = MODEL_DURATION_SECONDS[project.model] || 5;
    const frameTimestamp = Math.max(sceneDuration - 0.1, 0); // Last frame

    let lastFrameUrl: string | null = null;
    try {
      const frameData = await extractFrameAtTimestamp(scene.video_url, frameTimestamp);
      const frameKey = `movies/${project.id}/frames/scene_${String(scene.scene_number).padStart(3, '0')}.jpg`;
      lastFrameUrl = await uploadFrameWithKey(frameKey, frameData, storageProvider);
    } catch (frameErr) {
      console.warn(`[process-movie-scenes] Frame extraction failed for scene ${scene.scene_number}:`, frameErr);
      // Non-critical — next scene will fall back to text-to-video
    }

    // 3. Update scene as completed
    await supabase
      .from('movie_scenes')
      .update({
        status: 'completed',
        public_video_url: publicUrl,
        last_frame_url: lastFrameUrl,
        duration_seconds: sceneDuration,
        completed_at: new Date().toISOString(),
      })
      .eq('id', scene.id);

    // 4. Update project progress — atomic increment to prevent lost updates
    // FIX: Use atomic SQL increment via RPC to prevent lost updates under concurrency.
    const { error: incrScenesError } = await supabase.rpc('increment_movie_project_field', {
      p_project_id: project.id,
      p_field: 'completed_scenes',
      p_amount: 1,
    });

    let newCompleted: number;

    // Fallback: if the RPC doesn't exist, use optimistic read-modify-write with CAS guard
    if (incrScenesError) {
      const { data: freshProjectForCompletion } = await supabase
        .from('movie_projects')
        .select('completed_scenes')
        .eq('id', project.id)
        .single();
      const oldScenes = freshProjectForCompletion?.completed_scenes || 0;
      newCompleted = oldScenes + 1;
      const { error: casError } = await supabase
        .from('movie_projects')
        .update({ completed_scenes: newCompleted })
        .eq('id', project.id)
        .eq('completed_scenes', oldScenes); // CAS: only update if value hasn't changed
      if (casError) {
        console.warn('[process-movie-scenes] CAS conflict on completed_scenes, retrying once');
        const { data: retry } = await supabase
          .from('movie_projects')
          .select('completed_scenes')
          .eq('id', project.id)
          .single();
        newCompleted = (retry?.completed_scenes || 0) + 1;
        await supabase
          .from('movie_projects')
          .update({ completed_scenes: newCompleted })
          .eq('id', project.id);
      }
    } else {
      // RPC succeeded — fetch the updated value for downstream logic
      const { data: updatedProject } = await supabase
        .from('movie_projects')
        .select('completed_scenes')
        .eq('id', project.id)
        .single();
      newCompleted = updatedProject?.completed_scenes || (project.completed_scenes + 1);
    }

    console.log(`[process-movie-scenes] Scene ${scene.scene_number}/${project.total_scenes} completed for project ${project.id} (${newCompleted}/${project.total_scenes})`);

    // 5. Advance to next scene
    await advanceToNextScene(supabase, { ...project, completed_scenes: newCompleted });

    return { processed: true };
  } catch (err) {
    console.error(`[process-movie-scenes] Merging error for scene ${scene.scene_number}:`, err);
    await supabase
      .from('movie_scenes')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Merging failed' })
      .eq('id', scene.id);
    return { processed: false, error: true };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

async function advanceToNextScene(supabase: ReturnType<typeof getSupabase>, project: ProjectRow) {
  const nextScene = project.current_scene + 1;

  // Check if project is complete
  if (project.completed_scenes >= project.total_scenes || nextScene > project.total_scenes) {
    await checkProjectCompletion(supabase, project);
    return;
  }

  // Check if project was paused while we were processing
  const { data: currentProject } = await supabase
    .from('movie_projects')
    .select('status')
    .eq('id', project.id)
    .single();

  if (currentProject?.status !== 'generating') {
    return; // Project was paused/cancelled
  }

  await supabase
    .from('movie_projects')
    .update({ current_scene: nextScene })
    .eq('id', project.id);
}

async function checkProjectCompletion(supabase: ReturnType<typeof getSupabase>, project: ProjectRow) {
  // Count completed scenes
  const { count } = await supabase
    .from('movie_scenes')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', project.id)
    .eq('status', 'completed');

  if ((count || 0) >= project.total_scenes) {
    console.log(`[process-movie-scenes] Project ${project.id} all scenes done (${count}). Starting concatenation...`);

    // Try to concatenate all scene videos into one final MP4
    try {
      const { concatenateScenes } = await import('@/lib/movie-concat');

      // Get all completed scenes ordered
      const { data: completedScenes } = await supabase
        .from('movie_scenes')
        .select('scene_number, public_video_url, video_url, duration_seconds')
        .eq('project_id', project.id)
        .eq('status', 'completed')
        .order('scene_number', { ascending: true });

      if (completedScenes && completedScenes.length > 0) {
        const scenesForConcat = completedScenes.map(s => ({
          scene_number: s.scene_number,
          video_url: s.public_video_url || s.video_url,
        }));

        const concatResult = await concatenateScenes(project.id, scenesForConcat);

        if (concatResult.ok) {
          const totalDuration = completedScenes.reduce(
            (sum, s) => sum + (Number(s.duration_seconds) || 5), 0
          );

          await supabase
            .from('movie_projects')
            .update({
              status: 'completed',
              completed_scenes: count || 0,
              completed_at: new Date().toISOString(),
              final_video_url: concatResult.publicUrl,
              total_duration_seconds: totalDuration,
            })
            .eq('id', project.id);

          console.log(`[process-movie-scenes] Project ${project.id} completed with final MP4! ${count} scenes, ${concatResult.fileSizeMb}MB`);
          return;
        } else {
          console.warn(`[process-movie-scenes] Concatenation failed for project ${project.id}: ${concatResult.error}`);
        }
      }
    } catch (concatErr) {
      console.warn(`[process-movie-scenes] Concatenation error for project ${project.id}:`, concatErr);
    }

    // Fallback: mark completed without final MP4 (scenes can still be watched individually)
    await supabase
      .from('movie_projects')
      .update({
        status: 'completed',
        completed_scenes: count || 0,
        completed_at: new Date().toISOString(),
      })
      .eq('id', project.id);
    console.log(`[process-movie-scenes] Project ${project.id} completed (no final MP4). ${count} scenes done.`);
  }
}

async function failProject(supabase: ReturnType<typeof getSupabase>, projectId: string, errorMessage: string) {
  await supabase
    .from('movie_projects')
    .update({ status: 'failed', error_message: errorMessage })
    .eq('id', projectId);
  console.error(`[process-movie-scenes] Project ${projectId} failed: ${errorMessage}`);
}

async function mergeNarrationWithVideo(
  videoUrl: string,
  audioBase64: string,
  projectId: string,
  sceneNumber: number,
  model: string
): Promise<string> {
  const id = crypto.randomUUID();
  const inputPath = path.join(tmpdir(), `movie_video_${id}.mp4`);
  const audioPath = path.join(tmpdir(), `movie_audio_${id}.mp3`);
  const outputPath = path.join(tmpdir(), `movie_merged_${id}.mp4`);

  try {
    // Download video
    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(30_000) });
    if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    await writeFile(inputPath, videoBuffer);

    // Write audio
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    await writeFile(audioPath, audioBuffer);

    // Merge with ffmpeg
    const ffmpegPath = (await import('ffmpeg-static')).default;
    if (!ffmpegPath) throw new Error('ffmpeg binary not found');

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    // Add narration as audio track (no existing audio for most models in movie mode)
    await execFileAsync(ffmpegPath, [
      '-i', inputPath,
      '-i', audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-shortest',
      '-y',
      outputPath,
    ]);

    // Upload merged video to temp storage and return URL
    const mergedBuffer = await readFile(outputPath);
    const storageProvider = await getStorageProvider(false);
    const storageKey = `movies/${projectId}/scene_${String(sceneNumber).padStart(3, '0')}_narrated.mp4`;
    const { signedUrl } = await getSignedUploadUrl(storageKey, 'video/mp4', storageProvider);

    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: mergedBuffer,
      signal: AbortSignal.timeout(30_000),
    });

    if (!uploadRes.ok) throw new Error(`Narrated upload failed: ${uploadRes.status}`);

    return getPublicVideoUrl(storageKey, storageProvider);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(audioPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
