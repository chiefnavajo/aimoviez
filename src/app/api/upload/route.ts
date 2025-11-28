// app/api/upload/route.ts
// ============================================================================
// UPLOAD API - Handles video uploads to Supabase Storage
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
    const supabase = getSupabaseClient();
    const voterKey = getVoterKey(request);

    // Parse form data
    const formData = await request.formData();
    const video = formData.get('video') as File | null;
    const genre = formData.get('genre') as string;
    const title = formData.get('title') as string;
    const description = formData.get('description') as string || '';

    // Validate required fields
    if (!video) {
      return NextResponse.json({ error: 'No video file provided' }, { status: 400 });
    }
    if (!genre) {
      return NextResponse.json({ error: 'Genre is required' }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // Validate file size (100MB max)
    const MAX_SIZE = 100 * 1024 * 1024;
    if (video.size > MAX_SIZE) {
      return NextResponse.json({ 
        error: `File too large (${(video.size / 1024 / 1024).toFixed(1)}MB). Max: 100MB` 
      }, { status: 400 });
    }

    // Validate file type
    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    if (!validTypes.includes(video.type)) {
      return NextResponse.json({ 
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
      return NextResponse.json({ 
        error: 'No active season. Uploads are currently closed.' 
      }, { status: 400 });
    }

    // Get current voting slot
    const { data: votingSlot } = await supabase
      .from('story_slots')
      .select('id, slot_position')
      .eq('season_id', season.id)
      .eq('status', 'voting')
      .order('slot_position', { ascending: true })
      .limit(1)
      .single();

    // Use current voting slot or slot 1 if none
    const slotPosition = votingSlot?.slot_position || 1;

    // Generate unique filename
    const filename = generateFilename(video.name);
    const storagePath = `clips/${filename}`;

    // Convert to buffer
    const arrayBuffer = await video.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Upload to Supabase Storage - 'videos' bucket
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('videos')  // Using 'videos' bucket
      .upload(storagePath, buffer, {
        contentType: video.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return NextResponse.json({ 
        error: 'Failed to upload video. Please try again.' 
      }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('videos')
      .getPublicUrl(storagePath);

    const videoUrl = urlData.publicUrl;

    // Insert into tournament_clips
    const { data: clipData, error: clipError } = await supabase
      .from('tournament_clips')
      .insert({
        slot_position: slotPosition,
        track_id: 'track-main',
        video_url: videoUrl,
        thumbnail_url: videoUrl, // Use video URL as thumbnail for now
        username: `creator_${voterKey.slice(-8)}`,
        avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${voterKey}`,
        genre: genre.toUpperCase(),
        title: title,
        description: description,
        vote_count: 0,
        weighted_score: 0,
        hype_score: 0,
        status: 'pending',
        uploader_key: voterKey,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (clipError) {
      console.error('Database insert error:', clipError);
      
      // Clean up uploaded file on DB error
      await supabase.storage.from('videos').remove([storagePath]);
      
      return NextResponse.json({ 
        error: 'Failed to save clip. Please try again.' 
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
      message: 'Upload successful! Your clip is pending review.',
    });

  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ 
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
