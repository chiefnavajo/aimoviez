// app/api/story/route.ts
// Returns all seasons with their slots for the Story player
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

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
// GET /api/story
// ============================================================================

export async function GET(req: NextRequest) {
  try {
    // Check environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[story] Missing Supabase environment variables');
      return NextResponse.json(
        { error: 'Server configuration error', seasons: [] },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get all seasons
    const { data: seasons, error: seasonsError } = await supabase
      .from('seasons')
      .select('id, status, label, total_slots, season_number, created_at')
      .in('status', ['active', 'finished'])
      .order('season_number', { ascending: true });

    if (seasonsError) {
      console.error('[story] seasons error:', seasonsError);
      return NextResponse.json(
        { error: 'Failed to load seasons', details: seasonsError.message, seasons: [] },
        { status: 500 }
      );
    }

    if (!seasons || seasons.length === 0) {
      return NextResponse.json({ seasons: [] }, { status: 200 });
    }

    // 2. Get all slots for these seasons
    const seasonIds = seasons.map(s => s.id);
    const { data: slots, error: slotsError } = await supabase
      .from('story_slots')
      .select('id, season_id, slot_position, status, genre, winner_tournament_clip_id')
      .in('season_id', seasonIds)
      .order('slot_position', { ascending: true });

    if (slotsError) {
      console.error('[story] slots error:', slotsError);
      return NextResponse.json(
        { error: 'Failed to load slots', details: slotsError.message, seasons: [] },
        { status: 500 }
      );
    }

    // 3. Get winning clips if any
    const winnerIds = (slots || [])
      .map(s => s.winner_tournament_clip_id)
      .filter((id): id is string => !!id);

    const clipMap = new Map<string, any>();

    if (winnerIds.length > 0) {
      const { data: clips } = await supabase
        .from('tournament_clips')
        .select('id, video_url, thumbnail_url, username, avatar_url, vote_count, genre')
        .in('id', winnerIds);

      if (clips) {
        clips.forEach(clip => clipMap.set(clip.id, clip));
      }
    }

    // 4. Build response
    const result: Season[] = seasons.map(seasonRow => {
      const seasonSlots = (slots || []).filter(s => s.season_id === seasonRow.id);
      const lockedSlots = seasonSlots.filter(s => s.status === 'locked' && s.winner_tournament_clip_id);
      const votingSlot = seasonSlots.find(s => s.status === 'voting');

      // Build slots array
      const mappedSlots: Slot[] = seasonSlots.map(slot => {
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

      // Map status
      let status: 'completed' | 'active' | 'coming_soon' = 'coming_soon';
      if (seasonRow.status === 'finished') status = 'completed';
      else if (seasonRow.status === 'active') status = 'active';

      // Get thumbnail
      let thumbnail_url: string | undefined;
      const firstLocked = mappedSlots.find(s => s.status === 'locked' && s.winning_clip);
      if (firstLocked?.winning_clip) {
        thumbnail_url = firstLocked.winning_clip.thumbnail_url || firstLocked.winning_clip.video_url;
      }

      const season: Season = {
        id: seasonRow.id,
        number: seasonRow.season_number || 1,
        name: seasonRow.label || `Season ${seasonRow.season_number || 1}`,
        status,
        total_slots: seasonRow.total_slots || 75,
        locked_slots: lockedSlots.length,
        total_votes: 0, // Simplified - skip expensive queries
        total_clips: 0,
        total_creators: 0,
        slots: mappedSlots,
        thumbnail_url,
      };

      if (votingSlot) {
        season.current_voting_slot = votingSlot.slot_position;
      }

      return season;
    });

    // Sort: active first
    result.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (b.status === 'active' && a.status !== 'active') return 1;
      return b.number - a.number;
    });

    return NextResponse.json({ seasons: result }, { status: 200 });

  } catch (error: any) {
    console.error('[story] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error?.message || 'Unknown error', seasons: [] },
      { status: 500 }
    );
  }
}
