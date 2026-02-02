// app/api/cron/auto-advance/route.ts
// ============================================
// AUTO-ADVANCE CRON JOB
// Checks for expired voting slots and advances them
// Call this via Vercel Cron or external service every minute
// ============================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { forceSyncCounters } from '@/lib/counter-sync';
import { clearClips } from '@/lib/crdt-vote-counter';
import { setSlotState, setVotingFrozen } from '@/lib/vote-validation-redis';

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}


export async function GET(req: NextRequest) {
  // Verify request is from Vercel Cron
  // Vercel sends this header automatically for cron jobs
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  // SECURITY: In production, CRON_SECRET is MANDATORY
  if (!cronSecret) {
    if (isProduction) {
      console.error('[auto-advance] CRITICAL: CRON_SECRET not configured in production');
      return NextResponse.json(
        { error: 'Server misconfiguration' },
        { status: 500 }
      );
    }
    // Only allow no-auth in development
    console.warn('[auto-advance] DEV MODE: Running without auth (not allowed in production)');
  }

  // Verify the secret matches (when configured)
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error('[auto-advance] Invalid CRON_SECRET provided');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createSupabaseClient();

  try {
    // ========================================================================
    // DISTRIBUTED LOCK - Prevent multiple instances from running simultaneously
    // ========================================================================
    const lockId = `auto-advance-${Date.now()}`;
    const lockExpiry = new Date(Date.now() + 60 * 1000).toISOString(); // 60 second lock

    // Atomic lock: delete expired, then insert (unique constraint prevents duplicates)
    const now = new Date().toISOString();
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'auto-advance')
      .lt('expires_at', now);

    const { error: lockError } = await supabase
      .from('cron_locks')
      .insert({
        job_name: 'auto-advance',
        lock_id: lockId,
        expires_at: lockExpiry,
        acquired_at: now,
      });

    if (lockError) {
      console.log('[auto-advance] Another instance is running, skipping');
      return NextResponse.json({
        ok: true,
        skipped: true,
        message: 'Another instance is already running',
      });
    }

    // ========================================================================
    // CHECK ASYNC VOTING FLAG
    // ========================================================================
    const { data: asyncFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'async_voting')
      .maybeSingle();

    const asyncVotingEnabled = asyncFlag?.enabled === true;

    // ========================================================================
    // VOTING FREEZE — freeze slots within 120s of expiry
    // Applied regardless of async_voting flag to prevent race conditions
    // during slot transitions on both sync and async vote paths
    // ========================================================================
    {
      const freezeWindowMs = 120_000; // 120 seconds
      const freezeThreshold = new Date(Date.now() + freezeWindowMs).toISOString();

      const { data: soonExpiring } = await supabase
        .from('story_slots')
        .select('slot_position, season_id, voting_ends_at')
        .eq('status', 'voting')
        .gt('voting_ends_at', new Date().toISOString())
        .lt('voting_ends_at', freezeThreshold);

      if (soonExpiring && soonExpiring.length > 0) {
        for (const slot of soonExpiring) {
          try {
            await setVotingFrozen(slot.season_id, slot.slot_position);
            console.log(`[auto-advance] Set voting freeze for season ${slot.season_id} slot ${slot.slot_position}`);
          } catch (err) {
            console.warn('[auto-advance] Failed to set voting freeze:', err);
          }
        }
      }
    }

    // ========================================================================
    // 1. Find expired voting slots
    const { data: expiredSlots, error: findError } = await supabase
      .from('story_slots')
      .select('*, seasons!inner(id, status, total_slots)')
      .eq('status', 'voting')
      .eq('seasons.status', 'active')
      .lt('voting_ends_at', new Date().toISOString())
      .order('slot_position', { ascending: true });

    if (findError) {
      console.error('[auto-advance] Find error:', findError);
      return NextResponse.json({ error: 'Failed to find expired slots' }, { status: 500 });
    }

    if (!expiredSlots || expiredSlots.length === 0) {
      // Release lock early so next cron invocation can run immediately if needed
      await supabase
        .from('cron_locks')
        .delete()
        .eq('job_name', 'auto-advance');

      return NextResponse.json({
        ok: true,
        message: 'No expired slots to advance',
        checked_at: new Date().toISOString()
      });
    }

    const results = [];

    // 2. Process each expired slot
    for (const slot of expiredSlots) {
      try {
        // --- Redis-first: sync CRDT counters to PostgreSQL before winner selection ---
        if (asyncVotingEnabled) {
          const { data: slotClips } = await supabase
            .from('tournament_clips')
            .select('id')
            .eq('slot_position', slot.slot_position)
            .eq('season_id', slot.season_id)
            .eq('status', 'active');

          if (slotClips && slotClips.length > 0) {
            const clipIds = slotClips.map(c => c.id);
            try {
              const syncResult = await forceSyncCounters(supabase, clipIds);
              console.log(`[auto-advance] Pre-winner sync: ${syncResult.synced} clips synced for slot ${slot.slot_position}`);
              if (syncResult.errors.length > 0) {
                console.warn('[auto-advance] Sync errors:', syncResult.errors);
              }
            } catch (syncErr) {
              console.error('[auto-advance] Pre-winner sync failed (using existing DB values):', syncErr);
            }
          }
        }

        // Get highest voted clip for this slot (filter by season_id for safety)
        const { data: topClip } = await supabase
          .from('tournament_clips')
          .select('id, weighted_score, vote_count, username')
          .eq('slot_position', slot.slot_position)
          .eq('season_id', slot.season_id)
          .eq('status', 'active')
          .order('weighted_score', { ascending: false, nullsFirst: false })
          .order('vote_count', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        if (!topClip) {
          // No clips in slot - set to waiting_for_clips instead of finishing season
          // Season should only finish when all 75 slots have winners
          console.log(`[auto-advance] Slot ${slot.slot_position} has no clips - setting to waiting_for_clips`);

          await supabase
            .from('story_slots')
            .update({
              status: 'waiting_for_clips',
              voting_started_at: null,
              voting_ends_at: null,
            })
            .eq('id', slot.id);

          results.push({
            slot_position: slot.slot_position,
            status: 'waiting_for_clips',
            reason: 'No clips in slot - waiting for uploads. Encourage users to upload!',
          });
          continue;
        }

        // Lock the current slot with winner
        const { error: lockError } = await supabase
          .from('story_slots')
          .update({
            status: 'locked',
            winner_tournament_clip_id: topClip.id,
          })
          .eq('id', slot.id);

        if (lockError) {
          console.error('[auto-advance] Lock error:', lockError);
          results.push({
            slot_position: slot.slot_position,
            status: 'error',
            reason: 'Failed to lock slot'
          });
          continue;
        }

        // Update clip status: winner gets 'locked'
        await supabase
          .from('tournament_clips')
          .update({ status: 'locked' })
          .eq('id', topClip.id);

        // Eliminate losing clips — they don't carry forward to next slot
        const nextSlotPosition = slot.slot_position + 1;
        const { data: eliminatedClips } = await supabase
          .from('tournament_clips')
          .update({
            status: 'eliminated',
            eliminated_at: new Date().toISOString(),
            elimination_reason: 'lost',
          })
          .eq('slot_position', slot.slot_position)
          .eq('season_id', slot.season_id)
          .eq('status', 'active')
          .select('id, user_id, title');

        const clipsEliminatedCount = eliminatedClips?.length ?? 0;

        // Notify eliminated clip owners (fire-and-forget)
        if (eliminatedClips && eliminatedClips.length > 0) {
          (async () => {
            try {
              const { createNotification } = await import('@/lib/notifications');
              const { data: flag } = await supabase
                .from('feature_flags')
                .select('config')
                .eq('key', 'clip_elimination')
                .maybeSingle();
              const graceDays = (flag?.config as Record<string, number>)?.grace_period_days ?? 14;

              for (const clip of eliminatedClips) {
                if (!clip.user_id) continue;
                await createNotification({
                  user_key: `user_${clip.user_id}`,
                  type: 'clip_rejected',
                  title: 'Your clip was eliminated',
                  message: `"${clip.title || 'Untitled'}" didn't win Slot ${slot.slot_position}. Download or pin it within ${graceDays} days to keep the video.`,
                  action_url: '/profile',
                  metadata: { clipId: clip.id, graceDays, slotPosition: slot.slot_position },
                });
              }
            } catch (e) {
              console.error('[auto-advance] Elimination notification error (non-fatal):', e);
            }
          })();
        }

        // --- Redis-first: clear CRDT keys for the locked slot's clips ---
        if (asyncVotingEnabled) {
          try {
            // Collect all clip IDs that were in this slot (winner + moved clips)
            const allSlotClipIds = [topClip.id, ...(eliminatedClips?.map(c => c.id) ?? [])];
            await clearClips(allSlotClipIds);
            console.log(`[auto-advance] Cleared CRDT keys for ${allSlotClipIds.length} clips in slot ${slot.slot_position}`);
          } catch (clearErr) {
            console.warn('[auto-advance] Failed to clear CRDT keys (non-fatal):', clearErr);
          }
        }

        // Check if this was the last slot
        const totalSlots = slot.seasons?.total_slots || 75;
        const nextPosition = slot.slot_position + 1;

        // ONLY finish season when all 75 slots are filled
        if (nextPosition > totalSlots) {
          // All slots filled - season is truly complete!
          await supabase
            .from('seasons')
            .update({ status: 'finished' })
            .eq('id', slot.season_id);

          // Eliminate any remaining active clips in the season (safety net)
          await supabase
            .from('tournament_clips')
            .update({
              status: 'eliminated',
              eliminated_at: new Date().toISOString(),
              elimination_reason: 'season_ended',
            })
            .eq('season_id', slot.season_id)
            .eq('status', 'active');

          results.push({
            slot_position: slot.slot_position,
            status: 'finished',
            winner_clip_id: topClip.id,
            winner_username: topClip.username,
            message: 'All 75 slots complete! Season finished.',
            clips_eliminated: clipsEliminatedCount,
          });
          continue;
        }

        // Check if next slot already has clips (from new uploads)
        const { count: nextSlotClipCount } = await supabase
          .from('tournament_clips')
          .select('id', { count: 'exact', head: true })
          .eq('slot_position', nextPosition)
          .eq('season_id', slot.season_id)
          .eq('status', 'active');

        if (!nextSlotClipCount || nextSlotClipCount === 0) {
          // No clips in next slot — set to waiting_for_clips
          console.log(`[auto-advance] No clips for slot ${nextPosition} - setting to waiting_for_clips`);

          const { error: waitingError } = await supabase
            .from('story_slots')
            .update({
              status: 'waiting_for_clips',
              voting_started_at: null,
              voting_ends_at: null,
            })
            .eq('season_id', slot.season_id)
            .eq('slot_position', nextPosition);

          if (waitingError) {
            console.error('[auto-advance] Failed to set waiting_for_clips:', waitingError);
          }

          results.push({
            slot_position: slot.slot_position,
            status: 'locked_waiting',
            winner_clip_id: topClip.id,
            winner_username: topClip.username,
            next_slot: nextPosition,
            next_status: 'waiting_for_clips',
            clips_eliminated: clipsEliminatedCount,
            message: `Slot ${slot.slot_position} locked. Slot ${nextPosition} waiting for clips.`,
          });
          continue;
        }

        // Clips exist in next slot — activate voting
        const durationHours = slot.voting_duration_hours || 24;
        const now = new Date();
        const votingEndsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

        const { error: nextError } = await supabase
          .from('story_slots')
          .update({
            status: 'voting',
            voting_started_at: now.toISOString(),
            voting_ends_at: votingEndsAt.toISOString(),
            voting_duration_hours: durationHours,
          })
          .eq('season_id', slot.season_id)
          .eq('slot_position', nextPosition);

        if (nextError) {
          console.error('[auto-advance] Next slot error:', nextError);
          results.push({
            slot_position: slot.slot_position,
            status: 'partial',
            reason: 'Locked but failed to activate next slot',
            winner_clip_id: topClip.id
          });
          continue;
        }

        // --- Redis-first: update slot state cache ---
        if (asyncVotingEnabled) {
          try {
            await setSlotState(slot.season_id, {
              slotPosition: nextPosition,
              status: 'voting',
              votingEndsAt: votingEndsAt.toISOString(),
            });
          } catch (stateErr) {
            console.warn('[auto-advance] Failed to set Redis slot state (non-fatal):', stateErr);
          }
        }

        results.push({
          slot_position: slot.slot_position,
          status: 'advanced',
          winner_clip_id: topClip.id,
          winner_username: topClip.username,
          winner_score: topClip.weighted_score,
          next_slot: nextPosition,
          next_ends_at: votingEndsAt.toISOString(),
          clips_eliminated: clipsEliminatedCount,
        });

      } catch (slotError) {
        console.error('[auto-advance] Slot processing error:', slotError);
        results.push({
          slot_position: slot.slot_position,
          status: 'error',
          reason: 'Processing exception'
        });
      }
    }

    // Release lock after completion
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'auto-advance');

    return NextResponse.json({
      ok: true,
      processed: results.length,
      results,
      checked_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('[auto-advance] Unexpected error:', error);

    // Release lock even on error
    try {
      const supabase = createSupabaseClient();
      await supabase
        .from('cron_locks')
        .delete()
        .eq('job_name', 'auto-advance');
    } catch {
      // Ignore cleanup errors
    }

    return NextResponse.json({
      ok: false,
      error: 'Unexpected error during auto-advance'
    }, { status: 500 });
  }
}

// POST endpoint for manual trigger from admin
export async function POST(req: NextRequest) {
  return GET(req);
}
