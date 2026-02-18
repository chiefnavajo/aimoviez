// lib/prompt-learning.ts
// AI Prompt Learning System: Learns from all user prompts to suggest better prompts
// Server-only — never import from client code

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}
import type { CreativeBrief, StoryAnalysis } from '@/lib/claude-director';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Use Haiku for fast, cheap extraction
const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';

function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }
  return new Anthropic({ apiKey, timeout: 30_000 });
}

// =============================================================================
// TYPES
// =============================================================================

export interface SceneElements {
  lighting: string[];
  location: string[];
  camera: string[];
  atmosphere: string[];
  objects: string[];
  colors: string[];
  time_of_day: string | null;
  motion: string[];
}

export interface PromptSuggestion {
  prompt: string;
  based_on: {
    brief_title: string;
    scene_context: string;
    top_patterns: string[];
    character_context: string | null;
    visual_patterns?: string[];
    visual_prompts?: string[];
  };
}

export interface ModelPattern {
  pattern_type: string;
  pattern_text: string;
  usage_count: number;
  avg_vote_score: number;
}

export interface PinnedCharacter {
  label: string;
  character_description?: string;
  frontal_image_url: string;
}

// =============================================================================
// SCENE ELEMENT EXTRACTION
// =============================================================================

/**
 * Extract scene elements from a prompt using Claude Haiku
 * This helps the AI learn visual vocabulary from user prompts
 */
