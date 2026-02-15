// lib/storage/frame-upload.ts
// ============================================================================
// FRAME UPLOAD HELPER
// Uploads extracted JPEG frames to Supabase or R2 storage.
// ============================================================================

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import type { StorageProvider } from './index';

const execFileAsync = promisify(execFile);

/**
 * Upload a JPEG frame buffer to the active storage provider.
 * Stores under `frames/{clipId}.jpg` key.
 * Returns the public URL of the uploaded frame.
 */
export async function uploadFrame(
  clipId: string,
  jpegBuffer: Uint8Array,
  provider: StorageProvider
): Promise<string> {
  const filename = `${clipId}.jpg`;

  if (provider === 'r2') {
    return uploadToR2(`frames/${filename}`, jpegBuffer);
  }
  return uploadToSupabase(`frames/${filename}`, jpegBuffer);
}

/**
 * Upload a JPEG frame buffer using an exact storage key (no path/extension modification).
 * Used by movie pipeline where the caller controls the full storage path.
 */
export async function uploadFrameWithKey(
  storageKey: string,
  jpegBuffer: Uint8Array,
  provider: StorageProvider
): Promise<string> {
  if (provider === 'r2') {
    return uploadToR2(storageKey, jpegBuffer);
  }
  return uploadToSupabase(storageKey, jpegBuffer);
}

/**
 * Upload a pinned character frame to storage.
 * Stores under `pinned/{seasonId}/{elementIndex}_{suffix}.jpg`.
 */
export async function uploadPinnedFrame(
  seasonId: string,
  elementIndex: number,
  suffix: string,
  jpegBuffer: Uint8Array,
  provider: StorageProvider
): Promise<string> {
  const key = `pinned/${seasonId}/${elementIndex}_${suffix}.jpg`;

  if (provider === 'r2') {
    return uploadToR2(key, jpegBuffer);
  }
  return uploadToSupabase(key, jpegBuffer);
}

/**
 * Extract a frame at an arbitrary timestamp from a video URL.
 * Downloads the video, runs ffmpeg, returns the JPEG buffer.
 */
export async function extractFrameAtTimestamp(
  videoUrl: string,
  timestampSeconds: number
): Promise<Uint8Array> {
  const id = crypto.randomUUID();
  const inputPath = path.join(tmpdir(), `pin_input_${id}.mp4`);
  const outputPath = path.join(tmpdir(), `pin_output_${id}.jpg`);

  try {
    // Download video
    const videoRes = await fetch(videoUrl, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!videoRes.ok) {
      throw new Error(`Failed to fetch video: ${videoRes.status}`);
    }

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    await writeFile(inputPath, videoBuffer);

    // Get ffmpeg binary
    const ffmpegPath = (await import('ffmpeg-static')).default;
    if (!ffmpegPath) {
      throw new Error('ffmpeg binary not found');
    }

    // Extract frame at specified timestamp
    await execFileAsync(ffmpegPath, [
      '-ss', String(timestampSeconds),
      '-i', inputPath,
      '-frames:v', '1',
      '-q:v', '2',
      '-y',
      outputPath,
    ]);

    const frameData = new Uint8Array(await readFile(outputPath));

    if (frameData.length === 0) {
      throw new Error('Frame extraction produced empty output');
    }

    return frameData;
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

// ============================================================================
// R2
// ============================================================================

function uploadToR2(key: string, buffer: Uint8Array): Promise<string> {
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET || 'aimoviez-videos';
  const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;

  if (!endpoint || !accessKeyId || !secretAccessKey || !publicUrl) {
    throw new Error('R2 not configured for frame upload (missing endpoint, credentials, or public URL)');
  }

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return client
    .send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      })
    )
    .then(() => `${publicUrl}/${key}`);
}

// ============================================================================
// SUPABASE
// ============================================================================

async function uploadToSupabase(
  filePath: string,
  buffer: Uint8Array
): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables for frame upload');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { error } = await supabase.storage
    .from('clips')
    .upload(filePath, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '31536000',
    });

  if (error) {
    throw new Error(`Supabase frame upload failed: ${error.message}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/clips/${filePath}`;
}
