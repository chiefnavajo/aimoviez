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
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

    const supabase = getSupabaseClient();

    // Build query with pagination
    let query = supabase
      .from('tournament_clips')
      .select('id, title, description, video_url, thumbnail_url, username, avatar_url, genre, vote_count, weighted_score, status, slot_position, season_id, created_at, user_id, is_ai_generated, ai_prompt, ai_model', { count: 'exact' })
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

    // Filter AI-only clips
    const aiOnly = searchParams.get('ai_only');
    if (aiOnly === 'true') {
      query = query.eq('is_ai_generated', true);
    }

    // Apply pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: clips, error, count } = await query;

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch clips' },
        { status: 500 }
      );
    }

    const totalCount = count ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    return NextResponse.json({
      success: true,
      clips: clips || [],
      count: clips?.length || 0,
      total: totalCount,
      page,
      limit,
      totalPages,
    });
  } catch (error) {
    console.error('GET /api/admin/clips error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
