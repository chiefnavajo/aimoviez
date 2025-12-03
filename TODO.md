# Production Deployment TODO

## Pending Tasks

### 1. Set Sentry Environment Variables
Configure these in Vercel dashboard (Settings > Environment Variables):
- `SENTRY_DSN` - Your Sentry DSN
- `NEXT_PUBLIC_SENTRY_DSN` - Same DSN (for client-side)
- `SENTRY_ORG` - Your Sentry organization slug
- `SENTRY_PROJECT` - Your Sentry project slug
- `SENTRY_AUTH_TOKEN` - Sentry auth token for source map uploads

### 2. Run Database Migrations
Execute the following SQL migration in Supabase SQL Editor:
```
supabase/sql/migration-contact-reports-blocks.sql
```
This creates tables for:
- `contact_submissions` - Contact form submissions
- `content_reports` - User reports for clips/users/comments
- `user_blocks` - User blocking functionality

### 3. Enable RLS Policies in Production Supabase
Ensure all Row Level Security policies are enabled:
```
supabase/sql/enable-rls-policies.sql
```

### 4. Set Up Uptime Monitoring
Configure uptime monitoring service (UptimeRobot, Better Stack, Checkly, etc.) to monitor:
- **Endpoint:** `https://your-domain.com/api/health`
- **Method:** GET or HEAD
- **Expected Status:** 200
- **Check Interval:** 1-5 minutes

### 5. Test CSRF Protection
After deploying, verify CSRF protection works:
1. Open browser dev tools
2. Make a POST request without `x-csrf-token` header
3. Should return 403 "CSRF validation failed"
4. Refresh page (gets new token in cookie)
5. Make request with `x-csrf-token` header matching cookie
6. Should succeed

### 6. Update Frontend Fetch Calls for CSRF
Update components that make POST/PUT/DELETE requests to include CSRF token:

**Option A: Use the useCsrf hook**
```tsx
import { useCsrf } from '@/hooks/useCsrf';

function MyComponent() {
  const { post } = useCsrf();

  const handleSubmit = async () => {
    const result = await post('/api/my-endpoint', { data: 'value' });
  };
}
```

**Option B: Manual header inclusion**
```tsx
const token = document.cookie
  .split('; ')
  .find(row => row.startsWith('csrf-token='))
  ?.split('=')[1];

fetch('/api/my-endpoint', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-csrf-token': token || '',
  },
  body: JSON.stringify(data),
});
```

---

## Completed Items

- [x] Rate limiting with Upstash Redis
- [x] Input validation with Zod
- [x] XSS sanitization
- [x] File signature verification for uploads
- [x] RLS policies configured
- [x] Database indexing
- [x] Structured logging
- [x] Error sanitization (no internal errors exposed)
- [x] Middleware protection for routes
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
- [x] Admin console (bulk ops, user management, audit logs)
- [x] Skeleton loaders
- [x] Toast notifications
- [x] Focus traps for modals
- [x] Accessible modal component
- [x] Error boundaries
- [x] Caching strategies
- [x] Query optimization
- [x] Sentry monitoring setup
- [x] CSRF protection
- [x] Security headers (CSP, HSTS, etc.)
- [x] Health check endpoint
