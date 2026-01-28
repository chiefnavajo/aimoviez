# Multi-Genre Seasons Implementation Plan

## Overview

Enable multiple seasons to run in parallel, one per genre. Users choose their preferred genre and participate in building that genre's movie.

---

## Deep Analysis & Optimization Notes

### Critical Issues Identified

1. **Database Schema Gap**
   - Current `seasons` table has NO `genre` column
   - Current `story_slots` table has NO `genre` column
   - Existing `/api/admin/seasons` creates seasons without genre
   - **Fix:** Must add `genre` column to `seasons` table via migration

2. **Existing Genre Infrastructure Conflict**
   - `/api/genres/route.ts` exists for voting on FUTURE season genres
   - Has hardcoded `GENRE_OPTIONS`: COMEDY, THRILLER, ACTION, ANIMATION
   - This is for "what genre should Season 2 be?" voting
   - **Decision:** Keep this separate OR integrate with multi-genre

3. **Dashboard Complexity**
   - `dashboard/page.tsx` is 1000+ lines with complex state
   - Adding GenreSwiper requires careful integration
   - Must preserve: realtime updates, confetti, sounds, comments panel

4. **API Assumptions**
   - Plan assumes `/api/vote` can filter by genre
   - Current code: `seasons.eq('status', 'active')` with NO genre filter
   - **Fix:** Add genre parameter handling

### Performance Optimizations Added

1. **Lazy Load Genre Data** - Don't fetch all genres' clips upfront
2. **Virtual Scrolling** - For clips within a genre (vertical)
3. **Intersection Observer** - Load videos only when visible
4. **Service Worker Caching** - Cache genre list + first clips

### UX Improvements Added

1. **Genre Empty States** - Show "No clips yet" with upload CTA
2. **Cross-Genre Discovery** - Periodically suggest other genres
3. **Genre Badges** - Visual indicators on user profiles
4. **Completion Celebration** - When a genre movie finishes (75 slots)

---

## Current State

- Single active season at a time
- All clips go to one season regardless of genre
- No genre selection for users
- Upload assigns to "most recent active season"
- `/api/genres` exists but only for future season voting

---

## Target State

- Multiple active seasons (one per genre)
- Users **swipe horizontally** to switch between genres
- Each swipe page shows only that genre's clips
- Each genre builds its own 10-minute movie (75 slots)
- Clips only compete within their genre's season
- Unified genre list across voting + upload + story

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         SEASONS                                  │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│   ACTION    │   COMEDY    │   HORROR    │  ANIMATION  │ ROMANCE │
│  Season 1   │  Season 1   │  Season 1   │  Season 1   │ Season 1│
│  status:    │  status:    │  status:    │  status:    │ status: │
│  active     │  active     │  active     │  active     │ active  │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────┤
│  75 slots   │  75 slots   │  75 slots   │  75 slots   │ 75 slots│
│  Voting: 3  │  Voting: 1  │  Voting: 5  │  Voting: 2  │ Voting:1│
├─────────────┼─────────────┼─────────────┼─────────────┼─────────┤
│  12 clips   │  8 clips    │  15 clips   │  6 clips    │ 3 clips │
│  competing  │  competing  │  competing  │  competing  │competing│
└─────────────┴─────────────┴─────────────┴─────────────┴─────────┘
```

---

## Implementation Phases

### Phase 1: Database Setup
### Phase 2: Backend API Changes
### Phase 3: Frontend - Genre Picker
### Phase 4: Frontend - Upload Flow
### Phase 5: Frontend - Story Page
### Phase 6: Testing & Polish

---

# Phase 1: Database Setup

## Step 1.0: Database Migration (CRITICAL)

**The `seasons` table currently has NO `genre` column. Must add it first.**

```sql
-- Migration: Add genre support to seasons
-- Run this in Supabase SQL Editor

-- Step 1: Add genre column to seasons table
ALTER TABLE seasons
ADD COLUMN IF NOT EXISTS genre TEXT;

-- Step 2: Create index for fast genre lookups
CREATE INDEX IF NOT EXISTS idx_seasons_genre ON seasons(genre);
CREATE INDEX IF NOT EXISTS idx_seasons_status_genre ON seasons(status, genre);

-- Step 3: Add unique constraint (one active season per genre)
-- This prevents duplicate active seasons for same genre
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_active_genre
ON seasons(genre)
WHERE status = 'active';

-- Step 4: Update existing season(s) to have a default genre
-- (Optional: assign existing season to 'action' or leave NULL)
UPDATE seasons
SET genre = 'action'
WHERE genre IS NULL AND status = 'active';
```

**Verify migration:**
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'seasons';
-- Should now include 'genre' column
```

---

## Step 1.1: Define Genre List

**Centralize genre definitions** - Create a shared config file:

**File:** `src/lib/genres.ts`

```typescript
export const GENRES = [
  { code: 'action', label: 'Action', emoji: '🎬', description: 'Action & Adventure' },
  { code: 'comedy', label: 'Comedy', emoji: '😂', description: 'Comedy & Humor' },
  { code: 'horror', label: 'Horror', emoji: '👻', description: 'Horror & Thriller' },
  { code: 'animation', label: 'Animation', emoji: '🎨', description: 'Animation & Cartoon' },
] as const;

export type GenreCode = typeof GENRES[number]['code'];

export const GENRE_MAP = Object.fromEntries(
  GENRES.map(g => [g.code, g])
) as Record<GenreCode, typeof GENRES[number]>;

export function getGenreEmoji(code: string): string {
  return GENRE_MAP[code as GenreCode]?.emoji || '🎥';
}

export function getGenreLabel(code: string): string {
  return GENRE_MAP[code as GenreCode]?.label || code;
}
```

