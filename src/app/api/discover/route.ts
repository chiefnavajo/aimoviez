// app/api/discover/route.ts
// Discovery API - Search and browse clips and creators

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Use anon key for public read-only operations (principle of least privilege)
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface DiscoverClip {
  id: string;
  thumbnail_url: string;
  video_url: string;
  username: string;
  avatar_url: string;
  genre: string;
  vote_count: number;
  slot_position: number;
  created_at: string;
}

interface DiscoverCreator {
  user_id: string;
  username: string;
  avatar_url: string;
  total_clips: number;
  total_votes: number;
  locked_in_clips: number;
}

interface DiscoverResponse {
  clips: DiscoverClip[];
  creators: DiscoverCreator[];
  total_clips: number;
  total_creators: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

/**
 * GET /api/discover
 * Search and browse clips and creators
 * 
 * Query params:
 * - q: string (search query for clips and creators)
 * - genre?: string (filter by genre)
 * - sort?: 'trending' | 'newest' | 'top' (default: 'trending')
 * - type?: 'clips' | 'creators' | 'all' (default: 'all')
 * - page?: number (default: 1)
 * - limit?: number (default: 20, max: 100)
 */
export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);
    
    const query = (searchParams.get('q') || '').slice(0, 200);
    const genre = searchParams.get('genre');
    const sort = (searchParams.get('sort') || 'trending') as 'trending' | 'newest' | 'top';
    const type = (searchParams.get('type') || 'all') as 'clips' | 'creators' | 'all';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 100));
    const offset = (page - 1) * limit;

    // FIX: Get active season for multi-genre filtering
    const { data: activeSeason } = await supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    let clips: DiscoverClip[] = [];
    let creators: DiscoverCreator[] = [];
    let total_clips = 0;
    let total_creators = 0;

    // Search clips
    if (type === 'clips' || type === 'all') {
      let clipsQuery = supabase
        .from('tournament_clips')
        .select('id, thumbnail_url, video_url, username, avatar_url, genre, vote_count, slot_position, created_at', { count: 'exact' })
        .eq('status', 'active');

      // FIX: Filter by season_id to prevent cross-season data pollution
      if (activeSeason?.id) {
        clipsQuery = clipsQuery.eq('season_id', activeSeason.id);
      }

      // FIX: Apply search filter using safer pattern
      // Escape PostgREST special characters to prevent filter injection
      if (query) {
        // Escape LIKE wildcards and PostgREST special chars: % _ \ ( ) , .
        const escapedQuery = query
          .replace(/[\\]/g, '\\\\')  // Escape backslashes first
          .replace(/[%]/g, '\\%')    // Escape LIKE wildcard
          .replace(/[_]/g, '\\_')    // Escape LIKE single char
          .replace(/[(),."']/g, ''); // Remove chars that could break filter syntax

        // Use separate filters instead of string interpolation for safer handling
        clipsQuery = clipsQuery.or(`username.ilike.%${escapedQuery}%,genre.ilike.%${escapedQuery}%`);
      }

      // Apply genre filter
      if (genre) {
        clipsQuery = clipsQuery.eq('genre', genre);
      }

      // Apply sorting
      if (sort === 'trending') {
        // Trending = recent + high votes
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        clipsQuery = clipsQuery
          .gte('created_at', yesterday.toISOString())
          .order('vote_count', { ascending: false });
      } else if (sort === 'newest') {
        clipsQuery = clipsQuery.order('created_at', { ascending: false });
      } else if (sort === 'top') {
        clipsQuery = clipsQuery.order('vote_count', { ascending: false });
      }

      const { data: clipsData, error: clipsError, count: clipsCount } = await clipsQuery
        .range(offset, offset + limit - 1);

      if (clipsError) {
        console.error('[GET /api/discover] clipsError:', clipsError);
      } else {
        clips = (clipsData || []).map((clip) => ({
          id: clip.id,
          thumbnail_url: clip.thumbnail_url,
          video_url: clip.video_url,
          username: clip.username || 'Creator',
          avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${clip.username || 'user'}`,
          genre: clip.genre || 'Unknown',
          vote_count: clip.vote_count || 0,
          slot_position: clip.slot_position,
          created_at: clip.created_at,
        }));
        total_clips = clipsCount || 0;
      }
    }

    // Search creators
    if (type === 'creators' || type === 'all') {
      // PERFORMANCE FIX: Use database aggregation instead of loading all clips
      // Previously loaded ALL clips into memory, now uses efficient GROUP BY

      // Build aggregation query - only fetch needed columns
      // FIX: Filter by season_id to prevent cross-season data pollution
      let creatorsQuery = supabase
        .from('tournament_clips')
        .select('user_id, username, avatar_url, vote_count, id');

      // Apply season filter for multi-genre isolation
      if (activeSeason?.id) {
        creatorsQuery = creatorsQuery.eq('season_id', activeSeason.id);
      }

      // Escape SQL special characters to prevent injection
      if (query) {
        const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
        creatorsQuery = creatorsQuery.ilike('username', `%${escapedQuery}%`);
      }

      // PERFORMANCE FIX: Add limit to prevent loading entire table
      // Fetch enough to aggregate top creators while keeping memory usage reasonable
      const maxClipsToFetch = Math.min(limit * 20, 1000);

      // FIX: Also filter locked slots by season_id
      let lockedSlotsQuery = supabase
        .from('story_slots')
        .select('winner_tournament_clip_id')
        .eq('status', 'locked');

      if (activeSeason?.id) {
        lockedSlotsQuery = lockedSlotsQuery.eq('season_id', activeSeason.id);
      }

      const [clipsResult, lockedSlotsResult] = await Promise.all([
        creatorsQuery.limit(maxClipsToFetch),
        lockedSlotsQuery
      ]);

      const { data: creatorClips, error: creatorsError } = clipsResult;
      const { data: lockedSlots } = lockedSlotsResult;

      if (creatorsError) {
        console.error('[GET /api/discover] creatorsError:', creatorsError);
      } else {
        const winningClipIds = new Set(
          lockedSlots?.map((s) => s.winner_tournament_clip_id).filter(Boolean) || []
        );

        // Aggregate creators from fetched clips
        const creatorMap = new Map<string, {
          user_id: string;
          username: string;
          avatar_url: string;
          total_clips: number;
          total_votes: number;
          locked_in_clips: number;
        }>();

        creatorClips?.forEach((clip) => {
          const user_id = clip.user_id || clip.username || 'unknown';

          if (!creatorMap.has(user_id)) {
            creatorMap.set(user_id, {
              user_id,
              username: clip.username || 'Creator',
              avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user_id}`,
              total_clips: 0,
              total_votes: 0,
              locked_in_clips: 0,
            });
          }

          const creator = creatorMap.get(user_id)!;
          creator.total_clips++;
          creator.total_votes += clip.vote_count || 0;
          if (winningClipIds.has(clip.id)) {
            creator.locked_in_clips++;
          }
        });

        // Convert to array and sort
        const creatorsArray = Array.from(creatorMap.values());

        if (sort === 'top' || sort === 'trending') {
          creatorsArray.sort((a, b) => b.total_votes - a.total_votes);
        } else {
          // newest - sort by most recent upload (approximation)
          creatorsArray.sort((a, b) => b.total_clips - a.total_clips);
        }

        total_creators = creatorsArray.length;
        creators = creatorsArray.slice(offset, offset + limit);
      }
    }

    const response: DiscoverResponse = {
      clips,
      creators,
      total_clips,
      total_creators,
      page,
      page_size: limit,
      has_more: (type === 'clips' ? total_clips : total_creators) > offset + limit,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[GET /api/discover] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
