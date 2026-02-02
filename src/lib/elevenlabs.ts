// lib/elevenlabs.ts
// ============================================================================
// ELEVENLABS TTS CLIENT
// Server-only module using raw fetch — no SDK needed.
// ============================================================================

// ============================================================================
// TYPES
// ============================================================================

export interface VoiceOption {
  id: string;
  name: string;
  accent: string;
  gender: string;
  style: string;
}

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
}

export interface NarrationConfig {
  max_chars: number;
  cost_per_generation_cents: number;
  daily_limit: number;
  model: string;
  output_format: string;
  voices: VoiceOption[];
  voice_settings: VoiceSettings;
}

export interface NarrationResult {
  audioBuffer: Buffer;
  contentType: string;
  characterCount: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Check if a voice ID is in the allowed list from feature flag config.
 */
export function isValidVoiceId(voiceId: string, config: NarrationConfig): boolean {
  return config.voices.some(v => v.id === voiceId);
}

/**
 * Generate narration audio via ElevenLabs TTS API.
 * Returns raw audio buffer (MP3).
 */
export async function generateNarration(
  text: string,
  voiceId: string,
  config: NarrationConfig
): Promise<NarrationResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: config.model,
      voice_settings: config.voice_settings,
      output_format: config.output_format,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`ElevenLabs API error ${response.status}: ${errorBody}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = Buffer.from(arrayBuffer);

  if (audioBuffer.length === 0) {
    throw new Error('ElevenLabs returned empty audio');
  }

  return {
    audioBuffer,
    contentType: 'audio/mpeg',
    characterCount: text.length,
  };
}
