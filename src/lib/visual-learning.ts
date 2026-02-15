// lib/visual-learning.ts
// Visual Learning System: Analyzes video frames to learn visual patterns
// Uses Claude Vision to extract visual features, combined with prompt learning
// Server-only — never import from client code

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Use Haiku for fast, cheap visual analysis
const VISION_MODEL = 'claude-3-haiku-20240307';

// Runtime client factories (avoid module-load time env var issues in serverless)
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }
  return new Anthropic({ apiKey });
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

// =============================================================================
// TYPES
// =============================================================================

export interface VisualFeatures {
  // Scene composition
  composition: {
    framing: string;           // "close-up", "wide shot", "medium shot"
    angle: string;             // "eye level", "low angle", "high angle", "dutch angle"
    depth: string;             // "shallow", "deep", "flat"
  };

  // Lighting
  lighting: {
    type: string;              // "natural", "artificial", "mixed"
    direction: string;         // "front", "back", "side", "top", "ambient"
    quality: string;           // "soft", "hard", "diffused"
    mood: string;              // "bright", "dark", "moody", "dramatic", "warm", "cool"
  };

  // Colors
  colors: {
    dominant: string[];        // Top 3 dominant colors
    palette_type: string;      // "monochromatic", "complementary", "analogous", "warm", "cool"
    saturation: string;        // "vibrant", "muted", "desaturated"
    contrast: string;          // "high", "medium", "low"
  };

  // Environment
  environment: {
    setting: string;           // "indoor", "outdoor", "urban", "nature", "abstract"
    time_of_day: string;       // "day", "night", "dawn", "dusk", "unknown"
    weather: string | null;    // "clear", "cloudy", "rain", "fog", etc.
    location_type: string;     // "city", "forest", "office", "home", etc.
  };

  // Motion (inferred from frame)
  motion: {
    implied_movement: string;  // "static", "slow", "dynamic", "fast"
    camera_motion: string;     // "static", "pan", "tilt", "tracking", "unknown"
  };

  // Subjects
  subjects: {
    has_people: boolean;
    people_count: number;
    has_animals: boolean;
    has_text: boolean;
    main_focus: string;        // Brief description of main subject
  };

  // Style
  style: {
    genre: string;             // "cinematic", "documentary", "animation", "abstract"
    aesthetic: string;         // "realistic", "stylized", "artistic", "minimalist"
    era: string;               // "modern", "vintage", "futuristic", "timeless"
  };

  // Raw description for embeddings/matching
  description: string;
}

export interface ClipVisualData {
  clip_id: string;
  thumbnail_url: string;
  features: VisualFeatures;
  prompt_used?: string;
  vote_count: number;
  is_winner: boolean;
}

export interface VisualSimilarityResult {
  clip_id: string;
  thumbnail_url: string;
  similarity_score: number;
  matching_features: string[];
  prompt_used?: string;
  vote_count: number;
}

// =============================================================================
// MULTI-FRAME VIDEO EXTRACTION
// =============================================================================

// Number of frames to sample from each video (0%, 25%, 50%, 75%, 100%)
const FRAMES_TO_SAMPLE = 5;

/**
 * Extract multiple frames from a video at evenly spaced intervals
 * Returns array of base64-encoded JPEG images
 */
