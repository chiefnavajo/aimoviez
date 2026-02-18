/**
 * @jest-environment node
 */

// Mock global fetch before imports
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { verifyCaptcha, isCaptchaRequired, getClientIp } from '@/lib/captcha';

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// verifyCaptcha
// ---------------------------------------------------------------------------

describe('verifyCaptcha', () => {
  describe('when HCAPTCHA_SECRET_KEY is not configured', () => {
    beforeEach(() => {
      delete process.env.HCAPTCHA_SECRET_KEY;
    });

    it('bypasses verification in non-production mode and returns success', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Module reads the secret at import time, so we need to re-import
      // Since the module captures HCAPTCHA_SECRET at the top level, we use
      // jest.isolateModules for a clean import with the env var unset.
      let verifyCaptchaFresh: typeof verifyCaptcha;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        verifyCaptchaFresh = require('@/lib/captcha').verifyCaptcha;
      });

      const result = await verifyCaptchaFresh!('any-token');
      expect(result).toEqual({ success: true });
      expect(mockFetch).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    it('rejects in production mode when secret is missing', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      let verifyCaptchaFresh: typeof verifyCaptcha;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        verifyCaptchaFresh = require('@/lib/captcha').verifyCaptcha;
      });

      const result = await verifyCaptchaFresh!('any-token');
      expect(result.success).toBe(false);
      expect(result.error_codes).toContain('not-configured');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('when HCAPTCHA_SECRET_KEY is configured', () => {
    beforeEach(() => {
      process.env.HCAPTCHA_SECRET_KEY = 'test-secret-key';
    });

    afterEach(() => {
      delete process.env.HCAPTCHA_SECRET_KEY;
    });

    it('returns missing-input-response when token is empty', async () => {
      let verifyCaptchaFresh: typeof verifyCaptcha;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        verifyCaptchaFresh = require('@/lib/captcha').verifyCaptcha;
      });

      const result = await verifyCaptchaFresh!('');
      expect(result.success).toBe(false);
      expect(result.error_codes).toContain('missing-input-response');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns success when hCaptcha API verifies token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          challenge_ts: '2026-01-01T00:00:00Z',
          hostname: 'example.com',
        }),
      });

      let verifyCaptchaFresh: typeof verifyCaptcha;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        verifyCaptchaFresh = require('@/lib/captcha').verifyCaptcha;
      });

      const result = await verifyCaptchaFresh!('valid-token');
      expect(result.success).toBe(true);
      expect(result.hostname).toBe('example.com');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify the request was made to the correct URL with correct params
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://hcaptcha.com/siteverify');
      expect(options.method).toBe('POST');
      expect(options.body).toContain('secret=test-secret-key');
      expect(options.body).toContain('response=valid-token');
    });

    it('passes remoteIp when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      let verifyCaptchaFresh: typeof verifyCaptcha;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        verifyCaptchaFresh = require('@/lib/captcha').verifyCaptcha;
      });

      await verifyCaptchaFresh!('valid-token', '192.168.1.1');
      const [, options] = mockFetch.mock.calls[0];
      expect(options.body).toContain('remoteip=192.168.1.1');
    });

    it('returns failure when hCaptcha API rejects token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error_codes: ['invalid-input-response'],
        }),
      });

      let verifyCaptchaFresh: typeof verifyCaptcha;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        verifyCaptchaFresh = require('@/lib/captcha').verifyCaptcha;
      });

      const result = await verifyCaptchaFresh!('invalid-token');
      expect(result.success).toBe(false);
      expect(result.error_codes).toContain('invalid-input-response');
    });

    it('returns request-failed when HTTP response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      let verifyCaptchaFresh: typeof verifyCaptcha;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        verifyCaptchaFresh = require('@/lib/captcha').verifyCaptcha;
      });

      const result = await verifyCaptchaFresh!('some-token');
      expect(result.success).toBe(false);
      expect(result.error_codes).toContain('request-failed');
    });

    it('returns internal-error on network/timeout failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      let verifyCaptchaFresh: typeof verifyCaptcha;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        verifyCaptchaFresh = require('@/lib/captcha').verifyCaptcha;
      });

      const result = await verifyCaptchaFresh!('some-token');
      expect(result.success).toBe(false);
      expect(result.error_codes).toContain('internal-error');
    });
  });
});

// ---------------------------------------------------------------------------
// isCaptchaRequired
// ---------------------------------------------------------------------------

describe('isCaptchaRequired', () => {
  it('returns false when HCAPTCHA_SECRET_KEY is not set', async () => {
    delete process.env.HCAPTCHA_SECRET_KEY;

    let isCaptchaRequiredFresh: typeof isCaptchaRequired;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      isCaptchaRequiredFresh = require('@/lib/captcha').isCaptchaRequired;
    });

    const result = await isCaptchaRequiredFresh!();
    expect(result).toBe(false);
  });

  it('returns true when HCAPTCHA_SECRET_KEY is set', async () => {
    process.env.HCAPTCHA_SECRET_KEY = 'some-secret';

    let isCaptchaRequiredFresh: typeof isCaptchaRequired;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      isCaptchaRequiredFresh = require('@/lib/captcha').isCaptchaRequired;
    });

    const result = await isCaptchaRequiredFresh!();
    expect(result).toBe(true);

    delete process.env.HCAPTCHA_SECRET_KEY;
  });
});

// ---------------------------------------------------------------------------
// getClientIp
// ---------------------------------------------------------------------------

describe('getClientIp', () => {
  it('extracts IP from x-forwarded-for header (first entry)', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '203.0.113.50, 70.41.3.18, 150.172.238.178');

    expect(getClientIp(headers)).toBe('203.0.113.50');
  });

  it('returns x-real-ip when x-forwarded-for is absent', () => {
    const headers = new Headers();
    headers.set('x-real-ip', '192.168.1.100');

    expect(getClientIp(headers)).toBe('192.168.1.100');
  });

  it('returns undefined when no IP headers are present', () => {
    const headers = new Headers();

    expect(getClientIp(headers)).toBeUndefined();
  });

  it('trims whitespace from x-forwarded-for', () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '  10.0.0.1  , 10.0.0.2');

    expect(getClientIp(headers)).toBe('10.0.0.1');
  });
});
