// hooks/useAdminAuth.ts
// ============================================================================
// ADMIN AUTH HOOK
// Client-side hook to check if user is admin
// ============================================================================

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

interface AdminAuthState {
  isLoading: boolean;
  isAdmin: boolean;
  error: string | null;
}

/**
 * Hook to check if current user is an admin
 * Makes API call to verify admin status
 */
export function useAdminAuth(): AdminAuthState {
  const { data: session, status } = useSession();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();

    async function checkAdminStatus() {
      // Still loading session
      if (status === 'loading') {
        return;
      }

      // Not authenticated
      if (!session?.user?.email) {
        setIsAdmin(false);
        setIsLoading(false);
        setError('Not authenticated');
        return;
      }

      try {
        const response = await fetch('/api/admin/stats', {
          signal: abortController.signal,
        });

        // Don't update state if aborted
        if (abortController.signal.aborted) return;

        if (response.status === 401) {
          setIsAdmin(false);
          setError('Not authenticated');
        } else if (response.status === 403) {
          setIsAdmin(false);
          setError('Not authorized as admin');
        } else if (response.ok) {
          setIsAdmin(true);
          setError(null);
        } else {
          setIsAdmin(false);
          setError('Failed to verify admin status');
        }
      } catch (err) {
        // Ignore abort errors
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[useAdminAuth] Error:', err);
        setIsAdmin(false);
        setError('Failed to verify admin status');
      }

      setIsLoading(false);
    }

    checkAdminStatus();

    return () => abortController.abort();
  }, [session, status]);

  return { isLoading, isAdmin, error };
}
