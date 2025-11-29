// app/api/upload/route.ts
// ============================================================================
// UPLOAD API - Handles video uploads to Supabase Storage
// Requires authentication - only logged-in users can upload
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import crypto from 'crypto';

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
  const random = Math.random().toString(36).substring(2, 10);
  const ext = originalName.split('.').pop()?.toLowerCase() || 'mp4';
  return `clip_${timestamp}_${random}.${ext}`;
}

// ============================================================================
// POST - Upload Video
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check authentication first
    const session = await getServerSession();
    if (!session?.user?.email) {
      console.error('[UPLOAD] Unauthorized: No session or email');
      return NextResponse.json({
        success: false,
        error: 'You must be logged in to upload clips.'
      }, { status: 401 });
    }

    console.log('[UPLOAD] Authenticated user:', session.user.email);

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

    // Validate file type
    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (!validTypes.includes(video.type)) {
      return NextResponse.json({ 
        success: false,
        error: 'Invalid format. Use MP4, MOV, or WebM' 
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

    // Get current voting slot
    const { data: votingSlot, error: slotError } = await supabase
      .from('story_slots')
      .select('id, slot_position')
      .eq('season_id', season.id)
      .eq('status', 'voting')
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
      console.log('[UPLOAD] clips bucket not found, trying videos bucket');
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
        errorMessage += uploadError.message || 'Storage error. Please try again.';
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
    
    console.log('[UPLOAD] File uploaded successfully:', {
      path: uploadData.path,
      size: video.size,
      type: video.type
    });

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
      console.log('[UPLOAD] Found user profile:', { userId, uploaderUsername });
    } else {
      console.log('[UPLOAD] No user profile found for email:', userEmail);
    }

    // Insert into tournament_clips
    const insertData: Record<string, unknown> = {
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
        console.log('[UPLOAD] Cleaned up uploaded file due to DB error');
      } catch (cleanupError) {
        console.error('[UPLOAD] Failed to cleanup file:', cleanupError);
      }
      
      return NextResponse.json({ 
        success: false,
        error: `Failed to save clip: ${clipError.message || 'Database error'}. Please try again.` 
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

    console.log('[UPLOAD] Clip successfully saved to database:', {
      clipId: clipData.id,
      slotPosition,
      status: 'pending',
      videoUrl,
      title,
      storagePath: uploadData.path
    });

    // Verify the clip exists in database by querying it back
    const { data: verifyClip, error: verifyError } = await supabase
      .from('tournament_clips')
      .select('id, status, video_url, title')
      .eq('id', clipData.id)
      .single();

    if (verifyError || !verifyClip) {
      console.error('[UPLOAD] Verification failed - clip not found after insert:', verifyError);
      return NextResponse.json({ 
        success: false,
        error: 'Upload completed but verification failed. Please contact support with clip ID: ' + clipData.id
      }, { status: 500 });
    }

    console.log('[UPLOAD] Verification successful - clip confirmed in database:', verifyClip);

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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[UPLOAD] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json({ 
      success: false,
      error: `Upload failed: ${errorMessage}. Please try again.` 
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
      .select('*')
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
