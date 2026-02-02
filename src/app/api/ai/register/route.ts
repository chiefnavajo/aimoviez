// POST /api/ai/register
// Registers a completed AI-generated video as a tournament clip.
// Mirrors the upload/register route but uses AI generation data
// and constructs the public URL server-side from storage_key.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import crypto from 'crypto';
import { AIRegisterSchema, parseBody } from '@/lib/validations';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { sanitizeText } from '@/lib/sanitize';
import { logAdminAction } from '@/lib/audit-log';
import { MODEL_DURATION_SECONDS } from '@/lib/ai-video';
import { getStorageProvider, getPublicVideoUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

// =============================================================================
// HELPERS
// =============================================================================

function getVoterKey(request: NextRequest): string {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || '0.0.0.0';
  const ua = request.headers.get('user-agent') || 'unknown';
  const raw = `${ip}|${ua}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `device_${hash}`;
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  // Rate limiting (upload tier)
  const rateLimitResponse = await rateLimit(request, 'upload');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // 1. Authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // 2. CSRF protection
    const csrfError = await requireCsrf(request);
    if (csrfError) return csrfError;

    // 3. Validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const validation = parseBody(AIRegisterSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const { generationId, genre, title, description } = validation.data;

    const supabase = getSupabase();

    // 4. Feature flag check
    const { data: featureFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'ai_video_generation')
      .maybeSingle();

    if (!featureFlag?.enabled) {
      return NextResponse.json(
        { success: false, error: 'AI video generation is not currently available' },
        { status: 403 }
      );
    }

    // 5. Check user is not banned
    const voterKey = getVoterKey(request);
    const userEmail = session.user.email;

    let uploaderUsername = `creator_${voterKey.slice(-8)}`;
    let uploaderAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${voterKey}`;
    let userId: string | null = null;

    const { data: userProfile } = await supabase
      .from('users')
      .select('id, username, avatar_url, is_banned')
      .eq('email', userEmail)
      .maybeSingle();

    if (!userProfile) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    if (userProfile.is_banned) {
      return NextResponse.json(
        { success: false, error: 'Account suspended' },
        { status: 403 }
      );
    }

    userId = userProfile.id;
    uploaderUsername = userProfile.username || uploaderUsername;
    uploaderAvatar = userProfile.avatar_url || uploaderAvatar;

    // 6. Look up generation (user owns, completed, no clip_id, has storage_key)
    const { data: gen, error: genError } = await supabase
      .from('ai_generations')
      .select('id, status, model, prompt, style, storage_key, clip_id, narration_text')
      .eq('id', generationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (genError || !gen) {
      return NextResponse.json(
        { success: false, error: 'Generation not found' },
        { status: 404 }
      );
    }

    if (gen.status !== 'completed') {
      return NextResponse.json(
        { success: false, error: 'Generation not ready' },
        { status: 400 }
      );
    }

    if (gen.clip_id) {
      return NextResponse.json(
        { success: false, error: 'This generation has already been registered as a clip' },
        { status: 409 }
      );
    }

    if (!gen.storage_key) {
      return NextResponse.json(
        { success: false, error: 'Video not yet transferred to storage. Call /api/ai/complete first.' },
        { status: 400 }
      );
    }

    // 7. Construct public URL from storage_key (server-side, never from client)
    const { data: r2Flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'r2_storage')
      .maybeSingle();

    const storageProvider = await getStorageProvider(r2Flag?.enabled ?? false);
    const publicUrl = getPublicVideoUrl(gen.storage_key, storageProvider);

    // 8. Get active season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('id, total_slots')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (seasonError || !season) {
      return NextResponse.json(
        { success: false, error: 'No active season. Uploads are currently closed.' },
        { status: 400 }
      );
    }

    // 9. Get current voting or waiting_for_clips slot
    const { data: votingSlot, error: slotError } = await supabase
      .from('story_slots')
      .select('id, slot_position, status, voting_started_at, voting_duration_hours')
      .eq('season_id', season.id)
      .in('status', ['voting', 'waiting_for_clips'])
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (slotError || !votingSlot) {
      return NextResponse.json(
        { success: false, error: 'No active voting slot. Voting is currently closed.' },
        { status: 400 }
      );
    }

    const slotPosition = votingSlot.slot_position;
    const isWaitingForClips = votingSlot.status === 'waiting_for_clips';
    const isFirstClipInSlot = !votingSlot.voting_started_at || isWaitingForClips;

    // 10. Get duration from model config
    const durationSeconds = MODEL_DURATION_SECONDS[gen.model] || 5;

    // 11. Insert into tournament_clips
    const sanitizedTitle = sanitizeText(title) || `AI Clip ${Date.now()}`;
    const sanitizedDescription = sanitizeText(description) || '';

    const { data: clipData, error: clipError } = await supabase
      .from('tournament_clips')
      .insert({
        season_id: season.id,
        slot_position: slotPosition,
        track_id: 'track-main',
        video_url: publicUrl,
        thumbnail_url: publicUrl,
        user_id: userId,
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
        duration_seconds: durationSeconds,
        is_ai_generated: true,
        ai_prompt: gen.prompt,
        ai_model: gen.model,
        ai_generation_id: gen.id,
        ai_style: gen.style || null,
        has_narration: !!gen.narration_text,
      })
      .select()
      .single();

    if (clipError) {
      console.error('[AI_REGISTER] Database insert error:', clipError);
      return NextResponse.json(
        { success: false, error: 'Failed to register clip. Please try again.' },
        { status: 500 }
      );
    }

    // 12. Atomic update: set clip_id on generation (WHERE clip_id IS NULL)
    const { data: updateRows, error: updateError } = await supabase
      .from('ai_generations')
      .update({ clip_id: clipData.id })
      .eq('id', gen.id)
      .is('clip_id', null)
      .select('id');

    if (updateError || !updateRows?.length) {
      // Race condition — another request registered first. Delete our clip.
      console.warn('[AI_REGISTER] Race condition on clip_id update, rolling back clip:', clipData.id);
      await supabase.from('tournament_clips').delete().eq('id', clipData.id);
      return NextResponse.json(
        { success: false, error: 'This generation has already been registered' },
        { status: 409 }
      );
    }

    // 13. Voting timer logic (same as register route)
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
        console.error('[AI_REGISTER] Failed to start voting timer:', timerError);
      } else {
        timerStarted = true;
      }
    }

    // 14. Audit log
    logAdminAction(request, {
      action: 'ai_register',
      resourceType: 'ai_generation',
      resourceId: gen.id,
      adminId: userId || undefined,
      details: {
        clip_id: clipData.id,
        model: gen.model,
        genre: genre.toUpperCase(),
      },
    }).catch(() => {});

    // 15. Success
    return NextResponse.json({
      success: true,
      clip: {
        id: clipData.id,
        video_url: publicUrl,
        slot_position: slotPosition,
        status: 'pending',
        genre,
        title,
      },
      message: isWaitingForClips
        ? 'AI clip registered! Waiting for more clips before voting starts.'
        : 'AI clip registered successfully! Pending admin approval.',
      timerStarted,
      isWaitingForClips,
    });
  } catch (error) {
    console.error('[AI_REGISTER] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Registration failed. Please try again.' },
      { status: 500 }
    );
  }
}
