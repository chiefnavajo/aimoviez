// app/api/admin/clips/route.ts
// ============================================================================
// ADMIN API - Get Clips by Status
// Requires admin authentication
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  // Check admin authentication
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';
    const seasonId = searchParams.get('season_id');

    const supabase = getSupabaseClient();

    // PERFORMANCE FIX: Select only needed columns instead of SELECT *
    // Build query - sort by weighted_score (votes) descending, then by created_at
    let query = supabase
      .from('tournament_clips')
      .select('id, video_url, thumbnail_url, username, avatar_url, genre, vote_count, weighted_score, status, slot_position, season_id, created_at, user_id')
      .order('weighted_score', { ascending: false, nullsFirst: false })
      .order('vote_count', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    // Filter by status if not 'all'
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    // Filter by season if provided
    if (seasonId) {
      query = query.eq('season_id', seasonId);
    }

    const { data: clips, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch clips' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      clips: clips || [],
      count: clips?.length || 0,
    });
  } catch (error) {
    console.error('GET /api/admin/clips error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
