// POST /api/ai/enhance-prompt
// Takes a plain scene description and returns an optimized video generation prompt
// Uses Claude Haiku for fast, cheap transformation (~$0.005/call)

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { rateLimit } from '@/lib/rate-limit';
import { requireCsrf } from '@/lib/csrf';
import { sanitizePrompt } from '@/lib/ai-video';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Basic blocklist for prompt injection prevention
const BLOCKLIST = [
  'ignore previous', 'disregard instructions', 'system prompt',
  'jailbreak', 'bypass', 'override instructions',
];

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required');
  return new Anthropic({ apiKey, timeout: 30_000 });
}

export async function POST(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'prompt_suggest');
  if (rateLimitResponse) return rateLimitResponse;

  const csrfError = await requireCsrf(req);
  if (csrfError) return csrfError;

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: { description?: string; genre?: string; style?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const description = body.description?.trim();
  if (!description || description.length < 3) {
    return NextResponse.json({ error: 'Description is required (min 3 characters)' }, { status: 400 });
  }
  if (description.length > 500) {
    return NextResponse.json({ error: 'Description too long (max 500 characters)' }, { status: 400 });
  }

  // Content safety check
  const sanitizeResult = sanitizePrompt(description, BLOCKLIST);
  if (!sanitizeResult.ok) {
    return NextResponse.json({ error: sanitizeResult.reason }, { status: 400 });
  }

  try {
    const anthropic = getAnthropicClient();
    const genre = body.genre || '';
    const style = body.style || '';

    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `Transform this scene description into an optimized AI video generation prompt.

Scene: "${description}"
${genre ? `Genre: ${genre}` : ''}
${style ? `Style: ${style}` : ''}

Write a vivid video prompt (20-60 words) that:
1. Starts with a camera movement (tracking shot, close-up, aerial view, dolly zoom, etc.)
2. Includes specific lighting and atmosphere details
3. Uses strong action verbs and cinematic language
4. Is ready to paste directly into an AI video generator

Return ONLY the prompt text, nothing else.`
      }]
    });

    const textContent = response.content.find(c => c.type === 'text');
    const prompt = textContent && textContent.type === 'text'
      ? textContent.text.trim().replace(/^["']|["']$/g, '') // Strip wrapping quotes
      : null;

    if (!prompt) {
      return NextResponse.json({ error: 'Failed to generate prompt' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, prompt });
  } catch (error) {
    console.error('[enhance-prompt] Claude error:', error);
    return NextResponse.json({ error: 'Failed to generate prompt' }, { status: 500 });
  }
}