export async function extractFramesFromVideo(
  videoUrl: string,
  numFrames: number = FRAMES_TO_SAMPLE
): Promise<{ frames: string[]; duration: number } | null> {
  const { execFile } = await import('child_process');
  const { writeFile, readFile, unlink } = await import('fs/promises');
  const { tmpdir } = await import('os');
  const path = await import('path');
  const { promisify } = await import('util');

  const execFileAsync = promisify(execFile);
  const clipId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = path.join(tmpdir(), `${clipId}_input.mp4`);
  const frames: string[] = [];
  const framePaths: string[] = [];

  try {
    // 1. Download video
    console.log(`[visual-learning] Downloading video: ${videoUrl.slice(0, 80)}...`);
    const videoRes = await fetch(videoUrl, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!videoRes.ok) {
      console.error('[visual-learning] Failed to download video:', videoRes.status);
      return null;
    }

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    await writeFile(inputPath, videoBuffer);

    // 2. Get video duration using ffprobe
    const ffmpegPath = (await import('ffmpeg-static')).default;
    if (!ffmpegPath) {
      console.error('[visual-learning] ffmpeg binary not found');
      return null;
    }

    // Get duration
    let duration = 8; // Default fallback
    try {
      const { stdout } = await execFileAsync(ffmpegPath, [
        '-i', inputPath,
        '-f', 'null',
        '-'
      ], { timeout: 30000 }).catch(() => ({ stdout: '', stderr: '' }));

      // Try to parse duration from ffmpeg output (it goes to stderr)
      // Fallback: use fixed timestamps
    } catch {
      // Duration detection failed, use default
    }

    // 3. Extract frames at percentage intervals (0%, 25%, 50%, 75%, 100%)
    const percentages = Array.from({ length: numFrames }, (_, i) => i / (numFrames - 1));

    for (let i = 0; i < numFrames; i++) {
      const timestamp = percentages[i] * duration;
      const outputPath = path.join(tmpdir(), `${clipId}_frame_${i}.jpg`);
      framePaths.push(outputPath);

      try {
        await execFileAsync(ffmpegPath, [
          '-ss', timestamp.toFixed(2),
          '-i', inputPath,
          '-frames:v', '1',
          '-q:v', '2',
          '-y',
          outputPath,
        ], { timeout: 15000 });

        const frameData = await readFile(outputPath);
        if (frameData.length > 0) {
          frames.push(frameData.toString('base64'));
        }
      } catch (err) {
        console.warn(`[visual-learning] Failed to extract frame at ${timestamp}s:`, err);
        // Continue with other frames
      }
    }

    console.log(`[visual-learning] Extracted ${frames.length}/${numFrames} frames`);
    return frames.length > 0 ? { frames, duration } : null;

  } catch (error) {
    console.error('[visual-learning] Frame extraction failed:', error);
    return null;
  } finally {
    // Cleanup temp files
    await unlink(inputPath).catch(() => {});
    for (const fp of framePaths) {
      await unlink(fp).catch(() => {});
    }
  }
}

/**
 * Analyze a single frame (base64) using Claude Vision
 */
async function analyzeFrame(base64Image: string): Promise<VisualFeatures | null> {
  try {
    const response = await getAnthropicClient().messages.create({
      model: VISION_MODEL,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: `Analyze this video frame and extract visual features. Return ONLY valid JSON matching this structure:

{
  "composition": {
    "framing": "close-up|medium shot|wide shot|extreme close-up|full shot",
    "angle": "eye level|low angle|high angle|dutch angle|overhead|worm's eye",
    "depth": "shallow|deep|flat"
  },
  "lighting": {
    "type": "natural|artificial|mixed",
    "direction": "front|back|side|top|ambient|rim",
    "quality": "soft|hard|diffused",
    "mood": "bright|dark|moody|dramatic|warm|cool|neutral"
  },
  "colors": {
    "dominant": ["color1", "color2", "color3"],
    "palette_type": "monochromatic|complementary|analogous|triadic|warm|cool|neutral",
    "saturation": "vibrant|muted|desaturated",
    "contrast": "high|medium|low"
  },
  "environment": {
    "setting": "indoor|outdoor|urban|nature|abstract|space|underwater",
    "time_of_day": "day|night|dawn|dusk|golden hour|blue hour|unknown",
    "weather": "clear|cloudy|rain|fog|snow|storm|null",
    "location_type": "brief description of location"
  },
  "motion": {
    "implied_movement": "static|slow|dynamic|fast|chaotic",
    "camera_motion": "static|pan|tilt|tracking|dolly|zoom|handheld|unknown"
  },
  "subjects": {
    "has_people": true|false,
    "people_count": 0,
    "has_animals": true|false,
    "has_text": true|false,
    "main_focus": "brief description of main subject"
  },
  "style": {
    "genre": "cinematic|documentary|animation|abstract|vfx|live-action",
    "aesthetic": "realistic|stylized|artistic|minimalist|surreal|retro",
    "era": "modern|vintage|futuristic|timeless|period"
  },
  "description": "One sentence describing the overall visual impression"
}`,
          },
        ],
      }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return null;
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    return JSON.parse(jsonMatch[0]) as VisualFeatures;
  } catch (error) {
    console.error('[visual-learning] Frame analysis failed:', error);
    return null;
  }
}

