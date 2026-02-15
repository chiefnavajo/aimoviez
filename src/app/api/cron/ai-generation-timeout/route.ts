// app/api/cron/ai-generation-timeout/route.ts
// ============================================================================
// AI GENERATION TIMEOUT CRON
// Handles stale generations, expired completions, and orphaned storage.
// Runs every 5 minutes via Vercel Cron.
// ============================================================================

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MODELS, checkFalStatus } from '@/lib/ai-video';
import { getStorageProvider, deleteFiles } from '@/lib/storage';
import { verifyCronAuth } from '@/lib/cron-auth';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  // Verify CRON_SECRET (timing-safe)
  const authError = verifyCronAuth(req.headers.get('authorization'));
  if (authError) return authError;

  const supabase = getSupabase();
  const lockId = `ai-timeout-${Date.now()}`;

  try {
    // ========================================================================
    // DISTRIBUTED LOCK
    // ========================================================================
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

        if (!MODELS[gen.model]) {
          console.warn('[ai-timeout] Unknown model for generation:', gen.id, gen.model);
          continue;
        }

        try {
          const falResult = await checkFalStatus(gen.model, gen.fal_request_id);
          polled++;

          if (falResult.status === 'COMPLETED' && falResult.videoUrl) {
            await supabase
              .from('ai_generations')
              .update({
                status: 'completed',
                video_url: falResult.videoUrl,
                completed_at: new Date().toISOString(),
              })
              .eq('id', gen.id);
            autoCompleted++;
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
      .select('id, user_id, credit_deducted, credit_amount');

    results.auto_failed = failedGens?.length ?? 0;
    if (failError) {
      console.error('[ai-timeout] Auto-fail error:', failError);
    }

    // ========================================================================
    // STEP 3b: Refund credits for auto-failed generations
    // ========================================================================
    let creditsRefunded = 0;
    if (failedGens && failedGens.length > 0) {
      for (const gen of failedGens) {
        if (gen.credit_deducted && gen.credit_amount && gen.user_id) {
          try {
            const { data: refundResult } = await supabase.rpc('refund_credits', {
              p_user_id: gen.user_id,
              p_generation_id: gen.id,
            });
            if (refundResult?.success) {
              creditsRefunded += refundResult.refunded;
              console.info(`[ai-timeout] Refunded ${refundResult.refunded} credits for timed-out generation:`, gen.id);
            }
          } catch (err) {
            console.error('[ai-timeout] Credit refund error for generation:', gen.id, err);
          }
        }
      }
    }
    results.credits_refunded = creditsRefunded;

    // ========================================================================
    // STEP 3c: Find orphaned credit transactions (failed with credits but no refund)
    // ========================================================================
    const { data: orphanedGens } = await supabase
      .from('ai_generations')
      .select('id, user_id, credit_amount')
      .eq('status', 'failed')
      .eq('credit_deducted', true)
      .not('credit_amount', 'is', null)
      .lt('created_at', tenMinAgo)
      .limit(20);

    let orphanedRefunded = 0;
    if (orphanedGens && orphanedGens.length > 0) {
      for (const gen of orphanedGens) {
        // Check if already refunded
        const { data: existingRefund } = await supabase
          .from('credit_transactions')
          .select('id')
          .eq('reference_id', gen.id)
          .eq('type', 'refund')
          .maybeSingle();

        if (!existingRefund && gen.user_id) {
          try {
            const { data: refundResult } = await supabase.rpc('refund_credits', {
              p_user_id: gen.user_id,
              p_generation_id: gen.id,
            });
            if (refundResult?.success) {
              orphanedRefunded += refundResult.refunded;
              console.info(`[ai-timeout] Recovered orphaned credits for generation:`, gen.id);
            }
          } catch (err) {
            console.error('[ai-timeout] Orphaned credit recovery error:', gen.id, err);
          }
        }
      }
    }
    results.orphaned_credits_recovered = orphanedRefunded;

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

    return NextResponse.json({
      ok: true,
      results,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ai-timeout] Unexpected error:', error);

    return NextResponse.json(
      { ok: false, error: 'Unexpected error during AI timeout check' },
      { status: 500 }
    );
  } finally {
    // Always release OUR lock (scoped by lock_id to prevent releasing another instance's lock)
    try {
      await supabase
        .from('cron_locks')
        .delete()
        .eq('job_name', 'ai-generation-timeout')
        .eq('lock_id', lockId);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
