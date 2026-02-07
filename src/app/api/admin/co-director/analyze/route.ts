// app/api/admin/co-director/analyze/route.ts
// Trigger AI story analysis for a season
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { parseBody, AnalyzeStorySchema } from '@/lib/validations';
import { analyzeStory, ClipMetadata } from '@/lib/claude-director';

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
    const parsed = parseBody(AnalyzeStorySchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { season_id, up_to_slot } = parsed.data;
    const supabase = getSupabase();

    // Get season info
    const { data: season, error: seasonError } = await supabase
      .from('seasons')
      .select('id, label, total_slots')
      .eq('id', season_id)
      .single();

    if (seasonError || !season) {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    // Get winning clips up to the specified slot
    const slotLimit = up_to_slot || season.total_slots;
    const { data: slots, error: slotsError } = await supabase
      .from('story_slots')
      .select('slot_position, winner_tournament_clip_id')
      .eq('season_id', season_id)
      .lte('slot_position', slotLimit)
      .not('winner_tournament_clip_id', 'is', null)
      .order('slot_position', { ascending: true });

    if (slotsError) {
      console.error('[analyze] Failed to fetch slots:', slotsError);
      return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 });
    }

    if (!slots || slots.length === 0) {
      return NextResponse.json(
        { error: 'No winning clips to analyze' },
        { status: 400 }
      );
    }

    // Get clip details
    const winnerIds = slots.map(s => s.winner_tournament_clip_id).filter(Boolean);
    const { data: clips, error: clipsError } = await supabase
      .from('tournament_clips')
      .select('id, title, description, ai_prompt, slot_position')
      .in('id', winnerIds);

    if (clipsError) {
      console.error('[analyze] Failed to fetch clips:', clipsError);
      return NextResponse.json({ error: 'Failed to fetch clips' }, { status: 500 });
    }

    // Build clip metadata for analysis
    const clipMetadata: ClipMetadata[] = (clips || []).map(c => ({
      slot_position: c.slot_position,
      title: c.title || 'Untitled',
      description: c.description || undefined,
      user_prompt: c.ai_prompt || undefined,
    }));

    // Call Claude for analysis
    const result = await analyzeStory(clipMetadata, season.label);

    if (!result.ok) {
      console.error('[analyze] Claude error:', result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    // Store the analysis
    const latestSlot = Math.max(...clipMetadata.map(c => c.slot_position));
    const { data: stored, error: storeError } = await supabase
      .from('story_analyses')
      .upsert({
        season_id,
        slot_position: latestSlot,
        analysis: result.analysis,
        model_used: 'claude-sonnet-4-20250514',
        input_token_count: result.inputTokens,
        output_token_count: result.outputTokens,
        cost_cents: result.costCents,
        triggered_by: auth.userId,
      }, { onConflict: 'season_id,slot_position' })
      .select()
      .single();

    if (storeError) {
      console.error('[analyze] Failed to store analysis:', storeError);
      return NextResponse.json({ error: 'Failed to store analysis' }, { status: 500 });
    }

    // Audit log
    await logAdminAction(req, {
      action: 'analyze_story',
      resourceType: 'story_analysis',
      resourceId: stored.id,
      adminId: auth.userId || undefined,
      adminEmail: auth.email || undefined,
      details: {
        season_id,
        slot_position: latestSlot,
        clips_analyzed: clipMetadata.length,
        cost_cents: result.costCents,
      },
    });

    return NextResponse.json({
      ok: true,
      analysis: stored,
      tokens: {
        input: result.inputTokens,
        output: result.outputTokens,
      },
      cost_cents: result.costCents,
    });
  } catch (err) {
    console.error('[analyze] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
