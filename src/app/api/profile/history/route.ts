// app/api/profile/history/route.ts
// Profile History API - Returns user's voting history
// SECURITY: Requires authentication - no anonymous access to vote history

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// Use anon key for RLS-protected reads (defense in depth)
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// Service role only for specific operations that need it
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface VoteHistoryItem {
  id: string;
  created_at: string;
  vote_weight: number;
  clip: {
    id: string;
    thumbnail_url: string;
    username: string;
    genre: string;
    slot_position: number;
    current_vote_count: number;
  };
}

interface ProfileHistoryResponse {
  history: VoteHistoryItem[];
  total_votes: number;
  page: number;
  page_size: number;
  has_more: boolean;
  grouped_by_date: Record<string, VoteHistoryItem[]>;
}

/**
 * GET /api/profile/history
 * Returns user's voting history with pagination
 * SECURITY: Requires authentication - uses user_id from session, not spoofable headers
 *
 * Query params:
 * - page: number (default: 1)
 * - limit: number (default: 50, max: 100)
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'read');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // SECURITY FIX: Require authentication for vote history access
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Authentication required to view vote history' },
        { status: 401 }
      );
    }

    // Use service role to look up user_id from email (RLS may block this)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .single();

    if (userError || !userData) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const userId = userData.id;

    // Use anon key for data reads (RLS enforced as defense in depth)
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = (page - 1) * limit;

    // SECURITY FIX: Query by authenticated user_id, not spoofable voter_key
    // Get total vote count
    const { count: totalCount } = await supabaseAdmin
      .from('votes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    const total_votes = totalCount || 0;

    // Get paginated votes by user_id
    const { data: votes, error: votesError } = await supabaseAdmin
      .from('votes')
      .select('id, created_at, vote_weight, clip_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (votesError) {
      console.error('[GET /api/profile/history] votesError:', votesError);
      return NextResponse.json(
        { error: 'Failed to fetch vote history' },
        { status: 500 }
      );
    }

    if (!votes || votes.length === 0) {
      return NextResponse.json({
        history: [],
        total_votes: 0,
        page,
        page_size: limit,
        has_more: false,
        grouped_by_date: {},
      } satisfies ProfileHistoryResponse);
    }

    // Get clip details for all voted clips
    const clipIds = votes.map((v) => v.clip_id).filter(Boolean);
    
    const { data: clips } = await supabase
      .from('tournament_clips')
      .select('id, thumbnail_url, username, genre, slot_position, vote_count')
      .in('id', clipIds);

    // Create clip map for quick lookup
    const clipMap = new Map(
      clips?.map((c) => [
        c.id,
        {
          id: c.id,
          thumbnail_url: c.thumbnail_url,
          username: c.username || 'Creator',
          genre: c.genre || 'Unknown',
          slot_position: c.slot_position,
          current_vote_count: c.vote_count || 0,
        },
      ]) || []
    );

    // Build history items
    const history: VoteHistoryItem[] = votes
      .map((vote) => {
        const clip = clipMap.get(vote.clip_id);
        if (!clip) return null;

        return {
          id: vote.id,
          created_at: vote.created_at,
          vote_weight: vote.vote_weight || 1,
          clip,
        };
      })
      .filter((item): item is VoteHistoryItem => item !== null);

    // Group by date for easier display
    const grouped_by_date: Record<string, VoteHistoryItem[]> = {};
    
    history.forEach((item) => {
      const date = new Date(item.created_at);
      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      
      if (!grouped_by_date[dateKey]) {
        grouped_by_date[dateKey] = [];
      }
      grouped_by_date[dateKey].push(item);
    });

    // Check if there are more pages
    const has_more = total_votes > offset + limit;

    const response: ProfileHistoryResponse = {
      history,
      total_votes,
      page,
      page_size: limit,
      has_more,
      grouped_by_date,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    console.error('[GET /api/profile/history] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
