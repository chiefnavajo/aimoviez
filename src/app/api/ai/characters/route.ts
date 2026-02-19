// app/api/ai/characters/route.ts
// CRUD API for user's personal characters

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { UserCharacterCreateSchema, parseBody } from '@/lib/validations';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

/**
 * Validate that an image URL points to our storage.
 */
function isOurStorageUrl(imageUrl: string): boolean {
  try {
    const parsed = new URL(imageUrl);
    const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : null;
    const r2Host = process.env.CLOUDFLARE_R2_PUBLIC_URL
      ? new URL(process.env.CLOUDFLARE_R2_PUBLIC_URL).hostname
      : null;
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === supabaseHost || parsed.hostname === r2Host)
    );
  } catch {
    return false;
  }
}

/**
 * GET /api/ai/characters
 * List user's characters (active only).
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const supabase = getSupabase();

  // Check feature flag
  const { data: flag } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'user_characters')
    .maybeSingle();

  if (!flag?.enabled) {
    return NextResponse.json({ ok: true, characters: [], enabled: false });
  }

  // Get user
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
  }

  const { data: characters, error } = await supabase
    .from('user_characters')
    .select('id, label, frontal_image_url, reference_image_urls, appearance_description, usage_count, created_at')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/ai/characters] error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch characters' }, { status: 500 });
  }

  const result = (characters || []).map(c => ({
    id: c.id,
    label: c.label,
    frontal_image_url: c.frontal_image_url,
    reference_image_urls: c.reference_image_urls || [],
    reference_count: (c.reference_image_urls || []).length,
    appearance_description: c.appearance_description || null,
    usage_count: c.usage_count,
  }));

  return NextResponse.json({ ok: true, characters: result, enabled: true });
}

/**
 * POST /api/ai/characters
 * Create a new user character.
 */
export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'upload');
  if (rateLimitResponse) return rateLimitResponse;
  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const validation = parseBody(UserCharacterCreateSchema, body);
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    const { label, frontal_image_url, appearance_description } = validation.data;

    // Validate URL points to our storage
    if (!isOurStorageUrl(frontal_image_url)) {
      return NextResponse.json(
        { success: false, error: 'Image URL must point to our storage' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // Check feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('key', 'user_characters')
      .maybeSingle();

    if (!flag?.enabled) {
      return NextResponse.json(
        { success: false, error: 'User character uploads are not currently available' },
        { status: 403 }
      );
    }

    // Get user
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Check current active character count (app-level guard)
    const { count } = await supabase
      .from('user_characters')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_active', true);

    if ((count ?? 0) >= 10) {
      return NextResponse.json(
        { success: false, error: 'Maximum 10 active characters. Delete one to add more.' },
        { status: 400 }
      );
    }

    // HEAD-check the frontal URL to confirm upload succeeded
    try {
      const headRes = await fetch(frontal_image_url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      });
      if (!headRes.ok) {
        return NextResponse.json(
          { success: false, error: 'Image not found at the provided URL. Please try uploading again.' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: 'Could not verify image upload. Please try again.' },
        { status: 400 }
      );
    }

    // Insert character
    const { data: character, error: insertError } = await supabase
      .from('user_characters')
      .insert({
        user_id: user.id,
        label,
        frontal_image_url,
        appearance_description: appearance_description || null,
      })
      .select('id, label, frontal_image_url, appearance_description, created_at')
      .single();

    if (insertError) {
      // Handle trigger error for max characters
      if (insertError.message?.includes('Maximum 10')) {
        return NextResponse.json(
          { success: false, error: 'Maximum 10 active characters. Delete one to add more.' },
          { status: 400 }
        );
      }
      console.error('[POST /api/ai/characters] insert error:', insertError);
      return NextResponse.json({ success: false, error: 'Failed to create character' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, character }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/ai/characters] error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/ai/characters?id=X
 * Soft-delete a user character (set is_active=false).
 */
export async function DELETE(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;
  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ success: false, error: 'Character id is required' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Get user
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('email', session.user.email)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
  }

  // Soft-delete with ownership check
  const { data, error } = await supabase
    .from('user_characters')
    .update({ is_active: false })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: 'Character not found or not owned by you' },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, message: 'Character deleted' });
}
