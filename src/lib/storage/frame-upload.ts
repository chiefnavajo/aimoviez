// lib/storage/frame-upload.ts
// ============================================================================
// FRAME UPLOAD HELPER
// Uploads extracted JPEG frames to Supabase or R2 storage.
// ============================================================================

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import type { StorageProvider } from './index';

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
    return uploadFrameToR2(filename, jpegBuffer);
  }
  return uploadFrameToSupabase(filename, jpegBuffer);
}

// ============================================================================
// R2
// ============================================================================

function uploadFrameToR2(filename: string, buffer: Uint8Array): Promise<string> {
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

  const key = `frames/${filename}`;

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

async function uploadFrameToSupabase(
  filename: string,
  buffer: Uint8Array
): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables for frame upload');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const filePath = `frames/${filename}`;

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
