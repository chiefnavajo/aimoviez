// app/api/admin/advance-slot/route.ts
// Zamknięcie aktualnego slotu i przejście do następnego
// Requires admin authentication
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';
import { clearSlotLeaderboard } from '@/lib/leaderboard-redis';
import { setSlotState, clearVotingFrozen } from '@/lib/vote-validation-redis';
import { clearClips } from '@/lib/crdt-vote-counter';
import { forceSyncCounters } from '@/lib/counter-sync';

function createSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('[advance-slot] Missing Supabase environment variables. SUPABASE_SERVICE_ROLE_KEY is required for admin operations.');
  }

  return createClient(supabaseUrl, supabaseKey);
}


interface SeasonRow {
  id: string;
  status: 'draft' | 'active' | 'finished';
  label?: string;
  total_slots?: number;
}

interface StorySlotRow {
  id: string;
  season_id: string;
  slot_position: number;
  status: 'upcoming' | 'voting' | 'locked' | 'waiting_for_clips';
  genre: string | null;
  winner_tournament_clip_id?: string | null;
  voting_duration_hours?: number | null;
}

interface _TournamentClipRow {
  id: string;
  slot_position: number;
  vote_count: number | null;
  weighted_score: number | null;
}

export async function POST(req: NextRequest) {
  // Rate limit: 50 admin actions per minute
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  // Get admin info for audit logging
  const adminAuth = await checkAdminAuth();

  const supabase = createSupabaseServerClient();

  // --- Distributed lock: prevent race with auto-advance cron ---
  const lockId = `adv_admin_${Date.now()}`;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60000).toISOString();

  // Delete expired locks, then try to acquire
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
      acquired_at: now,
      expires_at: expiresAt,
    });

  if (lockError) {
    return NextResponse.json(
      { ok: false, error: 'Slot advancement in progress by another process. Please wait and try again.' },
      { status: 409 }
    );
  }

  try {
    // Parse optional season_id or genre from request body (for multi-genre support)
    let targetSeasonId: string | undefined;
    let targetGenre: string | undefined;
    try {
      const body = await req.json();
      targetSeasonId = body.season_id;
      targetGenre = body.genre;
    } catch {
      // No body or invalid JSON - use default behavior
    }

    // Check if multi_genre_enabled before accepting genre parameter
    if (targetGenre) {
      const { data: multiGenreFlag } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'multi_genre_enabled')
        .maybeSingle();

      if (!multiGenreFlag?.enabled) {
        // Genre parameter not supported when multi-genre is disabled
        console.warn('[advance-slot] Genre parameter ignored - multi_genre_enabled is disabled');
        targetGenre = undefined;
      }
    }

    // Check if multi-genre is enabled (for requiring season_id or genre)
    const { data: multiGenreFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'multi_genre_enabled')
      .maybeSingle();

    const multiGenreEnabled = multiGenreFlag?.enabled ?? false;

    // SECURITY: When multi-genre is enabled, require explicit season_id or genre
    // to prevent accidentally advancing the wrong season
    if (multiGenreEnabled && !targetSeasonId && !targetGenre) {
      return NextResponse.json(
        { ok: false, error: 'season_id or genre is required when multi-genre is enabled' },
        { status: 400 }
      );
    }

    // 1. Get Season - by ID, by genre, or first active
    let seasonQuery = supabase
      .from('seasons')
      .select('id, status, label, total_slots, genre')
      .eq('status', 'active');

    if (targetSeasonId) {
      // Specific season by ID
      seasonQuery = seasonQuery.eq('id', targetSeasonId);
    } else if (targetGenre) {
      // Season by genre
      seasonQuery = seasonQuery.eq('genre', targetGenre.toLowerCase());
    }

    const { data: season, error: seasonError } = await seasonQuery
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (seasonError) {
      console.error('[advance-slot] seasonError:', seasonError);
      return NextResponse.json(
        { ok: false, error: 'Failed to load active season' },
        { status: 500 }
      );
    }

    if (!season) {
      return NextResponse.json(
        { ok: false, error: 'No active season found' },
        { status: 400 }
      );
    }

    const seasonRow = season as SeasonRow;

    // 2. Aktywny slot (status = 'voting')
    const { data: slot, error: slotError } = await supabase
      .from('story_slots')
      .select('id, season_id, slot_position, status, genre, winner_tournament_clip_id, voting_duration_hours')
      .eq('season_id', seasonRow.id)
      .eq('status', 'voting')
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (slotError) {
      console.error('[advance-slot] slotError:', slotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to load active slot' },
        { status: 500 }
      );
    }

    if (!slot) {
      return NextResponse.json(
        { ok: false, error: 'No active slot with status=voting' },
        { status: 400 }
      );
    }

    const storySlot = slot as StorySlotRow;

    // 2b. Pre-winner sync: sync CRDT counters to PostgreSQL before winner selection
    try {
      const { data: slotClips } = await supabase
        .from('tournament_clips')
        .select('id')
        .eq('slot_position', storySlot.slot_position)
        .eq('season_id', seasonRow.id)
        .eq('status', 'active');

      if (slotClips && slotClips.length > 0) {
        const clipIds = slotClips.map(c => c.id);
        const syncResult = await forceSyncCounters(supabase, clipIds);
        console.log(`[advance-slot] Pre-winner sync: ${syncResult.synced} clips synced for slot ${storySlot.slot_position}`);
      }
    } catch (syncErr) {
      console.warn('[advance-slot] Pre-winner sync failed (using existing DB values):', syncErr);
    }

    // 3. OPTIMIZED: Get winner directly from database (single query, no JS loop)
    const { data: winner, error: winnerError } = await supabase
      .from('tournament_clips')
      .select('id, slot_position, vote_count, weighted_score')
      .eq('slot_position', storySlot.slot_position)
      .eq('season_id', seasonRow.id)
      .eq('status', 'active')
      .order('weighted_score', { ascending: false, nullsFirst: false })
      .order('vote_count', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true })  // tiebreaker: first submitted wins
      .limit(1)
      .maybeSingle();

    if (winnerError) {
      console.error('[advance-slot] winnerError:', winnerError);
      return NextResponse.json(
        { ok: false, error: 'Failed to find winner for active slot' },
        { status: 500 }
      );
    }

    if (!winner) {
      return NextResponse.json(
        {
          ok: false,
          error: 'No clips found for current slot – cannot choose winner',
        },
        { status: 400 }
      );
    }

    // 5. Zamknij aktywny slot: status = 'locked', ustaw winner_tournament_clip_id
    // FIX: Add .eq('status', 'voting') guard to prevent double-advance.
    // If another process already advanced this slot (status != 'voting'),
    // the update returns no rows and we detect the conflict.
    const { data: lockedSlot, error: updateSlotError } = await supabase
      .from('story_slots')
      .update({
        status: 'locked',
        winner_tournament_clip_id: winner.id,
      })
      .eq('id', storySlot.id)
      .eq('status', 'voting')
      .select('id')
      .maybeSingle();

    if (updateSlotError) {
      console.error('[advance-slot] updateSlotError:', updateSlotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to lock current slot' },
        { status: 500 }
      );
    }

    if (!lockedSlot) {
      // Slot was already advanced by another process (double-advance prevented)
      console.warn(`[advance-slot] Slot ${storySlot.slot_position} was already advanced by another process`);
      return NextResponse.json(
        { ok: false, error: 'Slot was already advanced by another process' },
        { status: 409 }
      );
    }

    // Clear Redis leaderboard for this slot (prevents stale data in next round)
    await clearSlotLeaderboard(seasonRow.id, storySlot.slot_position);

    // Clear voting freeze flag for the transitioned slot
    try {
      await clearVotingFrozen(seasonRow.id, storySlot.slot_position);
    } catch (e) {
      console.warn('[advance-slot] Failed to clear freeze key:', e);
    }

    // 5b. Mark the winning clip as 'locked' (winner status)
    // IMPORTANT: This must succeed before moving other clips to prevent race conditions
    const { error: lockWinnerError } = await supabase
      .from('tournament_clips')
      .update({ status: 'locked' })
      .eq('id', winner.id);

    if (lockWinnerError) {
      console.error('[advance-slot] lockWinnerError:', lockWinnerError);
      // This is now a fatal error - we must lock the winner before proceeding
      return NextResponse.json(
        { ok: false, error: 'Failed to lock winning clip. Please try again.' },
        { status: 500 }
      );
    }

    // Verify the winner is locked before proceeding
    const { data: verifyWinner } = await supabase
      .from('tournament_clips')
      .select('status')
      .eq('id', winner.id)
      .single();

    if (verifyWinner?.status !== 'locked') {
      console.error('[advance-slot] Winner status verification failed:', verifyWinner);
      return NextResponse.json(
        { ok: false, error: 'Winner status not updated correctly. Please try again.' },
        { status: 500 }
      );
    }

    // Fire-and-forget: extract last frame for story continuity
    fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/internal/extract-frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
      body: JSON.stringify({ clipId: winner.id }),
    }).catch(e => console.warn('[advance-slot] Frame extraction failed (non-fatal):', e));

    // 6. Przygotuj następny slot
    const nextPosition = storySlot.slot_position + 1;

    // Jeśli nie znamy total_slots, spróbujmy z SeasonRow.total_slots, inaczej przyjmij 75
    const totalSlots = seasonRow.total_slots ?? 75;

    if (nextPosition > totalSlots) {
      // Nie ma kolejnego slotu – kończymy Season
      const { error: finishSeasonError } = await supabase
        .from('seasons')
        .update({ status: 'finished' })
        .eq('id', seasonRow.id);

      if (finishSeasonError) {
        console.error('[advance-slot] finishSeasonError:', finishSeasonError);
        return NextResponse.json(
          {
            ok: false,
            error:
              'Current slot locked, but failed to mark season as finished',
          },
          { status: 500 }
        );
      }

      // Eliminate any remaining active clips in the season
      await supabase
        .from('tournament_clips')
        .update({
          status: 'eliminated',
          eliminated_at: new Date().toISOString(),
          elimination_reason: 'season_ended',
        })
        .eq('season_id', seasonRow.id)
        .eq('status', 'active');

      // Audit log season finish
      await logAdminAction(req, {
        action: 'advance_slot',
        resourceType: 'season',
        resourceId: seasonRow.id,
        adminEmail: adminAuth.email || 'unknown',
        adminId: adminAuth.userId || undefined,
        details: {
          slotLocked: storySlot.slot_position,
          winnerClipId: winner.id,
          seasonFinished: true,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          finished: true,
          message: 'Last slot locked, season finished. Create a new season from the admin panel.',
          winnerClipId: winner.id,
        },
        { status: 200 }
      );
    }

    // 7. Eliminate losing clips — they don't carry forward to next slot
    const { data: eliminatedClips, error: eliminateError } = await supabase
      .from('tournament_clips')
      .update({
        status: 'eliminated',
        eliminated_at: new Date().toISOString(),
        elimination_reason: 'lost',
      })
      .eq('slot_position', storySlot.slot_position)
      .eq('season_id', seasonRow.id)
      .eq('status', 'active')
      .neq('id', winner.id)
      .select('id, user_id, title');

    if (eliminateError) {
      console.error('[advance-slot] eliminateError:', eliminateError);
    }

    const clipsEliminatedCount = eliminatedClips?.length ?? 0;
    console.log(`[advance-slot] Eliminated ${clipsEliminatedCount} losing clips from slot ${storySlot.slot_position}`);

    // Clear CRDT keys for the locked slot's clips
    try {
      const allSlotClipIds = [winner.id, ...(eliminatedClips?.map(c => c.id) ?? [])];
      await clearClips(allSlotClipIds);
      console.log(`[advance-slot] Cleared CRDT keys for ${allSlotClipIds.length} clips in slot ${storySlot.slot_position}`);
    } catch (clearErr) {
      console.warn('[advance-slot] Failed to clear CRDT keys (non-fatal):', clearErr);
    }

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

          for (const elClip of eliminatedClips) {
            if (!elClip.user_id) continue;
            await createNotification({
              user_key: `user_${elClip.user_id}`,
              type: 'clip_rejected',
              title: 'Your clip was eliminated',
              message: `"${elClip.title || 'Untitled'}" didn't win Slot ${storySlot.slot_position}. Download or pin it within ${graceDays} days to keep the video.`,
              action_url: '/profile',
              metadata: { clipId: elClip.id, graceDays, slotPosition: storySlot.slot_position },
            });
          }
        } catch (e) {
          console.error('[advance-slot] Elimination notification error (non-fatal):', e);
        }
      })();
    }

    // 7b. Check if next slot already has clips (from new uploads)
    const { count: nextSlotClipCount } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('slot_position', nextPosition)
      .eq('season_id', seasonRow.id)
      .eq('status', 'active');

    if (!nextSlotClipCount || nextSlotClipCount === 0) {
      // No clips in next slot — set to waiting_for_clips
      console.log(`[advance-slot] No clips for slot ${nextPosition} - setting to waiting_for_clips`);

      const { data: waitingSlot, error: waitingSlotError } = await supabase
        .from('story_slots')
        .update({
          status: 'waiting_for_clips',
          voting_started_at: null,
          voting_ends_at: null,
        })
        .eq('season_id', seasonRow.id)
        .eq('slot_position', nextPosition)
        .select('id')
        .maybeSingle();

      if (waitingSlotError) {
        console.error('[advance-slot] waitingSlotError:', waitingSlotError);
      }

      await logAdminAction(req, {
        action: 'advance_slot',
        resourceType: 'slot',
        resourceId: storySlot.id,
        adminEmail: adminAuth.email || 'unknown',
        adminId: adminAuth.userId || undefined,
        details: {
          slotLocked: storySlot.slot_position,
          winnerClipId: winner.id,
          seasonFinished: false,
          nextSlotStatus: 'waiting_for_clips',
          nextSlotId: waitingSlot?.id,
          clipsEliminated: clipsEliminatedCount,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          finished: false,
          waitingForClips: true,
          currentSlotLocked: storySlot.slot_position,
          winnerClipId: winner.id,
          clipsEliminated: clipsEliminatedCount,
          message: `Slot ${storySlot.slot_position} locked. Slot ${nextPosition} waiting for clips.`,
          nextSlotPosition: nextPosition,
        },
        { status: 200 }
      );
    }

    // 8. Clips exist in next slot — activate voting

    const durationHours = storySlot.voting_duration_hours || 24;
    const now = new Date();
    const votingEndsAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

    const { data: nextSlot, error: nextSlotError } = await supabase
      .from('story_slots')
      .update({
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: votingEndsAt.toISOString(),
        voting_duration_hours: durationHours,
      })
      .eq('season_id', seasonRow.id)
      .eq('slot_position', nextPosition)
      .select('id, season_id, slot_position, status')
      .maybeSingle();

    if (nextSlotError) {
      console.error('[advance-slot] nextSlotError:', nextSlotError);
      return NextResponse.json(
        { ok: false, error: 'Failed to activate next slot' },
        { status: 500 }
      );
    }

    if (!nextSlot) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No next slot found to set as voting – data inconsistency in story_slots',
        },
        { status: 500 }
      );
    }

    // Update Redis slot state cache for the new voting slot
    try {
      await setSlotState(seasonRow.id, {
        slotPosition: nextPosition,
        status: 'voting',
        votingEndsAt: votingEndsAt.toISOString(),
      });
    } catch (stateErr) {
      console.warn('[advance-slot] Failed to set Redis slot state (non-fatal):', stateErr);
    }

    // Audit log the slot advance
    await logAdminAction(req, {
      action: 'advance_slot',
      resourceType: 'slot',
      resourceId: storySlot.id,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        slotLocked: storySlot.slot_position,
        winnerClipId: winner.id,
        nextSlotPosition: nextPosition,
        clipsEliminated: clipsEliminatedCount,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        finished: false,
        currentSlotLocked: storySlot.slot_position,
        winnerClipId: winner.id,
        nextSlotPosition: nextPosition,
        votingEndsAt: votingEndsAt.toISOString(),
        clipsEliminated: clipsEliminatedCount,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[advance-slot] Unexpected error:', error);
    return NextResponse.json(
      { ok: false, error: 'Unexpected error during advance-slot' },
      { status: 500 }
    );
  } finally {
    // Release lock
    await supabase
      .from('cron_locks')
      .delete()
      .eq('job_name', 'auto-advance')
      .eq('lock_id', lockId);
  }
}
