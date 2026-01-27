'use client';

import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ThemeProvider } from '@/components/ui/ThemeToggle';

// Clean up OAuth callback URL from browser history so back button skips it
function useCleanOAuthHistory() {
  useEffect(() => {
    if (document.referrer.includes('/api/auth/callback')) {
      window.history.replaceState(null, '', window.location.href);
    }
  }, []);
}

export function Providers({ children }: { children: React.ReactNode }) {
  useCleanOAuthHistory();

  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 minute
        gcTime: 5 * 60 * 1000, // 5 minutes (keep in cache)
        refetchOnWindowFocus: false,
        refetchOnMount: false, // Don't refetch if data exists
        retry: 1, // Reduce retries for faster failure
      },
      mutations: {
        retry: 1,
      },
    },
  }));

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
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
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}