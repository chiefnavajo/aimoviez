// app/api/admin/users/route.ts
// User management for admin

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

/**
 * GET /api/admin/users
 * List users with search and pagination
 *
 * Query params:
 *   search: string - Search by username or email
 *   status: 'all' | 'active' | 'banned' - Filter by status
 *   sort: 'newest' | 'oldest' | 'most_clips' | 'most_votes'
 *   page: number
 *   limit: number
 */
export async function GET(request: NextRequest) {
  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all';
    const sort = searchParams.get('sort') || 'newest';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = (page - 1) * limit;

    const supabase = getSupabaseClient();

    // Build query
    let query = supabase
      .from('profiles')
      .select('*', { count: 'exact' });

    // Search filter
    if (search) {
      query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Status filter
    if (status === 'banned') {
      query = query.eq('is_banned', true);
    } else if (status === 'active') {
      query = query.or('is_banned.is.null,is_banned.eq.false');
    }

    // Sorting
    switch (sort) {
      case 'oldest':
        query = query.order('created_at', { ascending: true });
        break;
      case 'newest':
      default:
        query = query.order('created_at', { ascending: false });
        break;
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: users, error, count } = await query;

    if (error) {
      console.error('Users query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch users' },
        { status: 500 }
      );
    }

    // Get clip counts and vote counts for each user
    const userIds = users?.map(u => u.id) || [];

    const clipCounts: Record<string, number> = {};
    const voteCounts: Record<string, number> = {};

    if (userIds.length > 0) {
      // PERFORMANCE FIX: Run both queries in parallel instead of sequentially
      const [clipsResult, votesResult] = await Promise.all([
        // Get clip counts
        supabase
          .from('tournament_clips')
          .select('user_id')
          .in('user_id', userIds),
        // Get vote counts
        supabase
          .from('votes')
          .select('user_id')
          .in('user_id', userIds)
      ]);

      const { data: clips } = clipsResult;
      const { data: votes } = votesResult;

      if (clips) {
        clips.forEach(c => {
          clipCounts[c.user_id] = (clipCounts[c.user_id] || 0) + 1;
        });
      }

      if (votes) {
        votes.forEach(v => {
          if (v.user_id) {
            voteCounts[v.user_id] = (voteCounts[v.user_id] || 0) + 1;
          }
        });
      }
    }

    // Enrich users with counts
    const enrichedUsers = users?.map(user => ({
      ...user,
      clip_count: clipCounts[user.id] || 0,
      vote_count: voteCounts[user.id] || 0,
    }));

    // Sort by clips/votes if requested
    if (sort === 'most_clips') {
      enrichedUsers?.sort((a, b) => b.clip_count - a.clip_count);
    } else if (sort === 'most_votes') {
      enrichedUsers?.sort((a, b) => b.vote_count - a.vote_count);
    }

    return NextResponse.json({
      success: true,
      users: enrichedUsers || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (error) {
    console.error('Users API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
