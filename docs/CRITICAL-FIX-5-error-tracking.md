# CRITICAL FIX 5: Error Tracking with Sentry

## ðŸŽ¯ Complete Sentry Setup Guide (15 minutes)

---

## Step 1: Install Sentry (2 minutes)

```bash
# Install Sentry Next.js SDK
npm install @sentry/nextjs

# Run the setup wizard
npx @sentry/wizard@latest -i nextjs
```

The wizard will:
1. Create `sentry.client.config.ts`
2. Create `sentry.server.config.ts`
3. Create `sentry.edge.config.ts`
4. Update `next.config.js`
5. Add `.sentryclirc` (for source maps)

---

## Step 2: Create Sentry Account (3 minutes)

1. Go to: https://sentry.io/signup/
2. Create free account (no credit card needed)
3. Create organization (e.g., "aimoviez")
4. Create project:
   - Platform: Next.js
   - Name: aimoviez-prod
5. Copy your DSN from the setup page

---

## Step 3: Configure Sentry (5 minutes)

### Add to `.env.local`:
```env
# Sentry Configuration
NEXT_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project-id
SENTRY_ORG=your-org-name
SENTRY_PROJECT=aimoviez-prod
SENTRY_AUTH_TOKEN=your-auth-token

# Optional: Control error reporting
NEXT_PUBLIC_SENTRY_ENVIRONMENT=development
NEXT_PUBLIC_SENTRY_SAMPLE_RATE=1.0
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
```

### Update `sentry.client.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'development',
  
  // Performance Monitoring
  tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  
  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  
  // Release tracking
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  
  // Integrations
  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
  
  // Filter out known errors
  ignoreErrors: [
    // Browser extensions
    'top.GLOBALS',
    // Random network errors
    'NetworkError',
    'Network request failed',
    // User canceled requests
    'AbortError',
  ],
  
  // Before sending error
  beforeSend(event, hint) {
    // Don't send errors in development (unless specified)
    if (process.env.NODE_ENV === 'development' && 
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT !== 'development') {
      return null;
    }
    
    // Filter out specific errors
    if (event.exception?.values?.[0]?.value?.includes('ResizeObserver')) {
      return null;
    }
    
    return event;
  },
});
```

### Update `sentry.server.config.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'development',
  tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || '0.1'),
  
  // Additional server-side options
  beforeSend(event) {
    // Redact sensitive data
    if (event.request?.cookies) {
      event.request.cookies = '[Redacted]';
    }
    return event;
  },
});
```

---

## Step 4: Add Error Boundary (5 minutes)

### Create `app/error.tsx`:
```typescript
'use client';

import * as Sentry from "@sentry/nextjs";
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to Sentry
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black text-white">
      <div className="text-center">
        <h1 className="text-6xl font-bold mb-4">ðŸŽ¬</h1>
        <h2 className="text-2xl font-semibold mb-2">Oops! Something went wrong</h2>
        <p className="text-gray-400 mb-8">
          {error.message || 'An unexpected error occurred'}
        </p>
        <button
          onClick={reset}
          className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-lg font-semibold hover:opacity-90 transition"
        >
          Try Again
        </button>
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-8 text-left max-w-2xl">
            <summary className="cursor-pointer text-gray-500">Error Details</summary>
            <pre className="mt-2 p-4 bg-gray-900 rounded text-xs overflow-auto">
              {error.stack}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
```

### Create `app/global-error.tsx`:
```typescript
'use client';

import * as Sentry from "@sentry/nextjs";
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <h1>Critical Application Error</h1>
            <p>The application has encountered a critical error.</p>
            <button onClick={reset}>Reload Application</button>
          </div>
        </div>
      </body>
    </html>
  );
}
```

---

## Step 5: Custom Error Tracking Utilities

### Create `lib/error-tracking.ts`:
```typescript
import * as Sentry from "@sentry/nextjs";

// Track API errors
export function trackApiError(
  endpoint: string,
  error: any,
  context?: Record<string, any>
) {
  Sentry.captureException(error, {
    tags: {
      type: 'api_error',
      endpoint,
    },
    extra: context,
  });
}

// Track voting errors specifically
export function trackVoteError(
  clipId: string,
  error: any,
  voterKey?: string
) {
  Sentry.captureException(error, {
    tags: {
      type: 'vote_error',
      clipId,
    },
    extra: {
      voterKey,
      timestamp: new Date().toISOString(),
    },
  });
}

