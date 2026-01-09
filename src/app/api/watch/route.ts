// /api/watch - Fetch locked slots with winning clips for movie playback
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

export async function GET() {
  try {
    const supabase = createSupabaseClient();

    // Get the active season first
    const { data: activeSeason } = await supabase
      .from('seasons')
      .select('id, label, status')
      .eq('status', 'active')
      .maybeSingle();

    let seasonId = activeSeason?.id;

    // If no active season, try to get the most recent finished season
    if (!seasonId) {
      const { data: finishedSeason } = await supabase
        .from('seasons')
        .select('id, label, status')
        .eq('status', 'finished')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      seasonId = finishedSeason?.id;
    }

    // If still no season found, return empty
    if (!seasonId) {
      return NextResponse.json([]);
    }

    // Fetch locked slots with their winning clips
    const { data: lockedSlots, error: slotsError } = await supabase
      .from('story_slots')
      .select(`
        id,
        slot_position,
        winner_tournament_clip_id,
        status
      `)
      .eq('status', 'locked')
      .eq('season_id', seasonId)
      .order('slot_position', { ascending: true });

    if (slotsError) {
      console.error('[api/watch] Error fetching locked slots:', slotsError);
      return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 });
    }

    if (!lockedSlots || lockedSlots.length === 0) {
      return NextResponse.json([]);
    }

    // Get the winning clip IDs
    const winnerClipIds = lockedSlots
      .map(slot => slot.winner_tournament_clip_id)
      .filter(Boolean);

    if (winnerClipIds.length === 0) {
      return NextResponse.json([]);
    }

    // Fetch the winning clips
    const { data: winningClips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url, username, genre, vote_count')
      .in('id', winnerClipIds);

    if (clipsError) {
      console.error('[api/watch] Error fetching winning clips:', clipsError);
      return NextResponse.json({ error: 'Failed to fetch clips' }, { status: 500 });
    }

    // Map clips by ID for quick lookup
    const clipMap = new Map(winningClips?.map(clip => [clip.id, clip]) || []);

    // Build the response with locked slots and their winning clips
    const result = lockedSlots
      .filter(slot => slot.winner_tournament_clip_id && clipMap.has(slot.winner_tournament_clip_id))
      .map(slot => {
        const clip = clipMap.get(slot.winner_tournament_clip_id)!;
        return {
          id: slot.id,
          slot_position: slot.slot_position,
          winning_clip_id: slot.winner_tournament_clip_id,
          clip: {
            id: clip.id,
            video_url: clip.video_url,
            thumbnail_url: clip.thumbnail_url,
            title: `Slot ${slot.slot_position}`, // Use slot position as title
            username: clip.username,
            genre: clip.genre,
            vote_count: clip.vote_count,
          },
        };
      });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[api/watch] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
