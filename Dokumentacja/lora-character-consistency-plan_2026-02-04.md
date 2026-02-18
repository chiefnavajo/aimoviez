# LoRA Character Consistency Plan

**Created:** 2026-02-04
**Status:** Research Complete, Not Yet Implemented
**Depends on:** Existing fal.ai integration (`src/lib/ai-video.ts`)

---

## Goal

Train a LoRA (Low-Rank Adaptation) model on a specific character so that AI-generated video clips maintain consistent character appearance across an entire season (75 slots).

---

## Two Viable Approaches

### Approach A: Hybrid — FLUX Image LoRA + Kling Elements (Recommended)

**How it works:**
1. Train a FLUX.2 LoRA on 10-20 images of the character (fal.ai hosted training)
2. Use the trained LoRA to generate high-quality reference images of the character in various poses/angles
3. Feed those reference images into Kling O1's Reference-to-Video `@Element` system (already planned in character-pinning-plan)
4. Video generation uses Element references for character identity

**Why this fits our stack:**
- fal.ai already supports FLUX LoRA training (`fal-ai/flux-lora-fast-training`)
- fal.ai already supports FLUX LoRA inference (`fal-ai/flux-lora`)
- We already use fal.ai for Kling video generation
- No GPU infrastructure needed — everything runs on fal.ai
- Combines well with the character pinning plan (Kling O1 Elements)

**Training cost:** ~$0.008/step, ~1000 steps typical = **~$8 per character**
**Inference cost:** ~$0.01 per generated reference image
**Video cost:** Same as current Kling pricing ($0.112/sec) via Reference-to-Video

**Training data requirements:**
- 10-20 images of the character
- Various angles, poses, lighting
- Can use AI-generated images from the first clip as seeds
- Can use frame extraction from winning clips as training data

**Workflow:**
```
1. Admin extracts frames from winning clips featuring the character
2. Admin uploads 10-20 character images to training set
3. fal.ai trains FLUX LoRA (~5-15 min)
4. LoRA model stored (fal.ai provides a URL/ID)
5. Admin generates reference images using trained LoRA
6. Reference images used as Kling O1 Elements for video generation
7. Users create clips with consistent character appearance
```

**fal.ai Training API:**
```
Endpoint: fal-ai/flux-lora-fast-training
Input:
  - images_data_url: ZIP of training images
  - trigger_word: e.g. "MYCHARA" (unique token)
  - steps: 1000 (default)
  - learning_rate: 0.0001
  - rank: 16 (LoRA rank)
Output:
  - diffusers_lora_file: { url, content_type, file_name, file_size }
  - config_file: { url }
```

**fal.ai LoRA Inference:**
```
Endpoint: fal-ai/flux-lora
Input:
  - prompt: "MYCHARA standing in a forest, full body shot"
  - loras: [{ path: "<lora_url>", scale: 1.0 }]
  - image_size: "landscape_16_9"
Output:
  - images: [{ url, width, height }]
```

### Approach B: Self-Hosted HunyuanVideo LoRA (Advanced)

