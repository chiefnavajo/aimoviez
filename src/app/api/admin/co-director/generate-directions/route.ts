// app/api/admin/co-director/generate-directions/route.ts
// Generate direction options for a slot
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { parseBody, GenerateDirectionsSchema } from '@/lib/validations';
import { generateDirections, StoryAnalysis } from '@/lib/claude-director';

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
  const rateLimitResponse = await rateLimit(req, 'co_director_analyze');
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
    const parsed = parseBody(GenerateDirectionsSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { season_id, slot_position } = parsed.data;
    const supabase = getSupabase();

    // Get the latest story analysis
    const { data: analysis, error: analysisError } = await supabase
      .from('story_analyses')
      .select('*')
      .eq('season_id', season_id)
      .order('slot_position', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (analysisError) {
      console.error('[generate-directions] Failed to fetch analysis:', analysisError);
      return NextResponse.json({ error: 'Failed to fetch analysis' }, { status: 500 });
    }

    if (!analysis) {
      return NextResponse.json(
        { error: 'No story analysis found. Run "Analyze Story" first.' },
        { status: 400 }
      );
    }

    // Get season total slots
    const { data: season } = await supabase
      .from('seasons')
      .select('total_slots')
      .eq('id', season_id)
      .single();

    const totalSlots = season?.total_slots || 75;

    // Get feature flag config for max_directions
    const { data: flagConfig } = await supabase
      .from('feature_flags')
      .select('config')
      .eq('key', 'ai_co_director')
      .single();

    const maxDirections = (flagConfig?.config as { max_directions?: number })?.max_directions || 3;

    // Check if voting is already open for this slot (prevent orphaning votes)
    const { data: slotData } = await supabase
      .from('story_slots')
      .select('direction_voting_status')
      .eq('season_id', season_id)
      .eq('slot_position', slot_position)
      .maybeSingle();

    if (slotData?.direction_voting_status === 'open') {
      return NextResponse.json(
        { error: 'Cannot regenerate directions while voting is open. Close voting first.' },
        { status: 400 }
      );
    }

    // Generate directions using Claude
    const result = await generateDirections(
      analysis.analysis as StoryAnalysis,
      slot_position,
      totalSlots,
      maxDirections
    );

    if (!result.ok) {
      console.error('[generate-directions] Claude error:', result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Store existing directions before deleting (for recovery)
    const { data: existingDirections } = await supabase
      .from('direction_options')
      .select('*')
      .eq('season_id', season_id)
      .eq('slot_position', slot_position);

    // Delete existing directions for this slot (if regenerating)
    if (existingDirections && existingDirections.length > 0) {
      const { error: deleteError } = await supabase
        .from('direction_options')
        .delete()
        .eq('season_id', season_id)
        .eq('slot_position', slot_position);

      if (deleteError) {
        console.error('[generate-directions] Failed to delete old directions:', deleteError);
        return NextResponse.json({ error: 'Failed to regenerate directions' }, { status: 500 });
      }
    }

    // Store the new directions
    const directionsToInsert = result.directions.map((d, idx) => ({
      season_id,
      slot_position,
      option_number: idx + 1,
      title: d.title,
      description: d.description,
      mood: d.mood || null,
      suggested_genre: d.suggested_genre || null,
      visual_hints: d.visual_hints || null,
      narrative_hooks: d.narrative_hooks || null,
      vote_count: 0,
    }));

    const { data: stored, error: storeError } = await supabase
      .from('direction_options')
      .insert(directionsToInsert)
      .select();

    if (storeError) {
      console.error('[generate-directions] Failed to store directions:', storeError);

      // Try to restore old directions if insert failed
      if (existingDirections && existingDirections.length > 0) {
        console.log('[generate-directions] Attempting to restore old directions...');
        const restoreData = existingDirections.map(d => ({
          season_id: d.season_id,
          slot_position: d.slot_position,
          option_number: d.option_number,
          title: d.title,
          description: d.description,
          mood: d.mood,
          suggested_genre: d.suggested_genre,
          visual_hints: d.visual_hints,
          narrative_hooks: d.narrative_hooks,
          vote_count: d.vote_count,
        }));
        await supabase.from('direction_options').insert(restoreData);
      }

      return NextResponse.json({ error: 'Failed to store directions' }, { status: 500 });
    }

    // Audit log
    await logAdminAction(req, {
      action: 'generate_directions',
      resourceType: 'direction_option',
      resourceId: season_id,
      adminId: auth.userId || undefined,
      adminEmail: auth.email || undefined,
      details: {
        season_id,
        slot_position,
        directions_count: result.directions.length,
        cost_cents: result.costCents,
      },
    });

    return NextResponse.json({
      ok: true,
      directions: stored,
      tokens: {
        input: result.inputTokens,
        output: result.outputTokens,
      },
      cost_cents: result.costCents,
    });
  } catch (err) {
    console.error('[generate-directions] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
