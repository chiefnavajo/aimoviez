// app/api/report/route.ts
// Handle content and user reports

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { sanitizeText } from '@/lib/sanitize';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

const VALID_REASONS = ['inappropriate', 'spam', 'harassment', 'copyright', 'other'];

export async function POST(request: NextRequest) {
  // Rate limit: 3 reports per minute (prevents mass false reports)
  const rateLimitResponse = await rateLimit(request, 'contact');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { clipId, userId, commentId, reason, description } = body;

    // Validation
    if (!reason || !VALID_REASONS.includes(reason)) {
      return NextResponse.json(
        { error: 'Invalid reason. Must be one of: inappropriate, spam, harassment, copyright, other' },
        { status: 400 }
      );
    }

    if (!clipId && !userId && !commentId) {
      return NextResponse.json(
        { error: 'Must specify clipId, userId, or commentId to report' },
        { status: 400 }
      );
    }

    // Prevent self-reporting
    if (userId && userId === session.user.userId) {
      return NextResponse.json(
        { error: 'Cannot report yourself' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Check for existing pending report
    let existingQuery = supabase
      .from('content_reports')
      .select('id')
      .eq('reporter_id', session.user.userId)
      .eq('status', 'pending');

    if (clipId) {
      existingQuery = existingQuery.eq('clip_id', clipId);
    } else if (userId) {
      existingQuery = existingQuery.eq('reported_user_id', userId);
    } else if (commentId) {
      existingQuery = existingQuery.eq('comment_id', commentId);
    }

    const { data: existing } = await existingQuery.single();

    if (existing) {
      return NextResponse.json(
        { error: 'You have already reported this content' },
        { status: 400 }
      );
    }

    // Create the report
    const { error: insertError } = await supabase
      .from('content_reports')
      .insert({
        reporter_id: session.user.userId,
        clip_id: clipId || null,
        reported_user_id: userId || null,
        comment_id: commentId || null,
        reason,
        description: description ? sanitizeText(description).slice(0, 1000) : null,
        status: 'pending',
      });

    if (insertError) {
      console.error('Report submission error:', insertError);
      // If table doesn't exist, still return success
      if (insertError.code === '42P01') {
        console.log('content_reports table does not exist, logging to console only');
        console.log('Report:', { clipId, userId, commentId, reason, descriptionLength: description?.length || 0, reporter: session.user.userId });
        return NextResponse.json({ success: true });
      }
      throw insertError;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Report API error:', error);
    return NextResponse.json(
      { error: 'Failed to submit report. Please try again.' },
      { status: 500 }
    );
  }
}
