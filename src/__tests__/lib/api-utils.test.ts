/**
 * @jest-environment node
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

// Mock NextResponse.json to return a plain object we can inspect
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: any, init?: { status?: number }) => ({
      _body: body,
      status: init?.status || 200,
      headers: {
        _store: new Map<string, string>(),
        set(key: string, value: string) { this._store.set(key, value); },
        get(key: string) { return this._store.get(key); },
      },
    }),
  },
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  successResponse,
  errorResponse,
  paginatedResponse,
  validateRequest,
  parseQueryParams,
  validatePagination,
  ApiError,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  apiCache,
  cachedQuery,
  invalidateCache,
  getVoterKey,
  getStartOfTodayUTC,
  formatDateForDB,
  sleep,
  retry,
  safeErrorResponse,
  safeErrorWithCode,
  sanitizeString,
  validateUUID,
  executeQuery,
} from '@/lib/api-utils';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiCache.clear();
  });

  // =========================================================================
  // ApiError
  // =========================================================================
  describe('ApiError', () => {
    it('creates error with statusCode, message, and details', () => {
      const err = new ApiError(422, 'Validation failed', { field: 'email' });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(422);
      expect(err.message).toBe('Validation failed');
      expect(err.details).toEqual({ field: 'email' });
      expect(err.name).toBe('ApiError');
    });
  });

  // =========================================================================
  // ERROR_MESSAGES and SUCCESS_MESSAGES
  // =========================================================================
  describe('constants', () => {
    it('defines standard error messages', () => {
      expect(ERROR_MESSAGES.INTERNAL_ERROR).toBe('Internal server error');
      expect(ERROR_MESSAGES.NOT_FOUND).toBe('Resource not found');
      expect(ERROR_MESSAGES.UNAUTHORIZED).toBe('Authentication required');
      expect(ERROR_MESSAGES.RATE_LIMITED).toBe('Too many requests');
    });

    it('defines standard success messages', () => {
      expect(SUCCESS_MESSAGES.CREATED).toBe('Resource created successfully');
      expect(SUCCESS_MESSAGES.DELETED).toBe('Resource deleted successfully');
    });
  });

  // =========================================================================
  // successResponse
  // =========================================================================
  describe('successResponse', () => {
    it('creates a JSON response with success:true', () => {
      const res = successResponse({ id: 1 }, 'Fetched') as any;

      expect(res.status).toBe(200);
      expect(res._body.success).toBe(true);
      expect(res._body.data).toEqual({ id: 1 });
      expect(res._body.message).toBe('Fetched');
    });

    it('includes meta with timestamp, version, and requestId', () => {
      const res = successResponse('data') as any;

      expect(res._body.meta.timestamp).toBeDefined();
      expect(res._body.meta.version).toBe('1.0.0');
      expect(typeof res._body.meta.requestId).toBe('string');
    });

    it('accepts custom status code', () => {
      const res = successResponse('data', undefined, undefined, 201) as any;
      expect(res.status).toBe(201);
    });

    it('merges additional meta properties', () => {
      const res = successResponse('data', undefined, { customField: 'value' }) as any;
      expect(res._body.meta.customField).toBe('value');
    });
  });

  // =========================================================================
  // errorResponse
  // =========================================================================
  describe('errorResponse', () => {
    it('creates error response from string', () => {
      const res = errorResponse('Something went wrong', 400) as any;

      expect(res.status).toBe(400);
      expect(res._body.success).toBe(false);
      expect(res._body.error).toBe('Something went wrong');
    });

    it('creates error response from Error instance', () => {
      const res = errorResponse(new Error('oops'), 500) as any;
      expect(res._body.error).toBe('oops');
      expect(res.status).toBe(500);
    });

    it('creates error response from ApiError with its own status code', () => {
      const apiErr = new ApiError(409, 'Conflict');
      const res = errorResponse(apiErr) as any;

      expect(res.status).toBe(409);
      expect(res._body.error).toBe('Conflict');
    });

    it('defaults to status 500', () => {
      const res = errorResponse('fail') as any;
      expect(res.status).toBe(500);
    });
  });

  // =========================================================================
  // paginatedResponse
  // =========================================================================
  describe('paginatedResponse', () => {
    it('includes pagination metadata', () => {
      const res = paginatedResponse([1, 2, 3], 1, 10, 25) as any;

      expect(res._body.success).toBe(true);
      expect(res._body.data).toEqual([1, 2, 3]);
      expect(res._body.pagination).toEqual({
        page: 1,
        page_size: 10,
        total_count: 25,
        total_pages: 3,
        has_more: true,
      });
    });

    it('has_more is false on the last page', () => {
      const res = paginatedResponse([], 3, 10, 25) as any;
      expect(res._body.pagination.has_more).toBe(false);
    });

    it('calculates total_pages correctly', () => {
      const res = paginatedResponse([], 1, 10, 0) as any;
      expect(res._body.pagination.total_pages).toBe(0);
      expect(res._body.pagination.has_more).toBe(false);
    });

    it('handles exact page boundary', () => {
      const res = paginatedResponse([], 2, 10, 20) as any;
      expect(res._body.pagination.total_pages).toBe(2);
      expect(res._body.pagination.has_more).toBe(false);
    });
  });

  // =========================================================================
  // validateRequest
  // =========================================================================
  describe('validateRequest', () => {
    it('returns isValid:true when all required fields are present', () => {
      const result = validateRequest({ name: 'Alice', age: 30 }, ['name', 'age']);

      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.sanitized).toEqual({ name: 'Alice', age: 30 });
    });

    it('returns isValid:false with errors for missing fields', () => {
      const result = validateRequest({ name: 'Alice' }, ['name', 'email'] as any);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing required field: email');
    });

    it('treats null as missing', () => {
      const result = validateRequest({ name: null }, ['name'] as any);
      expect(result.isValid).toBe(false);
    });

    it('includes optional fields when present', () => {
      const result = validateRequest(
        { name: 'Bob', bio: 'hello' },
        ['name'] as any,
        ['bio'] as any
      );
      expect(result.sanitized).toEqual({ name: 'Bob', bio: 'hello' });
    });

    it('omits optional fields when absent', () => {
      const result = validateRequest(
        { name: 'Bob' },
        ['name'] as any,
        ['bio'] as any
      );
      expect(result.sanitized).toEqual({ name: 'Bob' });
    });
  });

  // =========================================================================
  // parseQueryParams
  // =========================================================================
  describe('parseQueryParams', () => {
    it('parses numeric params: page, limit, page_size, offset', () => {
      const params = new URLSearchParams('page=2&limit=20');
      const result = parseQueryParams(params);

      expect(result.page).toBe(2);
      expect(result.limit).toBe(20);
    });

    it('parses boolean values', () => {
      const params = new URLSearchParams('active=true&deleted=false');
      const result = parseQueryParams(params);

      expect(result.active).toBe(true);
      expect(result.deleted).toBe(false);
    });

    it('keeps other values as strings', () => {
      const params = new URLSearchParams('genre=action&sort=newest');
      const result = parseQueryParams(params);

      expect(result.genre).toBe('action');
      expect(result.sort).toBe('newest');
    });

    it('merges with defaults', () => {
      const params = new URLSearchParams('page=3');
      const result = parseQueryParams(params, { page: 1, limit: 10 });

      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
    });

    it('ignores invalid numeric values (NaN, zero, negative)', () => {
      const params = new URLSearchParams('page=abc&limit=0&offset=-1');
      const result = parseQueryParams(params, { page: 1 });

      expect(result.page).toBe(1); // default kept
    });

    it('guards against prototype pollution', () => {
      const params = new URLSearchParams('__proto__=evil&constructor=bad&prototype=oops');
      const result = parseQueryParams(params);

      // The polluted keys should not be added as own properties
      expect(Object.hasOwn(result, '__proto__')).toBe(false);
      expect(Object.hasOwn(result, 'constructor')).toBe(false);
      expect(Object.hasOwn(result, 'prototype')).toBe(false);
    });
  });

  // =========================================================================
  // validatePagination
  // =========================================================================
  describe('validatePagination', () => {
    it('returns default values for empty params', () => {
      const result = validatePagination({});

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('enforces minimum page of 1', () => {
      const result = validatePagination({ page: '-5' });
      expect(result.page).toBe(1);
    });

    it('caps limit at 100', () => {
      const result = validatePagination({ limit: '500' });
      expect(result.limit).toBe(100);
    });

    it('falls back to default limit when limit is 0 (falsy)', () => {
      // parseInt('0') is 0, which is falsy, so `0 || 20` = 20
      const result = validatePagination({ limit: '0' });
      expect(result.limit).toBe(20);
    });

    it('calculates offset correctly', () => {
      const result = validatePagination({ page: '3', limit: '10' });
      expect(result.offset).toBe(20);
    });

    it('supports page_size as alias for limit', () => {
      const result = validatePagination({ page_size: '15' });
      expect(result.limit).toBe(15);
    });
  });

  // =========================================================================
  // Cache: apiCache, cachedQuery, invalidateCache
  // =========================================================================
  describe('cache', () => {
    it('stores and retrieves values', () => {
      apiCache.set('key1', 'value1', 60);
      expect(apiCache.get('key1')).toBe('value1');
    });

    it('returns null for expired entries', async () => {
      apiCache.set('expiring', 'data', 0); // 0 second TTL
      // Need to wait a tick for the expiry
      await new Promise((r) => setTimeout(r, 10));
      expect(apiCache.get('expiring')).toBeNull();
    });

    it('returns null for non-existent keys', () => {
      expect(apiCache.get('nonexistent')).toBeNull();
    });

    it('deletes entries', () => {
      apiCache.set('toDelete', 'data', 60);
      apiCache.delete('toDelete');
      expect(apiCache.get('toDelete')).toBeNull();
    });

    it('clears all entries', () => {
      apiCache.set('a', 1, 60);
      apiCache.set('b', 2, 60);
      apiCache.clear();
      expect(apiCache.stats().size).toBe(0);
    });

    it('reports stats', () => {
      apiCache.set('x', 1, 60);
      apiCache.set('y', 2, 60);
      const stats = apiCache.stats();
      expect(stats.size).toBe(2);
      expect(stats.keys).toContain('x');
      expect(stats.keys).toContain('y');
    });
  });

  describe('cachedQuery', () => {
    it('returns cached value on second call', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      const first = await cachedQuery('test-key', fn, 60);
      const second = await cachedQuery('test-key', fn, 60);

      expect(first).toBe('result');
      expect(second).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls query function when cache is empty', async () => {
      const fn = jest.fn().mockResolvedValue(42);
      const result = await cachedQuery('new-key', fn, 60);
      expect(result).toBe(42);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidateCache', () => {
    it('removes entries matching the pattern', () => {
      apiCache.set('leaderboard:clips:1', 'data1', 60);
      apiCache.set('leaderboard:clips:2', 'data2', 60);
      apiCache.set('other:key', 'data3', 60);

      invalidateCache('leaderboard:clips');

      expect(apiCache.get('leaderboard:clips:1')).toBeNull();
      expect(apiCache.get('leaderboard:clips:2')).toBeNull();
      expect(apiCache.get('other:key')).toBe('data3');
    });
  });

  // =========================================================================
  // executeQuery
  // =========================================================================
  describe('executeQuery', () => {
    it('returns data on success', async () => {
      const result = await executeQuery(async () => ({
        data: { id: 1 },
        error: null,
        count: 5,
      }));

      expect(result.data).toEqual({ id: 1 });
      expect(result.count).toBe(5);
    });

    it('throws ApiError on database error', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(
        executeQuery(async () => ({
          data: null,
          error: { message: 'connection failed' },
          count: null,
        }))
      ).rejects.toThrow(ApiError);

      consoleSpy.mockRestore();
    });

    it('throws 404 ApiError when data is null without error', async () => {
      await expect(
        executeQuery(async () => ({
          data: null,
          error: null,
          count: null,
        }))
      ).rejects.toThrow('Resource not found');
    });

    it('returns undefined count when count is null', async () => {
      const result = await executeQuery(async () => ({
        data: [1, 2],
        error: null,
        count: null,
      }));

      expect(result.count).toBeUndefined();
    });
  });

  // =========================================================================
  // Utility functions
  // =========================================================================
  describe('getVoterKey', () => {
    it('returns a sha256 hex hash of ip + userAgent', () => {
      const key = getVoterKey('1.2.3.4', 'Mozilla/5.0');
      expect(typeof key).toBe('string');
      expect(key.length).toBe(64);
    });

    it('produces different keys for different inputs', () => {
      const key1 = getVoterKey('1.2.3.4', 'Chrome');
      const key2 = getVoterKey('1.2.3.4', 'Firefox');
      expect(key1).not.toBe(key2);
    });
  });

  describe('getStartOfTodayUTC', () => {
    it('returns a Date with hours/minutes/seconds/ms set to 0', () => {
      const today = getStartOfTodayUTC();
      expect(today.getUTCHours()).toBe(0);
      expect(today.getUTCMinutes()).toBe(0);
      expect(today.getUTCSeconds()).toBe(0);
      expect(today.getUTCMilliseconds()).toBe(0);
    });
  });

  describe('formatDateForDB', () => {
    it('returns ISO string', () => {
      const date = new Date('2026-01-15T10:30:00Z');
      expect(formatDateForDB(date)).toBe('2026-01-15T10:30:00.000Z');
    });
  });

  describe('sleep', () => {
    it('resolves after the given duration', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some margin
    });
  });

  describe('retry', () => {
    it('returns on first success', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await retry(fn, 3, 10);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds eventually', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValue('ok');

      const result = await retry(fn, 3, 10);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws after maxAttempts exhausted', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('always fails'));

      await expect(retry(fn, 2, 10)).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // safeErrorResponse / safeErrorWithCode
  // =========================================================================
  describe('safeErrorResponse', () => {
    it('returns sanitized error to client', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const res = safeErrorResponse('Bad request', 400, new Error('details')) as any;

      expect(res._body).toEqual({ error: 'Bad request' });
      expect(res.status).toBe(400);
      consoleSpy.mockRestore();
    });
  });

  describe('safeErrorWithCode', () => {
    it('includes error code in response', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const res = safeErrorWithCode('Forbidden', 'AUTH_FAILED', 403) as any;

      expect(res._body).toEqual({ error: 'Forbidden', code: 'AUTH_FAILED' });
      expect(res.status).toBe(403);
      consoleSpy.mockRestore();
    });
  });

  // =========================================================================
  // sanitizeString
  // =========================================================================
  describe('sanitizeString', () => {
    it('returns empty string for null/undefined', () => {
      expect(sanitizeString(null)).toBe('');
      expect(sanitizeString(undefined)).toBe('');
      expect(sanitizeString('')).toBe('');
    });

    it('removes control characters', () => {
      expect(sanitizeString('hello\x00world')).toBe('helloworld');
      expect(sanitizeString('test\x1Fdata')).toBe('testdata');
    });

    it('preserves newlines and tabs', () => {
      expect(sanitizeString('hello\nworld')).toBe('hello\nworld');
      expect(sanitizeString('hello\tworld')).toBe('hello\tworld');
    });

    it('trims whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });
  });

  // =========================================================================
  // validateUUID
  // =========================================================================
  describe('validateUUID', () => {
    it('accepts valid UUIDs (lowercase)', () => {
      expect(validateUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(
        '123e4567-e89b-12d3-a456-426614174000'
      );
    });

    it('lowercases valid UUIDs', () => {
      expect(validateUUID('123E4567-E89B-12D3-A456-426614174000')).toBe(
        '123e4567-e89b-12d3-a456-426614174000'
      );
    });

    it('returns null for invalid UUIDs', () => {
      expect(validateUUID('not-a-uuid')).toBeNull();
      expect(validateUUID('123456')).toBeNull();
    });

    it('returns null for null/undefined', () => {
      expect(validateUUID(null)).toBeNull();
      expect(validateUUID(undefined)).toBeNull();
    });
  });
});
