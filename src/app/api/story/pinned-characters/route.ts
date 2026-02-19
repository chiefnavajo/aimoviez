// app/api/story/pinned-characters/route.ts
// Public API — get active pinned characters for a season

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

/**
 * GET /api/story/pinned-characters
 * Returns active pinned characters for the current active season.
 * Optional: ?season_id=X to specify a season, or ?genre=X to find by genre.
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    // Check feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'character_pinning')
      .maybeSingle();

    if (!flag?.enabled) {
      return NextResponse.json({ ok: true, characters: [], enabled: false });
    }

    // Determine season — by season_id, genre, or fallback to most recent active
    const { searchParams } = new URL(req.url);
    let seasonId = searchParams.get('season_id');
    const genre = searchParams.get('genre');

    if (!seasonId) {
      let query = supabase
        .from('seasons')
        .select('id')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);

      if (genre) {
        query = query.ilike('genre', genre);
      }

      const { data: seasons } = await query;

      const season = seasons?.[0];
      if (!season) {
        return NextResponse.json({ ok: true, characters: [], reason: genre ? 'no_season_for_genre' : 'no_active_season' });
      }
      seasonId = season.id;
    }

    // Get active pinned characters
    const { data: characters, error } = await supabase
      .from('pinned_characters')
      .select('id, element_index, label, frontal_image_url, reference_image_urls, usage_count, appearance_description')
      .eq('season_id', seasonId)
      .eq('is_active', true)
      .order('element_index', { ascending: true });

    if (error) {
      console.error('[GET /api/story/pinned-characters] error:', error);
      return NextResponse.json({ error: 'Failed to fetch pinned characters' }, { status: 500 });
    }

    const result = (characters || []).map(c => ({
      id: c.id,
      element_index: c.element_index,
      label: c.label,
      frontal_image_url: c.frontal_image_url,
      reference_count: (c.reference_image_urls || []).length,
      appearance_description: c.appearance_description || null,
    }));

    return NextResponse.json({
      ok: true,
      characters: result,
      season_id: seasonId,
      enabled: true,
    });
  } catch (err) {
    console.error('[GET /api/story/pinned-characters] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
