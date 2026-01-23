# Super/Mega Vote Code Removal

**Date:** 2026-01-23 21:13:23
**Commit:** `4f639d9`
**Author:** Claude Opus 4.5

---

## Summary

Removed all super and mega vote functionality from the codebase. The voting system now only supports standard votes (weight=1). This cleanup was performed because super and mega votes are no longer being used.

---

## Changes Overview

| Metric | Value |
|--------|-------|
| Files Modified | 7 |
| Lines Removed | ~307 |
| Lines Added | ~56 |

---

## Detailed Changes

### 1. `src/app/api/vote/route.ts`

**Major API cleanup:**

- Removed `VoteType` enum - now only supports `'standard'`
- Simplified `VotingStateResponse.remainingVotes` to only have `standard` property
- Simplified `VoteResponseBody.remainingVotes` to only have `standard` property
- Removed `calculateRemainingSpecialVotes` function calls
- Simplified vote weight calculation to always return `1`
- Removed special vote limit checks in POST handler (lines 1273-1348 removed)
- Removed super/mega error handlers (`SUPER_LIMIT_EXCEEDED`, `MEGA_LIMIT_EXCEEDED`)
- Updated RPC call to always pass `p_vote_type: 'standard'` and `p_is_power_vote: false`
- Simplified audit logging (removed voteType from logged details)
- Updated DELETE handler to remove revokedVoteType from response

**Before:**
```typescript
remainingVotes: {
  standard: number;
  super: number;
  mega: number;
}
```

**After:**
```typescript
remainingVotes: {
  standard: number;
}
```

---

### 2. `src/app/dashboard/page.tsx`

**UI cleanup:**

- Removed `VoteType` type alias
- Simplified `APIVotingResponse.remainingVotes` interface
- Simplified `VotingState.remainingVotes` interface
- Removed `voteType` from `VoteResponse` interface
- Updated `PowerVoteButtonProps` - removed `superRemaining` and `megaRemaining` props
- Simplified `PowerVoteButton` component - removed voteType parameter from `onVote`
- Updated vote mutation:
  - Removed voteType from mutation variables
  - Simplified vibration feedback (no special patterns for super/mega)
  - Removed vote weight calculation (always 1)
  - Removed super/mega confetti and toast messages
- Updated revoke mutation:
  - Removed `revokedVoteType` from response type
  - Simplified success toast (no type-specific messages)
- Updated `handleVote` function - removed voteType parameter
- Updated all `handleVote()` calls to not pass type argument

**Removed code:**
```typescript
// Sound effects for special votes
if (voteType === 'mega') {
  sounds.play('megaVote');
  confettiLib({ particleCount: 150, spread: 100 });
  toast.success('MEGA VOTE! 10x Power!', { icon: '💎' });
} else if (voteType === 'super') {
  sounds.play('superVote');
  confettiLib({ particleCount: 100, spread: 80 });
  toast.success('SUPER VOTE! 3x Power!', { icon: '⚡' });
}
```

---

### 3. `src/lib/validations.ts`

**Schema simplification:**

- Removed `VoteTypeSchema` enum validation
- Simplified `VoteRequestSchema` to only require `clipId`

**Before:**
```typescript
export const VoteTypeSchema = z.enum(['standard', 'super', 'mega']);

export const VoteRequestSchema = z.object({
  clipId: z.string().uuid('Invalid clip ID format'),
  voteType: VoteTypeSchema.default('standard'),
});
```

**After:**
```typescript
export const VoteRequestSchema = z.object({
  clipId: z.string().uuid('Invalid clip ID format'),
});
```

---

### 4. `src/types/index.ts`

**Type cleanup:**

- Simplified `RemainingVotes` interface (removed super/mega)
- Simplified `VoteResponse` interface (removed voteType, simplified error codes)
- Simplified `LeaderboardVoter` interface (removed superVotesUsed, megaVotesUsed)

