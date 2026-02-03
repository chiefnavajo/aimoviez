// app/api/admin/users/route.ts
// User management for admin

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
  // Rate limit check - use read limit for listing users
  const rateLimitResponse = await rateLimit(request, 'admin_read');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { searchParams } = new URL(request.url);
    // Limit search parameter length to prevent expensive LIKE operations
    const rawSearch = searchParams.get('search') || '';
    const search = rawSearch.slice(0, 100); // Max 100 characters
    const status = searchParams.get('status') || 'all';
    const sort = searchParams.get('sort') || 'newest';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20') || 20), 100);
    const offset = (page - 1) * limit;

    const supabase = getSupabaseClient();

    // Build query - use 'users' table (not 'profiles')
    // Select specific columns instead of * for performance and security
    let query = supabase
      .from('users')
      .select('id, username, email, avatar_url, level, xp, total_votes_cast, total_votes_received, clips_uploaded, is_verified, is_banned, is_admin, ai_daily_limit, created_at, updated_at', { count: 'exact' });

    // Search filter (escape SQL special characters to prevent injection)
    if (search) {
      const escapedSearch = search.replace(/[%_\\]/g, '\\$&');
      query = query.or(`username.ilike.%${escapedSearch}%,email.ilike.%${escapedSearch}%`);
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
      // PERFORMANCE FIX: Use denormalized columns from users table instead of counting rows
      // The users table already has total_votes_cast and clips_uploaded columns
      // which are updated by triggers - no need to query votes/clips tables
      users?.forEach(user => {
        clipCounts[user.id] = user.clips_uploaded || 0;
        voteCounts[user.id] = user.total_votes_cast || 0;
      });
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