/**
 * Combine features from multiple frames into a single comprehensive profile
 */
function combineFrameFeatures(featuresArray: VisualFeatures[]): VisualFeatures {
  if (featuresArray.length === 0) {
    throw new Error('No features to combine');
  }

  if (featuresArray.length === 1) {
    return featuresArray[0];
  }

  // Helper: get most common value from array
  const mostCommon = <T>(arr: T[]): T => {
    const counts = new Map<T, number>();
    for (const item of arr) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    let maxCount = 0;
    let result = arr[0];
    for (const [item, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        result = item;
      }
    }
    return result;
  };

  // Helper: merge arrays and get unique values, sorted by frequency
  const mergeArrays = (arrays: string[][]): string[] => {
    const counts = new Map<string, number>();
    for (const arr of arrays) {
      for (const item of arr) {
        const normalized = item.toLowerCase();
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5) // Top 5 colors across all frames
      .map(([color]) => color);
  };

  // Combine all features using most common values
  const combined: VisualFeatures = {
    composition: {
      framing: mostCommon(featuresArray.map(f => f.composition.framing)),
      angle: mostCommon(featuresArray.map(f => f.composition.angle)),
      depth: mostCommon(featuresArray.map(f => f.composition.depth)),
    },
    lighting: {
      type: mostCommon(featuresArray.map(f => f.lighting.type)),
      direction: mostCommon(featuresArray.map(f => f.lighting.direction)),
      quality: mostCommon(featuresArray.map(f => f.lighting.quality)),
      mood: mostCommon(featuresArray.map(f => f.lighting.mood)),
    },
    colors: {
      dominant: mergeArrays(featuresArray.map(f => f.colors.dominant)),
      palette_type: mostCommon(featuresArray.map(f => f.colors.palette_type)),
      saturation: mostCommon(featuresArray.map(f => f.colors.saturation)),
      contrast: mostCommon(featuresArray.map(f => f.colors.contrast)),
    },
    environment: {
      setting: mostCommon(featuresArray.map(f => f.environment.setting)),
      time_of_day: mostCommon(featuresArray.map(f => f.environment.time_of_day)),
      weather: mostCommon(featuresArray.map(f => f.environment.weather).filter(Boolean)) || null,
      location_type: mostCommon(featuresArray.map(f => f.environment.location_type)),
    },
    motion: {
      implied_movement: mostCommon(featuresArray.map(f => f.motion.implied_movement)),
      camera_motion: mostCommon(featuresArray.map(f => f.motion.camera_motion)),
    },
    subjects: {
      has_people: featuresArray.some(f => f.subjects.has_people),
      people_count: Math.max(...featuresArray.map(f => f.subjects.people_count)),
      has_animals: featuresArray.some(f => f.subjects.has_animals),
      has_text: featuresArray.some(f => f.subjects.has_text),
      main_focus: mostCommon(featuresArray.map(f => f.subjects.main_focus)),
    },
    style: {
      genre: mostCommon(featuresArray.map(f => f.style.genre)),
      aesthetic: mostCommon(featuresArray.map(f => f.style.aesthetic)),
      era: mostCommon(featuresArray.map(f => f.style.era)),
    },
    description: featuresArray.map(f => f.description).join(' | '),
  };

  return combined;
}

/**
 * Extract visual features from a video by sampling multiple frames
 * This is the main entry point for video-based visual learning
 */
export async function extractVisualFeaturesFromVideo(
  videoUrl: string,
  numFrames: number = FRAMES_TO_SAMPLE
): Promise<VisualFeatures | null> {
  console.log(`[visual-learning] Analyzing video with ${numFrames} frames: ${videoUrl.slice(0, 60)}...`);

  // 1. Extract frames from video
  const extraction = await extractFramesFromVideo(videoUrl, numFrames);
  if (!extraction || extraction.frames.length === 0) {
    console.error('[visual-learning] No frames extracted from video');
    return null;
  }

  // 2. Analyze each frame
  const featurePromises = extraction.frames.map((frame, i) => {
    console.log(`[visual-learning] Analyzing frame ${i + 1}/${extraction.frames.length}...`);
    return analyzeFrame(frame);
  });

  const allFeatures = await Promise.all(featurePromises);
  const validFeatures = allFeatures.filter((f): f is VisualFeatures => f !== null);

  console.log(`[visual-learning] Successfully analyzed ${validFeatures.length}/${extraction.frames.length} frames`);

  if (validFeatures.length === 0) {
    console.error('[visual-learning] No frames were successfully analyzed');
    return null;
  }

  // 3. Combine features from all frames
  const combined = combineFrameFeatures(validFeatures);
  console.log(`[visual-learning] Combined features from ${validFeatures.length} frames`);

  return combined;
}

// =============================================================================
// VISUAL FEATURE EXTRACTION (Single Image)
// =============================================================================

/**
 * Analyze a frame/thumbnail using Claude Vision to extract visual features
 * For single images/thumbnails - use extractVisualFeaturesFromVideo for videos
 */
export async function extractVisualFeatures(imageUrl: string): Promise<VisualFeatures | null> {
  try {
    // Fetch image and convert to base64
    const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imageResponse.ok) {
      console.error('[visual-learning] Failed to fetch image:', imageUrl);
      return null;
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    // Validate content type
    const mediaType = contentType.split(';')[0].trim();
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
      console.error('[visual-learning] Unsupported image type:', mediaType);
      return null;
    }

    const response = await getAnthropicClient().messages.create({
      model: VISION_MODEL,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: `Analyze this video frame and extract visual features. Return ONLY valid JSON matching this structure:

{
  "composition": {
    "framing": "close-up|medium shot|wide shot|extreme close-up|full shot",
    "angle": "eye level|low angle|high angle|dutch angle|overhead|worm's eye",
    "depth": "shallow|deep|flat"
  },
  "lighting": {
    "type": "natural|artificial|mixed",
    "direction": "front|back|side|top|ambient|rim",
    "quality": "soft|hard|diffused",
    "mood": "bright|dark|moody|dramatic|warm|cool|neutral"
  },
  "colors": {
    "dominant": ["color1", "color2", "color3"],
    "palette_type": "monochromatic|complementary|analogous|triadic|warm|cool|neutral",
    "saturation": "vibrant|muted|desaturated",
    "contrast": "high|medium|low"
  },
  "environment": {
    "setting": "indoor|outdoor|urban|nature|abstract|space|underwater",
    "time_of_day": "day|night|dawn|dusk|golden hour|blue hour|unknown",
    "weather": "clear|cloudy|rain|fog|snow|storm|null",
    "location_type": "brief description of location"
  },
  "motion": {
    "implied_movement": "static|slow|dynamic|fast|chaotic",
    "camera_motion": "static|pan|tilt|tracking|dolly|zoom|handheld|unknown"
  },
  "subjects": {
    "has_people": true|false,
    "people_count": 0,
    "has_animals": true|false,
    "has_text": true|false,
    "main_focus": "brief description of main subject"
  },
  "style": {
    "genre": "cinematic|documentary|animation|abstract|vfx|live-action",
    "aesthetic": "realistic|stylized|artistic|minimalist|surreal|retro",
    "era": "modern|vintage|futuristic|timeless|period"
  },
  "description": "One sentence describing the overall visual impression"
}`,
          },
        ],
      }],
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

    return JSON.parse(jsonMatch[0]) as VisualFeatures;
  } catch (error) {
    console.error('[visual-learning] Failed to extract visual features:', error);
    return null;
  }
}

