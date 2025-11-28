# Hybrid Voting System

## Overview

AiMoviez uses a **hybrid voting system** designed to balance fairness, engagement, and preference expression across a 75-part collaborative movie.

## Core Rules

| Rule | Limit | Purpose |
|------|-------|---------|
| **1 vote per clip** | Cannot vote twice on same clip | Prevents vote dumping |
| **Vote on multiple clips** | Up to 30 clips per round | Encourages exploration |
| **Daily vote limit** | 200 votes/day | Prevents spam |
| **Super vote** | 1 per round (3x weight) | Express strong preference |
| **Mega vote** | 1 per round (10x weight) | "Golden buzzer" for favorites |

## Vote Weights

| Vote Type | Weight | Limit |
|-----------|--------|-------|
| Standard | 1x | 200/day |
| Super | 3x | 1/round |
| Mega | 10x | 1/round |

## API Endpoints

### GET /api/vote

Returns current voting state including:
- All clips in current round
- Which clips user has already voted on
- Remaining votes (standard, super, mega)
- Current slot position (1-75)

**Response:**
```json
{
  "clips": [...],
  "totalVotesToday": 45,
  "remainingVotes": {
    "standard": 155,
    "super": 1,
    "mega": 0
  },
  "votedClipIds": ["clip-1", "clip-2"],
  "currentSlot": 12,
  "totalSlots": 75
}
```

### POST /api/vote

Cast a vote on a clip.

**Request:**
```json
{
  "clipId": "uuid-here",
  "voteType": "standard" | "super" | "mega"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "clipId": "uuid-here",
  "voteType": "standard",
  "newScore": 42,
  "totalVotesToday": 46,
  "remainingVotes": {
    "standard": 154,
    "super": 1,
    "mega": 0
  }
}
```

**Error Responses:**

| Status | Code | Meaning |
|--------|------|---------|
| 409 | `ALREADY_VOTED` | Already voted on this clip |
| 429 | `DAILY_LIMIT` | 200 daily votes exhausted |
| 429 | `SUPER_LIMIT` | Super vote used this round |
| 429 | `MEGA_LIMIT` | Mega vote used this round |
| 404 | - | Clip not found |

## Database Schema

### votes table additions

```sql
ALTER TABLE votes
  ADD COLUMN slot_position integer,
  ADD COLUMN vote_type text DEFAULT 'standard',
  ADD CONSTRAINT votes_unique_voter_clip UNIQUE (voter_key, clip_id);
```

### Indexes

```sql
CREATE INDEX idx_votes_voter_slot ON votes(voter_key, slot_position);
CREATE INDEX idx_votes_voter_slot_type ON votes(voter_key, slot_position, vote_type);
CREATE INDEX idx_votes_voter_created ON votes(voter_key, created_at);
```

## Frontend Integration

### Clip Display

Each clip includes `has_voted: boolean` to show vote state:

```tsx
{clip.has_voted ? (
  <span className="text-green-500">✓ Voted</span>
) : (
  <VoteButton clipId={clip.id} />
)}
```

### Vote Button States

```tsx
const VotePanel = ({ clip, remainingVotes }) => {
  const canVote = !clip.has_voted && remainingVotes.standard > 0;
  const canSuper = !clip.has_voted && remainingVotes.super > 0;
  const canMega = !clip.has_voted && remainingVotes.mega > 0;
  
  return (
    <div>
      <button disabled={!canVote}>Vote</button>
      <button disabled={!canSuper}>⚡ Super (3x)</button>
      <button disabled={!canMega}>🔥 Mega (10x)</button>
    </div>
  );
};
```

### Error Handling

```tsx
const handleVote = async (clipId, voteType) => {
  const res = await fetch('/api/vote', {
    method: 'POST',
    body: JSON.stringify({ clipId, voteType })
  });
  
  const data = await res.json();
  
  if (!data.success) {
    switch (data.code) {
      case 'ALREADY_VOTED':
        toast.info('You already voted on this clip');
        break;
      case 'DAILY_LIMIT':
        toast.warning('Daily vote limit reached - come back tomorrow!');
        break;
      case 'SUPER_LIMIT':
        toast.warning('Super vote already used this round');
        break;
      case 'MEGA_LIMIT':
        toast.warning('Mega vote already used this round');
        break;
    }
  }
};
```

## Round Progression

1. Admin calls `POST /api/admin/advance-slot`
2. Current slot locked, winner determined by highest `weighted_score`
3. Next slot (slot_position + 1) set to 'voting'
4. When slot 75 completes → season status = 'finished'

## Migration Checklist

- [ ] Run `migration-hybrid-voting.sql` in Supabase
- [ ] Deploy updated `/api/vote` route
- [ ] Update frontend to show `has_voted` state
- [ ] Add super/mega vote buttons
- [ ] Handle error codes in UI
