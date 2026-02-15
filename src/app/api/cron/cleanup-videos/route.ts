// app/api/cron/cleanup-videos/route.ts
// ============================================
// VIDEO CLEANUP CRON
// Deletes video files from storage for eliminated/rejected clips
// after the admin-configurable grace period (default 14 days).
// Pinned clips are preserved indefinitely.
// ============================================

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createClient } from '@supabase/supabase-js';
import { extractStorageKey, deleteFiles } from '@/lib/storage';

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key);
}

const BATCH_SIZE = 50;

export async function GET(req: NextRequest) {
  const authError = verifyCronAuth(req.headers.get('authorization'));
  if (authError) return authError;

  const supabase = createSupabaseClient();

  // FIX: Add distributed lock to prevent concurrent execution
  const lockId = `cleanup-videos-${Date.now()}`;
  const expiresAt = new Date(Date.now() + 120000).toISOString(); // 2 minute lock

  // Clean up expired locks first
  const now = new Date().toISOString();
  await supabase
    .from('cron_locks')
    .delete()
    .eq('job_name', 'cleanup_videos')
    .lt('expires_at', now);

  // Try to acquire lock
  const { error: lockError } = await supabase
    .from('cron_locks')
    .insert({
      job_name: 'cleanup_videos',
      lock_id: lockId,
      acquired_at: now,
      expires_at: expiresAt,
    });

  if (lockError) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Lock held by another instance'
    }, { status: 202 });
  }

  try {
    // Read grace period from feature flags
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('config')
      .eq('key', 'clip_elimination')
      .maybeSingle();

    const gracePeriodDays = (flag?.config as Record<string, number>)?.grace_period_days ?? 14;
    const cutoffDate = new Date(Date.now() - gracePeriodDays * 24 * 60 * 60 * 1000).toISOString();

    // Find clips eligible for video deletion
    const { data: clips, error: queryError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url')
      .in('status', ['eliminated', 'rejected'])
      .eq('is_pinned', false)
      .is('video_deleted_at', null)
      .lt('eliminated_at', cutoffDate)
      .not('video_url', 'is', null)
      .limit(BATCH_SIZE);

    if (queryError) {
      console.error('[cleanup-videos] Query error:', queryError);
      return NextResponse.json({ error: 'Failed to query clips' }, { status: 500 });
    }

    if (!clips || clips.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'No videos to clean up',
        gracePeriodDays,
      });
    }

    let deletedCount = 0;
    let errorCount = 0;
    const processedIds: string[] = [];

    for (const clip of clips) {
      try {
        const keysToDelete: { key: string; provider: 'supabase' | 'r2' }[] = [];

        // Extract video storage key
        if (clip.video_url) {
          const videoKey = extractStorageKey(clip.video_url);
          if (videoKey) keysToDelete.push(videoKey);
        }

        // Extract thumbnail storage key
        if (clip.thumbnail_url && clip.thumbnail_url !== clip.video_url) {
          const thumbKey = extractStorageKey(clip.thumbnail_url);
          if (thumbKey) keysToDelete.push(thumbKey);
        }

        // Group by provider and delete
        const supabaseKeys = keysToDelete.filter(k => k.provider === 'supabase').map(k => k.key);
        const r2Keys = keysToDelete.filter(k => k.provider === 'r2').map(k => k.key);

        if (supabaseKeys.length > 0) {
          await deleteFiles(supabaseKeys, 'supabase');
        }
        if (r2Keys.length > 0) {
          await deleteFiles(r2Keys, 'r2');
        }

        // Mark clip as video-deleted
        await supabase
          .from('tournament_clips')
          .update({
            video_deleted_at: new Date().toISOString(),
            video_url: null,
            thumbnail_url: null,
          })
          .eq('id', clip.id);

        processedIds.push(clip.id);
        deletedCount++;
      } catch (err) {
        console.error(`[cleanup-videos] Failed to process clip ${clip.id}:`, err);
        errorCount++;
      }
    }

    console.log(`[cleanup-videos] Processed ${deletedCount} clips, ${errorCount} errors`);

    return NextResponse.json({
      ok: true,
      processed: deletedCount,
      errors: errorCount,
      gracePeriodDays,
      clipIds: processedIds,
    });
  } catch (err) {
    console.error('[cleanup-videos] Unexpected error:', err);
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 });
  } finally {
    // Release the lock
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'cleanup_videos')
      .eq('lock_id', lockId);
  }
}