**How it works:**
1. Deploy HunyuanVideo (Tencent's open-source video model) on own GPU
2. Train LoRA directly on the video model using character footage
3. Generate videos with trained LoRA for direct character consistency

**Why this is harder:**
- Requires GPU infrastructure (A100/H100, ~$3-5/hr)
- HunyuanVideo not available on fal.ai as a LoRA-trainable model
- Self-hosting adds operational complexity
- Training takes hours, not minutes
- Would need to replace or supplement existing fal.ai video pipeline

**When this makes sense:**
- At scale (100+ seasons) where per-generation savings justify infra cost
- If Kling Elements prove insufficient for character fidelity
- If the project moves to self-hosted video generation

**Not recommended for current phase.**

---

## Recommended Implementation: Approach A

### Database Changes

```sql
-- Character LoRA models
CREATE TABLE character_loras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  character_name VARCHAR(100) NOT NULL,
  trigger_word VARCHAR(50) NOT NULL,
  lora_url TEXT NOT NULL,               -- fal.ai LoRA weights URL
  config_url TEXT,                       -- fal.ai config URL
  training_images_count INTEGER,
  training_steps INTEGER DEFAULT 1000,
  training_cost_cents INTEGER,
  status VARCHAR(20) DEFAULT 'training' CHECK (status IN ('training', 'ready', 'failed', 'archived')),
  fal_request_id VARCHAR(200),          -- for polling training status
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, character_name)
);

-- Reference images generated from LoRA
CREATE TABLE character_reference_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lora_id UUID NOT NULL REFERENCES character_loras(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,     -- primary frontal image for Kling Elements
  image_type VARCHAR(30) DEFAULT 'reference',  -- 'frontal', 'side', 'action', 'reference'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### New Library

**File:** `src/lib/character-lora.ts` (server-only)

```typescript
// Core functions:
// - trainCharacterLora(seasonId, characterName, imageUrls, triggerWord)
//   → submits fal.ai FLUX LoRA training job, returns request_id
//
// - checkTrainingStatus(requestId)
//   → polls fal.ai for training completion
//
// - generateReferenceImage(loraUrl, triggerWord, prompt)
//   → generates a single image using trained LoRA
//
// - generateReferenceSet(loraUrl, triggerWord)
//   → generates 5 standard reference images (frontal, side, action, etc.)
```

### API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/admin/character-lora/train` | POST | Start LoRA training with uploaded images |
| `/api/admin/character-lora/status` | GET | Check training job status |
| `/api/admin/character-lora/generate-refs` | POST | Generate reference images from trained LoRA |
| `/api/admin/character-lora` | GET | List all character LoRAs for a season |

### Admin UI

Add to existing admin panel or Co-Director panel:
- Upload training images (drag & drop)
- "Train Character" button with progress indicator
- Gallery of generated reference images
- "Set as Element Reference" button (links to character pinning system)

### Integration with Character Pinning

The LoRA system feeds INTO the character pinning system:

```
LoRA Training → Reference Images → Pinned Characters → Kling O1 Elements → Video
     ↑                                    ↑
  Frame extraction              Existing last_frame_url
  from winning clips            (zero-cost shortcut)
```

- LoRA-generated reference images are higher quality and more controllable than raw frame extractions
- Admin can generate the perfect frontal shot, side view, etc. using the LoRA
- These generated images become the `frontal_image_url` and `reference_image_urls` in the `pinned_characters` table

### Workflow for Admin

1. After 3-5 slots with a recurring character:
   - Extract frames from winning clips featuring the character
   - Upload 10-20 best frames as training data
2. Click "Train Character LoRA" (~$8, ~10 min)
3. Once trained, click "Generate Reference Set" (~$0.05)
4. Review 5 generated reference images
5. Click "Pin as Character" → creates entry in `pinned_characters`
6. All future video generations use Kling O1 Elements with these references
7. Character stays consistent for the rest of the season

---

## Cost Summary

| Item | Cost |
|---|---|
| LoRA training (per character) | ~$8 |
| Reference image generation (5 images) | ~$0.05 |
| Video with Element references (per 5s clip) | ~$0.56 |
| **Total per character setup** | **~$8.05** |
| **Per season (3-5 characters)** | **~$25-40** |

Ongoing video generation cost is the same as current Kling pricing — the LoRA training is a one-time cost per character.

---

## Comparison: LoRA vs. Plain Character Pinning

| Aspect | Plain Pinning (frame extraction) | LoRA + Pinning |
|---|---|---|
| Setup cost | Free (uses existing frames) | ~$8 per character |
| Reference quality | Depends on frame quality | Controlled, high quality |
| Character angles | Limited to what's in clips | Can generate any angle |
| Consistency level | Good (Kling Elements) | Better (trained identity + Elements) |
| Setup time | Instant | ~10 min training |
| Best for | Quick start, budget-conscious | Important recurring characters |

**Recommendation:** Start with plain character pinning (free). If character consistency needs improvement, add LoRA training for key characters. Both systems work together — LoRA just provides better reference images.

---

## Prerequisites

- Character pinning system implemented (see `character-pinning-plan_2026-02-04.md`)
- fal.ai API key (already configured)
- No additional dependencies needed

---

## Verification

1. Upload 15 frames of a character from winning clips
2. Start training → verify fal.ai job submitted
3. Poll status → verify training completes (~10 min)
4. Generate reference set → verify 5 images look like the character
5. Pin character using generated references → verify `pinned_characters` entry
6. Generate a video with character → verify Kling O1 uses Element references
7. Compare consistency with and without LoRA references
