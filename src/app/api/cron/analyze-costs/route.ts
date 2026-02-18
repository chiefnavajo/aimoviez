// =============================================================================
// CRON: Analyze Costs
// Runs every 6 hours. Analyzes actual generation costs from ai_generations,
// detects fal.ai cost drift, calculates real margins per model, and uses
// Claude Haiku to generate pricing recommendations. Can auto-adjust or
// create pricing_alerts for admin review.
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { invalidateCostCache } from '@/lib/ai-video';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export async function GET(request: NextRequest) {
  // Auth
  const authError = verifyCronAuth(request.headers.get('authorization'));
  if (authError) return authError;

  try {
    const supabase = getSupabase();

    // 1. Get pricing config from feature flag
    const { data: flagData } = await supabase
      .from('feature_flags')
      .select('config')
      .eq('key', 'ai_video_generation')
      .maybeSingle();

    const config = flagData?.config as {
      pricing_auto_adjust?: boolean;
      pricing_target_margin_min?: number;
      pricing_target_margin_max?: number;
      pricing_drift_threshold_percent?: number;
    } | null;

    const autoAdjust = config?.pricing_auto_adjust ?? false;
    const targetMarginMin = config?.pricing_target_margin_min ?? 30;
    const targetMarginMax = config?.pricing_target_margin_max ?? 40;
    const driftThreshold = config?.pricing_drift_threshold_percent ?? 10;

    // 2. Get current model pricing
    const { data: models, error: modelsError } = await supabase
      .from('model_pricing')
      .select('*')
      .eq('is_active', true);

    if (modelsError || !models || models.length === 0) {
      return NextResponse.json({ ok: true, message: 'No active models to analyze' });
    }

    // 3. Get actual costs from last 7 days
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: generations } = await supabase
      .from('ai_generations')
      .select('model, cost_cents')
      .gte('created_at', weekAgo)
      .in('status', ['completed', 'pending', 'processing']);

    // Aggregate by model
    const actualCosts: Record<string, { count: number; totalCents: number; avgCents: number }> = {};
    for (const gen of generations || []) {
      if (!actualCosts[gen.model]) {
        actualCosts[gen.model] = { count: 0, totalCents: 0, avgCents: 0 };
      }
      actualCosts[gen.model].count++;
      actualCosts[gen.model].totalCents += gen.cost_cents || 0;
    }
    for (const data of Object.values(actualCosts)) {
      data.avgCents = data.count > 0 ? Math.round(data.totalCents / data.count) : 0;
    }

    // 4. Get worst-case $/credit from active packages
    const { data: packages } = await supabase
      .from('credit_packages')
      .select('credits, price_cents, bonus_percent')
      .eq('is_active', true);

    let worstCaseCentsPerCredit = 0;
    if (packages && packages.length > 0) {
      const rates = packages.map(p => {
        const total = p.credits + Math.floor(p.credits * (p.bonus_percent || 0) / 100);
        return p.price_cents / total;
      });
      worstCaseCentsPerCredit = Math.min(...rates);
    }

    if (worstCaseCentsPerCredit <= 0) {
      return NextResponse.json({ ok: true, message: 'No active packages, cannot calculate margins' });
    }

    // 5. Analyze each model
    const alerts: Array<{
      model_key: string;
      alert_type: string;
      severity: string;
      current_margin: number;
      recommended_credit_cost?: number;
    }> = [];

    const modelAnalysis: Array<{
      model_key: string;
      fal_cost_cents: number;
      credit_cost: number;
      actual_avg_cost_7d: number | null;
      margin_percent: number;
      cost_drift: boolean;
    }> = [];

    for (const model of models) {
      const actual = actualCosts[model.model_key];
      const revenuePerGen = model.credit_cost * worstCaseCentsPerCredit;
      const costForMargin = actual?.avgCents ?? model.fal_cost_cents;
      const margin = revenuePerGen > 0
        ? Math.round((1 - costForMargin / revenuePerGen) * 10000) / 100
        : 0;

      // Detect cost drift
      const driftDetected = actual
        ? Math.abs(actual.avgCents - model.fal_cost_cents) / model.fal_cost_cents * 100 > driftThreshold
        : false;

      // Update last_cost_check_at and cost_drift_detected
      await supabase
        .from('model_pricing')
        .update({
          last_cost_check_at: new Date().toISOString(),
          cost_drift_detected: driftDetected,
        })
        .eq('model_key', model.model_key);

      modelAnalysis.push({
        model_key: model.model_key,
        fal_cost_cents: model.fal_cost_cents,
        credit_cost: model.credit_cost,
        actual_avg_cost_7d: actual?.avgCents ?? null,
        margin_percent: margin,
        cost_drift: driftDetected,
      });

      // Flag if margin is outside target range
      if (margin < targetMarginMin) {
        alerts.push({
          model_key: model.model_key,
          alert_type: 'margin_low',
          severity: margin < 20 ? 'critical' : 'warning',
          current_margin: margin,
        });
      } else if (margin > targetMarginMax + 10) {
        alerts.push({
          model_key: model.model_key,
          alert_type: 'margin_high',
          severity: 'info',
          current_margin: margin,
        });
      }

      if (driftDetected) {
        alerts.push({
          model_key: model.model_key,
          alert_type: 'cost_drift',
          severity: 'warning',
          current_margin: margin,
        });
      }
    }

    // 6. If there are issues, ask Claude Haiku for recommendations
    let aiAnalysis: string | null = null;
    let recommendations: Array<{ model_key: string; current_credit_cost: number; recommended_credit_cost: number; reason: string }> = [];

    if (alerts.length > 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        const anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          timeout: 30_000,
        });

        const analysisPrompt = `You are a pricing analyst for AIMoviez, a video generation platform. Analyze these cost metrics and recommend pricing adjustments.

Current model pricing:
${modelAnalysis.map(m => `- ${m.model_key}: fal_cost=${m.fal_cost_cents}¢, credit_cost=${m.credit_cost}, actual_avg_7d=${m.actual_avg_cost_7d ?? 'no data'}¢, margin=${m.margin_percent}%, drift=${m.cost_drift}`).join('\n')}

Credit package worst-case ¢/credit: ${worstCaseCentsPerCredit.toFixed(2)}¢

Target margin range: ${targetMarginMin}-${targetMarginMax}%

Rules:
- credit_cost must be an integer >= 1
- Margin must be >= ${targetMarginMin}% at worst-case ¢/credit
- Don't over-price (margin > 50% hurts conversion)
- If fal.ai cost increased, recommend proportional credit_cost increase
- If fal.ai cost decreased, recommend keeping credit_cost unless margin > 50%
- Only recommend changes for models that are outside the target margin range

Return ONLY valid JSON (no markdown): { "analysis": "brief summary", "recommendations": [{ "model_key": "...", "current_credit_cost": N, "recommended_credit_cost": N, "reason": "..." }] }`;

        const result = await anthropic.messages.create({
          model: HAIKU_MODEL,
          max_tokens: 1000,
          messages: [{ role: 'user', content: analysisPrompt }],
        });

        const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
        try {
          const parsed = JSON.parse(text);
          aiAnalysis = parsed.analysis || text;
          recommendations = parsed.recommendations || [];
        } catch {
          aiAnalysis = text;
        }
      } catch (err) {
        console.warn('[ANALYZE_COSTS] Claude analysis failed:', err);
        aiAnalysis = 'AI analysis unavailable';
      }
    }

    // 7. Take action: auto-adjust or create alerts
    if (autoAdjust && recommendations.length > 0) {
      // Auto-apply recommendations
      for (const rec of recommendations) {
        if (rec.recommended_credit_cost > 0 && rec.recommended_credit_cost !== rec.current_credit_cost) {
          await supabase
            .from('model_pricing')
            .update({
              credit_cost: rec.recommended_credit_cost,
              updated_at: new Date().toISOString(),
            })
            .eq('model_key', rec.model_key);
        }
      }

      // Recalculate all pricing after auto-adjustments
      await supabase.rpc('recalculate_all_pricing');
      invalidateCostCache();

      // Log auto-adjustment as resolved alert
      for (const rec of recommendations) {
        await supabase.from('pricing_alerts').insert({
          model_key: rec.model_key,
          alert_type: 'recommendation',
          severity: 'info',
          current_margin_percent: modelAnalysis.find(m => m.model_key === rec.model_key)?.margin_percent ?? null,
          recommended_credit_cost: rec.recommended_credit_cost,
          ai_analysis: `[AUTO-APPLIED] ${rec.reason}`,
          is_resolved: true,
          resolved_at: new Date().toISOString(),
        });
      }
    } else if (alerts.length > 0) {
      // Create alerts for admin review
      for (const alert of alerts) {
        const rec = recommendations.find(r => r.model_key === alert.model_key);
        await supabase.from('pricing_alerts').insert({
          model_key: alert.model_key,
          alert_type: alert.alert_type,
          severity: alert.severity,
          current_margin_percent: alert.current_margin,
          recommended_credit_cost: rec?.recommended_credit_cost ?? null,
          ai_analysis: rec ? `${rec.reason}\n\n${aiAnalysis || ''}` : aiAnalysis,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      models_analyzed: modelAnalysis.length,
      alerts_created: autoAdjust ? 0 : alerts.length,
      auto_adjustments: autoAdjust ? recommendations.length : 0,
      analysis: modelAnalysis,
    });
  } catch (error) {
    console.error('[ANALYZE_COSTS] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Cost analysis failed' },
      { status: 500 }
    );
  }
}
