// lib/storage/index.ts
// ============================================================================
// STORAGE PROVIDER FACTORY
// Returns Supabase or R2 based on r2_storage feature flag + env vars.
// When R2 is not configured, always falls back to Supabase.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { isR2Configured, getR2SignedUploadUrl, getR2PublicUrl } from './r2-provider';

// ============================================================================
// TYPES
// ============================================================================

export type StorageProvider = 'supabase' | 'r2';

export interface SignedUrlResult {
  provider: StorageProvider;
  signedUrl: string;
  publicUrl: string;
  key: string;
}

// ============================================================================
// PROVIDER DETECTION
// ============================================================================

/**
 * Determine which storage provider to use.
 * R2 requires both the feature flag AND env vars to be configured.
 * Returns 'supabase' as fallback.
 */
export async function getStorageProvider(
  r2FlagEnabled: boolean = false
): Promise<StorageProvider> {
  if (r2FlagEnabled && isR2Configured()) {
    return 'r2';
  }
  return 'supabase';
}

// ============================================================================
// SIGNED URL GENERATION
// ============================================================================

/**
 * Get a signed upload URL from the active provider.
 */
export async function getSignedUploadUrl(
  filename: string,
  contentType: string,
  provider: StorageProvider
): Promise<SignedUrlResult> {
  if (provider === 'r2') {
    const result = await getR2SignedUploadUrl(filename, contentType);
    return {
      provider: 'r2',
      signedUrl: result.signedUrl,
      publicUrl: result.publicUrl,
      key: result.key,
    };
  }

  // Supabase signed URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const filePath = filename;

  const { data, error } = await supabase.storage
    .from('clips')
    .createSignedUploadUrl(filePath);

  if (error || !data) {
    throw new Error(`Supabase signed URL failed: ${error?.message || 'Unknown error'}`);
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/clips/${filePath}`;

  return {
    provider: 'supabase',
    signedUrl: data.signedUrl,
    publicUrl,
    key: filePath,
  };
}

// ============================================================================
// PUBLIC URL
// ============================================================================

/**
 * Get the public URL for a stored file.
 */
export function getPublicVideoUrl(
  filename: string,
  provider: StorageProvider
): string {
  if (provider === 'r2') {
    return getR2PublicUrl(filename);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  return `${supabaseUrl}/storage/v1/object/public/clips/${filename}`;
}
