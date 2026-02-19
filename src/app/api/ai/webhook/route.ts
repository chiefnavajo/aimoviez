// POST /api/ai/webhook
// Receives completion notifications from fal.ai
// Verifies ED25519 signature before processing

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// =============================================================================
// JWKS CACHE
// =============================================================================

const JWKS_URL = 'https://rest.alpha.fal.ai/.well-known/jwks.json';
let jwksCache: any[] = [];
let jwksCacheTime = 0;
const JWKS_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function fetchJwks(): Promise<any[]> {
  const now = Date.now();
  if (jwksCache.length > 0 && (now - jwksCacheTime) < JWKS_TTL) return jwksCache;

  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = await res.json();
  jwksCache = data.keys ?? [];
  jwksCacheTime = now;
  return jwksCache;
}

// =============================================================================
// WEBHOOK SIGNATURE VERIFICATION
// =============================================================================

async function verifyFalWebhook(req: NextRequest): Promise<{ valid: boolean; body: string }> {
  // 1. Extract ALL 4 required headers
  const requestId = req.headers.get('x-fal-webhook-request-id');
  const userId    = req.headers.get('x-fal-webhook-user-id');
  const timestamp = req.headers.get('x-fal-webhook-timestamp');
  const signature = req.headers.get('x-fal-webhook-signature');

  if (!requestId || !userId || !timestamp || !signature) {
    return { valid: false, body: '' };
  }

  // 2. Validate timestamp (±300 seconds) — prevents replay attacks
  const tsInt = parseInt(timestamp, 10);
  if (isNaN(tsInt) || Math.abs(Math.floor(Date.now() / 1000) - tsInt) > 300) {
    return { valid: false, body: '' };
  }

  // 3. Read raw body
  const body = await req.text();

  // 4. Construct the signed message (NOT the raw body!)
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const message = [requestId, userId, timestamp, bodyHash].join('\n');
  const messageBytes = Buffer.from(message, 'utf-8');

  // 5. Decode hex signature (must be exactly 64 bytes for ED25519)
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(signature, 'hex');
    if (sigBytes.length !== 64) return { valid: false, body };
  } catch {
    return { valid: false, body };
  }

  // 6. Fetch JWKS and verify with each Ed25519 key
  try {
    const keys = await fetchJwks();
    for (const jwk of keys) {
      if (jwk.crv !== 'Ed25519' || jwk.kty !== 'OKP') continue;
      try {
        const publicKey = crypto.createPublicKey({
          key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
          format: 'jwk',
        });
        if (crypto.verify(null, messageBytes, publicKey, sigBytes)) {
          return { valid: true, body };
        }
      } catch {
        continue;
      }
    }
  } catch (err) {
    console.error('[AI_WEBHOOK] JWKS verification error:', err);
  }

  return { valid: false, body };
}

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
// CREDIT REFUND HELPER
// =============================================================================

