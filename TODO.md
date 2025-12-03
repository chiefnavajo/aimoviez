# Production Deployment TODO

## Security Notice

**Keys Revoked:** API keys were rotated after exposure. Ensure all environment variables are updated in:
- Vercel dashboard
- Local `.env.local` file
- Any CI/CD secrets

---

## 🚨 CRITICAL Security Issues (Fix Before Production)

> See `SECURITY_AUDIT.md` for full details

### 1. Vote DELETE Race Condition
**File:** `src/app/api/vote/route.ts` (Lines 1148-1232)
- Race condition allows negative vote scores
- Missing authentication (uses only device fingerprint)
- **Fix:** Add transaction + authentication

### 2. CSRF Token Predictable
**File:** `src/middleware.ts` (Lines 123-132)
- Token uses only timestamp, no randomness
- **Fix:** Add `crypto.randomBytes(16)` to token generation

### 3. IDOR in Creator Endpoint
**File:** `src/app/api/creator/[id]/route.ts`
- `SELECT *` exposes all user fields
- **Fix:** Select only public fields

### 4. N+1 Query in Profile Stats
**File:** `src/app/api/profile/stats/route.ts` (Lines 280-288)
- Loads ALL votes to calculate rank
- **Fix:** Use aggregate query or materialized view

---

## ⚠️ HIGH Priority Issues

### 5. MiniLeaderboard Infinite Loop
**File:** `src/components/MiniLeaderboard.tsx` (Lines 88-94)
- `topClips` in useEffect deps causes infinite re-render
- **Fix:** Remove from dependency array

### 6. XSS in CommentsSection
**File:** `src/components/CommentsSection.tsx` (Lines 627-629)
- Comment text rendered without sanitization
- **Fix:** Use DOMPurify or sanitize on server

### 7. Missing Database Indexes
```sql
CREATE INDEX idx_votes_user_id_created ON votes(user_id, created_at DESC);
CREATE INDEX idx_clips_season_slot_created ON tournament_clips(season_id, slot_position, created_at DESC);
CREATE INDEX idx_comments_clip_deleted ON comments(clip_id, is_deleted) WHERE is_deleted = FALSE;
```

### 8. Session Too Long
**File:** `src/lib/auth-options.ts`
- 7-day session is too long
- **Fix:** Reduce to 24 hours

---

## 📋 Deployment Tasks

### 9. Set Sentry Environment Variables
Configure in Vercel dashboard:
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`

### 10. Run Database Migrations
Execute in Supabase SQL Editor:
```
supabase/sql/migration-contact-reports-blocks.sql
```

### 11. Enable RLS Policies
```
supabase/sql/enable-rls-policies.sql
```

### 12. Set Up Uptime Monitoring
- **Endpoint:** `https://your-domain.com/api/health`
- **Method:** GET or HEAD
- **Expected:** 200
- **Interval:** 1-5 minutes

### 13. Update Frontend for CSRF
Update components making POST/PUT/DELETE to include CSRF token:
```tsx
import { useCsrf } from '@/hooks/useCsrf';
const { post } = useCsrf();
await post('/api/endpoint', data);
```

---

## 📝 Medium Priority (Next Sprint)

- [ ] Add transactions to admin winner assignment
- [ ] Fix memory leak in EnhancedUploadArea (Object URL not revoked)
- [ ] Fix memory leak in Dashboard keyboard handler
- [ ] Fix race condition in comment like/unlike
- [ ] Add clip status validation in vote endpoint
- [ ] Improve rate limiting (lower admin limits)
- [ ] Add file upload polyglot validation
- [ ] Fix genre vote race condition (use upsert)

---

## ✅ Completed Items

- [x] Rate limiting with Upstash Redis
- [x] Input validation with Zod
- [x] XSS sanitization library
- [x] File signature verification for uploads
- [x] RLS policies configured
- [x] Database indexing (partial)
- [x] Structured logging
- [x] Error sanitization
- [x] Middleware protection
- [x] Admin authentication
- [x] Session handling with JWT
- [x] Terms of Service page
- [x] Privacy Policy page
- [x] Cookie consent
- [x] Data export API
- [x] Account deletion API
- [x] Contact form
- [x] Report content
- [x] Block user
- [x] Admin console
- [x] Skeleton loaders
- [x] Toast notifications
- [x] Focus traps for modals
- [x] Accessible modal component
- [x] Error boundaries
- [x] Caching strategies
- [x] Sentry monitoring setup
- [x] CSRF protection framework
- [x] Security headers
- [x] Health check endpoint
