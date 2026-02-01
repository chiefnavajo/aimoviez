// app/api/cron/ai-generation-timeout/route.ts
// ============================================================================
// AI GENERATION TIMEOUT CRON
// Handles stale generations, expired completions, and orphaned storage.
// Runs every 5 minutes via Vercel Cron.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MODELS } from '@/lib/ai-video';
import { getStorageProvider, deleteFiles } from '@/lib/storage';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  // Verify CRON_SECRET
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!cronSecret) {
    if (isProduction) {
      console.error('[ai-timeout] CRITICAL: CRON_SECRET not configured in production');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    console.warn('[ai-timeout] DEV MODE: Running without auth');
  }

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    // ========================================================================
    // DISTRIBUTED LOCK
    // ========================================================================
    const lockId = `ai-timeout-${Date.now()}`;
    const lockExpiry = new Date(Date.now() + 60 * 1000).toISOString();
    const now = new Date().toISOString();

    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'ai-generation-timeout')
      .lt('expires_at', now);

    const { error: lockError } = await supabase
      .from('cron_locks')
      .insert({
        job_name: 'ai-generation-timeout',
        lock_id: lockId,
        expires_at: lockExpiry,
        acquired_at: now,
      });

    if (lockError) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: 'Another instance is running',
      });
    }

    const results: Record<string, unknown> = {};

    // ========================================================================
    // STEP 1: Find stale generations (pending/processing > 10 min)
    // ========================================================================
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: staleGens } = await supabase
      .from('ai_generations')
      .select('id, fal_request_id, model, status, created_at')
      .in('status', ['pending', 'processing'])
      .lt('created_at', tenMinAgo)
      .limit(50);

    results.stale_found = staleGens?.length ?? 0;

    // ========================================================================
    // STEP 2: Poll fal.ai for stale generation status
    // ========================================================================
    let polled = 0;
    let autoCompleted = 0;
    if (staleGens && staleGens.length > 0) {
      for (const gen of staleGens) {
        if (gen.fal_request_id.startsWith('placeholder_')) continue;

        // Map model key to fal.ai model ID
        const modelConfig = MODELS[gen.model];
        if (!modelConfig) {
          console.warn('[ai-timeout] Unknown model for generation:', gen.id, gen.model);
          continue;
        }

        try {
          const statusUrl = `https://queue.fal.run/${modelConfig.modelId}/requests/${gen.fal_request_id}/status`;
          const res = await fetch(statusUrl, {
            headers: { Authorization: `Key ${process.env.FAL_KEY}` },
            signal: AbortSignal.timeout(5000),
          });

          if (res.ok) {
            const data = await res.json();
            polled++;

            if (data.status === 'COMPLETED' && data.response_url) {
              // Fetch the completed result
              try {
                const resultRes = await fetch(data.response_url, {
                  headers: { Authorization: `Key ${process.env.FAL_KEY}` },
                  signal: AbortSignal.timeout(5000),
                });

                if (resultRes.ok) {
                  const resultData = await resultRes.json();
                  const videoUrl = resultData.video?.url;

                  if (videoUrl) {
                    await supabase
                      .from('ai_generations')
                      .update({
                        status: 'completed',
                        video_url: videoUrl,
                        completed_at: new Date().toISOString(),
                      })
                      .eq('id', gen.id);
                    autoCompleted++;
                  }
                }
              } catch {
                // Ignore fetch errors for individual results
              }
            }
          }
        } catch {
          // Ignore individual polling errors
        }
      }
    }

    results.polled = polled;
    results.auto_completed = autoCompleted;

    // ========================================================================
    // STEP 3: Auto-fail generations stuck > 30 min
    // ========================================================================
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: failedGens, error: failError } = await supabase
      .from('ai_generations')
      .update({
        status: 'failed',
        error_message: 'Generation timed out after 30 minutes',
      })
      .in('status', ['pending', 'processing'])
      .lt('created_at', thirtyMinAgo)
      .select('id');

    results.auto_failed = failedGens?.length ?? 0;
    if (failError) {
      console.error('[ai-timeout] Auto-fail error:', failError);
    }

    // ========================================================================
    // STEP 4: Expire unclaimed completed > 24h
    // ========================================================================
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredGens, error: expireError } = await supabase
      .from('ai_generations')
      .update({
        status: 'expired',
        error_message: 'Expired: not submitted within 24 hours',
      })
      .eq('status', 'completed')
      .is('clip_id', null)
      .lt('completed_at', twentyFourHoursAgo)
      .select('id, storage_key');

    results.expired = expiredGens?.length ?? 0;
    if (expireError) {
      console.error('[ai-timeout] Expire error:', expireError);
    }

    // ========================================================================
    // STEP 5: Clean orphaned storage files from expired generations
    // ========================================================================
    let storageCleanedCount = 0;
    if (expiredGens && expiredGens.length > 0) {
      const keysToDelete = expiredGens
        .map((g) => g.storage_key)
        .filter((k): k is string => !!k);

      if (keysToDelete.length > 0) {
        const { data: r2Flag } = await supabase
          .from('feature_flags')
          .select('enabled')
          .eq('key', 'r2_storage')
          .maybeSingle();

        const provider = await getStorageProvider(r2Flag?.enabled ?? false);
        const result = await deleteFiles(keysToDelete, provider);

        if (result.error) {
          console.error('[ai-timeout] Storage cleanup error:', result.error);
        } else {
          storageCleanedCount = result.deleted;
        }
      }
    }

    results.storage_cleaned = storageCleanedCount;

    // Release lock
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'ai-generation-timeout');

    return NextResponse.json({
      ok: true,
      results,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ai-timeout] Unexpected error:', error);

    try {
      await supabase
        .from('cron_locks')
        .delete()
        .eq('job_name', 'ai-generation-timeout');
    } catch {
      // Ignore cleanup errors
    }

    return NextResponse.json(
      { ok: false, error: 'Unexpected error during AI timeout check' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
