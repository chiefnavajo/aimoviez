// app/api/admin/co-director/analyses/[id]/route.ts
// Delete a story analysis
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

/**
 * DELETE /api/admin/co-director/analyses/[id]
 * Delete a story analysis
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const adminResult = await requireAdminWithAuth();
  if (adminResult instanceof NextResponse) return adminResult;
  const auth = adminResult;

  try {
    const { id } = await context.params;

    if (!id) {
      return NextResponse.json({ error: 'Analysis ID is required' }, { status: 400 });
    }

    const supabase = getSupabase();

    // Get the analysis first for audit log
    const { data: analysis, error: fetchError } = await supabase
      .from('story_analyses')
      .select('id, season_id, slot_position')
      .eq('id', id)
      .single();

    if (fetchError || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Delete the analysis
    const { error: deleteError } = await supabase
      .from('story_analyses')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('[DELETE analysis] Error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete analysis' }, { status: 500 });
    }

    // Audit log
    await logAdminAction(req, {
      action: 'analyze_story',
      resourceType: 'story_analysis',
      resourceId: id,
      adminId: auth.userId || undefined,
      adminEmail: auth.email || undefined,
      details: {
        action_type: 'delete',
        season_id: analysis.season_id,
        slot_position: analysis.slot_position,
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'Analysis deleted',
    });
  } catch (err) {
    console.error('[DELETE analysis] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
