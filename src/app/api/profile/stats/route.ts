// app/api/profile/stats/route.ts
// Profile Stats API - Returns user statistics and achievements

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import crypto from 'crypto';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Generate voter key from IP + User-Agent
 */
function getVoterKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

interface UserProfile {
  id: string;
  username: string;
  avatar_url: string | null;
  email: string | null;
}

/**
 * Calculate level from XP
 */
function calculateLevel(xp: number): number {
  // Level formula: level = floor(sqrt(xp / 100))
  // Level 1 = 100 XP, Level 2 = 400 XP, Level 3 = 900 XP, etc.
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

/**
 * Calculate XP needed for next level
 */
function xpForNextLevel(currentLevel: number): number {
  return currentLevel * currentLevel * 100;
}

interface ProfileStatsResponse {
  user: {
    voter_key: string;
    username: string;
    avatar_url: string;
    level: number;
    current_xp: number;
    xp_for_next_level: number;
    xp_progress_percentage: number;
  };
  stats: {
    total_votes: number;
    votes_today: number;
    current_streak: number;
    longest_streak: number;
    clips_uploaded: number;
    clips_locked_in: number;
    global_rank: number;
    total_users: number;
  };
  badges: Array<{
    id: string;
    name: string;
    icon: string;
    description: string;
    unlocked: boolean;
    progress?: number;
    target?: number;
  }>;
  achievements: {
    first_vote: boolean;
    vote_streak_7: boolean;
    vote_streak_30: boolean;
    daily_goal_reached: boolean;
    uploaded_first_clip: boolean;
    clip_locked_in: boolean;
    top_100: boolean;
    top_10: boolean;
  };
}

/**
 * GET /api/profile/stats
 * Returns comprehensive user stats and achievements
 */
export async function GET(req: NextRequest) {
  // Rate limiting - 60 requests per minute
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const voterKey = getVoterKey(req);

    // Try to get logged-in user profile
    let userProfile: UserProfile | null = null;
    let userId: string | null = null;

    try {
      const session = await getServerSession();
      if (session?.user?.email) {
        const { data: userData } = await supabase
          .from('users')
          .select('id, username, avatar_url, email')
          .eq('email', session.user.email)
          .single();

        if (userData) {
          userProfile = userData;
          userId = userData.id;
        }
      }
    } catch {
      // No session
    }

    // 1. Get user's total votes
    // For logged-in users: get votes by BOTH user_id AND voter_key (covers votes before and after login)
    // For anonymous users: get votes by voter_key only
    let allVotes: { created_at: string; vote_weight: number }[] = [];

    if (userId) {
      // Logged in: get votes by user_id OR voter_key (union of both)
      // This ensures we capture votes made before login (voter_key only) and after (user_id set)
      const { data: userIdVotes, error: userIdError } = await supabase
        .from('votes')
        .select('created_at, vote_weight')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      const { data: voterKeyVotes, error: voterKeyError } = await supabase
        .from('votes')
        .select('created_at, vote_weight')
        .eq('voter_key', voterKey)
        .is('user_id', null) // Only get anonymous votes (not already counted by user_id)
        .order('created_at', { ascending: true });

      if (userIdError) {
        console.error('[GET /api/profile/stats] userIdError:', userIdError);
      }
      if (voterKeyError) {
        console.error('[GET /api/profile/stats] voterKeyError:', voterKeyError);
      }

      // Merge both sets of votes
      allVotes = [...(userIdVotes || []), ...(voterKeyVotes || [])];
      // Sort by date
      allVotes.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else {
      // Not logged in - use voter_key only
      const { data, error } = await supabase
        .from('votes')
        .select('created_at, vote_weight')
        .eq('voter_key', voterKey)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[GET /api/profile/stats] votesError:', error);
        return NextResponse.json(
          { error: 'Failed to fetch votes' },
          { status: 500 }
        );
      }
      allVotes = data || [];
    }

    const total_votes = allVotes?.length || 0;

    // Calculate XP (1 XP per standard vote)
    const total_xp = allVotes?.reduce((sum, v) => sum + (v.vote_weight || 1), 0) || 0;
    const level = calculateLevel(total_xp);
    const xp_needed = xpForNextLevel(level);
    const xp_progress = ((total_xp % xp_needed) / xp_needed) * 100;

    // 2. Get votes today (use user_id if logged in, otherwise voter_key)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    let todayVotes: { id: string }[] = [];
    if (userId) {
      const { data } = await supabase
        .from('votes')
        .select('id')
        .eq('user_id', userId)
        .gte('created_at', todayStr);
      todayVotes = data || [];
    } else {
      const { data } = await supabase
        .from('votes')
        .select('id')
        .eq('voter_key', voterKey)
        .gte('created_at', todayStr);
      todayVotes = data || [];
    }

    const votes_today = todayVotes?.length || 0;

    // 3. Calculate streak (simplified - days with at least 1 vote)
    const voteDates = new Set<string>();
    allVotes?.forEach((vote) => {
      const date = new Date(vote.created_at);
      const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
      voteDates.add(dateStr);
    });

    // Calculate current streak (consecutive days up to today)
    let current_streak = 0;
    const todayDate = new Date();
    todayDate.setUTCHours(0, 0, 0, 0);

    for (let i = 0; i < 365; i++) {
      const checkDate = new Date(todayDate);
      checkDate.setDate(checkDate.getDate() - i);
      const checkStr = checkDate.toISOString().split('T')[0];

      if (voteDates.has(checkStr)) {
        current_streak++;
      } else {
        break;
      }
    }

    // Calculate longest streak ever (find max consecutive days in all voting history)
    let longest_streak = current_streak;
    if (voteDates.size > 0) {
      // Sort all vote dates chronologically
      const sortedDates = Array.from(voteDates).sort();
      let tempStreak = 1;

      for (let i = 1; i < sortedDates.length; i++) {
        const prevDate = new Date(sortedDates[i - 1]);
        const currDate = new Date(sortedDates[i]);

        // Check if dates are consecutive (difference of 1 day)
        const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
          tempStreak++;
          if (tempStreak > longest_streak) {
            longest_streak = tempStreak;
          }
        } else {
          tempStreak = 1;
        }
      }
    }

    // 4. Get user's uploaded clips (use userId if logged in, otherwise voterKey)
    let userClips: { id: string; slot_position: number }[] = [];

    if (userId) {
      const { data } = await supabase
        .from('tournament_clips')
        .select('id, slot_position')
        .eq('user_id', userId);
      userClips = data || [];
    }

    const clips_uploaded = userClips.length;

    // Count locked clips (check if any of user's clips won their slot)
    let clips_locked_in = 0;
    if (userClips.length > 0) {
      const { data: lockedSlots } = await supabase
        .from('story_slots')
        .select('winner_tournament_clip_id')
        .eq('status', 'locked')
        .in('winner_tournament_clip_id', userClips.map((c) => c.id));

      clips_locked_in = lockedSlots?.length || 0;
    }

    // 5. Calculate global rank (based on total votes)
    // N+1 FIX: Use efficient RPC function instead of loading all votes
    let global_rank = 0;
    let total_users = 0;

    // Try fast method first (materialized view)
    const { data: rankDataFast, error: rankErrorFast } = await supabase.rpc(
      'get_user_rank_fast',
      { p_voter_key: voterKey }
    );

    if (!rankErrorFast && rankDataFast && rankDataFast.length > 0) {
      global_rank = Number(rankDataFast[0].global_rank) || 1;
      total_users = Number(rankDataFast[0].total_users) || 1;
    } else {
      // Fallback to slower but reliable method
      const { data: rankData, error: rankError } = await supabase.rpc(
        'get_user_global_rank',
        { p_voter_key: voterKey }
      );

      if (!rankError && rankData && rankData.length > 0) {
        global_rank = rankData[0].global_rank || 1;
        total_users = rankData[0].total_users || 1;
      } else {
        // Ultimate fallback: simple count-based estimate
        console.warn('[profile/stats] RPC not available, using fallback rank calculation');
        const { count: userCount } = await supabase
          .from('votes')
          .select('voter_key', { count: 'exact', head: true });
        total_users = userCount || 1;
        global_rank = Math.ceil(total_users / 2); // Estimate middle rank
      }
    }

    // 6. Define achievements
    const achievements = {
      first_vote: total_votes > 0,
      vote_streak_7: current_streak >= 7,
      vote_streak_30: current_streak >= 30,
      daily_goal_reached: votes_today >= 200,
      uploaded_first_clip: clips_uploaded > 0,
      clip_locked_in: clips_locked_in > 0,
      top_100: global_rank <= 100,
      top_10: global_rank <= 10,
    };

    // 7. Define badges (using Unicode escape sequences for reliable encoding)
    const badges = [
      {
        id: 'first-vote',
        name: 'First Vote',
        icon: '\u{1F3AC}', // clapper board
        description: 'Cast your first vote',
        unlocked: achievements.first_vote,
      },
      {
        id: 'streak-7',
        name: '7 Day Streak',
        icon: '\u{1F525}', // fire
        description: 'Vote for 7 consecutive days',
        unlocked: achievements.vote_streak_7,
        progress: current_streak,
        target: 7,
      },
      {
        id: 'streak-30',
        name: '30 Day Streak',
        icon: '\u{26A1}', // lightning
        description: 'Vote for 30 consecutive days',
        unlocked: achievements.vote_streak_30,
        progress: current_streak,
        target: 30,
      },
      {
        id: 'daily-goal',
        name: 'Daily Goal',
        icon: '\u{1F3AF}', // target
        description: 'Cast 200 votes in one day',
        unlocked: achievements.daily_goal_reached,
        progress: votes_today,
        target: 200,
      },
      {
        id: 'creator',
        name: 'Creator',
        icon: '\u{1F3A5}', // movie camera
        description: 'Upload your first clip',
        unlocked: achievements.uploaded_first_clip,
      },
      {
        id: 'winner',
        name: 'Winner',
        icon: '\u{1F3C6}', // trophy
        description: 'Get a clip locked into the movie',
        unlocked: achievements.clip_locked_in,
      },
      {
        id: 'top-100',
        name: 'Top 100',
        icon: '\u{2B50}', // star
        description: 'Reach top 100 on leaderboard',
        unlocked: achievements.top_100,
      },
      {
        id: 'top-10',
        name: 'Top 10',
        icon: '\u{1F48E}', // gem
        description: 'Reach top 10 on leaderboard',
        unlocked: achievements.top_10,
      },
    ];

    // 8. Use profile data if logged in, otherwise generate
    const username = userProfile?.username || `User${voterKey.substring(0, 6)}`;
    const avatar_url = userProfile?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${voterKey}`;

    // 9. Build response
    const response: ProfileStatsResponse = {
      user: {
        voter_key: voterKey,
        username,
        avatar_url,
        level,
        current_xp: total_xp,
        xp_for_next_level: xp_needed,
        xp_progress_percentage: xp_progress,
      },
      stats: {
        total_votes,
        votes_today,
        current_streak,
        longest_streak,
        clips_uploaded,
        clips_locked_in,
        global_rank,
        total_users,
      },
      badges,
      achievements,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[GET /api/profile/stats] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
