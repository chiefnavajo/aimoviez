// lib/ai-video.ts
// fal.ai integration library for AI video generation
// Server-only — never import from client code

import { fal } from '@fal-ai/client';

// =============================================================================
// CONFIGURATION
// =============================================================================

fal.config({ credentials: process.env.FAL_KEY! });

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

  const result = await fal.queue.submit(config.modelId, {
    input,
    webhookUrl,
  });

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

  const result = await fal.queue.submit(i2vConfig.modelId, {
    input,
    webhookUrl,
  });

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

  return {
    prompt: styledPrompt,
    elements,
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

  const result = await fal.queue.submit(
    'fal-ai/kling-video/o1/reference-to-video',
    { input: input as Record<string, unknown> & { prompt: string }, webhookUrl }
  );

  return { requestId: result.request_id };
}

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
