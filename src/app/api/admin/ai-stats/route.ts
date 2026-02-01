// GET /api/admin/ai-stats
// Admin-only endpoint for AI generation statistics.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

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
    const now = new Date();

    // Date boundaries
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Count today
    const { count: todayCount } = await supabase
      .from('ai_generations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart);

    // Cost today
    const { data: todayCostData } = await supabase
      .from('ai_generations')
      .select('cost_cents')
      .gte('created_at', todayStart)
      .in('status', ['completed', 'pending', 'processing']);

    const todayCostCents = (todayCostData || []).reduce((s, r) => s + (r.cost_cents || 0), 0);

    // Count this week
    const { count: weekCount } = await supabase
      .from('ai_generations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', weekStart);

    // Cost this week
    const { data: weekCostData } = await supabase
      .from('ai_generations')
      .select('cost_cents')
      .gte('created_at', weekStart)
      .in('status', ['completed', 'pending', 'processing']);

    const weekCostCents = (weekCostData || []).reduce((s, r) => s + (r.cost_cents || 0), 0);

    // Count this month
    const { count: monthCount } = await supabase
      .from('ai_generations')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart);

    // Cost this month
    const { data: monthCostData } = await supabase
      .from('ai_generations')
      .select('cost_cents')
      .gte('created_at', monthStart)
      .in('status', ['completed', 'pending', 'processing']);

    const monthCostCents = (monthCostData || []).reduce((s, r) => s + (r.cost_cents || 0), 0);

    // Success ratio (all time)
    const { count: totalCompleted } = await supabase
      .from('ai_generations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'completed');

    const { count: totalFailed } = await supabase
      .from('ai_generations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed');

    const total = (totalCompleted || 0) + (totalFailed || 0);
    const successRatio = total > 0 ? (totalCompleted || 0) / total : 0;

    // Cost by model (this month)
    const { data: modelCosts } = await supabase
      .from('ai_generations')
      .select('model, cost_cents')
      .gte('created_at', monthStart)
      .in('status', ['completed', 'pending', 'processing']);

    const costByModel: Record<string, { count: number; costCents: number }> = {};
    for (const row of modelCosts || []) {
      if (!costByModel[row.model]) {
        costByModel[row.model] = { count: 0, costCents: 0 };
      }
      costByModel[row.model].count++;
      costByModel[row.model].costCents += row.cost_cents || 0;
    }

    // Top users this month (by generation count)
    const { data: topUsersData } = await supabase
      .from('ai_generations')
      .select('user_id')
      .gte('created_at', monthStart);

    const userCounts: Record<string, number> = {};
    for (const row of topUsersData || []) {
      userCounts[row.user_id] = (userCounts[row.user_id] || 0) + 1;
    }

    const topUsers = Object.entries(userCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([userId, count]) => ({ userId, count }));

    return NextResponse.json({
      success: true,
      stats: {
        today: { count: todayCount || 0, costCents: todayCostCents },
        week: { count: weekCount || 0, costCents: weekCostCents },
        month: { count: monthCount || 0, costCents: monthCostCents },
        successRatio: Math.round(successRatio * 100),
        costByModel,
        topUsers,
      },
    });
  } catch (error) {
    console.error('[AI_STATS] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch AI stats' },
      { status: 500 }
    );
  }
}
