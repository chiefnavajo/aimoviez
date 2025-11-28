import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Providers } from './providers';

const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap', // Show fallback font immediately, swap when loaded
});

export const metadata: Metadata = {
  title: 'AiMoviez · 8SEC MADNESS',
  description: 'The global 8-second movie, voted by you',
  icons: {
    icon: '/favicon.ico',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: 'cover',
  },
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
            {children}
            
            <Toaster
              position="top-center"
              toastOptions={{
                duration: 3000,
                style: {
                  background: '#1a1a1a',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                },
                success: {
                  iconTheme: {
                    primary: '#3CF2FF',
                    secondary: '#fff',
                  },
                },
                error: {
                  iconTheme: {
                    primary: '#FF00C7',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}
