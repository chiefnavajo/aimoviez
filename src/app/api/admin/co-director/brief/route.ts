// app/api/admin/co-director/brief/route.ts
// Edit and publish creative briefs
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { parseBody, PublishBriefSchema } from '@/lib/validations';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

async function isFeatureEnabled(key: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', key)
    .single();
  return data?.enabled ?? false;
}

/**
 * GET /api/admin/co-director/brief?season_id=X&slot_position=Y
 * Get brief for a specific slot
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const adminResult = await requireAdminWithAuth();
  if (adminResult instanceof NextResponse) return adminResult;

  const { searchParams } = new URL(req.url);
  const seasonId = searchParams.get('season_id');
  const slotPosition = searchParams.get('slot_position');

  if (!seasonId) {
    return NextResponse.json({ error: 'season_id is required' }, { status: 400 });
  }

  const supabase = getSupabase();

  let query = supabase
    .from('slot_briefs')
    .select('*')
    .eq('season_id', seasonId);

  if (slotPosition) {
    query = query.eq('slot_position', parseInt(slotPosition, 10));
  }

  query = query.order('slot_position', { ascending: false });

  const { data: briefs, error } = await query;

  if (error) {
    console.error('[GET brief] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch briefs' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, briefs: briefs || [] });
}

/**
 * PUT /api/admin/co-director/brief
 * Edit and optionally publish a brief
 */
export async function PUT(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'admin');
  if (rateLimitResponse) return rateLimitResponse;

  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const adminResult = await requireAdminWithAuth();
  if (adminResult instanceof NextResponse) return adminResult;
  const auth = adminResult;

  // Check feature flag
  const enabled = await isFeatureEnabled('ai_co_director');
  if (!enabled) {
    return NextResponse.json(
      { error: 'AI Co-Director is not enabled' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const { publish, ...briefData } = body;

    const parsed = parseBody(PublishBriefSchema, briefData);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const supabase = getSupabase();

    // Check that brief exists
    const { data: existing, error: fetchError } = await supabase
      .from('slot_briefs')
      .select('id, season_id, slot_position, status')
      .eq('id', parsed.data.brief_id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Brief not found' }, { status: 404 });
    }

    // Build update object
    const updateData: Record<string, unknown> = {
      brief_title: parsed.data.brief_title,
      scene_description: parsed.data.scene_description,
      visual_requirements: parsed.data.visual_requirements,
      tone_guidance: parsed.data.tone_guidance,
      continuity_notes: parsed.data.continuity_notes || null,
      do_list: parsed.data.do_list || null,
      dont_list: parsed.data.dont_list || null,
      example_prompts: parsed.data.example_prompts || [],
    };

    // If publishing, update status and timestamps
    if (publish === true) {
      updateData.status = 'published';
      updateData.published_at = new Date().toISOString();
      updateData.published_by = auth.userId;

      // Also update the slot to reference this brief
      await supabase
        .from('story_slots')
        .update({ brief_id: existing.id })
        .eq('season_id', existing.season_id)
        .eq('slot_position', existing.slot_position);
    }

    // Update the brief
    const { data: updated, error: updateError } = await supabase
      .from('slot_briefs')
      .update(updateData)
      .eq('id', parsed.data.brief_id)
      .select()
      .single();

    if (updateError) {
      console.error('[PUT brief] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update brief' }, { status: 500 });
    }

    // Audit log
    await logAdminAction(req, {
      action: publish ? 'publish_brief' : 'generate_brief',
      resourceType: 'slot_brief',
      resourceId: updated.id,
      adminId: auth.userId || undefined,
      adminEmail: auth.email || undefined,
      details: {
        season_id: existing.season_id,
        slot_position: existing.slot_position,
        published: publish === true,
        brief_title: updated.brief_title,
      },
    });

    return NextResponse.json({
      ok: true,
      brief: updated,
      published: publish === true,
    });
  } catch (err) {
    console.error('[PUT brief] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
