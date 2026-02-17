// app/api/upload/route.ts
// CRITICAL FIX 3: Complete Video Storage Implementation
// Supports: Supabase Storage, Cloudinary, AWS S3

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Choose your storage provider
// Change to 'r2' when ready to switch to Cloudflare R2
const STORAGE_PROVIDER: 'supabase' | 'cloudinary' | 's3' | 'r2' = 'supabase';

// ============================================================================
// CONFIGURATION
// ============================================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Cloudinary config (if using Cloudinary)
const CLOUDINARY_CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const _CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const _CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'aimoviez';

// AWS S3 config (if using S3)
const _AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const _AWS_BUCKET = process.env.AWS_S3_BUCKET || 'aimoviez-videos';

// Cloudflare R2 config (S3-compatible, FREE egress!)
// See: /Dokumentacja/2026-01-23-cloudflare-r2-migration-guide.md
const R2_ENDPOINT = process.env.CLOUDFLARE_R2_ENDPOINT;
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || 'aimoviez-videos';
const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL;

// Upload constraints
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const _MAX_DURATION = 8.5; // 8 seconds + buffer
const ALLOWED_FORMATS = ['video/mp4', 'video/quicktime', 'video/webm', 'video/mov'];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateFileId(): string {
  return `clip_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function validateFile(file: File): { valid: boolean; error?: string } {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` };
  }

  // Check file type
  if (!ALLOWED_FORMATS.includes(file.type)) {
    return { valid: false, error: 'Invalid file format. Allowed: MP4, MOV, WebM' };
  }

  return { valid: true };
}

// ============================================================================
// STORAGE PROVIDERS
// ============================================================================

