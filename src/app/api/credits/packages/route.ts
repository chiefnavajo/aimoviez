// GET /api/credits/packages
// Returns available credit packages for purchase

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(request, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const supabase = getSupabase();

  // Get active credit packages
  const { data: packages, error: packagesError } = await supabase
    .from('credit_packages')
    .select('id, name, credits, price_cents, bonus_percent, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (packagesError) {
    console.error('[CREDITS_PACKAGES] Database error:', packagesError);
    return NextResponse.json(
      { error: 'Failed to fetch packages' },
      { status: 500 }
    );
  }

  // Get model pricing (for showing credit costs per model)
  const { data: pricing, error: pricingError } = await supabase
    .from('model_pricing')
    .select('model_key, display_name, credit_cost')
    .eq('is_active', true);

  if (pricingError) {
    console.error('[CREDITS_PACKAGES] Pricing error:', pricingError);
    // Non-fatal, continue without pricing
  }

  // Calculate effective credits (base + bonus) and value per credit
  const enrichedPackages = (packages || []).map(pkg => {
    const bonusCredits = Math.floor(pkg.credits * pkg.bonus_percent / 100);
    const totalCredits = pkg.credits + bonusCredits;
    const pricePerCredit = pkg.price_cents / totalCredits;

    return {
      id: pkg.id,
      name: pkg.name,
      credits: pkg.credits,
      bonus_credits: bonusCredits,
      total_credits: totalCredits,
      bonus_percent: pkg.bonus_percent,
      price_cents: pkg.price_cents,
      price_per_credit_cents: Math.round(pricePerCredit * 100) / 100,
    };
  });

  return NextResponse.json({
    packages: enrichedPackages,
    model_pricing: pricing || [],
  });
}
