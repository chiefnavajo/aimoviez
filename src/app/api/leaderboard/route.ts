// app/api/leaderboard/route.ts
// ============================================================================
// LEADERBOARD API - Get Rankings with Stats
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }
  
  return createClient(url, key);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    // Get active season
    const { data: seasons, error: seasonError } = await supabase
      .from('seasons')
      .select('*')
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

    // Get all active clips with votes
    const { data: clips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('*')
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

    return NextResponse.json({
      success: true,
      clips: rankedClips,
      season: activeSeason,
      totalVotes,
      totalClips: clips?.length || 0,
    });
  } catch (error) {
    console.error('GET /api/leaderboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
