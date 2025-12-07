// app/api/leaderboard/clips/route.ts
// Leaderboard Clips API - Top performing clips across all slots

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ============================================================================
// In-memory cache with TTL
// ============================================================================
const cache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(req.url);

    const timeframe = (searchParams.get('timeframe') || 'all') as 'today' | 'week' | 'all';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 100));
    const offset = (page - 1) * limit;

    // Check cache first
    const cacheKey = `leaderboard_clips_${timeframe}_${page}_${limit}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'X-Cache': 'HIT',
        },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Simple query without JOIN - more reliable across database configurations
    let query = supabase
      .from('tournament_clips')
      .select('id, thumbnail_url, video_url, username, avatar_url, genre, slot_position, vote_count, weighted_score, hype_score, created_at', { count: 'exact' })
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

    // Execute with pagination - single query returns clips with embedded slot data
    const { data: clips, error, count } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[GET /api/leaderboard/clips] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch leaderboard clips' },
        { status: 500 }
      );
    }

    // Enrich clips with rank - status defaults to competing
    const enrichedClips: LeaderboardClip[] = (clips || []).map((clip, index) => {
      // Sanitize thumbnail_url - if it's a video file, use placeholder
      let thumbnailUrl = clip.thumbnail_url;
      if (!thumbnailUrl || thumbnailUrl.endsWith('.mp4') || thumbnailUrl.endsWith('.webm') || thumbnailUrl.endsWith('.mov')) {
        thumbnailUrl = `https://api.dicebear.com/7.x/shapes/svg?seed=${clip.id}`;
      }

      return {
        rank: offset + index + 1,
        id: clip.id,
        thumbnail_url: thumbnailUrl,
        video_url: clip.video_url,
        username: clip.username || 'Creator',
        avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${clip.username || 'user'}`,
        genre: clip.genre || 'Unknown',
        slot_position: clip.slot_position,
        vote_count: clip.vote_count || 0,
        weighted_score: clip.weighted_score || 0,
        hype_score: clip.hype_score || 0,
        status: 'competing' as const,
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

    // Cache the response
    setCache(cacheKey, response);

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        'X-Cache': 'MISS',
      },
    });
  } catch (err) {
    console.error('[GET /api/leaderboard/clips] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