// 1. SUPABASE STORAGE
async function uploadToSupabase(file: File, fileId: string): Promise<{ url: string; error?: string }> {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Create bucket if it doesn't exist
    const { data: buckets } = await supabase.storage.listBuckets();
    const bucketExists = buckets?.some(b => b.name === 'clips');
    
    if (!bucketExists) {
      await supabase.storage.createBucket('clips', {
        public: true,
        fileSizeLimit: MAX_FILE_SIZE,
        allowedMimeTypes: ALLOWED_FORMATS,
      });
    }

    // Upload file
    const fileName = `${fileId}.${file.name.split('.').pop()}`;
    const { data: _data, error } = await supabase.storage
      .from('clips')
      .upload(fileName, file, {
        cacheControl: '86400',
        upsert: false,
      });

    if (error) {
      return { url: '', error: error.message };
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('clips')
      .getPublicUrl(fileName);

    return { url: publicUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { url: '', error: message };
  }
}

// 2. CLOUDINARY
async function uploadToCloudinary(file: File, fileId: string): Promise<{ url: string; error?: string }> {
  try {
    if (!CLOUDINARY_CLOUD_NAME) {
      return { url: '', error: 'Cloudinary not configured' };
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');
    const dataUri = `data:${file.type};base64,${base64}`;

    // Create upload signature (for signed uploads)
    const _timestamp = Math.round(Date.now() / 1000);
    const _params = {
      timestamp: _timestamp,
      public_id: fileId,
      upload_preset: CLOUDINARY_UPLOAD_PRESET,
    };

    // Upload to Cloudinary
    const formData = new FormData();
    formData.append('file', dataUri);
    formData.append('public_id', fileId);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('resource_type', 'video');
    formData.append('max_duration', '9'); // 9 seconds max

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
      {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60_000),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      return { url: '', error: `Cloudinary upload failed: ${error}` };
    }

    const data = await response.json();
    return { url: data.secure_url };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { url: '', error: message };
  }
}

// 3. AWS S3
async function uploadToS3(_file: File, _fileId: string): Promise<{ url: string; error?: string }> {
  try {
    // Note: You'll need to install @aws-sdk/client-s3
    // npm install @aws-sdk/client-s3
    
    // For now, returning a placeholder
    // Uncomment and implement when AWS SDK is installed
    
    /*
    import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
    
    const s3Client = new S3Client({
      region: AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    const fileName = `clips/${fileId}.${file.name.split('.').pop()}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const command = new PutObjectCommand({
      Bucket: AWS_BUCKET,
      Key: fileName,
      Body: buffer,
      ContentType: file.type,
      ACL: 'public-read',
    });

    await s3Client.send(command);
    
    const url = `https://${AWS_BUCKET}.s3.${AWS_REGION}.amazonaws.com/${fileName}`;
    return { url };
    */
    
    return { url: '', error: 'S3 upload not implemented. Install @aws-sdk/client-s3' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { url: '', error: message };
  }
}

// 4. CLOUDFLARE R2 (S3-compatible, FREE egress)
async function uploadToR2(file: File, fileId: string): Promise<{ url: string; error?: string }> {
  try {
    if (!R2_ENDPOINT || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_PUBLIC_URL) {
      return { url: '', error: 'Cloudflare R2 not configured. Set environment variables.' };
    }

    // R2 uses S3-compatible API
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

    const s3Client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY,
        secretAccessKey: R2_SECRET_KEY,
      },
    });

    const extension = file.name.split('.').pop() || 'mp4';
    const fileName = `clips/${fileId}.${extension}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: fileName,
      Body: buffer,
      ContentType: file.type,
    });

    await s3Client.send(command);

    // Return public CDN URL
    const url = `${R2_PUBLIC_URL}/${fileName}`;
    return { url };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[R2 Upload Error]', message);
    return { url: '', error: message };
  }
}

// ============================================================================
// MAIN UPLOAD HANDLER
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    // Parse form data
    const formData = await req.formData();
    const file = formData.get('video') as File;
    const slotId = formData.get('slotId') as string;
    const genre = formData.get('genre') as string;
    const title = formData.get('title') as string;
    const description = formData.get('description') as string;
    
    // Validate required fields
    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No video file provided' },
        { status: 400 }
      );
    }

    if (!slotId) {
      return NextResponse.json(
        { success: false, error: 'Slot ID is required' },
        { status: 400 }
      );
    }

    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    // Generate unique file ID
    const fileId = generateFileId();

    // Upload to selected provider
    let uploadResult: { url: string; error?: string };
    
    switch (STORAGE_PROVIDER) {
      case 'cloudinary':
        uploadResult = await uploadToCloudinary(file, fileId);
        break;
      case 's3':
        uploadResult = await uploadToS3(file, fileId);
        break;
      case 'r2':
        uploadResult = await uploadToR2(file, fileId);
        break;
      case 'supabase':
      default:
        uploadResult = await uploadToSupabase(file, fileId);
        break;
    }

    // Check for upload errors
    if (uploadResult.error || !uploadResult.url) {
      console.error('Upload error:', uploadResult.error);
      return NextResponse.json(
        { success: false, error: uploadResult.error || 'Upload failed' },
        { status: 500 }
      );
    }

    // Generate thumbnail URL (simplified - in production, generate actual thumbnail)
    const thumbnailUrl = uploadResult.url.replace(/\.(mp4|mov|webm)$/i, '_thumb.jpg');

    // Save clip metadata to database
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get user identifier (simplified - in production, use actual auth)
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';
    const userKey = crypto.createHash('sha256').update(ip + userAgent).digest('hex');
    
    // Parse slot position from slotId
    const slotPosition = parseInt(slotId.replace('slot-', ''), 10);

    // Insert clip into tournament_clips
    const { data: _clip, error: dbError } = await supabase
      .from('tournament_clips')
      .insert({
        id: fileId,
        slot_position: slotPosition,
        track_id: 'track-main',
        video_url: uploadResult.url,
        thumbnail_url: thumbnailUrl,
        username: `User${userKey.substring(0, 6)}`,
        avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userKey}`,
        genre: genre || 'COMEDY',
        vote_count: 0,
        weighted_score: 0,
        hype_score: 0,
        status: 'pending', // Requires admin approval
        user_id: userKey,
        title: title || `Clip for Slot ${slotPosition}`,
        description: description || '',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json(
        { success: false, error: 'Failed to save clip metadata' },
        { status: 500 }
      );
    }

    // Return success response
    return NextResponse.json({
      success: true,
      message: 'Upload successful! Your clip is pending approval.',
      data: {
        clipId: fileId,
        videoUrl: uploadResult.url,
        thumbnailUrl,
        slotPosition,
        status: 'pending',
      },
    });

  } catch (error) {
    console.error('[POST /api/upload] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[POST /api/upload] Error details:', message);
    return NextResponse.json(
      { success: false, error: 'Upload failed. Please try again.' },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET UPLOAD STATUS
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clipId = searchParams.get('clipId');
    
    if (!clipId) {
      return NextResponse.json(
        { success: false, error: 'Clip ID required' },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get clip status
    const { data: clip, error } = await supabase
      .from('tournament_clips')
      .select('id, status, video_url, thumbnail_url, vote_count, slot_position')
      .eq('id', clipId)
      .single();

    if (error || !clip) {
      return NextResponse.json(
        { success: false, error: 'Clip not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        clipId: clip.id,
        status: clip.status,
        videoUrl: clip.video_url,
        thumbnailUrl: clip.thumbnail_url,
        voteCount: clip.vote_count,
        slotPosition: clip.slot_position,
      },
    });

  } catch (error) {
    console.error('[GET /api/upload] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get upload status' },
      { status: 500 }
    );
  }
}

// ============================================================================
// SETUP INSTRUCTIONS
// ============================================================================

/*
SETUP GUIDE FOR VIDEO STORAGE:

Option 1: SUPABASE STORAGE (Easiest - Recommended for MVP)
===========================================================
1. No additional setup needed! Uses your existing Supabase account
2. Set STORAGE_PROVIDER = 'supabase' at the top of this file
3. That's it! Videos will upload to Supabase Storage

Option 2: CLOUDINARY (Best for video processing)
================================================
1. Create free account at: https://cloudinary.com
2. Go to Dashboard
3. Add to .env.local:
   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your-cloud-name
   CLOUDINARY_API_KEY=your-api-key
   CLOUDINARY_API_SECRET=your-api-secret
   CLOUDINARY_UPLOAD_PRESET=aimoviez
4. Create upload preset in Cloudinary:
   - Go to Settings â†’ Upload
   - Add upload preset
   - Name: aimoviez
   - Signing Mode: Unsigned
5. Set STORAGE_PROVIDER = 'cloudinary' at the top

Option 3: AWS S3 (Best for scale)
=================================
1. Install AWS SDK:
   npm install @aws-sdk/client-s3
2. Create S3 bucket in AWS Console
3. Add to .env.local:
   AWS_ACCESS_KEY_ID=your-key
   AWS_SECRET_ACCESS_KEY=your-secret
   AWS_REGION=us-east-1
   AWS_S3_BUCKET=aimoviez-videos
4. Set bucket permissions to public read
5. Uncomment the S3 code in uploadToS3 function
6. Set STORAGE_PROVIDER = 's3' at the top

Option 4: CLOUDFLARE R2 (Best for scale - FREE egress!)
========================================================
See full guide: /Dokumentacja/2026-01-23-cloudflare-r2-migration-guide.md

1. Create R2 bucket in Cloudflare Dashboard
2. Get API credentials (R2 → Manage API Tokens)
3. Set up custom domain for CDN (videos.yourdomain.com)
4. Add to .env.local:
   CLOUDFLARE_R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
   CLOUDFLARE_R2_ACCESS_KEY_ID=your-access-key
   CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-secret-key
   CLOUDFLARE_R2_BUCKET=aimoviez-videos
   CLOUDFLARE_R2_PUBLIC_URL=https://videos.yourdomain.com
5. Set STORAGE_PROVIDER = 'r2' at the top

TESTING:
========
curl -X POST http://localhost:3000/api/upload \
  -F "video=@test-video.mp4" \
  -F "slotId=slot-1" \
  -F "genre=ACTION" \
  -F "title=Test Clip"
*/