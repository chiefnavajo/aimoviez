// lib/ai-video.ts
// fal.ai integration library for AI video generation
// Server-only — never import from client code

import { fal } from '@fal-ai/client';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// RETRY HELPER (exponential backoff for transient failures)
// =============================================================================

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      console.warn(`[AI_VIDEO] Attempt ${attempt}/${maxAttempts} failed:`, lastError.message);
      // Don't retry client errors (4xx) — only retry transient/server errors
      const is4xx = lastError.message?.includes('status code: 4');
      if (is4xx || attempt >= maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// Validate FAL_KEY at module load time
const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('FAL_KEY environment variable is required in production');
}
if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

export interface ModelConfig {
  modelId: string;
  costCents: number;
  duration: string | null; // null = not configurable (Hailuo)
  resolution: string;
  supportsAudio: boolean;
  supportsPortrait: boolean;
}

export const MODELS: Record<string, ModelConfig> = {
  'hailuo-2.3': {
    modelId: 'fal-ai/minimax/hailuo-2.3/pro/text-to-video',
    costCents: 49,
    duration: null,
    resolution: '1080p',
    supportsAudio: false,
    supportsPortrait: false,
  },
  'kling-2.6': {
    modelId: 'fal-ai/kling-video/v2.6/pro/text-to-video',
    costCents: 35,
    duration: '5',
    resolution: '720p',
    supportsAudio: true,
    supportsPortrait: true,
  },
  'veo3-fast': {
    modelId: 'fal-ai/veo3/fast',
    costCents: 80,
    duration: '8s',
    resolution: '720p',
    supportsAudio: true,
    supportsPortrait: true,
  },
  'sora-2': {
    modelId: 'fal-ai/sora-2/text-to-video',
    costCents: 80,
    duration: '8',
    resolution: '720p',
    supportsAudio: false,
    supportsPortrait: true,
  },
  'kling-o1-ref': {
    modelId: 'fal-ai/kling-video/o1/reference-to-video',
    costCents: 56,
    duration: '5',
    resolution: '720p',
    supportsAudio: false,
    supportsPortrait: true,
  },
};

export const MODEL_DURATION_SECONDS: Record<string, number> = {
  'hailuo-2.3': 6,
  'kling-2.6': 5,
  'veo3-fast': 8,
  'sora-2': 8,
  'kling-o1-ref': 5,
};

// =============================================================================
// DYNAMIC PRICING — DB-backed cost source with in-memory cache
// The model_pricing table is the single source of truth for costs.
// MODELS.costCents above are hardcoded fallbacks used only when DB is unreachable.
// =============================================================================

export interface ModelCosts {
  fal_cost_cents: number;
  credit_cost: number;
}

// Fallback defaults (match MODELS.costCents + model_pricing seeds)
const COST_DEFAULTS: Record<string, ModelCosts> = {
  'kling-2.6':    { fal_cost_cents: 35, credit_cost: 7 },
  'hailuo-2.3':   { fal_cost_cents: 49, credit_cost: 10 },
  'veo3-fast':    { fal_cost_cents: 80, credit_cost: 15 },
  'sora-2':       { fal_cost_cents: 80, credit_cost: 15 },
  'kling-o1-ref': { fal_cost_cents: 56, credit_cost: 11 },
};

const COST_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let costCache: { data: Record<string, ModelCosts>; expires: number } | null = null;

/**
 * Get model costs from the model_pricing DB table (cached for 5 min).
 * Falls back to hardcoded COST_DEFAULTS if DB is unreachable.
 * Pass an existing Supabase client, or omit to create one from env vars.
 */
export async function getModelCosts(supabase?: SupabaseClient): Promise<Record<string, ModelCosts>> {
  // Return cached data if still fresh
  if (costCache && Date.now() < costCache.expires) {
    return costCache.data;
  }

  try {
    const client = supabase ?? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await client
      .from('model_pricing')
      .select('model_key, fal_cost_cents, credit_cost')
      .eq('is_active', true);

    if (error || !data || data.length === 0) {
      console.warn('[AI_VIDEO] Failed to fetch model_pricing, using defaults:', error?.message);
      return { ...COST_DEFAULTS };
    }

    const costs: Record<string, ModelCosts> = {};
    for (const row of data) {
      costs[row.model_key] = {
        fal_cost_cents: row.fal_cost_cents,
        credit_cost: row.credit_cost,
      };
    }

    // Fill any missing models from defaults
    for (const [key, defaults] of Object.entries(COST_DEFAULTS)) {
      if (!costs[key]) {
        costs[key] = defaults;
      }
    }

    costCache = { data: costs, expires: Date.now() + COST_CACHE_TTL_MS };
    return costs;
  } catch (err) {
    console.warn('[AI_VIDEO] getModelCosts exception, using defaults:', err);
    return { ...COST_DEFAULTS };
  }
}

