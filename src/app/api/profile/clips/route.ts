// app/api/profile/clips/route.ts
// Profile Clips API - Returns user's uploaded clips with status

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface UserClip {
  id: string;
  slot_position: number;
  video_url: string;
  thumbnail_url: string;
  genre: string;
  vote_count: number;
  weighted_score: number;
  rank_in_track: number;
  created_at: string;
  status: 'pending' | 'approved' | 'competing' | 'locked_in' | 'eliminated';
  slot_status: 'upcoming' | 'voting' | 'locked' | 'archived';
  is_winner: boolean;
  is_pinned: boolean;
  eliminated_at: string | null;
  elimination_reason: string | null;
  video_deleted_at: string | null;
  days_until_deletion: number | null;
}

interface ProfileClipsResponse {
  clips: UserClip[];
  total_clips: number;
  locked_in_count: number;
  competing_count: number;
  pending_count: number;
}

/**
 * GET /api/profile/clips
 * Returns all clips uploaded by the user
 */
export async function GET(req: NextRequest) {
  // Rate limiting to prevent enumeration attacks
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from session
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      if (session?.user?.email) {
        // Find user by email
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('email', session.user.email)
          .single();
        
        if (userData) {
          userId = userData.id;
        }
      }
    } catch {
      // No session or user not found
    }

    if (!userId) {
      return NextResponse.json({
        clips: [],
        total_clips: 0,
        locked_in_count: 0,
        competing_count: 0,
        pending_count: 0,
      } satisfies ProfileClipsResponse, { status: 401 });
    }

    // PERFORMANCE FIX: Select only needed columns instead of SELECT *
    // Add pagination to prevent memory issues with prolific creators
    const MAX_CLIPS = 200; // Reasonable limit for profile display

    // Get user's clips from tournament_clips using user_id (UUID)
    const { data: clips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url, username, genre, vote_count, weighted_score, rank_in_track, status, slot_position, created_at, is_pinned, eliminated_at, elimination_reason, video_deleted_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_CLIPS);

    if (clipsError) {
      console.error('[GET /api/profile/clips] clipsError:', clipsError);
      return NextResponse.json(
        { error: 'Failed to fetch clips' },
        { status: 500 }
      );
    }

    if (!clips || clips.length === 0) {
      return NextResponse.json({
        clips: [],
        total_clips: 0,
        locked_in_count: 0,
        competing_count: 0,
        pending_count: 0,
      } satisfies ProfileClipsResponse);
    }

    // Get slot information for each clip
    const slotPositions = [...new Set(clips.map((c) => c.slot_position))];

    const { data: slots } = await supabase
      .from('story_slots')
      .select('slot_position, status, winner_tournament_clip_id')
      .in('slot_position', slotPositions);

    // Create a map of slot info
    const slotMap = new Map(
      slots?.map((s) => [s.slot_position, s]) || []
    );

    // Read grace period from feature flags
    const { data: elimFlag } = await supabase
      .from('feature_flags')
      .select('config')
      .eq('key', 'clip_elimination')
      .maybeSingle();
    const gracePeriodDays = (elimFlag?.config as Record<string, number>)?.grace_period_days ?? 14;

    // Enrich clips with status information
    const enrichedClips: UserClip[] = clips.map((clip) => {
      const slot = slotMap.get(clip.slot_position);
      const slot_status = slot?.status || 'upcoming';
      const is_winner = slot?.winner_tournament_clip_id === clip.id;

      // Determine clip status — use DB status directly for eliminated clips
      let status: UserClip['status'] = 'approved';

      if (clip.status === 'eliminated') {
        status = 'eliminated';
      } else if (is_winner || clip.status === 'locked') {
        status = 'locked_in';
      } else if (slot_status === 'voting') {
        status = 'competing';
      } else if (slot_status === 'locked' && !is_winner) {
        status = 'eliminated';
      } else if (slot_status === 'upcoming') {
        status = 'approved';
      }

      // Calculate days until video deletion for eliminated clips
      let days_until_deletion: number | null = null;
      if (status === 'eliminated' && clip.eliminated_at && !clip.video_deleted_at && !clip.is_pinned) {
        const eliminatedDate = new Date(clip.eliminated_at);
        const deleteDate = new Date(eliminatedDate.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
        const daysLeft = Math.ceil((deleteDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        days_until_deletion = Math.max(0, daysLeft);
      }

      return {
        id: clip.id,
        slot_position: clip.slot_position,
        video_url: clip.video_url,
        thumbnail_url: clip.thumbnail_url,
        genre: clip.genre || 'Unknown',
        vote_count: clip.vote_count || 0,
        weighted_score: clip.weighted_score || 0,
        rank_in_track: clip.rank_in_track || 0,
        created_at: clip.created_at,
        status,
        slot_status,
        is_winner,
        is_pinned: clip.is_pinned ?? false,
        eliminated_at: clip.eliminated_at ?? null,
        elimination_reason: clip.elimination_reason ?? null,
        video_deleted_at: clip.video_deleted_at ?? null,
        days_until_deletion,
      };
    });

    // Calculate counts
    const locked_in_count = enrichedClips.filter((c) => c.status === 'locked_in').length;
    const competing_count = enrichedClips.filter((c) => c.status === 'competing').length;
    const pending_count = enrichedClips.filter((c) => c.status === 'pending').length;

    const response: ProfileClipsResponse = {
      clips: enrichedClips,
      total_clips: enrichedClips.length,
      locked_in_count,
      competing_count,
      pending_count,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[GET /api/profile/clips] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
