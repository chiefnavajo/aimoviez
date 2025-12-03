// sentry.client.config.ts
// ============================================================================
// SENTRY CLIENT CONFIGURATION
// Uncomment and configure when Sentry is installed:
// npm install @sentry/nextjs
// ============================================================================

// import * as Sentry from "@sentry/nextjs";

// Sentry.init({
//   dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
//
//   // Performance Monitoring
//   tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
//
//   // Session Replay
//   replaysSessionSampleRate: 0.1,
//   replaysOnErrorSampleRate: 1.0,
//
//   // Environment
//   environment: process.env.NODE_ENV,
//
//   // Release tracking
//   release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
//
//   // Filtering
//   beforeSend(event) {
//     // Don't send events in development
//     if (process.env.NODE_ENV === 'development') {
//       return null;
//     }
//
//     // Filter out specific errors if needed
//     if (event.exception?.values?.[0]?.value?.includes('ResizeObserver loop')) {
//       return null;
//     }
//
//     return event;
//   },
//
//   // Integrations
//   integrations: [
//     Sentry.replayIntegration({
//       maskAllText: true,
//       blockAllMedia: true,
//     }),
//   ],
// });

export {};
