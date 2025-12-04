// Tests for device fingerprinting utilities
// These are critical for vote integrity and fraud detection

import {
  extractDeviceSignals,
  generateDeviceFingerprint,
  generateDeviceKey,
  getLegacyDeviceKey,
  assessDeviceRisk,
  shouldFlagVote,
  generateVoteIntegrityToken,
  verifyVoteIntegrityToken,
} from '@/lib/device-fingerprint';
import { NextRequest } from 'next/server';

// Helper to create mock NextRequest
function createMockRequest(headers: Record<string, string> = {}): NextRequest {
  const headerMap = new Map(Object.entries(headers));
  return {
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) || null,
    },
  } as unknown as NextRequest;
}

describe('extractDeviceSignals', () => {
  it('extracts IP from cf-connecting-ip header', () => {
    const req = createMockRequest({
      'cf-connecting-ip': '1.2.3.4',
      'x-forwarded-for': '5.6.7.8',
    });

    const signals = extractDeviceSignals(req);
    expect(signals.ip).toBe('1.2.3.4');
  });

  it('falls back to x-forwarded-for header', () => {
    const req = createMockRequest({
      'x-forwarded-for': '1.2.3.4, 5.6.7.8',
    });

    const signals = extractDeviceSignals(req);
    expect(signals.ip).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip header', () => {
    const req = createMockRequest({
      'x-real-ip': '1.2.3.4',
    });

    const signals = extractDeviceSignals(req);
    expect(signals.ip).toBe('1.2.3.4');
  });

  it('defaults to unknown for missing IP', () => {
    const req = createMockRequest({});
    const signals = extractDeviceSignals(req);
    expect(signals.ip).toBe('unknown');
  });

  it('extracts user agent', () => {
    const req = createMockRequest({
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });

    const signals = extractDeviceSignals(req);
    expect(signals.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  });

  it('extracts client hints', () => {
    const req = createMockRequest({
      'sec-ch-ua': '"Chromium";v="122"',
      'sec-ch-ua-platform': '"Windows"',
      'sec-ch-ua-mobile': '?0',
    });

    const signals = extractDeviceSignals(req);
    expect(signals.secChUa).toBe('"Chromium";v="122"');
    expect(signals.secChUaPlatform).toBe('"Windows"');
    expect(signals.secChUaMobile).toBe('?0');
  });

  it('extracts custom headers', () => {
    const req = createMockRequest({
      'x-timezone': 'America/New_York',
      'x-screen-resolution': '1920x1080',
    });

    const signals = extractDeviceSignals(req);
    expect(signals.timezone).toBe('America/New_York');
    expect(signals.screenRes).toBe('1920x1080');
  });
});

describe('generateDeviceFingerprint', () => {
  it('generates consistent hash for same signals', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      acceptLanguage: 'en-US',
      acceptEncoding: 'gzip',
      secChUa: '"Chrome"',
      secChUaPlatform: '"Windows"',
      secChUaMobile: '?0',
      secFetchDest: 'document',
      secFetchMode: 'navigate',
      timezone: null,
      screenRes: null,
    };

    const hash1 = generateDeviceFingerprint(signals);
    const hash2 = generateDeviceFingerprint(signals);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA256 hex
  });

  it('generates different hash for different signals', () => {
    const signals1 = {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      acceptLanguage: 'en-US',
      acceptEncoding: 'gzip',
      secChUa: null,
      secChUaPlatform: null,
      secChUaMobile: null,
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    const signals2 = { ...signals1, ip: '5.6.7.8' };

    const hash1 = generateDeviceFingerprint(signals1);
    const hash2 = generateDeviceFingerprint(signals2);

    expect(hash1).not.toBe(hash2);
  });
});

describe('generateDeviceKey', () => {
  it('generates key with device_ prefix', () => {
    const req = createMockRequest({
      'user-agent': 'Mozilla/5.0',
      'x-forwarded-for': '1.2.3.4',
    });

    const key = generateDeviceKey(req);
    expect(key).toMatch(/^device_[a-f0-9]{32}$/);
  });
});

