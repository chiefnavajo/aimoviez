import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import CookieConsent from '@/components/CookieConsent';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap', // Show fallback font immediately, swap when loaded
});

export const metadata: Metadata = {
  title: 'AiMoviez · 8SEC MADNESS',
  description: 'The global 8-second movie, voted by you',
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/icon.svg',
    apple: '/icons/icon-192x192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'AiMoviez',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: 'AiMoviez · 8SEC MADNESS',
    description: 'The global 8-second movie, voted by you',
    type: 'website',
    siteName: 'AiMoviez',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AiMoviez · 8SEC MADNESS',
    description: 'The global 8-second movie, voted by you',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#000000',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Preconnect to critical domains for faster resource loading */}
        <link rel="preconnect" href="https://dxixqdmqomqzhilmdfzg.supabase.co" />
        <link rel="preconnect" href="https://dxixqdmqomqzhilmdfzg.supabase.co" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://api.dicebear.com" />
      </head>
      <body className={inter.className}>
        {/* Skip link for keyboard navigation - visible on focus */}
        <a
          href="#main-content"
          className="sr-only sr-only-focusable"
          style={{
            position: 'absolute',
            width: '1px',
            height: '1px',
            padding: 0,
            margin: '-1px',
            overflow: 'hidden',
            clip: 'rect(0, 0, 0, 0)',
            whiteSpace: 'nowrap',
            borderWidth: 0,
          }}
        >
          Skip to main content
        </a>
        <Providers>
          <ErrorBoundary>
            <ToastProvider>
              {children}
            </ToastProvider>
          </ErrorBoundary>
          <ServiceWorkerRegistration />
          <CookieConsent />
          <Analytics />
          <SpeedInsights />
        </Providers>
      </body>
    </html>
  );
}
