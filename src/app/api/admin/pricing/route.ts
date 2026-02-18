// GET /api/admin/pricing
// Returns full pricing dashboard data: model_pricing, credit_packages, margin analysis, alerts

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import { requireCsrf } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function GET(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const supabase = getSupabase();

    // Time boundaries for revenue queries
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Fetch model pricing, credit packages, alerts, generation costs, purchases, and overhead in parallel
    const [modelsResult, packagesResult, alertsResult, revenueResult, purchasesResult, aiCostsResult, overheadResult] = await Promise.all([
      supabase
        .from('model_pricing')
        .select('*')
        .order('model_key'),
      supabase
        .from('credit_packages')
        .select('*')
        .order('sort_order'),
      supabase
        .from('pricing_alerts')
        .select('*')
        .eq('is_resolved', false)
        .order('created_at', { ascending: false })
        .limit(20),
      // Get actual cost data from last 7 days for margin analysis
      supabase
        .from('ai_generations')
        .select('model, cost_cents, credit_amount, credit_deducted')
        .gte('created_at', weekStart)
        .in('status', ['completed', 'pending', 'processing']),
      // Purchases this month for revenue calculation
      supabase
        .from('credit_transactions')
        .select('created_at, reference_id')
        .eq('type', 'purchase')
        .gte('created_at', monthStart),
      // AI costs this month for profit calculation
      supabase
        .from('ai_generations')
        .select('cost_cents, narration_cost_cents, created_at')
        .gte('created_at', monthStart)
        .in('status', ['completed', 'pending', 'processing']),
      // Monthly overhead (Vercel, Supabase, Sentry, etc.)
      supabase
        .from('system_cache')
        .select('value')
        .eq('key', 'monthly_overhead_cents')
        .maybeSingle(),
    ]);

    if (modelsResult.error) throw modelsResult.error;
    if (packagesResult.error) throw packagesResult.error;

    // Calculate worst-case $/credit from active packages
    const activePackages = (packagesResult.data || []).filter(p => p.is_active);
    let worstCaseCentsPerCredit = 0;
    if (activePackages.length > 0) {
      const rates = activePackages.map(p => {
        const totalCredits = p.credits + Math.floor(p.credits * (p.bonus_percent || 0) / 100);
        return p.price_cents / totalCredits;
      });
      worstCaseCentsPerCredit = Math.min(...rates);
    }

    // Calculate actual margins per model from last 7 days
    const actualMargins: Record<string, { count: number; avgCostCents: number; totalCostCents: number }> = {};
    for (const gen of revenueResult.data || []) {
      if (!actualMargins[gen.model]) {
        actualMargins[gen.model] = { count: 0, avgCostCents: 0, totalCostCents: 0 };
      }
      actualMargins[gen.model].count++;
      actualMargins[gen.model].totalCostCents += gen.cost_cents || 0;
    }
    for (const [model, data] of Object.entries(actualMargins)) {
      data.avgCostCents = data.count > 0 ? Math.round(data.totalCostCents / data.count) : 0;
    }

    // Enrich model pricing with computed margins
    const enrichedModels = (modelsResult.data || []).map(model => {
      const revenuePerGen = model.credit_cost * worstCaseCentsPerCredit;
      const theoreticalMargin = revenuePerGen > 0
        ? Math.round((1 - model.fal_cost_cents / revenuePerGen) * 10000) / 100
        : 0;

      const actual = actualMargins[model.model_key];
      const actualMargin = actual && actual.avgCostCents > 0 && revenuePerGen > 0
        ? Math.round((1 - actual.avgCostCents / revenuePerGen) * 10000) / 100
        : null;

      return {
        ...model,
        theoretical_margin_percent: theoreticalMargin,
        actual_margin_percent_7d: actualMargin,
        generation_count_7d: actual?.count ?? 0,
        avg_cost_cents_7d: actual?.avgCostCents ?? null,
      };
    });

    // ================================================================
    // Revenue & Profit aggregation (today / week / month)
    // ================================================================

    // Build package price lookup: packageId -> price_cents
    const packagePriceMap: Record<string, number> = {};
    for (const pkg of packagesResult.data || []) {
      packagePriceMap[pkg.id] = pkg.price_cents;
    }

    // Monthly overhead (infrastructure: Vercel, Supabase, Sentry, R2, Claude API, etc.)
    const monthlyOverheadCents = overheadResult.data?.value?.cents ?? 0;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyOverheadCents = Math.round(monthlyOverheadCents / daysInMonth);
    const weeklyOverheadCents = Math.round(monthlyOverheadCents * 7 / daysInMonth);

    // Helper to aggregate into time buckets
    interface RevenueBucket {
      purchases: number;
      gross_cents: number;
      stripe_fees_cents: number;
      ai_costs_cents: number;
      overhead_cents: number;
      profit_cents: number;
      margin_percent: number;
    }

    const emptyBucket = (): RevenueBucket => ({
      purchases: 0, gross_cents: 0, stripe_fees_cents: 0,
      ai_costs_cents: 0, overhead_cents: 0, profit_cents: 0, margin_percent: 0,
    });

    const todayBucket = emptyBucket();
    const weekBucket = emptyBucket();
    const monthBucket = emptyBucket();

    // Aggregate purchases
    for (const purchase of purchasesResult.data || []) {
      const priceCents = packagePriceMap[purchase.reference_id] || 0;
      if (priceCents === 0) continue;

      const stripeFee = Math.round(priceCents * 0.029) + 30;
      const ts = purchase.created_at;

      // Month (all purchases are already >= monthStart)
      monthBucket.purchases++;
      monthBucket.gross_cents += priceCents;
      monthBucket.stripe_fees_cents += stripeFee;

      // Week
      if (ts >= weekStart) {
        weekBucket.purchases++;
        weekBucket.gross_cents += priceCents;
        weekBucket.stripe_fees_cents += stripeFee;
      }

      // Today
      if (ts >= todayStart) {
        todayBucket.purchases++;
        todayBucket.gross_cents += priceCents;
        todayBucket.stripe_fees_cents += stripeFee;
      }
    }

    // Aggregate AI costs
    for (const gen of aiCostsResult.data || []) {
      const costCents = (gen.cost_cents || 0) + (gen.narration_cost_cents || 0);
      const ts = gen.created_at;

      monthBucket.ai_costs_cents += costCents;
      if (ts >= weekStart) weekBucket.ai_costs_cents += costCents;
      if (ts >= todayStart) todayBucket.ai_costs_cents += costCents;
    }

    // Apply prorated overhead to each bucket
    todayBucket.overhead_cents = dailyOverheadCents;
    weekBucket.overhead_cents = weeklyOverheadCents;
    monthBucket.overhead_cents = monthlyOverheadCents;

    // Calculate profit and margin for each bucket
    for (const bucket of [todayBucket, weekBucket, monthBucket]) {
      bucket.profit_cents = bucket.gross_cents - bucket.stripe_fees_cents - bucket.ai_costs_cents - bucket.overhead_cents;
      bucket.margin_percent = bucket.gross_cents > 0
        ? Math.round((bucket.profit_cents / bucket.gross_cents) * 1000) / 10
        : 0;
    }

    return NextResponse.json({
      success: true,
      models: enrichedModels,
      packages: packagesResult.data || [],
      alerts: alertsResult.data || [],
      worst_case_cents_per_credit: Math.round(worstCaseCentsPerCredit * 100) / 100,
      revenue: {
        today: todayBucket,
        week: weekBucket,
        month: monthBucket,
      },
      monthly_overhead_cents: monthlyOverheadCents,
    });
  } catch (error) {
    console.error('[ADMIN_PRICING] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pricing data' },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/pricing
// Update monthly overhead setting
export async function PATCH(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const csrfError = await requireCsrf(request);
  if (csrfError) return csrfError;

  try {
    const body = await request.json();
    const { monthly_overhead_cents } = body;

    if (typeof monthly_overhead_cents !== 'number' || monthly_overhead_cents < 0 || monthly_overhead_cents > 10000000) {
      return NextResponse.json(
        { success: false, error: 'monthly_overhead_cents must be 0-10000000' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    const { error } = await supabase
      .from('system_cache')
      .upsert(
        {
          key: 'monthly_overhead_cents',
          value: { cents: Math.round(monthly_overhead_cents) },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );

    if (error) throw error;

    return NextResponse.json({ success: true, monthly_overhead_cents: Math.round(monthly_overhead_cents) });
  } catch (error) {
    console.error('[ADMIN_PRICING] Overhead update error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update overhead' },
      { status: 500 }
    );
  }
}
