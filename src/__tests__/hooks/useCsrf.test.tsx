// Tests for useCsrf hook
// Critical for CSRF protection in API calls

import { renderHook, act, waitFor } from '@testing-library/react';
import { useCsrf } from '@/hooks/useCsrf';

// Mock fetch
global.fetch = jest.fn();

// Suppress console warnings in tests
const originalWarn = console.warn;
const originalError = console.error;

describe('useCsrf', () => {
  beforeEach(() => {
    // Clear cookies
    document.cookie = 'csrf-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    (global.fetch as jest.Mock).mockClear();
    // Mock successful fetch by default
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    // Suppress CSRF warnings in tests
    console.warn = jest.fn();
    console.error = jest.fn();
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.error = originalError;
  });

  describe('getHeaders', () => {
    it('returns Content-Type header by default', () => {
      // Set a cookie
      document.cookie = 'csrf-token=test-token-123';

      const { result } = renderHook(() => useCsrf());
      const headers = result.current.getHeaders();

      expect(headers['Content-Type']).toBe('application/json');
    });

    it('includes CSRF token from cookie', () => {
      document.cookie = 'csrf-token=test-token-123';

      const { result } = renderHook(() => useCsrf());
      const headers = result.current.getHeaders();

      expect(headers['x-csrf-token']).toBe('test-token-123');
    });

    it('merges additional headers', () => {
      document.cookie = 'csrf-token=test-token-123';

      const { result } = renderHook(() => useCsrf());
      const headers = result.current.getHeaders({ 'X-Custom': 'value' });

      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['x-csrf-token']).toBe('test-token-123');
      expect(headers['X-Custom']).toBe('value');
    });

    it('handles missing cookie gracefully', () => {
      // No cookie set
      const { result } = renderHook(() => useCsrf());

      // Should not throw
      const headers = result.current.getHeaders();
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('ensureToken', () => {
    it('returns existing token from cookie', async () => {
      document.cookie = 'csrf-token=existing-token';

      const { result } = renderHook(() => useCsrf());

      let token: string | null = null;
      await act(async () => {
        token = await result.current.ensureToken();
      });

      expect(token).toBe('existing-token');
    });

    it('fetches token if not in cookie', async () => {
      // Clear all cookies first
      document.cookie = 'csrf-token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const { result } = renderHook(() => useCsrf());

      await act(async () => {
        await result.current.ensureToken();
      });

      // Should have called fetch for the csrf endpoint
      expect(fetch).toHaveBeenCalledWith('/api/csrf', { credentials: 'include' });
    });
  });

  describe('secureFetch', () => {
    it('adds CSRF token for POST requests', async () => {
      document.cookie = 'csrf-token=secure-token';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useCsrf());

      await act(async () => {
        await result.current.fetch('/api/test', { method: 'POST' });
      });

      expect(fetch).toHaveBeenCalledWith(
        '/api/test',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        })
      );

      // Check headers
      const callArgs = (fetch as jest.Mock).mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers.get('x-csrf-token')).toBe('secure-token');
    });

    it('does not add CSRF token for GET requests', async () => {
      document.cookie = 'csrf-token=secure-token';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useCsrf());

      await act(async () => {
        await result.current.fetch('/api/test', { method: 'GET' });
      });

      const callArgs = (fetch as jest.Mock).mock.calls[0];
      const headers = callArgs[1].headers;
      expect(headers.get('x-csrf-token')).toBeNull();
    });
  });

  describe('post', () => {
    it('sends POST request with JSON body', async () => {
      document.cookie = 'csrf-token=post-token';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: 'result' }),
      });

      const { result } = renderHook(() => useCsrf());

      let response: unknown;
      await act(async () => {
        response = await result.current.post('/api/test', { name: 'test' });
      });

      expect(response).toEqual({ success: true, data: 'result' });

      const callArgs = (fetch as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBe('/api/test');
      expect(callArgs[1].method).toBe('POST');
      expect(callArgs[1].body).toBe(JSON.stringify({ name: 'test' }));
    });

    it('throws error on non-ok response', async () => {
      document.cookie = 'csrf-token=post-token';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Bad request' }),
      });

      const { result } = renderHook(() => useCsrf());

      await expect(
        act(async () => {
          await result.current.post('/api/test', {});
        })
      ).rejects.toThrow('Bad request');
    });
  });

  describe('put', () => {
    it('sends PUT request with JSON body', async () => {
      document.cookie = 'csrf-token=put-token';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useCsrf());

      await act(async () => {
        await result.current.put('/api/test/123', { name: 'updated' });
      });

      const callArgs = (fetch as jest.Mock).mock.calls[0];
      expect(callArgs[1].method).toBe('PUT');
    });
  });

  describe('delete', () => {
    it('sends DELETE request', async () => {
      document.cookie = 'csrf-token=delete-token';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useCsrf());

      await act(async () => {
        await result.current.delete('/api/test/123');
      });

      const callArgs = (fetch as jest.Mock).mock.calls[0];
      expect(callArgs[1].method).toBe('DELETE');
    });
  });

  describe('token state', () => {
    it('updates token state on mount', async () => {
      document.cookie = 'csrf-token=initial-token';

      const { result } = renderHook(() => useCsrf());

      await waitFor(() => {
        expect(result.current.token).toBe('initial-token');
      });
    });

    it('exposes header and cookie names', () => {
      const { result } = renderHook(() => useCsrf());

      expect(result.current.headerName).toBe('x-csrf-token');
      expect(result.current.cookieName).toBe('csrf-token');
    });
  });
});
