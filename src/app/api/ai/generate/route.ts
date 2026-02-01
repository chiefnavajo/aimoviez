// POST /api/ai/generate
// AI Video Generation — submit a prompt to fal.ai for video generation
// Requires authentication, CSRF, rate limiting, and feature flag check

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { AIGenerateSchema, parseBody } from '@/lib/validations';
import crypto from 'crypto';
import { sanitizePrompt, getModelConfig, startGeneration } from '@/lib/ai-video';

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
  try {
    // 1. Rate limit (fail-closed — ai_generate is in CRITICAL_RATE_LIMIT_TYPES)
    const rateLimitResponse = await rateLimit(request, 'ai_generate');
    if (rateLimitResponse) return rateLimitResponse;

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

    // 4. Check user is not banned
    const { data: userData, error: userLookupError } = await supabase
      .from('users')
      .select('id, is_banned')
      .eq('email', session.user.email)
      .maybeSingle();

    if (userLookupError) {
      console.error('[AI_GENERATE] User lookup error:', userLookupError.message);
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      );
    }

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

    const userId = userData.id;

    // 5. Feature flag check
    const { data: featureFlag, error: flagError } = await supabase
      .from('feature_flags')
      .select('enabled, config')
      .eq('key', 'ai_video_generation')
      .maybeSingle();

    if (flagError) {
      console.error('[AI_GENERATE] Feature flag lookup error:', flagError.message);
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      );
    }

    if (!featureFlag?.enabled) {
      return NextResponse.json(
        { success: false, error: 'AI video generation is not currently available' },
        { status: 403 }
      );
    }

    // 6. Parse feature flag config
    const config = featureFlag.config as {
      max_daily_free?: number;
      daily_cost_limit_cents?: number;
      monthly_cost_limit_cents?: number;
      keyword_blocklist?: string[];
    } | null;

    const maxDaily = config?.max_daily_free ?? 3;
    const dailyCostLimitCents = config?.daily_cost_limit_cents ?? 500;
    const monthlyCostLimitCents = config?.monthly_cost_limit_cents ?? 10000;
    const keywordBlocklist = config?.keyword_blocklist ?? [];

    // 7. Validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const validation = parseBody(AIGenerateSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const validated = validation.data;

    // 8. Sanitize prompt (keyword blocklist from feature flag config)
    const sanitizeResult = sanitizePrompt(validated.prompt, keywordBlocklist);
    if (!sanitizeResult.ok) {
      return NextResponse.json(
        { success: false, error: sanitizeResult.reason },
        { status: 400 }
      );
    }

    const sanitizedPrompt = sanitizeResult.prompt;

    // 9. Atomic daily limit check and reservation
    const { data: reservationResult, error: reservationError } = await supabase
      .rpc('check_and_reserve_generation', {
        p_user_id: userId,
        p_date: new Date().toISOString().split('T')[0],
        p_max_daily: maxDaily,
      });

    if (reservationError) {
      console.error('[AI_GENERATE] Reservation RPC error:', reservationError.message);
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      );
    }

    if (reservationResult === -1) {
      return NextResponse.json(
        { success: false, error: 'Daily generation limit reached' },
        { status: 429 }
      );
    }

    // 10. Get model configuration
    const modelConfig = getModelConfig(validated.model);
    if (!modelConfig) {
      return NextResponse.json(
        { success: false, error: 'Invalid model selected' },
        { status: 400 }
      );
    }

    // 11. Global cost cap check
    const { data: costCapOk, error: costCapError } = await supabase
      .rpc('check_global_cost_cap', {
        p_daily_limit_cents: dailyCostLimitCents,
        p_monthly_limit_cents: monthlyCostLimitCents,
        p_new_cost_cents: modelConfig.costCents,
      });

    if (costCapError) {
      console.error('[AI_GENERATE] Cost cap RPC error:', costCapError.message);
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      );
    }

    if (!costCapOk) {
      return NextResponse.json(
        { success: false, error: 'AI generation temporarily unavailable' },
        { status: 503 }
      );
    }

    // 12. Insert pending generation row
    const { data: generation, error: insertError } = await supabase
      .from('ai_generations')
      .insert({
        user_id: userId,
        fal_request_id: 'placeholder_' + crypto.randomUUID(),
        status: 'pending',
        prompt: sanitizedPrompt,
        model: validated.model,
        style: validated.style || null,
        genre: validated.genre || null,
        cost_cents: modelConfig.costCents,
      })
      .select('id')
      .single();

    if (insertError || !generation) {
      console.error('[AI_GENERATE] Insert error:', insertError?.message);
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      );
    }

    // 13. Submit to fal.ai
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/ai/webhook`;

    try {
      const { requestId } = await startGeneration(
        validated.model,
        sanitizedPrompt,
        validated.style,
        webhookUrl
      );

      // 14. Update row with real fal_request_id
      const { error: updateError } = await supabase
        .from('ai_generations')
        .update({ fal_request_id: requestId })
        .eq('id', generation.id);

      if (updateError) {
        console.error('[AI_GENERATE] Update fal_request_id error:', updateError.message);
        // Non-fatal — the webhook can still match by other means
      }
    } catch (falError: unknown) {
      // fal.ai call failed — mark generation as failed
      const errorMessage = falError instanceof Error ? falError.message : 'Generation service error';
      console.error('[AI_GENERATE] fal.ai submission error:', errorMessage);

      await supabase
        .from('ai_generations')
        .update({
          status: 'failed',
          error_message: errorMessage.slice(0, 500),
        })
        .eq('id', generation.id);

      // Do NOT decrement daily limit — reservation stands to prevent abuse loops
      return NextResponse.json(
        { success: false, error: 'AI generation service unavailable' },
        { status: 503 }
      );
    }

    // 15. Success
    return NextResponse.json({
      success: true,
      generationId: generation.id,
      stage: 'queued',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI_GENERATE] Unhandled error:', message);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