// =============================================================================
// VISUAL DATA STORAGE
// =============================================================================

/**
 * Store visual features for a clip
 */
export async function storeClipVisuals(params: {
  clipId: string;
  seasonId: string;
  thumbnailUrl: string;
  features: VisualFeatures;
  promptUsed?: string;
  voteCount?: number;
  isWinner?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('clip_visuals')
      .upsert({
        clip_id: params.clipId,
        season_id: params.seasonId,
        thumbnail_url: params.thumbnailUrl,
        features: params.features,
        prompt_used: params.promptUsed || null,
        vote_count: params.voteCount || 0,
        is_winner: params.isWinner || false,
      }, {
        onConflict: 'clip_id',
      });

    if (error) {
      console.error('[visual-learning] Failed to store clip visuals:', error);
      return { ok: false, error: 'Failed to store visual data' };
    }

    // Also update visual vocabulary
    await updateVisualVocabulary(params.seasonId, params.features, params.voteCount || 0, params.isWinner || false);

    return { ok: true };
  } catch (error) {
    console.error('[visual-learning] Error storing clip visuals:', error);
    return { ok: false, error: 'Internal error' };
  }
}

/**
 * Update visual vocabulary based on extracted features
 */
async function updateVisualVocabulary(
  seasonId: string,
  features: VisualFeatures,
  voteCount: number,
  isWinner: boolean
): Promise<void> {
  const supabase = getSupabaseClient();

  // Extract vocabulary terms from features
  const terms: Array<{ category: string; term: string }> = [];

  // Composition terms
  terms.push({ category: 'framing', term: features.composition.framing });
  terms.push({ category: 'camera_angle', term: features.composition.angle });

  // Lighting terms
  terms.push({ category: 'lighting_mood', term: features.lighting.mood });
  terms.push({ category: 'lighting_quality', term: features.lighting.quality });

  // Color terms
  for (const color of features.colors.dominant) {
    terms.push({ category: 'color', term: color.toLowerCase() });
  }
  terms.push({ category: 'color_palette', term: features.colors.palette_type });

  // Environment terms
  terms.push({ category: 'setting', term: features.environment.setting });
  if (features.environment.time_of_day !== 'unknown') {
    terms.push({ category: 'time', term: features.environment.time_of_day });
  }
  if (features.environment.weather) {
    terms.push({ category: 'weather', term: features.environment.weather });
  }

  // Motion terms
  terms.push({ category: 'motion', term: features.motion.implied_movement });
  if (features.motion.camera_motion !== 'unknown') {
    terms.push({ category: 'camera_motion', term: features.motion.camera_motion });
  }

  // Style terms
  terms.push({ category: 'genre', term: features.style.genre });
  terms.push({ category: 'aesthetic', term: features.style.aesthetic });

  // Upsert each term into visual_vocabulary
  for (const { category, term } of terms) {
    if (!term || term.length < 2) continue;

    await supabase.rpc('upsert_visual_vocabulary', {
      p_season_id: seasonId,
      p_term: term.toLowerCase().trim(),
      p_category: category,
      p_vote_count: voteCount,
      p_is_winner: isWinner,
    });
  }
}

