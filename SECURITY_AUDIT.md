# Security & Performance Audit Report
## AiMoviez App - Comprehensive Code Analysis

**Date:** December 4, 2024
**Analyzed by:** Claude Code Deep Analysis

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| **CRITICAL** | 6 | ❌ Requires immediate fix |
| **HIGH** | 12 | ⚠️ Fix this week |
| **MEDIUM** | 15 | 📋 Fix next sprint |
| **LOW** | 10 | 📝 Technical debt |

---

## CRITICAL ISSUES (Fix Immediately)

### 1. Race Condition in Vote DELETE Operation
**File:** `src/app/api/vote/route.ts` (Lines 1148-1232)
**Risk:** Vote manipulation, negative scores

**Problem:** The DELETE operation has a race condition between checking vote exists and deleting it. Concurrent DELETE requests can decrement vote counts multiple times.

**Attack:**
1. Attacker sends multiple concurrent DELETE requests for same vote
2. First request deletes correctly
3. Subsequent requests still succeed but decrement counts
4. Result: Negative vote counts

**Fix Required:**
```typescript
// Use database transaction with SELECT FOR UPDATE
// Or use RPC function for atomic delete + update
```

---

### 2. Missing Authentication in Vote DELETE
**File:** `src/app/api/vote/route.ts` (Lines 1148-1169)
**Risk:** Unauthorized vote deletion

**Problem:** DELETE only uses device fingerprint, not user authentication. A logged-in user's vote can be deleted by spoofing their device key.

**Fix Required:**
```typescript
// Apply same auth logic as POST:
const effectiveVoterKey = loggedInUserId ? `user_${loggedInUserId}` : voterKey;
```

---

### 3. CSRF Token Generation is Predictable
**File:** `src/middleware.ts` (Lines 123-132)
**Risk:** CSRF bypass attacks

**Problem:** Token uses only timestamp + HMAC with no randomness:
```typescript
const timestamp = Date.now().toString();
const signature = crypto.createHmac('sha256', CSRF_SECRET).update(timestamp).digest('hex');
```

**Fix Required:**
```typescript
const timestamp = Date.now().toString();
const randomBytes = crypto.randomBytes(16).toString('hex');
const signature = crypto.createHmac('sha256', CSRF_SECRET)
  .update(timestamp + randomBytes)
  .digest('hex');
return `${timestamp}.${randomBytes}.${signature}`;
```

---

### 4. IDOR in Creator Profile Endpoint
**File:** `src/app/api/creator/[id]/route.ts` (Lines 27-52)
**Risk:** User enumeration, data exposure

**Problem:** Returns ALL user fields with `SELECT *` and allows enumeration by ID:
```typescript
const { data: userByUsername } = await supabase
  .from('users')
  .select('*')  // Returns email, created_at, etc.
  .eq('username', username)
  .single();
```

**Fix Required:**
```typescript
.select('id, username, avatar_url, level, total_votes_received')  // Only public fields
```

---

### 5. Admin Auth Bypass Risk
**File:** `src/lib/admin-auth.ts` (Lines 46-107)
**Risk:** Privilege escalation

**Problem:** Relies solely on `is_admin` database flag without additional verification.

**Fix Required:**
- Implement role-based access control (RBAC)
- Add MFA for critical admin operations
- Sign admin status in JWT

---

### 6. Duplicate Vote Prevention Bypass
**File:** `src/app/api/vote/route.ts` (Lines 909-935)
**Risk:** Vote fraud

**Problem:** Check-then-insert pattern allows race condition:
```typescript
const voteCheckResult = await hasVotedOnClip(...);  // Check
// ... 100+ lines later ...
await supabase.from('votes').insert({...});  // Insert
```

**Fix Required:**
- Remove application-level check
- Rely on database unique constraint
- Handle 23505 error as success (already voted)

---

## HIGH SEVERITY ISSUES

### 7. N+1 Query in Profile Stats
**File:** `src/app/api/profile/stats/route.ts` (Lines 280-288)
**Impact:** API timeout, database overload

**Problem:** Loads ALL votes to calculate rank:
```typescript
const { data: allUsers } = await supabase
  .from('votes')
  .select('voter_key');  // No limit - millions of rows!
```

**Fix:** Use aggregate query or materialized view.

---

### 8. Infinite Re-render in MiniLeaderboard
**File:** `src/components/MiniLeaderboard.tsx` (Lines 88-94)
**Impact:** Browser crash, memory exhaustion

