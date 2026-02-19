# Fix Pinned Characters to Actually Influence Video Generation (IMPROVED)

## Context

Pinned characters display on the AI Create page but have **zero effect** on the generated video. Deep Opus analysis of all relevant files found:

**Root cause chain:**
1. Characters have 0 reference angles → `reference_image_urls` is `'{}'` (empty array)
2. `hasAnyRefs` at line 262 evaluates to `false`
3. The `if (allReachable && hasAnyRefs)` gate at line 266 skips the entire ref-to-video block
4. Code falls through to plain `startGeneration()` text-to-video at line 460
5. `label` is fetched but **never used** — not injected into the prompt
6. No `appearance_description` column exists in the database

**Key discoveries from Opus analysis:**
- `buildReferenceToVideoInput` already handles frontal-only correctly (strips empty `reference_image_urls`, confirmed by test at `ai-video.test.ts:229-239`)
- The try/catch fallback for ref-to-video failure **already exists** at lines 418-449 — no need to add one
- The fallback uses `sanitizedPrompt` (no character info) — must inject descriptions BEFORE the fallback block
- The `suggest-prompt` route already injects character labels into Claude context, but the generate route doesn't
- Only `kling-o1-ref` model supports ref-to-video (hardcoded to `fal-ai/kling-video/o1/reference-to-video`)
- `withRetry` does NOT retry 4xx errors — a fal.ai 422 throws immediately and hits the existing catch block
- Whether fal.ai actually accepts frontal-only payloads is **uncertain** — the existing comment claims it doesn't, but the fallback handles this safely

## Changes

### 1. SQL Migration — add `appearance_description` column
**New file:** `supabase/sql/add-character-appearance-description.sql`
```sql
ALTER TABLE pinned_characters
  ADD COLUMN IF NOT EXISTS appearance_description TEXT;
COMMENT ON COLUMN pinned_characters.appearance_description
  IS 'Text description of character appearance, used as prompt fallback when reference-to-video is unavailable';
```

### 2. Update AI generate route — 3-layer character handling
**File:** `src/app/api/ai/generate/route.ts`

**Change A — Add `appearance_description` to SELECT (line 227):**
```typescript
// OLD:
.select('id, element_index, label, frontal_image_url, reference_image_urls')
// NEW:
.select('id, element_index, label, frontal_image_url, reference_image_urls, appearance_description')
```

**Change B — Inject character descriptions into prompt BEFORE ref-to-video block (after line 264, before line 266):**
```typescript
// Inject character appearance descriptions into prompt (works for both ref-to-video AND text-to-video fallback)
const charDescriptions = pinnedChars
  .filter(pc => pc.appearance_description)
  .map(pc => `${pc.label || `Element ${pc.element_index}`}: ${pc.appearance_description}`)
  .join('; ');
if (charDescriptions) {
  augmentedPrompt = `Characters: ${charDescriptions}. ${augmentedPrompt}`;
}
```

**Why before, not after:** The existing fallback at line 433 uses `sanitizedPrompt` (the original prompt without any character info). We need to change the fallback to use `augmentedPrompt` instead, so character descriptions survive the ref-to-video → text-to-video fallback.

**Change C — Remove the `hasAnyRefs` gate (line 266):**
```typescript
// OLD (line 262-266):
const hasAnyRefs = pinnedChars.some(
  pc => pc.reference_image_urls && pc.reference_image_urls.length > 0
);
if (allReachable && hasAnyRefs) {

// NEW:
if (allReachable) {
```

Remove the `hasAnyRefs` variable entirely — no longer needed. `buildReferenceToVideoInput` already strips empty `reference_image_urls` (confirmed by test).

**Change D — Fix fallback prompt in existing catch block (line 433):**
```typescript
// OLD (line 433):
const fallbackResult = await startGeneration(
  validated.model,
  sanitizedPrompt,  // ← loses all character descriptions!
  validated.style,
  webhookUrl
);

// NEW:
const fallbackResult = await startGeneration(
  validated.model,
  augmentedPrompt,  // ← preserves character descriptions in text-to-video fallback
  validated.style,
  webhookUrl
);
```

Also update the generation row update at line 440:
```typescript
// OLD:
prompt: sanitizedPrompt,
// NEW:
prompt: augmentedPrompt,
```

**Change E — Update comment (line 260-261):**
```typescript
// OLD: // Only use reference-to-video if at least one character has reference angles
//      // fal.ai's o1/reference-to-video requires reference images beyond just frontals
// NEW: // Try reference-to-video with frontal images; fallback to text-to-video on failure
```

### 3. Update admin API — accept `appearance_description`
**File:** `src/app/api/admin/pinned-characters/route.ts`

**Line 69 — Add to destructured body:**
```typescript
// OLD:
const { season_id, source_clip_id, frame_timestamp, label, element_index } = body;
// NEW:
const { season_id, source_clip_id, frame_timestamp, label, element_index, appearance_description } = body;
```

**Lines 167-175 — Add to INSERT payload:**
```typescript
.insert({
  season_id,
  element_index: elemIdx,
  label: label || null,
  appearance_description: appearance_description || null,  // ← ADD
  frontal_image_url: frontalImageUrl,
  source_clip_id,
  source_frame_timestamp: frame_timestamp ?? null,
  pinned_by: auth.userId,
})
```

**GET handler (line 43) — No change needed:** Already uses `SELECT('*')`, so `appearance_description` will be included automatically once the DB column exists.

### 4. Add PATCH endpoint for editing appearance_description
**File:** `src/app/api/admin/pinned-characters/route.ts`

