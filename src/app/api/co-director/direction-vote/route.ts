// app/api/co-director/direction-vote/route.ts
// Cast and view direction votes
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { generateDeviceKey } from '@/lib/device-fingerprint';
import { parseBody, DirectionVoteSchema } from '@/lib/validations';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

async function isFeatureEnabled(key: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', key)
    .single();
  return data?.enabled ?? false;
}

/**
 * GET /api/co-director/direction-vote?season_id=X&slot_position=Y
 * Get user's current vote for a slot
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'co_director_read');
  if (rateLimitResponse) return rateLimitResponse;

  // Check feature flag
  const enabled = await isFeatureEnabled('ai_co_director');
  if (!enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const voterKey = generateDeviceKey(req);
  const { searchParams } = new URL(req.url);
  const seasonId = searchParams.get('season_id');
  const slotPosition = searchParams.get('slot_position');

  const supabase = getSupabase();

  // If no season_id, get active season
  let targetSeasonId = seasonId;
  if (!targetSeasonId) {
    const { data: activeSeason } = await supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!activeSeason) {
      return NextResponse.json({ error: 'No active season' }, { status: 404 });
    }
    targetSeasonId = activeSeason.id;
  }

  // If no slot_position, find open voting slot
  let targetSlotPosition = slotPosition ? parseInt(slotPosition, 10) : null;
  if (!targetSlotPosition) {
    const { data: openSlot } = await supabase
      .from('story_slots')
      .select('slot_position')
      .eq('season_id', targetSeasonId)
      .eq('direction_voting_status', 'open')
      .limit(1)
      .maybeSingle();

    if (!openSlot) {
      return NextResponse.json({
        ok: true,
        has_voted: false,
        message: 'No direction voting currently open',
      });
    }
    targetSlotPosition = openSlot.slot_position;
  }

  // Check if user has voted
  const { data: vote } = await supabase
    .from('direction_votes')
    .select('id, direction_option_id')
    .eq('season_id', targetSeasonId)
    .eq('slot_position', targetSlotPosition)
    .eq('voter_key', voterKey)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    season_id: targetSeasonId,
    slot_position: targetSlotPosition,
    has_voted: !!vote,
    voted_for: vote?.direction_option_id || null,
  });
}

/**
 * POST /api/co-director/direction-vote
 * Cast a vote for a direction option
 */
export async function POST(req: NextRequest) {
  // CSRF protection
  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const rateLimitResponse = await rateLimit(req, 'co_director_vote');
  if (rateLimitResponse) return rateLimitResponse;

  // Check feature flag
  const enabled = await isFeatureEnabled('ai_co_director');
  if (!enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const body = await req.json();
    const parsed = parseBody(DirectionVoteSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { direction_option_id } = parsed.data;
    const voterKey = generateDeviceKey(req);
    const supabase = getSupabase();

    // Get the direction option to find season/slot
    const { data: direction, error: directionError } = await supabase
      .from('direction_options')
      .select('id, season_id, slot_position, title')
      .eq('id', direction_option_id)
      .single();

    if (directionError || !direction) {
      return NextResponse.json({ error: 'Direction option not found' }, { status: 404 });
    }

    // Check if voting is open
    const { data: slot } = await supabase
      .from('story_slots')
      .select('direction_voting_status, direction_voting_ends_at')
      .eq('season_id', direction.season_id)
      .eq('slot_position', direction.slot_position)
      .single();

    if (slot?.direction_voting_status !== 'open') {
      return NextResponse.json(
        { error: 'Direction voting is not open for this slot' },
        { status: 400 }
      );
    }

    // Check if voting period has expired
    if (slot.direction_voting_ends_at && new Date(slot.direction_voting_ends_at) < new Date()) {
      return NextResponse.json(
        { error: 'Direction voting has ended for this slot' },
        { status: 400 }
      );
    }

    // Get user ID if logged in
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      if (session?.user?.email) {
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('email', session.user.email)
          .single();
        userId = user?.id || null;
      }
    } catch {
      // Not logged in, continue with device-based voting
    }

    // Check if user already voted for this slot
    const { data: existingVote } = await supabase
      .from('direction_votes')
      .select('id, direction_option_id')
      .eq('season_id', direction.season_id)
      .eq('slot_position', direction.slot_position)
      .eq('voter_key', voterKey)
      .maybeSingle();

    if (existingVote) {
      // If voting for the same option, return success (idempotent)
      if (existingVote.direction_option_id === direction_option_id) {
        return NextResponse.json({
          ok: true,
          message: 'Already voted for this direction',
          vote_id: existingVote.id,
          changed: false,
        });
      }

      // If changing vote, delete old and insert new atomically
      // Store old vote info in case we need to restore
      const oldVoteData = {
        direction_option_id: existingVote.direction_option_id,
        voter_key: voterKey,
        user_id: userId,
        season_id: direction.season_id,
        slot_position: direction.slot_position,
      };

      // Delete old vote first
      const { error: deleteError } = await supabase
        .from('direction_votes')
        .delete()
        .eq('id', existingVote.id);

      if (deleteError) {
        console.error('[POST direction-vote] Delete error:', deleteError);
        return NextResponse.json({ error: 'Failed to change vote' }, { status: 500 });
      }

      // Insert new vote
      const { data: newVote, error: insertError } = await supabase
        .from('direction_votes')
        .insert({
          direction_option_id,
          voter_key: voterKey,
          user_id: userId,
          season_id: direction.season_id,
          slot_position: direction.slot_position,
        })
        .select()
        .single();

      if (insertError) {
        // Try to restore old vote to prevent data loss
        console.error('[POST direction-vote] Insert error after delete, restoring:', insertError);
        await supabase.from('direction_votes').insert(oldVoteData).select().maybeSingle();
        return NextResponse.json({ error: 'Failed to change vote' }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        message: 'Vote changed',
        vote_id: newVote.id,
        voted_for: direction_option_id,
        changed: true,
      });
    }

    // New vote - just insert
    const { data: newVote, error: insertError } = await supabase
      .from('direction_votes')
      .insert({
        direction_option_id,
        voter_key: voterKey,
        user_id: userId,
        season_id: direction.season_id,
        slot_position: direction.slot_position,
      })
      .select()
      .single();

    if (insertError) {
      // Handle unique constraint violation (race condition)
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'You have already voted for this slot' },
          { status: 400 }
        );
      }

      console.error('[POST direction-vote] Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to record vote' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Vote recorded',
      vote_id: newVote.id,
      voted_for: direction_option_id,
      changed: false,
    });
  } catch (err) {
    console.error('[POST direction-vote] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
