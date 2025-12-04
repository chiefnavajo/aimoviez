# Production Deployment TODO

## Security Notice

**Keys Revoked:** API keys were rotated after exposure. Ensure all environment variables are updated in:
- Vercel dashboard
- Local `.env.local` file
- Any CI/CD secrets

---

## ✅ ALL Security Issues FIXED

### CRITICAL (Fixed)
1. ✅ Vote DELETE race condition - Atomic RPC with SELECT FOR UPDATE
2. ✅ CSRF token predictability - Added crypto.randomBytes(16)
3. ✅ IDOR in creator endpoint - SELECT only public fields
4. ✅ N+1 query in profile stats - Efficient RPC functions

### HIGH (Fixed)
5. ✅ MiniLeaderboard infinite loop - Removed from useEffect deps
6. ✅ XSS in CommentsSection - Verified safe (server sanitizes + React escapes)
7. ✅ Missing database indexes - Migration created

### MEDIUM (Fixed)
8. ✅ Session lifetime too long - Reduced from 7 days to 24 hours
9. ✅ Memory leak in EnhancedUploadArea - Added Object URL cleanup
10. ✅ Memory leak in Dashboard keyboard handler - Fixed useEffect deps
11. ✅ Comment like/unlike race condition - Added in-flight tracking
12. ✅ Genre vote race condition - Changed to upsert
13. ✅ Rate limiting too loose - Lowered all limits
14. ✅ Clip status validation missing - Added in vote endpoint
15. ✅ File upload polyglot validation - Added dangerous pattern detection
16. ✅ Admin winner assignment not transactional - Added atomic RPC

---

## 📋 Required Database Migrations

Run these in Supabase SQL Editor:

```bash
# 1. Vote DELETE race condition fix
supabase/sql/fix-vote-delete-race-condition.sql

# 2. Profile stats N+1 fix
supabase/sql/fix-profile-stats-n-plus-1.sql

# 3. Additional indexes from audit
supabase/sql/additional-indexes-from-audit.sql

# 4. Admin winner transaction
supabase/sql/fix-admin-winner-transaction.sql

# 5. Contact/Reports/Blocks tables (if not already run)
supabase/sql/migration-contact-reports-blocks.sql

# 6. Enable RLS policies
supabase/sql/enable-rls-policies.sql
```

---

## 📋 Deployment Tasks

### Set Sentry Environment Variables
Configure in Vercel dashboard:
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_AUTH_TOKEN`

### Set Up Uptime Monitoring
- **Endpoint:** `https://your-domain.com/api/health`
- **Method:** GET or HEAD
- **Expected:** 200
- **Interval:** 1-5 minutes

### Update Frontend for CSRF
Components making POST/PUT/DELETE should include CSRF token:
```tsx
import { useCsrf } from '@/hooks/useCsrf';
const { post } = useCsrf();
await post('/api/endpoint', data);
```

---

## ✅ All Security Fixes Completed

### Security
- [x] Rate limiting with Upstash Redis (limits lowered)
- [x] Input validation with Zod
- [x] XSS sanitization library
- [x] File signature verification for uploads
- [x] Polyglot file detection
- [x] RLS policies configured
- [x] Database indexing
- [x] Structured logging
- [x] Error sanitization
- [x] Middleware protection
- [x] Admin authentication
- [x] Session handling with JWT (24-hour sessions)
- [x] CSRF protection framework (with randomness)
- [x] Security headers
- [x] Vote DELETE auth + race condition fix
- [x] IDOR fix in creator endpoint
- [x] N+1 query fix in profile stats
- [x] Clip status validation in vote endpoint
- [x] Genre vote upsert (no race condition)
- [x] Comment like/unlike race condition fix
- [x] Admin winner atomic transaction
- [x] Memory leak fixes (upload area, dashboard)

### Compliance
- [x] Terms of Service page
- [x] Privacy Policy page
- [x] Cookie consent
- [x] Data export API
- [x] Account deletion API
- [x] Contact form
- [x] Report content
- [x] Block user

### UX
- [x] Admin console
- [x] Skeleton loaders
- [x] Toast notifications
- [x] Focus traps for modals
- [x] Accessible modal component
- [x] Error boundaries
- [x] Caching strategies

### Monitoring
- [x] Sentry monitoring setup
- [x] Health check endpoint

---

## 📋 CAPTCHA Setup Tasks

### Setup Steps
- [ ] Sign up for hCaptcha at dashboard.hcaptcha.com
- [ ] Add site to hCaptcha (localhost + production domain)
- [ ] Copy Site Key and Secret Key from hCaptcha dashboard
- [ ] Add `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` to `.env.local`
- [ ] Add `HCAPTCHA_SECRET_KEY` to `.env.local`
- [ ] Create feature flag in database: `require_captcha_voting`
- [ ] Test CAPTCHA locally with test keys
- [ ] Add env vars to Vercel dashboard for production
- [ ] Enable CAPTCHA feature flag when ready

