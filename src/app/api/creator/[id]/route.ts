// /api/creator/[id]
// Get creator profile and their clips by username

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;
    const username = decodeURIComponent(id);

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Try to find user by username first
    let user = null;
    const { data: userByUsername } = await supabase
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (userByUsername) {
      user = userByUsername;
    } else {
      // Try to find by ID
      const { data: userById } = await supabase
        .from('users')
        .select('*')
        .eq('id', username)
        .single();
      user = userById;
    }

    // Get clips by this creator (by username match in tournament_clips)
    const { data: clips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url, vote_count, status, slot_position, username, created_at')
      .eq('username', username)
      .order('created_at', { ascending: false })
      .limit(50);

    if (clipsError) {
      console.error('Error fetching clips:', clipsError);
    }

    // Calculate stats from clips if user doesn't exist in users table
    const clipsList = clips || [];
    const totalVotesReceived = clipsList.reduce((sum, clip) => sum + (clip.vote_count || 0), 0);
    const clipsLocked = clipsList.filter(clip => clip.status === 'locked').length;

    // Build creator profile
    const creator = {
      id: user?.id || username,
      username: user?.username || username,
      avatar_url: user?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
      level: user?.level || 1,
      total_votes_received: user?.total_votes_received || totalVotesReceived,
      clips_uploaded: user?.clips_uploaded || clipsList.length,
      clips_locked: user?.clips_locked || clipsLocked,
      followers_count: user?.followers_count || 0,
      is_following: false, // TODO: Check if current user follows this creator
    };

    return NextResponse.json({
      creator,
      clips: clipsList,
    });
  } catch (err) {
    console.error('Get creator error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch creator data' },
      { status: 500 }
    );
  }
}
