import type { NextConfig } from "next";

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
      // Styles: self + inline for styled-jsx/Tailwind
      "style-src 'self' 'unsafe-inline'",
      // Images: self + Supabase storage + DiceBear avatars + Google profile pics
      "img-src 'self' data: blob: https://dxixqdmqomqzhilmdfzg.supabase.co https://api.dicebear.com https://lh3.googleusercontent.com",
      // Media (videos): self + Supabase storage
      "media-src 'self' blob: https://dxixqdmqomqzhilmdfzg.supabase.co",
      // Fonts: self + Google Fonts
      "font-src 'self' https://fonts.gstatic.com",
      // Connect: API calls to self + Supabase + Google OAuth + Pusher for real-time
      "connect-src 'self' https://dxixqdmqomqzhilmdfzg.supabase.co wss://dxixqdmqomqzhilmdfzg.supabase.co https://accounts.google.com wss://*.pusher.com https://*.pusher.com",
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
};

export default nextConfig;
