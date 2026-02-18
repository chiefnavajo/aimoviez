// POST /api/admin/pricing/recalculate
// Trigger recalculate_all_pricing() RPC to ensure all models meet margin targets

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

export async function POST(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  const csrfError = await requireCsrf(request);
  if (csrfError) return csrfError;

  try {
    const supabase = getSupabase();

    const { data, error } = await supabase.rpc('recalculate_all_pricing');

    if (error) {
      console.error('[ADMIN_PRICING_RECALC] RPC error:', error.message);
      return NextResponse.json(
        { success: false, error: 'Failed to recalculate pricing' },
        { status: 500 }
      );
    }

    // Invalidate cost cache so next generation uses updated pricing
    invalidateCostCache();

    return NextResponse.json({
      success: true,
      result: data,
    });
  } catch (error) {
    console.error('[ADMIN_PRICING_RECALC] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
