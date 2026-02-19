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
import { sanitizePrompt, getModelConfig, startGeneration, supportsImageToVideo, startImageToVideoGeneration, getImageToVideoModelConfig, startReferenceToVideoGeneration, MODELS, getModelCosts } from '@/lib/ai-video';
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
    // 1-3. Rate limit, authentication, CSRF — all independent, run in parallel
    const [rateLimitResponse, session, csrfError] = await Promise.all([
      rateLimit(request, 'ai_generate'),
      getServerSession(authOptions),
      requireCsrf(request),
    ]);

    if (rateLimitResponse) return rateLimitResponse;
    if (csrfError) return csrfError;

    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = getSupabase();

    // 4-5. User lookup, feature flag, and model costs — all independent, run in parallel
    const [userResult, flagResult, modelCosts] = await Promise.all([
      supabase
        .from('users')
        .select('id, is_banned, balance_credits')
        .eq('email', session.user.email)
        .maybeSingle(),
      supabase
        .from('feature_flags')
        .select('enabled, config')
        .eq('key', 'ai_video_generation')
        .maybeSingle(),
      getModelCosts(supabase),
    ]);

    const { data: userData, error: userLookupError } = userResult;
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

    const { data: featureFlag, error: flagError } = flagResult;
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
      daily_cost_limit_cents?: number;
      monthly_cost_limit_cents?: number;
      keyword_blocklist?: string[];
    } | null;

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

    // 9. Get model configuration
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
    let userCharacterIds: string[] = [];
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
        // Get active season (genre-aware for multi-genre)
        let seasonQuery = supabase
          .from('seasons')
          .select('id')
          .eq('status', 'active');
        if (validated.genre) {
          seasonQuery = seasonQuery.eq('genre', validated.genre.toLowerCase());
        }
        const { data: activeSeason } = await seasonQuery
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (activeSeason) {
          // Get active pinned characters for this season
          let pinnedCharsQuery = supabase
            .from('pinned_characters')
            .select('id, element_index, label, frontal_image_url, reference_image_urls, appearance_description')
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
                    signal: AbortSignal.timeout(1_000),
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

            // Inject character appearance descriptions into prompt
            // (works for both ref-to-video AND text-to-video fallback)
            const charDescriptions = pinnedChars
              .filter((pc: { appearance_description?: string | null }) => pc.appearance_description)
              .map((pc: { label?: string | null; element_index: number; appearance_description?: string | null }) =>
                `${pc.label || `Element ${pc.element_index}`}: ${pc.appearance_description}`)
              .join('; ');
            if (charDescriptions) {
              augmentedPrompt = `Characters: ${charDescriptions}. ${augmentedPrompt}`;
            }

            // Try reference-to-video with frontal images; fallback to text-to-video on failure
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

    // 10d. User characters — merge personal characters into refElements
    if (!isImageToVideo && validated.user_character_ids && validated.user_character_ids.length > 0) {
      // Check feature flag
      const { data: ucFlag } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'user_characters')
        .maybeSingle();

      if (ucFlag?.enabled) {
        // Fetch user characters with ownership check
        const { data: userChars } = await supabase
          .from('user_characters')
          .select('id, label, frontal_image_url, reference_image_urls, appearance_description')
          .in('id', validated.user_character_ids)
          .eq('user_id', userId)
          .eq('is_active', true);

        if (userChars && userChars.length > 0) {
          // Enforce total max 4 elements (pinned + user combined)
          const remainingSlots = 4 - refElements.length;
          const usableChars = userChars.slice(0, remainingSlots);

          if (usableChars.length > 0) {
            // Health-check frontal URLs
            const ucHealthChecks = await Promise.all(
              usableChars.map(async (uc) => {
                try {
                  const headRes = await fetch(uc.frontal_image_url, {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(1_000),
                  });
                  return headRes.ok;
                } catch {
                  console.warn(`[AI_GENERATE] User char ${uc.id} frontal URL check failed`);
                  return false;
                }
              })
            );

            const reachableChars = usableChars.filter((_, i) => ucHealthChecks[i]);

            if (reachableChars.length > 0) {
              // Inject descriptions into prompt
              const ucDescriptions = reachableChars
                .filter(uc => uc.appearance_description)
                .map(uc => `${uc.label}: ${uc.appearance_description}`)
                .join('; ');
              if (ucDescriptions) {
                const prefix = augmentedPrompt.startsWith('Characters: ') ? '' : 'Characters: ';
                if (prefix) {
                  augmentedPrompt = `Characters: ${ucDescriptions}. ${augmentedPrompt}`;
                } else {
                  // Append to existing Characters: block
                  augmentedPrompt = augmentedPrompt.replace(
                    /^Characters: (.+)\. (?=@Element|\S)/,
                    `Characters: $1; ${ucDescriptions}. `
                  );
                }
              }

              // Add to refElements
              for (const uc of reachableChars) {
                refElements.push({
                  frontal_image_url: uc.frontal_image_url,
                  reference_image_urls: uc.reference_image_urls || [],
                });
              }

              userCharacterIds = reachableChars.map(uc => uc.id);
              isReferenceToVideo = true;
              effectiveModel = 'kling-o1-ref';

              // Re-generate all @Element tags for the full combined array
              const allElementTags = refElements
                .map((_, i) => `@Element${i + 1}`)
                .filter(tag => !augmentedPrompt.includes(tag))
                .join(' ');
              if (allElementTags) {
                // Remove existing @Element tags first, then re-add all
                augmentedPrompt = augmentedPrompt
                  .replace(/@Element\d+\s*/g, '')
                  .trim();
                const fullTags = refElements.map((_, i) => `@Element${i + 1}`).join(' ');
                augmentedPrompt = `${fullTags} ${augmentedPrompt}`;
              }

              // Increment usage counts (non-blocking)
              supabase
                .rpc('increment_user_char_usage', { p_ids: userCharacterIds })
                .then(({ error: incErr }) => {
                  if (incErr) console.warn('[AI_GENERATE] user char usage_count increment failed:', incErr.message);
                });
            }
          }
        }
      }
    }

    // Use the effective model's cost from DB (may have switched to kling-o1-ref)
    const effectiveCostCents = isImageToVideo
      ? (modelCosts[validated.model]?.fal_cost_cents ?? modelConfig.costCents)
      : (modelCosts[effectiveModel]?.fal_cost_cents ?? modelConfig.costCents);

    // 9d. Credit check: get model credit cost and verify balance
    const creditCost = modelCosts[effectiveModel]?.credit_cost ?? 10; // Fallback to 10 credits

    const userBalance = userData.balance_credits ?? 0;
    if (userBalance < creditCost) {
      return NextResponse.json(
        {
          success: false,
          error: 'Insufficient credits',
          code: 'INSUFFICIENT_CREDITS',
          required: creditCost,
          current: userBalance,
        },
        { status: 402 } // Payment Required
      );
    }

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
        ...(userCharacterIds.length > 0 ? { user_character_ids: userCharacterIds } : {}),
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

    // 11b. Deduct credits atomically
    const { data: deductResult, error: deductError } = await supabase.rpc('deduct_credits', {
      p_user_id: userId,
      p_amount: creditCost,
      p_generation_id: generation.id,
    });

    if (deductError) {
      console.error('[AI_GENERATE] Credit deduction error:', deductError.message);
      await supabase
        .from('ai_generations')
        .update({ status: 'failed', error_message: 'Credit deduction failed' })
        .eq('id', generation.id);
      return NextResponse.json(
        { success: false, error: 'Failed to process payment' },
        { status: 500 }
      );
    }

    if (!deductResult?.success) {
      console.error('[AI_GENERATE] Credit deduction rejected:', deductResult?.error);
      await supabase
        .from('ai_generations')
        .update({ status: 'failed', error_message: deductResult?.error || 'Insufficient credits' })
        .eq('id', generation.id);
      return NextResponse.json(
        {
          success: false,
          error: deductResult?.error || 'Insufficient credits',
          code: 'INSUFFICIENT_CREDITS',
          required: creditCost,
          current: deductResult?.current ?? 0,
        },
        { status: 402 }
      );
    }

    console.info(`[AI_GENERATE] Deducted ${creditCost} credits for generation ${generation.id}`);

    // 13. Submit to fal.ai (text-to-video, image-to-video, or reference-to-video)
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/ai/webhook`;

    try {
      let requestId: string;

      if (isReferenceToVideo) {
        try {
          const result = await startReferenceToVideoGeneration(
            augmentedPrompt,
            refElements,
            validated.style,
            webhookUrl
          );
          requestId = result.requestId;
        } catch (refError) {
          // Reference-to-video failed — fallback to normal text-to-video with user's selected model
          console.warn('[AI_GENERATE] Reference-to-video failed, falling back to text-to-video:', refError instanceof Error ? refError.message : refError);

          const fallbackResult = await startGeneration(
            validated.model,
            augmentedPrompt,
            validated.style,
            webhookUrl
          );
          requestId = fallbackResult.requestId;

          // Update generation row to reflect the fallback
          await supabase
            .from('ai_generations')
            .update({
              model: validated.model,
              generation_mode: 'text-to-video',
              prompt: augmentedPrompt,
              cost_cents: modelCosts[validated.model]?.fal_cost_cents ?? modelConfig.costCents,
            })
            .eq('id', generation.id);
        }
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

      // Refund credits since generation failed
      const { data: refundResult, error: refundError } = await supabase.rpc('refund_credits', {
        p_user_id: userId,
        p_generation_id: generation.id,
      });

      if (refundError) {
        console.error('[AI_GENERATE] Credit refund error:', refundError.message);
      } else if (refundResult?.success) {
        console.info(`[AI_GENERATE] Refunded ${refundResult.refunded} credits for failed generation ${generation.id}`);
      }

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
