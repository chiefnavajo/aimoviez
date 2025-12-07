// app/api/leaderboard/route.ts
// ============================================================================
// LEADERBOARD API - Get Rankings with Stats
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

// ============================================================================
// In-memory cache with TTL and size limit
// ============================================================================
const cache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 50; // Maximum number of cache entries

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) {
    return entry.data;
  }
  cache.delete(key); // Clean up expired entry
  return null;
}

function setCache(key: string, data: any) {
  // Evict oldest entries if cache is full
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
}

// Periodic cleanup of expired entries (runs on each request, lightweight)
function cleanupExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now >= entry.expires) {
      cache.delete(key);
    }
  }
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(request, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  // Cleanup expired cache entries periodically
  cleanupExpiredCache();

  try {
    // Check cache first
    const cacheKey = 'leaderboard_main';
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'X-Cache': 'HIT',
        },
      });
    }

    const supabase = getSupabaseClient();

    // Get active season (only needed fields)
    const { data: seasons, error: seasonError } = await supabase
      .from('seasons')
      .select('id, name, status, total_slots, start_date, end_date')
      .eq('status', 'active')
      .limit(1);

    if (seasonError) {
      console.error('Season fetch error:', seasonError);
      return NextResponse.json(
        { error: 'Failed to fetch season' },
        { status: 500 }
      );
    }

    const activeSeason = seasons?.[0];

    if (!activeSeason) {
      return NextResponse.json({
        success: true,
        clips: [],
        season: null,
        message: 'No active season',
      });
    }

    // Get all active clips with votes (optimized SELECT - only needed fields)
    const { data: clips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url, username, avatar_url, vote_count, genre, title, slot_position')
      .eq('status', 'active')
      .order('vote_count', { ascending: false });

    if (clipsError) {
      console.error('Clips fetch error:', clipsError);
      return NextResponse.json(
        { error: 'Failed to fetch clips' },
        { status: 500 }
      );
    }

    // Calculate rankings and percentages
    const totalVotes = clips?.reduce((sum, clip) => sum + (clip.vote_count || 0), 0) || 0;

    const rankedClips = (clips || []).map((clip, index) => ({
      ...clip,
      rank: index + 1,
      percentage: totalVotes > 0 ? (clip.vote_count / totalVotes) * 100 : 0,
      trend: 'same' as const, // Can be enhanced with historical data
    }));

    const responseData = {
      success: true,
      clips: rankedClips,
      season: activeSeason,
      totalVotes,
      totalClips: clips?.length || 0,
    };

    // Cache the response
    setCache(cacheKey, responseData);

    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('GET /api/leaderboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