export async function extractSceneElements(prompt: string): Promise<SceneElements | null> {
  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Extract visual/scene elements from this video generation prompt. Return ONLY valid JSON.

Prompt: "${prompt}"

Return JSON with these arrays (empty array if not found):
{
  "lighting": ["terms describing lighting like 'neon', 'sunset', 'moody', 'bright'"],
  "location": ["terms describing location like 'alley', 'forest', 'office'"],
  "camera": ["camera terms like 'tracking shot', 'close-up', 'wide angle'"],
  "atmosphere": ["mood terms like 'tense', 'peaceful', 'chaotic'"],
  "objects": ["notable objects or props mentioned"],
  "colors": ["color terms or palettes"],
  "time_of_day": "single term or null",
  "motion": ["movement descriptions like 'walking', 'running', 'flying'"]
}`
      }]
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return null;
    }

    // Extract JSON from response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    return JSON.parse(jsonMatch[0]) as SceneElements;
  } catch (error) {
    console.error('[prompt-learning] Failed to extract scene elements:', error);
    return null;
  }
}

// =============================================================================
// PROMPT RECORDING
// =============================================================================

/**
 * Record a user's prompt for learning
 * Called when user submits a clip with a prompt
 */
export async function recordUserPrompt(params: {
  userId?: string;
  clipId?: string;
  slotId: string;
  seasonId: string;
  prompt: string;
  model: string;
  briefId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = getSupabase();

    // Extract scene elements from prompt
    const sceneElements = await extractSceneElements(params.prompt);

    // Insert into prompt_history
    const { error: insertError } = await supabase
      .from('prompt_history')
      .insert({
        user_id: params.userId || null,
        clip_id: params.clipId || null,
        slot_id: params.slotId,
        season_id: params.seasonId,
        user_prompt: params.prompt,
        ai_model: params.model,
        brief_id: params.briefId || null,
        scene_elements: sceneElements,
      });

    if (insertError) {
      console.error('[prompt-learning] Failed to record prompt:', insertError);
      return { ok: false, error: 'Failed to record prompt' };
    }

    // Update scene vocabulary with extracted elements
    if (sceneElements) {
      await updateSceneVocabulary(params.seasonId, sceneElements, params.prompt, 0, false);
    }

    // Update model patterns
    await updateModelPatterns(params.model, params.prompt, 0, false);

    return { ok: true };
  } catch (error) {
    console.error('[prompt-learning] Error recording prompt:', error);
    return { ok: false, error: 'Internal error recording prompt' };
  }
}

/**
 * Update scene vocabulary with extracted elements
 */
export async function updateSceneVocabulary(
  seasonId: string,
  elements: SceneElements,
  prompt: string,
  voteCount: number,
  isWinner: boolean
): Promise<void> {
  const supabase = getSupabase();

  const categories: Array<{ category: string; terms: string[] }> = [
    { category: 'lighting', terms: elements.lighting },
    { category: 'location', terms: elements.location },
    { category: 'camera', terms: elements.camera },
    { category: 'atmosphere', terms: elements.atmosphere },
    { category: 'object', terms: elements.objects },
    { category: 'color', terms: elements.colors },
    { category: 'motion', terms: elements.motion },
  ];

  if (elements.time_of_day) {
    categories.push({ category: 'time', terms: [elements.time_of_day] });
  }

  for (const { category, terms } of categories) {
    for (const term of terms) {
      if (!term || term.length < 2) continue;

      // Use the upsert RPC function
      await supabase.rpc('upsert_scene_vocabulary', {
        p_season_id: seasonId,
        p_term: term.toLowerCase().trim(),
        p_category: category,
        p_vote_count: voteCount,
        p_is_winner: isWinner,
        p_example_prompt: prompt.slice(0, 200), // Limit length
      });
    }
  }
}

/**
 * Update model-specific patterns
 */
export async function updateModelPatterns(
  model: string,
  prompt: string,
  voteCount: number,
  isWinner: boolean
): Promise<void> {
  const supabase = getSupabase();

  // Extract common patterns
  const patterns: Array<{ type: string; text: string }> = [];

  // Shot type patterns (common in video prompts)
  const shotPatterns = prompt.match(/\b(close[- ]up|wide angle|tracking shot|dolly|pan|zoom|aerial|overhead|pov|first person|establishing shot)\b/gi);
  if (shotPatterns) {
    for (const shot of shotPatterns) {
      patterns.push({ type: 'shot', text: shot.toLowerCase() });
    }
  }

  // Lighting patterns
  const lightPatterns = prompt.match(/\b(neon|sunset|golden hour|moody|dramatic|soft|harsh|backlit|silhouette|rim light|ambient)\s*(?:light(?:ing)?|lit)?\b/gi);
  if (lightPatterns) {
    for (const light of lightPatterns) {
      patterns.push({ type: 'lighting', text: light.toLowerCase().trim() });
    }
  }

  // Style patterns
  const stylePatterns = prompt.match(/\b(cinematic|photorealistic|anime|film noir|retro|vintage|cyberpunk|minimalist)\b/gi);
  if (stylePatterns) {
    for (const style of stylePatterns) {
      patterns.push({ type: 'style', text: style.toLowerCase() });
    }
  }

  // Motion patterns
  const motionPatterns = prompt.match(/\b(slow[- ]motion|fast[- ]motion|time[- ]lapse|smooth|steady|handheld|dynamic)\b/gi);
  if (motionPatterns) {
    for (const motion of motionPatterns) {
      patterns.push({ type: 'motion', text: motion.toLowerCase() });
    }
  }

  for (const { type, text } of patterns) {
    await supabase.rpc('upsert_model_pattern', {
      p_ai_model: model,
      p_pattern_type: type,
      p_pattern_text: text,
      p_vote_count: voteCount,
      p_is_winner: isWinner,
    });
  }
}

// =============================================================================
// PROMPT SUGGESTION GENERATION
// =============================================================================

/**
 * Get top patterns for a specific model
 * Uses Bayesian scoring for statistically sound ranking
 */
export async function getTopModelPatterns(
  model: string,
  limit: number = 5
): Promise<ModelPattern[]> {
  const supabase = getSupabase();

  // Try Bayesian scored view first, fall back to raw table
  const { data, error } = await supabase
    .from('model_patterns_scored')
    .select('pattern_type, pattern_text, usage_count, avg_vote_score, bayesian_score')
    .eq('ai_model', model)
    .gte('usage_count', 2) // Lower threshold with Bayesian smoothing
    .order('bayesian_score', { ascending: false })
    .limit(limit);

  if (error) {
    // Fallback to raw table if view doesn't exist yet
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('model_prompt_patterns')
      .select('pattern_type, pattern_text, usage_count, avg_vote_score')
      .eq('ai_model', model)
      .gte('usage_count', 2)
      .order('avg_vote_score', { ascending: false })
      .limit(limit);

    if (fallbackError) {
      console.error('[prompt-learning] Failed to get model patterns:', fallbackError);
      return [];
    }

    return fallbackData || [];
  }

  return data || [];
}

/**
 * Get top vocabulary terms for a season
 * Uses Bayesian scoring for statistically sound ranking
 */
export async function getTopVocabulary(
  seasonId: string,
  category?: string,
  limit: number = 10
): Promise<Array<{ term: string; category: string; frequency: number; avg_vote_score: number }>> {
  const supabase = getSupabase();

  // Try Bayesian scored view first
  let query = supabase
    .from('scene_vocabulary_scored')
    .select('term, category, frequency, avg_vote_score, bayesian_score')
    .eq('season_id', seasonId)
    .order('bayesian_score', { ascending: false })
    .limit(limit);

  if (category) {
    query = query.eq('category', category);
  }

  const { data, error } = await query;

  if (error) {
    // Fallback to raw table if view doesn't exist yet
    let fallbackQuery = supabase
      .from('scene_vocabulary')
      .select('term, category, frequency, avg_vote_score')
      .eq('season_id', seasonId)
      .order('avg_vote_score', { ascending: false })
      .limit(limit);

    if (category) {
      fallbackQuery = fallbackQuery.eq('category', category);
    }

    const { data: fallbackData, error: fallbackError } = await fallbackQuery;

    if (fallbackError) {
      console.error('[prompt-learning] Failed to get vocabulary:', fallbackError);
      return [];
    }

    return fallbackData || [];
  }

  return data || [];
}

/**
 * Get example winning prompts for a season/model
 */
export async function getWinningPrompts(
  seasonId: string,
  model?: string,
  limit: number = 5
): Promise<Array<{ prompt: string; vote_count: number }>> {
  const supabase = getSupabase();

  let query = supabase
    .from('prompt_history')
    .select('user_prompt, vote_count')
    .eq('season_id', seasonId)
    .eq('is_winner', true)
    .order('vote_count', { ascending: false })
    .limit(limit);

  if (model) {
    query = query.eq('ai_model', model);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[prompt-learning] Failed to get winning prompts:', error);
    return [];
  }

  return (data || []).map(d => ({
    prompt: d.user_prompt,
    vote_count: d.vote_count,
  }));
}

/**
 * Generate a ready-to-use prompt based on brief, model, learned patterns, and visual features
 */
export async function generateSmartPrompt(params: {
  brief: CreativeBrief;
  analysis?: StoryAnalysis;
  model: string;
  seasonId: string;
  pinnedCharacters?: PinnedCharacter[];
  visualContext?: {
    lighting_mood?: string;
    setting?: string;
    aesthetic?: string;
    framing?: string;
  };
  useVisualLearning?: boolean;
  genre?: string;
}): Promise<PromptSuggestion> {
  const { brief, analysis, model, seasonId, pinnedCharacters, visualContext, useVisualLearning, genre } = params;

  // Get learned patterns for this model
  const modelPatterns = await getTopModelPatterns(model, 5);

  // Get top vocabulary for this season (text-based)
  const vocabulary = await getTopVocabulary(seasonId, undefined, 15);

  // Get winning prompts for inspiration
  const winningPrompts = await getWinningPrompts(seasonId, model, 3);

  // Get visual vocabulary for this season (only if visual learning enabled)
  let visualVocab: Array<{ term: string; category: string }> = [];
  let visualPrompts: Array<{ prompt: string; similarity: number }> = [];

  if (useVisualLearning) {
    try {
      // Dynamically import to avoid circular dependencies
      const { getVisualVocabulary, getPromptsForVisualStyle } = await import('@/lib/visual-learning');

      // Get top visual terms
      visualVocab = await getVisualVocabulary(seasonId, undefined, 10);

      // If visual context provided, find prompts that created similar visuals
      if (visualContext && Object.keys(visualContext).length > 0) {
        visualPrompts = await getPromptsForVisualStyle(seasonId, visualContext, 3);
      }
    } catch {
      // Visual learning not available, continue without it
    }
  }

  // Build context for prompt generation
  const patternTexts = modelPatterns.map(p => p.pattern_text);
  const vocabTerms = vocabulary.map(v => v.term);
  const visualTerms = visualVocab.map(v => `${v.term} (${v.category})`);

  // Character context
  const characterContext = pinnedCharacters && pinnedCharacters.length > 0
    ? pinnedCharacters.map(c => c.label || c.character_description || 'character').join(', ')
    : null;

  // Visual context from analysis or provided
  const visualContextStr = visualContext
    ? Object.entries(visualContext)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
    : '';

  // Build the prompt using Claude
  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `Generate a ready-to-use video generation prompt for the following scene.

Scene Brief:
- Title: ${brief.brief_title}
- Description: ${brief.scene_description}
- Visual Requirements: ${brief.visual_requirements}
- Tone: ${brief.tone_guidance}

${analysis ? `Story Context:
- Setting: ${analysis.setting.location}, ${analysis.setting.atmosphere}
- Visual Style: ${analysis.visual_style}
- Tone: ${analysis.tone}` : ''}

${characterContext ? `Characters in scene: ${characterContext}` : ''}

AI Model: ${model}
Best text patterns for this model: ${patternTexts.join(', ') || 'none yet'}
Popular prompt terms in this season: ${vocabTerms.slice(0, 10).join(', ') || 'none yet'}

${visualTerms.length > 0 ? `Visual style patterns from winning clips:
${visualTerms.slice(0, 8).join(', ')}` : ''}

${visualContextStr ? `Target visual style: ${visualContextStr}` : ''}

${visualPrompts.length > 0 ? `Prompts that created similar visuals:
${visualPrompts.map(p => `- ${p.prompt}`).join('\n')}` : ''}

${winningPrompts.length > 0 ? `Example successful prompts:
${winningPrompts.map(p => `- ${p.prompt}`).join('\n')}` : ''}

${genre ? `Genre: ${genre}` : ''}

Write a short video prompt (20-40 words) that:
1. Starts with a camera movement and captures the scene
2. Matches the tone${genre ? ` of ${genre}` : ''} and uses strong action verbs
3. Is ready to paste directly into the AI video generator

Return ONLY the prompt text.`
      }]
    });

    const textContent = response.content.find(c => c.type === 'text');
    const generatedPrompt = textContent && textContent.type === 'text'
      ? textContent.text.trim()
      : buildFallbackPrompt(brief, model, patternTexts, visualTerms);

    return {
      prompt: generatedPrompt,
      based_on: {
        brief_title: brief.brief_title,
        scene_context: brief.scene_description,
        top_patterns: patternTexts,
        character_context: characterContext,
        visual_patterns: visualTerms.slice(0, 5),
        visual_prompts: visualPrompts.map(p => p.prompt),
      },
    };
  } catch (error) {
    console.error('[prompt-learning] Failed to generate smart prompt:', error);

    // Fallback: build prompt from brief directly
    return {
      prompt: buildFallbackPrompt(brief, model, patternTexts, visualTerms),
      based_on: {
        brief_title: brief.brief_title,
        scene_context: brief.scene_description,
        top_patterns: patternTexts,
        character_context: characterContext,
      },
    };
  }
}

/**
 * Build a fallback prompt when AI generation fails
 */
function buildFallbackPrompt(
  brief: CreativeBrief,
  model: string,
  patterns: string[],
  visualTerms: string[] = []
): string {
  const parts: string[] = [];

  // Add scene description
  parts.push(brief.scene_description);

  // Add visual requirements
  if (brief.visual_requirements) {
    parts.push(brief.visual_requirements);
  }

  // Add tone
  if (brief.tone_guidance) {
    parts.push(brief.tone_guidance);
  }

  // Add patterns if available
  if (patterns.length > 0) {
    parts.push(patterns.slice(0, 3).join(', '));
  }

  // Add visual terms if available
  if (visualTerms.length > 0) {
    parts.push(visualTerms.slice(0, 3).join(', '));
  }

  // Model-specific adjustments
  if (model.includes('kling')) {
    // Kling likes shot type prefixes
    if (!parts[0].toLowerCase().includes('shot')) {
      parts.unshift('cinematic shot,');
    }
  }

  return parts.join('. ').replace(/\.\./g, '.').trim();
}

// =============================================================================
// BATCH PROCESSING FOR MIGRATION
// =============================================================================

/**
 * Process existing prompts to extract scene elements
 * Run this once to populate scene_vocabulary from existing data
 */
export async function processExistingPrompts(
  batchSize: number = 50
): Promise<{ processed: number; errors: number }> {
  const supabase = getSupabase();
  let processed = 0;
  let errors = 0;

  // Get prompts without scene_elements
  const { data: prompts, error } = await supabase
    .from('prompt_history')
    .select('id, season_id, user_prompt, ai_model, vote_count, is_winner')
    .is('scene_elements', null)
    .limit(batchSize);

  if (error || !prompts) {
    console.error('[prompt-learning] Failed to fetch prompts for processing:', error);
    return { processed: 0, errors: 1 };
  }

  if (prompts.length === 0) {
    return { processed: 0, errors: 0 };
  }

  for (const prompt of prompts) {
    try {
      const elements = await extractSceneElements(prompt.user_prompt);

      if (elements) {
        // Update prompt_history with extracted elements
        await supabase
          .from('prompt_history')
          .update({ scene_elements: elements })
          .eq('id', prompt.id);

        // Update vocabulary
        await updateSceneVocabulary(
          prompt.season_id,
          elements,
          prompt.user_prompt,
          prompt.vote_count,
          prompt.is_winner
        );

        // Update model patterns
        await updateModelPatterns(
          prompt.ai_model,
          prompt.user_prompt,
          prompt.vote_count,
          prompt.is_winner
        );

        processed++;
      }
    } catch (e) {
      console.error('[prompt-learning] Error processing prompt:', e);
      errors++;
    }
  }

  return { processed, errors };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { EXTRACTION_MODEL };
