// app/api/admin/audit-logs/route.ts
// Get audit logs for admin dashboard

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(url, key);
}

/**
 * GET /api/admin/audit-logs
 * Get audit logs with filtering
 *
 * Query params:
 *   action: filter by action type
 *   resourceType: filter by resource type
 *   adminEmail: filter by admin
 *   page: number
 *   limit: number
 */
export async function GET(request: NextRequest) {
  // Rate limit check
  const rateLimitResponse = await rateLimit(request, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminError = await requireAdmin();
  if (adminError) return adminError;

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const resourceType = searchParams.get('resourceType');
    const adminEmail = searchParams.get('adminEmail');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = (page - 1) * limit;

    const supabase = getSupabaseClient();

    let query = supabase
      .from('audit_logs')
      .select('id, action, resource_type, resource_id, admin_email, details, created_at', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (action) {
      query = query.eq('action', action);
    }
    if (resourceType) {
      query = query.eq('resource_type', resourceType);
    }
    if (adminEmail) {
      query = query.eq('admin_email', adminEmail);
    }

    query = query.range(offset, offset + limit - 1);

    const { data: logs, error, count } = await query;

    if (error) {
      console.error('Audit logs query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch audit logs' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      logs: logs || [],
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (error) {
    console.error('Audit logs API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
