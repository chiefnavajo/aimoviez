// app/api/clip/record-prompt/route.ts
// Record user prompts for AI learning
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getServiceClient } from '@/lib/supabase-client';
import { rateLimit } from '@/lib/rate-limit';
import { recordUserPrompt } from '@/lib/prompt-learning';
import { sanitizeUuid } from '@/lib/sanitize';

async function isFeatureEnabled(key: string): Promise<boolean> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', key)
    .single();
  return data?.enabled ?? false;
}

/**
 * POST /api/clip/record-prompt
 * Record a user's prompt for AI learning
 *
 * Body:
 * - slotId: UUID of the slot
 * - prompt: The user's prompt text
 * - model: AI model name (e.g., 'kling-2.6')
 * - briefId: (optional) UUID of the active brief
 * - clipId: (optional) UUID of the resulting clip if already created
 */
export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'prompt_record');
  if (rateLimitResponse) return rateLimitResponse;

  // Check feature flag
  const enabled = await isFeatureEnabled('prompt_learning');
  if (!enabled) {
    // Silently succeed if feature is disabled (don't block clip creation)
    return NextResponse.json({ ok: true, recorded: false });
  }

  // Parse request body
  let body: {
    slotId?: string;
    prompt?: string;
    model?: string;
    briefId?: string;
    clipId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({
      ok: false,
      error: 'Invalid JSON body',
    }, { status: 400 });
  }

  const { prompt, model } = body;
  const slotId = sanitizeUuid(body.slotId);
  const briefId = sanitizeUuid(body.briefId);
  const clipId = sanitizeUuid(body.clipId);

  // Validate required fields
  if (!slotId) {
    return NextResponse.json({
      ok: false,
      error: 'slotId is required',
    }, { status: 400 });
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
    return NextResponse.json({
      ok: false,
      error: 'Valid prompt is required (min 5 characters)',
    }, { status: 400 });
  }

  if (!model || typeof model !== 'string') {
    return NextResponse.json({
      ok: false,
      error: 'model is required',
    }, { status: 400 });
  }

  // Get user ID if authenticated
  let userId: string | undefined;
  try {
    const session = await getServerSession(authOptions);
    userId = session?.user?.userId || undefined;
  } catch {
    // Continue without user ID if session fails
  }

  if (!userId) {
    return NextResponse.json({ ok: true, recorded: false });
  }

  const supabase = getServiceClient();

  // Get season ID from slot
  const { data: slot, error: slotError } = await supabase
    .from('story_slots')
    .select('season_id')
    .eq('id', slotId)
    .single();

  if (slotError || !slot) {
    return NextResponse.json({
      ok: false,
      error: 'Invalid slot',
    }, { status: 400 });
  }

  // Record the prompt
  const result = await recordUserPrompt({
    userId,
    clipId: clipId || undefined,
    slotId,
    seasonId: slot.season_id,
    prompt: prompt.trim(),
    model,
    briefId: briefId || undefined,
  });

  if (!result.ok) {
    console.error('[record-prompt] Failed:', result.error);
    // Don't fail the request - this is non-critical
    return NextResponse.json({
      ok: true,
      recorded: false,
      reason: 'Recording failed but clip can proceed',
    });
  }

  return NextResponse.json({
    ok: true,
    recorded: true,
  });
}
