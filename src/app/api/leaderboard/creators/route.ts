// app/api/leaderboard/creators/route.ts
// Leaderboard Creators API - Top content creators by total votes
// OPTIMIZED: Uses database aggregation instead of loading all clips

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { getTopCreators } from '@/lib/leaderboard-redis';

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
 * OPTIMIZED: Uses database GROUP BY for aggregation
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
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- Redis-first path (when redis_leaderboards enabled) ---
    const { data: redisFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'redis_leaderboards')
      .maybeSingle();

    // Get active season for multi-genre filtering
    const { data: activeSeason } = await supabase
      .from('seasons')
      .select('id')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    // FIX: Include season_id in cache key to prevent cross-genre data pollution
    const cacheKey = `leaderboard_creators_${activeSeason?.id || 'no-season'}_${timeframe}_${page}_${limit}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'X-Cache': 'HIT',
        },
      });
    }

    if (redisFlag?.enabled) {
      const redisResult = await getTopCreators(limit, offset, activeSeason?.id);
      if (redisResult !== null) {
        // Fetch creator details from tournament_clips for enrichment
        // Multi-genre: filter by season_id to prevent cross-genre pollution
        const usernames = redisResult.entries.map(e => e.member);
        let creatorClipsQuery = supabase
          .from('tournament_clips')
          .select('username, avatar_url, id, vote_count')
          .in('username', usernames);

        if (activeSeason?.id) {
          creatorClipsQuery = creatorClipsQuery.eq('season_id', activeSeason.id);
        }

        const { data: creatorClips } = await creatorClipsQuery;

        // Get locked slots for locked_in count - filter by season_id
        let lockedSlotsQuery = supabase
          .from('story_slots')
          .select('winner_tournament_clip_id')
          .eq('status', 'locked');

        if (activeSeason?.id) {
          lockedSlotsQuery = lockedSlotsQuery.eq('season_id', activeSeason.id);
        }

        const { data: lockedSlots } = await lockedSlotsQuery;

        const winningClipIds = new Set(
          lockedSlots?.map(s => s.winner_tournament_clip_id).filter(Boolean) || []
        );

        // Aggregate per creator
        const creatorInfo = new Map<string, {
          avatar_url: string;
          total_clips: number;
          locked_in_clips: number;
          best_clip_id: string;
          best_clip_votes: number;
        }>();

        creatorClips?.forEach(clip => {
          const existing = creatorInfo.get(clip.username);
          if (!existing) {
            creatorInfo.set(clip.username, {
              avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${clip.username}`,
              total_clips: 1,
              locked_in_clips: winningClipIds.has(clip.id) ? 1 : 0,
              best_clip_id: clip.id,
              best_clip_votes: clip.vote_count || 0,
            });
          } else {
            existing.total_clips++;
            if (winningClipIds.has(clip.id)) existing.locked_in_clips++;
            if ((clip.vote_count || 0) > existing.best_clip_votes) {
              existing.best_clip_id = clip.id;
              existing.best_clip_votes = clip.vote_count || 0;
            }
          }
        });

        const creators: LeaderboardCreator[] = redisResult.entries.map((entry, index) => {
          const info = creatorInfo.get(entry.member);
          return {
            rank: offset + index + 1,
            user_id: entry.member,
            username: entry.member,
            avatar_url: info?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.member}`,
            total_clips: info?.total_clips || 0,
            total_votes: entry.score,
            locked_in_clips: info?.locked_in_clips || 0,
            avg_votes_per_clip: info?.total_clips ? Math.round(entry.score / info.total_clips) : 0,
            top_genre: 'Various',
            best_clip_id: info?.best_clip_id || '',
            best_clip_votes: info?.best_clip_votes || 0,
          };
        });

        const responseData = {
          creators,
          timeframe,
          total_creators: redisResult.total,
          page,
          page_size: limit,
          has_more: redisResult.total > offset + limit,
        } satisfies LeaderboardCreatorsResponse;

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

    // Try to use RPC function first (most efficient)
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_top_creators', {
      p_limit: limit,
      p_offset: offset,
      p_timeframe: timeframe,
    });

    // If RPC exists and works, use it
    if (!rpcError && rpcData && rpcData.length >= 0) {
      // Get total count of unique creators
      const { count: totalCount } = await supabase
        .from('tournament_clips')
        .select('username', { count: 'exact', head: true });

      const total_creators = totalCount || 0;

      const creators: LeaderboardCreator[] = rpcData.map((row: any, index: number) => ({
        rank: offset + index + 1,
        user_id: row.username || 'unknown',
        username: row.username || 'Creator',
        avatar_url: row.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${row.username}`,
        total_clips: Number(row.total_clips) || 0,
        total_votes: Number(row.total_votes) || 0,
        locked_in_clips: Number(row.locked_clips) || 0,
        avg_votes_per_clip: row.total_clips > 0 ? Math.round(Number(row.total_votes) / Number(row.total_clips)) : 0,
        top_genre: 'Various', // Skip for performance in RPC
        best_clip_id: row.best_clip_id || '',
        best_clip_votes: Number(row.best_clip_votes) || 0,
      }));

      const responseData = {
        creators,
        timeframe,
        total_creators,
        page,
        page_size: limit,
        has_more: total_creators > offset + limit,
      } satisfies LeaderboardCreatorsResponse;

      // Cache the response
      setCache(cacheKey, responseData);

      return NextResponse.json(responseData, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'X-Cache': 'MISS',
        },
      });
    }

    // FALLBACK: Use optimized query with LIMIT (not loading all clips)
    // Calculate date boundaries
    let startDate: string | null = null;
    if (timeframe === 'today') {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      startDate = today.toISOString();
    } else if (timeframe === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      startDate = weekAgo.toISOString();
    }

    // Fetch clips with limit - multi-genre: filter by season_id
    let query = supabase
      .from('tournament_clips')
      .select('id, username, avatar_url, vote_count, genre')
      .eq('status', 'active');

    if (activeSeason?.id) {
      query = query.eq('season_id', activeSeason.id);
    }

    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    const { data: clips, error } = await query.limit(10000); // Safety limit

    if (error) {
      console.error('[GET /api/leaderboard/creators] error:', error);
      return NextResponse.json({ error: 'Failed to fetch creators' }, { status: 500 });
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

    // Get locked slots to determine winners - filter by season_id
    let lockedSlotsQuery = supabase
      .from('story_slots')
      .select('winner_tournament_clip_id')
      .eq('status', 'locked');

    if (activeSeason?.id) {
      lockedSlotsQuery = lockedSlotsQuery.eq('season_id', activeSeason.id);
    }

    const { data: lockedSlots } = await lockedSlotsQuery;

    const winningClipIds = new Set(
      lockedSlots?.map((s) => s.winner_tournament_clip_id).filter(Boolean) || []
    );

    // Aggregate by creator (username)
    const creatorMap = new Map<
      string,
      {
        username: string;
        avatar_url: string;
        clips: typeof clips;
        total_votes: number;
        locked_in_clips: number;
      }
    >();

    clips.forEach((clip) => {
      const username = clip.username || 'unknown';

      if (!creatorMap.has(username)) {
        creatorMap.set(username, {
          username,
          avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
          clips: [],
          total_votes: 0,
          locked_in_clips: 0,
        });
      }

      const creator = creatorMap.get(username)!;
      creator.clips.push(clip);
      creator.total_votes += clip.vote_count || 0;
      if (winningClipIds.has(clip.id)) {
        creator.locked_in_clips++;
      }
    });

    // Convert to sorted array
    const creatorsArray = Array.from(creatorMap.values())
      .map((creator) => {
        const bestClip = creator.clips.reduce(
          (best, current) => ((current.vote_count || 0) > (best.vote_count || 0) ? current : best),
          creator.clips[0]
        );

        return {
          user_id: creator.username,
          username: creator.username,
          avatar_url: creator.avatar_url,
          total_clips: creator.clips.length,
          total_votes: creator.total_votes,
          locked_in_clips: creator.locked_in_clips,
          avg_votes_per_clip: Math.round(creator.total_votes / creator.clips.length),
          top_genre: 'Various', // Skip for performance
          best_clip_id: bestClip.id,
          best_clip_votes: bestClip.vote_count || 0,
        };
      })
      .sort((a, b) => b.total_votes - a.total_votes);

    // Paginate
    const total_creators = creatorsArray.length;
    const paginatedCreators = creatorsArray.slice(offset, offset + limit);

    const enrichedCreators: LeaderboardCreator[] = paginatedCreators.map((creator, index) => ({
      rank: offset + index + 1,
      ...creator,
    }));

    const responseData = {
      creators: enrichedCreators,
      timeframe,
      total_creators,
      page,
      page_size: limit,
      has_more: total_creators > offset + limit,
    } satisfies LeaderboardCreatorsResponse;

    // Cache the response
    setCache(cacheKey, responseData);

    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        'X-Cache': 'MISS',
      },
    });
  } catch (err) {
    console.error('[GET /api/leaderboard/creators] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