// =============================================================================
// VISUAL SIMILARITY MATCHING
// =============================================================================

/**
 * Calculate similarity score between two visual feature sets
 * Uses weighted scoring where more visually important features count more
 */
function calculateVisualSimilarity(
  features1: VisualFeatures,
  features2: VisualFeatures
): { score: number; matching: string[] } {
  const matching: string[] = [];
  let weightedScore = 0;
  let totalWeight = 0;

  // Helper function to add a weighted comparison
  const compare = (
    value1: string | boolean | undefined | null,
    value2: string | boolean | undefined | null,
    weight: number,
    label?: string
  ) => {
    totalWeight += weight;
    if (value1 === value2 && value1 !== undefined && value1 !== null && value1 !== 'unknown') {
      weightedScore += weight;
      if (label) matching.push(label);
      return true;
    }
    return false;
  };

  // Composition matches (high importance for visual style)
  compare(features1.composition.framing, features2.composition.framing, 2.0,
    `framing: ${features1.composition.framing}`);
  compare(features1.composition.angle, features2.composition.angle, 1.5,
    `angle: ${features1.composition.angle}`);
  compare(features1.composition.depth, features2.composition.depth, 1.0);

  // Lighting matches (very important for mood)
  compare(features1.lighting.mood, features2.lighting.mood, 2.5,
    `lighting: ${features1.lighting.mood}`);
  compare(features1.lighting.type, features2.lighting.type, 1.0);
  compare(features1.lighting.quality, features2.lighting.quality, 1.0);
  compare(features1.lighting.direction, features2.lighting.direction, 0.5);

  // Color matches (important for visual coherence)
  const colorOverlap = features1.colors.dominant.filter(c =>
    features2.colors.dominant.some(c2 => c2.toLowerCase() === c.toLowerCase())
  );
  totalWeight += 2.0; // Weight for color matching
  if (colorOverlap.length > 0) {
    const colorScore = (colorOverlap.length / 3) * 2.0; // Up to 2.0 points
    weightedScore += colorScore;
    matching.push(`colors: ${colorOverlap.join(', ')}`);
  }
  compare(features1.colors.palette_type, features2.colors.palette_type, 1.5,
    `palette: ${features1.colors.palette_type}`);
  compare(features1.colors.saturation, features2.colors.saturation, 0.5);
  compare(features1.colors.contrast, features2.colors.contrast, 0.5);

  // Environment matches (important for setting)
  compare(features1.environment.setting, features2.environment.setting, 2.0,
    `setting: ${features1.environment.setting}`);
  compare(features1.environment.time_of_day, features2.environment.time_of_day, 1.5,
    `time: ${features1.environment.time_of_day}`);
  if (features1.environment.weather && features2.environment.weather) {
    compare(features1.environment.weather, features2.environment.weather, 1.0,
      `weather: ${features1.environment.weather}`);
  }

  // Motion matches (important for video feel)
  compare(features1.motion.implied_movement, features2.motion.implied_movement, 1.5,
    `motion: ${features1.motion.implied_movement}`);
  compare(features1.motion.camera_motion, features2.motion.camera_motion, 1.0);

  // Style matches (high importance for overall aesthetic)
  compare(features1.style.genre, features2.style.genre, 2.0,
    `genre: ${features1.style.genre}`);
  compare(features1.style.aesthetic, features2.style.aesthetic, 2.0,
    `aesthetic: ${features1.style.aesthetic}`);
  compare(features1.style.era, features2.style.era, 1.0);

  // Subject matches (context dependent)
  compare(features1.subjects.has_people, features2.subjects.has_people, 1.0);
  compare(features1.subjects.has_animals, features2.subjects.has_animals, 0.5);

  // Calculate normalized score (0-1 range)
  const normalizedScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

  return {
    score: normalizedScore,
    matching,
  };
}

