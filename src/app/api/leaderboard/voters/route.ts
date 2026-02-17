// app/api/leaderboard/voters/route.ts
// Leaderboard Voters API - Top voters by vote count
// OPTIMIZED: Uses database aggregation instead of loading all votes

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import crypto from 'crypto';
import { getTopVoters, getVoterRank } from '@/lib/leaderboard-redis';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getVoterKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

interface LeaderboardVoter {
  rank: number;
  voter_key: string;
  username: string;
  avatar_url: string;
  total_votes: number;
  votes_today: number;
  current_streak: number;
  level: number;
  is_current_user: boolean;
}

interface LeaderboardVotersResponse {
  voters: LeaderboardVoter[];
  timeframe: 'today' | 'week' | 'all';
  total_voters: number;
  page: number;
  page_size: number;
  has_more: boolean;
  current_user_rank?: number;
}

/**
 * Calculate level from vote count
 */
function calculateLevel(voteCount: number): number {
  return Math.floor(Math.sqrt(voteCount / 100)) + 1;
}

/**
 * GET /api/leaderboard/voters
 * Returns top voters by vote count
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
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { searchParams } = new URL(req.url);
    const currentVoterKey = getVoterKey(req);

    const timeframe = (searchParams.get('timeframe') || 'all') as 'today' | 'week' | 'all';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    // --- Redis-first path (when redis_leaderboards enabled) ---
    const { data: redisFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'redis_leaderboards')
      .maybeSingle();

    if (redisFlag?.enabled && (timeframe === 'all' || timeframe === 'today')) {
      const redisResult = await getTopVoters(timeframe, limit, offset);
      if (redisResult !== null) {
        const redisRank = await getVoterRank(currentVoterKey, timeframe);

        // Fetch real user info for logged-in voters
        const userIds = redisResult.entries
          .map(e => e.member.startsWith('user_') ? e.member.replace('user_', '') : null)
          .filter((id): id is string => id !== null);

        const redisUserMap = new Map<string, { username: string; avatar_url: string }>();
        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from('users')
            .select('id, username, avatar_url')
            .in('id', userIds);

          users?.forEach((user) => {
            redisUserMap.set(user.id, {
              username: user.username || 'User',
              avatar_url: user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`,
            });
          });
        }

        const voters: LeaderboardVoter[] = redisResult.entries.map((entry, index) => {
          const userId = entry.member.startsWith('user_') ? entry.member.replace('user_', '') : null;
          const userInfo = userId ? redisUserMap.get(userId) : null;

          return {
            rank: offset + index + 1,
            voter_key: entry.member,
            username: userInfo?.username || `Voter${entry.member.substring(0, 6)}`,
            avatar_url: userInfo?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.member}`,
            total_votes: entry.score,
            votes_today: 0,
            current_streak: 0,
            level: calculateLevel(entry.score),
            is_current_user: entry.member === currentVoterKey,
          };
        });

        return NextResponse.json({
          voters,
          timeframe,
          total_voters: redisResult.total,
          page,
          page_size: limit,
          has_more: redisResult.total > offset + limit,
          current_user_rank: redisRank || undefined,
        } satisfies LeaderboardVotersResponse, {
          headers: {
            'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
            'X-Source': 'redis',
          },
        });
      }
      // Redis returned null — fall through to DB
    }

    // Calculate date boundaries
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    let startDate: string | null = null;
    if (timeframe === 'today') {
      startDate = todayStr;
    } else if (timeframe === 'week') {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      startDate = weekAgo.toISOString();
    }

    // Try to use RPC function first (most efficient)
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('get_top_voters', {
        p_limit: limit,
        p_offset: offset,
        p_timeframe: timeframe,
      });

    // If RPC exists and works, use it
    if (!rpcError && rpcData && rpcData.length >= 0) {
      // Get total count
      const { data: countData } = await supabase.rpc('get_voters_count', {
        p_timeframe: timeframe,
      });
      const total_voters = countData || 0;

      // Get current user's rank
      const { data: rankData } = await supabase.rpc('get_voter_rank', {
        p_voter_key: currentVoterKey,
        p_timeframe: timeframe,
      });

      // Fetch real user info for logged-in voters
      // voter_key for logged-in users is "user_{user_id}", extract user_ids
      const userIds = rpcData
        .map((row: any) => {
          if (row.voter_key?.startsWith('user_')) {
            return row.voter_key.replace('user_', '');
          }
          return null;
        })
        .filter((id: string | null): id is string => id !== null);

      const rpcUserMap = new Map<string, { username: string; avatar_url: string }>();
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, username, avatar_url')
          .in('id', userIds);

        users?.forEach((user) => {
          rpcUserMap.set(user.id, {
            username: user.username || 'User',
            avatar_url: user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`,
          });
        });
      }

      const voters: LeaderboardVoter[] = rpcData.map((row: any, index: number) => {
        // Check if this is a logged-in user (voter_key starts with "user_")
        const userId = row.voter_key?.startsWith('user_') ? row.voter_key.replace('user_', '') : null;
        const userInfo = userId ? rpcUserMap.get(userId) : null;

        return {
          rank: offset + index + 1,
          voter_key: row.voter_key,
          username: userInfo?.username || `Voter${row.voter_key?.substring(0, 6) || 'Unknown'}`,
          avatar_url: userInfo?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${row.voter_key}`,
          total_votes: Number(row.weighted_total) || Number(row.total_votes) || 0,
          votes_today: Number(row.votes_today) || 0,
          current_streak: 0, // Streak calculation requires more queries, skip for performance
          level: calculateLevel(Number(row.weighted_total) || Number(row.total_votes) || 0),
          is_current_user: row.voter_key === currentVoterKey,
        };
      });

      return NextResponse.json({
        voters,
        timeframe,
        total_voters,
        page,
        page_size: limit,
        has_more: total_voters > offset + limit,
        current_user_rank: rankData || undefined,
      } satisfies LeaderboardVotersResponse, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      });
    }

    // FALLBACK: Use optimized query with LIMIT (not loading all votes)
    // Build query with date filter - include user_id to look up real usernames
    let query = supabase.from('votes').select('voter_key, vote_weight, user_id');
    if (startDate) {
      query = query.gte('created_at', startDate);
    }

    // Get all voter_keys with their vote counts using a subquery approach
    // We load voter_key and vote_weight, then aggregate in JS (limited to reasonable size)
    const { data: votes, error } = await query.limit(5000); // Safety limit

    if (error) {
      console.error('[GET /api/leaderboard/voters] error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch voters' },
        { status: 500 }
      );
    }

    if (!votes || votes.length === 0) {
      return NextResponse.json({
        voters: [],
        timeframe,
        total_voters: 0,
        page,
        page_size: limit,
        has_more: false,
      } satisfies LeaderboardVotersResponse);
    }

    // Aggregate by voter_key (in memory, but limited)
    // Also track user_id for each voter_key
    const voterMap = new Map<string, { total_votes: number; user_id: string | null }>();
    votes.forEach((vote) => {
      const existing = voterMap.get(vote.voter_key);
      if (existing) {
        existing.total_votes += (vote.vote_weight || 1);
        // Keep user_id if we have one
        if (vote.user_id && !existing.user_id) {
          existing.user_id = vote.user_id;
        }
      } else {
        voterMap.set(vote.voter_key, {
          total_votes: vote.vote_weight || 1,
          user_id: vote.user_id || null,
        });
      }
    });

    // Convert to sorted array
    const sortedVoters = Array.from(voterMap.entries())
      .map(([voter_key, data]) => ({ voter_key, total_votes: data.total_votes, user_id: data.user_id }))
      .sort((a, b) => b.total_votes - a.total_votes);

    // Find current user's rank
    const currentUserRank = sortedVoters.findIndex((v) => v.voter_key === currentVoterKey) + 1;

    // Paginate
    const total_voters = sortedVoters.length;
    const paginatedVoters = sortedVoters.slice(offset, offset + limit);

    // Fetch real user info for logged-in voters
    const userIds = paginatedVoters
      .map((v) => v.user_id)
      .filter((id): id is string => id !== null);

    const userMap = new Map<string, { username: string; avatar_url: string }>();
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, username, avatar_url')
        .in('id', userIds);

      users?.forEach((user) => {
        userMap.set(user.id, {
          username: user.username || 'User',
          avatar_url: user.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`,
        });
      });
    }

    // Enrich with additional info - use real username for logged-in users
    const enrichedVoters: LeaderboardVoter[] = paginatedVoters.map((voter, index) => {
      const userInfo = voter.user_id ? userMap.get(voter.user_id) : null;
      return {
        rank: offset + index + 1,
        voter_key: voter.voter_key,
        username: userInfo?.username || `Voter${voter.voter_key?.substring(0, 6) || 'Unknown'}`,
        avatar_url: userInfo?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${voter.voter_key}`,
        total_votes: voter.total_votes,
        votes_today: 0, // Skip for performance in fallback
        current_streak: 0, // Skip for performance in fallback
        level: calculateLevel(voter.total_votes),
        is_current_user: voter.voter_key === currentVoterKey,
      };
    });

    return NextResponse.json({
      voters: enrichedVoters,
      timeframe,
      total_voters,
      page,
      page_size: limit,
      has_more: total_voters > offset + limit,
      current_user_rank: currentUserRank > 0 ? currentUserRank : undefined,
    } satisfies LeaderboardVotersResponse, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[GET /api/leaderboard/voters] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
