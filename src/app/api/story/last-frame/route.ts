// app/api/story/last-frame/route.ts
// ============================================================================
// GET the last frame URL from the previous slot's winning clip.
// Used by upload and AI create pages for story continuity.
// ============================================================================

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

export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const supabase = getSupabase();

  try {
    // Check feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'last_frame_continuation')
      .maybeSingle();

    if (!flag?.enabled) {
      return NextResponse.json({ lastFrameUrl: null, reason: 'feature_disabled' });
    }

    // Get active season
    const { data: season } = await supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active')
      .maybeSingle();

    if (!season) {
      return NextResponse.json({ lastFrameUrl: null, reason: 'no_active_season' });
    }

    // Find the current non-locked slot (the one accepting clips or voting)
    const { data: currentSlot } = await supabase
      .from('story_slots')
      .select('slot_position')
      .eq('season_id', season.id)
      .in('status', ['voting', 'waiting_for_clips', 'upcoming'])
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!currentSlot || currentSlot.slot_position <= 1) {
      return NextResponse.json({ lastFrameUrl: null, reason: 'first_slot' });
    }

    // Get the previous locked slot's winner
    const previousPosition = currentSlot.slot_position - 1;

    const { data: prevSlot } = await supabase
      .from('story_slots')
      .select('winner_tournament_clip_id')
      .eq('season_id', season.id)
      .eq('slot_position', previousPosition)
      .eq('status', 'locked')
      .maybeSingle();

    if (!prevSlot?.winner_tournament_clip_id) {
      return NextResponse.json({ lastFrameUrl: null, reason: 'no_previous_winner' });
    }

    // Get the winning clip's last frame
    const { data: clip } = await supabase
      .from('tournament_clips')
      .select('last_frame_url, title')
      .eq('id', prevSlot.winner_tournament_clip_id)
      .single();

    if (!clip?.last_frame_url) {
      return NextResponse.json({ lastFrameUrl: null, reason: 'frame_not_extracted' });
    }

    return NextResponse.json({
      lastFrameUrl: clip.last_frame_url,
      slotPosition: previousPosition,
      clipTitle: clip.title || null,
    });
  } catch (err) {
    console.error('[story/last-frame] Error:', err);
    return NextResponse.json({ lastFrameUrl: null, reason: 'error' });
  }
}
