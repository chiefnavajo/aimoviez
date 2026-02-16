// POST /api/ai/narrate
// Generate AI narration for a completed video generation.
// Returns base64-encoded MP3 audio for client preview before submission.

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { AINarrateSchema, parseBody } from '@/lib/validations';
import { generateNarration, isValidVoiceId, type NarrationConfig } from '@/lib/elevenlabs';

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
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  // 1. Rate limit (fail-closed)
  const rateLimitResponse = await rateLimit(request, 'ai_narrate');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // 2. Authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // 3. CSRF protection
    const csrfError = await requireCsrf(request);
    if (csrfError) return csrfError;

    const supabase = getSupabase();

    // 4. Feature flag check
    const { data: featureFlag } = await supabase
      .from('feature_flags')
      .select('enabled, config')
      .eq('key', 'elevenlabs_narration')
      .maybeSingle();

    if (!featureFlag?.enabled) {
      return NextResponse.json(
        { success: false, error: 'AI narration is not currently available' },
        { status: 403 }
      );
    }

    const config = featureFlag.config as NarrationConfig;
    if (!config?.voices?.length) {
      return NextResponse.json(
        { success: false, error: 'Narration not configured' },
        { status: 500 }
      );
    }

    // 5. Check user is not banned
    const { data: userData } = await supabase
      .from('users')
      .select('id, is_banned')
      .eq('email', session.user.email)
      .maybeSingle();

    if (!userData) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    if (userData.is_banned) {
      return NextResponse.json(
        { success: false, error: 'Account suspended' },
        { status: 403 }
      );
    }

    // 6. Validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const validation = parseBody(AINarrateSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const { generationId, text, voiceId } = validation.data;

    // 7. Verify generation belongs to user and is completed
    const { data: gen } = await supabase
      .from('ai_generations')
      .select('id, status')
      .eq('id', generationId)
      .eq('user_id', userData.id)
      .maybeSingle();

    if (!gen) {
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

    // 8. Validate voice ID against allowed list
    if (!isValidVoiceId(voiceId, config)) {
      return NextResponse.json(
        { success: false, error: 'Invalid voice selection' },
        { status: 400 }
      );
    }

    // 9. Check text length against config max
    const maxChars = config.max_chars || 200;
    if (text.length > maxChars) {
      return NextResponse.json(
        { success: false, error: `Narration text must be ${maxChars} characters or less` },
        { status: 400 }
      );
    }

    // 10. Check daily narration limit for this user
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: todayNarrations } = await supabase
      .from('ai_generations')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userData.id)
      .not('narration_text', 'is', null)
      .gte('created_at', todayStart.toISOString());

    const dailyLimit = config.daily_limit || 10;
    if ((todayNarrations || 0) >= dailyLimit) {
      return NextResponse.json(
        { success: false, error: 'Daily narration limit reached' },
        { status: 429 }
      );
    }

    // 11. Check global cost cap
    const costCents = config.cost_per_generation_cents || 5;

    const { data: costCapOk } = await supabase
      .rpc('check_global_cost_cap', {
        p_daily_limit_cents: 500,
        p_monthly_limit_cents: 10000,
        p_new_cost_cents: costCents,
      });

    if (!costCapOk) {
      return NextResponse.json(
        { success: false, error: 'Narration temporarily unavailable' },
        { status: 503 }
      );
    }

    // 12. Generate narration via ElevenLabs
    const result = await generateNarration(text, voiceId, config);

    // 13. Update generation record with narration metadata
    const { error: updateError } = await supabase
      .from('ai_generations')
      .update({
        narration_text: text,
        narration_voice_id: voiceId,
        narration_cost_cents: costCents,
      })
      .eq('id', generationId);

    if (updateError) {
      console.error('[AI_NARRATE] Failed to update generation:', updateError);
    }

    // 14. Return base64-encoded audio
    const audioBase64 = result.audioBuffer.toString('base64');

    console.info(`[AI_NARRATE] Generated narration for ${generationId}: ${result.characterCount} chars, ${result.audioBuffer.length} bytes`);

    return NextResponse.json({
      success: true,
      audioBase64,
      contentType: result.contentType,
      characterCount: result.characterCount,
      costCents,
    });
  } catch (error) {
    console.error('[AI_NARRATE] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Narration failed' },
      { status: 500 }
    );
  }
}
