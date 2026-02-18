// POST /api/credits/purchase
// Creates a Stripe Checkout Session for credit package purchase.
// Redirects user to Stripe-hosted checkout page.

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
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
  const rateLimitResponse = await rateLimit(request, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // 1. Authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // 2. CSRF protection
    const csrfError = await requireCsrf(request);
    if (csrfError) return csrfError;

    // 3. Check credit system feature flag
    const supabase = getSupabase();
    const { data: creditFlag } = await supabase
      .from('feature_flags')
      .select('enabled, config')
      .eq('key', 'credit_system')
      .maybeSingle();

    if (!creditFlag?.enabled) {
      return NextResponse.json(
        { success: false, error: 'Credit system is not currently available' },
        { status: 403 }
      );
    }

    const config = creditFlag.config as { stripe_enabled?: boolean } | null;
    if (!config?.stripe_enabled) {
      return NextResponse.json(
        { success: false, error: 'Purchases are not currently available' },
        { status: 403 }
      );
    }

    // 4. Parse body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { packageId } = body;
    if (!packageId || typeof packageId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'packageId is required' },
        { status: 400 }
      );
    }

    // 5. Look up user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, lifetime_purchased_credits')
      .eq('email', session.user.email)
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // 6. Look up credit package
    const { data: pkg, error: pkgError } = await supabase
      .from('credit_packages')
      .select('id, name, credits, price_cents, bonus_percent, stripe_price_id')
      .eq('id', packageId)
      .eq('is_active', true)
      .maybeSingle();

    if (pkgError || !pkg) {
      return NextResponse.json(
        { success: false, error: 'Package not found or unavailable' },
        { status: 404 }
      );
    }

    if (!pkg.stripe_price_id) {
      return NextResponse.json(
        { success: false, error: 'Package not configured for purchase' },
        { status: 500 }
      );
    }

    // 7. Calculate total credits (base + bonus + first-purchase bonus)
    const bonusCredits = Math.floor(pkg.credits * pkg.bonus_percent / 100);
    const isFirstPurchase = (user.lifetime_purchased_credits ?? 0) === 0;
    const firstPurchaseBonus = isFirstPurchase ? Math.floor((pkg.credits + bonusCredits) * 0.5) : 0;
    const totalCredits = pkg.credits + bonusCredits + firstPurchaseBonus;

    // 8. Create Stripe Checkout Session
    const stripe = getStripe();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: pkg.stripe_price_id,
          quantity: 1,
        },
      ],
      metadata: {
        user_id: user.id,
        package_id: pkg.id,
        credits: String(totalCredits),
        base_credits: String(pkg.credits),
        bonus_credits: String(bonusCredits),
        first_purchase_bonus: String(firstPurchaseBonus),
      },
      success_url: `${appUrl}/dashboard?purchase=success&credits=${totalCredits}`,
      cancel_url: `${appUrl}/dashboard?purchase=cancelled`,
      customer_email: session.user.email,
    });

    console.info(`[CREDITS_PURCHASE] Checkout session created: ${checkoutSession.id} for user ${user.id}, package ${pkg.name}, ${totalCredits} credits${isFirstPurchase ? ' (first purchase bonus!)' : ''}`);

    return NextResponse.json({
      success: true,
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
    });
  } catch (error) {
    console.error('[CREDITS_PURCHASE] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { success: false, error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}
