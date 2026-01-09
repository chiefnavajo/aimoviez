# Warnings Fix Plan

**Created:** 2026-01-04
**Status:** Pending approval

## Recommended: Fix 5 Dead Code Items (5 min, zero risk)

### 1. Remove `showPulse` state
**File:** `src/components/MiniLeaderboard.tsx:43`
```typescript
// DELETE this line - state is set but never read
const [showPulse, setShowPulse] = useState(false);
```

### 2. Remove `likingComments` state
**File:** `src/components/CommentsSection.tsx:85`
```typescript
// DELETE this line - ref does the job, state is redundant
const [likingComments, setLikingComments] = useState<Set<string>>(new Set());
```

### 3. Remove `X` import
**File:** `src/app/story/page.tsx:44`
```typescript
// Remove 'X' from the lucide-react imports
```

### 4. Remove `actualVoteCount` variable
**File:** `src/app/api/vote/route.ts:1431`
```typescript
// DELETE this line - assigned but never used
const actualVoteCount = updatedClip?.vote_count ?? newVoteCount;
```

### 5. Remove `higherRanked` destructure
**File:** `src/app/api/profile/stats/route.ts:246`
```typescript
// Change from:
const { count: higherRanked } = await supabase...
// To:
await supabase...  // just execute, don't capture unused value
```

---

## Leave Alone (not worth the risk/effort)

- 59 `any` type warnings - would take 4+ hours, high risk
- React hooks exhaustive-deps warning - working correctly as-is
- `hasVotedOnClip` function - might be needed later
- `voteType` state - might be for future UI
- `index`, `isSwipeDown` props - harmless

---

## Summary

| Before | After |
|--------|-------|
| 70 warnings | 65 warnings |
| 5 dead code items | 0 dead code items |

**Time:** ~5 minutes
**Risk:** Zero
