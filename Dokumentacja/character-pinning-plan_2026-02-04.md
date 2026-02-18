# Character Pinning System - Implementation Plan

**Created:** 2026-02-04
**Status:** Planned (not yet implemented)
**Depends on:** Kling O1 Reference-to-Video API via fal.ai

---

## Summary

Pin character appearances so every AI-generated clip in a story maintains the same character look. Uses Kling O1's **Reference-to-Video** mode which accepts element references (frontal + multi-angle images) and maintains character identity throughout generated video — unlike image-to-video which only controls the starting frame.

---

## Existing Infrastructure We Reuse

The codebase already has everything needed for frame extraction and storage:

| Component | File | What we reuse |
|---|---|---|
| **ffmpeg extraction** | `src/app/api/internal/extract-frame/route.ts` | Same `ffmpeg-static` + `execFileAsync` pattern. Change `-sseof -0.1` to `-ss {timestamp}` for arbitrary frame times |
| **Frame upload** | `src/lib/storage/frame-upload.ts` | `uploadFrame(clipId, jpegBuffer, provider)` — handles Supabase and R2 with cache headers. Extend with a new `uploadPinnedFrame()` that uses path `pinned/{seasonId}/{elementIndex}.jpg` |
| **Storage provider** | `src/lib/storage/index.ts` | `getStorageProvider()` — auto-detects Supabase vs R2 based on feature flag |
| **Image URL validation** | `src/app/api/ai/generate/route.ts` (lines 183-213) | Already validates `image_url` hostname matches Supabase/R2 — pinned frame URLs pass automatically |
| **Last frame column** | `tournament_clips.last_frame_url` | Already extracted for every winner — can serve as default frontal image if admin doesn't pick a specific timestamp |
| **Backfill cron** | `src/app/api/cron/extract-missing-frames/route.ts` | Pattern for batch-extracting frames from clips with missing data |
| **Continuation UI** | `src/components/AIGeneratePanel.tsx` | Existing "Continue from last scene" banner pattern — extend with "Pinned character" banner |

**Nothing new to build for extraction/storage.** The pin API just calls the same ffmpeg + uploadFrame pipeline with a different timestamp and storage key.

---

## How It Works

```
Admin pins character from winning clip
  ├─ Reuse ffmpeg extraction (existing) with custom timestamp
  ├─ Reuse uploadFrame() (existing) with "pinned/" storage path
  ├─ Store metadata in pinned_characters table (new)
  └─ Optionally add angles from other winning clips (reuse same pipeline)
       │
       ▼
User generates clip for that story
  ├─ System detects pinned character exists
  ├─ Switches from text-to-video → reference-to-video (Kling O1)
  ├─ Injects pinned character images as @Element1
  ├─ Auto-appends "@Element1" to user's prompt
  └─ Generated video maintains character identity
```

**Key difference from image-to-video:** The character stays consistent but camera angles, poses, and compositions are free. The model understands the character's identity, not just a starting frame.

**Key difference from "Continue from last scene":** Continuation uses `last_frame_url` as the starting frame for i2v (same pose/composition). Pinning uses element references so the character identity persists but scenes are freely composed.

---

## Kling O1 Reference-to-Video API

**Endpoint:** `fal-ai/kling-video/o1/reference-to-video`

**Input Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prompt` | string | Yes | Use `@Element1`, `@Element2` for characters, `@Image1`, `@Image2` for style |
| `elements` | array | No | Character/object references (up to 7 total inputs) |
| `image_urls` | array | No | Style/appearance reference images |
| `duration` | string | No | `"5"` or `"10"` seconds (default: `"5"`) |
| `aspect_ratio` | string | No | `"16:9"`, `"9:16"`, `"1:1"` (default: `"16:9"`) |

**Element structure:**
```json
{
  "frontal_image_url": "https://...",      // Clear front-facing view of character
  "reference_image_urls": ["https://..."]  // Additional angles/poses (optional)
}
```

**Cost:** $0.112/second → **$0.56 for 5s**, $1.12 for 10s

**Output:** MP4 video with `url`, `file_name`, `content_type`, `file_size`

---

## Database Schema

**File:** `supabase/sql/migration-character-pinning.sql`

```sql
-- Pinned characters for each season/story
CREATE TABLE pinned_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  element_index INTEGER NOT NULL DEFAULT 1,  -- 1 = @Element1, 2 = @Element2, etc.
  label VARCHAR(100),                        -- "Main Robot", "Companion Cat", etc.
  frontal_image_url TEXT NOT NULL,            -- Best front-facing reference
  reference_image_urls TEXT[] DEFAULT '{}',   -- Additional angles (up to 6)
  source_clip_id UUID REFERENCES tournament_clips(id),  -- Which winning clip this came from
  source_frame_timestamp FLOAT,              -- Seconds into clip where frame was extracted
  pinned_by UUID,                            -- Admin who pinned it
  usage_count INTEGER DEFAULT 0,             -- Track how often used
  is_active BOOLEAN DEFAULT true,            -- Can be deactivated without deleting
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, element_index)
);