**Why centralize?**
- Single source of truth for frontend + backend
- Easy to add/remove genres later
- Consistent emojis + labels everywhere

**Recommended launch genres:** Action, Comedy, Horror, Animation (4 genres)

---

## Step 1.2: Create Seasons Table Entries

```sql
-- Create one season per genre
-- NOTE: Run AFTER migration adds 'genre' column

INSERT INTO seasons (label, genre, status, total_slots, created_at) VALUES
  ('Action Season 1', 'action', 'active', 75, NOW()),
  ('Comedy Season 1', 'comedy', 'active', 75, NOW()),
  ('Horror Season 1', 'horror', 'active', 75, NOW()),
  ('Animation Season 1', 'animation', 'active', 75, NOW());

-- Verify:
SELECT id, label, genre, status FROM seasons WHERE status = 'active';
```

---

## Step 1.3: Create Story Slots for Each Season

For each season, create 75 slots:

```sql
-- Function to create slots for a season
CREATE OR REPLACE FUNCTION create_season_slots(p_season_id UUID, p_genre TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO story_slots (season_id, slot_position, status, genre)
  SELECT
    p_season_id,
    pos,
    CASE WHEN pos = 1 THEN 'voting' ELSE 'upcoming' END,
    p_genre
  FROM generate_series(1, 75) AS pos;
END;
$$ LANGUAGE plpgsql;

-- Call for each season
SELECT create_season_slots('ACTION_SEASON_ID', 'action');
SELECT create_season_slots('COMEDY_SEASON_ID', 'comedy');
-- ... repeat for each genre
```

---

## Step 1.4: (Optional) Add AI Opening Clips

Each genre starts with an AI-generated 8-second opening clip:

```sql
-- For each genre, insert opening clip and lock slot 1
INSERT INTO tournament_clips (
  season_id,
  slot_position,
  status,
  genre,
  username,
  video_url,
  thumbnail_url,
  vote_count
) VALUES (
  'ACTION_SEASON_ID',
  1,
  'locked',
  'action',
  'AI_Director',
  'https://storage.url/action-opening.mp4',
  'https://storage.url/action-opening-thumb.jpg',
  0
);

-- Update slot 1 to locked, slot 2 to voting
UPDATE story_slots
SET status = 'locked', winner_tournament_clip_id = 'CLIP_ID'
WHERE season_id = 'ACTION_SEASON_ID' AND slot_position = 1;

UPDATE story_slots
SET status = 'voting'
WHERE season_id = 'ACTION_SEASON_ID' AND slot_position = 2;
```

---

## Step 1.5: Verify Database State

```sql
-- Check all active seasons
SELECT id, label, genre, status, total_slots
FROM seasons
WHERE status = 'active'
ORDER BY genre;

-- Check voting slots per season
SELECT s.genre, ss.slot_position, ss.status
FROM story_slots ss
JOIN seasons s ON ss.season_id = s.id
WHERE ss.status = 'voting'
ORDER BY s.genre;

-- Count clips per season
SELECT s.genre, COUNT(tc.id) as clip_count
FROM seasons s
LEFT JOIN tournament_clips tc ON tc.season_id = s.id AND tc.status = 'active'
WHERE s.status = 'active'
GROUP BY s.genre;
```

---

# Phase 2: Backend API Changes

## Step 2.1: Create GET /api/seasons/active

New endpoint to return all active seasons for the genre picker.

**File:** `src/app/api/seasons/active/route.ts`

```typescript
// Returns all active seasons with their current voting slot info
export async function GET(req: NextRequest) {
  const { data: seasons } = await supabase
    .from('seasons')
    .select(`
      id,
      label,
      genre,
      total_slots,
      story_slots!inner(slot_position, status)
    `)
    .eq('status', 'active')
    .eq('story_slots.status', 'voting');

  // Get clip counts for each season
  // ... aggregate clip counts

  return NextResponse.json({
    seasons: [
      {
        id: "...",
        genre: "action",
        label: "Action Season 1",
        currentSlot: 3,
        totalSlots: 75,
        clipCount: 12,
        progress: 4  // percentage
      },
      // ...
    ]
  });
}
```

**Response format:**
```json
{
  "seasons": [
    {
      "id": "uuid",
      "genre": "action",
      "label": "Action Season 1",
      "currentSlot": 3,
      "totalSlots": 75,
      "clipCount": 12,
      "progress": 4
    },
    {
      "id": "uuid",
      "genre": "comedy",
      "label": "Comedy Season 1",
      "currentSlot": 1,
      "totalSlots": 75,
      "clipCount": 8,
      "progress": 1
    }
  ]
}
```

---

## Step 2.2: Update GET /api/vote

Add `genre` query parameter to filter by genre.

**File:** `src/app/api/vote/route.ts`

**Changes:**

```typescript
// Line ~576: Parse genre parameter
const genre = searchParams.get('genre'); // Optional, defaults to first active

// Line ~637: Update season query
let seasonQuery = supabase
  .from('seasons')
  .select('id, total_slots, status, genre')
  .eq('status', 'active');

// If genre specified, filter by it
if (genre) {
  seasonQuery = seasonQuery.eq('genre', genre);
}

const { data: season } = await seasonQuery
  .order('created_at', { ascending: true })
  .limit(1)
  .maybeSingle();

// If no genre specified and multiple seasons exist,
// return list of available genres instead of clips
if (!genre && multipleActiveSeasons) {
  return NextResponse.json({
    requiresGenreSelection: true,
    availableGenres: ['action', 'comedy', 'horror']
  });
}
```

