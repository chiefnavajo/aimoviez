/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Mocks — use `var` to avoid TDZ since the mock factory runs at module load
// when `new Anthropic()` is called at the top level of the source file.
// ---------------------------------------------------------------------------

/* eslint-disable no-var */
var mockCreate: jest.Mock;
/* eslint-enable no-var */

jest.mock('@anthropic-ai/sdk', () => {
  // Initialize the mock fn here, inside the factory, so it is available
  // when the constructor is invoked at module load.
  mockCreate = jest.fn();

  class RateLimitError extends Error {
    constructor() {
      super('Rate limited');
      this.name = 'RateLimitError';
    }
  }
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }

  const AnthropicMock = jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));

  Object.assign(AnthropicMock, { RateLimitError, APIError });

  return { __esModule: true, default: AnthropicMock };
});

jest.mock('@/lib/ai-video', () => ({
  MODEL_DURATION_SECONDS: {
    'hailuo-2.3': 6,
    'kling-2.6': 5,
    'veo3-fast': 8,
    'sora-2': 8,
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  generateMovieScript,
  estimateMovieCredits,
  MovieScript,
} from '@/lib/movie-script-generator';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validScript: MovieScript = {
  scenes: [
    {
      scene_number: 1,
      scene_title: 'The Beginning',
      video_prompt: 'A sweeping aerial shot of a futuristic city at dawn',
      narration_text: null,
    },
    {
      scene_number: 2,
      scene_title: 'The Chase',
      video_prompt: 'A character runs through neon-lit alleyways',
      narration_text: null,
    },
  ],
  total_scenes: 2,
  estimated_duration_seconds: 10,
  summary: 'A futuristic thriller about survival',
};

function mockSuccessResponse(script: MovieScript = validScript) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(script) }],
    usage: { input_tokens: 1000, output_tokens: 500 },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

describe('movie-script-generator', () => {
  // -----------------------------------------------------------------------
  // generateMovieScript
  // -----------------------------------------------------------------------

  describe('generateMovieScript', () => {
    it('returns a parsed script on success', async () => {
      mockSuccessResponse();

      const result = await generateMovieScript('A hero saves the world.', {
        model: 'kling-2.6',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.script.scenes).toHaveLength(2);
        expect(result.script.scenes[0].scene_title).toBe('The Beginning');
        expect(result.inputTokens).toBe(1000);
        expect(result.outputTokens).toBe(500);
        expect(result.costCents).toBeGreaterThan(0);
      }
    });

    it('renumbers scenes sequentially', async () => {
      const wonkyScript: MovieScript = {
        ...validScript,
        scenes: [
          { ...validScript.scenes[0], scene_number: 10 },
          { ...validScript.scenes[1], scene_number: 20 },
        ],
      };
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(wonkyScript) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await generateMovieScript('Story text', { model: 'kling-2.6' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.script.scenes[0].scene_number).toBe(1);
        expect(result.script.scenes[1].scene_number).toBe(2);
        expect(result.script.total_scenes).toBe(2);
      }
    });

    it('passes voiceId as narration flag to system prompt', async () => {
      mockSuccessResponse();

      await generateMovieScript('Some story', {
        model: 'veo3-fast',
        voiceId: 'voice-abc',
        style: 'cinematic',
        aspectRatio: '9:16',
        targetDurationMinutes: 5,
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.system).toContain('narration_text');
      expect(callArgs.system).toContain('50 words');
    });

    it('truncates source text longer than 80000 characters', async () => {
      mockSuccessResponse();

      const longText = 'A'.repeat(90000);
      await generateMovieScript(longText, { model: 'kling-2.6' });

      const callArgs = mockCreate.mock.calls[0][0];
      const userContent = callArgs.messages[0].content;
      expect(userContent).toContain('[Text truncated due to length]');
      expect(userContent.length).toBeLessThan(90000 + 200);
    });

    it('returns error when Claude returns no text content', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'x', name: 'foo', input: {} }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await generateMovieScript('Story', { model: 'kling-2.6' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('No text response');
      }
    });

    it('returns error when response is not valid JSON', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'This is not JSON at all' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await generateMovieScript('Story', { model: 'kling-2.6' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Failed to parse');
      }
    });

    it('returns error when scenes array is empty', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ scenes: [], total_scenes: 0 }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await generateMovieScript('Story', { model: 'kling-2.6' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('no scenes');
      }
    });

    it('handles rate limit error', async () => {
      const err = new (Anthropic as unknown as { RateLimitError: new () => Error }).RateLimitError();
      mockCreate.mockRejectedValueOnce(err);

      const result = await generateMovieScript('Story', { model: 'kling-2.6' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('AI_RATE_LIMITED');
      }
    });

    it('handles API overloaded error (529)', async () => {
      const err = new (Anthropic as unknown as { APIError: new (s: number, m: string) => Error }).APIError(529, 'Overloaded');
      mockCreate.mockRejectedValueOnce(err);

      const result = await generateMovieScript('Story', { model: 'kling-2.6' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('AI_OVERLOADED');
      }
    });

    it('handles generic errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await generateMovieScript('Story', { model: 'kling-2.6' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Network timeout');
      }
    });

    it('extracts JSON from text that has surrounding content', async () => {
      const wrappedText = `Here is the script:\n${JSON.stringify(validScript)}\n\nHope you like it!`;
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: wrappedText }],
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      const result = await generateMovieScript('Story', { model: 'kling-2.6' });
      expect(result.ok).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // estimateMovieCredits
  // -----------------------------------------------------------------------

  describe('estimateMovieCredits', () => {
    it('calculates cost for known model without narration', () => {
      const credits = estimateMovieCredits(10, 'kling-2.6', false);
      expect(credits).toBe(70);
    });

    it('adds narration credits when narration is enabled', () => {
      const credits = estimateMovieCredits(10, 'kling-2.6', true);
      expect(credits).toBe(80);
    });

    it('uses correct cost for veo3-fast', () => {
      const credits = estimateMovieCredits(5, 'veo3-fast', false);
      expect(credits).toBe(50);
    });

    it('uses correct cost for sora-2', () => {
      const credits = estimateMovieCredits(5, 'sora-2', true);
      expect(credits).toBe(80);
    });

    it('uses correct cost for hailuo-2.3', () => {
      const credits = estimateMovieCredits(3, 'hailuo-2.3', false);
      expect(credits).toBe(24);
    });

    it('falls back to 7 credits per scene for unknown model', () => {
      const credits = estimateMovieCredits(4, 'unknown-model', false);
      expect(credits).toBe(28);
    });
  });
});
