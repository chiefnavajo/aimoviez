// app/api/discover/route.ts
// Discovery API - Search and browse clips and creators

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);
    
    const query = searchParams.get('q') || '';
    const genre = searchParams.get('genre');
    const sort = (searchParams.get('sort') || 'trending') as 'trending' | 'newest' | 'top';
    const type = (searchParams.get('type') || 'all') as 'clips' | 'creators' | 'all';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    let clips: DiscoverClip[] = [];
    let creators: DiscoverCreator[] = [];
    let total_clips = 0;
    let total_creators = 0;

    // Search clips
    if (type === 'clips' || type === 'all') {
      let clipsQuery = supabase
        .from('tournament_clips')
        .select('*', { count: 'exact' });

      // Apply search filter
      if (query) {
        clipsQuery = clipsQuery.or(`username.ilike.%${query}%,genre.ilike.%${query}%`);
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
      // Fetch all clips for creator aggregation
      let creatorsQuery = supabase.from('tournament_clips').select('*');

      if (query) {
        creatorsQuery = creatorsQuery.ilike('username', `%${query}%`);
      }

      const { data: allClips, error: creatorsError } = await creatorsQuery;

      if (creatorsError) {
        console.error('[GET /api/discover] creatorsError:', creatorsError);
      } else {
        // Get locked slots
        const { data: lockedSlots } = await supabase
          .from('story_slots')
          .select('winning_clip_id')
          .eq('status', 'locked');

        const winningClipIds = new Set(
          lockedSlots?.map((s) => s.winning_clip_id).filter(Boolean) || []
        );

        // Aggregate creators
        const creatorMap = new Map<string, {
          user_id: string;
          username: string;
          avatar_url: string;
          total_clips: number;
          total_votes: number;
          locked_in_clips: number;
        }>();

        allClips?.forEach((clip) => {
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
        let creatorsArray = Array.from(creatorMap.values());

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
  } catch (err: any) {
    console.error('[GET /api/discover] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