async function refundCreditsIfApplicable(
  supabase: ReturnType<typeof getSupabase>,
  gen: { id: string; user_id: string; credit_deducted: boolean; credit_amount: number | null }
): Promise<void> {
  if (!gen.credit_deducted || !gen.credit_amount || !gen.user_id) {
    return;
  }

  try {
    const { data: result, error } = await supabase.rpc('refund_credits', {
      p_user_id: gen.user_id,
      p_generation_id: gen.id,
    });

    if (error) {
      console.error('[AI_WEBHOOK] Credit refund error:', error.message, 'generation:', gen.id);
    } else if (result?.success) {
      console.info(`[AI_WEBHOOK] Auto-refunded ${result.refunded} credits for failed generation:`, gen.id);
    } else if (result?.error === 'Already refunded') {
      console.info('[AI_WEBHOOK] Credits already refunded for generation:', gen.id);
    }
  } catch (err) {
    console.error('[AI_WEBHOOK] Credit refund exception:', err, 'generation:', gen.id);
  }
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export async function POST(request: NextRequest) {
  // Rate limit: 60/min by IP
  const rateLimitResponse = await rateLimit(request, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  // Verify ED25519 signature
  const { valid, body } = await verifyFalWebhook(request);
  if (!valid) {
    console.warn('[AI_WEBHOOK] Invalid signature — rejecting');
    // Return 403 for invalid signatures (proper security response)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    console.error('[AI_WEBHOOK] Invalid JSON body');
    return NextResponse.json({ ok: true });
  }

  const falRequestId = payload.request_id;
  if (!falRequestId) {
    console.error('[AI_WEBHOOK] Missing request_id in payload');
    return NextResponse.json({ ok: true });
  }

  const supabase = getSupabase();

  // Look up generation by fal_request_id (include user_id, credit info, and mode for fallback)
  const { data: gen, error: lookupError } = await supabase
    .from('ai_generations')
    .select('id, status, user_id, credit_deducted, credit_amount, generation_mode, model, prompt, style')
    .eq('fal_request_id', falRequestId)
    .maybeSingle();

  if (lookupError || !gen) {
    console.warn('[AI_WEBHOOK] Unknown fal_request_id:', falRequestId);
    return NextResponse.json({ ok: true });
  }

  // Idempotency: only update if status is pending or processing
  if (gen.status !== 'pending' && gen.status !== 'processing') {
    console.info('[AI_WEBHOOK] Ignoring webhook for generation in status:', gen.status);
    return NextResponse.json({ ok: true });
  }

  const webhookStatus = payload.status;

  if (webhookStatus === 'OK') {
    // Extract video URL (try multiple response formats for different fal.ai models)
    const videoUrl =
      payload.payload?.video?.url ||
      payload.payload?.output?.video?.url ||
      payload.payload?.data?.video_url ||
      payload.payload?.video_url;
    if (!videoUrl) {
      // Log full payload structure to help debug new model response formats
      console.error('[AI_WEBHOOK] Missing video URL for generation:', gen.id, 'payload keys:', JSON.stringify(Object.keys(payload.payload || {})));
      await supabase
        .from('ai_generations')
        .update({
          status: 'failed',
          error_message: 'No video URL in webhook response',
        })
        .eq('id', gen.id);
      // Auto-refund credits
      await refundCreditsIfApplicable(supabase, gen);
      return NextResponse.json({ ok: true });
    }

    // Validate video URL hostname
    try {
      const hostname = new URL(videoUrl).hostname;
      if (!hostname.endsWith('.fal.media') && !hostname.endsWith('.fal.ai')) {
        await supabase
          .from('ai_generations')
          .update({
            status: 'failed',
            error_message: 'Video URL from unexpected hostname',
          })
          .eq('id', gen.id);
        console.error('[AI_WEBHOOK] Unexpected video hostname:', hostname);
        // Auto-refund credits
        await refundCreditsIfApplicable(supabase, gen);
        return NextResponse.json({ ok: true });
      }
    } catch {
      await supabase
        .from('ai_generations')
        .update({
          status: 'failed',
          error_message: 'Invalid video URL in webhook response',
        })
        .eq('id', gen.id);
      // Auto-refund credits
      await refundCreditsIfApplicable(supabase, gen);
      return NextResponse.json({ ok: true });
    }

    // Update to completed
    await supabase
      .from('ai_generations')
      .update({
        status: 'completed',
        video_url: videoUrl,
        completed_at: new Date().toISOString(),
      })
      .eq('id', gen.id);

    console.info('[AI_WEBHOOK] Generation completed:', gen.id);
  } else {
    // Error or unknown status
    const errorMessage = payload.error || payload.detail || `Webhook status: ${webhookStatus}`;
    const errorStr = typeof errorMessage === 'string' ? errorMessage.slice(0, 500) : 'Generation failed';

    console.error('[AI_WEBHOOK] Generation failed:', gen.id, 'mode:', gen.generation_mode, 'error:', errorStr);

    // Reference-to-video failed — attempt text-to-video fallback with character descriptions in prompt
    if (gen.generation_mode === 'reference-to-video' && gen.prompt) {
      try {
        const { startGeneration } = await import('@/lib/ai-video');
        const fallbackModel = 'kling-2.6'; // Safe default with lowest cost
        const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/ai/webhook`;

        // Strip @Element tags from prompt (keep character descriptions)
        const cleanPrompt = gen.prompt.replace(/@Element\d+\s*/g, '').trim();

        const fallbackResult = await startGeneration(
          fallbackModel,
          cleanPrompt,
          gen.style || undefined,
          webhookUrl
        );

        // Update generation row to use fallback model and new request ID
        await supabase
          .from('ai_generations')
          .update({
            fal_request_id: fallbackResult.requestId,
            model: fallbackModel,
            generation_mode: 'text-to-video',
            status: 'processing',
            error_message: null,
            prompt: cleanPrompt,
          })
          .eq('id', gen.id);

        console.info('[AI_WEBHOOK] Fallback to text-to-video for generation:', gen.id, 'new request:', fallbackResult.requestId);
        return NextResponse.json({ ok: true });
      } catch (fallbackError) {
        console.error('[AI_WEBHOOK] Text-to-video fallback also failed:', gen.id, fallbackError instanceof Error ? fallbackError.message : fallbackError);
        // Fall through to mark as failed
      }
    }

    await supabase
      .from('ai_generations')
      .update({
        status: 'failed',
        error_message: errorStr,
      })
      .eq('id', gen.id);

    // Auto-refund credits
    await refundCreditsIfApplicable(supabase, gen);
  }

  // Always return 200 to prevent retries
  return NextResponse.json({ ok: true });
}
