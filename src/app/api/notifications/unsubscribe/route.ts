// /api/notifications/unsubscribe
// Remove push notification subscription for a user

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getUserKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userKey = getUserKey(req);
    const body = await req.json();

    const { subscription } = body;

    if (!subscription || !subscription.endpoint) {
      return NextResponse.json(
        { error: 'Invalid subscription data' },
        { status: 400 }
      );
    }

    // Create subscription ID from endpoint
    const subscriptionId = crypto.createHash('sha256').update(subscription.endpoint).digest('hex');

    // Delete the subscription
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('id', subscriptionId)
      .eq('user_key', userKey);

    if (error) {
      console.error('[POST /api/notifications/unsubscribe] error:', error);

      // If table doesn't exist, return success anyway
      if (error.code === '42P01') {
        return NextResponse.json({
          success: true,
          message: 'Subscription removed',
        });
      }

      return NextResponse.json(
        { error: 'Failed to remove subscription' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Subscription removed successfully',
    });
  } catch (err) {
    console.error('[POST /api/notifications/unsubscribe] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
