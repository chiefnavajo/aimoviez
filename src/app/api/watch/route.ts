// /api/watch - Fetch finished seasons with their locked slots for movie playback
// ============================================================================
// Only shows FINISHED seasons - active seasons are viewed on the Story page

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

    // Only get FINISHED seasons - active seasons are shown on Story page
    const { data: finishedSeasons, error: seasonsError } = await supabase
      .from('seasons')
      .select('id, label, status, total_slots, created_at')
      .eq('status', 'finished')
      .order('created_at', { ascending: false });

    if (seasonsError) {
      console.error('[api/watch] Error fetching seasons:', seasonsError);
      return NextResponse.json({ error: 'Failed to fetch seasons' }, { status: 500 });
    }

    // If no finished seasons, return empty with flag
    if (!finishedSeasons || finishedSeasons.length === 0) {
      return NextResponse.json({
        hasFinishedSeasons: false,
        seasons: [],
        message: 'No finished seasons yet. Check the Story page for the current season in progress!'
      });
    }

    // Get all season IDs
    const seasonIds = finishedSeasons.map(s => s.id);

    // Fetch all locked slots for finished seasons
    const { data: allLockedSlots, error: slotsError } = await supabase
      .from('story_slots')
      .select('id, slot_position, winner_tournament_clip_id, status, season_id')
      .eq('status', 'locked')
      .in('season_id', seasonIds)
      .order('slot_position', { ascending: true });

    if (slotsError) {
      console.error('[api/watch] Error fetching locked slots:', slotsError);
      return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 });
    }

    // Get all winning clip IDs
    const winnerClipIds = (allLockedSlots || [])
      .map(slot => slot.winner_tournament_clip_id)
      .filter(Boolean);

    // Fetch all winning clips
    let clipMap = new Map();
    if (winnerClipIds.length > 0) {
      const { data: winningClips, error: clipsError } = await supabase
        .from('tournament_clips')
        .select('id, video_url, thumbnail_url, username, genre, vote_count')
        .in('id', winnerClipIds);

      if (clipsError) {
        console.error('[api/watch] Error fetching winning clips:', clipsError);
        return NextResponse.json({ error: 'Failed to fetch clips' }, { status: 500 });
      }

      clipMap = new Map(winningClips?.map(clip => [clip.id, clip]) || []);
    }

    // Build response with seasons and their slots
    const seasons = finishedSeasons.map((season, index) => {
      const seasonSlots = (allLockedSlots || [])
        .filter(slot => slot.season_id === season.id)
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
              title: `Slot ${slot.slot_position}`,
              username: clip.username,
              genre: clip.genre,
              vote_count: clip.vote_count,
            },
          };
        });

      const totalDuration = seasonSlots.length * 8; // 8 seconds per slot

      return {
        id: season.id,
        label: season.label || `Season ${finishedSeasons.length - index}`,
        total_slots: season.total_slots || 75,
        locked_slots: seasonSlots.length,
        total_duration_seconds: totalDuration,
        total_duration_formatted: `${Math.floor(totalDuration / 60)}:${(totalDuration % 60).toString().padStart(2, '0')}`,
        created_at: season.created_at,
        slots: seasonSlots,
      };
    });

    return NextResponse.json({
      hasFinishedSeasons: true,
      seasons,
    });
  } catch (error) {
    console.error('[api/watch] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