/**
 * Find clips with similar visual features
 */
export async function findVisuallySimilarClips(
  targetFeatures: VisualFeatures,
  seasonId: string,
  limit: number = 5
): Promise<VisualSimilarityResult[]> {
  const supabase = getSupabaseClient();

  // Get all clip visuals for this season
  const { data: clips, error } = await supabase
    .from('clip_visuals')
    .select('clip_id, thumbnail_url, features, prompt_used, vote_count')
    .eq('season_id', seasonId);

  if (error || !clips) {
    console.error('[visual-learning] Failed to fetch clips:', error);
    return [];
  }

  // Calculate similarity for each clip
  const results: VisualSimilarityResult[] = [];

  for (const clip of clips) {
    const { score, matching } = calculateVisualSimilarity(
      targetFeatures,
      clip.features as VisualFeatures
    );

    if (score > 0.3) { // Only include clips with >30% similarity
      results.push({
        clip_id: clip.clip_id,
        thumbnail_url: clip.thumbnail_url,
        similarity_score: score,
        matching_features: matching,
        prompt_used: clip.prompt_used || undefined,
        vote_count: clip.vote_count,
      });
    }
  }

  // Sort by similarity score and return top results
  return results
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, limit);
}

/**
 * Find clips similar to a given image URL
 */
