// app/api/leaderboard/live/route.ts
// Live Leaderboard API - Real-time combined leaderboard data

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

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

    // Fetch recent votes for voter aggregation (last 7 days, limit 10000)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: allVotes } = await supabase
      .from('votes')
      .select('voter_key, vote_weight')
      .gte('created_at', sevenDaysAgo.toISOString())
      .limit(10000);

    const voterMap = new Map<string, number>();
    allVotes?.forEach((vote) => {
      const count = voterMap.get(vote.voter_key) || 0;
      voterMap.set(vote.voter_key, count + (vote.vote_weight || 1));
    });

    const topVoters = Array.from(voterMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([voter_key, total_votes], index) => {
        const level = Math.floor(Math.sqrt(total_votes / 100)) + 1;
        return {
          rank: index + 1,
          username: `Voter${voter_key.substring(0, 6)}`,
          total_votes,
          level,
        };
      });

    // Trending (clips with most votes in last hour)
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const { data: recentVotes } = await supabase
      .from('votes')
      .select('clip_id')
      .gte('created_at', oneHourAgo.toISOString())
      .limit(5000);

    const recentVoteMap = new Map<string, number>();
    recentVotes?.forEach((vote) => {
      const count = recentVoteMap.get(vote.clip_id) || 0;
      recentVoteMap.set(vote.clip_id, count + 1);
    });

    // Get clip details for trending
    const trendingClipIds = Array.from(recentVoteMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);

    const { data: trendingClips } = await supabase
      .from('tournament_clips')
      .select('id, thumbnail_url, username, vote_count')
      .in('id', trendingClipIds);

    const trendingNow = (trendingClips || []).map((clip) => {
      const votes_last_hour = recentVoteMap.get(clip.id) || 0;
      const momentum = votes_last_hour / Math.max(clip.vote_count || 1, 1) * 100;
      
      return {
        id: clip.id,
        thumbnail_url: clip.thumbnail_url,
        username: clip.username || 'Creator',
        vote_count: clip.vote_count || 0,
        votes_last_hour,
        momentum: Math.round(momentum),
      };
    }).sort((a, b) => b.votes_last_hour - a.votes_last_hour);

    // Calculate stats
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const { data: todayVotes } = await supabase
      .from('votes')
      .select('voter_key')
      .gte('created_at', today.toISOString())
      .limit(10000);

    const activeVoters = new Set(todayVotes?.map((v) => v.voter_key) || []).size;

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
        total_votes: allVotes?.length || 0,
        active_voters: activeVoters,
        last_updated: new Date().toISOString(),
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error('[GET /api/leaderboard/live] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
