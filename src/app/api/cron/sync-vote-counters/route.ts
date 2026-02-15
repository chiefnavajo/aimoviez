// app/api/cron/sync-vote-counters/route.ts
// ============================================================================
// VOTE COUNTER SYNC
// Reads CRDT counters from Redis and batch-updates PostgreSQL.
// Runs every minute via Vercel Cron. Only active when async_voting is enabled.
// ============================================================================

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';
import { forceSyncCounters } from '@/lib/counter-sync';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** Redis key for the set of clips with recent votes */
const ACTIVE_CLIPS_KEY = 'clips_active';

// ============================================================================
// HELPERS
// ============================================================================

function createSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getRedis(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

// ============================================================================
// ROUTE HANDLER
// ============================================================================

export async function GET(req: NextRequest) {
  // --- 1. CRON_SECRET validation ---
  const authError = verifyCronAuth(req.headers.get('authorization'));
  if (authError) return authError;

  const supabase = createSupabaseClient();

  // --- 2. Feature flag check ---
  const { data: flag } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'async_voting')
    .maybeSingle();

  if (!flag?.enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'async_voting disabled' });
  }

  // --- 3. Distributed lock ---
  const lockId = `svc_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();

  // Atomic lock acquisition:
  // 1. Delete only expired locks for this job
  // 2. Insert new lock — unique constraint on job_name prevents duplicates
  // If another instance holds a valid lock, the insert fails (no TOCTOU race)
  const now = new Date().toISOString();
  await supabase
    .from('cron_locks')
    .delete()
    .eq('job_name', 'sync_vote_counters')
    .lt('expires_at', now);

  const { error: lockError } = await supabase
    .from('cron_locks')
    .insert({
      job_name: 'sync_vote_counters',
      lock_id: lockId,
      acquired_at: now,
      expires_at: expiresAt,
    });

  if (lockError) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Lock held by another instance' }, { status: 202 });
  }

  try {
    // --- 4. Get active clip IDs from Redis ---
    const redis = getRedis();
    const clipIds = await redis.smembers(ACTIVE_CLIPS_KEY);

    if (!clipIds || clipIds.length === 0) {
      return NextResponse.json({ ok: true, synced: 0, message: 'No active clips to sync' });
    }

    console.log(`[sync-vote-counters] Syncing ${clipIds.length} active clips`);

    // --- 5. Force-sync CRDT counters to PostgreSQL ---
    const result = await forceSyncCounters(supabase, clipIds as string[]);

    if (result.errors.length > 0) {
      console.warn(`[sync-vote-counters] ${result.errors.length} sync errors:`, result.errors);
    }

    return NextResponse.json({
      ok: true,
      synced: result.synced,
      errors: result.errors.length,
      totalClips: clipIds.length,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[sync-vote-counters] Unexpected error:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  } finally {
    // --- Release lock ---
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'sync_vote_counters')
      .eq('lock_id', lockId);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
