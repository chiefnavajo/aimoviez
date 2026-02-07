// app/api/co-director/vote/status/route.ts
// Get user's vote status (alias for direction-vote GET)
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { generateDeviceKey } from '@/lib/device-fingerprint';

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
 * GET /api/co-director/vote/status
 * Get user's voting status across all open direction votes
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
  const supabase = getSupabase();

  // Get active season
  const { data: activeSeason } = await supabase
    .from('seasons')
    .select('id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!activeSeason) {
    return NextResponse.json({
      ok: true,
      has_active_voting: false,
      votes: [],
    });
  }

  // Get all slots with open direction voting
  const { data: openSlots } = await supabase
    .from('story_slots')
    .select('slot_position, direction_voting_status, direction_voting_ends_at')
    .eq('season_id', activeSeason.id)
    .eq('direction_voting_status', 'open');

  if (!openSlots || openSlots.length === 0) {
    return NextResponse.json({
      ok: true,
      season_id: activeSeason.id,
      has_active_voting: false,
      votes: [],
    });
  }

  // Get user's votes for these slots
  const slotPositions = openSlots.map(s => s.slot_position);
  const { data: votes } = await supabase
    .from('direction_votes')
    .select('slot_position, direction_option_id')
    .eq('season_id', activeSeason.id)
    .eq('voter_key', voterKey)
    .in('slot_position', slotPositions);

  // Build response with vote status per slot
  const votesBySlot = (votes || []).reduce((acc, v) => {
    acc[v.slot_position] = v.direction_option_id;
    return acc;
  }, {} as Record<number, string>);

  const slotsWithStatus = openSlots.map(slot => ({
    slot_position: slot.slot_position,
    voting_ends_at: slot.direction_voting_ends_at,
    has_voted: !!votesBySlot[slot.slot_position],
    voted_for: votesBySlot[slot.slot_position] || null,
  }));

  return NextResponse.json({
    ok: true,
    season_id: activeSeason.id,
    has_active_voting: true,
    slots: slotsWithStatus,
  });
}
