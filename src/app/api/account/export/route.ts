// app/api/account/export/route.ts
// Export all user data (GDPR compliance)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createClient } from '@supabase/supabase-js';
import { authOptions } from '@/lib/auth-options';
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
  // Rate limit: prevent abuse of data export endpoint
  const rateLimitResponse = await rateLimit(request, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = getSupabaseClient();
    const userEmail = session.user.email;

    // Get user profile
    const { data: profile } = await supabase
      .from('users')
      .select('id, username, avatar_url, created_at, updated_at')
      .eq('email', userEmail)
      .single();

    // SECURITY: Only query user data if profile exists with valid ID
    // Prevents querying with empty string which could return unintended data
    let clips = null;
    let votes = null;
    let comments = null;

    if (profile?.id) {
      // Get user's clips
      const { data: clipsData } = await supabase
        .from('tournament_clips')
        .select('id, title, description, genre, status, vote_count, created_at, slot_position')
        .eq('user_id', profile.id);
      clips = clipsData;

      // Get user's votes
      const { data: votesData } = await supabase
        .from('votes')
        .select('id, clip_id, vote_type, created_at')
        .eq('user_id', profile.id)
        .limit(1000);
      votes = votesData;

      // FIX: Get user's comments - comments table uses user_key format (user_UUID)
      const userKey = `user_${profile.id}`;
      const { data: commentsData } = await supabase
        .from('comments')
        .select('id, comment_text, created_at, clip_id')
        .eq('user_key', userKey)
        .limit(1000);
      comments = commentsData;
    }

    // Compile export data
    const exportData = {
      exportDate: new Date().toISOString(),
      account: {
        email: userEmail,
        name: session.user.name,
        image: session.user.image,
        profile: profile ? {
          id: profile.id,
          username: profile.username,
          avatar_url: profile.avatar_url,
          created_at: profile.created_at,
          updated_at: profile.updated_at,
        } : null,
      },
      clips: clips || [],
      votes: votes || [],
      comments: comments || [],
      statistics: {
        totalClips: clips?.length || 0,
        totalVotes: votes?.length || 0,
        totalComments: comments?.length || 0,
      },
    };

    // Return as JSON file download
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="aimoviez-data-export-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    );
  }
}
