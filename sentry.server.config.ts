// sentry.server.config.ts
// ============================================================================
// SENTRY SERVER CONFIGURATION
// Uncomment and configure when Sentry is installed:
// npm install @sentry/nextjs
// ============================================================================

// import * as Sentry from "@sentry/nextjs";

// Sentry.init({
//   dsn: process.env.SENTRY_DSN,
//
//   // Performance Monitoring
//   tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
//
//   // Environment
//   environment: process.env.NODE_ENV,
//
//   // Release tracking
//   release: process.env.VERCEL_GIT_COMMIT_SHA,
//
//   // Filtering
//   beforeSend(event) {
//     // Filter sensitive data
//     if (event.request?.headers) {
//       delete event.request.headers['authorization'];
//       delete event.request.headers['cookie'];
//     }
//
//     return event;
//   },
//
//   // Integrations for API routes
//   integrations: [
//     // Automatically instrument API routes
//   ],
// });

export {};
