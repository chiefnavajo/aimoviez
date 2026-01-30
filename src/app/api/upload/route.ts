// app/api/upload/route.ts
// ============================================================================
// UPLOAD API - Handles video uploads to Supabase Storage
// Requires authentication - only logged-in users can upload
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import { rateLimit } from '@/lib/rate-limit';

// ============================================================================
// SUPABASE CLIENT
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
// HELPERS
// ============================================================================

function getVoterKey(request: NextRequest): string {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim() 
    || request.headers.get('x-real-ip') 
    || '0.0.0.0';
  const ua = request.headers.get('user-agent') || 'unknown';
  const raw = `${ip}|${ua}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `device_${hash}`;
}

function generateFilename(originalName: string): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const ext = originalName.split('.').pop()?.toLowerCase() || 'mp4';
  return `clip_${timestamp}_${random}.${ext}`;
}

// ============================================================================
// FILE SIGNATURE VERIFICATION (Magic Bytes)
// Prevents malicious files with spoofed MIME types
// ============================================================================

interface FileSignature {
  mime: string;
  signatures: number[][];
  offset?: number;
}

const VIDEO_SIGNATURES: FileSignature[] = [
  // MP4 / M4V / MOV (ftyp box at start)
  {
    mime: 'video/mp4',
    signatures: [
      [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70], // ftyp at offset 0
      [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], // ftyp at offset 0
      [0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70], // ftyp at offset 0
      [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], // ftyp at offset 0
    ],
  },
  // Also check for 'ftyp' at offset 4 (common for some encoders)
  {
    mime: 'video/mp4',
    signatures: [[0x66, 0x74, 0x79, 0x70]], // 'ftyp'
    offset: 4,
  },
  // QuickTime MOV
  {
    mime: 'video/quicktime',
    signatures: [
      [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74], // ftypqt
    ],
  },
  // WebM (EBML header)
  {
    mime: 'video/webm',
    signatures: [[0x1A, 0x45, 0xDF, 0xA3]],
  },
];

async function verifyVideoSignature(file: File): Promise<{ valid: boolean; detectedType?: string; error?: string }> {
  try {
    // Read first 32 bytes for signature check
    const buffer = await file.slice(0, 32).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    for (const sig of VIDEO_SIGNATURES) {
      const offset = sig.offset || 0;
      for (const signature of sig.signatures) {
        let match = true;
        for (let i = 0; i < signature.length; i++) {
          if (bytes[offset + i] !== signature[i]) {
            match = false;
            break;
          }
        }
        if (match) {
          return { valid: true, detectedType: sig.mime };
        }
      }
    }

    // Check for 'ftyp' anywhere in first 12 bytes (handles various MP4 variants)
    const ftypStr = String.fromCharCode(...bytes.slice(0, 12));
    if (ftypStr.includes('ftyp')) {
      return { valid: true, detectedType: 'video/mp4' };
    }

    return {
      valid: false,
      error: 'File does not appear to be a valid video file. Please upload MP4, MOV, or WebM format.',
    };
  } catch (err) {
    console.error('[verifyVideoSignature] Error:', err);
    return { valid: false, error: 'Failed to verify file type' };
  }
}

/**
 * POLYGLOT DETECTION: Check for embedded dangerous content
 * Polyglot files can have valid video headers but contain malicious payloads
 */
async function detectPolyglot(file: File): Promise<{ safe: boolean; reason?: string }> {
  try {
    // Check multiple sections of the file for suspicious patterns
    const chunkSize = 4096;
    const checkPoints = [
      0,                                      // Start
      Math.floor(file.size / 4),             // 25%
      Math.floor(file.size / 2),             // 50%
      Math.floor((file.size * 3) / 4),       // 75%
      Math.max(0, file.size - chunkSize),    // End
    ];

    // Dangerous patterns to detect
    const dangerousPatterns = [
      // HTML/JavaScript injection
      /<script[\s>]/i,
      /<iframe[\s>]/i,
      /javascript:/i,
      /on\w+\s*=/i,  // onclick=, onerror=, etc.
      // PHP tags
      /<\?php/i,
      /<\?=/,
      // Server-side includes
      /<!--\s*#\s*(include|exec|echo)/i,
      // Shell commands
      /\x00\/bin\/sh/,
      /\x00\/bin\/bash/,
      // Executable headers (shouldn't be in videos)
      /MZ\x90\x00/,  // Windows PE
      /\x7fELF/,     // Linux ELF
    ];

    for (const offset of checkPoints) {
      if (offset >= file.size) continue;

      const end = Math.min(offset + chunkSize, file.size);
      const chunk = await file.slice(offset, end).arrayBuffer();
      const text = new TextDecoder('utf-8', { fatal: false }).decode(chunk);

      for (const pattern of dangerousPatterns) {
        if (pattern.test(text)) {
          return {
            safe: false,
            reason: 'File contains potentially dangerous content',
          };
        }
      }
    }

    return { safe: true };
  } catch (err) {
    console.error('[detectPolyglot] Error:', err);
    // SECURITY: On error, fail closed - reject the file
    return { safe: false, reason: 'Security check failed' };
  }
}

// ============================================================================
// POST - Upload Video
// ============================================================================

export async function POST(request: NextRequest) {
  // Rate limit: 5 uploads per minute per user (prevents DoS)
  const rateLimitResponse = await rateLimit(request, 'upload');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Check authentication first
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      console.error('[UPLOAD] Unauthorized: No session or email');
      return NextResponse.json({
        success: false,
        error: 'You must be logged in to upload clips.'
      }, { status: 401 });
    }

    // Check environment variables
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[UPLOAD] Missing Supabase environment variables');
      return NextResponse.json({
        success: false,
        error: 'Server configuration error. Please contact support.'
      }, { status: 500 });
    }

    const supabase = getSupabaseClient();
    const voterKey = getVoterKey(request);
    const userEmail = session.user.email;

    // Parse form data
    const formData = await request.formData();
    const video = formData.get('video') as File | null;
    const genre = formData.get('genre') as string;
    const title = formData.get('title') as string;
    const description = formData.get('description') as string || '';

    // Validate required fields
    if (!video) {
      return NextResponse.json({ success: false, error: 'No video file provided' }, { status: 400 });
    }
    if (!genre) {
      return NextResponse.json({ success: false, error: 'Genre is required' }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ success: false, error: 'Title is required' }, { status: 400 });
    }

    // Validate file size (50MB max - Supabase free tier limit)
    // For 8-second videos, 50MB is more than sufficient
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (video.size > MAX_SIZE) {
      return NextResponse.json({ 
        success: false,
        error: `File too large (${(video.size / 1024 / 1024).toFixed(1)}MB). Maximum size: 50MB. For 8-second clips, try compressing your video.` 
      }, { status: 400 });
    }

    // Validate file type (client-reported MIME)
    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (!validTypes.includes(video.type)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid format. Use MP4, MOV, or WebM'
      }, { status: 400 });
    }

    // SECURITY: Verify file signature (magic bytes) to prevent spoofed uploads
    const signatureCheck = await verifyVideoSignature(video);
    if (!signatureCheck.valid) {
      console.warn('[UPLOAD] File signature verification failed:', {
        reportedType: video.type,
        filename: video.name,
        error: signatureCheck.error,
      });
      return NextResponse.json({
        success: false,
        error: signatureCheck.error || 'Invalid video file',
      }, { status: 400 });
    }

    // SECURITY: Check for polyglot files (valid video headers with embedded malicious content)
    const polyglotCheck = await detectPolyglot(video);
    if (!polyglotCheck.safe) {
      console.warn('[UPLOAD] Polyglot detection triggered:', {
        reportedType: video.type,
        filename: video.name,
        reason: polyglotCheck.reason,
      });
      return NextResponse.json({
        success: false,
        error: 'File rejected for security reasons',
      }, { status: 400 });
    }

    // Get active season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('id, total_slots')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (seasonError || !season) {
      console.error('[UPLOAD] No active season:', seasonError);
      return NextResponse.json({ 
        success: false,
        error: 'No active season. Uploads are currently closed.' 
      }, { status: 400 });
    }

    // Get current voting slot (accept both 'voting' and 'waiting_for_clips' statuses)
    const { data: votingSlot, error: slotError } = await supabase
      .from('story_slots')
      .select('id, slot_position, status')
      .eq('season_id', season.id)
      .in('status', ['voting', 'waiting_for_clips'])
      .order('slot_position', { ascending: true })
      .limit(1)
      .single();

    // Fail if no active voting slot (don't silently assign to wrong slot)
    if (slotError || !votingSlot) {
      console.error('[UPLOAD] No active voting slot:', slotError);
      return NextResponse.json({
        success: false,
        error: 'No active voting slot. Voting is currently closed for this round.'
      }, { status: 400 });
    }

    // Log if slot is waiting for clips (approval will transition it to voting)
    if (votingSlot.status === 'waiting_for_clips') {
      console.log(`[UPLOAD] Slot ${votingSlot.slot_position} is waiting for clips - upload will be assigned here`);
    }

    const slotPosition = votingSlot.slot_position;

    // Generate unique filename
    const filename = generateFilename(video.name);
    const storagePath = `clips/${filename}`;

    // Convert to buffer
    const arrayBuffer = await video.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Upload to Supabase Storage - try 'clips' bucket first (user mentioned files are there)
    // Then fallback to 'videos' if needed
    let bucketName = 'clips';
    let uploadData, uploadError;
    
    ({ data: uploadData, error: uploadError } = await supabase.storage
      .from('clips')
      .upload(storagePath, buffer, {
        contentType: video.type,
        upsert: false,
      }));
    
    // If 'clips' bucket doesn't exist, try 'videos'
    if (uploadError && (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('not found'))) {
      bucketName = 'videos';
      ({ data: uploadData, error: uploadError } = await supabase.storage
        .from('videos')
        .upload(storagePath, buffer, {
          contentType: video.type,
          upsert: false,
        }));
    }

    if (uploadError) {
      console.error('[UPLOAD] Storage upload error:', uploadError);
      console.error('[UPLOAD] Error details:', JSON.stringify(uploadError, null, 2));
      
      // Check for specific error types
      let errorMessage = 'Failed to upload video. ';
      
      if (uploadError.message?.includes('maximum allowed size') || uploadError.message?.includes('exceeded')) {
        errorMessage = `File too large for Supabase Storage. Your file is ${(video.size / 1024 / 1024).toFixed(1)}MB. `;
        errorMessage += 'Please compress your video or reduce the file size. For 8-second clips, aim for under 20MB.';
      } else if (uploadError.message?.includes('bucket') || uploadError.message?.includes('not found')) {
        errorMessage = 'Storage bucket not found. Please ensure the "videos" bucket exists in Supabase Storage.';
      } else {
        errorMessage += 'Storage error. Please try again.';
      }
      
      return NextResponse.json({ 
        success: false,
        error: errorMessage
      }, { status: 500 });
    }

    // Get public URL from the bucket we used
    const { data: urlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(storagePath);

    const videoUrl = urlData.publicUrl;
    
    // Verify upload succeeded
    if (!uploadData?.path) {
      console.error('[UPLOAD] Upload data missing path:', uploadData);
      return NextResponse.json({ 
        success: false,
        error: 'Upload verification failed. File may not have been saved.' 
      }, { status: 500 });
    }
    
    // Look up user profile to get their username
    let uploaderUsername = `creator_${voterKey.slice(-8)}`;
    let uploaderAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${voterKey}`;
    let userId: string | null = null;

    const { data: userProfile } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .eq('email', userEmail)
      .single();

    if (userProfile) {
      userId = userProfile.id;
      uploaderUsername = userProfile.username || uploaderUsername;
      uploaderAvatar = userProfile.avatar_url || uploaderAvatar;
    }

    // Insert into tournament_clips
    const insertData: Record<string, unknown> = {
      season_id: season.id,  // Link to active season
      slot_position: slotPosition,
      track_id: 'track-main',
      video_url: videoUrl,
      thumbnail_url: videoUrl, // Use video URL as thumbnail for now
      username: uploaderUsername,
      avatar_url: uploaderAvatar,
      genre: genre.toUpperCase(),
      title: title,
      description: description,
      vote_count: 0,
      weighted_score: 0,
      hype_score: 0,
      status: 'pending',
      uploader_key: voterKey,
      created_at: new Date().toISOString(),
    };

    // Add user_id if we have one (column may not exist in all DBs)
    if (userId) {
      insertData.user_id = userId;
    }

    const { data: clipData, error: clipError } = await supabase
      .from('tournament_clips')
      .insert(insertData)
      .select()
      .single();

    if (clipError) {
      console.error('[UPLOAD] Database insert error:', clipError);
      console.error('[UPLOAD] Error details:', JSON.stringify(clipError, null, 2));
      console.error('[UPLOAD] Attempted insert data:', {
        slot_position: slotPosition,
        track_id: 'track-main',
        video_url: videoUrl,
        genre: genre.toUpperCase(),
        title: title,
        status: 'pending'
      });
      
      // Clean up uploaded file on DB error
      try {
        await supabase.storage.from(bucketName).remove([storagePath]);
      } catch {
        // Cleanup failed, but we still need to return the error
      }
      
      return NextResponse.json({
        success: false,
        error: 'Failed to save clip. Please try again.'
      }, { status: 500 });
    }

    // Verify clip was actually inserted
    if (!clipData || !clipData.id) {
      console.error('[UPLOAD] Clip data missing after insert:', clipData);
      return NextResponse.json({ 
        success: false,
        error: 'Clip was uploaded but database record was not created. Please contact support.' 
      }, { status: 500 });
    }

    // Verify the clip exists in database by querying it back
    const { data: verifyClip, error: verifyError } = await supabase
      .from('tournament_clips')
      .select('id, status, video_url, title')
      .eq('id', clipData.id)
      .single();

    if (verifyError || !verifyClip) {
      return NextResponse.json({
        success: false,
        error: 'Upload completed but verification failed. Please contact support with clip ID: ' + clipData.id
      }, { status: 500 });
    }

    // Success response
    return NextResponse.json({
      success: true,
      clip: {
        id: clipData.id,
        video_url: videoUrl,
        slot_position: slotPosition,
        status: 'pending',
        genre: genre,
        title: title,
      },
      message: 'Upload successful! Your clip is pending review and will appear after admin approval.',
      note: 'Your clip has been saved. It will be visible in the voting arena once approved by an admin.',
    });

  } catch (error) {
    console.error('[UPLOAD] Unexpected error:', error);
    // Log stack trace for debugging but don't expose to client
    if (error instanceof Error && error.stack) {
      console.error('[UPLOAD] Error stack:', error.stack);
    }
    // Don't expose internal error details to client
    return NextResponse.json({
      success: false,
      error: 'Upload failed. Please try again.'
    }, { status: 500 });
  }
}

// ============================================================================
// GET - Check Upload Status
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clipId = searchParams.get('clipId');
    
    if (!clipId) {
      return NextResponse.json(
        { error: 'Clip ID required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    
    const { data: clip, error } = await supabase
      .from('tournament_clips')
      .select('id, status, video_url, vote_count')
      .eq('id', clipId)
      .single();

    if (error || !clip) {
      return NextResponse.json(
        { error: 'Clip not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      clip: {
        id: clip.id,
        status: clip.status,
        video_url: clip.video_url,
        vote_count: clip.vote_count,
      },
    });

  } catch (error) {
    console.error('GET upload error:', error);
    return NextResponse.json(
      { error: 'Failed to get upload status' },
      { status: 500 }
    );
  }
}
