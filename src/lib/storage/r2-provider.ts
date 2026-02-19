// lib/storage/r2-provider.ts
// ============================================================================
// CLOUDFLARE R2 STORAGE PROVIDER
// S3-compatible storage with global CDN and free egress.
// Requires @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner.
// ============================================================================

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ============================================================================
// CLIENT
// ============================================================================

let client: S3Client | null = null;

function getR2Client(): S3Client | null {
  if (client) return client;

  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) return null;

  client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

function getBucket(): string {
  return process.env.CLOUDFLARE_R2_BUCKET || 'aimoviez-videos';
}

function getPublicUrl(): string {
  return process.env.CLOUDFLARE_R2_PUBLIC_URL || '';
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Check if R2 is configured (env vars present).
 */
export function isR2Configured(): boolean {
  return !!(
    process.env.CLOUDFLARE_R2_ENDPOINT &&
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY &&
    process.env.CLOUDFLARE_R2_BUCKET &&
    process.env.CLOUDFLARE_R2_PUBLIC_URL
  );
}

/**
 * Upload a video buffer to R2.
 * Returns the public CDN URL.
 */
export async function uploadToR2(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const r2 = getR2Client();
  if (!r2) throw new Error('R2 client not configured');

  const key = `clips/${filename}`;

  await r2.send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  return `${getPublicUrl()}/${key}`;
}

/**
 * Get a presigned URL for direct browser upload to R2.
 * Returns the signed PUT URL (1 hour expiry).
 */
export async function getR2SignedUploadUrl(
  filename: string,
  contentType: string,
  keyPrefix: string = 'clips/'
): Promise<{ signedUrl: string; publicUrl: string; key: string }> {
  const r2 = getR2Client();
  if (!r2) throw new Error('R2 client not configured');

  const key = `${keyPrefix}${filename}`;

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });

  // FIX: Reduced expiry from 1 hour to 15 minutes for security
  const signedUrl = await getSignedUrl(r2, command, { expiresIn: 900 });
  const publicUrl = `${getPublicUrl()}/${key}`;

  return { signedUrl, publicUrl, key };
}

/**
 * Get the public CDN URL for a file.
 */
export function getR2PublicUrl(filename: string): string {
  return `${getPublicUrl()}/clips/${filename}`;
}

/**
 * Delete a file from R2.
 */
export async function deleteFromR2(filename: string): Promise<void> {
  const r2 = getR2Client();
  if (!r2) return;

  try {
    await r2.send(new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: `clips/${filename}`,
    }));
  } catch (err) {
    console.warn('[R2] Delete failed (non-fatal):', err);
  }
}
