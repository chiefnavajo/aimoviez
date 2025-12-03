// sentry.edge.config.ts
// ============================================================================
// SENTRY EDGE CONFIGURATION (Middleware)
// Set SENTRY_DSN environment variable to enable
// ============================================================================

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Performance Monitoring - lower rate for edge (high volume)
    tracesSampleRate: 0.05,

    // Environment
    environment: process.env.NODE_ENV,

    // Release tracking
    release: process.env.VERCEL_GIT_COMMIT_SHA,

    // Ignore common edge errors
    ignoreErrors: [
      'ECONNRESET',
      'ETIMEDOUT',
    ],
  });
}
