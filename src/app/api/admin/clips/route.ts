// app/api/admin/clips/route.ts
// ============================================================================
// ADMIN API - Get Clips by Status
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
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';

    const supabase = getSupabaseClient();

    // Build query - sort by weighted_score (votes) descending, then by created_at
    let query = supabase
      .from('tournament_clips')
      .select('*')
      .order('weighted_score', { ascending: false, nullsFirst: false })
      .order('vote_count', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    // Filter by status if not 'all'
    if (status !== 'all') {
      query = query.eq('status', status);
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
