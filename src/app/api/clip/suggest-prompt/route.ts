// app/api/clip/suggest-prompt/route.ts
// Get AI-generated prompt suggestion based on current brief and learned patterns
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-client';
import { rateLimit } from '@/lib/rate-limit';
import { generateSmartPrompt } from '@/lib/prompt-learning';
import type { CreativeBrief, StoryAnalysis } from '@/lib/claude-director';

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
 * GET /api/clip/suggest-prompt
 * Get an AI-generated ready-to-use prompt for clip creation
 *
 * Query params:
 * - slotId: (optional) UUID of the slot - if not provided, uses current active slot
 * - model: (required) AI model name (e.g., 'kling-2.6', 'veo3-fast')
 */
export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'prompt_suggest');
  if (rateLimitResponse) return rateLimitResponse;

  // Check feature flags
  const promptLearningEnabled = await isFeatureEnabled('prompt_learning');
  const visualLearningEnabled = await isFeatureEnabled('visual_learning');
  const coDirectorEnabled = await isFeatureEnabled('ai_co_director');

  if (!promptLearningEnabled) {
    return NextResponse.json({
      ok: false,
      error: 'Prompt suggestions not enabled',
    }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const slotIdParam = searchParams.get('slotId');
  const model = searchParams.get('model');

  if (!model) {
    return NextResponse.json({
      ok: false,
      error: 'Model parameter is required',
    }, { status: 400 });
  }

  const supabase = getServiceClient();

  // Get active season (genre-aware for multi-genre)
  const genreParam = searchParams.get('genre')?.toLowerCase();
  let seasonQuery = supabase
    .from('seasons')
    .select('id, label')
    .eq('status', 'active');
  if (genreParam) {
    seasonQuery = seasonQuery.eq('genre', genreParam);
  }
  const { data: activeSeason } = await seasonQuery
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!activeSeason) {
    return NextResponse.json({
      ok: false,
      error: 'No active season',
    }, { status: 404 });
  }

  // Get current slot (either from param or find the active one)
  let slotId = slotIdParam;
  let slotPosition: number | null = null;

  if (!slotId) {
    // Find current active slot
    const { data: currentSlot } = await supabase
      .from('story_slots')
      .select('id, slot_position')
      .eq('season_id', activeSeason.id)
      .in('status', ['voting', 'waiting_for_clips'])
      .order('slot_position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (currentSlot) {
      slotId = currentSlot.id;
      slotPosition = currentSlot.slot_position;
    }
  } else {
    // Get slot position from provided ID
    const { data: slot } = await supabase
      .from('story_slots')
      .select('slot_position')
      .eq('id', slotId)
      .single();

    slotPosition = slot?.slot_position ?? null;
  }

  // Try to get the creative brief for this slot
  let brief: CreativeBrief | null = null;
  let analysis: StoryAnalysis | null = null;

  if (coDirectorEnabled && slotPosition !== null) {
    // Get published brief
    const { data: briefData } = await supabase
      .from('slot_briefs')
      .select(`
        brief_title,
        scene_description,
        visual_requirements,
        tone_guidance,
        continuity_notes,
        do_list,
        dont_list,
        example_prompts
      `)
      .eq('season_id', activeSeason.id)
      .eq('slot_position', slotPosition)
      .eq('status', 'published')
      .maybeSingle();

    if (briefData) {
      brief = {
        brief_title: briefData.brief_title,
        scene_description: briefData.scene_description,
        visual_requirements: briefData.visual_requirements,
        tone_guidance: briefData.tone_guidance,
        continuity_notes: briefData.continuity_notes || '',
        do_list: briefData.do_list || '',
        dont_list: briefData.dont_list || '',
        example_prompts: briefData.example_prompts || [],
      };
    }

    // Get story analysis if available
    const { data: analysisData } = await supabase
      .from('story_analyses')
      .select('analysis')
      .eq('season_id', activeSeason.id)
      .eq('slot_position', slotPosition)
      .maybeSingle();

    if (analysisData?.analysis) {
      analysis = analysisData.analysis as StoryAnalysis;
    }
  }

  // Get pinned characters for this season
  const { data: pinnedChars } = await supabase
    .from('pinned_characters')
    .select('label, frontal_image_url')
    .eq('season_id', activeSeason.id)
    .eq('is_active', true);

  const pinnedCharacters = pinnedChars?.map(c => ({
    label: c.label || '',
    frontal_image_url: c.frontal_image_url,
  })) || [];

  // Extract visual context from winning clips (when visual learning enabled)
  let visualContext: {
    lighting_mood?: string;
    setting?: string;
    aesthetic?: string;
    framing?: string;
  } | undefined;

  if (visualLearningEnabled) {
    // Get visual features from recent winning clips
    const { data: winningVisuals } = await supabase
      .from('clip_visuals')
      .select('features')
      .eq('season_id', activeSeason.id)
      .eq('is_winner', true)
      .order('vote_count', { ascending: false })
      .limit(5);

    if (winningVisuals && winningVisuals.length > 0) {
      // Extract dominant visual patterns from winners
      const features = winningVisuals.map(v => v.features).filter(Boolean);

      if (features.length > 0) {
        // Count frequency of each visual attribute
        const lightingMoods: Record<string, number> = {};
        const settings: Record<string, number> = {};
        const aesthetics: Record<string, number> = {};
        const framings: Record<string, number> = {};

        for (const f of features) {
          if (f.lighting?.mood) {
            lightingMoods[f.lighting.mood] = (lightingMoods[f.lighting.mood] || 0) + 1;
          }
          if (f.environment?.setting) {
            settings[f.environment.setting] = (settings[f.environment.setting] || 0) + 1;
          }
          if (f.style?.aesthetic) {
            aesthetics[f.style.aesthetic] = (aesthetics[f.style.aesthetic] || 0) + 1;
          }
          if (f.composition?.framing) {
            framings[f.composition.framing] = (framings[f.composition.framing] || 0) + 1;
          }
        }

        // Get most common values
        const getMostCommon = (counts: Record<string, number>): string | undefined => {
          const entries = Object.entries(counts);
          if (entries.length === 0) return undefined;
          return entries.sort((a, b) => b[1] - a[1])[0][0];
        };

        visualContext = {
          lighting_mood: getMostCommon(lightingMoods),
          setting: getMostCommon(settings),
          aesthetic: getMostCommon(aesthetics),
          framing: getMostCommon(framings),
        };
      }
    }
  }

  // If no brief is available, use co-director to generate story beat + prompt
  if (!brief) {
    const { getTopModelPatterns, getTopVocabulary } = await import('@/lib/prompt-learning');
    const { generateQuickStoryBeat } = await import('@/lib/claude-director');
    const Anthropic = (await import('@anthropic-ai/sdk')).default;

    const patterns = await getTopModelPatterns(model, 5);
    const vocabulary = await getTopVocabulary(activeSeason.id, undefined, 15);

    const patternTexts = patterns.map(p => p.pattern_text);
    const vocabTerms = vocabulary.map(v => v.term);

    // Get the last locked clips for story continuity
    const { data: previousClips } = await supabase
      .from('tournament_clips')
      .select('slot_position, ai_prompt, title')
      .eq('season_id', activeSeason.id)
      .in('status', ['winner', 'locked'])
      .not('slot_position', 'is', null)
      .order('slot_position', { ascending: false })
      .limit(7);

    // Format clips for story beat generator
    const clipsForBeat = (previousClips || []).map(c => ({
      slot_position: c.slot_position,
      prompt: c.ai_prompt || c.title || 'Unknown scene',
    }));

    // Character context
    const characterContext = pinnedCharacters.length > 0
      ? pinnedCharacters.map(c => c.label).join(', ')
      : null;
    const characterList = pinnedCharacters.map(c => c.label).filter(Boolean);

    // Generate story beat using co-director (what should happen next)
    const storyBeatResult = await generateQuickStoryBeat(
      clipsForBeat,
      characterList.length > 0 ? characterList : undefined,
      10 // total slots estimate
    );

    const storyBeat = storyBeatResult.ok ? storyBeatResult.beat : null;

    // Get visual vocabulary if enabled
    let visualTerms: string[] = [];
    if (visualLearningEnabled) {
      try {
        const { getVisualVocabulary } = await import('@/lib/visual-learning');
        const visualVocab = await getVisualVocabulary(activeSeason.id, undefined, 10);
        visualTerms = visualVocab.map(v => `${v.term} (${v.category})`);
      } catch {
        // Visual learning not available
      }
    }

    // Build context from last clip
    const lastClip = previousClips?.[0];
    const lastClipContext = lastClip
      ? `LAST SCENE (Slot ${lastClip.slot_position}): "${lastClip.ai_prompt || lastClip.title}"`
      : '';

    // Use Claude to generate prompt based on story beat
    let generatedPrompt = 'cinematic scene with dramatic lighting';

    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        const anthropic = new Anthropic({ apiKey });
        const response = await anthropic.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: `Generate a video prompt for the NEXT scene in this story.

${lastClipContext}

${storyBeat ? `CO-DIRECTOR'S GUIDANCE FOR NEXT SCENE:
- What happens: ${storyBeat.next_action}
- Scene description: ${storyBeat.scene_description}
- Must include: ${storyBeat.key_elements.join(', ')}
- Avoid: ${storyBeat.avoid.join(', ')}` : 'Advance the story with something new happening.'}

${characterContext ? `Main characters: ${characterContext}` : ''}
AI Model: ${model}
${visualTerms.length > 0 ? `Visual style: ${visualTerms.slice(0, 5).join(', ')}` : ''}
${patternTexts.length > 0 ? `Prompt patterns: ${patternTexts.slice(0, 3).join(', ')}` : ''}

Write a video prompt (50-80 words) that:
1. Follows the co-director's guidance for what happens next
2. Uses the SAME characters (same gender, same appearance)
3. ADVANCES the story - don't just continue the same action
4. Matches the visual style

Return ONLY the prompt text.`
          }]
        });

        const textContent = response.content.find(c => c.type === 'text');
        if (textContent && textContent.type === 'text') {
          generatedPrompt = textContent.text.trim();
        }
      }
    } catch (err) {
      console.warn('[suggest-prompt] Failed to generate smart prompt:', err);
      // Fall back to simple concatenation
      if (patternTexts.length > 0 || vocabTerms.length > 0) {
        generatedPrompt = [...patternTexts, ...vocabTerms.slice(0, 5)].join(', ');
      }
    }

    return NextResponse.json({
      ok: true,
      has_brief: false,
      auto_directed: true,
      prompt: generatedPrompt,
      based_on: {
        brief_title: null,
        last_scene: lastClip?.ai_prompt || null,
        last_slot: lastClip?.slot_position || null,
        previous_slots: previousClips?.length || 0,
        visual_patterns: visualTerms.slice(0, 5),
        character_context: characterContext,
      },
      story_beat: storyBeat ? {
        next_action: storyBeat.next_action,
        scene_description: storyBeat.scene_description,
        key_elements: storyBeat.key_elements,
        avoid: storyBeat.avoid,
      } : null,
    });
  }

  // Generate smart prompt using brief + learned patterns
  // When visual_learning flag is enabled, also incorporate visual patterns
  const suggestion = await generateSmartPrompt({
    brief,
    analysis: analysis || undefined,
    model,
    seasonId: activeSeason.id,
    pinnedCharacters: pinnedCharacters.length > 0 ? pinnedCharacters : undefined,
    useVisualLearning: visualLearningEnabled,
    visualContext,
  });

  return NextResponse.json({
    ok: true,
    has_brief: true,
    slot_position: slotPosition,
    prompt: suggestion.prompt,
    based_on: suggestion.based_on,
  });
}
