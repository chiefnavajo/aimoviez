// app/api/leaderboard/route.ts
// ============================================================================
// LEADERBOARD API - Get Rankings with Stats
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { getTopClips } from '@/lib/leaderboard-redis';

// ============================================================================
// In-memory cache with TTL, size limit, and proper LRU eviction
// ============================================================================
const cache = new Map<string, { data: any; expires: number; lastAccessed: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 50; // Maximum number of cache entries

function getCached(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) {
    // Update last accessed time for LRU tracking
    entry.lastAccessed = Date.now();
    return entry.data;
  }
  cache.delete(key); // Clean up expired entry
  return null;
}

function setCache(key: string, data: any) {
  // Evict LEAST RECENTLY USED entry if cache is full
  if (cache.size >= MAX_CACHE_SIZE) {
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [k, v] of cache.entries()) {
      if (v.lastAccessed < lruTime) {
        lruTime = v.lastAccessed;
        lruKey = k;
      }
    }

    if (lruKey) cache.delete(lruKey);
  }

  const now = Date.now();
  cache.set(key, { data, expires: now + CACHE_TTL, lastAccessed: now });
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

// Pagination defaults
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100; // Reduced from 200 for better performance

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(request, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  // Cleanup expired cache entries periodically
  cleanupExpiredCache();

  // Parse pagination parameters
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10)),
    MAX_LIMIT
  );
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10));

  try {
    // Cache key includes pagination
    const cacheKey = `leaderboard_main_${limit}_${offset}`;
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

    // --- Redis-first path (when redis_leaderboards enabled) ---
    const { data: redisFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'redis_leaderboards')
      .maybeSingle();

    // Get active slot position (needed for both Redis and DB paths)
    const { data: activeSlot } = await supabase
      .from('story_slots')
      .select('position')
      .eq('status', 'active')
      .maybeSingle();

    if (redisFlag?.enabled && activeSlot) {
      const redisResult = await getTopClips(activeSlot.position, limit, offset);
      if (redisResult !== null) {
        // Fetch clip details for enrichment
        const clipIds = redisResult.entries.map(e => e.member);
        const { data: clipDetails } = await supabase
          .from('tournament_clips')
          .select('id, video_url, thumbnail_url, username, avatar_url, vote_count, genre, title, slot_position')
          .in('id', clipIds);

        const clipMap = new Map(clipDetails?.map(c => [c.id, c]) || []);

        const pageVotes = redisResult.entries.reduce((sum, e) => sum + e.score, 0);

        const rankedClips = redisResult.entries.map((entry, index) => {
          const clip = clipMap.get(entry.member);
          return {
            id: entry.member,
            video_url: clip?.video_url || '',
            thumbnail_url: clip?.thumbnail_url || '',
            username: clip?.username || 'Creator',
            avatar_url: clip?.avatar_url || '',
            vote_count: clip?.vote_count || 0,
            genre: clip?.genre || 'Unknown',
            title: clip?.title || '',
            slot_position: clip?.slot_position || activeSlot.position,
            rank: offset + index + 1,
            percentage: pageVotes > 0 ? (entry.score / pageVotes) * 100 : 0,
            trend: 'same' as const,
          };
        });

        const responseData = {
          success: true,
          clips: rankedClips,
          season: activeSeason,
          totalVotes: pageVotes,
          totalClips: redisResult.total,
          pagination: {
            limit,
            offset,
            hasMore: offset + limit < redisResult.total,
            total: redisResult.total,
          },
        };

        setCache(cacheKey, responseData);

        return NextResponse.json(responseData, {
          headers: {
            'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
            'X-Source': 'redis',
          },
        });
      }
      // Redis returned null — fall through to DB
    }

    // Get total count of active clips (for pagination info)
    const { count: totalClips, error: countError } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active');

    if (countError) {
      console.error('Count fetch error:', countError);
    }

    // Get paginated active clips with votes (LIMIT prevents OOM at scale)
    const { data: clips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url, username, avatar_url, vote_count, genre, title, slot_position')
      .eq('status', 'active')
      .order('vote_count', { ascending: false })
      .range(offset, offset + limit - 1);

    if (clipsError) {
      console.error('Clips fetch error:', clipsError);
      return NextResponse.json(
        { error: 'Failed to fetch clips' },
        { status: 500 }
      );
    }

    // Calculate rankings and percentages
    // Note: For accurate percentages across all clips, we'd need a separate aggregate query
    // For now, percentage is relative to this page (acceptable for leaderboard display)
    const pageVotes = clips?.reduce((sum, clip) => sum + (clip.vote_count || 0), 0) || 0;

    const rankedClips = (clips || []).map((clip, index) => ({
      ...clip,
      rank: offset + index + 1, // Global rank based on offset
      percentage: pageVotes > 0 ? (clip.vote_count / pageVotes) * 100 : 0,
      trend: 'same' as const, // Can be enhanced with historical data
    }));

    const responseData = {
      success: true,
      clips: rankedClips,
      season: activeSeason,
      totalVotes: pageVotes,
      totalClips: totalClips || 0,
      // Pagination info
      pagination: {
        limit,
        offset,
        hasMore: offset + limit < (totalClips || 0),
        total: totalClips || 0,
      },
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
