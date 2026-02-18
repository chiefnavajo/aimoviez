// app/api/admin/pinned-characters/suggestions/route.ts
// Admin API — moderate character reference suggestions

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { parseBody, ReviewSuggestionSchema } from '@/lib/validations';
import { logAdminAction } from '@/lib/audit-log';
import { getStorageProvider } from '@/lib/storage';
import { deleteFiles } from '@/lib/storage';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

/**
 * GET /api/admin/pinned-characters/suggestions
 * List pending suggestions (with character and user info)
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const authResult = await requireAdminWithAuth();
  if (authResult instanceof NextResponse) return authResult;

  const supabase = getSupabase();

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'pending';
    const characterId = searchParams.get('character_id');
    const seasonId = searchParams.get('season_id');

    let query = supabase
      .from('character_reference_suggestions')
      .select(`
        id,
        status,
        image_url,
        source_clip_id,
        frame_timestamp,
        admin_notes,
        created_at,
        reviewed_at,
        pinned_character_id,
        user_id,
        season_id,
        pinned_characters!inner (
          label,
          element_index,
          frontal_image_url,
          reference_image_urls
        ),
        users!character_reference_suggestions_user_id_fkey (
          username,
          avatar_url
        )
      `)
      .eq('status', status)
      .order('created_at', { ascending: true });

    if (characterId) {
      query = query.eq('pinned_character_id', characterId);
    }
    if (seasonId) {
      query = query.eq('season_id', seasonId);
    }

    const { data: suggestions, error } = await query.limit(50);

    if (error) {
      console.error('[GET admin suggestions] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 });
    }

    const result = (suggestions || []).map(s => ({
      id: s.id,
      status: s.status,
      image_url: s.image_url,
      source_clip_id: s.source_clip_id,
      frame_timestamp: s.frame_timestamp,
      admin_notes: s.admin_notes,
      created_at: s.created_at,
      reviewed_at: s.reviewed_at,
      character: {
        id: s.pinned_character_id,
        label: (s.pinned_characters as any)?.label,
        element_index: (s.pinned_characters as any)?.element_index,
        frontal_image_url: (s.pinned_characters as any)?.frontal_image_url,
        current_refs: ((s.pinned_characters as any)?.reference_image_urls || []).length,
      },
      user: {
        id: s.user_id,
        username: (s.users as any)?.username,
        avatar_url: (s.users as any)?.avatar_url,
      },
    }));

    return NextResponse.json({ ok: true, suggestions: result });
  } catch (err) {
    console.error('[GET admin suggestions] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/pinned-characters/suggestions
 * Approve a suggestion — appends image to character's reference_image_urls
 */
