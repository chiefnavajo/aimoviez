// app/api/upload/signed-url/route.ts
// ============================================================================
// SIGNED URL API - Returns a signed URL for direct upload to Supabase Storage
// This bypasses Vercel's 4.5MB body size limit while still requiring auth
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { rateLimit } from '@/lib/rate-limit';

// ============================================================================
// SUPABASE CLIENT (Service Role - can create signed URLs)
// ============================================================================

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

// ============================================================================
// POST - Get Signed Upload URL
// ============================================================================

export async function POST(request: NextRequest) {
  // Rate limit: 5 signed URLs per minute per user (prevents abuse)
  const rateLimitResponse = await rateLimit(request, 'upload');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Check authentication first
    const session = await getServerSession();
    if (!session?.user?.email) {
      console.error('[SIGNED-URL] Unauthorized: No session or email');
      return NextResponse.json({
        success: false,
        error: 'You must be logged in to upload clips.'
      }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { filename, contentType } = body;

    if (!filename) {
      return NextResponse.json({
        success: false,
        error: 'Filename is required'
      }, { status: 400 });
    }

    // Validate content type
    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (contentType && !validTypes.includes(contentType)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid video format. Use MP4, MOV, or WebM'
      }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // Generate unique filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    const ext = filename.split('.').pop()?.toLowerCase() || 'mp4';
    const uniqueFilename = `clip_${timestamp}_${random}.${ext}`;
    const storagePath = `clips/${uniqueFilename}`;

    // Try to create signed URL for 'videos' bucket first
    let bucketName = 'videos';
    let signedUrl: string | null = null;

    const { data: signedData, error: signedError } = await supabase.storage
      .from('videos')
      .createSignedUploadUrl(storagePath);

    if (signedError) {
      // Try 'clips' bucket as fallback
      if (signedError.message?.includes('not found') || signedError.message?.includes('Bucket')) {
        bucketName = 'clips';
        const { data: clipsData, error: clipsError } = await supabase.storage
          .from('clips')
          .createSignedUploadUrl(storagePath);

        if (clipsError) {
          console.error('[SIGNED-URL] Clips bucket error:', clipsError);
          return NextResponse.json({
            success: false,
            error: 'Failed to create upload URL. Storage bucket not found.'
          }, { status: 500 });
        }

        signedUrl = clipsData.signedUrl;
      } else {
        console.error('[SIGNED-URL] Error:', signedError);
        return NextResponse.json({
          success: false,
          error: 'Failed to create upload URL: ' + signedError.message
        }, { status: 500 });
      }
    } else {
      signedUrl = signedData.signedUrl;
    }

    // Get the public URL that will be used after upload
    const { data: urlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(storagePath);

    return NextResponse.json({
      success: true,
      signedUrl,
      storagePath,
      bucketName,
      publicUrl: urlData.publicUrl,
      expiresIn: 3600, // 1 hour
    });

  } catch (error) {
    console.error('[SIGNED-URL] Unexpected error:', error);
    // Don't expose internal error details to client
    return NextResponse.json({
      success: false,
      error: 'Failed to create upload URL. Please try again.'
    }, { status: 500 });
  }
}