export async function findSimilarToImage(
  imageUrl: string,
  seasonId: string,
  limit: number = 5
): Promise<VisualSimilarityResult[]> {
  // Extract features from the target image
  const features = await extractVisualFeatures(imageUrl);
  if (!features) {
    return [];
  }

  return findVisuallySimilarClips(features, seasonId, limit);
}

// =============================================================================
// VISUAL VOCABULARY
// =============================================================================

/**
 * Get top visual vocabulary terms for a season
 * Uses Bayesian scoring for statistically sound ranking
 */
export async function getVisualVocabulary(
  seasonId: string,
  category?: string,
  limit: number = 10
): Promise<Array<{ term: string; category: string; frequency: number; avg_vote_score: number }>> {
  const supabase = getSupabaseClient();

  // Try Bayesian scored view first
  let query = supabase
    .from('visual_vocabulary_scored')
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
      .from('visual_vocabulary')
      .select('term, category, frequency, avg_vote_score')
      .eq('season_id', seasonId)
      .order('avg_vote_score', { ascending: false })
      .limit(limit);

    if (category) {
      fallbackQuery = fallbackQuery.eq('category', category);
    }

    const { data: fallbackData, error: fallbackError } = await fallbackQuery;

    if (fallbackError) {
      console.error('[visual-learning] Failed to get vocabulary:', fallbackError);
      return [];
    }

    return fallbackData || [];
  }

  return data || [];
}

/**
 * Get prompts that produced specific visual features
 */
export async function getPromptsForVisualStyle(
  seasonId: string,
  targetFeatures: Partial<{
    lighting_mood: string;
    setting: string;
    aesthetic: string;
    framing: string;
  }>,
  limit: number = 5
): Promise<Array<{ prompt: string; vote_count: number; similarity: number }>> {
  const supabase = getSupabaseClient();

  // Build filters based on target features
  const { data: clips, error } = await supabase
    .from('clip_visuals')
    .select('prompt_used, vote_count, features')
    .eq('season_id', seasonId)
    .not('prompt_used', 'is', null)
    .order('vote_count', { ascending: false })
    .limit(50);

  if (error || !clips) {
    return [];
  }

  // Score clips based on feature matches
  const scoredClips: Array<{ prompt: string; vote_count: number; similarity: number }> = [];

  for (const clip of clips) {
    if (!clip.prompt_used) continue;

    const features = clip.features as VisualFeatures;
    let matchScore = 0;
    let checks = 0;

    if (targetFeatures.lighting_mood) {
      checks++;
      if (features.lighting.mood === targetFeatures.lighting_mood) matchScore++;
    }
    if (targetFeatures.setting) {
      checks++;
      if (features.environment.setting === targetFeatures.setting) matchScore++;
    }
    if (targetFeatures.aesthetic) {
      checks++;
      if (features.style.aesthetic === targetFeatures.aesthetic) matchScore++;
    }
    if (targetFeatures.framing) {
      checks++;
      if (features.composition.framing === targetFeatures.framing) matchScore++;
    }

    if (checks > 0 && matchScore > 0) {
      scoredClips.push({
        prompt: clip.prompt_used,
        vote_count: clip.vote_count,
        similarity: matchScore / checks,
      });
    }
  }

  return scoredClips
    .sort((a, b) => (b.similarity * b.vote_count) - (a.similarity * a.vote_count))
    .slice(0, limit);
}

