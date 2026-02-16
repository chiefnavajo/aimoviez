// app/api/admin/co-director/generate-brief/route.ts
// Generate creative brief from winning direction
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminWithAuth } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/audit-log';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { parseBody, GenerateBriefSchema } from '@/lib/validations';
import { writeBrief, StoryAnalysis, DirectionOption, CreativeBrief } from '@/lib/claude-director';

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
    const parsed = parseBody(GenerateBriefSchema, body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { season_id, slot_position } = parsed.data;
    const supabase = getSupabase();

    // Get the slot with winning direction
    const { data: slot, error: slotError } = await supabase
      .from('story_slots')
      .select('id, winning_direction_id, direction_voting_status')
      .eq('season_id', season_id)
      .eq('slot_position', slot_position)
      .single();

    if (slotError || !slot) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    if (!slot.winning_direction_id) {
      return NextResponse.json(
        { error: 'No winning direction selected. Close voting first.' },
        { status: 400 }
      );
    }

    // Get the winning direction
    const { data: winningDirection, error: directionError } = await supabase
      .from('direction_options')
      .select('*')
      .eq('id', slot.winning_direction_id)
      .single();

    if (directionError || !winningDirection) {
      return NextResponse.json({ error: 'Winning direction not found' }, { status: 404 });
    }

    // Get the latest story analysis
    const { data: analysis, error: analysisError } = await supabase
      .from('story_analyses')
      .select('analysis')
      .eq('season_id', season_id)
      .order('slot_position', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (analysisError || !analysis) {
      return NextResponse.json(
        { error: 'No story analysis found' },
        { status: 400 }
      );
    }

    // Get previous briefs for continuity
    const { data: previousBriefs } = await supabase
      .from('slot_briefs')
      .select('brief_title, scene_description, visual_requirements, tone_guidance, continuity_notes, do_list, dont_list, example_prompts')
      .eq('season_id', season_id)
      .lt('slot_position', slot_position)
      .order('slot_position', { ascending: false })
      .limit(3);

    // Generate the brief using Claude
    const directionForClaude: DirectionOption = {
      option_number: winningDirection.option_number,
      title: winningDirection.title,
      description: winningDirection.description,
      mood: winningDirection.mood || '',
      suggested_genre: winningDirection.suggested_genre || '',
      visual_hints: winningDirection.visual_hints || '',
      narrative_hooks: winningDirection.narrative_hooks || '',
    };

    const result = await writeBrief(
      analysis.analysis as StoryAnalysis,
      directionForClaude,
      previousBriefs as CreativeBrief[] | undefined
    );

    if (!result.ok) {
      console.error('[generate-brief] Claude error:', result.error);
      return NextResponse.json({ error: 'Brief generation failed' }, { status: 500 });
    }

    // Store the brief
    const { data: stored, error: storeError } = await supabase
      .from('slot_briefs')
      .upsert({
        season_id,
        slot_position,
        winning_direction_id: slot.winning_direction_id,
        brief_title: result.brief.brief_title,
        scene_description: result.brief.scene_description,
        visual_requirements: result.brief.visual_requirements,
        tone_guidance: result.brief.tone_guidance,
        continuity_notes: result.brief.continuity_notes || null,
        do_list: result.brief.do_list || null,
        dont_list: result.brief.dont_list || null,
        example_prompts: result.brief.example_prompts || [],
        status: 'draft',
        model_used: 'claude-sonnet-4-20250514',
        input_token_count: result.inputTokens,
        output_token_count: result.outputTokens,
        cost_cents: result.costCents,
      }, { onConflict: 'season_id,slot_position' })
      .select()
      .single();

    if (storeError) {
      console.error('[generate-brief] Failed to store brief:', storeError);
      return NextResponse.json({ error: 'Failed to store brief' }, { status: 500 });
    }

    // Audit log
    await logAdminAction(req, {
      action: 'generate_brief',
      resourceType: 'slot_brief',
      resourceId: stored.id,
      adminId: auth.userId || undefined,
      adminEmail: auth.email || undefined,
      details: {
        season_id,
        slot_position,
        winning_direction_id: slot.winning_direction_id,
        cost_cents: result.costCents,
      },
    });

    return NextResponse.json({
      ok: true,
      brief: stored,
      tokens: {
        input: result.inputTokens,
        output: result.outputTokens,
      },
      cost_cents: result.costCents,
    });
  } catch (err) {
    console.error('[generate-brief] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
