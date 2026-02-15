// app/api/features/route.ts
// ============================================================================
// PUBLIC FEATURES API - Check which features are enabled
// This endpoint is public so the frontend can conditionally render features
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// SUPABASE CLIENT (using anon key for read-only public data)
// ============================================================================

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

// ============================================================================
// GET - Get enabled features
// Returns a map of feature keys to their enabled status
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);

    // Optional: check specific features only
    const keys = searchParams.get('keys')?.split(',').filter(Boolean);

    let query = supabase
      .from('feature_flags')
      .select('key, enabled, config');

    if (keys && keys.length > 0) {
      query = query.in('key', keys);
    }

    const { data: flags, error } = await query;

    if (error) {
      // If table doesn't exist yet, return empty (graceful degradation)
      if (error.code === '42P01') {
        return NextResponse.json({
          features: {},
          configs: {},
        });
      }
      console.error('[FEATURES] Error fetching:', error);
      return NextResponse.json({ error: 'Failed to fetch features' }, { status: 500 });
    }

    // Build feature map
    const features: Record<string, boolean> = {};
    const configs: Record<string, Record<string, unknown>> = {};

    // Sensitive config keys that should not be exposed to unauthenticated clients
    const SENSITIVE_CONFIG_KEYS = new Set([
      'daily_cost_limit_cents', 'monthly_cost_limit_cents', 'keyword_blocklist',
      'max_daily_free', 'cost_per_generation_cents', 'admin_emails',
    ]);

    (flags || []).forEach((flag) => {
      features[flag.key] = flag.enabled;
      if (flag.enabled && flag.config) {
        // Strip sensitive keys from public config
        const safeConfig: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(flag.config)) {
          if (!SENSITIVE_CONFIG_KEYS.has(k)) {
            safeConfig[k] = v;
          }
        }
        if (Object.keys(safeConfig).length > 0) {
          configs[flag.key] = safeConfig;
        }
      }
    });

    return NextResponse.json({
      features,
      configs,
    }, {
      headers: {
        // Cache for 5 minutes to reduce DB load
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      },
    });

  } catch (error) {
    console.error('[FEATURES] Unexpected error:', error);
    // Graceful degradation - return empty features on error
    return NextResponse.json({
      features: {},
      configs: {},
    });
  }
}
