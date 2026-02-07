// app/api/admin/prompt-learning/process/route.ts
// Processes existing prompts to extract scene elements and populate vocabulary
// Requires admin authentication
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for batch processing

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';
import { createClient } from '@supabase/supabase-js';
import { processExistingPrompts } from '@/lib/prompt-learning';

/**
 * POST /api/admin/prompt-learning/process
 *
 * Processes existing prompts to extract scene elements using Claude Haiku.
 * Populates scene_vocabulary and model_prompt_patterns tables.
 *
 * Query params:
 * - batchSize: number of prompts to process (default: 50, max: 100)
 *
 * Returns:
 * - processed: number of prompts successfully processed
 * - errors: number of prompts that failed
 */
export async function POST(req: NextRequest) {
  // Rate limit
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Require admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    // Get batch size from query params
    const { searchParams } = new URL(req.url);
    const batchSizeParam = searchParams.get('batchSize');
    const batchSize = Math.min(
      Math.max(parseInt(batchSizeParam || '50', 10) || 50, 1),
      100 // Max 100 per request
    );

    // Direct processing - bypass library
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!url || !key) {
      return NextResponse.json({
        ok: false,
        error: 'Missing Supabase env vars',
        hasUrl: !!url,
        hasKey: !!key,
      });
    }

    if (!anthropicKey) {
      return NextResponse.json({
        ok: false,
        error: 'Missing ANTHROPIC_API_KEY',
      });
    }

    const supabase = createClient(url, key);

    // Fetch prompts directly
    const { data: prompts, error: fetchError } = await supabase
      .from('prompt_history')
      .select('id, season_id, user_prompt, ai_model, vote_count, is_winner')
      .is('scene_elements', null)
      .limit(batchSize);

    if (fetchError) {
      return NextResponse.json({
        ok: false,
        error: 'Failed to fetch prompts',
        details: fetchError.message,
      });
    }

    if (!prompts || prompts.length === 0) {
      return NextResponse.json({
        ok: true,
        version: 'v4',
        processed: 0,
        errors: 0,
        message: 'No prompts found with null scene_elements',
        promptCount: prompts?.length || 0,
      });
    }

    // Process prompts using library function for extraction
    const { extractSceneElements, updateSceneVocabulary, updateModelPatterns } = await import('@/lib/prompt-learning');

    let processed = 0;
    let errors = 0;
    const processedIds: string[] = [];

    for (const prompt of prompts) {
      try {
        const elements = await extractSceneElements(prompt.user_prompt);

        if (elements) {
          // Update prompt_history
          await supabase
            .from('prompt_history')
            .update({ scene_elements: elements })
            .eq('id', prompt.id);

          // Update vocabulary
          await updateSceneVocabulary(
            prompt.season_id,
            elements,
            prompt.user_prompt,
            prompt.vote_count,
            prompt.is_winner
          );

          // Update model patterns
          await updateModelPatterns(
            prompt.ai_model,
            prompt.user_prompt,
            prompt.vote_count,
            prompt.is_winner
          );

          processed++;
          processedIds.push(prompt.id);
        }
      } catch (e) {
        console.error(`[prompt-learning] Error processing ${prompt.id}:`, e);
        errors++;
      }
    }

    return NextResponse.json({
      ok: true,
      version: 'v4',
      processed,
      errors,
      foundPrompts: prompts.length,
      processedIds,
      message: processed > 0
        ? `Successfully processed ${processed} prompts`
        : 'No prompts were processed',
    });
  } catch (error) {
    console.error('[prompt-learning/process] Error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Failed to process prompts',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * GET /api/admin/prompt-learning/process
 *
 * Returns stats about prompt learning data.
 */
export async function GET(req: NextRequest) {
  // Rate limit
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Require admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { getServiceClient } = await import('@/lib/supabase-client');
    const supabase = getServiceClient();

    // Get counts
    const [
      { count: totalPrompts },
      { count: processedPrompts },
      { count: vocabTerms },
      { count: modelPatterns },
    ] = await Promise.all([
      supabase.from('prompt_history').select('*', { count: 'exact', head: true }),
      supabase.from('prompt_history').select('*', { count: 'exact', head: true }).not('scene_elements', 'is', null),
      supabase.from('scene_vocabulary').select('*', { count: 'exact', head: true }),
      supabase.from('model_prompt_patterns').select('*', { count: 'exact', head: true }),
    ]);

    return NextResponse.json({
      ok: true,
      stats: {
        total_prompts: totalPrompts || 0,
        processed_prompts: processedPrompts || 0,
        unprocessed_prompts: (totalPrompts || 0) - (processedPrompts || 0),
        vocabulary_terms: vocabTerms || 0,
        model_patterns: modelPatterns || 0,
      },
    });
  } catch (error) {
    console.error('[prompt-learning/process] Stats error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Failed to get stats',
    }, { status: 500 });
  }
}