### SQL for Feature Flag
```sql
INSERT INTO feature_flags (key, enabled, description)
VALUES ('require_captcha_voting', false, 'Require CAPTCHA verification for voting')
ON CONFLICT (key) DO NOTHING;
```

### Test Keys (for local development)
```env
NEXT_PUBLIC_HCAPTCHA_SITE_KEY=10000000-ffff-ffff-ffff-000000000001
HCAPTCHA_SECRET_KEY=0x0000000000000000000000000000000000000000
```

---

## 📋 Tomorrow's Tasks

### CRITICAL: Revoked Keys Redeployment
- [ ] Update all environment variables in Vercel dashboard (keys were rotated after exposure)
- [ ] Update `.env.local` with new keys
- [ ] Verify Supabase keys are updated
- [ ] Verify Google OAuth keys are updated
- [ ] Verify Upstash Redis keys are updated
- [ ] Redeploy to Vercel after updating keys
- [ ] Test authentication flow after redeployment
- [ ] Test database connections after redeployment

### Bug Fix: Multi-Vote Mode (ALREADY DONE)
- [x] Fix multi-vote mode: fetch `multi_vote_mode` feature flag on frontend
- [x] Only allow vote revoke when multi-vote mode is OFF
- [x] When multi-vote mode is ON, tapping again should add another vote (not revoke)
Note: This was already implemented in dashboard/page.tsx (line 661, 1473) and vote/route.ts

### CAPTCHA Setup
- [ ] Sign up for hCaptcha at dashboard.hcaptcha.com
- [ ] Add site to hCaptcha (localhost + production domain)
- [ ] Copy Site Key and Secret Key from hCaptcha dashboard
- [ ] Add `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` to `.env.local`
- [ ] Add `HCAPTCHA_SECRET_KEY` to `.env.local`
- [ ] Create feature flag in database: `require_captcha_voting`
- [ ] Test CAPTCHA locally with test keys
- [ ] Add env vars to Vercel dashboard for production
- [ ] Enable CAPTCHA feature flag when ready

### Database Migrations (DONE)
- [x] Run all migrations in Supabase SQL Editor:
  - `fix-vote-delete-race-condition.sql` ✅
  - `fix-profile-stats-n-plus-1.sql` ✅
  - `additional-indexes-from-audit.sql` ✅
  - `fix-admin-winner-transaction.sql` ✅
  - `migration-contact-reports-blocks.sql` ✅
  - `enable-rls-policies.sql` ✅

### Deployment & Monitoring
- [ ] Set Sentry environment variables in Vercel
- [ ] Set up uptime monitoring for `/api/health`

---

## 📋 Code Quality Technical Debt

### ESLint Warnings (228 total - not blocking build)

The ESLint config was updated to allow warnings instead of errors for these rules. Fix incrementally as you modify files:

#### High Priority: Type Safety (96 instances)
Replace `any` types with proper interfaces:
- `catch (err: any)` → `catch (err: unknown)` or just `catch`
- Cache Map types → Use `CacheEntry<T>` from `@/types`
- API response types → Use proper interfaces from `@/types`
- Supabase row mappings → Use `DbUser`, `DbClip`, `DbSlot` from `@/types`

**Files with most `any` types:**
- `src/app/api/admin/moderation/route.ts`
- `src/app/api/admin/slots/route.ts`
- `src/app/api/admin/seasons/route.ts`
- `src/app/api/leaderboard/*.ts`
- `src/app/api/vote/route.ts`

#### Medium Priority: Code Quality (93 instances)
- **Unused variables (79):** Remove or prefix with `_`
- **exhaustive-deps (14):** Fix React hook dependency arrays

#### Low Priority: Style (39 instances)
- **no-img-element (29):** Replace `<img>` with Next.js `<Image>`
- **prefer-const (5):** Change `let` to `const` where not reassigned
- **Unused eslint-disable (2+):** Remove stale disable comments

### Shared Types Added
New types added to `src/types/index.ts`:
- `CacheEntry<T>` - For typed cache Maps
- `DbSeason`, `DbSlot`, `DbClip`, `DbUser`, `DbNotification` - Database row types
- `LeaderboardCreator`, `LeaderboardVoter`, `LeaderboardClip` - API response types

### How to Fix Incrementally
When modifying a file, run:
```bash
npm run lint -- --fix src/path/to/file.ts
```

To check remaining warnings:
```bash
npm run lint 2>&1 | grep "warning" | wc -l
```
