// app/api/admin/visual-learning/process/route.ts
// Processes existing clips to extract visual features and populate vocabulary
// Requires admin authentication
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for batch processing

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';
import { processExistingClipVisuals } from '@/lib/visual-learning';

/**
 * POST /api/admin/visual-learning/process
 *
 * Processes existing clips to extract visual features using Claude Vision.
 * Populates clip_visuals and visual_vocabulary tables.
 *
 * Query params:
 * - batchSize: number of clips to process (default: 10, max: 20)
 *
 * Note: Lower batch size than prompt-learning because visual analysis
 * is more expensive (requires fetching images and vision API calls).
 *
 * Returns:
 * - processed: number of clips successfully processed
 * - errors: number of clips that failed
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
      Math.max(parseInt(batchSizeParam || '10', 10) || 10, 1),
      20 // Max 20 per request (vision calls are expensive)
    );

    console.log(`[visual-learning/process] Starting batch processing with batchSize=${batchSize}`);

    // Process existing clips
    const result = await processExistingClipVisuals(batchSize);

    console.log(`[visual-learning/process] Completed: processed=${result.processed}, errors=${result.errors}`);

    return NextResponse.json({
      ok: true,
      processed: result.processed,
      errors: result.errors,
      message: result.processed > 0
        ? `Successfully processed ${result.processed} clips`
        : 'No clips to process (all have visual data, no valid thumbnails, or none exist)',
    });
  } catch (error) {
    console.error('[visual-learning/process] Error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Failed to process clips',
    }, { status: 500 });
  }
}

/**
 * GET /api/admin/visual-learning/process
 *
 * Returns stats about visual learning data.
 */
export async function GET(req: NextRequest) {
  // Rate limit
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Require admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Missing Supabase config');
    const supabase = createClient(url, key);

    // Get counts
    const [
      { count: totalClips },
      { count: clipsWithThumbnails },
      { count: processedClips },
      { count: vocabTerms },
    ] = await Promise.all([
      supabase.from('tournament_clips').select('*', { count: 'exact', head: true }),
      supabase.from('tournament_clips').select('*', { count: 'exact', head: true }).not('thumbnail_url', 'is', null),
      supabase.from('clip_visuals').select('*', { count: 'exact', head: true }),
      supabase.from('visual_vocabulary').select('*', { count: 'exact', head: true }),
    ]);

    return NextResponse.json({
      ok: true,
      stats: {
        total_clips: totalClips || 0,
        clips_with_thumbnails: clipsWithThumbnails || 0,
        processed_clips: processedClips || 0,
        unprocessed_clips: (clipsWithThumbnails || 0) - (processedClips || 0),
        vocabulary_terms: vocabTerms || 0,
      },
    });
  } catch (error) {
    console.error('[visual-learning/process] Stats error:', error);
    return NextResponse.json({
      ok: false,
      error: 'Failed to get stats',
    }, { status: 500 });
  }
}
