// sentry.client.config.ts
// ============================================================================
// SENTRY CLIENT CONFIGURATION
// Set NEXT_PUBLIC_SENTRY_DSN environment variable to enable
// ============================================================================

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Performance Monitoring - 10% in production, 100% in dev
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Session Replay - capture 10% of sessions, 100% of error sessions
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Environment
    environment: process.env.NODE_ENV,

    // Release tracking (Vercel provides this)
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,

    // Filtering
    beforeSend(event) {
      // Don't send events in development unless explicitly enabled
      if (process.env.NODE_ENV === 'development' && !process.env.SENTRY_DEBUG) {
        return null;
      }

      // Filter out noisy browser errors
      const errorMessage = event.exception?.values?.[0]?.value || '';
      const noisyErrors = [
        'ResizeObserver loop',
        'Non-Error promise rejection',
        'Load failed',
        'ChunkLoadError',
      ];

      if (noisyErrors.some(noise => errorMessage.includes(noise))) {
        return null;
      }

      return event;
    },

    // Integrations
    integrations: [
      Sentry.replayIntegration({
        // Privacy: mask all text and block media
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Ignore specific URLs
    denyUrls: [
      // Chrome extensions
      /extensions\//i,
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      // Firefox extensions
      /^moz-extension:\/\//i,
    ],
  });
}