// Track user actions
export function trackUserAction(
  action: string,
  properties?: Record<string, any>
) {
  Sentry.addBreadcrumb({
    message: action,
    category: 'user_action',
    level: 'info',
    data: properties,
  });
}

// Track performance issues
export function trackPerformance(
  operation: string,
  duration: number,
  threshold = 1000
) {
  if (duration > threshold) {
    Sentry.captureMessage(`Slow operation: ${operation}`, 'warning', {
      tags: {
        type: 'performance',
        operation,
      },
      extra: {
        duration,
        threshold,
      },
    });
  }
}

// Identify user (when auth is implemented)
export function identifyUser(userId: string, userData?: Record<string, any>) {
  Sentry.setUser({
    id: userId,
    ...userData,
  });
}

// Clear user on logout
export function clearUser() {
  Sentry.setUser(null);
}
```

---

## Step 6: Integration Examples

### API Route Error Handling:
```typescript
// In your API routes
import { trackApiError } from '@/lib/error-tracking';

export async function POST(req: NextRequest) {
  try {
    // Your logic here
  } catch (error) {
    // Track error
    trackApiError('/api/vote', error, {
      method: 'POST',
      body: await req.json().catch(() => ({})),
    });
    
    // Return error response
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
```

### React Component Error Handling:
```typescript
import { trackUserAction } from '@/lib/error-tracking';

function VotingArena() {
  const handleVote = async (clipId: string) => {
    try {
      trackUserAction('vote_attempted', { clipId });
      
      const response = await fetch('/api/vote', {
        method: 'POST',
        body: JSON.stringify({ clipId }),
      });
      
      if (!response.ok) {
        throw new Error(`Vote failed: ${response.status}`);
      }
      
      trackUserAction('vote_success', { clipId });
    } catch (error) {
      trackVoteError(clipId, error);
      // Show user-friendly error
    }
  };
}
```

---

## Step 7: Testing Sentry

### Create `test-sentry.tsx`:
```typescript
// app/test-sentry/page.tsx
'use client';

export default function TestSentry() {
  return (
    <div className="p-8">
      <h1>Sentry Test Page</h1>
      
      <button
        onClick={() => {
          throw new Error('Test error from client');
        }}
        className="px-4 py-2 bg-red-500 text-white rounded"
      >
        Trigger Client Error
      </button>
      
      <button
        onClick={async () => {
          await fetch('/api/test-sentry');
        }}
        className="px-4 py-2 bg-blue-500 text-white rounded ml-4"
      >
        Trigger API Error
      </button>
    </div>
  );
}
```

### Create `api/test-sentry/route.ts`:
```typescript
export async function GET() {
  throw new Error('Test error from API route');
}
```

---

## Step 8: Monitoring Dashboard

After setup, you'll have access to:

1. **Error Tracking**
   - Real-time error alerts
   - Error grouping and trends
   - Stack traces with source maps

2. **Performance Monitoring**
   - API response times
   - Page load speeds
   - Database query performance

3. **User Session Replay**
   - See exactly what users did before error
   - DOM recordings
   - Network requests

4. **Release Tracking**
   - Track errors by deployment
   - Regression detection
   - Deployment health

---

## ðŸ“Š Sentry Alerts Setup

In Sentry dashboard:

1. Go to Alerts â†’ Create Alert
2. Set up these critical alerts:

### High Error Rate Alert:
- Condition: Error count > 100 in 1 hour
- Action: Email team

### Vote Failure Alert:
- Condition: Error with tag `vote_error` > 10 in 5 minutes
- Action: Slack notification

### Performance Alert:
- Condition: P95 response time > 3 seconds
- Action: Email dev team

---

## ðŸ†“ Free Tier Limits

Sentry free tier includes:
- 5,000 errors/month
- 10,000 performance events
- 50 replays/month
- 1 team member
- 30-day data retention

**Sufficient for MVP and early growth!**

---

## âœ… Verification

After setup, verify:

1. **Test errors appear in Sentry dashboard**
2. **Source maps are uploaded** (you see actual code, not minified)
3. **User context is captured**
4. **Performance tracking works**
5. **Alerts are triggered**

---

## ðŸŽ¯ DONE!

Your error tracking is now set up! You'll be notified of any issues in production immediately.

Next steps:
1. Deploy to production
2. Monitor initial errors
3. Set up custom alerts
4. Review weekly error reports`
