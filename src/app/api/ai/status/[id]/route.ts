// GET /api/ai/status/[id]
// Poll AI generation status by generation ID
// Returns mapped stage for client display, never exposes internal fields

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { checkFalStatus } from '@/lib/ai-video';

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
// UUID VALIDATION
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// STATUS TO STAGE MAPPING
// =============================================================================

function mapStatusToStage(status: string): string {
  switch (status) {
    case 'pending':
      return 'queued';
    case 'processing':
      return 'generating';
    case 'completed':
      return 'ready';
    case 'failed':
    case 'expired':
      return 'failed';
    default:
      return 'failed';
  }
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Rate limit
    const rateLimitResponse = await rateLimit(request, 'ai_status');
    if (rateLimitResponse) return rateLimitResponse;

    // 2. Authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    // 3. Extract and validate ID from route params
    const { id } = await params;

    if (!id || !UUID_REGEX.test(id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid generation ID format' },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // 4. Look up user by email to get user_id
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .maybeSingle();

    if (userError) {
      console.error('[AI_STATUS] User lookup error:', userError.message);
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      );
    }

    if (!userData) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // 5. Query generation by ID (includes fields for fallback polling)
    const { data: gen, error: genError } = await supabase
      .from('ai_generations')
      .select('id, status, video_url, error_message, user_id, fal_request_id, model, created_at')
      .eq('id', id)
      .maybeSingle();

    if (genError) {
      console.error('[AI_STATUS] Generation lookup error:', genError.message);
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 }
      );
    }

    // 6. Not found OR user_id mismatch — return same 404 to prevent enumeration
    if (!gen || gen.user_id !== userData.id) {
      return NextResponse.json(
        { success: false, error: 'Generation not found' },
        { status: 404 }
      );
    }

    // 7. Fallback: if stuck pending/processing > 2 min, poll fal.ai directly
    if (
      (gen.status === 'pending' || gen.status === 'processing') &&
      gen.fal_request_id &&
      !gen.fal_request_id.startsWith('placeholder_') &&
      gen.model &&
      gen.created_at
    ) {
      const ageMs = Date.now() - new Date(gen.created_at).getTime();
      const TWO_MINUTES = 2 * 60 * 1000;

      if (ageMs > TWO_MINUTES) {
        try {
          const falResult = await checkFalStatus(gen.model, gen.fal_request_id);

          if (falResult.status === 'COMPLETED' && falResult.videoUrl) {
            // Validate hostname (same as webhook route)
            const hostname = new URL(falResult.videoUrl).hostname;
            if (hostname.endsWith('.fal.media') || hostname.endsWith('.fal.ai')) {
              await supabase
                .from('ai_generations')
                .update({
                  status: 'completed',
                  video_url: falResult.videoUrl,
                  completed_at: new Date().toISOString(),
                })
                .eq('id', gen.id);

              console.info('[AI_STATUS] Fallback poll recovered generation:', gen.id);
              return NextResponse.json({
                success: true,
                stage: 'ready',
                videoUrl: falResult.videoUrl,
                error: null,
              });
            }
          } else if (falResult.status === 'IN_PROGRESS' && gen.status === 'pending') {
            // Update to processing so UI shows "generating"
            await supabase
              .from('ai_generations')
              .update({ status: 'processing' })
              .eq('id', gen.id);

            return NextResponse.json({
              success: true,
              stage: 'generating',
              videoUrl: null,
              error: null,
            });
          }
          // IN_QUEUE or UNKNOWN — continue with DB status
        } catch (pollError) {
          // Fallback poll failed — don't block, return DB status
          console.warn('[AI_STATUS] Fallback poll error:', pollError instanceof Error ? pollError.message : pollError);
        }
      }
    }

    // 8. Map status to client-facing stage
    const stage = mapStatusToStage(gen.status);

    return NextResponse.json({
      success: true,
      stage,
      videoUrl: gen.video_url || null,
      error: gen.error_message || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AI_STATUS] Unhandled error:', message);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
