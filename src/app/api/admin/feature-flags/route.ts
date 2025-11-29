// app/api/admin/feature-flags/route.ts
// ============================================================================
// FEATURE FLAGS API - Admin-only endpoint to manage feature toggles
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

// ============================================================================
// ADMIN CHECK
// ============================================================================

async function isAdmin(): Promise<boolean> {
  const session = await getServerSession();
  if (!session?.user?.email) return false;

  const supabase = getSupabaseClient();
  const { data: user } = await supabase
    .from('users')
    .select('role')
    .eq('email', session.user.email)
    .single();

  return user?.role === 'admin';
}

// ============================================================================
// GET - List all feature flags
// ============================================================================

export async function GET() {
  try {
    // Check admin access
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseClient();

    const { data: flags, error } = await supabase
      .from('feature_flags')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[FEATURE-FLAGS] Error fetching:', error);
      return NextResponse.json({ error: 'Failed to fetch feature flags' }, { status: 500 });
    }

    // Group by category
    const grouped = (flags || []).reduce((acc, flag) => {
      const cat = flag.category || 'general';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(flag);
      return acc;
    }, {} as Record<string, typeof flags>);

    return NextResponse.json({
      ok: true,
      flags: flags || [],
      grouped,
      categories: Object.keys(grouped),
    });

  } catch (error) {
    console.error('[FEATURE-FLAGS] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// PUT - Update a feature flag
// ============================================================================

export async function PUT(request: NextRequest) {
  try {
    // Check admin access
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { key, enabled, config } = body;

    if (!key) {
      return NextResponse.json({ error: 'Feature key is required' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // Build update object
    const updateData: Record<string, unknown> = {};
    if (typeof enabled === 'boolean') updateData.enabled = enabled;
    if (config !== undefined) updateData.config = config;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No update data provided' }, { status: 400 });
    }

    const { data: flag, error } = await supabase
      .from('feature_flags')
      .update(updateData)
      .eq('key', key)
      .select()
      .single();

    if (error) {
      console.error('[FEATURE-FLAGS] Error updating:', error);
      return NextResponse.json({ error: 'Failed to update feature flag' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      flag,
      message: `Feature "${flag.name}" ${flag.enabled ? 'enabled' : 'disabled'}`,
    });

  } catch (error) {
    console.error('[FEATURE-FLAGS] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================================
// POST - Create a new feature flag (optional)
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check admin access
    if (!(await isAdmin())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { key, name, description, category, enabled, config } = body;

    if (!key || !name) {
      return NextResponse.json({ error: 'Key and name are required' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    const { data: flag, error } = await supabase
      .from('feature_flags')
      .insert({
        key,
        name,
        description: description || '',
        category: category || 'general',
        enabled: enabled || false,
        config: config || {},
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Feature flag with this key already exists' }, { status: 409 });
      }
      console.error('[FEATURE-FLAGS] Error creating:', error);
      return NextResponse.json({ error: 'Failed to create feature flag' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      flag,
      message: `Feature "${flag.name}" created`,
    });

  } catch (error) {
    console.error('[FEATURE-FLAGS] Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
