// app/api/cron/process-vote-queue/route.ts
// ============================================================================
// VOTE QUEUE PROCESSOR
// Dequeues vote events from Redis and batch-inserts them into PostgreSQL.
// Runs every minute via Vercel Cron. Only active when async_voting is enabled.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  popEvents,
  acknowledgeEvents,
  acknowledgeEvent,
  moveToDeadLetter,
  recoverOrphans,
  setLastProcessedAt,
  getQueueHealth,
  pushEvent,
} from '@/lib/vote-event-queue';
import type { VoteQueueEvent } from '@/types/vote-queue';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BATCH_SIZE = 500;
const MAX_RETRIES = 5;
const DB_BATCH_SIZE = 100;

// ============================================================================
// HELPERS
// ============================================================================

function createSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================================================
// ROUTE HANDLER
// ============================================================================

export async function GET(req: NextRequest) {
  // --- 1. CRON_SECRET validation ---
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[process-vote-queue] CRON_SECRET not set in production');
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

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
  const lockId = `pvq_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();

  const { data: existingLock } = await supabase
    .from('cron_locks')
    .select('lock_id, expires_at')
    .eq('job_name', 'process_vote_queue')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existingLock) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Lock held by another instance' }, { status: 202 });
  }

  await supabase
    .from('cron_locks')
    .upsert({
      job_name: 'process_vote_queue',
      lock_id: lockId,
      acquired_at: new Date().toISOString(),
      expires_at: expiresAt,
    }, { onConflict: 'job_name' });

  try {
    // --- 4. Recover orphans ---
    const recovered = await recoverOrphans();
    if (recovered > 0) {
      console.log(`[process-vote-queue] Recovered ${recovered} orphaned events`);
    }

    // --- 5. Dequeue batch ---
    const events = await popEvents(BATCH_SIZE);

    if (events.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, recovered, message: 'Queue empty' });
    }

    console.log(`[process-vote-queue] Processing ${events.length} events`);

    // --- 6. Separate by direction ---
    const upVotes = events.filter(e => e.direction === 'up');
    const downVotes = events.filter(e => e.direction === 'down');

    const successfulEvents: VoteQueueEvent[] = [];
    const failedEvents: { event: VoteQueueEvent; error: string }[] = [];

    // --- 7. Batch INSERT for up-votes ---
    if (upVotes.length > 0) {
      for (let i = 0; i < upVotes.length; i += DB_BATCH_SIZE) {
        const batchEvents = upVotes.slice(i, i + DB_BATCH_SIZE);
        const insertRows = batchEvents.map(event => ({
          clip_id: event.clipId,
          voter_key: event.voterKey,
          user_id: (event.metadata?.userId as string) || null,
          vote_weight: (event.metadata?.weight as number) || 1,
          vote_type: 'standard',
          slot_position: (event.metadata?.slotPosition as number) || 1,
          flagged: (event.metadata?.flagged as boolean) || false,
          created_at: new Date(event.timestamp).toISOString(),
        }));

        const { error } = await supabase
          .from('votes')
          .upsert(insertRows, {
            onConflict: 'clip_id,voter_key',
            ignoreDuplicates: true,
          });

        if (error) {
          console.error('[process-vote-queue] Batch insert error:', error.message);
          // Try individual inserts for the failed batch
          for (let j = 0; j < batchEvents.length; j++) {
            const { error: singleError } = await supabase
              .from('votes')
              .upsert([insertRows[j]], {
                onConflict: 'clip_id,voter_key',
                ignoreDuplicates: true,
              });

            if (singleError) {
              failedEvents.push({ event: batchEvents[j], error: singleError.message });
            } else {
              successfulEvents.push(batchEvents[j]);
            }
          }
        } else {
          successfulEvents.push(...batchEvents);
        }
      }
    }

    // --- 8. DELETE for down-votes (unvotes) ---
    for (const event of downVotes) {
      const { error } = await supabase
        .from('votes')
        .delete()
        .eq('voter_key', event.voterKey)
        .eq('clip_id', event.clipId);

      if (error) {
        failedEvents.push({ event, error: error.message });
      } else {
        successfulEvents.push(event);
      }
    }

    // --- 9. Acknowledge successful events ---
    if (successfulEvents.length > 0) {
      await acknowledgeEvents(successfulEvents);
    }

    // --- 10. Handle failures ---
    for (const { event, error } of failedEvents) {
      const attempts = ((event.metadata?.retryCount as number) || 0) + 1;
      if (attempts >= MAX_RETRIES) {
        await moveToDeadLetter(event, error, attempts);
        console.warn(`[process-vote-queue] Event dead-lettered after ${attempts} attempts:`, event.voteId);
      } else {
        // Re-enqueue with incremented retry count
        const retriedEvent = {
          ...event,
          metadata: { ...event.metadata, retryCount: attempts },
        };
        await acknowledgeEvent(event);
        await pushEvent(retriedEvent);
      }
    }

    // --- 11. Update last processed timestamp ---
    await setLastProcessedAt();

    // --- 12. Health report ---
    const health = await getQueueHealth();

    return NextResponse.json({
      ok: true,
      processed: successfulEvents.length,
      failed: failedEvents.length,
      recovered,
      health,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[process-vote-queue] Unexpected error:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  } finally {
    // --- Release lock ---
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'process_vote_queue')
      .eq('lock_id', lockId);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
