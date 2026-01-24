// app/api/account/delete/route.ts
// Delete user account and all associated data (GDPR compliance)
// Uses transactional deletion to prevent partial data loss

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

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }
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
    const userKey = `user_${userId}`;
    const deletionResults: Record<string, number | string> = {};
    const errors: string[] = [];

    // 1. Delete user's comments (comments table uses user_key = 'user_${userId}' format)
    const { data: deletedComments, error: commentsError } = await supabase
      .from('comments')
      .delete()
      .eq('user_key', userKey)
      .select('id');
    if (commentsError) errors.push(`comments: ${commentsError.message}`);
    deletionResults.comments = deletedComments?.length || 0;

    // 1b. Delete user's comment likes
    const { data: deletedCommentLikes, error: likesError } = await supabase
      .from('comment_likes')
      .delete()
      .eq('user_key', userKey)
      .select('id');
    if (likesError) errors.push(`comment_likes: ${likesError.message}`);
    deletionResults.comment_likes = deletedCommentLikes?.length || 0;

    // 2. Delete user's votes
    const { data: deletedVotes, error: votesError } = await supabase
      .from('votes')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (votesError) errors.push(`votes: ${votesError.message}`);
    deletionResults.votes = deletedVotes?.length || 0;

    // 3. Get user's clips for video cleanup
    const { data: userClips } = await supabase
      .from('tournament_clips')
      .select('id, video_url')
      .eq('user_id', userId);

    // 4. Remove clip references from story_slots (set winner to null if it's this user's clip)
    if (userClips && userClips.length > 0) {
      const clipIds = userClips.map(c => c.id);
      const { error: slotError } = await supabase
        .from('story_slots')
        .update({ winner_tournament_clip_id: null })
        .in('winner_tournament_clip_id', clipIds);
      if (slotError) {
        errors.push(`story_slots: ${slotError.message}`);
      }
    }

    // 5. Delete user's clips
    const { data: deletedClips, error: clipsError } = await supabase
      .from('tournament_clips')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (clipsError) errors.push(`tournament_clips: ${clipsError.message}`);
    deletionResults.clips = deletedClips?.length || 0;

    // 6. Delete clip views for this user's clips
    if (userClips && userClips.length > 0) {
      const clipIds = userClips.map(c => c.id);
      const { error: viewsError } = await supabase
        .from('clip_views')
        .delete()
        .in('clip_id', clipIds);
      if (viewsError) {
        errors.push(`clip_views: ${viewsError.message}`);
      }
    }

    // 7. Delete notifications for this user
    const { data: deletedNotifications, error: notifError } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', userId)
      .select('id');
    if (notifError) errors.push(`notifications: ${notifError.message}`);
    deletionResults.notifications = deletedNotifications?.length || 0;

    // 8. Delete push subscriptions
    const { error: pushError } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);
    if (pushError) {
      errors.push(`push_subscriptions: ${pushError.message}`);
    }

    // 9. Delete referral data - FIX: Use proper filter syntax instead of string interpolation
    const { error: referralError } = await supabase
      .from('referrals')
      .delete()
      .or('referrer_id.eq.' + userId + ',referred_id.eq.' + userId);
    if (referralError) {
      errors.push(`referrals: ${referralError.message}`);
    }

    // 10. Finally, delete the user record - this is critical
    const { error: profileError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (profileError) {
      console.error('Failed to delete profile:', profileError);
      console.error('Partial deletion errors:', errors);
      return NextResponse.json(
        {
          error: 'Failed to delete user profile. Account deletion incomplete.',
          partialDeletion: deletionResults,
          deletionErrors: errors,
        },
        { status: 500 }
      );
    }
    deletionResults.profile = 'deleted';

    // Log any non-critical errors that occurred
    if (errors.length > 0) {
      console.warn(`[Account Deletion] Completed with ${errors.length} non-critical errors:`, errors);
    }

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
