# Character Persistence System - Optimized Implementation Plan

**Created:** 2026-02-04
**Status:** Planned (not yet implemented)

---

## Summary
Maintain visual consistency of characters across AI-generated clips by leveraging the **existing** image-to-video and frame extraction infrastructure. No Python, Redis, or CLIP embeddings needed.

---

## Key Insight

The codebase already has:
- **Image-to-video** generation (Kling, Hailuo, Sora) via `src/lib/ai-video.ts`
- **Last-frame extraction** via ffmpeg in `/api/internal/extract-frame`
- **Continuation mode** UI in `AIGeneratePanel.tsx` that passes `image_url` to i2v
- **Storage** (R2/Supabase) with frame upload helpers

What's missing: extracting **multiple** frames from winners, storing them as reusable character references, and letting users pick which reference to use when generating.

---

## Architecture (Simplified)

```
Winning Clip Selected
  ├─ Extract 3-5 key frames (ffmpeg, already have this)
  ├─ Store as "story_frames" in storage
  └─ Save metadata to story_character_frames table
       │
       ▼
User Creates New Clip
  ├─ UI shows available reference frames from story
  ├─ User picks a frame (or "fresh start")
  ├─ Frame URL passed as image_url → image-to-video API
  └─ Optional: style description auto-appended to prompt
```

No face detection. No CLIP embeddings. No voting on character designs. The **winning clips ARE the character canon**.

---

## Database Schema

```sql
-- Character reference frames extracted from winning clips
CREATE TABLE story_character_frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id),
  source_clip_id UUID NOT NULL REFERENCES tournament_clips(id),
  slot_position INTEGER NOT NULL,
  frame_index INTEGER NOT NULL,           -- 0=first, 1=mid, 2=last, etc.
  frame_type TEXT DEFAULT 'auto',         -- 'auto', 'user_selected', 'admin'
  frame_url TEXT NOT NULL,
  label TEXT,                             -- Optional: "character closeup", "wide shot"
  is_primary BOOLEAN DEFAULT false,       -- Primary reference for this character
  usage_count INTEGER DEFAULT 0,          -- How many times used for generation
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_story_frames_season ON story_character_frames(season_id);
CREATE INDEX idx_story_frames_clip ON story_character_frames(source_clip_id);

-- Optional: character style descriptions (auto-generated or manual)
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS character_style_description TEXT;
```

---

## Implementation Steps

### Step 1: Multi-Frame Extraction API
**File:** `src/app/api/internal/extract-frames/route.ts` (new)

Extend existing single-frame extraction to extract multiple frames:
- Frame at 0.5s (early shot)
- Frame at mid-point
- Frame at last 0.1s (existing behavior)
- Store all in `story_character_frames` table
- Upload to storage under `frames/{clipId}_{index}.jpg`

Uses same pattern as existing `extract-frame/route.ts` - ffmpeg-static, same auth (CRON_SECRET).

### Step 2: Auto-Extract on Winner Selection
**File:** `src/app/api/admin/assign-winner/route.ts` (modify)

After winner is assigned, fire-and-forget call to the new multi-frame extraction endpoint instead of (or in addition to) the single last-frame extraction.

### Step 3: Reference Frame API
**File:** `src/app/api/story/frames/route.ts` (new)

- `GET /api/story/frames?season_id=X` - Get all reference frames for current story
- Returns frames grouped by slot position, sorted chronologically
- Used by the AIGeneratePanel to show available references

### Step 4: Update AIGeneratePanel UI
**File:** `src/components/AIGeneratePanel.tsx` (modify)

Enhance the existing continuation mode:
- Instead of just "Continue from last scene" (single frame), show a **frame picker**
- Grid of extracted frames from all winning clips
- User taps a frame to use it as the image-to-video reference
- Selected frame shown in the purple banner (existing UI pattern)
- "Fresh start" option remains

Changes are minimal - the `image_url` flow already works. Just need to offer more frame choices.

### Step 5: Style Description Injection (Optional)
**File:** `src/lib/ai-video.ts` (modify)

When generating with a character reference:
- If `seasons.character_style_description` is set, auto-append it to the prompt
- Example: "blonde knight in blue armor" gets prepended to user's prompt
- Admin can set this via a simple text field in admin panel

---

## Files to Create/Modify

### Create
| File | Purpose |
|------|---------|
| `supabase/sql/migration-character-frames.sql` | New table + indexes |
| `src/app/api/internal/extract-frames/route.ts` | Multi-frame extraction endpoint |
| `src/app/api/story/frames/route.ts` | Get reference frames for story |

### Modify
| File | Changes |
|------|---------|
| `src/app/api/admin/assign-winner/route.ts` | Call multi-frame extraction on winner |
| `src/components/AIGeneratePanel.tsx` | Add frame picker grid to continuation UI |
| `src/lib/ai-video.ts` | Optional style description injection |

---

## What We Skip (vs Original Doc)

| Original Doc Feature | Status | Reason |
|----------------------|--------|--------|
| Python + OpenCV face detection | Skip | Unnecessary complexity, ffmpeg timestamps suffice |
| CLIP embeddings | Skip | No consistency scoring needed for v1 |
| Redis caching | Skip | React Query + Supabase is enough |
| Community voting on character designs | Skip | Winning clips = character canon |
| Character marketplace/licensing | Skip | Phase 2+ if ever needed |
| Color palette extraction | Skip | Over-engineering for v1 |
| Consistency scoring | Skip | Users judge visually |
| Express/Sequelize | Skip | Already using Next.js + Supabase |

---

## User Flow

1. Story plays out normally - clips are submitted, voted on, winners selected
2. When a winner is assigned, system auto-extracts 3-5 key frames
3. When a user goes to `/create`, they see:
   - **"Use reference frame"** - grid of frames from past winners
   - **"Continue from last scene"** - existing last-frame behavior
   - **"Start fresh"** - no reference image
4. Selecting a reference frame -> image-to-video generation with that frame
5. Character stays visually consistent across clips

---

## Verification

1. Assign a winner -> verify 3-5 frames extracted and stored
2. Go to `/create` -> verify frame picker shows extracted frames
3. Select a frame and generate -> verify image-to-video uses that frame
4. Compare generated clip with reference -> visual consistency check
5. Generate without reference -> verify "fresh start" still works
