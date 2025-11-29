// app/api/story/route.ts
// Returns all seasons with their slots for the Story player
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function createSupabaseServerClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('[story] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
}

// ============================================================================
// Types
// ============================================================================

interface SeasonRow {
  id: string;
  status: 'draft' | 'active' | 'finished';
  label?: string | null;
  total_slots?: number | null;
  season_number?: number | null;
  created_at?: string | null;
}

interface StorySlotRow {
  id: string;
  season_id: string;
  slot_position: number;
  status: 'upcoming' | 'voting' | 'locked';
  genre: string | null;
  winner_tournament_clip_id?: string | null;
}

interface TournamentClipRow {
  id: string;
  video_url: string | null;
  thumbnail_url: string | null;
  username: string | null;
  avatar_url: string | null;
  vote_count?: number | null;
  genre?: string | null;
}

interface VoteCountRow {
  season_id: string;
  total: number;
}

// Response types
interface WinningClip {
  id: string;
  video_url: string;
  thumbnail_url: string;
  username: string;
  avatar_url: string;
  vote_count: number;
  genre: string;
}

interface Slot {
  id: string;
  slot_position: number;
  status: 'upcoming' | 'voting' | 'locked';
  winning_clip?: WinningClip;
}

interface Season {
  id: string;
  number: number;
  name: string;
  status: 'completed' | 'active' | 'coming_soon';
  total_slots: number;
  locked_slots: number;
  total_votes: number;
  total_clips: number;
  total_creators: number;
  winning_genre?: string;
  slots: Slot[];
  current_voting_slot?: number;
  thumbnail_url?: string;
}

interface StoryResponse {
  seasons: Season[];
}

// ============================================================================
// Helper functions
// ============================================================================

function mapSeasonStatus(dbStatus: string): 'completed' | 'active' | 'coming_soon' {
  if (dbStatus === 'finished') return 'completed';
  if (dbStatus === 'active') return 'active';
  return 'coming_soon';
}

async function getSeasonStats(
  supabase: SupabaseClient,
  seasonId: string,
  slotPositions: number[]
): Promise<{ totalVotes: number; totalClips: number; totalCreators: number }> {
  try {
    if (slotPositions.length === 0) {
      return { totalVotes: 0, totalClips: 0, totalCreators: 0 };
    }

    // Get clips in these slot positions
    const { data: clips, error } = await supabase
      .from('tournament_clips')
      .select('id, username, vote_count')
      .in('slot_position', slotPositions);

    if (error) {
      console.error('[getSeasonStats] error:', error);
      return { totalVotes: 0, totalClips: 0, totalCreators: 0 };
    }

    const uniqueCreators = new Set((clips || []).map(c => c.username).filter(Boolean));
    const totalVotes = (clips || []).reduce((sum, clip) => sum + (clip.vote_count || 0), 0);

    return {
      totalVotes,
      totalClips: clips?.length || 0,
      totalCreators: uniqueCreators.size,
    };
  } catch (error) {
    console.error('[getSeasonStats] error:', error);
    return { totalVotes: 0, totalClips: 0, totalCreators: 0 };
  }
}