describe('getLegacyDeviceKey', () => {
  it('generates consistent hash from IP and UA', () => {
    const req = createMockRequest({
      'user-agent': 'Mozilla/5.0',
      'x-forwarded-for': '1.2.3.4',
    });

    const key1 = getLegacyDeviceKey(req);
    const key2 = getLegacyDeviceKey(req);

    expect(key1).toBe(key2);
    expect(key1).toHaveLength(64); // SHA256 hex
  });
});

describe('assessDeviceRisk', () => {
  it('returns low risk for normal browser', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0',
      acceptLanguage: 'en-US,en;q=0.9',
      acceptEncoding: 'gzip',
      secChUa: '"Chromium";v="122"',
      secChUaPlatform: '"Windows"',
      secChUaMobile: '?0',
      secFetchDest: 'document',
      secFetchMode: 'navigate',
      timezone: 'America/New_York',
      screenRes: '1920x1080',
    };

    const risk = assessDeviceRisk(signals);
    expect(risk.score).toBe(0);
    expect(risk.reasons).toHaveLength(0);
  });

  it('flags missing user agent', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: '',
      acceptLanguage: 'en-US',
      acceptEncoding: 'gzip',
      secChUa: null,
      secChUaPlatform: null,
      secChUaMobile: null,
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    const risk = assessDeviceRisk(signals);
    expect(risk.score).toBeGreaterThanOrEqual(30);
    expect(risk.reasons).toContain('Missing user agent');
  });

  it('flags headless Chrome', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 HeadlessChrome/122.0.0.0',
      acceptLanguage: 'en-US',
      acceptEncoding: 'gzip',
      secChUa: null,
      secChUaPlatform: null,
      secChUaMobile: null,
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    const risk = assessDeviceRisk(signals);
    expect(risk.score).toBeGreaterThanOrEqual(50);
    expect(risk.reasons).toContain('Automated browser detected');
  });

  it('flags PhantomJS', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 PhantomJS/2.1.1',
      acceptLanguage: 'en-US',
      acceptEncoding: 'gzip',
      secChUa: null,
      secChUaPlatform: null,
      secChUaMobile: null,
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    const risk = assessDeviceRisk(signals);
    expect(risk.reasons).toContain('Automated browser detected');
  });

  it('flags Selenium', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 Selenium/4.0',
      acceptLanguage: 'en-US',
      acceptEncoding: 'gzip',
      secChUa: null,
      secChUaPlatform: null,
      secChUaMobile: null,
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    const risk = assessDeviceRisk(signals);
    expect(risk.reasons).toContain('Automated browser detected');
  });

  it('flags missing accept-language', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 Chrome/122',
      acceptLanguage: '',
      acceptEncoding: 'gzip',
      secChUa: '"Chrome"',
      secChUaPlatform: '"Windows"',
      secChUaMobile: '?0',
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    const risk = assessDeviceRisk(signals);
    expect(risk.score).toBeGreaterThanOrEqual(10);
    expect(risk.reasons).toContain('Missing accept-language');
  });

  it('flags Chrome without client hints', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 Chrome/122.0.0.0',
      acceptLanguage: 'en-US',
      acceptEncoding: 'gzip',
      secChUa: null, // Missing!
      secChUaPlatform: null,
      secChUaMobile: null,
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    const risk = assessDeviceRisk(signals);
    expect(risk.score).toBeGreaterThanOrEqual(15);
    expect(risk.reasons).toContain('Missing client hints from Chrome');
  });

  it('caps risk score at 100', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'HeadlessChrome Selenium PhantomJS', // Multiple red flags
      acceptLanguage: '',
      acceptEncoding: '',
      secChUa: null,
      secChUaPlatform: null,
      secChUaMobile: null,
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    const risk = assessDeviceRisk(signals);
    expect(risk.score).toBeLessThanOrEqual(100);
  });
});

