// app/api/upload/register/route.ts
// ============================================================================
// REGISTER CLIP API - Saves clip info to database after direct Supabase upload
// This endpoint receives just the video URL (not the file), so no 4.5MB limit!
// Requires authentication - only logged-in users can register clips
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

// ============================================================================
// POST - Register Clip
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check authentication first
    const session = await getServerSession();
    if (!session?.user?.email) {
      console.error('[REGISTER] Unauthorized: No session or email');
      return NextResponse.json({
        success: false,
        error: 'You must be logged in to register clips.'
      }, { status: 401 });
    }

    console.log('[REGISTER] Authenticated user:', session.user.email);

    const supabase = getSupabaseClient();
    const voterKey = getVoterKey(request);
    const userEmail = session.user.email;

    // Parse JSON body (small request, just metadata)
    const body = await request.json();
    const { videoUrl, genre, title, description } = body;

    // Validate required fields
    if (!videoUrl) {
      return NextResponse.json({ success: false, error: 'Video URL is required' }, { status: 400 });
    }
    if (!genre) {
      return NextResponse.json({ success: false, error: 'Genre is required' }, { status: 400 });
    }

    // Look up user profile to get their username
    let uploaderUsername = `creator_${voterKey.slice(-8)}`;
    let uploaderAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${voterKey}`;

    const { data: userProfile } = await supabase
      .from('users')
      .select('id, username, avatar_url')
      .eq('email', userEmail)
      .single();

    if (userProfile) {
      uploaderUsername = userProfile.username || uploaderUsername;
      uploaderAvatar = userProfile.avatar_url || uploaderAvatar;
      console.log('[REGISTER] Found user profile:', uploaderUsername);
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
      console.error('[REGISTER] No active season:', seasonError);
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

    // Fail if no active voting slot
    if (slotError || !votingSlot) {
      console.error('[REGISTER] No active voting slot:', slotError);
      return NextResponse.json({ 
        success: false,
        error: 'No active voting slot. Voting is currently closed for this round.' 
      }, { status: 400 });
    }

    const slotPosition = votingSlot.slot_position;

    // Insert into tournament_clips
    const { data: clipData, error: clipError } = await supabase
      .from('tournament_clips')
      .insert({
        slot_position: slotPosition,
        track_id: 'track-main',
        video_url: videoUrl,
        thumbnail_url: videoUrl, // Use video URL as thumbnail for now
        username: uploaderUsername,
        avatar_url: uploaderAvatar,
        genre: genre.toUpperCase(),
        title: title || `Clip ${Date.now()}`,
        description: description || '',
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
      console.error('[REGISTER] Database insert error:', clipError);
      return NextResponse.json({ 
        success: false,
        error: `Failed to save clip: ${clipError.message || 'Database error'}` 
      }, { status: 500 });
    }

    console.log('[REGISTER] Clip registered:', {
      clipId: clipData.id,
      slotPosition,
      videoUrl: videoUrl.substring(0, 50) + '...',
    });

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
      message: 'Clip registered successfully! Pending admin approval.',
    });

  } catch (error) {
    console.error('[REGISTER] Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ 
      success: false,
      error: `Registration failed: ${errorMessage}` 
    }, { status: 500 });
  }
}