// ============================================================================
// GET /api/story
// ============================================================================

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServerClient();

  try {
    // 1. Get all seasons (active and finished, ordered by season_number)
    const { data: seasonsData, error: seasonsError } = await supabase
      .from('seasons')
      .select('*')
      .in('status', ['active', 'finished', 'draft'])
      .order('season_number', { ascending: true });

    if (seasonsError) {
      console.error('[GET /api/story] seasonsError:', seasonsError);
      return NextResponse.json(
        { error: 'Failed to load seasons' },
        { status: 500 }
      );
    }

    const seasonRows = (seasonsData as SeasonRow[]) || [];

    if (seasonRows.length === 0) {
      // Return empty state
      const response: StoryResponse = { seasons: [] };
      return NextResponse.json(response, { status: 200 });
    }

    // 2. Get all slots for these seasons
    const seasonIds = seasonRows.map(s => s.id);

    const { data: slotsData, error: slotsError } = await supabase
      .from('story_slots')
      .select('*')
      .in('season_id', seasonIds)
      .order('slot_position', { ascending: true });

    if (slotsError) {
      console.error('[GET /api/story] slotsError:', slotsError);
      return NextResponse.json(
        { error: 'Failed to load slots' },
        { status: 500 }
      );
    }

    const slotRows = (slotsData as StorySlotRow[]) || [];

    // 3. Get all winning clips
    const winnerIds = slotRows
      .map(s => s.winner_tournament_clip_id)
      .filter((id): id is string => !!id);

    let clipMap = new Map<string, TournamentClipRow>();

    if (winnerIds.length > 0) {
      const { data: clipsData, error: clipsError } = await supabase
        .from('tournament_clips')
        .select('id, video_url, thumbnail_url, username, avatar_url, vote_count, genre')
        .in('id', winnerIds);

      if (clipsError) {
        console.error('[GET /api/story] clipsError:', clipsError);
      } else {
        for (const clip of (clipsData as TournamentClipRow[]) || []) {
          clipMap.set(clip.id, clip);
        }
      }
    }

    // 4. Build response for each season
    const seasons: Season[] = await Promise.all(
      seasonRows.map(async (seasonRow) => {
        const seasonSlots = slotRows.filter(s => s.season_id === seasonRow.id);
        const lockedSlots = seasonSlots.filter(s => s.status === 'locked' && s.winner_tournament_clip_id);
        const votingSlot = seasonSlots.find(s => s.status === 'voting');

        // Get season stats using slot positions
        const slotPositions = seasonSlots.map(s => s.slot_position);
        const stats = await getSeasonStats(supabase, seasonRow.id, slotPositions);

        // Build slots with winning clips
        const slots: Slot[] = seasonSlots.map(slot => {
          const baseSlot: Slot = {
            id: slot.id,
            slot_position: slot.slot_position,
            status: slot.status,
          };

          if (slot.winner_tournament_clip_id) {
            const clip = clipMap.get(slot.winner_tournament_clip_id);
            if (clip) {
              baseSlot.winning_clip = {
                id: clip.id,
                video_url: clip.video_url || '',
                thumbnail_url: clip.thumbnail_url || '',
                username: clip.username || 'creator',
                avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/identicon/svg?seed=${clip.id}`,
                vote_count: clip.vote_count || 0,
                genre: clip.genre || 'Mixed',
              };
            }
          }

          return baseSlot;
        });

        // Determine winning genre for completed seasons
        let winningGenre: string | undefined;
        if (seasonRow.status === 'finished' && lockedSlots.length > 0) {
          const genreCounts = new Map<string, number>();
          lockedSlots.forEach(slot => {
            if (slot.winner_tournament_clip_id) {
              const clip = clipMap.get(slot.winner_tournament_clip_id);
              if (clip?.genre) {
                genreCounts.set(clip.genre, (genreCounts.get(clip.genre) || 0) + 1);
              }
            }
          });

          let maxCount = 0;
          genreCounts.forEach((count, genre) => {
            if (count > maxCount) {
              maxCount = count;
              winningGenre = genre;
            }
          });
        }

        // Get thumbnail from first locked slot
        let thumbnail_url: string | undefined;
        const firstLockedWithClip = slots.find(s => s.status === 'locked' && s.winning_clip);
        if (firstLockedWithClip?.winning_clip) {
          thumbnail_url = firstLockedWithClip.winning_clip.thumbnail_url || firstLockedWithClip.winning_clip.video_url;
        }

        const season: Season = {
          id: seasonRow.id,
          number: seasonRow.season_number || 1,
          name: seasonRow.label || `Season ${seasonRow.season_number || 1}`,
          status: mapSeasonStatus(seasonRow.status),
          total_slots: seasonRow.total_slots || 75,
          locked_slots: lockedSlots.length,
          total_votes: stats.totalVotes,
          total_clips: stats.totalClips,
          total_creators: stats.totalCreators,
          slots,
          thumbnail_url,
        };

        if (winningGenre) {
          season.winning_genre = winningGenre;
        }

        if (votingSlot) {
          season.current_voting_slot = votingSlot.slot_position;
        }

        return season;
      })
    );

    // Sort: active first, then by number descending
    seasons.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return b.number - a.number;
    });

    const response: StoryResponse = { seasons };
    return NextResponse.json(response, { status: 200 });

  } catch (error) {
    console.error('[GET /api/story] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
