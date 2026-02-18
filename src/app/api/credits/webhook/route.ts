// POST /api/credits/webhook
// Stripe webhook handler for checkout.session.completed events.
// Verifies Stripe signature, then calls add_credits RPC to add credits to user.
// NOTE: This route must NOT use CSRF protection (Stripe sends webhooks directly).

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

// =============================================================================
// STRIPE CLIENT
// =============================================================================

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Missing STRIPE_SECRET_KEY');
  return new Stripe(key);
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[STRIPE_WEBHOOK] Missing STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  // 1. Get raw body and signature for verification
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  // 2. Verify webhook signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('[STRIPE_WEBHOOK] Signature verification failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 3. Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Extract metadata set during checkout creation
    const userId = session.metadata?.user_id;
    const packageId = session.metadata?.package_id;
    const credits = parseInt(session.metadata?.credits || '0', 10);
    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

    if (!userId || !credits || credits <= 0) {
      console.error('[STRIPE_WEBHOOK] Missing or invalid metadata:', session.metadata);
      // Return 200 to prevent Stripe retries for malformed sessions
      return NextResponse.json({ received: true, error: 'Invalid metadata' });
    }

    if (!paymentIntentId) {
      console.error('[STRIPE_WEBHOOK] Missing payment_intent:', session.id);
      return NextResponse.json({ received: true, error: 'Missing payment intent' });
    }

    // 4. Add credits via RPC (has idempotency guard on stripe_payment_intent_id)
    const supabase = getSupabase();
    const { data: result, error: rpcError } = await supabase.rpc('add_credits', {
      p_user_id: userId,
      p_amount: credits,
      p_stripe_payment_intent_id: paymentIntentId,
      p_package_id: packageId || null,
    });

    if (rpcError) {
      console.error('[STRIPE_WEBHOOK] add_credits RPC error:', rpcError.message, 'session:', session.id);
      // Return 500 so Stripe retries
      return NextResponse.json({ error: 'Failed to add credits' }, { status: 500 });
    }

    if (result?.success) {
      console.info(
        `[STRIPE_WEBHOOK] Added ${credits} credits to user ${userId}. New balance: ${result.new_balance}. Session: ${session.id}`
      );
    } else if (result?.error === 'Payment already processed') {
      console.info(`[STRIPE_WEBHOOK] Duplicate webhook for session ${session.id} — already processed`);
    } else {
      console.error(`[STRIPE_WEBHOOK] add_credits returned error:`, result?.error, 'session:', session.id);
    }
  }

  // Return 200 for all events (even unhandled ones) to prevent Stripe retries
  return NextResponse.json({ received: true });
}
