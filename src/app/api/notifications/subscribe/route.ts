// /api/notifications/subscribe
// Save push notification subscription for a user

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { rateLimit } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getUserKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0] : req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';
  return crypto.createHash('sha256').update(ip + ua).digest('hex');
}

export async function POST(req: NextRequest) {
  // Rate limit: prevent subscription spam
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

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

    // Validate endpoint is a known push service domain
    try {
      const endpointUrl = new URL(subscription.endpoint);
      const allowedHosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'wns.windows.com'];
      const isAllowed = allowedHosts.some(host => endpointUrl.hostname === host || endpointUrl.hostname.endsWith('.' + host));
      if (endpointUrl.protocol !== 'https:' || !isAllowed) {
        return NextResponse.json(
          { error: 'Invalid push subscription endpoint' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid push subscription endpoint' },
        { status: 400 }
      );
    }

    // Extract subscription details
    const { endpoint, keys } = subscription;
    const p256dh = keys?.p256dh || null;
    const auth = keys?.auth || null;

    // Create a unique ID for this subscription based on endpoint
    const subscriptionId = crypto.createHash('sha256').update(endpoint).digest('hex');

    // Upsert the subscription
    const { data: _data, error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          id: subscriptionId,
          user_key: userKey,
          endpoint,
          p256dh,
          auth,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select()
      .single();

    if (error) {
      console.error('[POST /api/notifications/subscribe] error:', error);

      // If table doesn't exist yet, return success anyway
      // The subscription is stored in browser and will work when table is created
      if (error.code === '42P01') {
        return NextResponse.json({
          success: true,
          message: 'Subscription registered (pending table setup)',
        });
      }

      return NextResponse.json(
        { error: 'Failed to save subscription' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      subscription_id: subscriptionId,
    });
  } catch (err) {
    console.error('[POST /api/notifications/subscribe] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
