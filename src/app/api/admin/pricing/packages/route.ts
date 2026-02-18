// PATCH /api/admin/pricing/packages
// Update credit package (credits, price_cents, bonus_percent, is_active)

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

export async function PATCH(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const csrfError = await requireCsrf(request);
  if (csrfError) return csrfError;

  try {
    const body = await request.json();
    const { id, credits, price_cents, bonus_percent, is_active, name } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Package id is required' },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (name !== undefined) {
      if (typeof name !== 'string' || name.length < 1 || name.length > 50) {
        return NextResponse.json(
          { success: false, error: 'name must be 1-50 characters' },
          { status: 400 }
        );
      }
      update.name = name;
    }

    if (credits !== undefined) {
      if (typeof credits !== 'number' || credits < 1 || credits > 10000) {
        return NextResponse.json(
          { success: false, error: 'credits must be between 1 and 10000' },
          { status: 400 }
        );
      }
      update.credits = Math.round(credits);
    }

    if (price_cents !== undefined) {
      if (typeof price_cents !== 'number' || price_cents < 50 || price_cents > 100000) {
        return NextResponse.json(
          { success: false, error: 'price_cents must be between 50 and 100000' },
          { status: 400 }
        );
      }
      update.price_cents = Math.round(price_cents);
    }

    if (bonus_percent !== undefined) {
      if (typeof bonus_percent !== 'number' || bonus_percent < 0 || bonus_percent > 100) {
        return NextResponse.json(
          { success: false, error: 'bonus_percent must be between 0 and 100' },
          { status: 400 }
        );
      }
      update.bonus_percent = Math.round(bonus_percent);
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

    const { data, error } = await supabase
      .from('credit_packages')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[ADMIN_PRICING_PACKAGES] Update error:', error.message);
      return NextResponse.json(
        { success: false, error: 'Failed to update package' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: 'Package not found' },
        { status: 404 }
      );
    }

    // If price or credits changed, recalculate all model min_credit_costs
    // (worst-case $/credit may have shifted)
    if (price_cents !== undefined || credits !== undefined || bonus_percent !== undefined) {
      const { data: recalcResult, error: recalcError } = await supabase.rpc('recalculate_all_pricing');
      if (recalcError) {
        console.warn('[ADMIN_PRICING_PACKAGES] Recalculation error:', recalcError.message);
      }

      return NextResponse.json({
        success: true,
        package: data,
        recalculation: recalcResult || null,
        note: 'Model pricing min_credit_costs have been recalculated',
      });
    }

    return NextResponse.json({ success: true, package: data });
  } catch (error) {
    console.error('[ADMIN_PRICING_PACKAGES] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
