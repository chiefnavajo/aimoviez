// app/api/profile/stats/route.ts
// Profile Stats API - Returns user statistics and achievements

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import crypto from 'crypto';

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
    const { data: allVotes, error: votesError } = await supabase
      .from('votes')
      .select('created_at, vote_weight')
      .eq('voter_key', voterKey)
      .order('created_at', { ascending: true });

    if (votesError) {
      console.error('[GET /api/profile/stats] votesError:', votesError);
      return NextResponse.json(
        { error: 'Failed to fetch votes' },
        { status: 500 }
      );
    }

    const total_votes = allVotes?.length || 0;

    // Calculate XP (1 XP per standard vote)
    const total_xp = allVotes?.reduce((sum, v) => sum + (v.vote_weight || 1), 0) || 0;
    const level = calculateLevel(total_xp);
    const xp_needed = xpForNextLevel(level);
    const xp_progress = ((total_xp % xp_needed) / xp_needed) * 100;

    // 2. Get votes today
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    const { data: todayVotes } = await supabase
      .from('votes')
      .select('id')
      .eq('voter_key', voterKey)
      .gte('created_at', todayStr);

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

    // Longest streak calculation (simplified)
    const longest_streak = current_streak; // For now, just use current

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
    const { data: allUsers } = await supabase
      .from('votes')
      .select('voter_key');

    // Count votes per user
    const userVoteCounts = new Map<string, number>();
    allUsers?.forEach((vote) => {
      userVoteCounts.set(vote.voter_key, (userVoteCounts.get(vote.voter_key) || 0) + 1);
    });

    const total_users = userVoteCounts.size;
    
    // Sort users by vote count
    const sortedUsers = Array.from(userVoteCounts.entries())
      .sort((a, b) => b[1] - a[1]);

    const global_rank = sortedUsers.findIndex(([key]) => key === voterKey) + 1 || total_users;

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

    // 7. Define badges
    const badges = [
      {
        id: 'first-vote',
        name: 'First Vote',
        icon: 'ðŸŽ¬',
        description: 'Cast your first vote',
        unlocked: achievements.first_vote,
      },
      {
        id: 'streak-7',
        name: '7 Day Streak',
        icon: 'ðŸ”¥',
        description: 'Vote for 7 consecutive days',
        unlocked: achievements.vote_streak_7,
        progress: current_streak,
        target: 7,
      },
      {
        id: 'streak-30',
        name: '30 Day Streak',
        icon: 'âš¡',
        description: 'Vote for 30 consecutive days',
        unlocked: achievements.vote_streak_30,
        progress: current_streak,
        target: 30,
      },
      {
        id: 'daily-goal',
        name: 'Daily Goal',
        icon: 'ðŸŽ¯',
        description: 'Cast 200 votes in one day',
        unlocked: achievements.daily_goal_reached,
        progress: votes_today,
        target: 200,
      },
      {
        id: 'creator',
        name: 'Creator',
        icon: 'ðŸŽ¥',
        description: 'Upload your first clip',
        unlocked: achievements.uploaded_first_clip,
      },
      {
        id: 'winner',
        name: 'Winner',
        icon: 'ðŸ†',
        description: 'Get a clip locked into the movie',
        unlocked: achievements.clip_locked_in,
      },
      {
        id: 'top-100',
        name: 'Top 100',
        icon: 'â­',
        description: 'Reach top 100 on leaderboard',
        unlocked: achievements.top_100,
      },
      {
        id: 'top-10',
        name: 'Top 10',
        icon: 'ðŸ’Ž',
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
  } catch (err: any) {
    console.error('[GET /api/profile/stats] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
