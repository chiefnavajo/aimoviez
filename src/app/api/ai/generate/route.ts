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
import { sanitizePrompt, getModelConfig, startGeneration, supportsImageToVideo, startImageToVideoGeneration, getImageToVideoModelConfig, startReferenceToVideoGeneration, MODELS } from '@/lib/ai-video';
import type { ReferenceElement } from '@/lib/ai-video';

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

    // 9. Atomic daily limit check and reservation (v2 supports per-user custom limits)
    const { data: reservationResult, error: reservationError } = await supabase
      .rpc('check_and_reserve_generation_v2', {
        p_user_id: userId,
        p_date: new Date().toISOString().split('T')[0],
        p_global_max_daily: maxDaily,
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

    // 10b. Image-to-video validation (if image_url provided)
    const isImageToVideo = !!validated.image_url;
    if (isImageToVideo) {
      // Validate the image URL points to our own storage (prevent abuse)
      try {
        const imgHost = new URL(validated.image_url!).hostname;
        const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname;
        const r2Host = process.env.CLOUDFLARE_R2_PUBLIC_URL
          ? new URL(process.env.CLOUDFLARE_R2_PUBLIC_URL).hostname
          : null;

        if (imgHost !== supabaseHost && imgHost !== r2Host) {
          return NextResponse.json(
            { success: false, error: 'Image URL must point to our storage' },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { success: false, error: 'Invalid image URL' },
          { status: 400 }
        );
      }

      if (!supportsImageToVideo(validated.model)) {
        return NextResponse.json(
          { success: false, error: `Image-to-video is not supported for ${validated.model}. Try kling-2.6, hailuo-2.3, or sora-2.` },
          { status: 400 }
        );
      }
    }

    // 10c. Character pinning — auto-detect pinned characters for reference-to-video
    let isReferenceToVideo = false;
    let refElements: ReferenceElement[] = [];
    let pinnedCharacterIds: string[] = [];
    let augmentedPrompt = sanitizedPrompt;
    let effectiveModel: string = validated.model;

    if (!isImageToVideo && !validated.skip_pinned) {
      // Check if character pinning is enabled
      const { data: pinFlag } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'character_pinning')
        .maybeSingle();

      if (pinFlag?.enabled) {
        // Get active season
        const { data: activeSeason } = await supabase
          .from('seasons')
          .select('id')
          .eq('status', 'active')
          .maybeSingle();

        if (activeSeason) {
          // Get active pinned characters for this season
          let pinnedCharsQuery = supabase
            .from('pinned_characters')
            .select('id, element_index, label, frontal_image_url, reference_image_urls')
            .eq('season_id', activeSeason.id)
            .eq('is_active', true);

          // Filter out skipped character IDs if provided
          if (validated.skip_character_ids && validated.skip_character_ids.length > 0) {
            pinnedCharsQuery = pinnedCharsQuery.not('id', 'in', `(${validated.skip_character_ids.join(',')})`);
          }

          const { data: pinnedChars } = await pinnedCharsQuery.order('element_index', { ascending: true });

          if (pinnedChars && pinnedChars.length > 0) {
            // Health-check frontal image URLs in parallel before sending to fal.ai
            const healthChecks = await Promise.all(
              pinnedChars.map(async (pc) => {
                try {
                  const headRes = await fetch(pc.frontal_image_url, {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(3_000),
                  });
                  if (!headRes.ok) {
                    console.warn(`[AI_GENERATE] Pinned char ${pc.id} frontal URL unreachable: ${headRes.status}`);
                    return false;
                  }
                  return true;
                } catch {
                  console.warn(`[AI_GENERATE] Pinned char ${pc.id} frontal URL check failed`);
                  return false;
                }
              })
            );
            const allReachable = healthChecks.every(Boolean);

            if (allReachable) {
              isReferenceToVideo = true;
              pinnedCharacterIds = pinnedChars.map(pc => pc.id);
              effectiveModel = 'kling-o1-ref';

              refElements = pinnedChars.map(pc => ({
                frontal_image_url: pc.frontal_image_url,
                reference_image_urls: pc.reference_image_urls || [],
              }));

              // Inject @Element tags into prompt (in ascending order)
              const elementTags = pinnedChars
                .map((_, i) => `@Element${i + 1}`)
                .filter(tag => !augmentedPrompt.includes(tag))
                .join(' ');
              if (elementTags) {
                augmentedPrompt = `${elementTags} ${augmentedPrompt}`;
              }

              // Increment usage count atomically (non-blocking)
              supabase
                .rpc('increment_pinned_usage', { p_ids: pinnedCharacterIds })
                .then(({ error: incErr }) => {
                  if (incErr) console.warn('[AI_GENERATE] usage_count increment failed:', incErr.message);
                });
            }
          }
        }
      }
    }

    // Use the effective model's cost (may have switched to kling-o1-ref)
    const effectiveModelConfig = getModelConfig(effectiveModel);
    const effectiveCostCents = isImageToVideo
      ? (getImageToVideoModelConfig(validated.model)?.costCents ?? modelConfig.costCents)
      : (effectiveModelConfig?.costCents ?? modelConfig.costCents);

    // 11. Global cost cap check
    const { data: costCapOk, error: costCapError } = await supabase
      .rpc('check_global_cost_cap', {
        p_daily_limit_cents: dailyCostLimitCents,
        p_monthly_limit_cents: monthlyCostLimitCents,
        p_new_cost_cents: effectiveCostCents,
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
    const generationMode = isReferenceToVideo ? 'reference-to-video'
      : isImageToVideo ? 'image-to-video'
      : 'text-to-video';

    const { data: generation, error: insertError } = await supabase
      .from('ai_generations')
      .insert({
        user_id: userId,
        fal_request_id: 'placeholder_' + crypto.randomUUID(),
        status: 'pending',
        prompt: augmentedPrompt,
        model: effectiveModel,
        style: validated.style || null,
        genre: validated.genre || null,
        cost_cents: effectiveCostCents,
        image_url: validated.image_url || null,
        generation_mode: generationMode,
        ...(pinnedCharacterIds.length > 0 ? { pinned_character_ids: pinnedCharacterIds } : {}),
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

    // 13. Submit to fal.ai (text-to-video, image-to-video, or reference-to-video)
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/ai/webhook`;

    try {
      let requestId: string;

      if (isReferenceToVideo) {
        const result = await startReferenceToVideoGeneration(
          augmentedPrompt,
          refElements,
          validated.style,
          webhookUrl
        );
        requestId = result.requestId;
      } else if (isImageToVideo) {
        const result = await startImageToVideoGeneration(
          validated.model,
          sanitizedPrompt,
          validated.image_url!,
          validated.style,
          webhookUrl
        );
        requestId = result.requestId;
      } else {
        const result = await startGeneration(
          validated.model,
          sanitizedPrompt,
          validated.style,
          webhookUrl
        );
        requestId = result.requestId;
      }

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
