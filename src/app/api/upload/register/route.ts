// app/api/upload/register/route.ts
// ============================================================================
// REGISTER CLIP API - Saves clip info to database after direct Supabase upload
// This endpoint receives just the video URL (not the file), so no 4.5MB limit!
// Requires authentication - only logged-in users can register clips
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import { RegisterClipSchema, parseBody } from '@/lib/validations';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeText } from '@/lib/sanitize';

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
  // Rate limiting for uploads (very strict)
  const rateLimitResponse = await rateLimit(request, 'upload');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Check authentication first
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      console.error('[REGISTER] Unauthorized: No session or email');
      return NextResponse.json({
        success: false,
        error: 'You must be logged in to register clips.'
      }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const voterKey = getVoterKey(request);
    const userEmail = session.user.email;

    // Parse JSON body (small request, just metadata)
    const body = await request.json();

    // Validate request body with Zod
    const validation = parseBody(RegisterClipSchema, body);
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    const { videoUrl, genre, title, description, duration } = validation.data;

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

    // Get current voting or waiting_for_clips slot (including timer info)
    const { data: votingSlot, error: slotError } = await supabase
      .from('story_slots')
      .select('id, slot_position, status, voting_started_at, voting_duration_hours')
      .eq('season_id', season.id)
      .in('status', ['voting', 'waiting_for_clips'])
      .order('slot_position', { ascending: true })
      .limit(1)
      .single();

    // Fail if no active voting or waiting slot
    if (slotError || !votingSlot) {
      console.error('[REGISTER] No active voting/waiting slot:', slotError);
      return NextResponse.json({
        success: false,
        error: 'No active voting slot. Voting is currently closed for this round.'
      }, { status: 400 });
    }

    const slotPosition = votingSlot.slot_position;
    const isWaitingForClips = votingSlot.status === 'waiting_for_clips';
    const isFirstClipInSlot = !votingSlot.voting_started_at || isWaitingForClips;

    // Sanitize user-provided text to prevent XSS
    const sanitizedTitle = sanitizeText(title) || `Clip ${Date.now()}`;
    const sanitizedDescription = sanitizeText(description) || '';

    // Insert into tournament_clips
    const { data: clipData, error: clipError } = await supabase
      .from('tournament_clips')
      .insert({
        season_id: season.id,  // Link to active season
        slot_position: slotPosition,
        track_id: 'track-main',
        video_url: videoUrl,
        thumbnail_url: videoUrl, // Use video URL as thumbnail for now
        username: sanitizeText(uploaderUsername),
        avatar_url: uploaderAvatar,
        genre: genre.toUpperCase(),
        title: sanitizedTitle,
        description: sanitizedDescription,
        vote_count: 0,
        weighted_score: 0,
        hype_score: 0,
        status: 'pending',
        uploader_key: voterKey,
        created_at: new Date().toISOString(),
        duration_seconds: duration || null, // Store video duration for admin review
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

    // If this is the first clip in the slot, start the voting timer
    let timerStarted = false;
    if (isFirstClipInSlot) {
      const durationHours = votingSlot.voting_duration_hours || 24;
      const now = new Date();
      const votingEndsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

      const { error: timerError } = await supabase
        .from('story_slots')
        .update({
          voting_started_at: now.toISOString(),
          voting_ends_at: votingEndsAt.toISOString(),
        })
        .eq('id', votingSlot.id);

      if (timerError) {
        console.error('[REGISTER] Failed to start voting timer:', timerError);
        // Non-fatal - clip is still registered
      } else {
        timerStarted = true;
        console.log(`[REGISTER] First clip uploaded - voting timer started (ends: ${votingEndsAt.toISOString()})`);
      }
    }

    // Success response
    let message = 'Clip registered successfully! Pending admin approval.';
    if (isWaitingForClips) {
      message = 'Clip registered! This slot is waiting for clips - voting will resume once your clip is approved.';
    }

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
      message,
      timerStarted,
      isWaitingForClips,
    });

  } catch (error) {
    console.error('[REGISTER] Unexpected error:', error);
    // Don't expose internal error details to client
    return NextResponse.json({
      success: false,
      error: 'Registration failed. Please try again.'
    }, { status: 500 });
  }
}
