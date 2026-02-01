// POST /api/ai/cancel
// Cancels an in-progress AI video generation.
// Sends cancel request to fal.ai and marks generation as failed.

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { cancelFalRequest } from '@/lib/ai-video';

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  const rateLimitResponse = await rateLimit(request, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // 1. Authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // 2. CSRF protection
    const csrfError = await requireCsrf(request);
    if (csrfError) return csrfError;

    // 3. Parse body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    const { generationId } = body;
    if (!generationId || typeof generationId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'generationId is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // 4. Look up user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // 5. Look up generation (verify ownership)
    const { data: gen, error: genError } = await supabase
      .from('ai_generations')
      .select('id, status, fal_request_id, model, user_id')
      .eq('id', generationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (genError || !gen) {
      return NextResponse.json(
        { success: false, error: 'Generation not found' },
        { status: 404 }
      );
    }

    // 6. Must be pending or processing
    if (gen.status !== 'pending' && gen.status !== 'processing') {
      return NextResponse.json(
        { success: false, error: 'Generation cannot be cancelled in its current state' },
        { status: 400 }
      );
    }

    // 7. Cancel on fal.ai (best-effort)
    if (gen.fal_request_id && !gen.fal_request_id.startsWith('placeholder_') && gen.model) {
      try {
        await cancelFalRequest(gen.model, gen.fal_request_id);
      } catch (falError) {
        console.warn('[AI_CANCEL] fal.ai cancel failed (non-fatal):', falError instanceof Error ? falError.message : falError);
      }
    }

    // 8. Mark as failed in DB
    const { error: updateError } = await supabase
      .from('ai_generations')
      .update({
        status: 'failed',
        error_message: 'Cancelled by user',
      })
      .eq('id', gen.id);

    if (updateError) {
      console.error('[AI_CANCEL] DB update error:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to cancel generation' },
        { status: 500 }
      );
    }

    console.info('[AI_CANCEL] Generation cancelled:', gen.id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[AI_CANCEL] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Cancel failed' },
      { status: 500 }
    );
  }
}
