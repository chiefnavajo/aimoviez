// app/api/leaderboard/clips/route.ts
// Leaderboard Clips API - Top performing clips across all slots

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface LeaderboardClip {
  rank: number;
  id: string;
  thumbnail_url: string;
  video_url: string;
  username: string;
  avatar_url: string;
  genre: string;
  slot_position: number;
  vote_count: number;
  weighted_score: number;
  hype_score: number;
  status: 'competing' | 'locked_in' | 'eliminated';
  created_at: string;
}

interface LeaderboardClipsResponse {
  clips: LeaderboardClip[];
  timeframe: 'today' | 'week' | 'all';
  total_clips: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

/**
 * GET /api/leaderboard/clips
 * Returns top clips by vote count
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
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('tournament_clips')
      .select('*', { count: 'exact' })
      .order('vote_count', { ascending: false })
      .order('weighted_score', { ascending: false });

    // Apply timeframe filter
    if (timeframe === 'today') {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      query = query.gte('created_at', today.toISOString());
    } else if (timeframe === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      query = query.gte('created_at', weekAgo.toISOString());
    }

    // Execute with pagination
    const { data: clips, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[GET /api/leaderboard/clips] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch leaderboard clips' },
        { status: 500 }
      );
    }

    // Get slot status for each clip
    const slotPositions = [...new Set(clips?.map((c) => c.slot_position) || [])];
    const { data: slots } = await supabase
      .from('story_slots')
      .select('slot_position, status, winning_clip_id')
      .in('slot_position', slotPositions);

    const slotMap = new Map(
      slots?.map((s) => [s.slot_position, s]) || []
    );

    // Enrich clips with rank and status
    const enrichedClips: LeaderboardClip[] = (clips || []).map((clip, index) => {
      const slot = slotMap.get(clip.slot_position);
      const is_winner = slot?.winning_clip_id === clip.id;
      
      let status: 'competing' | 'locked_in' | 'eliminated' = 'competing';
      if (is_winner) {
        status = 'locked_in';
      } else if (slot?.status === 'locked') {
        status = 'eliminated';
      }

      return {
        rank: offset + index + 1,
        id: clip.id,
        thumbnail_url: clip.thumbnail_url,
        video_url: clip.video_url,
        username: clip.username || 'Creator',
        avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${clip.username || 'user'}`,
        genre: clip.genre || 'Unknown',
        slot_position: clip.slot_position,
        vote_count: clip.vote_count || 0,
        weighted_score: clip.weighted_score || 0,
        hype_score: clip.hype_score || 0,
        status,
        created_at: clip.created_at,
      };
    });

    const response: LeaderboardClipsResponse = {
      clips: enrichedClips,
      timeframe,
      total_clips: count || 0,
      page,
      page_size: limit,
      has_more: (count || 0) > offset + limit,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error('[GET /api/leaderboard/clips] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