/** Invalidate the cost cache (call after admin updates pricing). */
export function invalidateCostCache(): void {
  costCache = null;
}

/** Get fal.ai cost in cents for a model (from cache/DB, with fallback). */
export async function getFalCostCents(modelKey: string, supabase?: SupabaseClient): Promise<number> {
  const costs = await getModelCosts(supabase);
  return costs[modelKey]?.fal_cost_cents ?? COST_DEFAULTS[modelKey]?.fal_cost_cents ?? 100;
}

/** Get credit cost for a model (from cache/DB, with fallback). */
export async function getCreditCost(modelKey: string, supabase?: SupabaseClient): Promise<number> {
  const costs = await getModelCosts(supabase);
  return costs[modelKey]?.credit_cost ?? COST_DEFAULTS[modelKey]?.credit_cost ?? 10;
}

/** Get fal.ai endpoint IDs for all models (used by pricing API calls). */
export function getFalEndpointIds(): Record<string, string> {
  const endpoints: Record<string, string> = {};
  for (const [key, config] of Object.entries(MODELS)) {
    endpoints[key] = config.modelId;
  }
  return endpoints;
}

// =============================================================================
// STYLE PREFIXES (prepended to user prompt)
// =============================================================================

export const STYLE_PREFIXES: Record<string, string> = {
  cinematic: 'cinematic film style,',
  anime: 'anime style,',
  realistic: 'photorealistic,',
  abstract: 'abstract art style,',
  noir: 'film noir style, black and white,',
  retro: 'retro VHS style,',
  neon: 'neon-lit cyberpunk style,',
};

const DEFAULT_NEGATIVE_PROMPTS: Record<string, string> = {
  'kling-2.6': 'blurry, low quality, distorted, watermark, text overlay',
  'veo3-fast': 'blurry, low quality, distorted, watermark, text overlay',
};

// =============================================================================
// BUILD INPUT (model-specific parameters)
// =============================================================================

export function buildInput(
  model: string,
  rawPrompt: string,
  style?: string,
  enableAudio: boolean = false
): Record<string, unknown> {
  const styledPrompt = style && STYLE_PREFIXES[style]
    ? `${STYLE_PREFIXES[style]} ${rawPrompt}`
    : rawPrompt;

  switch (model) {
    case 'hailuo-2.3':
      // Only accepts prompt + prompt_optimizer. No aspect_ratio, duration, or video_size.
      return { prompt: styledPrompt, prompt_optimizer: true };

    case 'kling-2.6':
      // Duration "5" (no 's' suffix). Must use 5, not 10 (10s > MAX_VIDEO_DURATION 8.5).
      return {
        prompt: styledPrompt,
        negative_prompt: DEFAULT_NEGATIVE_PROMPTS['kling-2.6'],
        aspect_ratio: '9:16',
        duration: '5',
        generate_audio: enableAudio,
      };

    case 'veo3-fast':
      // Duration "8s" (WITH 's' suffix).
      return {
        prompt: styledPrompt,
        negative_prompt: DEFAULT_NEGATIVE_PROMPTS['veo3-fast'],
        aspect_ratio: '9:16',
        duration: '8s',
        generate_audio: enableAudio,
      };

    case 'sora-2':
      // Duration is integer seconds (4, 8, or 12). No negative_prompt or audio.
      return {
        prompt: styledPrompt,
        duration: 8,
        aspect_ratio: '9:16',
      };

    default:
      throw new Error(`Unknown model: ${model}`);
  }
}

// =============================================================================
// START GENERATION (submit to fal.ai queue)
// =============================================================================

export async function startGeneration(
  modelKey: string,
  prompt: string,
  style: string | undefined,
  webhookUrl: string
): Promise<{ requestId: string }> {
  const config = MODELS[modelKey];
  if (!config) throw new Error(`Unknown model: ${modelKey}`);

  const input = buildInput(modelKey, prompt, style, config.supportsAudio);

  // Retry with exponential backoff for transient failures
  const result = await withRetry(() =>
    fal.queue.submit(config.modelId, {
      input,
      webhookUrl,
    })
  );

  return { requestId: result.request_id };
}

// =============================================================================
// IMAGE-TO-VIDEO MODELS
// =============================================================================

export const IMAGE_TO_VIDEO_MODELS: Record<string, { modelId: string; costCents: number }> = {
  'kling-2.6': {
    modelId: 'fal-ai/kling-video/v2.6/pro/image-to-video',
    costCents: 35,
  },
  'hailuo-2.3': {
    modelId: 'fal-ai/minimax/hailuo-2.3/pro/image-to-video',
    costCents: 49,
  },
  'sora-2': {
    modelId: 'fal-ai/sora-2/image-to-video',
    costCents: 80,
  },
  // veo3-fast excluded — no confirmed image-to-video variant
};

