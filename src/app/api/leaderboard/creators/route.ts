// app/api/leaderboard/creators/route.ts
// Leaderboard Creators API - Top content creators by total votes

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface LeaderboardCreator {
  rank: number;
  user_id: string;
  username: string;
  avatar_url: string;
  total_clips: number;
  total_votes: number;
  locked_in_clips: number;
  avg_votes_per_clip: number;
  top_genre: string;
  best_clip_id: string;
  best_clip_votes: number;
}

interface LeaderboardCreatorsResponse {
  creators: LeaderboardCreator[];
  timeframe: 'today' | 'week' | 'all';
  total_creators: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

/**
 * GET /api/leaderboard/creators
 * Returns top creators by total votes received
 * 
 * Query params:
 * - timeframe: 'today' | 'week' | 'all' (default: 'all')
 * - page: number (default: 1)
 * - limit: number (default: 20, max: 100)
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);
    
    const timeframe = (searchParams.get('timeframe') || 'all') as 'today' | 'week' | 'all';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    // Fetch all clips (with timeframe filter if needed)
    let query = supabase.from('tournament_clips').select('*');

    if (timeframe === 'today') {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      query = query.gte('created_at', today.toISOString());
    } else if (timeframe === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      query = query.gte('created_at', weekAgo.toISOString());
    }

    const { data: clips, error } = await query;

    if (error) {
      console.error('[GET /api/leaderboard/creators] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch creators' },
        { status: 500 }
      );
    }

    if (!clips || clips.length === 0) {
      return NextResponse.json({
        creators: [],
        timeframe,
        total_creators: 0,
        page,
        page_size: limit,
        has_more: false,
      } satisfies LeaderboardCreatorsResponse);
    }

    // Get locked slots to determine winners
    const { data: lockedSlots } = await supabase
      .from('story_slots')
      .select('slot_position, winning_clip_id')
      .eq('status', 'locked');

    const winningClipIds = new Set(
      lockedSlots?.map((s) => s.winning_clip_id).filter(Boolean) || []
    );

    // Aggregate by creator (user_id)
    const creatorMap = new Map<string, {
      user_id: string;
      username: string;
      avatar_url: string;
      clips: any[];
      total_votes: number;
      locked_in_clips: number;
      genres: string[];
    }>();

    clips.forEach((clip) => {
      const user_id = clip.user_id || clip.username || 'unknown';
      
      if (!creatorMap.has(user_id)) {
        creatorMap.set(user_id, {
          user_id,
          username: clip.username || 'Creator',
          avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user_id}`,
          clips: [],
          total_votes: 0,
          locked_in_clips: 0,
          genres: [],
        });
      }

      const creator = creatorMap.get(user_id)!;
      creator.clips.push(clip);
      creator.total_votes += clip.vote_count || 0;
      if (winningClipIds.has(clip.id)) {
        creator.locked_in_clips++;
      }
      if (clip.genre) {
        creator.genres.push(clip.genre);
      }
    });

    // Convert to array and calculate additional stats
    const creatorsArray = Array.from(creatorMap.values()).map((creator) => {
      // Find top genre
      const genreCounts = new Map<string, number>();
      creator.genres.forEach((g) => {
        genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
      });
      let top_genre = 'Various';
      let maxCount = 0;
      genreCounts.forEach((count, genre) => {
        if (count > maxCount) {
          maxCount = count;
          top_genre = genre;
        }
      });

      // Find best clip
      const bestClip = creator.clips.reduce((best, current) => {
        return (current.vote_count || 0) > (best.vote_count || 0) ? current : best;
      }, creator.clips[0]);

      return {
        user_id: creator.user_id,
        username: creator.username,
        avatar_url: creator.avatar_url,
        total_clips: creator.clips.length,
        total_votes: creator.total_votes,
        locked_in_clips: creator.locked_in_clips,
        avg_votes_per_clip: Math.round(creator.total_votes / creator.clips.length),
        top_genre,
        best_clip_id: bestClip.id,
        best_clip_votes: bestClip.vote_count || 0,
      };
    });

    // Sort by total_votes descending
    creatorsArray.sort((a, b) => b.total_votes - a.total_votes);

    // Paginate
    const total_creators = creatorsArray.length;
    const offset = (page - 1) * limit;
    const paginatedCreators = creatorsArray.slice(offset, offset + limit);

    // Add rank
    const enrichedCreators: LeaderboardCreator[] = paginatedCreators.map((creator, index) => ({
      rank: offset + index + 1,
      ...creator,
    }));

    const response: LeaderboardCreatorsResponse = {
      creators: enrichedCreators,
      timeframe,
      total_creators,
      page,
      page_size: limit,
      has_more: total_creators > offset + limit,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error('[GET /api/leaderboard/creators] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
