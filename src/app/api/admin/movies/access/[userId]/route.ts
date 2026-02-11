// DELETE /api/admin/movies/access/[userId]
// Revoke movie access for a user

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';
import { logAdminAction } from '@/lib/audit-log';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const rateLimitResponse = await rateLimit(req, 'admin_sensitive');
  if (rateLimitResponse) return rateLimitResponse;

  const authResult = await requireAdminWithAuth();
  if (authResult instanceof NextResponse) return authResult;

  try {
    const supabase = getSupabase();
    const { userId } = await params;

    // Deactivate (soft delete) rather than hard delete
    const { data: existing, error: fetchError } = await supabase
      .from('movie_access')
      .select('id, user_id')
      .eq('user_id', userId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Access record not found' }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from('movie_access')
      .update({ is_active: false })
      .eq('user_id', userId);

    if (updateError) {
      console.error('[DELETE /api/admin/movies/access/[userId]] Error:', updateError);
      return NextResponse.json({ error: 'Failed to revoke access' }, { status: 500 });
    }

    // Audit log
    await logAdminAction(req, {
      action: 'movie_access_revoke',
      resourceType: 'movie_access',
      resourceId: userId,
      adminEmail: authResult.email || 'unknown',
      adminId: authResult.userId || undefined,
      details: { revoked_user_id: userId },
    });

    return NextResponse.json({
      success: true,
      message: 'Movie access revoked',
      user_id: userId,
    });
  } catch (err) {
    console.error('[DELETE /api/admin/movies/access/[userId]] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
