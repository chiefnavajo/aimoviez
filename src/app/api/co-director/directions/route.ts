// app/api/co-director/directions/route.ts
// Get direction options for current/specified slot
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

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
 * GET /api/co-director/directions?season_id=X&slot_position=Y
 * Returns direction options for a slot (if voting is open)
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'co_director_read');
  if (rateLimitResponse) return rateLimitResponse;

  // Check feature flag
  const enabled = await isFeatureEnabled('ai_co_director');
  if (!enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const seasonId = searchParams.get('season_id');
  const slotPosition = searchParams.get('slot_position');

  const supabase = getSupabase();

  // If no season_id provided, get the active season (genre-aware for multi-genre)
  const genreParam = searchParams.get('genre')?.toLowerCase();
  let targetSeasonId = seasonId;
  if (!targetSeasonId) {
    let seasonQuery = supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active');
    if (genreParam) {
      seasonQuery = seasonQuery.eq('genre', genreParam);
    }
    const { data: activeSeason } = await seasonQuery
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!activeSeason) {
      return NextResponse.json({ error: 'No active season' }, { status: 404 });
    }
    targetSeasonId = activeSeason.id;
  }

  // If no slot_position, find the slot with open direction voting
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
        voting_open: false,
        message: 'No direction voting currently open',
        directions: [],
      });
    }
    targetSlotPosition = openSlot.slot_position;
  }

  // Get slot info
  const { data: slot } = await supabase
    .from('story_slots')
    .select('direction_voting_status, direction_voting_ends_at')
    .eq('season_id', targetSeasonId)
    .eq('slot_position', targetSlotPosition)
    .single();

  // Get direction options
  const { data: directions, error } = await supabase
    .from('direction_options')
    .select('id, title, description, mood, suggested_genre, visual_hints, vote_count')
    .eq('season_id', targetSeasonId)
    .eq('slot_position', targetSlotPosition)
    .order('option_number', { ascending: true });

  if (error) {
    console.error('[GET directions] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch directions' }, { status: 500 });
  }

  const votingOpen = slot?.direction_voting_status === 'open';
  const endsAt = slot?.direction_voting_ends_at;

  return NextResponse.json({
    ok: true,
    season_id: targetSeasonId,
    slot_position: targetSlotPosition,
    voting_open: votingOpen,
    voting_ends_at: endsAt,
    directions: directions || [],
    total_votes: (directions || []).reduce((sum, d) => sum + (d.vote_count || 0), 0),
  });
}