export function supportsImageToVideo(modelKey: string): boolean {
  return modelKey in IMAGE_TO_VIDEO_MODELS;
}

// =============================================================================
// BUILD IMAGE-TO-VIDEO INPUT (model-specific)
// =============================================================================

export function buildImageToVideoInput(
  model: string,
  rawPrompt: string,
  imageUrl: string,
  style?: string,
  enableAudio: boolean = false
): Record<string, unknown> {
  const styledPrompt = style && STYLE_PREFIXES[style]
    ? `${STYLE_PREFIXES[style]} ${rawPrompt}`
    : rawPrompt;

  switch (model) {
    case 'hailuo-2.3':
      return {
        prompt: styledPrompt,
        image_url: imageUrl,
        prompt_optimizer: true,
      };

    case 'kling-2.6':
      return {
        prompt: styledPrompt,
        image_url: imageUrl,
        negative_prompt: DEFAULT_NEGATIVE_PROMPTS['kling-2.6'],
        aspect_ratio: '9:16',
        duration: '5',
        generate_audio: enableAudio,
      };

    case 'sora-2':
      return {
        prompt: styledPrompt,
        image_url: imageUrl,
        duration: 8,
        aspect_ratio: '9:16',
      };

    default:
      throw new Error(`Image-to-video not supported for model: ${model}`);
  }
}

// =============================================================================
// START IMAGE-TO-VIDEO GENERATION
// =============================================================================

export async function startImageToVideoGeneration(
  modelKey: string,
  prompt: string,
  imageUrl: string,
  style: string | undefined,
  webhookUrl: string
): Promise<{ requestId: string }> {
  const i2vConfig = IMAGE_TO_VIDEO_MODELS[modelKey];
  if (!i2vConfig) throw new Error(`Image-to-video not supported for model: ${modelKey}`);

  const t2vConfig = MODELS[modelKey];
  if (!t2vConfig) throw new Error(`Unknown model: ${modelKey}`);

  const input = buildImageToVideoInput(modelKey, prompt, imageUrl, style, t2vConfig.supportsAudio);

  // Retry with exponential backoff for transient failures
  const result = await withRetry(() =>
    fal.queue.submit(i2vConfig.modelId, {
      input,
      webhookUrl,
    })
  );

  return { requestId: result.request_id };
}

// =============================================================================
// IMAGE-TO-VIDEO MODEL CONFIG HELPER
// =============================================================================

export function getImageToVideoModelConfig(modelKey: string): { modelId: string; costCents: number } | null {
  return IMAGE_TO_VIDEO_MODELS[modelKey] ?? null;
}

// =============================================================================
// REFERENCE-TO-VIDEO (Character Pinning via Kling O1)
// =============================================================================

export interface ReferenceElement {
  frontal_image_url: string;
  reference_image_urls?: string[];
}

export function buildReferenceToVideoInput(
  rawPrompt: string,
  elements: ReferenceElement[],
  style?: string,
  imageUrls?: string[],
): Record<string, unknown> {
  const styledPrompt = style && STYLE_PREFIXES[style]
    ? `${STYLE_PREFIXES[style]} ${rawPrompt}`
    : rawPrompt;

  // fal.ai requires at least 1 reference_image_url per element (see OmniVideoElementInput).
  // When no reference angles exist, use the frontal image as the reference fallback.
  const cleanedElements = elements.map(el => ({
    frontal_image_url: el.frontal_image_url,
    reference_image_urls: el.reference_image_urls?.length
      ? el.reference_image_urls
      : [el.frontal_image_url],
  }));

  return {
    prompt: styledPrompt,
    elements: cleanedElements,
    ...(imageUrls?.length ? { image_urls: imageUrls } : {}),
    duration: '5',
    aspect_ratio: '9:16',
  };
}

export async function startReferenceToVideoGeneration(
  prompt: string,
  elements: ReferenceElement[],
  style: string | undefined,
  webhookUrl: string,
  imageUrls?: string[],
): Promise<{ requestId: string }> {
  const input = buildReferenceToVideoInput(prompt, elements, style, imageUrls);

  // Retry with exponential backoff for transient failures
  const result = await withRetry(() =>
    fal.queue.submit(
      'fal-ai/kling-video/o1/reference-to-video',
      { input: input as Record<string, unknown> & { prompt: string }, webhookUrl }
    )
  );

  return { requestId: result.request_id };
}

// =============================================================================
// CHARACTER ANGLE GENERATION (Kling O1 Image — synchronous)
// =============================================================================

