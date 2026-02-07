// app/api/co-director/brief/route.ts
// Get published creative brief for current slot
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

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
 * GET /api/co-director/brief
 * Get the published creative brief for the current active slot
 * This is shown on the /create page to guide creators
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'co_director_read');
  if (rateLimitResponse) return rateLimitResponse;

  // Check feature flag
  const enabled = await isFeatureEnabled('ai_co_director');
  if (!enabled) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const supabase = getSupabase();

  // Get active season
  const { data: activeSeason } = await supabase
    .from('seasons')
    .select('id, label')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!activeSeason) {
    return NextResponse.json({
      ok: true,
      has_brief: false,
      message: 'No active season',
    });
  }

  // Get the current slot accepting submissions (usually status = 'voting' or 'waiting_for_clips')
  const { data: currentSlot } = await supabase
    .from('story_slots')
    .select('slot_position, brief_id, status')
    .eq('season_id', activeSeason.id)
    .in('status', ['voting', 'waiting_for_clips'])
    .order('slot_position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!currentSlot) {
    return NextResponse.json({
      ok: true,
      has_brief: false,
      message: 'No active slot accepting submissions',
    });
  }

  // Get the published brief for this slot
  const { data: brief, error: briefError } = await supabase
    .from('slot_briefs')
    .select(`
      id,
      brief_title,
      scene_description,
      visual_requirements,
      tone_guidance,
      continuity_notes,
      do_list,
      dont_list,
      example_prompts,
      published_at
    `)
    .eq('season_id', activeSeason.id)
    .eq('slot_position', currentSlot.slot_position)
    .eq('status', 'published')
    .maybeSingle();

  if (briefError) {
    console.error('[GET brief] Error:', briefError);
    return NextResponse.json({ error: 'Failed to fetch brief' }, { status: 500 });
  }

  if (!brief) {
    return NextResponse.json({
      ok: true,
      has_brief: false,
      season_id: activeSeason.id,
      season_label: activeSeason.label,
      slot_position: currentSlot.slot_position,
      message: 'No published brief for current slot',
    });
  }

  return NextResponse.json({
    ok: true,
    has_brief: true,
    season_id: activeSeason.id,
    season_label: activeSeason.label,
    slot_position: currentSlot.slot_position,
    brief: {
      id: brief.id,
      title: brief.brief_title,
      scene_description: brief.scene_description,
      visual_requirements: brief.visual_requirements,
      tone_guidance: brief.tone_guidance,
      continuity_notes: brief.continuity_notes,
      do_list: brief.do_list,
      dont_list: brief.dont_list,
      example_prompts: brief.example_prompts || [],
      published_at: brief.published_at,
    },
  });
}
