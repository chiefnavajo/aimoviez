// app/api/story/pinned-characters/suggestions/route.ts
// User-facing API — get all of the current user's suggestions

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
 * GET /api/story/pinned-characters/suggestions
 * Returns all of the current user's reference suggestions across all characters.
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
    // Get user ID
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get all suggestions with character info
    const { data: suggestions, error } = await supabase
      .from('character_reference_suggestions')
      .select(`
        id,
        status,
        image_url,
        admin_notes,
        created_at,
        reviewed_at,
        pinned_character_id,
        pinned_characters!inner (
          label,
          element_index,
          frontal_image_url
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[GET suggestions] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 });
    }

    const result = (suggestions || []).map(s => ({
      id: s.id,
      status: s.status,
      image_url: s.image_url,
      admin_notes: s.status === 'rejected' ? s.admin_notes : null,
      created_at: s.created_at,
      reviewed_at: s.reviewed_at,
      character: {
        id: s.pinned_character_id,
        label: (s.pinned_characters as any)?.label,
        element_index: (s.pinned_characters as any)?.element_index,
        frontal_image_url: (s.pinned_characters as any)?.frontal_image_url,
      },
    }));

    return NextResponse.json({ ok: true, suggestions: result });
  } catch (err) {
    console.error('[GET suggestions] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
