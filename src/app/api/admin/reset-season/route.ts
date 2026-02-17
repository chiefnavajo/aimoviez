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
 * Reset a season for clean testing
 *
 * Body: {
 *   season_id?: string - Specific season to reset (optional, defaults to active season)
 *   reactivate?: boolean (default: false) - Set season back to 'active' status (useful for finished seasons)
 *   clear_votes?: boolean (default: false) - Clear all votes for this season
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
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const {
      season_id,
      reactivate = false,
      clear_votes = false,
      reset_clip_counts = false,
      start_slot: rawStartSlot = 1,
    } = body;

    // Validate start_slot parameter
    const start_slot = typeof rawStartSlot === 'number' && rawStartSlot >= 1 && rawStartSlot <= 75
      ? Math.floor(rawStartSlot)
      : 1;

    // 1. Get season - either by ID or the active one
    let seasonQuery = supabase
      .from('seasons')
      .select('id, label, total_slots, status, genre');

    if (season_id) {
      // Reset specific season by ID (any status)
      seasonQuery = seasonQuery.eq('id', season_id);
    } else {
      // Backwards compatible: reset active season (genre-aware for multi-genre)
      seasonQuery = seasonQuery.eq('status', 'active');
      const genreParam = typeof body.genre === 'string' ? body.genre.toLowerCase() : undefined;
      if (genreParam) {
        seasonQuery = seasonQuery.eq('genre', genreParam);
      }
    }

    const { data: season, error: seasonError } = await seasonQuery
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (seasonError) {
      console.error('[reset-season] seasonError:', seasonError);
      return NextResponse.json(
        { ok: false, error: 'Failed to fetch season' },
        { status: 500 }
      );
    }

    if (!season) {
      return NextResponse.json(
        { ok: false, error: season_id ? `Season not found: ${season_id}` : 'No active season found' },
        { status: 404 }
      );
    }

    // Track state changes for response
    let wasReactivated = false;
    let clipsResetCount = 0;

    // 1b. If reactivate is true and season is not active, set it to active
    if (reactivate && season.status !== 'active') {
      // First, set other active seasons of the SAME GENRE to 'finished'
      // This preserves multi-genre: Action, Comedy, Horror can run in parallel
      const seasonGenre = (season as { genre?: string }).genre;
      let deactivateQuery = supabase
        .from('seasons')
        .update({ status: 'finished' })
        .eq('status', 'active')
        .neq('id', season.id);

      if (seasonGenre) {
        // Only finish same-genre seasons
        deactivateQuery = deactivateQuery.eq('genre', seasonGenre);
      } else {
        // If no genre, only finish other null-genre seasons
        deactivateQuery = deactivateQuery.is('genre', null);
      }

      const { error: deactivateError } = await deactivateQuery;

      if (deactivateError) {
        console.error('[reset-season] deactivateError:', deactivateError);
        // Non-fatal, continue
      }

      // Set this season to active
      const { error: reactivateError } = await supabase
        .from('seasons')
        .update({ status: 'active' })
        .eq('id', season.id);

      if (reactivateError) {
        console.error('[reset-season] reactivateError:', reactivateError);
        return NextResponse.json(
          { ok: false, error: 'Failed to reactivate season' },
          { status: 500 }
        );
      }

      wasReactivated = true;
      season.status = 'active';
      console.log(`[reset-season] Reactivated season "${season.label}" (was: ${season.status})`);
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
        { ok: false, error: 'Failed to reset slots' },
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
        { ok: false, error: 'Failed to set voting slot' },
        { status: 500 }
      );
    }

    // 4. Optionally reset vote counts on clips AND reset clip statuses
    // IMPORTANT: Only reset clips that belong to THIS season (prevents cross-season contamination)
    if (reset_clip_counts) {
      const { data: resetClips, error: resetClipsError } = await supabase
        .from('tournament_clips')
        .update({
          vote_count: 0,
          weighted_score: 0,
          status: 'active',
          slot_position: start_slot,
        })
        .eq('season_id', season.id)   // Only reset THIS season's clips
        .neq('status', 'rejected')    // Don't touch rejected clips
        .select('id');

      if (resetClipsError) {
        console.error('[reset-season] resetClipsError:', resetClipsError);
        // Non-fatal, continue
      } else {
        clipsResetCount = resetClips?.length ?? 0;
        console.log(`[reset-season] Reset ${clipsResetCount} clips for season "${season.label}"`);
      }
    }

    // 5. Optionally clear votes for this season's clips only
    if (clear_votes) {
      // First, get all clip IDs for this season
      const { data: seasonClips, error: clipsError } = await supabase
        .from('tournament_clips')
        .select('id')
        .eq('season_id', season.id);

      if (clipsError) {
        console.error('[reset-season] Failed to get clips for vote clearing:', clipsError);
      } else if (seasonClips && seasonClips.length > 0) {
        const clipIds = seasonClips.map(c => c.id);

        const { error: clearVotesError } = await supabase
          .from('votes')
          .delete()
          .in('clip_id', clipIds);

        if (clearVotesError) {
          console.error('[reset-season] clearVotesError:', clearVotesError);
          // Non-fatal, continue
        } else {
          console.log(`[reset-season] Cleared votes for ${clipIds.length} clips in season "${season.label}"`);
        }
      } else {
        console.log('[reset-season] No clips found for this season, no votes to clear');
      }
    }

    // 6. Get clips available for the voting slot (filter by season_id for multi-genre)
    const { data: clipsInSlot, count: clipCount } = await supabase
      .from('tournament_clips')
      .select('id, username, vote_count, genre, thumbnail_url', { count: 'exact' })
      .eq('season_id', season.id)
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
        seasonStatus: season.status,
        wasReactivated,
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
      message: `Season "${season.label || 'Season'}" reset successfully${wasReactivated ? ' and reactivated' : ''}`,
      season_id: season.id,
      season_label: season.label,
      season_status: season.status,
      voting_slot: start_slot,
      voting_ends_at: votingEndsAt.toISOString(),
      clips_in_slot: clipCount || 0,
      top_clips: clipsInSlot || [],
      actions: {
        slots_reset: true,
        reactivated: wasReactivated,
        votes_cleared: clear_votes,
        clip_counts_reset: reset_clip_counts,
        clips_reset_count: clipsResetCount,
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
