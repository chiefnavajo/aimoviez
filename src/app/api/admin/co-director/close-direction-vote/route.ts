// app/api/admin/co-director/close-direction-vote/route.ts
// Close direction voting and pick winner
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { parseBody, CloseDirectionVoteSchema } from '@/lib/validations';

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
    const parsed = parseBody(CloseDirectionVoteSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { season_id, slot_position } = parsed.data;
    const supabase = getSupabase();

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

    if (slot.direction_voting_status !== 'open') {
      return NextResponse.json(
        { error: 'Direction voting is not open for this slot' },
        { status: 400 }
      );
    }

    // Get direction options sorted by vote count
    const { data: directions, error: directionsError } = await supabase
      .from('direction_options')
      .select('*')
      .eq('season_id', season_id)
      .eq('slot_position', slot_position)
      .order('vote_count', { ascending: false });

    if (directionsError) {
      console.error('[close-direction-vote] Failed to fetch directions:', directionsError);
      return NextResponse.json({ error: 'Failed to fetch directions' }, { status: 500 });
    }

    if (!directions || directions.length === 0) {
      return NextResponse.json(
        { error: 'No direction options found' },
        { status: 400 }
      );
    }

    // Pick the winner (highest vote count)
    const winner = directions[0];
    const totalVotes = directions.reduce((sum, d) => sum + (d.vote_count || 0), 0);

    // Update slot with winner
    const { error: updateError } = await supabase
      .from('story_slots')
      .update({
        direction_voting_status: 'closed',
        winning_direction_id: winner.id,
      })
      .eq('id', slot.id);

    if (updateError) {
      console.error('[close-direction-vote] Failed to update slot:', updateError);
      return NextResponse.json({ error: 'Failed to close voting' }, { status: 500 });
    }

    // Audit log
    await logAdminAction(req, {
      action: 'close_direction_vote',
      resourceType: 'slot',
      resourceId: slot.id,
      adminId: auth.userId || undefined,
      adminEmail: auth.email || undefined,
      details: {
        season_id,
        slot_position,
        winning_direction_id: winner.id,
        winning_direction_title: winner.title,
        winning_vote_count: winner.vote_count,
        total_votes: totalVotes,
        all_directions: directions.map(d => ({
          id: d.id,
          title: d.title,
          vote_count: d.vote_count,
        })),
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'Direction voting closed',
      winner: {
        id: winner.id,
        title: winner.title,
        description: winner.description,
        vote_count: winner.vote_count,
      },
      total_votes: totalVotes,
      all_results: directions.map(d => ({
        id: d.id,
        title: d.title,
        vote_count: d.vote_count,
        percentage: totalVotes > 0 ? Math.round((d.vote_count / totalVotes) * 100) : 0,
      })),
    });
  } catch (err) {
    console.error('[close-direction-vote] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