CREATE INDEX idx_pinned_chars_season ON pinned_characters(season_id) WHERE is_active = true;

-- Track which generations used pinned characters (for quality analysis)
ALTER TABLE ai_generations
  ADD COLUMN IF NOT EXISTS pinned_character_ids UUID[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS generation_mode VARCHAR(30) DEFAULT 'text-to-video';
  -- generation_mode: 'text-to-video', 'image-to-video', 'reference-to-video'
```

---

## Implementation Steps

### Step 1: Add Kling O1 Reference-to-Video Model

**File:** `src/lib/ai-video.ts` (modify)

Add to `MODELS`:
```typescript
'kling-o1-ref': {
  modelId: 'fal-ai/kling-video/o1/reference-to-video',
  costCents: 56,      // $0.56 for 5 seconds
  duration: '5',
  resolution: '720p',
  supportsAudio: false,
  supportsPortrait: true,
},
```

Add new function `buildReferenceToVideoInput()`:
```typescript
export function buildReferenceToVideoInput(
  rawPrompt: string,
  elements: Array<{
    frontal_image_url: string;
    reference_image_urls?: string[];
  }>,
  style?: string,
  imageUrls?: string[],
): Record<string, unknown> {
  const styledPrompt = style && STYLE_PREFIXES[style]
    ? `${STYLE_PREFIXES[style]} ${rawPrompt}`
    : rawPrompt;

  return {
    prompt: styledPrompt,
    elements,
    image_urls: imageUrls,
    duration: '5',
    aspect_ratio: '9:16',
  };
}
```

Add new function `startReferenceToVideoGeneration()`:
```typescript
export async function startReferenceToVideoGeneration(
  prompt: string,
  elements: Array<{
    frontal_image_url: string;
    reference_image_urls?: string[];
  }>,
  style: string | undefined,
  webhookUrl: string,
  imageUrls?: string[],
): Promise<{ requestId: string }> {
  const input = buildReferenceToVideoInput(prompt, elements, style, imageUrls);

  const result = await fal.queue.submit(
    'fal-ai/kling-video/o1/reference-to-video',
    { input, webhookUrl }
  );

  return { requestId: result.request_id };
}
```

### Step 2: Frame Extraction Helper (shared)

**File:** `src/lib/storage/frame-upload.ts` (modify — add `uploadPinnedFrame`)

Add a new function alongside the existing `uploadFrame()`:

```typescript
export async function uploadPinnedFrame(
  seasonId: string,
  elementIndex: number,
  suffix: string,            // 'frontal' or 'angle_0', 'angle_1', etc.
  jpegBuffer: Uint8Array,
  provider: StorageProvider
): Promise<string> {
  const key = `pinned/${seasonId}/${elementIndex}_${suffix}.jpg`;
  // Same upload logic as existing uploadFrame() — Supabase bucket or R2
}
```

Add a shared extraction function (reuses exact ffmpeg pattern from `/api/internal/extract-frame`):

```typescript
// Extracts frame at arbitrary timestamp (vs existing -sseof -0.1 for last frame)
export async function extractFrameAtTimestamp(
  videoUrl: string,
  timestampSeconds: number
): Promise<Uint8Array> {
  // 1. Download video to temp file (same as extract-frame/route.ts lines 70-95)
  // 2. Run ffmpeg with -ss {timestampSeconds} instead of -sseof -0.1
  // 3. Read output JPEG, cleanup, return buffer
}
```

This avoids duplicating the ffmpeg download/extract/cleanup logic.

### Step 3: Admin Pin Character API

**File:** `src/app/api/admin/pinned-characters/route.ts` (new)

**GET** — List pinned characters for a season
```
GET /api/admin/pinned-characters?season_id=X
→ { ok: true, characters: PinnedCharacter[] }
```

**POST** — Pin a new character from a clip frame
```
POST /api/admin/pinned-characters
{
  season_id: "uuid",
  source_clip_id: "uuid",         // winning clip to extract from
  frame_timestamp: 2.5,           // seconds into clip (or null = use existing last_frame_url)
  label: "Main Robot",
  element_index: 1                // becomes @Element1
}
```

Logic:
1. `requireAdmin()` guard
2. If `frame_timestamp` provided:
   - Call `extractFrameAtTimestamp(clip.video_url, frame_timestamp)` (new shared helper)
   - Call `uploadPinnedFrame(seasonId, elementIndex, 'frontal', buffer, provider)` (reuses storage layer)
3. If `frame_timestamp` is null:
   - Use clip's existing `last_frame_url` directly (already extracted by `/api/internal/extract-frame`)
   - No ffmpeg needed — just reference the URL
4. Insert into `pinned_characters` table
5. Return the pinned character record

**DELETE** — Unpin a character
```
DELETE /api/admin/pinned-characters?id=X
```

**Shortcut: Pin from existing last frame**
Since every winning clip already has `last_frame_url` extracted by the existing system, admins can pin it with zero extraction cost — just pass `frame_timestamp: null` and the API copies the URL directly.

### Step 4: Add Reference Angles API

**File:** `src/app/api/admin/pinned-characters/[id]/angles/route.ts` (new)

**POST** — Add additional reference angle from another clip/frame
```
POST /api/admin/pinned-characters/{id}/angles
{
  source_clip_id: "uuid",
  frame_timestamp: 1.0       // or null to use that clip's last_frame_url
}
```

Same logic: if `frame_timestamp` given, extract via shared helper. If null, use `last_frame_url`.
Uploads via `uploadPinnedFrame()`, appends URL to `reference_image_urls` array.

### Step 5: Public Pinned Characters API

**File:** `src/app/api/story/pinned-characters/route.ts` (new)

**GET** — Get active pinned characters for current season (user-facing)
```
GET /api/story/pinned-characters?season_id=X
→ {
    ok: true,
    characters: [
      {
        element_index: 1,
        label: "Main Robot",
        frontal_image_url: "https://...",
        reference_count: 3
      }
    ]
  }
```

### Step 6: Modify AI Generation Flow

**File:** `src/app/api/ai/generate/route.ts` (modify)

When generating a clip for a story with pinned characters:

```typescript
// After prompt validation, before calling fal.ai:

// 1. Check for pinned characters in this season
const { data: pinnedChars } = await supabase
  .from('pinned_characters')
  .select('*')
  .eq('season_id', seasonId)
  .eq('is_active', true)
  .order('element_index');

if (pinnedChars && pinnedChars.length > 0) {
  // 2. Build elements array
  const elements = pinnedChars.map(pc => ({
    frontal_image_url: pc.frontal_image_url,
    reference_image_urls: pc.reference_image_urls || [],
  }));

  // 3. Auto-inject @Element references into prompt
  let augmentedPrompt = prompt;
  pinnedChars.forEach((pc, i) => {
    const tag = `@Element${i + 1}`;
    if (!augmentedPrompt.includes(tag)) {
      augmentedPrompt = `${tag} ${augmentedPrompt}`;
    }
  });

  // 4. Use reference-to-video instead of text-to-video
  const { requestId } = await startReferenceToVideoGeneration(
    augmentedPrompt,
    elements,
    style,
    webhookUrl
  );

  // 5. Track generation mode
  // Store pinned_character_ids and generation_mode='reference-to-video' in ai_generations
}
```

### Step 7: Update AIGeneratePanel UI

**File:** `src/components/AIGeneratePanel.tsx` (modify)

Add a "Pinned Characters" indicator:
- When pinned characters exist for the current story, show a small banner:
  `"🎯 Character pinned: Main Robot — your clip will use consistent character"`
- Show the frontal reference thumbnail
- Toggle to opt-out: "Generate without pinned character" (falls back to text-to-video)
- When generating with pinned character, model is forced to `kling-o1-ref`

### Step 8: Admin UI for Pinning

**File:** `src/components/admin/CharacterPinPanel.tsx` (new)

Add to admin dashboard (or as part of the clip review flow):
1. When reviewing a winning clip, admin sees "Pin Character" button
2. Click → video player with frame scrubber
3. Admin scrubs to best character frame, clicks "Pin as Element 1"
4. Frame extracted, uploaded, stored
5. Admin can add more angles from other clips
6. Shows current pinned characters with preview thumbnails
7. Can deactivate/delete pins

---

## Files Summary

### Create (new files)
| File | Purpose |
|---|---|
| `supabase/sql/migration-character-pinning.sql` | `pinned_characters` table + `ai_generations` columns |
| `src/app/api/admin/pinned-characters/route.ts` | Admin: list, pin, unpin characters (GET/POST/DELETE) |
| `src/app/api/admin/pinned-characters/[id]/angles/route.ts` | Admin: add reference angles (POST) |
| `src/app/api/story/pinned-characters/route.ts` | Public: get pinned characters for season (GET) |
| `src/components/admin/CharacterPinPanel.tsx` | Admin UI for pinning characters from clips |

### Modify (existing files)
| File | Change |
|---|---|
| `src/lib/ai-video.ts` | Add `kling-o1-ref` model, `buildReferenceToVideoInput()`, `startReferenceToVideoGeneration()` |
| `src/lib/storage/frame-upload.ts` | Add `uploadPinnedFrame()` + `extractFrameAtTimestamp()` shared helper (reuses existing ffmpeg pattern) |
| `src/app/api/ai/generate/route.ts` | Auto-detect pinned characters, switch to reference-to-video, inject @Element tags |
| `src/components/AIGeneratePanel.tsx` | Show pinned character indicator, opt-out toggle |

### Reuse unchanged (no modifications needed)
| File | What it provides |
|---|---|
| `src/app/api/internal/extract-frame/route.ts` | Pattern for ffmpeg extraction (copied into shared helper) |
| `src/lib/storage/index.ts` | `getStorageProvider()` — auto-detects Supabase vs R2 |
| `src/app/api/story/last-frame/route.ts` | Provides `last_frame_url` for quick pin without re-extraction |
| `src/app/api/cron/extract-missing-frames/route.ts` | Backfill pattern if needed for batch operations |

---

## Cost Comparison

| Mode | Model | Cost (5s clip) | Character Consistency |
|---|---|---|---|
| Text-to-video | Kling 2.6 | $0.35 | None — different every time |
| Image-to-video | Kling 2.6 | $0.35 | Starting frame only, drifts |
| **Reference-to-video** | **Kling O1** | **$0.56** | **Maintained throughout clip** |
| Text-to-video | Veo3 Fast | $0.80 | None |
| Text-to-video | Sora 2 | $0.80 | None |

The $0.21 premium over Kling 2.6 buys genuine character persistence across the entire clip.

---

## User Flow

### Admin Pins a Character

1. Story has its first winning clip (Slot 1)
2. Admin opens the winning clip in admin panel
3. Clicks "Pin Character" → video frame scrubber appears
4. Admin scrubs to a clear shot of the main character (e.g., 2.5s mark)
5. Clicks "Pin as Element 1" with label "Main Robot"
6. Frame extracted, uploaded, saved to `pinned_characters`
7. Optionally: admin adds more angles from Slot 2, Slot 3 winners
8. Character is now "pinned" for this season

### User Creates with Pinned Character

1. User goes to `/create`
2. Sees banner: "Character pinned: Main Robot" with thumbnail
3. Writes their scene prompt: "The robot discovers a hidden garden"
4. Clicks Generate
5. System auto-switches to Kling O1 reference-to-video
6. Prompt becomes: "@Element1 The robot discovers a hidden garden"
7. Kling O1 generates video with the SAME robot appearance
8. User gets consistent character without doing anything special

### Opting Out

1. User can toggle "Generate without pinned character"
2. Falls back to regular text-to-video with their selected model
3. Character may look different (useful for flashbacks, alternate timelines, etc.)

---

## Multi-Character Support

The system supports up to 4 pinned characters per season (Kling O1 limit of 7 inputs minus style/frame slots):

```
@Element1 = Main Robot (silver, blue eyes)
@Element2 = Companion Cat (orange tabby)
@Element3 = Villain AI (red-eyed dark robot)
```

User prompt: "@Element1 and @Element2 explore the garden while @Element3 watches from a distance"

All three characters maintain their established appearance.

---

## Feature Flag

Gate behind `ai_co_director` or a new `character_pinning` feature flag:

```sql
INSERT INTO feature_flags (key, name, description, category, enabled, config) VALUES
  ('character_pinning', 'Character Pinning', 'Pin character references for consistent AI generation via Kling O1', 'ai', FALSE,
   '{"max_elements_per_season": 4, "auto_switch_model": true, "cost_premium_warning": true}')
ON CONFLICT (key) DO NOTHING;
```

---

## Verification

1. Admin pins character from winning clip → verify frame extracted and stored
2. Check `pinned_characters` table has correct `frontal_image_url`
3. Admin adds 2 more angles from other clips → verify `reference_image_urls` array updated
4. User goes to `/create` → verify "Pinned character" banner appears
5. User generates clip → verify API uses `fal-ai/kling-video/o1/reference-to-video`
6. Verify prompt includes `@Element1` tag
7. Verify `elements` array passed to fal.ai with correct image URLs
8. Compare generated clip with pinned reference → character should look the same
9. User opts out → verify falls back to regular text-to-video
10. Check `ai_generations.generation_mode` = `'reference-to-video'` in DB

---

## Relation to Other Plans

- **Character Persistence (optimized)** — Covers multi-frame extraction and frame picker UI. Character pinning builds on top of this (extracted frames become pin candidates).
- **AI Co-Director** — Brief writer can reference pinned characters by name/description. Submission scorer can check if pinned character appearance is maintained.
- Both systems are independent but complementary.
