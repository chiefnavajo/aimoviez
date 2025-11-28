// app/api/leaderboard/voters/route.ts
// Leaderboard Voters API - Top voters by vote count

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
 * Calculate streak for a voter
 */
function calculateStreak(votes: Array<{ created_at: string }>): number {
  if (votes.length === 0) return 0;

  const voteDates = new Set<string>();
  votes.forEach((vote) => {
    const date = new Date(vote.created_at);
    voteDates.add(date.toISOString().split('T')[0]);
  });

  let streak = 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - i);
    const checkStr = checkDate.toISOString().split('T')[0];
    
    if (voteDates.has(checkStr)) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * GET /api/leaderboard/voters
 * Returns top voters by vote count
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
    const currentVoterKey = getVoterKey(req);
    
    const timeframe = (searchParams.get('timeframe') || 'all') as 'today' | 'week' | 'all';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    // Fetch votes with timeframe filter
    let query = supabase.from('votes').select('voter_key, created_at, vote_weight');

    if (timeframe === 'today') {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      query = query.gte('created_at', today.toISOString());
    } else if (timeframe === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      query = query.gte('created_at', weekAgo.toISOString());
    }

    const { data: votes, error } = await query;

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

    // Aggregate by voter_key
    const voterMap = new Map<string, {
      voter_key: string;
      votes: any[];
      total_votes: number;
      votes_today: number;
    }>();

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    votes.forEach((vote) => {
      if (!voterMap.has(vote.voter_key)) {
        voterMap.set(vote.voter_key, {
          voter_key: vote.voter_key,
          votes: [],
          total_votes: 0,
          votes_today: 0,
        });
      }

      const voter = voterMap.get(vote.voter_key)!;
      voter.votes.push(vote);
      voter.total_votes += vote.vote_weight || 1;
      
      if (vote.created_at >= todayStr) {
        voter.votes_today++;
      }
    });

    // For 'all' timeframe, we need all votes to calculate streak
    // Fetch all votes for streak calculation if needed
    let allVotesMap: Map<string, any[]> | null = null;
    if (timeframe !== 'all') {
      const { data: allVotes } = await supabase
        .from('votes')
        .select('voter_key, created_at');
      
      if (allVotes) {
        allVotesMap = new Map();
        allVotes.forEach((vote) => {
          if (!allVotesMap!.has(vote.voter_key)) {
            allVotesMap!.set(vote.voter_key, []);
          }
          allVotesMap!.get(vote.voter_key)!.push(vote);
        });
      }
    }

    // Convert to array and calculate stats
    const votersArray = Array.from(voterMap.values()).map((voter) => {
      const votesForStreak = allVotesMap?.get(voter.voter_key) || voter.votes;
      const streak = calculateStreak(votesForStreak);
      const level = calculateLevel(voter.total_votes);
      const username = `Voter${voter.voter_key.substring(0, 6)}`;
      const avatar_url = `https://api.dicebear.com/7.x/avataaars/svg?seed=${voter.voter_key}`;

      return {
        voter_key: voter.voter_key,
        username,
        avatar_url,
        total_votes: voter.total_votes,
        votes_today: voter.votes_today,
        current_streak: streak,
        level,
        is_current_user: voter.voter_key === currentVoterKey,
      };
    });

    // Sort by total_votes descending
    votersArray.sort((a, b) => b.total_votes - a.total_votes);

    // Find current user's rank
    const currentUserRank = votersArray.findIndex((v) => v.is_current_user) + 1;

    // Paginate
    const total_voters = votersArray.length;
    const offset = (page - 1) * limit;
    const paginatedVoters = votersArray.slice(offset, offset + limit);

    // Add rank
    const enrichedVoters: LeaderboardVoter[] = paginatedVoters.map((voter, index) => ({
      rank: offset + index + 1,
      ...voter,
    }));

    const response: LeaderboardVotersResponse = {
      voters: enrichedVoters,
      timeframe,
      total_voters,
      page,
      page_size: limit,
      has_more: total_voters > offset + limit,
      current_user_rank: currentUserRank > 0 ? currentUserRank : undefined,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error('[GET /api/leaderboard/voters] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