// =============================================================================
// BATCH PROCESSING
// =============================================================================

/**
 * Process existing clips to extract visual features
 * Run this to build visual vocabulary from existing data
 * Automatically handles both image thumbnails and video URLs (extracts 5 frames)
 */
export async function processExistingClipVisuals(
  batchSize: number = 10
): Promise<{ processed: number; errors: number }> {
  const supabase = getSupabaseClient();
  let processed = 0;
  let errors = 0;

  // Step 1: Get IDs of clips already processed
  const { data: processedClips } = await supabase
    .from('clip_visuals')
    .select('clip_id');

  const processedIds = (processedClips || []).map(c => c.clip_id);
  console.log(`[visual-learning] Already processed: ${processedIds.length} clips`);

  // Step 2: Get winner clips that haven't been processed yet
  let query = supabase
    .from('tournament_clips')
    .select(`
      id,
      season_id,
      thumbnail_url,
      video_url,
      ai_prompt,
      vote_count,
      status
    `)
    .in('status', ['winner', 'locked']) // Only analyze winner clips
    .not('thumbnail_url', 'is', null)
    .not('season_id', 'is', null);

  // Exclude already processed clips
  if (processedIds.length > 0) {
    query = query.not('id', 'in', `(${processedIds.join(',')})`);
  }

  const { data: clips, error } = await query.limit(batchSize);

  if (error || !clips) {
    console.error('[visual-learning] Failed to fetch clips:', error);
    return { processed: 0, errors: 1 };
  }

  console.log(`[visual-learning] Found ${clips.length} unprocessed clips`);

  for (const clip of clips) {

    try {
      // Determine if thumbnail is actually a video URL
      const isVideoUrl = clip.thumbnail_url === clip.video_url ||
        clip.thumbnail_url.endsWith('.mp4') ||
        clip.thumbnail_url.endsWith('.webm') ||
        clip.thumbnail_url.endsWith('.mov');

      let features: VisualFeatures | null = null;

      if (isVideoUrl) {
        // Use multi-frame video extraction (5 frames)
        console.log(`[visual-learning] Processing video clip ${clip.id} with multi-frame extraction...`);
        features = await extractVisualFeaturesFromVideo(clip.thumbnail_url, FRAMES_TO_SAMPLE);
      } else {
        // Use single image extraction
        console.log(`[visual-learning] Processing image thumbnail for clip ${clip.id}...`);
        features = await extractVisualFeatures(clip.thumbnail_url);
      }

      if (features) {
        const seasonId = clip.season_id;
        if (!seasonId) continue;

        await storeClipVisuals({
          clipId: clip.id,
          seasonId,
          thumbnailUrl: clip.thumbnail_url,
          features,
          promptUsed: clip.ai_prompt || undefined,
          voteCount: clip.vote_count,
          isWinner: clip.status === 'winner',
        });

        processed++;
        console.log(`[visual-learning] Successfully processed clip ${clip.id} (${processed}/${clips.length})`);
      } else {
        console.warn(`[visual-learning] No features extracted for clip ${clip.id}`);
        errors++;
      }
    } catch (e) {
      console.error('[visual-learning] Error processing clip:', e);
      errors++;
    }

    // Delay between clips to avoid rate limits (longer for video processing)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return { processed, errors };
}

// =============================================================================
// EXPORTS
// =============================================================================

export { VISION_MODEL, FRAMES_TO_SAMPLE };