**New response field:**
```json
{
  "clips": [...],
  "currentGenre": "action",
  "availableGenres": ["action", "comedy", "horror", "animation"]
}
```

---

## Step 2.3: Update POST /api/vote

No changes needed - already uses clip's `season_id` for validation.

Verify this flow:
1. Vote request contains `clipId`
2. Code fetches clip's `season_id`
3. Validates clip is in active voting slot for ITS season
4. Records vote

This already works for multiple seasons.

---

## Step 2.4: Update POST /api/upload

Match clip genre to season genre.

**File:** `src/app/api/upload/route.ts`

**Changes:**

```typescript
// Line ~290: Update season query to filter by clip's genre
const clipGenre = (body.genre || 'action').toLowerCase();

const { data: season, error: seasonError } = await supabase
  .from('seasons')
  .select('id, total_slots, genre')
  .eq('status', 'active')
  .eq('genre', clipGenre)  // ← Match genre!
  .single();

if (seasonError || !season) {
  return NextResponse.json({
    success: false,
    error: `No active season for genre: ${clipGenre}. Available genres: action, comedy, horror.`
  }, { status: 400 });
}
```

---

## Step 2.5: Update Admin Clip Approval

Verify admin approval assigns correct `slot_position` based on clip's season.

**File:** `src/app/api/admin/clips/[id]/route.ts`

Current code (lines 143-158) already uses `currentClip.season_id` to find the active voting slot. This should work correctly for multiple seasons.

**Verify:**
```typescript
// This already filters by the clip's season_id
const { data: activeSlot } = await supabase
  .from('story_slots')
  .select('slot_position')
  .eq('season_id', currentClip.season_id)  // ← Uses clip's season
  .eq('status', 'voting')
  ...
```

---

## Step 2.6: Caching Strategy

**Problem:** Current code caches `activeSeason` globally. With multi-genre, each genre has its own season.

**Fix:** Update cache keys to include genre:

```typescript
// In /api/vote/route.ts - Update the caching logic

// OLD (broken with multi-genre):
let season = getCached<SeasonRow>('activeSeason');

// NEW (genre-aware):
const cacheKey = genre ? `activeSeason_${genre}` : 'activeSeason';
let season = getCached<SeasonRow>(cacheKey);

// When setting cache:
setCache(cacheKey, season, CACHE_TTL.season);
```

**Response headers:**

```typescript
return NextResponse.json(response, {
  headers: {
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
    // CDN caches separate responses per genre query param
  }
});
```

---

## Step 2.7: Update Admin Seasons API

**File:** `src/app/api/admin/seasons/route.ts`

The admin API needs to support genre when creating seasons:

```typescript
// POST body now accepts genre
const {
  label,
  genre,  // ← NEW: required for multi-genre
  total_slots = 75,
  auto_activate = false,
} = body;

// Validation
if (!genre) {
  return NextResponse.json(
    { error: 'Genre is required for new seasons' },
    { status: 400 }
  );
}

// Check no duplicate active season for same genre
if (auto_activate) {
  const { data: existing } = await supabase
    .from('seasons')
    .select('id')
    .eq('status', 'active')
    .eq('genre', genre)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: `Active season already exists for genre: ${genre}` },
      { status: 400 }
    );
  }
}

// Create with genre
const { data: season } = await supabase
  .from('seasons')
  .insert({
    label,
    genre,  // ← Include genre
    total_slots,
    status: auto_activate ? 'active' : 'draft',
    created_at: new Date().toISOString(),
  })
  .select()
  .single();
```

---

# Phase 3: Frontend - Genre Swiper

## UX Approach: Horizontal Swipe

Instead of a modal picker, users **swipe horizontally** to switch between genres. Each genre is a separate "page" showing only that genre's clips.

