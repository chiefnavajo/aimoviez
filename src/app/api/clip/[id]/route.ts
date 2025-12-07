// app/api/clip/[id]/route.ts
// Single Clip API - Fetch clip details by ID
// SECURITY: Uses anon key for public clip data, requires auth for user-specific data

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Use anon key for public reads (defense in depth with RLS)
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// Service role only for user lookup
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface ClipResponse {
  clip: {
    id: string;
    video_url: string;
    thumbnail_url: string;
    username: string;
    avatar_url: string;
    title: string;
    description: string;
    vote_count: number;
    weighted_score: number;
    genre: string;
    slot_position: number;
    status: 'pending' | 'active' | 'voting' | 'locked' | 'rejected';
    is_winner: boolean;
    created_at: string;
  };
  user_vote: {
    has_voted: boolean;
    vote_type: 'standard' | 'super' | 'mega' | null;
  };
  season: {
    id: string;
    name: string;
    status: string;
  } | null;
  slot: {
    id: string;
    slot_position: number;
    status: string;
    voting_ends_at: string | null;
  } | null;
  stats: {
    comment_count: number;
    view_count: number;
    rank_in_slot: number;
    total_clips_in_slot: number;
  };
}

/**
 * GET /api/clip/[id]
 * Returns detailed information about a specific clip
 * SECURITY: Uses anon key for public data, auth for user-specific vote status
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id: clipId } = await params;
    // SECURITY FIX: Use anon key for public clip data (RLS enforced)
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get authenticated user ID if logged in (for vote status)
    let userId: string | null = null;
    try {
      const session = await getServerSession();
      if (session?.user?.email) {
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', session.user.email)
          .single();
        userId = userData?.id || null;
      }
    } catch {
      // No session - anonymous user
    }

    // 1. Fetch the clip
    const { data: clip, error: clipError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url, username, avatar_url, title, description, vote_count, weighted_score, genre, slot_position, status, view_count, created_at')
      .eq('id', clipId)
      .maybeSingle();

    if (clipError) {
      console.error('[GET /api/clip/[id]] clipError:', clipError);
      return NextResponse.json(
        { error: 'Failed to fetch clip' },
        { status: 500 }
      );
    }

    if (!clip) {
      return NextResponse.json(
        { error: 'Clip not found' },
        { status: 404 }
      );
    }

    // 2. Check if authenticated user has voted on this clip
    // SECURITY FIX: Only check vote status for authenticated users by user_id
    let userVote = null;
    if (userId) {
      const { data: voteData } = await supabaseAdmin
        .from('votes')
        .select('vote_type')
        .eq('user_id', userId)
        .eq('clip_id', clipId)
        .maybeSingle();
      userVote = voteData;
    }

    // 3. Get slot info
    const { data: slot } = await supabase
      .from('story_slots')
      .select('id, slot_position, status, voting_ends_at, winner_tournament_clip_id, season_id')
      .eq('slot_position', clip.slot_position)
      .maybeSingle();

    // 4. Get season info if we have a slot
    let season = null;
    if (slot?.season_id) {
      const { data: seasonData } = await supabase
        .from('seasons')
        .select('id, name, status')
        .eq('id', slot.season_id)
        .maybeSingle();
      season = seasonData;
    }

    // 5. Get comment count
    const { count: commentCount } = await supabase
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('clip_id', clipId)
      .eq('is_deleted', false);

    // 6. Get rank in slot (how many clips have more votes)
    const { count: higherRankedClips } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('slot_position', clip.slot_position)
      .gt('vote_count', clip.vote_count || 0);

    const { count: totalClipsInSlot } = await supabase
      .from('tournament_clips')
      .select('id', { count: 'exact', head: true })
      .eq('slot_position', clip.slot_position);

    // 7. Determine clip status
    let clipStatus: 'pending' | 'active' | 'voting' | 'locked' | 'rejected' = 'active';
    const isWinner = slot?.winner_tournament_clip_id === clipId;

    if (clip.status === 'pending') {
      clipStatus = 'pending';
    } else if (clip.status === 'rejected') {
      clipStatus = 'rejected';
    } else if (isWinner) {
      clipStatus = 'locked';
    } else if (slot?.status === 'voting') {
      clipStatus = 'voting';
    } else if (slot?.status === 'locked') {
      clipStatus = 'active'; // Lost the slot
    }

    // 8. Build response
    const response: ClipResponse = {
      clip: {
        id: clip.id,
        video_url: clip.video_url || '',
        thumbnail_url: clip.thumbnail_url || clip.video_url || '',
        username: clip.username || 'Creator',
        avatar_url: clip.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${clip.username || 'default'}`,
        title: clip.title || '',
        description: clip.description || '',
        vote_count: clip.vote_count || 0,
        weighted_score: clip.weighted_score || 0,
        genre: clip.genre || 'Unknown',
        slot_position: clip.slot_position || 0,
        status: clipStatus,
        is_winner: isWinner,
        created_at: clip.created_at,
      },
      user_vote: {
        has_voted: !!userVote,
        vote_type: userVote?.vote_type || null,
      },
      season: season ? {
        id: season.id,
        name: season.name || 'Season',
        status: season.status,
      } : null,
      slot: slot ? {
        id: slot.id,
        slot_position: slot.slot_position,
        status: slot.status,
        voting_ends_at: slot.voting_ends_at,
      } : null,
      stats: {
        comment_count: commentCount || 0,
        view_count: clip.view_count || 0,
        rank_in_slot: (higherRankedClips || 0) + 1,
        total_clips_in_slot: totalClipsInSlot || 0,
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[GET /api/clip/[id]] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
