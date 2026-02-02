import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'dxixqdmqomqzhilmdfzg.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.aimoviez.app',
        pathname: '/frames/**',
      },
    ],
  },
  // Security headers
  async headers() {
    // Content Security Policy - allows your app's domains + required third-party services
    const cspDirectives = [
      "default-src 'self'",
      // Scripts: self + inline for Next.js hydration + unsafe-eval for dev only
      process.env.NODE_ENV === 'development'
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      // Styles: self + inline for styled-jsx/Tailwind + Google Fonts CSS
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Images: self + Supabase storage + DiceBear avatars + Google profile pics + Sentry
      "img-src 'self' data: blob: https://dxixqdmqomqzhilmdfzg.supabase.co https://api.dicebear.com https://lh3.googleusercontent.com https://cdn.aimoviez.app",
      // Media (videos): self + Supabase storage + R2 CDN
      "media-src 'self' blob: https://dxixqdmqomqzhilmdfzg.supabase.co https://cdn.aimoviez.app https://*.r2.dev",
      // Fonts: self + Google Fonts
      "font-src 'self' https://fonts.gstatic.com",
      // Connect: API calls to self + Supabase + Google OAuth + Pusher for real-time + Sentry + R2 storage
      "connect-src 'self' https://dxixqdmqomqzhilmdfzg.supabase.co wss://dxixqdmqomqzhilmdfzg.supabase.co https://accounts.google.com wss://*.pusher.com https://*.pusher.com https://*.sentry.io https://*.ingest.de.sentry.io https://*.r2.cloudflarestorage.com https://cdn.aimoviez.app https://*.r2.dev",
      // Worker: service worker
      "worker-src 'self'",
      // Frames: Google OAuth popup
      "frame-src 'self' https://accounts.google.com",
      // Base URI
      "base-uri 'self'",
      // Form actions
      "form-action 'self'",
      // Frame ancestors - prevent clickjacking
      "frame-ancestors 'self'",
    ].join('; ');

    return [
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: cspDirectives,
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
      {
        // Stricter CSP for API routes
        source: '/api/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
        ],
      },
    ];
  },
  // Ensure ffmpeg-static binary is included in serverless function bundles
  outputFileTracingIncludes: {
    '/api/internal/extract-frame': ['./node_modules/ffmpeg-static/**/*'],
    '/api/cron/extract-missing-frames': ['./node_modules/ffmpeg-static/**/*'],
  },
};

// Sentry configuration options
const sentryWebpackPluginOptions = {
  // Suppress source map upload logs during build
  silent: true,

  // Organization and project (set via env vars)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for uploading source maps
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps only in production
  disableServerWebpackPlugin: process.env.NODE_ENV !== 'production',
  disableClientWebpackPlugin: process.env.NODE_ENV !== 'production',

  // Hide source maps from production
  hideSourceMaps: true,

  // Automatically tree-shake Sentry logger statements
  disableLogger: true,

  // Tunnel route to avoid ad-blockers (optional)
  // tunnelRoute: '/monitoring',
};

// Wrap config with Sentry only if DSN is configured
const exportedConfig = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;

export default exportedConfig;
