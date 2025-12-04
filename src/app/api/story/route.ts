// app/api/story/route.ts
// Returns all seasons with their slots for the Story player
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

// ============================================================================
// In-memory cache with TTL (shorter for story due to active voting)
// ============================================================================
const cache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL = 30 * 1000; // 30 seconds (shorter due to active voting)

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
}

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

interface _StoryResponse {
  seasons: Season[];
}

// ============================================================================
// GET /api/story
// ============================================================================

export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Check cache first
    const cacheKey = 'story_seasons';
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
          'X-Cache': 'HIT',
        },
      });
    }

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
      .select('id, status, label, total_slots, created_at')
      .in('status', ['active', 'finished'])
      .order('created_at', { ascending: true });

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

    // 3b. Get a preview thumbnail from active clips for each season (fallback)
    // This map stores season_id -> preview_thumbnail_url
    const seasonPreviewMap = new Map<string, string>();

    // For each season with a voting slot, fetch a preview clip thumbnail
    for (const seasonRow of seasons) {
      const seasonSlots = (slots || []).filter(s => s.season_id === seasonRow.id);
      const votingSlot = seasonSlots.find(s => s.status === 'voting');

      if (votingSlot) {
        // Try to get any clip with a thumbnail or video from the current voting slot
        // First try with season_id filter
        let { data: previewClips, error: previewError } = await supabase
          .from('tournament_clips')
          .select('thumbnail_url, video_url')
          .eq('season_id', seasonRow.id)
          .eq('slot_position', votingSlot.slot_position)
          .eq('status', 'active')
          .order('vote_count', { ascending: false })
          .limit(5);

        // If no clips found with season_id, try without it (for legacy data)
        if ((!previewClips || previewClips.length === 0) && !previewError) {
          const fallbackResult = await supabase
            .from('tournament_clips')
            .select('thumbnail_url, video_url')
            .eq('slot_position', votingSlot.slot_position)
            .eq('status', 'active')
            .order('vote_count', { ascending: false })
            .limit(5);

          previewClips = fallbackResult.data;
          previewError = fallbackResult.error;
        }

        if (!previewError && previewClips && previewClips.length > 0) {
          // Find first clip that has a thumbnail or video
          for (const clip of previewClips) {
            const previewUrl = clip.thumbnail_url || clip.video_url;
            if (previewUrl && previewUrl.length > 0) {
              seasonPreviewMap.set(seasonRow.id, previewUrl);
              break;
            }
          }
        }
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

      // Get thumbnail - prioritize locked winners, fall back to preview from voting clips
      let thumbnail_url: string | undefined;
      const firstLocked = mappedSlots.find(s => s.status === 'locked' && s.winning_clip);

      // Check locked clip thumbnail (must be non-empty string)
      if (firstLocked?.winning_clip?.thumbnail_url && firstLocked.winning_clip.thumbnail_url.length > 0) {
        thumbnail_url = firstLocked.winning_clip.thumbnail_url;
      } else if (firstLocked?.winning_clip?.video_url && firstLocked.winning_clip.video_url.length > 0) {
        thumbnail_url = firstLocked.winning_clip.video_url;
      }

      // If still no thumbnail, try preview from voting clips
      if (!thumbnail_url) {
        thumbnail_url = seasonPreviewMap.get(seasonRow.id);
      }

      // Extract season number from label or use index
      const seasonIndex = seasons.indexOf(seasonRow) + 1;

      const season: Season = {
        id: seasonRow.id,
        number: seasonIndex,
        name: seasonRow.label || `Season ${seasonIndex}`,
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

    const responseData = { seasons: result };

    // Cache the response
    setCache(cacheKey, responseData);

    return NextResponse.json(responseData, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        'X-Cache': 'MISS',
      },
    });

  } catch (error) {
    console.error('[story] Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', message, seasons: [] },
      { status: 500 }
    );
  }
}
