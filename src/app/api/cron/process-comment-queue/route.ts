// app/api/cron/process-comment-queue/route.ts
// ============================================================================
// COMMENT QUEUE PROCESSOR
// Dequeues comment events from Redis and persists them to PostgreSQL.
// Runs every minute via Vercel Cron. Only active when async_comments is enabled.
// Mirrors process-vote-queue pattern.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  popCommentEvents,
  acknowledgeCommentEvents,
  acknowledgeCommentEvent,
  moveCommentToDeadLetter,
  recoverCommentOrphans,
  setCommentLastProcessedAt,
  getCommentQueueHealth,
  pushCommentEvent,
} from '@/lib/comment-event-queue';
import type { CommentQueueEvent } from '@/lib/comment-event-queue';

// ============================================================================
// CONFIGURATION
// ============================================================================

const BATCH_SIZE = 200;
const MAX_RETRIES = 5;
const DB_BATCH_SIZE = 50;

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
      console.error('[process-comment-queue] CRON_SECRET not set in production');
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
    .eq('key', 'async_comments')
    .maybeSingle();

  if (!flag?.enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'async_comments disabled' });
  }

  // --- 3. Distributed lock ---
  const lockId = `pcq_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 60000).toISOString();

  const { data: existingLock } = await supabase
    .from('cron_locks')
    .select('lock_id, expires_at')
    .eq('job_name', 'process_comment_queue')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (existingLock) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Lock held by another instance' }, { status: 202 });
  }

  await supabase
    .from('cron_locks')
    .upsert({
      job_name: 'process_comment_queue',
      lock_id: lockId,
      acquired_at: new Date().toISOString(),
      expires_at: expiresAt,
    }, { onConflict: 'job_name' });

  try {
    // --- 4. Recover orphans ---
    const recovered = await recoverCommentOrphans();
    if (recovered > 0) {
      console.log(`[process-comment-queue] Recovered ${recovered} orphaned events`);
    }

    // --- 5. Dequeue batch ---
    const events = await popCommentEvents(BATCH_SIZE);

    if (events.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, recovered, message: 'Queue empty' });
    }

    console.log(`[process-comment-queue] Processing ${events.length} events`);

    // --- 6. Separate by action ---
    const creates = events.filter(e => e.action === 'create');
    const likes = events.filter(e => e.action === 'like');
    const unlikes = events.filter(e => e.action === 'unlike');
    const deletes = events.filter(e => e.action === 'delete');

    const successfulEvents: CommentQueueEvent[] = [];
    const failedEvents: { event: CommentQueueEvent; error: string }[] = [];

    // --- 7. Batch INSERT for comment creates ---
    if (creates.length > 0) {
      for (let i = 0; i < creates.length; i += DB_BATCH_SIZE) {
        const batch = creates.slice(i, i + DB_BATCH_SIZE);
        const insertRows = batch.map(event => ({
          id: event.eventId,
          clip_id: event.clipId,
          user_key: event.userKey,
          username: event.data.username || 'Anonymous',
          avatar_url: event.data.avatarUrl || null,
          comment_text: event.data.commentText || '',
          parent_comment_id: event.data.parentCommentId || null,
          created_at: new Date(event.timestamp).toISOString(),
          updated_at: new Date(event.timestamp).toISOString(),
        }));

        const { error } = await supabase
          .from('comments')
          .insert(insertRows);

        if (error) {
          console.error('[process-comment-queue] Batch insert error:', error.message);
          // Try individual inserts for the failed batch
          for (let j = 0; j < batch.length; j++) {
            const { error: singleError } = await supabase
              .from('comments')
              .insert([insertRows[j]]);

            if (singleError) {
              failedEvents.push({ event: batch[j], error: singleError.message });
            } else {
              successfulEvents.push(batch[j]);
            }
          }
        } else {
          successfulEvents.push(...batch);
        }
      }
    }

    // --- 8. Process likes ---
    for (const event of likes) {
      const commentId = event.data.commentId;
      if (!commentId) {
        failedEvents.push({ event, error: 'Missing commentId for like action' });
        continue;
      }

      const { error } = await supabase
        .from('comment_likes')
        .insert({
          comment_id: commentId,
          user_key: event.userKey,
          created_at: new Date(event.timestamp).toISOString(),
        });

      if (error) {
        // 23505 = unique violation (already liked) — treat as success
        if (error.code === '23505') {
          successfulEvents.push(event);
        } else {
          failedEvents.push({ event, error: error.message });
        }
      } else {
        successfulEvents.push(event);
      }
    }

    // --- 9. Process unlikes ---
    for (const event of unlikes) {
      const commentId = event.data.commentId;
      if (!commentId) {
        failedEvents.push({ event, error: 'Missing commentId for unlike action' });
        continue;
      }

      const { error } = await supabase
        .from('comment_likes')
        .delete()
        .eq('comment_id', commentId)
        .eq('user_key', event.userKey);

      if (error) {
        failedEvents.push({ event, error: error.message });
      } else {
        successfulEvents.push(event);
      }
    }

    // --- 10. Process deletes (soft delete) ---
    for (const event of deletes) {
      const commentId = event.data.commentId;
      if (!commentId) {
        failedEvents.push({ event, error: 'Missing commentId for delete action' });
        continue;
      }

      const { error } = await supabase
        .from('comments')
        .update({ is_deleted: true })
        .eq('id', commentId)
        .eq('user_key', event.userKey);

      if (error) {
        failedEvents.push({ event, error: error.message });
      } else {
        successfulEvents.push(event);
      }
    }

    // --- 11. Acknowledge successful events ---
    if (successfulEvents.length > 0) {
      await acknowledgeCommentEvents(successfulEvents);
    }

    // --- 12. Handle failures ---
    for (const { event, error } of failedEvents) {
      const attempts = ((event.metadata?.retryCount as number) || 0) + 1;
      if (attempts >= MAX_RETRIES) {
        await moveCommentToDeadLetter(event, error, attempts);
        console.warn(`[process-comment-queue] Event dead-lettered after ${attempts} attempts:`, event.eventId);
      } else {
        // Re-enqueue with incremented retry count
        const retriedEvent: CommentQueueEvent = {
          ...event,
          metadata: { ...event.metadata, retryCount: attempts },
        };
        await acknowledgeCommentEvent(event);
        await pushCommentEvent(retriedEvent);
      }
    }

    // --- 13. Update last processed timestamp ---
    await setCommentLastProcessedAt();

    // --- 14. Health report ---
    const health = await getCommentQueueHealth();

    return NextResponse.json({
      ok: true,
      processed: successfulEvents.length,
      failed: failedEvents.length,
      recovered,
      breakdown: {
        creates: creates.length,
        likes: likes.length,
        unlikes: unlikes.length,
        deletes: deletes.length,
      },
      health,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[process-comment-queue] Unexpected error:', error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  } finally {
    // --- Release lock ---
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'process_comment_queue')
      .eq('lock_id', lockId);
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
