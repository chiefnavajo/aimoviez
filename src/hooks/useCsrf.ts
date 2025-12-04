// hooks/useCsrf.ts
// ============================================================================
// CSRF HOOK
// Client-side hook for CSRF token management
// ============================================================================

'use client';

import { useCallback, useEffect, useState } from 'react';

const CSRF_TOKEN_COOKIE = 'csrf-token';
const CSRF_TOKEN_HEADER = 'x-csrf-token';

/**
 * Get CSRF token from cookie
 */
function getCsrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_TOKEN_COOKIE) {
      return value;
    }
  }
  return null;
}

/**
 * Hook for CSRF token management
 * Automatically includes CSRF token in fetch requests
 */
export function useCsrf() {
  const [token, setToken] = useState<string | null>(null);

  // Get token on mount and when cookie changes
  useEffect(() => {
    const updateToken = async () => {
      let currentToken = getCsrfTokenFromCookie();

      // If no token in cookie, fetch one from the API
      if (!currentToken) {
        try {
          const response = await fetch('/api/csrf', { credentials: 'include' });
          if (response.ok) {
            // The API sets the cookie, so read it again
            currentToken = getCsrfTokenFromCookie();
          }
        } catch (error) {
          console.warn('[CSRF] Failed to fetch token:', error);
        }
      }

      setToken(currentToken);
    };

    updateToken();

    // Check for token updates periodically (in case it's refreshed)
    const interval = setInterval(updateToken, 30000);

    return () => clearInterval(interval);
  }, []);

  /**
   * Get headers with CSRF token included
   * Always reads fresh token from cookie to avoid stale state issues
   */
  const getHeaders = useCallback(
    (additionalHeaders?: Record<string, string>): Record<string, string> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...additionalHeaders,
      };

      // Always get fresh token from cookie
      const currentToken = getCsrfTokenFromCookie();
      if (currentToken) {
        headers[CSRF_TOKEN_HEADER] = currentToken;
      } else {
        // Token not in cookie - this is an error condition
        // The component should have fetched it on mount
        console.warn('[CSRF] No token available in cookie');
      }

      return headers;
    },
    [] // No dependencies - always reads fresh from cookie
  );

  /**
   * Ensure CSRF token is available before making requests
   * Call this before any state-changing operation if token might be missing
   */
  const ensureToken = useCallback(async (): Promise<string | null> => {
    let currentToken = getCsrfTokenFromCookie();

    if (!currentToken) {
      try {
        const response = await fetch('/api/csrf', { credentials: 'include' });
        if (response.ok) {
          // Wait a tick for the cookie to be set
          await new Promise((resolve) => setTimeout(resolve, 100));
          currentToken = getCsrfTokenFromCookie();
        }
      } catch (error) {
        console.error('[CSRF] Failed to fetch token:', error);
      }
    }

    return currentToken;
  }, []);

  /**
   * Fetch wrapper that includes CSRF token
   */
  const secureFetch = useCallback(
    async (
      url: string,
      options?: RequestInit
    ): Promise<Response> => {
      const headers = new Headers(options?.headers);

      // Add CSRF token for non-GET requests
      if (options?.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase())) {
        const currentToken = getCsrfTokenFromCookie();
        if (currentToken) {
          headers.set(CSRF_TOKEN_HEADER, currentToken);
        }
      }

      return fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Important for cookies
      });
    },
    []
  );

  /**
   * POST request with CSRF protection
   */
  const post = useCallback(
    async <T = unknown>(url: string, data: unknown): Promise<T> => {
      const response = await secureFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || error.message || 'Request failed');
      }

      return response.json();
    },
    [secureFetch]
  );

  /**
   * PUT request with CSRF protection
   */
  const put = useCallback(
    async <T = unknown>(url: string, data: unknown): Promise<T> => {
      const response = await secureFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || error.message || 'Request failed');
      }

      return response.json();
    },
    [secureFetch]
  );

  /**
   * DELETE request with CSRF protection
   */
  const del = useCallback(
    async <T = unknown>(url: string): Promise<T> => {
      const response = await secureFetch(url, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || error.message || 'Request failed');
      }

      return response.json();
    },
    [secureFetch]
  );

  return {
    token,
    getHeaders,
    ensureToken,
    fetch: secureFetch,
    post,
    put,
    delete: del,
    headerName: CSRF_TOKEN_HEADER,
    cookieName: CSRF_TOKEN_COOKIE,
  };
}

export default useCsrf;