**Problem:** `topClips` in useEffect dependency causes loop:
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    fetchTopClips();  // Updates topClips
  }, 10000);
}, [topClips]);  // Triggers re-render on every update
```

**Fix:** Remove `topClips` from dependency array.

---

### 9. XSS Vulnerability in CommentsSection
**File:** `src/components/CommentsSection.tsx` (Lines 627-629)
**Impact:** Script injection, session hijacking

**Problem:** Comment text rendered without sanitization:
```typescript
<p>{comment.comment_text}</p>  // Could contain malicious HTML
```

**Fix:** Sanitize with DOMPurify or ensure server sanitizes.

---

### 10. Session Lifetime Too Long
**File:** `src/lib/auth-options.ts` (Lines 26-44)
**Impact:** Extended compromise window

**Problem:** 7-day session with 24-hour refresh:
```typescript
maxAge: 7 * 24 * 60 * 60,  // 7 days
updateAge: 24 * 60 * 60,   // 24 hours
```

**Fix:** Reduce to 24-hour session, 1-hour refresh.

---

### 11. CSRF Cookie Readable by JavaScript
**File:** `src/middleware.ts` (Line 155)
**Impact:** XSS can steal CSRF tokens

**Problem:**
```typescript
httpOnly: false,  // Vulnerable to XSS
```

**Note:** This is intentional for double-submit pattern, but combined with any XSS vulnerability, tokens can be stolen.

---

### 12. Rate Limiting Too Loose
**File:** `src/lib/rate-limit.ts` (Lines 17-38)
**Impact:** DoS, brute force attacks

**Problem:**
```typescript
admin: { requests: 200, window: '1m' },  // Too high!
api: { requests: 100, window: '1m' },    // Too high for sensitive ops
```

**Fix:** Reduce limits, add exponential backoff.

---

### 13. File Upload Signature Verification Weak
**File:** `src/app/api/upload/route.ts` (Lines 90-126)
**Impact:** Malicious file upload

**Problem:** Only checks first 32 bytes - polyglot files can bypass.

**Fix:** Validate entire file structure, check codec safety.

---

### 14. Missing Database Indexes
**Impact:** Slow queries under load

**Required indexes:**
```sql
CREATE INDEX idx_votes_user_id_created ON votes(user_id, created_at DESC);
CREATE INDEX idx_clips_season_slot_created ON tournament_clips(season_id, slot_position, created_at DESC);
CREATE INDEX idx_comments_clip_deleted ON comments(clip_id, is_deleted) WHERE is_deleted = FALSE;
```

---

### 15. Connection Pool Exhaustion Risk
**File:** `src/app/api/genre-vote/route.ts` (Lines 64-82)
**Impact:** Database connection errors

**Problem:** 8 parallel connections per request. 100 users = 800 connections.

**Fix:** Use RPC function for single round-trip.

---

### 16. Report API Missing Sanitization
**File:** `src/app/api/report/route.ts` (Lines 33-94)
**Impact:** Stored XSS in admin panel

**Problem:** Description field not sanitized before insert.

**Fix:** Add `sanitizeText(description)` before storage.

---

### 17. Comment Delete IDOR
**File:** `src/app/api/comments/route.ts` (Lines 403-454)
**Impact:** Unauthorized comment deletion

**Problem:** Uses spoofable device fingerprint for ownership check.

**Fix:** Use `user_id` from JWT for authenticated users.

---

### 18. Contact Form IP Logging Without Consent
**File:** `src/app/api/contact/route.ts` (Lines 68-69)
**Impact:** GDPR/CCPA violation

**Fix:** Hash IP addresses, add consent checkbox, implement retention policy.

---

## MEDIUM SEVERITY ISSUES

### 19. Memory Leak in EnhancedUploadArea
**File:** `src/components/EnhancedUploadArea.tsx` (Lines 112, 197)

Object URLs not revoked on all error paths.

### 20. Memory Leak in Dashboard Keyboard Handler
**File:** `src/app/dashboard/page.tsx` (Line 918)

`activeIndex` in dependency array causes constant listener re-registration.

### 21. Race Condition in Comment Like/Unlike
**File:** `src/components/CommentsSection.tsx` (Lines 234-277)

Fast consecutive clicks cause state inconsistency.

### 22. Missing Clip Status Validation in Vote
**File:** `src/app/api/vote/route.ts` (Lines 966-980)

Can vote on rejected/archived clips.

### 23. Vote Weight Not Validated
**File:** `src/app/api/vote/route.ts` (Lines 1022-1024)

Weight calculated from user input without enum validation.

### 24. Admin Winner Assignment Not Transactional
**File:** `src/app/api/admin/assign-winner/route.ts` (Lines 140-165)

4 separate UPDATE statements without transaction - could leave inconsistent state.

### 25. Special Vote Limits Not Thread-Safe
**File:** `src/app/api/vote/route.ts` (Lines 347-357, 983-1020)

Race window between checking limits and inserting vote.

### 26. URL Sanitization Insufficient
**File:** `src/lib/sanitize.ts` (Lines 62-83)

Doesn't handle URL-encoded attacks or domain whitelist.

### 27. Stale Cache Data in Vote Arena
**File:** `src/app/api/vote/route.ts` (Lines 41-78)

30-60 second TTL allows voting on old slots after status change.

### 28. Insufficient Error Handling on Delete+Update
**File:** `src/app/api/vote/route.ts` (Lines 1198-1227)

Vote deleted but score update can fail silently.

### 29. Device Fingerprinting Weak
**File:** `src/lib/device-fingerprint.ts` (Lines 28-87)

All signals are client-controllable headers.

### 30. Genre Vote Race Condition
**File:** `src/app/api/genre-vote/route.ts` (Lines 150-169)

Check-then-insert pattern vulnerable to TOCTTOU.

### 31. Leaderboard Fallback Loads 50K Rows
**File:** `src/app/api/leaderboard/route.ts` (Line 142)

If RPC fails, loads 50,000 votes into memory.

### 32. Missing Form Validation in Admin Edit
**File:** `src/app/admin/page.tsx` (Lines 1861-1906)

Title/genre validation happens on button but no minLength check.

### 33. Profile Stats Streak Calculation Expensive
**File:** `src/app/api/profile/stats/route.ts` (Lines 204-252)

Loops through 365 days on every request - should persist to database.

---

## LOW SEVERITY ISSUES

34. Audit logging only for flagged votes
35. Silent failure in view recording
36. UTC timezone in vote limits (users expect local time)
37. Arbitrary risk scoring thresholds
38. Missing accessibility labels (various components)
39. Unused clips cache definition
40. Native confirm() instead of modal
41. Typo in admin dashboard message
42. Missing error boundary in upload components
43. Inconsistent voter key in DELETE response

---

## POSITIVE FINDINGS

- ✅ Rate limiting implemented with Redis
- ✅ Input validation with Zod schemas
- ✅ XSS sanitization library exists
- ✅ File signature verification for uploads
- ✅ Database triggers for atomic vote counting
- ✅ Audit logging for admin actions
- ✅ CSRF protection framework in place
- ✅ Security headers configured
- ✅ Error messages sanitized for clients
- ✅ Caching strategy is excellent
- ✅ HTTP cache headers for CDN

---

## Recommended Fix Priority

### This Week (Critical + High)
1. Fix vote DELETE race condition + auth
2. Fix CSRF token randomness
3. Fix creator IDOR
4. Fix profile stats N+1
5. Fix MiniLeaderboard infinite loop
6. Fix CommentsSection XSS
7. Add missing indexes

### Next Sprint (Medium)
8. Add transactions to admin operations
9. Fix memory leaks
10. Improve rate limiting
11. Add file upload validation
12. Fix race conditions in votes

### Technical Debt (Low)
13. Improve accessibility
14. Refactor magic numbers
15. Add comprehensive audit logging
16. Implement RBAC for admins

---

## Database Indexes to Add

```sql
-- Critical for performance
CREATE INDEX IF NOT EXISTS idx_votes_user_id_created
ON votes(user_id, created_at DESC) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clips_season_slot_created
ON tournament_clips(season_id, slot_position, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_clip_deleted
ON comments(clip_id, is_deleted) WHERE is_deleted = FALSE;

-- For genre votes
CREATE INDEX IF NOT EXISTS idx_genre_votes_voter
ON genre_votes(voter_key);

-- For user rankings (consider materialized view)
CREATE INDEX IF NOT EXISTS idx_votes_voter_weight
ON votes(voter_key, vote_weight);
```

---

## Architecture Recommendations

1. **Use Database Transactions** for multi-step admin operations
2. **Implement RBAC** with `super_admin`, `moderator`, `support` roles
3. **Add Materialized Views** for leaderboard/ranking calculations
4. **Use Redis** for rate limiting (already done) AND session blacklist
5. **Implement Circuit Breaker** for non-critical operations
6. **Add Query Monitoring** with `pg_stat_statements`
7. **Consider CDC** for cache invalidation on data changes

---

*This audit should be reviewed and issues prioritized based on actual attack surface and user impact.*
