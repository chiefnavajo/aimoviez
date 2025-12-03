// sentry.server.config.ts
// ============================================================================
// SENTRY SERVER CONFIGURATION
// Set SENTRY_DSN environment variable to enable
// ============================================================================

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Performance Monitoring - 10% in production
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Environment
    environment: process.env.NODE_ENV,

    // Release tracking
    release: process.env.VERCEL_GIT_COMMIT_SHA,

    // Filtering - remove sensitive data
    beforeSend(event) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-api-key'];
      }

      // Remove sensitive data from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(breadcrumb => {
          if (breadcrumb.data) {
            const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth'];
            for (const key of Object.keys(breadcrumb.data)) {
              if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
                breadcrumb.data[key] = '[REDACTED]';
              }
            }
          }
          return breadcrumb;
        });
      }

      return event;
    },

    // Ignore specific errors
    ignoreErrors: [
      // Network errors that are often transient
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      // Rate limiting (expected behavior)
      'Too many requests',
    ],
  });
}
