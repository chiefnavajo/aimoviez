// app/api/profile/clips/route.ts
// Profile Clips API - Returns user's uploaded clips with status

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const voterKey = getVoterKey(req);

    // Get user's clips from tournament_clips
    // Note: Assuming there's a user_id or uploader_key field
    // You may need to adjust based on your actual schema
    const { data: clips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('*')
      .eq('user_id', voterKey) // or .eq('uploader_key', voterKey)
      .order('created_at', { ascending: false });

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
      .select('slot_position, status, winning_clip_id')
      .in('slot_position', slotPositions);

    // Create a map of slot info
    const slotMap = new Map(
      slots?.map((s) => [s.slot_position, s]) || []
    );

    // Enrich clips with status information
    const enrichedClips: UserClip[] = clips.map((clip) => {
      const slot = slotMap.get(clip.slot_position);
      const slot_status = slot?.status || 'upcoming';
      const is_winner = slot?.winning_clip_id === clip.id;

      // Determine clip status
      let status: UserClip['status'] = 'approved';
      
      if (clip.moderation_status === 'pending') {
        status = 'pending';
      } else if (is_winner) {
        status = 'locked_in';
      } else if (slot_status === 'voting') {
        status = 'competing';
      } else if (slot_status === 'locked' && !is_winner) {
        status = 'eliminated';
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
  } catch (err: any) {
    console.error('[GET /api/profile/clips] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}
