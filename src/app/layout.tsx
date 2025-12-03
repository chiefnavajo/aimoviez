import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';

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
      <body className={inter.className}>
        <Providers>
          <ErrorBoundary>
            <ToastProvider>
              {children}
            </ToastProvider>
          </ErrorBoundary>
          <ServiceWorkerRegistration />
        </Providers>
      </body>
    </html>
  );
}