export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const authResult = await requireAdminWithAuth();
  if (authResult instanceof NextResponse) return authResult;

  const supabase = getSupabase();

  try {
    const body = await req.json();
    const parsed = parseBody(ReviewSuggestionSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { suggestion_id } = parsed.data;

    // Get the suggestion
    const { data: suggestion, error: sugError } = await supabase
      .from('character_reference_suggestions')
      .select('*')
      .eq('id', suggestion_id)
      .single();

    if (sugError || !suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    if (suggestion.status !== 'pending') {
      return NextResponse.json({ error: 'Suggestion already reviewed' }, { status: 400 });
    }

    // Atomically append to character's reference_image_urls (max 6)
    const { data: rpcResult, error: rpcError } = await supabase
      .rpc('append_reference_angle', {
        p_id: suggestion.pinned_character_id,
        p_url: suggestion.image_url,
        p_max_refs: 6,
      });

    if (rpcError) {
      console.error('[POST approve suggestion] RPC error:', rpcError);
      return NextResponse.json({ error: 'Failed to add reference angle' }, { status: 500 });
    }

    if (!rpcResult || rpcResult.length === 0) {
      return NextResponse.json(
        { error: 'Character already has 6 reference angles (maximum reached)' },
        { status: 400 }
      );
    }

    // Update suggestion status
    const { error: updateError } = await supabase
      .from('character_reference_suggestions')
      .update({
        status: 'approved',
        reviewed_by: authResult.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestion_id);

    if (updateError) {
      console.error('[POST approve suggestion] Update error:', updateError);
    }

    // Send notification to user (non-blocking)
    supabase.from('notifications').insert({
      user_key: `user_${suggestion.user_id}`,
      type: 'reference_approved',
      title: 'Reference Suggestion Approved',
      message: 'Your character reference angle suggestion was approved!',
      action_url: '/story',
      metadata: { character_id: suggestion.pinned_character_id },
      is_read: false,
    }).then(({ error: notifErr }) => {
      if (notifErr) console.error('[approve suggestion] Notification error:', notifErr);
    });

    // Audit log (non-blocking)
    logAdminAction(req, {
      action: 'approve_reference_suggestion',
      resourceType: 'character_reference_suggestion',
      resourceId: suggestion_id,
      adminId: authResult.userId || undefined,
      details: {
        character_id: suggestion.pinned_character_id,
        user_id: suggestion.user_id,
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, status: 'approved' });
  } catch (err) {
    console.error('[POST approve suggestion] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/pinned-characters/suggestions
 * Reject a suggestion — deletes uploaded image from storage
 */
export async function DELETE(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const authResult = await requireAdminWithAuth();
  if (authResult instanceof NextResponse) return authResult;

  const supabase = getSupabase();

  try {
    const body = await req.json();
    const parsed = parseBody(ReviewSuggestionSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { suggestion_id, admin_notes } = parsed.data;

    // Get the suggestion
    const { data: suggestion, error: sugError } = await supabase
      .from('character_reference_suggestions')
      .select('*')
      .eq('id', suggestion_id)
      .single();

    if (sugError || !suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    if (suggestion.status !== 'pending') {
      return NextResponse.json({ error: 'Suggestion already reviewed' }, { status: 400 });
    }

    // Update suggestion status
    const { error: updateError } = await supabase
      .from('character_reference_suggestions')
      .update({
        status: 'rejected',
        admin_notes: admin_notes || null,
        reviewed_by: authResult.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', suggestion_id);

    if (updateError) {
      console.error('[DELETE reject suggestion] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to reject suggestion' }, { status: 500 });
    }

    // Delete uploaded image from storage (non-blocking, only if we have a storage key)
    if (suggestion.storage_key) {
      const { data: r2Flag } = await supabase
        .from('feature_flags')
        .select('enabled')
        .eq('key', 'r2_storage')
        .maybeSingle();

      const provider = await getStorageProvider(
        (r2Flag as { enabled?: boolean } | null)?.enabled ?? false
      );

      deleteFiles([suggestion.storage_key], provider).catch(err =>
        console.error('[DELETE reject suggestion] Storage cleanup error:', err)
      );
    }

    // Send notification to user (non-blocking)
    supabase.from('notifications').insert({
      user_key: `user_${suggestion.user_id}`,
      type: 'reference_rejected',
      title: 'Reference Suggestion Not Used',
      message: admin_notes
        ? `Your character reference angle suggestion was not used: ${admin_notes}`
        : 'Your character reference angle suggestion was not used.',
      action_url: '/story',
      metadata: { character_id: suggestion.pinned_character_id },
      is_read: false,
    }).then(({ error: notifErr }) => {
      if (notifErr) console.error('[reject suggestion] Notification error:', notifErr);
    });

    // Audit log (non-blocking)
    logAdminAction(req, {
      action: 'reject_reference_suggestion',
      resourceType: 'character_reference_suggestion',
      resourceId: suggestion_id,
      adminId: authResult.userId || undefined,
      details: {
        character_id: suggestion.pinned_character_id,
        user_id: suggestion.user_id,
        admin_notes,
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, status: 'rejected' });
  } catch (err) {
    console.error('[DELETE reject suggestion] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
