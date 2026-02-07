// app/api/admin/co-director/open-direction-vote/route.ts
// Open direction voting for a slot
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { parseBody, OpenDirectionVoteSchema } from '@/lib/validations';

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

export async function POST(req: NextRequest) {
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
    const parsed = parseBody(OpenDirectionVoteSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { season_id, slot_position, duration_hours } = parsed.data;
    const supabase = getSupabase();

    // Check that direction options exist for this slot
    const { data: directions, error: directionsError } = await supabase
      .from('direction_options')
      .select('id')
      .eq('season_id', season_id)
      .eq('slot_position', slot_position);

    if (directionsError) {
      console.error('[open-direction-vote] Failed to fetch directions:', directionsError);
      return NextResponse.json({ error: 'Failed to fetch directions' }, { status: 500 });
    }

    if (!directions || directions.length === 0) {
      return NextResponse.json(
        { error: 'No direction options found. Generate directions first.' },
        { status: 400 }
      );
    }

    // Get the slot
    const { data: slot, error: slotError } = await supabase
      .from('story_slots')
      .select('id, direction_voting_status')
      .eq('season_id', season_id)
      .eq('slot_position', slot_position)
      .single();

    if (slotError || !slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    if (slot.direction_voting_status === 'open') {
      return NextResponse.json(
        { error: 'Direction voting is already open for this slot' },
        { status: 400 }
      );
    }

    // Update slot to open voting
    const endsAt = new Date(Date.now() + duration_hours * 60 * 60 * 1000);
    const { error: updateError } = await supabase
      .from('story_slots')
      .update({
        direction_voting_status: 'open',
        direction_voting_ends_at: endsAt.toISOString(),
      })
      .eq('id', slot.id);

    if (updateError) {
      console.error('[open-direction-vote] Failed to update slot:', updateError);
      return NextResponse.json({ error: 'Failed to open voting' }, { status: 500 });
    }

    // Audit log
    await logAdminAction(req, {
      action: 'open_direction_vote',
      resourceType: 'slot',
      resourceId: slot.id,
      adminId: auth.userId || undefined,
      adminEmail: auth.email || undefined,
      details: {
        season_id,
        slot_position,
        duration_hours,
        ends_at: endsAt.toISOString(),
        directions_count: directions.length,
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'Direction voting opened',
      ends_at: endsAt.toISOString(),
      directions_count: directions.length,
    });
  } catch (err) {
    console.error('[open-direction-vote] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
