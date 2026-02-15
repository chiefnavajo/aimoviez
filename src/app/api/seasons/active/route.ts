// app/api/seasons/active/route.ts
// Returns all active seasons with genre info for the genre picker
// Public endpoint (no auth required)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getGenreEmoji, getGenreLabel, LAUNCH_GENRES } from '@/lib/genres';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface ActiveSeason {
  id: string;
  genre: string;
  label: string;
  emoji: string;
  currentSlot: number;
  totalSlots: number;
  clipCount: number;
  progress: number; // percentage
}

/**
 * GET /api/seasons/active
 * Returns all active seasons with genre info for the genre picker
 *
 * Response: {
 *   seasons: ActiveSeason[],
 *   multiGenreEnabled: boolean
 * }
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if multi-genre feature is enabled
    const { data: featureFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'multi_genre_enabled')
      .single();

    const multiGenreEnabled = featureFlag?.enabled ?? false;

    // Get all active seasons with their genre
    const { data: seasons, error: seasonsError } = await supabase
      .from('seasons')
      .select('id, label, genre, total_slots, status')
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (seasonsError) {
      console.error('[GET /api/seasons/active] seasons error:', seasonsError);
      return NextResponse.json(
        { error: 'Failed to fetch seasons' },
        { status: 500 }
      );
    }

    if (!seasons || seasons.length === 0) {
      return NextResponse.json({
        seasons: [],
        multiGenreEnabled,
      });
    }

    // Get season IDs for batch queries
    const seasonIds = seasons.map(s => s.id);

    // Batch query: Get current voting slot for each season
    const { data: votingSlots } = await supabase
      .from('story_slots')
      .select('season_id, slot_position')
      .in('season_id', seasonIds)
      .in('status', ['voting', 'waiting_for_clips'])
      .order('slot_position', { ascending: true });

    // Batch query: Get locked slot count for each season (for progress)
    const { data: lockedSlots } = await supabase
      .from('story_slots')
      .select('season_id')
      .in('season_id', seasonIds)
      .eq('status', 'locked');

    // Batch query: Get active clip count for each season
    const { data: clips } = await supabase
      .from('tournament_clips')
      .select('season_id')
      .in('season_id', seasonIds)
      .eq('status', 'active');

    // Build lookup maps
    const currentSlotBySeasonId = new Map<string, number>();
    (votingSlots || []).forEach(slot => {
      // Take the first (lowest) voting slot position per season
      if (!currentSlotBySeasonId.has(slot.season_id)) {
        currentSlotBySeasonId.set(slot.season_id, slot.slot_position);
      }
    });

    const lockedCountBySeasonId = new Map<string, number>();
    (lockedSlots || []).forEach(slot => {
      lockedCountBySeasonId.set(
        slot.season_id,
        (lockedCountBySeasonId.get(slot.season_id) || 0) + 1
      );
    });

    const clipCountBySeasonId = new Map<string, number>();
    (clips || []).forEach(clip => {
      clipCountBySeasonId.set(
        clip.season_id,
        (clipCountBySeasonId.get(clip.season_id) || 0) + 1
      );
    });

    // Build response
    const activeSeasons: ActiveSeason[] = seasons
      .filter(season => {
        // If multi-genre not enabled, only return first season
        // If enabled, return all seasons (optionally filter to launch genres)
        if (!multiGenreEnabled) {
          return seasons.indexOf(season) === 0;
        }
        // When enabled, show all seasons (or filter to LAUNCH_GENRES if needed)
        return true;
      })
      .map(season => {
        const genre = season.genre || 'action';
        const totalSlots = season.total_slots || 75;
        const lockedCount = lockedCountBySeasonId.get(season.id) || 0;
        const currentSlot = currentSlotBySeasonId.get(season.id) || 1;

        return {
          id: season.id,
          genre,
          label: season.label,
          emoji: getGenreEmoji(genre),
          currentSlot,
          totalSlots,
          clipCount: clipCountBySeasonId.get(season.id) || 0,
          progress: Math.round((lockedCount / totalSlots) * 100),
        };
      })
      // Sort by launch genre order, then alphabetically
      .sort((a, b) => {
        const aIndex = LAUNCH_GENRES.indexOf(a.genre as typeof LAUNCH_GENRES[number]);
        const bIndex = LAUNCH_GENRES.indexOf(b.genre as typeof LAUNCH_GENRES[number]);

        // Launch genres come first, in order
        if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
        if (aIndex >= 0) return -1;
        if (bIndex >= 0) return 1;

        // Other genres alphabetically
        return a.genre.localeCompare(b.genre);
      });

    return NextResponse.json({
      seasons: activeSeasons,
      multiGenreEnabled,
    }, {
      headers: {
        // Cache for 30 seconds, allow stale-while-revalidate for 2 minutes
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
      }
    });
  } catch (err) {
    console.error('[GET /api/seasons/active] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
