/**
 * @jest-environment node
 */

import { verifyCronAuth } from '@/lib/cron-auth';

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// verifyCronAuth
// ---------------------------------------------------------------------------

describe('verifyCronAuth', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Restore env before each test
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // ---- No CRON_SECRET configured ----

  describe('when CRON_SECRET is not configured', () => {
    beforeEach(() => {
      delete process.env.CRON_SECRET;
    });

    it('returns 500 error in production', async () => {
      process.env.NODE_ENV = 'production';

      const result = verifyCronAuth('Bearer anything');
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(result!.status).toBe(500);
      expect(body.error).toBe('Server misconfiguration');
    });

    it('allows access in non-production (dev/test) by returning null', () => {
      process.env.NODE_ENV = 'development';

      const result = verifyCronAuth('Bearer anything');
      expect(result).toBeNull();
    });

    it('allows access in test environment without CRON_SECRET', () => {
      process.env.NODE_ENV = 'test';

      const result = verifyCronAuth(null);
      expect(result).toBeNull();
    });
  });

  // ---- CRON_SECRET is configured ----

  describe('when CRON_SECRET is configured', () => {
    const SECRET = 'my-super-secret-cron-key';

    beforeEach(() => {
      process.env.CRON_SECRET = SECRET;
    });

    it('returns null (success) for a valid Bearer token', () => {
      const result = verifyCronAuth(`Bearer ${SECRET}`);
      expect(result).toBeNull();
    });

    it('returns 401 when authorization header is missing (null)', async () => {
      const result = verifyCronAuth(null);
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(result!.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when authorization header is empty string', async () => {
      const result = verifyCronAuth('');
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(result!.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when the secret is wrong', async () => {
      const result = verifyCronAuth('Bearer wrong-secret');
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(result!.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when header format is wrong (missing Bearer prefix)', async () => {
      const result = verifyCronAuth(SECRET);
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(result!.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 for bearer (lowercase) prefix', async () => {
      const result = verifyCronAuth(`bearer ${SECRET}`);
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(result!.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when token has extra whitespace', async () => {
      const result = verifyCronAuth(`Bearer  ${SECRET}`);
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(result!.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });

    it('uses timing-safe comparison (different length tokens still get rejected)', async () => {
      // A token with a different length should still return 401
      const result = verifyCronAuth('Bearer x');
      expect(result).not.toBeNull();

      const body = await result!.json();
      expect(result!.status).toBe(401);
      expect(body.error).toBe('Unauthorized');
    });
  });
});