describe('shouldFlagVote', () => {
  it('returns false for low risk', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 Chrome/122',
      acceptLanguage: 'en-US',
      acceptEncoding: 'gzip',
      secChUa: '"Chrome"',
      secChUaPlatform: '"Windows"',
      secChUaMobile: '?0',
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    expect(shouldFlagVote(signals)).toBe(false);
  });

  it('returns true for high risk (score >= 40)', () => {
    const signals = {
      ip: '1.2.3.4',
      userAgent: 'HeadlessChrome/122',
      acceptLanguage: '',
      acceptEncoding: '',
      secChUa: null,
      secChUaPlatform: null,
      secChUaMobile: null,
      secFetchDest: null,
      secFetchMode: null,
      timezone: null,
      screenRes: null,
    };

    expect(shouldFlagVote(signals)).toBe(true);
  });
});

describe('Vote Integrity Token', () => {
  const deviceKey = 'device_abc123';
  const clipId = 'clip_xyz789';

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('generateVoteIntegrityToken', () => {
    it('generates consistent token for same inputs', () => {
      const timestamp = Date.now();
      const token1 = generateVoteIntegrityToken(deviceKey, clipId, timestamp);
      const token2 = generateVoteIntegrityToken(deviceKey, clipId, timestamp);

      expect(token1).toBe(token2);
      expect(token1).toHaveLength(16);
    });

    it('generates different token for different device', () => {
      const timestamp = Date.now();
      const token1 = generateVoteIntegrityToken('device1', clipId, timestamp);
      const token2 = generateVoteIntegrityToken('device2', clipId, timestamp);

      expect(token1).not.toBe(token2);
    });

    it('generates different token for different clip', () => {
      const timestamp = Date.now();
      const token1 = generateVoteIntegrityToken(deviceKey, 'clip1', timestamp);
      const token2 = generateVoteIntegrityToken(deviceKey, 'clip2', timestamp);

      expect(token1).not.toBe(token2);
    });
  });

  describe('verifyVoteIntegrityToken', () => {
    it('verifies valid token', () => {
      const timestamp = Date.now();
      const token = generateVoteIntegrityToken(deviceKey, clipId, timestamp);

      const isValid = verifyVoteIntegrityToken(token, deviceKey, clipId, timestamp);
      expect(isValid).toBe(true);
    });

    it('rejects token with wrong device', () => {
      const timestamp = Date.now();
      const token = generateVoteIntegrityToken(deviceKey, clipId, timestamp);

      const isValid = verifyVoteIntegrityToken(token, 'wrong_device', clipId, timestamp);
      expect(isValid).toBe(false);
    });

    it('rejects token with wrong clip', () => {
      const timestamp = Date.now();
      const token = generateVoteIntegrityToken(deviceKey, clipId, timestamp);

      const isValid = verifyVoteIntegrityToken(token, deviceKey, 'wrong_clip', timestamp);
      expect(isValid).toBe(false);
    });

    it('rejects expired token', () => {
      const timestamp = Date.now();
      const token = generateVoteIntegrityToken(deviceKey, clipId, timestamp);

      // Advance time by 6 minutes (past 5 minute default)
      jest.advanceTimersByTime(6 * 60 * 1000);

      const isValid = verifyVoteIntegrityToken(token, deviceKey, clipId, timestamp);
      expect(isValid).toBe(false);
    });

    it('accepts token within custom max age', () => {
      const timestamp = Date.now();
      const token = generateVoteIntegrityToken(deviceKey, clipId, timestamp);

      // Advance time by 9 minutes
      jest.advanceTimersByTime(9 * 60 * 1000);

      // Should fail with default 5 min, but pass with 10 min
      const isValid = verifyVoteIntegrityToken(
        token,
        deviceKey,
        clipId,
        timestamp,
        10 * 60 * 1000
      );
      expect(isValid).toBe(true);
    });
  });
});
