// PATCH /api/admin/pricing/models
// Update model pricing (fal_cost_cents, credit_cost, target_margin_percent, is_active)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import { requireCsrf } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { invalidateCostCache } from '@/lib/ai-video';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function PATCH(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const csrfError = await requireCsrf(request);
  if (csrfError) return csrfError;

  try {
    const body = await request.json();
    const { model_key, fal_cost_cents, credit_cost, target_margin_percent, is_active } = body;

    if (!model_key || typeof model_key !== 'string') {
      return NextResponse.json(
        { success: false, error: 'model_key is required' },
        { status: 400 }
      );
    }

    // Build update object with only provided fields
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (fal_cost_cents !== undefined) {
      if (typeof fal_cost_cents !== 'number' || fal_cost_cents < 1 || fal_cost_cents > 10000) {
        return NextResponse.json(
          { success: false, error: 'fal_cost_cents must be between 1 and 10000' },
          { status: 400 }
        );
      }
      update.fal_cost_cents = Math.round(fal_cost_cents);
    }

    if (credit_cost !== undefined) {
      if (typeof credit_cost !== 'number' || credit_cost < 1 || credit_cost > 1000) {
        return NextResponse.json(
          { success: false, error: 'credit_cost must be between 1 and 1000' },
          { status: 400 }
        );
      }
      update.credit_cost = Math.round(credit_cost);
    }

    if (target_margin_percent !== undefined) {
      if (typeof target_margin_percent !== 'number' || target_margin_percent < 10 || target_margin_percent > 80) {
        return NextResponse.json(
          { success: false, error: 'target_margin_percent must be between 10 and 80' },
          { status: 400 }
        );
      }
      update.target_margin_percent = Math.round(target_margin_percent);
    }

    if (is_active !== undefined) {
      if (typeof is_active !== 'boolean') {
        return NextResponse.json(
          { success: false, error: 'is_active must be a boolean' },
          { status: 400 }
        );
      }
      update.is_active = is_active;
    }

    const supabase = getSupabase();

    // Update the model pricing
    const { data, error } = await supabase
      .from('model_pricing')
      .update(update)
      .eq('model_key', model_key)
      .select()
      .single();

    if (error) {
      console.error('[ADMIN_PRICING_MODELS] Update error:', error.message);
      return NextResponse.json(
        { success: false, error: 'Failed to update model pricing' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'Model not found' },
        { status: 404 }
      );
    }

    // Recalculate min_credit_cost after changes
    if (fal_cost_cents !== undefined || target_margin_percent !== undefined) {
      const { data: minCost } = await supabase.rpc('calculate_min_credit_cost', {
        p_fal_cost_cents: data.fal_cost_cents,
        p_target_margin_percent: data.target_margin_percent ?? 35,
      });

      if (minCost !== null) {
        await supabase
          .from('model_pricing')
          .update({ min_credit_cost: minCost })
          .eq('model_key', model_key);
      }
    }

    // Invalidate cost cache so next generation uses new pricing
    invalidateCostCache();

    return NextResponse.json({
      success: true,
      model: data,
      warning: data.credit_cost < (data.min_credit_cost ?? 0)
        ? `credit_cost (${data.credit_cost}) is below minimum (${data.min_credit_cost}) for target margin`
        : undefined,
    });
  } catch (error) {
    console.error('[ADMIN_PRICING_MODELS] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