**Before:**
```typescript
export interface RemainingVotes {
  standard: number;
  super: number;
  mega: number;
}

export interface VoteResponse {
  success: boolean;
  clipId: string;
  voteType: 'standard' | 'super' | 'mega';
  newScore: number;
  totalVotesToday?: number;
  remainingVotes?: RemainingVotes;
  error?: string;
  code?: 'ALREADY_VOTED' | 'DAILY_LIMIT' | 'SUPER_LIMIT' | 'MEGA_LIMIT';
}
```

**After:**
```typescript
export interface RemainingVotes {
  standard: number;
}

export interface VoteResponse {
  success: boolean;
  clipId: string;
  newScore: number;
  totalVotesToday?: number;
  remainingVotes?: RemainingVotes;
  error?: string;
  code?: 'ALREADY_VOTED' | 'DAILY_LIMIT';
}
```

---

### 5. `src/lib/sounds.ts`

**Sound effect cleanup:**

- Removed `'superVote'` and `'megaVote'` from `SoundType` union
- Removed case handlers for super and mega vote sounds

**Before:**
```typescript
type SoundType = 'vote' | 'superVote' | 'megaVote' | 'milestone' | 'error';

case 'superVote':
  this.playTone(660, 0.12, 'sine', 0.25);
  setTimeout(() => this.playTone(880, 0.12, 'sine', 0.25), 80);
  setTimeout(() => this.playTone(1100, 0.15, 'sine', 0.3), 160);
  break;

case 'megaVote':
  this.playTone(440, 0.15, 'sine', 0.3);
  setTimeout(() => this.playTone(660, 0.12, 'sine', 0.3), 100);
  setTimeout(() => this.playTone(880, 0.12, 'sine', 0.3), 200);
  setTimeout(() => this.playTone(1100, 0.15, 'sine', 0.35), 300);
  setTimeout(() => this.playTone(1320, 0.2, 'sine', 0.4), 400);
  break;
```

**After:**
```typescript
type SoundType = 'vote' | 'milestone' | 'error';
// Only vote, milestone, and error sounds remain
```

---

### 6. `src/app/clip/[id]/ClipPageClient.tsx`

**Clip page cleanup:**

- Removed `vote_type` from `ClipAPIResponse.user_vote` interface
- Removed `voteType` state variable
- Removed `setVoteType` call in fetch effect
- Simplified `handleVote` function (no type parameter)
- Updated vote API call to not send voteType
- Simplified vote count calculation (always +1)

**Before:**
```typescript
const handleVote = async (type: 'standard' | 'super' | 'mega' = 'standard') => {
  // ...
  body: JSON.stringify({ clipId: clip.id, voteType: type }),
  // ...
  setVoteCount(data.newScore || voteCount + (type === 'mega' ? 10 : type === 'super' ? 3 : 1));
};
```

**After:**
```typescript
const handleVote = async () => {
  // ...
  body: JSON.stringify({ clipId: clip.id }),
  // ...
  setVoteCount(data.newScore || voteCount + 1);
};
```

---

### 7. `src/app/api/notifications/route.ts`

**Bug fix:**

- Changed rate limit type from `'write'` to `'api'` (valid type)

---

## Database Considerations

The database schema still supports `vote_type` column in the `votes` table for backwards compatibility with existing data. All new votes will be recorded as `'standard'` type with `vote_weight: 1`.

No database migrations are required for this change.

---

## Testing Checklist

- [ ] Standard voting works on dashboard
- [ ] Standard voting works on clip detail page
- [ ] Vote revocation works correctly
- [ ] Daily vote limit (200) still enforced
- [ ] Milestone confetti still triggers at 1, 50, 100, 200 votes
- [ ] Vote sound effect plays on vote
- [ ] Error sound plays on vote failure
- [ ] Real-time vote updates still work

---

## Rollback Instructions

If needed, revert to commit `dcec0a4`:

```bash
git revert 4f639d9
# or
git reset --hard dcec0a4
```

---

## Related Files Not Modified

The following files reference votes but did not need changes:

- `supabase/sql/fix-vote-insert-race-condition.sql` - RPC function still accepts vote_type parameter for backwards compatibility
- `supabase/sql/fix-special-vote-race-condition.sql` - Partial indexes for special votes (can be removed in future cleanup)
- Database triggers - Still support vote_weight for existing data
