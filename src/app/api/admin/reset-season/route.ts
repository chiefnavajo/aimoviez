// app/api/admin/reset-season/route.ts
// Reset a season for clean voting test
// Requires admin authentication
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin, checkAdminAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * POST /api/admin/reset-season
 * Reset active season for clean testing
 *
 * Body: {
 *   clear_votes?: boolean (default: false) - Clear all votes
 *   reset_clip_counts?: boolean (default: false) - Reset vote counts on clips
 *   start_slot?: number (default: 1) - Which slot to start voting on
 * }
 */
export async function POST(req: NextRequest) {
  // Rate limit: 50 admin actions per minute
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  // Get admin info for audit logging
  const adminAuth = await checkAdminAuth();

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json().catch(() => ({}));

    const {
      clear_votes = false,
      reset_clip_counts = false,
      start_slot: rawStartSlot = 1,
    } = body;

    // Validate start_slot parameter
    const start_slot = typeof rawStartSlot === 'number' && rawStartSlot >= 1 && rawStartSlot <= 75
      ? Math.floor(rawStartSlot)
      : 1;

    // 1. Get active season
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('id, label, total_slots, status')
      .eq('status', 'active')
      .maybeSingle();

    if (seasonError) {
      console.error('[reset-season] seasonError:', seasonError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch active season', details: seasonError.message },
        { status: 500 }
      );
    }

    if (!season) {
      return NextResponse.json(
        { ok: false, error: 'No active season found' },
        { status: 404 }
      );
    }

    // 2. Reset all story_slots for this season to 'upcoming'
    const { error: resetSlotsError } = await supabase
      .from('story_slots')
      .update({
        status: 'upcoming',
        winner_tournament_clip_id: null,
        voting_started_at: null,
        voting_ends_at: null,
      })
      .eq('season_id', season.id);

    if (resetSlotsError) {
      console.error('[reset-season] resetSlotsError:', resetSlotsError);
      return NextResponse.json(
        { ok: false, error: 'Failed to reset slots', details: resetSlotsError.message },
        { status: 500 }
      );
    }

    // 3. Set the start_slot to 'voting' with timer
    const now = new Date();
    const votingEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const { data: _votingSlot, error: setVotingError } = await supabase
      .from('story_slots')
      .update({
        status: 'voting',
        voting_started_at: now.toISOString(),
        voting_ends_at: votingEndsAt.toISOString(),
        voting_duration_hours: 24,
      })
      .eq('season_id', season.id)
      .eq('slot_position', start_slot)
      .select()
      .maybeSingle();

    if (setVotingError) {
      console.error('[reset-season] setVotingError:', setVotingError);
      return NextResponse.json(
        { ok: false, error: 'Failed to set voting slot', details: setVotingError.message },
        { status: 500 }
      );
    }

    // 4. Optionally reset vote counts on clips AND reset clip statuses
    if (reset_clip_counts) {
      // Reset all clips: vote counts to 0, status to 'active', move to slot 1
      // Also set season_id to current active season to ensure clips are found by vote API
      const { error: resetClipsError } = await supabase
        .from('tournament_clips')
        .update({
          vote_count: 0,
          weighted_score: 0,
          status: 'active',
          slot_position: start_slot,
          season_id: season.id, // Link clips to current active season
        })
        .neq('status', 'rejected'); // Don't touch rejected clips

      if (resetClipsError) {
        console.error('[reset-season] resetClipsError:', resetClipsError);
        // Non-fatal, continue
      } else {
        console.log('[reset-season] Reset all clip counts, statuses, positions, and season_id');
      }
    }

    // 5. Optionally clear votes
    if (clear_votes) {
      const { error: clearVotesError } = await supabase
        .from('votes')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

      if (clearVotesError) {
        console.error('[reset-season] clearVotesError:', clearVotesError);
        // Non-fatal, continue
      }
    }

    // 6. Get clips available for the voting slot
    const { data: clipsInSlot, count: clipCount } = await supabase
      .from('tournament_clips')
      .select('id, username, vote_count, genre, thumbnail_url', { count: 'exact' })
      .eq('slot_position', start_slot)
      .order('vote_count', { ascending: false })
      .limit(10);

    // Audit log the action
    await logAdminAction(req, {
      action: 'reset_season',
      resourceType: 'season',
      resourceId: season.id,
      adminEmail: adminAuth.email || 'unknown',
      adminId: adminAuth.userId || undefined,
      details: {
        seasonLabel: season.label,
        startSlot: start_slot,
        votesCleared: clear_votes,
        clipCountsReset: reset_clip_counts,
        clipsInSlot: clipCount || 0,
      },
    });

    // Broadcast to notify clients of season reset (so story board updates)
    try {
      console.log('[reset-season] Starting broadcast...');
      const broadcastPayload = {
        seasonId: season.id,
        startSlot: start_slot,
        timestamp: new Date().toISOString(),
      };

      // Create channel with broadcast config for server-side sending
      const channel = supabase.channel('story-updates', {
        config: {
          broadcast: {
            ack: true, // Wait for server acknowledgment
          },
        },
      });

      // Subscribe to channel first (required before sending)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Channel subscription timeout after 5s'));
        }, 5000);

        channel.subscribe((status, err) => {
          console.log('[reset-season] Channel subscription status:', status);
          if (status === 'SUBSCRIBED') {
            clearTimeout(timeout);
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timeout);
            reject(new Error(`Channel subscription failed: ${status} - ${err?.message || 'unknown'}`));
          }
        });
      });

      console.log('[reset-season] Channel subscribed, sending broadcast...');

      // Send the broadcast and wait for acknowledgment
      const sendResult = await channel.send({
        type: 'broadcast',
        event: 'season-reset',
        payload: broadcastPayload,
      });

      console.log('[reset-season] Broadcast send result:', sendResult);

      if (sendResult === 'ok') {
        console.log('[reset-season] Broadcast sent successfully:', broadcastPayload);
      } else {
        console.warn('[reset-season] Broadcast send returned:', sendResult);
      }

      // Delay to ensure message is delivered to all subscribers before unsubscribing
      await new Promise(resolve => setTimeout(resolve, 250));

      // Unsubscribe after sending
      await channel.unsubscribe();
      console.log('[reset-season] Channel unsubscribed');
    } catch (broadcastError) {
      // Don't fail the request if broadcast fails
      console.error('[reset-season] Broadcast error (non-fatal):', broadcastError);
    }

    return NextResponse.json({
      ok: true,
      message: `Season "${season.label || 'Season'}" reset successfully`,
      season_id: season.id,
      voting_slot: start_slot,
      voting_ends_at: votingEndsAt.toISOString(),
      clips_in_slot: clipCount || 0,
      top_clips: clipsInSlot || [],
      actions: {
        slots_reset: true,
        votes_cleared: clear_votes,
        clip_counts_reset: reset_clip_counts,
      },
    }, { status: 200 });

  } catch (err: unknown) {
    console.error('[reset-season] Unexpected error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
