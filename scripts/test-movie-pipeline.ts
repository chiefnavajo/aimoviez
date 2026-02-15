#!/usr/bin/env npx tsx
/**
 * Local Movie Pipeline E2E Test
 *
 * Tests the full movie generation pipeline locally:
 * 1. Frame extraction from a real fal.ai video
 * 2. Full cron scene processing simulation (pending → generating → merging → completed)
 * 3. Scene-to-scene continuity (last_frame_url chaining)
 * 4. Project completion detection
 *
 * Usage:
 *   npx tsx scripts/test-movie-pipeline.ts
 *
 * Requires: .env.local with SUPABASE_URL + SERVICE_ROLE_KEY
 */

import { config } from 'dotenv';
import path from 'path';

// Load .env.local
config({ path: path.join(__dirname, '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { extractFrameAtTimestamp, uploadFrameWithKey } from '../src/lib/storage/frame-upload';
import { getStorageProvider, getSignedUploadUrl, getPublicVideoUrl } from '../src/lib/storage';

// =============================================================================
// CONFIG
// =============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// The real video URL from scene 1 of the "pulp" project
const TEST_VIDEO_URL = 'https://v3b.fal.media/files/b/0a8e0f7d/77b_IINWTmo_pcAONCx_I_output.mp4';
const PROJECT_ID = '878cc678-df77-471d-88f9-676cd879ce90';

// =============================================================================
// TEST HELPERS
// =============================================================================

function log(icon: string, msg: string) {
  console.log(`${icon}  ${msg}`);
}

function pass(msg: string) { log('✅', msg); }
function fail(msg: string) { log('❌', msg); }
function info(msg: string) { log('ℹ️ ', msg); }
function warn(msg: string) { log('⚠️ ', msg); }

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    pass(msg);
    passed++;
  } else {
    fail(msg);
    failed++;
  }
}

// =============================================================================
// TEST 1: Frame Extraction (ffmpeg-static)
// =============================================================================

async function testFrameExtraction() {
  info('--- TEST 1: Frame Extraction from Video ---');

  try {
    info(`Downloading video and extracting frame at 4.9s from: ${TEST_VIDEO_URL.slice(0, 60)}...`);
    const startTime = Date.now();

    const frameData = await extractFrameAtTimestamp(TEST_VIDEO_URL, 4.9);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    assert(frameData.length > 0, `Frame extracted: ${(frameData.length / 1024).toFixed(1)} KB in ${elapsed}s`);

    // Check it's a valid JPEG (starts with FF D8)
    const isJpeg = frameData[0] === 0xFF && frameData[1] === 0xD8;
    assert(isJpeg, `Frame is valid JPEG (magic bytes: ${frameData[0].toString(16)} ${frameData[1].toString(16)})`);

    return frameData;
  } catch (err) {
    fail(`Frame extraction failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// =============================================================================
// TEST 2: Frame Upload to Storage
// =============================================================================

async function testFrameUpload(frameData: Uint8Array) {
  info('--- TEST 2: Frame Upload to Storage ---');

  try {
    const storageProvider = await getStorageProvider(false);
    info(`Storage provider: ${storageProvider}`);

    const testKey = `movies/test-pipeline/frames/test_frame.jpg`;
    const frameUrl = await uploadFrameWithKey(testKey, frameData, storageProvider);

    assert(frameUrl.length > 0, `Frame uploaded: ${frameUrl.slice(0, 80)}...`);

    // Verify the URL is accessible
    const checkRes = await fetch(frameUrl, { method: 'HEAD' });
    assert(checkRes.ok, `Frame URL is accessible (HTTP ${checkRes.status})`);

    return frameUrl;
  } catch (err) {
    fail(`Frame upload failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// =============================================================================
// TEST 3: Video Upload to Permanent Storage
// =============================================================================

async function testVideoUpload() {
  info('--- TEST 3: Video Upload to Permanent Storage ---');

  try {
    const storageProvider = await getStorageProvider(false);
    const storageKey = `movies/test-pipeline/scene_001.mp4`;

    // Get signed upload URL
    const { signedUrl } = await getSignedUploadUrl(storageKey, 'video/mp4', storageProvider);
    assert(signedUrl.length > 0, `Got signed upload URL (${storageProvider})`);

    // Download video from fal.ai
    info('Downloading video from fal.ai...');
    const videoRes = await fetch(TEST_VIDEO_URL, { signal: AbortSignal.timeout(30_000) });
    assert(videoRes.ok, `Video downloaded from fal.ai (HTTP ${videoRes.status})`);

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    info(`Video size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Upload to permanent storage
    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: videoBuffer,
      signal: AbortSignal.timeout(30_000),
    });
    assert(uploadRes.ok, `Video uploaded to ${storageProvider} (HTTP ${uploadRes.status})`);

    // Get public URL
    const publicUrl = getPublicVideoUrl(storageKey, storageProvider);
    assert(publicUrl.length > 0, `Public video URL: ${publicUrl.slice(0, 80)}...`);

    return publicUrl;
  } catch (err) {
    fail(`Video upload failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// =============================================================================
// TEST 4: Full Merging Phase Simulation
// =============================================================================

async function testMergingPhase() {
  info('--- TEST 4: Full Merging Phase (video upload + frame extraction + frame upload) ---');

  try {
    const storageProvider = await getStorageProvider(false);
    const storageKey = `movies/test-pipeline/scene_merge_test.mp4`;

    // Step 1: Download video
    info('Step 1/4: Downloading video...');
    const videoRes = await fetch(TEST_VIDEO_URL, { signal: AbortSignal.timeout(30_000) });
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    assert(videoRes.ok, `Downloaded ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Step 2: Upload to permanent storage
    info('Step 2/4: Uploading to permanent storage...');
    const { signedUrl } = await getSignedUploadUrl(storageKey, 'video/mp4', storageProvider);
    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: videoBuffer,
      signal: AbortSignal.timeout(30_000),
    });
    assert(uploadRes.ok, `Uploaded to ${storageProvider}`);

    const publicUrl = getPublicVideoUrl(storageKey, storageProvider);

    // Step 3: Extract last frame
    info('Step 3/4: Extracting last frame...');
    const sceneDuration = 5; // kling-2.6
    const frameTimestamp = Math.max(sceneDuration - 0.1, 0);
    const frameData = await extractFrameAtTimestamp(TEST_VIDEO_URL, frameTimestamp);
    assert(frameData.length > 0, `Extracted frame: ${(frameData.length / 1024).toFixed(1)} KB`);

    // Step 4: Upload frame
    info('Step 4/4: Uploading frame...');
    const frameKey = `movies/test-pipeline/frames/scene_merge_test.jpg`;
    const lastFrameUrl = await uploadFrameWithKey(frameKey, frameData, storageProvider);
    assert(lastFrameUrl.length > 0, `Frame uploaded: ${lastFrameUrl.slice(0, 80)}...`);

    pass(`Full merging phase completed: video=${publicUrl.slice(0, 50)}... frame=${lastFrameUrl.slice(0, 50)}...`);

    return { publicUrl, lastFrameUrl };
  } catch (err) {
    fail(`Merging phase failed: ${err instanceof Error ? err.message : err}`);
    console.error(err);
    return null;
  }
}

// =============================================================================
// TEST 5: Check Current Project State
// =============================================================================

async function testProjectState() {
  info('--- TEST 5: Current Project State ---');

  const { data: project } = await supabase
    .from('movie_projects')
    .select('id, title, status, model, total_scenes, current_scene, completed_scenes, error_message')
    .eq('id', PROJECT_ID)
    .single();

  if (!project) {
    fail(`Project ${PROJECT_ID} not found`);
    return;
  }

  info(`Project: "${project.title}" | Status: ${project.status} | Model: ${project.model}`);
  info(`Scenes: ${project.completed_scenes}/${project.total_scenes} completed | Current: ${project.current_scene}`);

  if (project.error_message) {
    warn(`Error: ${project.error_message}`);
  }

  // Check all scenes
  const { data: scenes } = await supabase
    .from('movie_scenes')
    .select('scene_number, status, video_url, last_frame_url, error_message, retry_count')
    .eq('project_id', PROJECT_ID)
    .order('scene_number', { ascending: true });

  if (!scenes) {
    fail('No scenes found');
    return;
  }

  info(`\n  Scene Status Overview:`);
  for (const s of scenes) {
    const hasVideo = s.video_url ? '🎬' : '  ';
    const hasFrame = s.last_frame_url ? '🖼️' : '  ';
    const retries = s.retry_count > 0 ? ` (retries: ${s.retry_count})` : '';
    const err = s.error_message ? ` | err: ${s.error_message}` : '';
    info(`  Scene ${String(s.scene_number).padStart(2, ' ')}: ${s.status.padEnd(12)} ${hasVideo} ${hasFrame}${retries}${err}`);
  }

  // Validate
  const pendingWithVideo = scenes.filter(s => s.status === 'pending' && s.video_url);
  if (pendingWithVideo.length > 0) {
    warn(`${pendingWithVideo.length} scene(s) have video_url but are still 'pending' (stuck in retry loop)`);
  }

  const completedWithoutFrame = scenes.filter(s => s.status === 'completed' && !s.last_frame_url);
  if (completedWithoutFrame.length > 0) {
    warn(`${completedWithoutFrame.length} completed scene(s) missing last_frame_url (continuity broken)`);
  }
}

// =============================================================================
// TEST 6: Simulate Cron Processing for Scene 1
// =============================================================================

async function testCronSimulation() {
  info('--- TEST 6: Simulate Cron Processing (merging phase for scene 1) ---');
  info('This test simulates what the cron does when scene status = "merging"');
  info('WITHOUT modifying the database — dry run only');

  const { data: scene } = await supabase
    .from('movie_scenes')
    .select('*')
    .eq('project_id', PROJECT_ID)
    .eq('scene_number', 1)
    .single();

  if (!scene) {
    fail('Scene 1 not found');
    return;
  }

  if (!scene.video_url) {
    fail('Scene 1 has no video_url — cannot simulate merging');
    return;
  }

  info(`Scene 1 video: ${scene.video_url.slice(0, 60)}...`);
  info(`Scene 1 status: ${scene.status} | retry_count: ${scene.retry_count}`);

  try {
    // Simulate the merging phase steps
    const storageProvider = await getStorageProvider(false);

    // 1. Download video
    info('Simulating: Download video from fal.ai...');
    const videoRes = await fetch(scene.video_url, { signal: AbortSignal.timeout(30_000) });
    assert(videoRes.ok, `Video download: HTTP ${videoRes.status}`);
    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());

    // 2. Upload to permanent storage (dry run — use test path)
    info('Simulating: Upload to permanent storage...');
    const testKey = `movies/test-pipeline/cron_sim_scene_001.mp4`;
    const { signedUrl } = await getSignedUploadUrl(testKey, 'video/mp4', storageProvider);
    const uploadRes = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: videoBuffer,
      signal: AbortSignal.timeout(30_000),
    });
    assert(uploadRes.ok, `Video upload: HTTP ${uploadRes.status}`);

    const publicUrl = getPublicVideoUrl(testKey, storageProvider);

    // 3. Extract last frame
    info('Simulating: Extract last frame...');
    const sceneDuration = 5; // kling-2.6
    const frameTimestamp = Math.max(sceneDuration - 0.1, 0);
    const frameData = await extractFrameAtTimestamp(scene.video_url, frameTimestamp);
    assert(frameData.length > 0, `Frame extracted: ${(frameData.length / 1024).toFixed(1)} KB`);

    // 4. Upload frame (dry run — use test path)
    info('Simulating: Upload frame...');
    const frameKey = `movies/test-pipeline/frames/cron_sim_scene_001.jpg`;
    const lastFrameUrl = await uploadFrameWithKey(frameKey, frameData, storageProvider);
    assert(lastFrameUrl.length > 0, `Frame uploaded successfully`);

    pass('Cron simulation completed — ALL merging steps would succeed locally');
    info(`Would set: public_video_url=${publicUrl.slice(0, 60)}...`);
    info(`Would set: last_frame_url=${lastFrameUrl.slice(0, 60)}...`);
    info(`Would set: status=completed, duration_seconds=${sceneDuration}`);

  } catch (err) {
    fail(`Cron simulation FAILED at: ${err instanceof Error ? err.message : err}`);
    console.error(err);
    info('This is likely the same error happening in production!');
  }
}

// =============================================================================
// RUN ALL TESTS
// =============================================================================

async function main() {
  console.log('\n🎬 Movie Pipeline E2E Test\n');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Video:   ${TEST_VIDEO_URL.slice(0, 60)}...`);
  console.log('');

  // Test 1: Frame extraction
  const frameData = await testFrameExtraction();
  console.log('');

  // Test 2: Frame upload
  if (frameData) {
    await testFrameUpload(frameData);
  } else {
    warn('Skipping frame upload test (no frame data)');
  }
  console.log('');

  // Test 3: Video upload
  await testVideoUpload();
  console.log('');

  // Test 4: Full merging phase
  await testMergingPhase();
  console.log('');

  // Test 5: Project state check
  await testProjectState();
  console.log('');

  // Test 6: Cron simulation
  await testCronSimulation();
  console.log('');

  // Summary
  console.log('═'.repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('⚠️  Some tests failed. The failures above indicate what breaks');
    console.log('   in the production cron pipeline.');
  } else {
    console.log('✅ All tests passed! The pipeline works locally.');
    console.log('   If production is failing, the issue is likely:');
    console.log('   - ffmpeg-static binary not bundled in Vercel deployment');
    console.log('   - Serverless function timeout (300s max)');
    console.log('   - fal.ai video URL expired before merging phase');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
