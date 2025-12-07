// app/api/account/delete/route.ts
// Delete user account and all associated data (GDPR compliance)

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

export async function POST(request: NextRequest) {
  // Rate limit: prevent abuse of account deletion endpoint
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

    const body = await request.json().catch(() => ({}));
    const { confirmation } = body;

    // Require confirmation
    if (confirmation !== 'DELETE MY ACCOUNT') {
      return NextResponse.json(
        { error: 'Please type "DELETE MY ACCOUNT" to confirm' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    const userEmail = session.user.email;

    // Get user from users table (not profiles)
    const { data: profile } = await supabase
      .from('users')
      .select('id')
      .eq('email', userEmail)
      .single();

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    const userId = profile.id;
    const deletionResults: Record<string, number | string> = {};

    // 1. Delete user's comments
    const { data: deletedComments } = await supabase
      .from('comments')
      .delete()
      .eq('user_id', userId)
      .select('id');
    deletionResults.comments = deletedComments?.length || 0;

    // 2. Delete user's votes
    const { data: deletedVotes } = await supabase
      .from('votes')
      .delete()
      .eq('user_id', userId)
      .select('id');
    deletionResults.votes = deletedVotes?.length || 0;

    // 3. Get user's clips for video cleanup
    const { data: userClips } = await supabase
      .from('tournament_clips')
      .select('id, video_url')
      .eq('user_id', userId);

    // 4. Remove clip references from story_slots (set winner to null if it's this user's clip)
    if (userClips && userClips.length > 0) {
      const clipIds = userClips.map(c => c.id);
      await supabase
        .from('story_slots')
        .update({ winner_tournament_clip_id: null })
        .in('winner_tournament_clip_id', clipIds);
    }

    // 5. Delete user's clips
    const { data: deletedClips } = await supabase
      .from('tournament_clips')
      .delete()
      .eq('user_id', userId)
      .select('id');
    deletionResults.clips = deletedClips?.length || 0;

    // 6. Delete clip views for this user's clips
    if (userClips && userClips.length > 0) {
      const clipIds = userClips.map(c => c.id);
      await supabase
        .from('clip_views')
        .delete()
        .in('clip_id', clipIds);
    }

    // 7. Delete notifications for this user
    const { data: deletedNotifications } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId)
      .select('id');
    deletionResults.notifications = deletedNotifications?.length || 0;

    // 8. Delete push subscriptions
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);

    // 9. Delete referral data
    await supabase
      .from('referrals')
      .delete()
      .or(`referrer_id.eq.${userId},referred_id.eq.${userId}`);

    // 10. Finally, delete the user record
    const { error: profileError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (profileError) {
      console.error('Failed to delete profile:', profileError);
      return NextResponse.json(
        { error: 'Failed to delete profile. Some data may have been partially deleted.' },
        { status: 500 }
      );
    }
    deletionResults.profile = 'deleted';

    // Log deletion for audit purposes (anonymized)
    console.log(`[Account Deletion] User account deleted. Removed: ${JSON.stringify(deletionResults)}`);

    return NextResponse.json({
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
      deletedItems: deletionResults,
    });
  } catch (error) {
    console.error('Account deletion error:', error);
    return NextResponse.json(
      { error: 'Failed to delete account. Please try again or contact support.' },
      { status: 500 }
    );
  }
}
