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

    // Direct debug query first
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      return NextResponse.json({
        ok: false,
        error: 'Missing env vars',
        hasUrl: !!url,
        hasKey: !!key,
      });
    }

    const supabase = createClient(url, key);
    const { data: debugPrompts, error: debugError } = await supabase
      .from('prompt_history')
      .select('id')
      .is('scene_elements', null)
      .limit(5);

    console.log(`[prompt-learning/process] Starting batch processing with batchSize=${batchSize}`);

    // Process existing prompts
    const result = await processExistingPrompts(batchSize);

    console.log(`[prompt-learning/process] Completed: processed=${result.processed}, errors=${result.errors}`);

    return NextResponse.json({
      ok: true,
      version: 'v3',
      processed: result.processed,
      errors: result.errors,
      debug: result.debug || { missing: true },
      directQuery: {
        error: debugError?.message || null,
        count: debugPrompts?.length || 0,
      },
      message: result.processed > 0
        ? `Successfully processed ${result.processed} prompts`
        : 'No prompts to process (all have scene_elements or none exist)',
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
