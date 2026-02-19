// app/api/ai/characters/upload-url/route.ts
// Get a signed URL for uploading a user character image

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { getStorageProvider, getSignedUploadUrl } from '@/lib/storage';
import crypto from 'crypto';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * POST /api/ai/characters/upload-url
 * Returns a signed URL for direct browser upload of a character image.
 */
export async function POST(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'upload');
  if (rateLimitResponse) return rateLimitResponse;
  const csrfError = await requireCsrf(request);
  if (csrfError) return csrfError;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { filename, contentType } = body;

    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ success: false, error: 'Filename is required' }, { status: 400 });
    }
    if (!contentType || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid image format. Use JPEG, PNG, or WebP' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // Check feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'user_characters')
      .maybeSingle();

    if (!flag?.enabled) {
      return NextResponse.json(
        { success: false, error: 'User character uploads are not currently available' },
        { status: 403 }
      );
    }

    // Get user ID
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Generate unique filename
    const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
    const uniqueFilename = `${user.id}/${crypto.randomUUID()}.${ext}`;

    // Check storage provider
    const { data: r2Flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'r2_storage')
      .maybeSingle();

    const provider = await getStorageProvider(r2Flag?.enabled ?? false);

    const result = await getSignedUploadUrl(uniqueFilename, contentType, provider, 'user-characters/');

    return NextResponse.json({
      success: true,
      signedUrl: result.signedUrl,
      publicUrl: result.publicUrl,
      storageKey: result.key,
    });
  } catch (err) {
    console.error('[POST /api/ai/characters/upload-url] error:', err);
    return NextResponse.json({ success: false, error: 'Failed to create upload URL' }, { status: 500 });
  }
}
