// app/api/leaderboard/live/route.ts
// Live Leaderboard API - Real-time combined leaderboard data

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';
import { getTopClips, getTopVoters, getTopCreators } from '@/lib/leaderboard-redis';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface LiveLeaderboardResponse {
  top_clips: Array<{
    rank: number;
    id: string;
    thumbnail_url: string;
    username: string;
    vote_count: number;
    slot_position: number;
  }>;
  top_creators: Array<{
    rank: number;
    username: string;
    avatar_url: string;
    total_votes: number;
    locked_in_clips: number;
  }>;
  top_voters: Array<{
    rank: number;
    username: string;
    total_votes: number;
    level: number;
  }>;
  trending_now: Array<{
    id: string;
    thumbnail_url: string;
    username: string;
    vote_count: number;
    votes_last_hour: number;
    momentum: number;
  }>;
  stats: {
    total_clips: number;
    total_votes: number;
    active_voters: number;
    last_updated: string;
  };
}

/**
 * GET /api/leaderboard/live
 * Returns condensed live leaderboard data for dashboard display
 * 
 * No pagination - returns top 10 of each category
 */
export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- Redis-first path ---
    const { data: redisFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'redis_leaderboards')
      .maybeSingle();

    if (redisFlag?.enabled) {
      // Get active slot position (use first active slot for live leaderboard)
      // Multi-genre: In future, could accept genre param to filter
      const { data: activeSlot } = await supabase
        .from('story_slots')
        .select('slot_position, season_id')
        .eq('status', 'voting')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (activeSlot) {
        // Parallel Redis reads
        const [redisClips, redisVoters, redisCreators] = await Promise.all([
          getTopClips(activeSlot.season_id, activeSlot.slot_position, 10, 0),
          getTopVoters('all', 10, 0),
          getTopCreators(10, 0),
        ]);

        if (redisClips && redisVoters && redisCreators) {
          // Enrich clips
          const clipIds = redisClips.entries.map(e => e.member);
          const { data: clipDetails } = await supabase
            .from('tournament_clips')
            .select('id, thumbnail_url, username, vote_count, slot_position')
            .in('id', clipIds);

          const clipMap = new Map(clipDetails?.map(c => [c.id, c]) || []);

          const top_clips = redisClips.entries.map((entry, index) => {
            const clip = clipMap.get(entry.member);
            return {
              rank: index + 1,
              id: entry.member,
              thumbnail_url: clip?.thumbnail_url || '',
              username: clip?.username || 'Creator',
              vote_count: clip?.vote_count || 0,
              slot_position: clip?.slot_position || activeSlot.slot_position,
            };
          });

          // Enrich creators
          const creatorNames = redisCreators.entries.map(e => e.member);
          const { data: creatorClips } = await supabase
            .from('tournament_clips')
            .select('username, avatar_url, id')
            .in('username', creatorNames);

          const { data: lockedSlots } = await supabase
            .from('story_slots')
            .select('winner_tournament_clip_id')
            .eq('status', 'locked');

          const winningClipIds = new Set(
            lockedSlots?.map(s => s.winner_tournament_clip_id).filter(Boolean) || []
          );

          const creatorMeta = new Map<string, { avatar_url: string; locked_in_clips: number }>();
          creatorClips?.forEach(clip => {
            const existing = creatorMeta.get(clip.username);
            if (!existing) {
              creatorMeta.set(clip.username, {
                avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${clip.username}`,
                locked_in_clips: winningClipIds.has(clip.id) ? 1 : 0,
              });
            } else if (winningClipIds.has(clip.id)) {
              existing.locked_in_clips++;
            }
          });

          const top_creators = redisCreators.entries.map((entry, index) => {
            const meta = creatorMeta.get(entry.member);
            return {
              rank: index + 1,
              username: entry.member,
              avatar_url: meta?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.member}`,
              total_votes: entry.score,
              locked_in_clips: meta?.locked_in_clips || 0,
            };
          });

          // Voter entries (minimal enrichment needed)
          const top_voters = redisVoters.entries.map((entry, index) => ({
            rank: index + 1,
            username: entry.member.startsWith('user_')
              ? `User${entry.member.substring(5, 11)}`
              : `Voter${entry.member.substring(0, 6)}`,
            total_votes: entry.score,
            level: Math.floor(Math.sqrt(entry.score / 100)) + 1,
          }));

          // Trending + stats still from DB (Redis doesn't track hype_score or today's counts)
          const { data: trendingClips } = await supabase
            .from('tournament_clips')
            .select('id, thumbnail_url, username, vote_count, hype_score')
            .order('hype_score', { ascending: false })
            .limit(10);

          const trendingNow = (trendingClips || []).map(clip => ({
            id: clip.id,
            thumbnail_url: clip.thumbnail_url,
            username: clip.username || 'Creator',
            vote_count: clip.vote_count || 0,
            votes_last_hour: Math.round((clip.hype_score || 0) / 10),
            momentum: Math.round(clip.hype_score || 0),
          }));

          const todayDate = new Date();
          todayDate.setUTCHours(0, 0, 0, 0);

          const { count: todayVoteCount } = await supabase
            .from('votes')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', todayDate.toISOString());

          const response: LiveLeaderboardResponse = {
            top_clips,
            top_creators,
            top_voters,
            trending_now: trendingNow,
            stats: {
              total_clips: redisClips.total,
              total_votes: todayVoteCount || 0,
              active_voters: redisVoters.total,
              last_updated: new Date().toISOString(),
            },
          };

          return NextResponse.json(response, {
            status: 200,
            headers: {
              'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60',
              'X-Source': 'redis',
            },
          });
        }
      }
      // Redis returned null — fall through to DB
    }

    // Fetch top clips
    const { data: topClips } = await supabase
      .from('tournament_clips')
      .select('id, thumbnail_url, username, vote_count, slot_position')
      .order('vote_count', { ascending: false })
      .limit(10);

    // Fetch top clips for creator aggregation (limit to top 500 by vote count)
    const { data: allClips } = await supabase
      .from('tournament_clips')
      .select('user_id, username, avatar_url, vote_count, id')
      .order('vote_count', { ascending: false })
      .limit(500);

    // Get locked slots
    const { data: lockedSlots } = await supabase
      .from('story_slots')
      .select('winner_tournament_clip_id')
      .eq('status', 'locked');

    const winningClipIds = new Set(
      lockedSlots?.map((s) => s.winner_tournament_clip_id).filter(Boolean) || []
    );

    // Aggregate creators
    const creatorMap = new Map<string, {
      username: string;
      avatar_url: string;
      total_votes: number;
      locked_in_clips: number;
    }>();

    allClips?.forEach((clip) => {
      const user_id = clip.user_id || clip.username || 'unknown';
      
      if (!creatorMap.has(user_id)) {
        creatorMap.set(user_id, {
          username: clip.username || 'Creator',
          avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user_id}`,
          total_votes: 0,
          locked_in_clips: 0,
        });
      }

      const creator = creatorMap.get(user_id)!;
      creator.total_votes += clip.vote_count || 0;
      if (winningClipIds.has(clip.id)) {
        creator.locked_in_clips++;
      }
    });

    const topCreators = Array.from(creatorMap.values())
      .sort((a, b) => b.total_votes - a.total_votes)
      .slice(0, 10)
      .map((creator, index) => ({
        rank: index + 1,
        ...creator,
      }));

    // PERFORMANCE FIX: Use materialized view for top voters instead of loading 10K votes
    // Falls back to users table if materialized view not available
    const { data: topVotersData } = await supabase
      .from('mv_user_vote_counts')
      .select('voter_key, vote_count')
      .order('vote_count', { ascending: false })
      .limit(10);

    const topVoters = (topVotersData || []).map((voter, index) => {
      const level = Math.floor(Math.sqrt((voter.vote_count || 0) / 100)) + 1;
      return {
        rank: index + 1,
        username: voter.voter_key?.startsWith('user_')
          ? `User${voter.voter_key.substring(5, 11)}`
          : `Voter${(voter.voter_key || '').substring(0, 6)}`,
        total_votes: voter.vote_count || 0,
        level,
      };
    });

    // PERFORMANCE FIX: Use RPC or simple query for trending instead of loading 5K votes
    // Get clips with highest hype_score (already tracked) as proxy for trending
    const { data: trendingClips } = await supabase
      .from('tournament_clips')
      .select('id, thumbnail_url, username, vote_count, hype_score')
      .order('hype_score', { ascending: false })
      .limit(10);

    const trendingNow = (trendingClips || []).map((clip) => {
      // Use hype_score as momentum indicator
      const momentum = clip.hype_score || 0;

      return {
        id: clip.id,
        thumbnail_url: clip.thumbnail_url,
        username: clip.username || 'Creator',
        vote_count: clip.vote_count || 0,
        votes_last_hour: Math.round(momentum / 10), // Approximate from hype_score
        momentum: Math.round(momentum),
      };
    });

    // PERFORMANCE FIX: Use COUNT instead of loading 10K votes into memory
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Count today's votes efficiently
    const { count: todayVoteCount } = await supabase
      .from('votes')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    // Get active voters count from materialized view (already aggregated)
    const { count: activeVoters } = await supabase
      .from('mv_user_vote_counts')
      .select('*', { count: 'exact', head: true });

    const response: LiveLeaderboardResponse = {
      top_clips: (topClips || []).map((clip, index) => ({
        rank: index + 1,
        id: clip.id,
        thumbnail_url: clip.thumbnail_url,
        username: clip.username || 'Creator',
        vote_count: clip.vote_count || 0,
        slot_position: clip.slot_position,
      })),
      top_creators: topCreators,
      top_voters: topVoters,
      trending_now: trendingNow,
      stats: {
        total_clips: allClips?.length || 0,
        total_votes: todayVoteCount || 0,
        active_voters: activeVoters || 0,
        last_updated: new Date().toISOString(),
      },
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
      },
    });
  } catch (err) {
    console.error('[GET /api/leaderboard/live] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
