// GET /api/admin/pricing
// Returns full pricing dashboard data: model_pricing, credit_packages, margin analysis, alerts

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
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

    // Fetch model pricing, credit packages, and unresolved alerts in parallel
    const [modelsResult, packagesResult, alertsResult, revenueResult] = await Promise.all([
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
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .in('status', ['completed', 'pending', 'processing']),
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

    return NextResponse.json({
      success: true,
      models: enrichedModels,
      packages: packagesResult.data || [],
      alerts: alertsResult.data || [],
      worst_case_cents_per_credit: Math.round(worstCaseCentsPerCredit * 100) / 100,
    });
  } catch (error) {
    console.error('[ADMIN_PRICING] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch pricing data' },
      { status: 500 }
    );
  }
}
