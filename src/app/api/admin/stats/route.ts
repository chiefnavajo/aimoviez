// app/api/admin/stats/route.ts
// Admin Stats API - Comprehensive dashboard analytics

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface AdminStatsResponse {
  overview: {
    total_users: number;
    total_clips: number;
    total_votes: number;
    pending_moderation: number;
  };
  growth: {
    users_today: number;
    clips_today: number;
    votes_today: number;
    users_growth_percent: number;
    clips_growth_percent: number;
    votes_growth_percent: number;
  };
  engagement: {
    avg_votes_per_user: number;
    avg_clips_per_creator: number;
    daily_active_users: number;
    weekly_active_users: number;
    retention_rate: number;
  };
  content: {
    clips_by_status: {
      pending: number;
      approved: number;
      competing: number;
      locked_in: number;
      rejected: number;
    };
    clips_by_genre: Record<string, number>;
    top_performing_genre: string;
  };
  season: {
    current_season_id: string;
    season_name: string;
    locked_slots: number;
    voting_slots: number;
    upcoming_slots: number;
    total_slots: number;
    completion_percent: number;
  };
  recent_activity: Array<{
    type: 'clip_uploaded' | 'slot_locked' | 'milestone_reached';
    description: string;
    timestamp: string;
  }>;
}

/**
 * GET /api/admin/stats
 * Returns comprehensive admin dashboard statistics
 * 
 * NOTE: This endpoint should be protected with admin authentication
 * For now, it's open but should be secured in production
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Time ranges
    const now = new Date();
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Fetch all data
    const [
      { data: allVotes },
      { data: allClips },
      { data: todayVotes },
      { data: yesterdayVotes },
      { data: todayClips },
      { data: yesterdayClips },
      { data: weekVotes },
      { data: activeSeason },
      { data: allSlots },
    ] = await Promise.all([
      supabase.from('votes').select('voter_key, created_at'),
      supabase.from('tournament_clips').select('*'),
      supabase.from('votes').select('voter_key').gte('created_at', today.toISOString()),
      supabase.from('votes').select('voter_key').gte('created_at', yesterday.toISOString()).lt('created_at', today.toISOString()),
      supabase.from('tournament_clips').select('id').gte('created_at', today.toISOString()),
      supabase.from('tournament_clips').select('id').gte('created_at', yesterday.toISOString()).lt('created_at', today.toISOString()),
      supabase.from('votes').select('voter_key').gte('created_at', weekAgo.toISOString()),
      supabase.from('seasons').select('*').eq('status', 'active').maybeSingle(),
      supabase.from('story_slots').select('status, winning_clip_id'),
    ]);

    // Calculate overview
    const uniqueVoters = new Set(allVotes?.map((v) => v.voter_key) || []);
    const total_users = uniqueVoters.size;
    const total_clips = allClips?.length || 0;
    const total_votes = allVotes?.length || 0;
    const pending_moderation = allClips?.filter((c) => c.moderation_status === 'pending').length || 0;

    // Calculate growth
    const todayVotersSet = new Set(todayVotes?.map((v) => v.voter_key) || []);
    const yesterdayVotersSet = new Set(yesterdayVotes?.map((v) => v.voter_key) || []);
    const users_today = todayVotersSet.size;
    const clips_today = todayClips?.length || 0;
    const votes_today = todayVotes?.length || 0;

    const users_yesterday = yesterdayVotersSet.size;
    const clips_yesterday = yesterdayClips?.length || 0;
    const votes_yesterday = yesterdayVotes?.length || 0;

    const users_growth_percent = users_yesterday > 0 
      ? Math.round(((users_today - users_yesterday) / users_yesterday) * 100)
      : 0;
    const clips_growth_percent = clips_yesterday > 0
      ? Math.round(((clips_today - clips_yesterday) / clips_yesterday) * 100)
      : 0;
    const votes_growth_percent = votes_yesterday > 0
      ? Math.round(((votes_today - votes_yesterday) / votes_yesterday) * 100)
      : 0;

    // Calculate engagement
    const avg_votes_per_user = total_users > 0 ? Math.round(total_votes / total_users) : 0;
    
    const creators = new Set(allClips?.map((c) => c.user_id || c.username).filter(Boolean) || []);
    const avg_clips_per_creator = creators.size > 0 ? Math.round(total_clips / creators.size) : 0;

    const daily_active_users = todayVotersSet.size;
    const weekly_active_users = new Set(weekVotes?.map((v) => v.voter_key) || []).size;
    
    const retention_rate = weekly_active_users > 0
      ? Math.round((daily_active_users / weekly_active_users) * 100)
      : 0;

    // Content stats
    const clips_by_status = {
      pending: allClips?.filter((c) => c.moderation_status === 'pending').length || 0,
      approved: allClips?.filter((c) => c.moderation_status === 'approved' && !allSlots?.find((s) => s.winning_clip_id === c.id)).length || 0,
      competing: allClips?.filter((c) => {
        const slot = allSlots?.find((s) => s.winning_clip_id === c.id);
        return !slot && c.moderation_status === 'approved';
      }).length || 0,
      locked_in: allSlots?.filter((s) => s.status === 'locked' && s.winning_clip_id).length || 0,
      rejected: allClips?.filter((c) => c.moderation_status === 'rejected').length || 0,
    };

    const genreCounts = new Map<string, number>();
    allClips?.forEach((clip) => {
      if (clip.genre) {
        genreCounts.set(clip.genre, (genreCounts.get(clip.genre) || 0) + 1);
      }
    });

    const clips_by_genre: Record<string, number> = Object.fromEntries(genreCounts);
    let top_performing_genre = 'None';
    let maxCount = 0;
    genreCounts.forEach((count, genre) => {
      if (count > maxCount) {
        maxCount = count;
        top_performing_genre = genre;
      }
    });

    // Season stats
    const locked_slots = allSlots?.filter((s) => s.status === 'locked').length || 0;
    const voting_slots = allSlots?.filter((s) => s.status === 'voting').length || 0;
    const upcoming_slots = allSlots?.filter((s) => s.status === 'upcoming').length || 0;
    const total_slots = activeSeason?.total_slots || 75;
    const completion_percent = Math.round((locked_slots / total_slots) * 100);

    // Recent activity (mock for now - would come from activity log)
    const recent_activity = [
      {
        type: 'slot_locked' as const,
        description: `Slot #${locked_slots} locked in`,
        timestamp: new Date().toISOString(),
      },
    ];

    const response: AdminStatsResponse = {
      overview: {
        total_users,
        total_clips,
        total_votes,
        pending_moderation,
      },
      growth: {
        users_today,
        clips_today,
        votes_today,
        users_growth_percent,
        clips_growth_percent,
        votes_growth_percent,
      },
      engagement: {
        avg_votes_per_user,
        avg_clips_per_creator,
        daily_active_users,
        weekly_active_users,
        retention_rate,
      },
      content: {
        clips_by_status,
        clips_by_genre,
        top_performing_genre,
      },
      season: {
        current_season_id: activeSeason?.id || '',
        season_name: activeSeason?.name || 'No Active Season',
        locked_slots,
        voting_slots,
        upcoming_slots,
        total_slots,
        completion_percent,
      },
      recent_activity,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error('[GET /api/admin/stats] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