Add a new PATCH handler to update `appearance_description` on existing characters:
```typescript
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { id, appearance_description } = body;

  if (!id) {
    return NextResponse.json({ error: 'Missing character id' }, { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('pinned_characters')
    .update({ appearance_description: appearance_description || null })
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

### 5. Update admin UI — edit description field
**File:** `src/app/admin/characters/page.tsx`

**Line 35 (interface) — Add field:**
```typescript
appearance_description: string | null;  // ← ADD after label
```

**~Line 78 (state) — Add form state:**
```typescript
const [pinAppearanceDesc, setPinAppearanceDesc] = useState('');
```

**Lines 251-257 (POST body in handlePin) — Include description:**
```typescript
appearance_description: pinAppearanceDesc || undefined,
```

**Lines 266-270, 407-412, 649-656 (state resets) — Reset description:**
```typescript
setPinAppearanceDesc('');
```

**~Line 462 (character card) — Display description:**
```tsx
{char.appearance_description && (
  <p className="text-xs text-gray-400 mt-1 italic line-clamp-2">
    {char.appearance_description}
  </p>
)}
```

**Also add inline edit button on each character card** that calls PATCH to update description:
- Small edit icon next to the description
- Opens a textarea modal or inline edit
- On save, calls `PATCH /api/admin/pinned-characters` with `{ id, appearance_description }`

**After line 766 (Pin Character Modal) — Add textarea:**
```tsx
<div>
  <label className="block text-sm font-medium text-gray-300 mb-1">
    Appearance Description (optional)
  </label>
  <textarea
    value={pinAppearanceDesc}
    onChange={e => setPinAppearanceDesc(e.target.value)}
    placeholder="e.g., tall alien with blue skin and glowing green eyes"
    className="w-full bg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
    rows={2}
    maxLength={500}
  />
  <p className="text-xs text-gray-500 mt-1">
    Used in AI prompt when generating videos with this character
  </p>
</div>
```

### 6. Update public API — return description
**File:** `src/app/api/story/pinned-characters/route.ts`

**Line 76 — Add to SELECT:**
```typescript
// OLD:
.select('id, element_index, label, frontal_image_url, reference_image_urls, usage_count')
// NEW:
.select('id, element_index, label, frontal_image_url, reference_image_urls, usage_count, appearance_description')
```

**Lines 86-92 — Add to result mapping:**
```typescript
const result = (characters || []).map(c => ({
  id: c.id,
  element_index: c.element_index,
  label: c.label,
  frontal_image_url: c.frontal_image_url,
  reference_count: (c.reference_image_urls || []).length,
  appearance_description: c.appearance_description || null,  // ← ADD
}));
```

### 7. Update frontend — display description
**File:** `src/components/AIGeneratePanel.tsx`

**Lines 199-205 (pinnedCharacters state type) — Add field:**
```typescript
appearance_description: string | null;
```

**Lines 207-213 (previewCharacter state type) — Add field:**
```typescript
appearance_description: string | null;
```

**Lines 215-221 (suggestingForCharacter state type) — Add field:**
```typescript
appearance_description: string | null;
```

**~Line 1340 (preview modal) — Display description:**
```tsx
{previewCharacter.appearance_description && (
  <p className="text-sm text-gray-400 italic mt-2">
    {previewCharacter.appearance_description}
  </p>
)}
```

## Files to modify

| # | File | Changes |
|---|------|---------|
| 1 | `supabase/sql/add-character-appearance-description.sql` | New migration: add column |
| 2 | `src/app/api/ai/generate/route.ts` | Remove `hasAnyRefs` gate, inject descriptions into prompt, fix fallback prompt |
| 3 | `src/app/api/admin/pinned-characters/route.ts` | Accept `appearance_description` in POST, add PATCH endpoint |
| 4 | `src/app/admin/characters/page.tsx` | Interface + form state + textarea + display + inline edit |
| 5 | `src/app/api/story/pinned-characters/route.ts` | Add to SELECT + result mapping |
| 6 | `src/components/AIGeneratePanel.tsx` | Add to 3 state types + display in preview modal |

## Layer Summary

| Layer | What happens | When |
|-------|-------------|------|
| **Layer 1: Ref-to-video** | Try `kling-o1-ref` with frontal images only + `@Element` tags + descriptions in prompt | When all frontals reachable |
| **Layer 2: Text-to-video fallback** | Fall back to user's selected model with character descriptions still in prompt | When ref-to-video fails (422/error) |
| **Layer 3: Description injection** | Character `appearance_description` injected into prompt regardless of path | Always, when descriptions exist |

## What the original plan got wrong

1. **"Add try/catch around startReferenceToVideoGeneration"** — already exists at lines 418-449
2. **Fallback uses `sanitizedPrompt`** — must change to `augmentedPrompt` so descriptions survive fallback
3. **Missing PATCH endpoint** — original plan only mentioned POST, but existing characters need editing too
4. **Missing frontend state types** — `previewCharacter` and `suggestingForCharacter` also need the field (lines 207-221)

## Verification

1. Run the SQL migration on Supabase
2. `npm run build` — no type errors
3. `npm test` — all tests pass
4. Go to Admin > Characters, edit a character, add appearance description
5. Go to AI Create, select genre with pinned characters
6. Generate a video — check Vercel logs for:
   - `[AI_GENERATE]` should show augmented prompt with "Characters: ..."
   - If ref-to-video works: characters visually consistent via frontal images
   - If ref-to-video fails (422): fallback log + text-to-video prompt still has character descriptions
7. Test with narration: descriptions should not interfere
8. Test without descriptions: should still try ref-to-video with frontals only (no "Characters:" prefix)
