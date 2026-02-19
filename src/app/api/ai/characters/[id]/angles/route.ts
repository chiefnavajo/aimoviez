// app/api/ai/characters/[id]/angles/route.ts
// Add reference angles to a user character

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { UserCharacterAngleSchema, parseBody } from '@/lib/validations';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

/**
 * POST /api/ai/characters/[id]/angles
 * Add a reference angle image to a user character.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const rateLimitResponse = await rateLimit(req, 'upload');
  if (rateLimitResponse) return rateLimitResponse;
  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { id: characterId } = await context.params;
    const body = await req.json();
    const validation = parseBody(UserCharacterAngleSchema, body);
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    const { image_url } = validation.data;

    // Validate URL points to our storage
    try {
      const parsed = new URL(image_url);
      const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
        ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
        : null;
      const r2Host = process.env.CLOUDFLARE_R2_PUBLIC_URL
        ? new URL(process.env.CLOUDFLARE_R2_PUBLIC_URL).hostname
        : null;
      if (parsed.hostname !== supabaseHost && parsed.hostname !== r2Host) {
        return NextResponse.json(
          { success: false, error: 'Image URL must point to our storage' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid image URL' },
        { status: 400 }
      );
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

    // HEAD-check the image URL
    try {
      const headRes = await fetch(image_url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
      });
      if (!headRes.ok) {
        return NextResponse.json(
          { success: false, error: 'Image not found at the provided URL' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: 'Could not verify image upload' },
        { status: 400 }
      );
    }

    // Atomic append via RPC (with ownership check)
    const { data: rpcResult, error: rpcError } = await supabase
      .rpc('append_user_character_angle', {
        p_id: characterId,
        p_user_id: user.id,
        p_url: image_url,
        p_max_refs: 6,
      });

    if (rpcError) {
      console.error('[POST /api/ai/characters/[id]/angles] RPC error:', rpcError);
      return NextResponse.json({ success: false, error: 'Failed to add angle' }, { status: 500 });
    }

    if (!rpcResult || rpcResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Character not found, not owned by you, or maximum 6 angles reached' },
        { status: 400 }
      );
    }

    const urls = rpcResult[0].reference_image_urls || [];
    return NextResponse.json({
      ok: true,
      reference_count: urls.length,
      reference_image_urls: urls,
    }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/ai/characters/[id]/angles] error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