export const ANGLE_PROMPTS = [
  '@Image1 Same person, left profile view, neutral expression, studio lighting, white background',
  '@Image1 Same person, right profile view, neutral expression, studio lighting, white background',
  '@Image1 Same person, three-quarter rear view looking slightly over shoulder, studio lighting, white background',
] as const;

const KLING_IMAGE_ENDPOINT = 'fal-ai/kling-image/o1';
const KLING_IMAGE_COST_CENTS = 3; // ~$0.028 per image

/**
 * Generate a single character angle view from a frontal photo.
 * Uses fal.subscribe (synchronous — blocks until result is ready, ~5-10s).
 * Returns the URL of the generated image on fal.ai CDN.
 */
export async function generateCharacterAngle(
  frontalImageUrl: string,
  anglePrompt: string,
): Promise<string> {
  const result = await withRetry(() =>
    fal.subscribe(KLING_IMAGE_ENDPOINT, {
      input: {
        prompt: anglePrompt,
        image_urls: [frontalImageUrl],
        aspect_ratio: '1:1' as const,
      },
    })
  );

  // fal.ai Kling Image returns { images: [{ url, content_type }] }
  const images = (result as { data?: { images?: { url: string }[] }; images?: { url: string }[] });
  const url = images.data?.images?.[0]?.url ?? images.images?.[0]?.url;
  if (!url) {
    throw new Error('Kling O1 Image returned no image URL');
  }
  return url;
}

/** Cost in cents for generating all 3 angles. */
export const ANGLE_GENERATION_TOTAL_COST_CENTS = KLING_IMAGE_COST_CENTS * ANGLE_PROMPTS.length;

// =============================================================================
// PROMPT SANITIZATION
// =============================================================================

export function sanitizePrompt(
  prompt: string,
  blocklist: string[]
): { ok: true; prompt: string } | { ok: false; reason: string } {
  // NFKD normalization + strip zero-width characters
  let cleaned = prompt.normalize('NFKD');
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');
  // Remove control characters (except newlines)
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Check keyword blocklist (case-insensitive)
  const lower = cleaned.toLowerCase();
  for (const keyword of blocklist) {
    if (lower.includes(keyword.toLowerCase())) {
      return { ok: false, reason: 'Prompt contains prohibited content' };
    }
  }

  return { ok: true, prompt: cleaned };
}

// =============================================================================
// HELPERS
// =============================================================================

export function getModelConfig(modelKey: string): ModelConfig | null {
  return MODELS[modelKey] ?? null;
}

export function isValidModel(modelKey: string): boolean {
  return modelKey in MODELS;
}

// =============================================================================
// QUEUE ENDPOINT HELPER
// fal.ai queue API uses only {owner}/{alias}, not the full model path.
// e.g. "fal-ai/kling-video" from "fal-ai/kling-video/v2.6/pro/text-to-video"
// =============================================================================

function getQueueEndpoint(modelId: string): string {
  const parts = modelId.split('/');
  return `${parts[0]}/${parts[1]}`;
}

// =============================================================================
// CHECK FAL.AI REQUEST STATUS (server-side polling fallback)
// =============================================================================

export async function checkFalStatus(
  modelKey: string,
  falRequestId: string
): Promise<{ status: string; videoUrl?: string }> {
  const config = MODELS[modelKey];
  if (!config) throw new Error(`Unknown model: ${modelKey}`);

  const queueEndpoint = getQueueEndpoint(config.modelId);
  const statusUrl = `https://queue.fal.run/${queueEndpoint}/requests/${falRequestId}/status`;
  const res = await fetch(statusUrl, {
    headers: { Authorization: `Key ${process.env.FAL_KEY}` },
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
  const data = await res.json();

  if (data.status === 'COMPLETED' && data.response_url) {
    const resultRes = await fetch(data.response_url, {
      headers: { Authorization: `Key ${process.env.FAL_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (resultRes.ok) {
      const resultData = await resultRes.json();
      return { status: 'COMPLETED', videoUrl: resultData.video?.url };
    }
  }

  return { status: data.status || 'UNKNOWN' };
}

// =============================================================================
// CANCEL FAL.AI REQUEST
// =============================================================================

export async function cancelFalRequest(
  modelKey: string,
  falRequestId: string
): Promise<void> {
  const config = MODELS[modelKey];
  if (!config) throw new Error(`Unknown model: ${modelKey}`);

  const queueEndpoint = getQueueEndpoint(config.modelId);
  await fetch(
    `https://queue.fal.run/${queueEndpoint}/requests/${falRequestId}/cancel`,
    {
      method: 'PUT',
      headers: { Authorization: `Key ${process.env.FAL_KEY}` },
      signal: AbortSignal.timeout(5000),
    }
  );
}