**Benefits:**
- No modal interrupting the flow
- Users discover genres naturally by swiping
- More app-like feel (like TikTok's For You / Following tabs)
- Genre always visible at top
- Intuitive navigation

---

## Step 3.1: Create Genre Swiper Component

**File:** `src/components/GenreSwiper.tsx`

```typescript
interface GenreSwiperProps {
  genres: Array<{
    id: string;
    genre: string;
    label: string;
    currentSlot: number;
    totalSlots: number;
    clipCount: number;
  }>;
  initialGenre?: string;
  onGenreChange: (genre: string) => void;
  children: (genre: string) => React.ReactNode;
}
```

**Mobile Layout (2D Swipe Navigation):**
```
┌─────────────────────────────────────────────────────────┐
│           ·  ●  ·  ·  ·                                 │  ← Dot indicators
│              😂 COMEDY                                  │  ← Current genre
│              Slot 3/75  •  Clip 2 of 12                │  ← Progress
├─────────────────────────────────────────────────────────┤
│                         ↑                               │
│                    Swipe up                             │
│                   (prev clip)                           │
│                                                         │
│  ← Swipe     [Comedy Video Player]        Swipe →      │
│  (Action)                                  (Horror)     │
│                                                         │
│                   Swipe down                            │
│                   (next clip)                           │
│                         ↓                               │
├─────────────────────────────────────────────────────────┤
│              ❤️ Tap Vote    💔 Tap Skip                 │
└─────────────────────────────────────────────────────────┘
```

**Mobile Navigation:**
- **Swipe ← →** = Switch genres (horizontal)
- **Swipe ↑ ↓** = Switch clips within genre (vertical, like TikTok)
- **Tap Vote button** = Vote for current clip
- **Tap Skip button** = Skip current clip

**Desktop Layout: Tabs + 2D Keyboard Navigation**
```
┌──────────────────────────────────────────────────────────────────────┐
│  🎬 Action │ 😂 Comedy │ 👻 Horror │ 🎨 Animation                    │
│            │    ▼▼▼    │           │                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│                      [Comedy Video Player]                            │
│                                                                       │
│                      Slot 3/75  •  Clip 2 of 12                      │
│                                                                       │
├──────────────────────────────────────────────────────────────────────┤
│                      ❤️ Vote    💔 Skip                               │
├──────────────────────────────────────────────────────────────────────┤
│                   ← → genres    ↑ ↓ clips                            │
└──────────────────────────────────────────────────────────────────────┘
```

**Desktop Navigation:**
- **Click tabs** to switch genres
- **← →** arrow keys to switch genres (horizontal)
- **↑ ↓** arrow keys to switch clips within genre (vertical)
- **Click Vote button** to vote for current clip
- **Click Skip button** to skip current clip

---

## Step 3.2: Create useGenreSwiper Hook

**File:** `src/hooks/useGenreSwiper.ts`

```typescript
export function useGenreSwiper() {
  // State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load available genres from API
  useEffect(() => {
    fetch('/api/seasons/active')
      .then(res => res.json())
      .then(data => {
        setGenres(data.seasons);

        // Restore last viewed genre from localStorage
        const saved = localStorage.getItem('last_genre');
        if (saved) {
          const idx = data.seasons.findIndex(g => g.genre === saved);
          if (idx >= 0) setCurrentIndex(idx);
        }
        setIsLoading(false);
      });
  }, []);

  // Current genre
  const currentGenre = genres[currentIndex] || null;

  // Navigation
  const goToGenre = (index: number) => {
    if (index >= 0 && index < genres.length) {
      setCurrentIndex(index);
      localStorage.setItem('last_genre', genres[index].genre);
    }
  };

  const nextGenre = () => goToGenre(currentIndex + 1);
  const prevGenre = () => goToGenre(currentIndex - 1);

  return {
    genres,
    currentGenre,
    currentIndex,
    goToGenre,
    nextGenre,
    prevGenre,
    isLoading,
    hasNext: currentIndex < genres.length - 1,
    hasPrev: currentIndex > 0
  };
}
```

---

## Step 3.3: Implement Swiper with Swipe.js or Native

**Option A: Use Swiper.js library**

```bash
npm install swiper
```

```typescript
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination } from 'swiper/modules';

function GenreSwiper({ genres, onGenreChange }) {
  return (
    <Swiper
      modules={[Pagination]}
      pagination={{ clickable: true }}
      onSlideChange={(swiper) => onGenreChange(genres[swiper.activeIndex])}
      initialSlide={initialIndex}
    >
      {genres.map((genre) => (
        <SwiperSlide key={genre.id}>
          <GenreVotingArea genre={genre.genre} />
        </SwiperSlide>
      ))}
    </Swiper>
  );
}
```

**Option B: Native CSS scroll-snap**

```typescript
function GenreSwiper({ genres }) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      className="flex overflow-x-auto snap-x snap-mandatory"
      style={{ scrollSnapType: 'x mandatory' }}
    >
      {genres.map((genre) => (
        <div
          key={genre.id}
          className="min-w-full snap-center"
        >
          <GenreVotingArea genre={genre.genre} />
        </div>
      ))}
    </div>
  );
}
```

---

## Step 3.4: Update Dashboard Page

**File:** `src/app/dashboard/page.tsx`

**Changes:**

1. Replace single video player with GenreSwiper
2. Each swipe page fetches its own genre's clips
3. Prefetch adjacent genres for smooth transitions

```typescript
function DashboardContent() {
  const { genres, currentGenre, currentIndex, goToGenre, isLoading } = useGenreSwiper();

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="h-full">
      {/* Genre indicator header */}
      <GenreHeader
        genre={currentGenre}
        genres={genres}
        currentIndex={currentIndex}
      />

      {/* Swipeable genre pages */}
      <GenreSwiper
        genres={genres}
        initialIndex={currentIndex}
        onIndexChange={goToGenre}
      >
        {(genre) => (
          <VotingArea genre={genre.genre} seasonId={genre.id} />
        )}
      </GenreSwiper>
    </div>
  );
}
```

---

## Step 3.5: Genre Header with Dots/Tabs

**File:** `src/components/GenreHeader.tsx`

**Mobile: Dots + Current Genre Name**
```
┌─────────────────────────────────────┐
│      ·  ·  ●  ·  ·                  │  ← Swipeable dots
│         👻 HORROR                   │
│        Slot 5/75                    │
└─────────────────────────────────────┘
```

**Desktop: Clickable Tabs + Keyboard Hint**
```
┌──────────────────────────────────────────────────────────────────┐
│  🎬 Action │ 😂 Comedy │ 👻 Horror │ 🎨 Animation    ← → to switch│
│            │    ▼▼▼    │           │                              │
└──────────────────────────────────────────────────────────────────┘
```

```typescript
function GenreHeader({ genre, genres, currentIndex, onSelectIndex }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="text-center py-2">
        {/* Dot indicators */}
        <div className="flex justify-center gap-1 mb-1">
          {genres.map((g, i) => (
            <span
              key={g.id}
              className={`w-2 h-2 rounded-full ${
                i === currentIndex ? 'bg-white' : 'bg-white/30'
              }`}
            />
          ))}
        </div>
        {/* Current genre */}
        <div className="text-lg font-bold">
          {genreEmoji[genre.genre]} {genre.label}
        </div>
        <div className="text-sm opacity-70">
          Slot {genre.currentSlot}/{genre.totalSlots}
        </div>
      </div>
    );
  }

  // Desktop: tabs (keyboard hints shown in footer)
  return (
    <div className="flex border-b items-center">
      {genres.map((g, i) => (
        <button
          key={g.id}
          onClick={() => onSelectIndex(i)}
          className={`px-4 py-2 ${
            i === currentIndex ? 'border-b-2 border-white' : 'opacity-50'
          }`}
        >
          {genreEmoji[g.genre]} {g.label}
        </button>
      ))}
    </div>
  );
}
```

---

## Step 3.5b: Keyboard Hints Footer (Desktop)

**File:** `src/components/KeyboardHints.tsx`

Shows keyboard shortcuts at bottom of voting area (desktop only):

```typescript
function KeyboardHints() {
  return (
    <div className="hidden md:flex justify-center gap-6 text-sm opacity-50 py-2">
      <span>← → genres</span>
      <span>↑ ↓ clips</span>
    </div>
  );
}
```

---

## Step 3.6: 2D Keyboard Navigation (Desktop)

**2D Navigation Grid (same on mobile & desktop):**
```
                    ← ACTION │ COMEDY │ HORROR →      ← → = Genres
                             │   ▼    │
                    ─────────┼────────┼─────────
                             │        │
                      ↑      │   ↑    │    ↑
                   Clip 1    │Clip 1  │ Clip 1
                      ↓      │   ↓    │    ↓          ↑ ↓ = Clips
                   Clip 2    │Clip 2  │ Clip 2
                      ↓      │   ↓    │    ↓
                   Clip 3    │Clip 3  │ Clip 3
                             │        │
```

**Input Methods:**
| Action | Mobile | Desktop |
|--------|--------|---------|
| Switch genres | Swipe ← → | Arrow keys ← → or click tabs |
| Switch clips | Swipe ↑ ↓ | Arrow keys ↑ ↓ |
| Vote | Tap button | Click button |
| Skip | Tap button | Click button |

**Keyboard Mapping (navigation only):**
| Key | Action |
|-----|--------|
| `←` | Previous genre |
| `→` | Next genre |
| `↑` | Previous clip in current genre |
| `↓` | Next clip in current genre |

**Vote/Skip:** Click buttons with mouse (no keyboard shortcuts)

**File:** `src/hooks/useKeyboardNavigation.ts`

```typescript
interface KeyboardNavigationOptions {
  onPrevGenre: () => void;
  onNextGenre: () => void;
  onPrevClip: () => void;
  onNextClip: () => void;
  enabled?: boolean;
}

export function useKeyboardNavigation({
  onPrevGenre,
  onNextGenre,
  onPrevClip,
  onNextClip,
  enabled = true
}: KeyboardNavigationOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        // Horizontal: Switch genres
        case 'ArrowLeft':
          e.preventDefault();
          onPrevGenre();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onNextGenre();
          break;

        // Vertical: Switch clips within genre
        case 'ArrowUp':
          e.preventDefault();
          onPrevClip();
          break;
        case 'ArrowDown':
          e.preventDefault();
          onNextClip();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPrevGenre, onNextGenre, onPrevClip, onNextClip, enabled]);
}
```

**Usage in Dashboard:**

```typescript
function DashboardContent() {
  const { nextGenre, prevGenre } = useGenreSwiper();
  const { clips, currentClipIndex, nextClip, prevClip } = useClips(currentGenre);
  const isMobile = useIsMobile();

  // Enable 2D keyboard navigation on desktop
  useKeyboardNavigation({
    onPrevGenre: prevGenre,
    onNextGenre: nextGenre,
    onPrevClip: prevClip,
    onNextClip: nextClip,
    enabled: !isMobile
  });

  return (
    // ... Vote/Skip are click-only buttons
  );
}
```

---

## Step 3.7: Prefetch Adjacent Genres

For smooth UX, prefetch clips for genres next to current:

```typescript
function VotingArea({ genre, seasonId }) {
  // Fetch current genre's clips
  const { data } = useSWR(`/api/vote?genre=${genre}`, fetcher);

  // Prefetch adjacent genres (doesn't render, just caches)
  const { genres, currentIndex } = useGenreSwiper();

  useSWR(
    currentIndex > 0 ? `/api/vote?genre=${genres[currentIndex - 1].genre}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  useSWR(
    currentIndex < genres.length - 1 ? `/api/vote?genre=${genres[currentIndex + 1].genre}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  return <VideoPlayer clips={data?.clips} />;
}
```

---

## Step 3.8: Swipe Hints for New Users (Mobile Only)

Show subtle hints that swiping is possible:

```
First visit:
┌─────────────────────────────────────┐
│      ← Swipe to see more genres →   │  ← Hint text (fades after 3s)
│         😂 COMEDY                   │
└─────────────────────────────────────┘
```

```typescript
function SwipeHint() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const seen = localStorage.getItem('swipe_hint_seen');
    if (seen) {
      setShow(false);
      return;
    }

    const timer = setTimeout(() => {
      setShow(false);
      localStorage.setItem('swipe_hint_seen', 'true');
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="text-center text-sm opacity-50 animate-pulse">
      ← Swipe to see more genres →
    </div>
  );
}
```

---

## Step 3.9: Genre Empty States

Handle genres with no clips gracefully:

```typescript
function GenreEmptyState({ genre }: { genre: Genre }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <span className="text-6xl mb-4">{getGenreEmoji(genre.genre)}</span>
      <h2 className="text-xl font-bold mb-2">No {genre.label} clips yet</h2>
      <p className="text-gray-400 mb-6">
        Be the first to upload a clip for the {genre.label} movie!
      </p>
      <Link
        href={`/upload?genre=${genre.genre}`}
        className="bg-gradient-to-r from-pink-500 to-purple-500 px-6 py-3 rounded-full font-semibold"
      >
        Upload {genre.label} Clip
      </Link>
    </div>
  );
}
```

---

## Step 3.10: Cross-Genre Discovery

Periodically prompt users to explore other genres:

```typescript
function useGenreDiscovery(currentGenre: string, genres: Genre[]) {
  const [suggestion, setSuggestion] = useState<Genre | null>(null);

  useEffect(() => {
    // After 10 votes in same genre, suggest another
    const votesInGenre = parseInt(localStorage.getItem(`votes_${currentGenre}`) || '0');

    if (votesInGenre > 0 && votesInGenre % 10 === 0) {
      const others = genres.filter(g => g.genre !== currentGenre && g.clipCount > 0);
      if (others.length > 0) {
        const random = others[Math.floor(Math.random() * others.length)];
        setSuggestion(random);
      }
    }
  }, [currentGenre, genres]);

  const dismiss = () => setSuggestion(null);

  return { suggestion, dismiss };
}
```

**UI:**
```
┌─────────────────────────────────────┐
│  🎨 Animation has 15 clips waiting! │
│  [Check it out]         [Not now]   │
└─────────────────────────────────────┘
```

---

## Step 3.11: Integration with Existing Dashboard

**Critical:** The current `dashboard/page.tsx` is complex. Here's the integration strategy:

```typescript
// dashboard/page.tsx - Key changes

// 1. Add genre state at top level
const { genres, currentGenre, currentIndex, goToGenre } = useGenreSwiper();

// 2. Update the clip fetch to include genre
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['votingClips', currentGenre?.genre],  // ← Add genre to key
  queryFn: async () => {
    const params = new URLSearchParams({
      limit: String(CLIPS_PER_SESSION),
      genre: currentGenre?.genre || '',  // ← Pass genre
    });
    const res = await fetch(`/api/vote?${params}`);
    // ...
  },
  enabled: !!currentGenre,  // ← Only fetch when genre selected
});

// 3. Wrap video player in GenreSwiper
return (
  <GenreSwiper
    genres={genres}
    currentIndex={currentIndex}
    onIndexChange={goToGenre}
  >
    {/* Existing video player + vote buttons go here */}
    <VideoPlayer ... />
  </GenreSwiper>
);

// 4. Update realtime subscriptions to filter by genre
useRealtimeClips({
  seasonId: currentGenre?.id,  // ← Subscribe to current genre's season
  // ...
});
```

**Preserve existing features:**
- ✅ Confetti on vote
- ✅ Sound effects
- ✅ Comments panel
- ✅ Realtime updates (per-genre)
- ✅ Vote streak tracking (global across genres)
- ✅ Remaining votes (shared limit)

---

# Phase 4: Frontend - Upload Flow

## Step 4.1: Update Upload Page Genre Selection

**File:** `src/app/upload/page.tsx`

**Changes:**

1. Fetch available genres from API
2. Only show genres with active seasons
3. Pre-select user's current genre
4. Validate genre before upload

```typescript
// Genre selection step
<div className="genre-selection">
  <h3>Select Genre</h3>
  <p>Your clip will compete in this genre's movie</p>

  {availableGenres.map(g => (
    <button
      key={g.genre}
      onClick={() => setSelectedGenre(g.genre)}
      className={selectedGenre === g.genre ? 'selected' : ''}
    >
      {genreEmoji[g.genre]} {g.label}
      <span className="progress">Slot {g.currentSlot}/75</span>
    </button>
  ))}
</div>
```

---

## Step 4.2: Update Upload API Call

Include genre in upload request:

```typescript
const formData = new FormData();
formData.append('video', file);
formData.append('genre', selectedGenre);  // ← Add genre

const response = await fetch('/api/upload', {
  method: 'POST',
  body: formData
});
```

---

## Step 4.3: Update Upload Success Screen

Show which genre's movie the clip was submitted to:

```
┌─────────────────────────────────────┐
│                                     │
│            ✅ Uploaded!             │
│                                     │
│  Your clip is now pending review    │
│  for the 🎬 ACTION movie.           │
│                                     │
│  Current slot: 3/75                 │
│  Clips competing: 13                │
│                                     │
│     [View My Clips]  [Upload More]  │
│                                     │
└─────────────────────────────────────┘
```

---

# Phase 5: Frontend - Story Page

## Step 5.1: Add Genre Tabs to Story Page

**File:** `src/app/story/page.tsx`

**Changes:**

```
┌─────────────────────────────────────────────────────────────────┐
│  STORY                                                          │
├─────────────────────────────────────────────────────────────────┤
│  [🎬 Action] [😂 Comedy] [👻 Horror] [🎨 Animation]             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                   📹 Action Movie                               │
│                                                                 │
│  Slot 1 ✓  Slot 2 ✓  Slot 3 ▶  Slot 4 ○  ...                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 5.2: Update Story API

**File:** `src/app/api/story/route.ts`

Add genre filter:

```typescript
const genre = searchParams.get('genre');

let query = supabase
  .from('seasons')
  .select(`
    *,
    story_slots(*),
    tournament_clips(*)
  `)
  .eq('status', 'active');

if (genre) {
  query = query.eq('genre', genre);
}
```

---

## Step 5.3: Multiple Movie Progress Display

Show progress for all genres:

```
┌─────────────────────────────────────┐
│  Movies Being Built                 │
├─────────────────────────────────────┤
│                                     │
│  🎬 ACTION        ████░░░░  3/75    │
│  😂 COMEDY        █░░░░░░░  1/75    │
│  👻 HORROR        █████░░░  5/75    │
│  🎨 ANIMATION     ██░░░░░░  2/75    │
│                                     │
│  [Watch Action]  [Watch Comedy]     │
│                                     │
└─────────────────────────────────────┘
```

---

# Phase 6: Testing & Polish

## Step 6.1: Test Cases

### Database Tests
- [ ] Migration adds `genre` column to `seasons` table
- [ ] Unique index prevents duplicate active seasons per genre
- [ ] Multiple seasons created with correct genres
- [ ] Each season has 75 slots
- [ ] Slot 1 is 'voting' (or 'locked' if AI clip added)
- [ ] No duplicate genres in active seasons
- [ ] Existing season data preserved after migration

### API Tests
- [ ] GET /api/seasons/active returns all active seasons with genre info
- [ ] GET /api/vote?genre=action returns only action clips
- [ ] GET /api/vote?genre=comedy returns only comedy clips
- [ ] GET /api/vote without genre returns first genre's clips (backwards compat)
- [ ] POST /api/upload with genre=comedy creates clip in comedy season
- [ ] POST /api/upload with invalid genre returns 400 error
- [ ] POST /api/upload with no genre returns 400 error (require genre)
- [ ] POST /api/vote works across different genre seasons
- [ ] Caching works correctly per-genre (not shared)
- [ ] Rate limiting shared across genres (not per-genre)

### Frontend Tests
- [ ] Genre swiper renders all active genres
- [ ] Horizontal swipe switches genres (mobile)
- [ ] Arrow keys switch genres (desktop)
- [ ] Arrow up/down switch clips (desktop)
- [ ] Clicking tabs switches genres (desktop)
- [ ] Genre saves to localStorage on change
- [ ] Page load restores saved genre preference
- [ ] Invalid saved genre falls back to first genre
- [ ] Empty genre shows upload CTA
- [ ] Upload form pre-selects current genre
- [ ] Story page tabs match available genres
- [ ] Progress bars update correctly per genre

### Edge Cases
- [ ] User has saved genre that was removed → fallback to first
- [ ] Season finishes (75 slots) → show completion celebration
- [ ] No clips in any genre → show "coming soon" state
- [ ] Admin deactivates a genre mid-session → remove from swiper
- [ ] Admin adds new genre mid-session → appears on refresh
- [ ] Network error loading genres → show retry button
- [ ] Slow network → show loading skeletons per genre

### Regression Tests (Existing Features)
- [ ] Confetti still works on vote
- [ ] Sound effects still work
- [ ] Comments panel still works
- [ ] Realtime vote updates still work
- [ ] Vote streak tracking still works
- [ ] Daily vote limit still enforced (shared across genres)
- [ ] Leaderboard still shows correct data
- [ ] Profile stats still accurate

---

## Step 6.2: Performance Considerations

1. **Caching:** Vary cache by genre parameter
2. **Prefetching:** Prefetch adjacent genres' data
3. **Lazy loading:** Only load clips for selected genre
4. **localStorage:** Cache genre list client-side

---

## Step 6.3: Analytics Events

Track genre-related events:

```typescript
// Track genre selection
analytics.track('genre_selected', { genre: 'comedy' });

// Track genre switch
analytics.track('genre_switched', { from: 'action', to: 'comedy' });

// Track upload by genre
analytics.track('clip_uploaded', { genre: 'horror' });

// Track votes by genre
analytics.track('vote_cast', { genre: 'action', clipId: '...' });

// Track genre engagement (time spent)
analytics.track('genre_engagement', {
  genre: 'action',
  duration_seconds: 120,
  clips_viewed: 5,
  votes_cast: 3
});
```

---

## Step 6.4: Rollback Plan

**If multi-genre causes issues, here's how to rollback:**

### Quick Rollback (Frontend Only)
1. Set feature flag `multi_genre_enabled` to `false`
2. Frontend falls back to single-season behavior
3. No database changes needed

**Add feature flag:**
```sql
INSERT INTO feature_flags (flag_name, is_enabled, description)
VALUES ('multi_genre_enabled', true, 'Enable multi-genre seasons with horizontal swipe');
```

**Frontend check:**
```typescript
const multiGenreEnabled = useFeature('multi_genre_enabled');

if (!multiGenreEnabled) {
  // Render old single-genre dashboard
  return <LegacyDashboard />;
}

// Render new multi-genre swiper
return <GenreSwiper ... />;
```

### Full Rollback (If Needed)
1. Disable feature flag
2. Archive all but one active season
3. Keep the most popular genre's season active

```sql
-- Keep only Action season active, archive others
UPDATE seasons
SET status = 'archived'
WHERE status = 'active' AND genre != 'action';
```

---

## Step 6.5: Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Database migration fails | Low | High | Test on staging first, backup before |
| Genre swiper performance | Medium | Medium | Virtual scrolling, lazy loading |
| Users confused by genres | Medium | Low | Onboarding hints, clear labels |
| Uneven genre popularity | High | Low | Show clip counts, cross-genre prompts |
| Cache invalidation issues | Medium | Medium | Genre-aware cache keys |
| Realtime updates break | Low | High | Test thoroughly, feature flag |

---

## Step 6.6: Monitoring

After launch, monitor these metrics:

```typescript
// Key metrics dashboard
const metrics = {
  // Genre distribution
  clips_per_genre: 'COUNT(*) GROUP BY genre',
  votes_per_genre: 'COUNT(*) GROUP BY genre',

  // User behavior
  genre_switches_per_session: 'AVG(switches)',
  time_per_genre: 'AVG(duration_seconds) GROUP BY genre',

  // Performance
  api_latency_by_genre: 'p95(duration) GROUP BY genre',
  error_rate_by_genre: 'COUNT(errors) / COUNT(*) GROUP BY genre',

  // Engagement
  bounce_rate_by_genre: 'Users who left within 10s GROUP BY genre',
  return_rate_by_genre: 'Users who came back GROUP BY genre',
};
```

---

# Summary

## Files to Create

| File | Purpose | Priority |
|------|---------|----------|
| `src/lib/genres.ts` | Centralized genre definitions | P0 |
| `src/app/api/seasons/active/route.ts` | List active seasons with genre info | P0 |
| `src/components/GenreSwiper.tsx` | Horizontal swipe between genres | P0 |
| `src/components/GenreHeader.tsx` | Dots (mobile) / Tabs (desktop) | P0 |
| `src/components/GenreEmptyState.tsx` | Empty state for genres with no clips | P1 |
| `src/components/KeyboardHints.tsx` | Keyboard shortcut hints (desktop) | P1 |
| `src/components/SwipeHint.tsx` | First-time swipe hint (mobile) | P2 |
| `src/hooks/useGenreSwiper.ts` | Genre swiper state management | P0 |
| `src/hooks/useKeyboardNavigation.ts` | 2D arrow key navigation (desktop) | P1 |
| `src/hooks/useGenreDiscovery.ts` | Cross-genre suggestions | P2 |

## Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| `src/app/api/vote/route.ts` | Add genre filter, update cache keys | P0 |
| `src/app/api/upload/route.ts` | Require genre, match to season | P0 |
| `src/app/api/admin/seasons/route.ts` | Support genre in create/update | P0 |
| `src/app/dashboard/page.tsx` | Integrate GenreSwiper | P0 |
| `src/app/upload/page.tsx` | Genre selection UI | P1 |
| `src/app/story/page.tsx` | Genre tabs | P1 |

## Database Changes

| Change | Type | Priority |
|--------|------|----------|
| Add `genre` column to `seasons` | Migration | P0 (FIRST) |
| Add index `idx_seasons_genre` | Migration | P0 |
| Add unique constraint on active+genre | Migration | P0 |
| Insert genre seasons (action, comedy, horror, animation) | Data | P0 |
| Create 75 slots per new season | Data | P0 |
| Add `multi_genre_enabled` feature flag | Data | P1 |

---

## Implementation Order (Dependencies)

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Database (MUST DO FIRST)                          │
│  ├── 1.0 Migration: Add genre column                        │
│  ├── 1.1 Create src/lib/genres.ts                          │
│  └── 1.2 Insert seasons + slots                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Backend APIs (Depends on Phase 1)                 │
│  ├── 2.1 Create /api/seasons/active                        │
│  ├── 2.2 Update /api/vote (add genre param)                │
│  ├── 2.4 Update /api/upload (require genre)                │
│  └── 2.7 Update /api/admin/seasons                         │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: Frontend Core (Depends on Phase 2)                │
│  ├── 3.1 GenreSwiper component                             │
│  ├── 3.2 useGenreSwiper hook                               │
│  ├── 3.4 Update dashboard/page.tsx                         │
│  └── 3.5 GenreHeader component                             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 4-5: Secondary Features (Can parallelize)            │
│  ├── 4.x Upload flow with genre                            │
│  ├── 5.x Story page with genre tabs                        │
│  ├── 3.6 Keyboard navigation                               │
│  └── 3.8-3.10 Hints, empty states, discovery               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Phase 6: Testing & Polish                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Open Questions

1. **Which genres to launch with?**
   - Recommended: Action, Comedy, Horror, Animation (4 genres)
   - Start small, expand later

2. **AI opening clips - do you have them?**
   - Need one 8-second clip per genre
   - Can skip and start at slot 1 with 'voting' status

3. **Default genre for new users?**
   - Swiper starts at first genre (Action)
   - User can swipe to explore others

4. **Shared daily vote limit or per-genre?**
   - Recommended: Shared 200 limit across all genres
   - Prevents gaming by creating multiple accounts per genre

5. **Genre order in swiper?**
   - Recommended: Alphabetical for consistency
   - Could later sort by "hot" (most activity)

6. **What happens when a genre's movie finishes (75 slots)?**
   - Option A: Auto-start Season 2 for that genre
   - Option B: Show "completed" badge, no more voting
   - Recommended: Auto-start Season 2

---

## Risk Checklist

Before deploying, verify:

- [ ] Database migration tested on staging
- [ ] Database backup created before production migration
- [ ] Feature flag `multi_genre_enabled` added and set to `false`
- [ ] All API endpoints work with genre parameter
- [ ] Dashboard works with feature flag OFF (backwards compat)
- [ ] Dashboard works with feature flag ON
- [ ] Mobile swipe gestures smooth (test on real device)
- [ ] Desktop keyboard navigation works
- [ ] Realtime updates work per-genre
- [ ] Cache invalidation works per-genre
- [ ] No regression in existing features

---

## Next Steps

1. ✅ Review this plan
2. ⬜ Answer open questions above
3. ⬜ **Phase 1:** Run database migration (genre column)
4. ⬜ **Phase 1:** Create `src/lib/genres.ts`
5. ⬜ **Phase 1:** Insert genre seasons via SQL
6. ⬜ **Phase 2:** Implement API changes
7. ⬜ **Phase 3:** Build GenreSwiper + integrate with dashboard
8. ⬜ **Phase 4-5:** Upload + Story pages
9. ⬜ **Phase 6:** Test thoroughly
10. ⬜ Deploy with feature flag OFF
11. ⬜ Enable feature flag, monitor
12. ⬜ Celebrate 🎉
