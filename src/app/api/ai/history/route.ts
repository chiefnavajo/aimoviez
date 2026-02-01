// app/api/ai/history/route.ts
// AI Generation History API - Returns the current user's AI generation history

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Map internal generation status to user-facing stage label.
 */
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

/**
 * GET /api/ai/history
 * Fetch the authenticated user's AI generation history with pagination.
 *
 * Query params:
 * - page?: number  (default: 1)
 * - limit?: number (default: 20, max: 50)
 */
export async function GET(req: NextRequest) {
  // Rate limiting
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Auth check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Look up user by email to get user_id
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('email', session.user.email)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Parse pagination params
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const from = (page - 1) * limit;
    const to = page * limit - 1;

    // Query ai_generations — only safe fields, never fal_request_id or cost_cents
    const { data, error } = await supabase
      .from('ai_generations')
      .select('id, status, prompt, model, style, genre, video_url, clip_id, error_message, created_at, completed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('[GET /api/ai/history] query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch generation history' },
        { status: 500 }
      );
    }

    // Map results to include user-facing stage field, exclude internal status
    const generations = (data || []).map(({ status, ...row }) => ({
      ...row,
      stage: mapStatusToStage(status),
    }));

    return NextResponse.json({
      success: true,
      generations,
      page,
      limit,
      hasMore: (data || []).length === limit,
    });
  } catch (err) {
    console.error('[GET /api/ai/history] Unexpected error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
