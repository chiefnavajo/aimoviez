// lib/device-fingerprint.ts
// Enhanced device fingerprinting for vote integrity
// Combines multiple signals to create a more robust device identifier

import crypto from 'crypto';
import { NextRequest } from 'next/server';

/**
 * Extracts all available device signals from a request
 */
interface DeviceSignals {
  ip: string;
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
  secChUa: string | null;           // Client hints - browser info
  secChUaPlatform: string | null;   // Client hints - platform
  secChUaMobile: string | null;     // Client hints - mobile
  secFetchDest: string | null;
  secFetchMode: string | null;
  timezone: string | null;          // From custom header if client sends it
  screenRes: string | null;         // From custom header if client sends it
}

/**
 * Extract device signals from request headers
 */
export function extractDeviceSignals(req: NextRequest): DeviceSignals {
  const headers = req.headers;

  // Get IP from various sources
  const cfConnectingIp = headers.get('cf-connecting-ip');
  const forwarded = headers.get('x-forwarded-for');
  const realIp = headers.get('x-real-ip');

  const ip = cfConnectingIp ||
             (forwarded ? forwarded.split(',')[0].trim() : null) ||
             realIp ||
             'unknown';

  return {
    ip,
    userAgent: headers.get('user-agent') || 'unknown',
    acceptLanguage: headers.get('accept-language') || '',
    acceptEncoding: headers.get('accept-encoding') || '',
    secChUa: headers.get('sec-ch-ua'),
    secChUaPlatform: headers.get('sec-ch-ua-platform'),
    secChUaMobile: headers.get('sec-ch-ua-mobile'),
    secFetchDest: headers.get('sec-fetch-dest'),
    secFetchMode: headers.get('sec-fetch-mode'),
    timezone: headers.get('x-timezone'),           // Client can send this
    screenRes: headers.get('x-screen-resolution'), // Client can send this
  };
}

/**
 * Generate a device fingerprint hash from signals
 * This creates a more robust identifier than just IP+UA
 */
export function generateDeviceFingerprint(signals: DeviceSignals): string {
  // Combine signals into a fingerprint string
  // Order matters - put most stable signals first
  const fingerprintData = [
    signals.ip,
    signals.userAgent,
    signals.acceptLanguage,
    signals.secChUa || '',
    signals.secChUaPlatform || '',
    signals.secChUaMobile || '',
    signals.acceptEncoding,
  ].join('|');

  // Create a secure hash
  return crypto
    .createHash('sha256')
    .update(fingerprintData)
    .digest('hex');
}

/**
 * Generate a shorter device key for storage
 */
export function generateDeviceKey(req: NextRequest): string {
  const signals = extractDeviceSignals(req);
  const fullHash = generateDeviceFingerprint(signals);
  return `device_${fullHash.slice(0, 32)}`;
}

/**
 * Legacy device key function (for backwards compatibility)
 * Uses only IP + UA
 */
export function getLegacyDeviceKey(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() :
             req.headers.get('x-real-ip') || 'unknown';
  const ua = req.headers.get('user-agent') || 'unknown';

  return crypto
    .createHash('sha256')
    .update(`${ip}|${ua}`)
    .digest('hex');
}

/**
 * Check if a device fingerprint looks suspicious
 * Returns a risk score (0-100)
 */
export function assessDeviceRisk(signals: DeviceSignals): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  // Check for automation indicators
  if (!signals.userAgent || signals.userAgent === 'unknown') {
    score += 30;
    reasons.push('Missing user agent');
  }

  // Check for headless browser indicators
  if (signals.userAgent.includes('HeadlessChrome') ||
      signals.userAgent.includes('PhantomJS') ||
      signals.userAgent.includes('Selenium')) {
    score += 50;
    reasons.push('Automated browser detected');
  }

  // Check for missing standard headers
  if (!signals.acceptLanguage) {
    score += 10;
    reasons.push('Missing accept-language');
  }

  // Check for suspicious client hints
  if (signals.secChUa === null && signals.userAgent.includes('Chrome/')) {
    // Modern Chrome should send client hints
    score += 15;
    reasons.push('Missing client hints from Chrome');
  }

  // Check for data center IPs (simplified check)
  // In production, you'd use a proper IP reputation service
  if (signals.ip.startsWith('10.') ||
      signals.ip.startsWith('172.') ||
      signals.ip.startsWith('192.168.')) {
    // Private IPs are fine (behind NAT)
  }

  // Cap the score at 100
  return {
    score: Math.min(100, score),
    reasons,
  };
}

/**
 * Determine if a vote should be flagged for review
 */
export function shouldFlagVote(signals: DeviceSignals): boolean {
  const risk = assessDeviceRisk(signals);
  return risk.score >= 40;
}

/**
 * Generate a vote integrity token
 * This can be used to verify votes weren't tampered with
 */
export function generateVoteIntegrityToken(
  deviceKey: string,
  clipId: string,
  timestamp: number,
  secret: string = process.env.VOTE_INTEGRITY_SECRET || (
    process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('VOTE_INTEGRITY_SECRET must be set in production'); })()
      : 'dev-only-vote-secret-not-for-production'
  )
): string {
  const data = `${deviceKey}:${clipId}:${timestamp}`;
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Verify a vote integrity token
 */
export function verifyVoteIntegrityToken(
  token: string,
  deviceKey: string,
  clipId: string,
  timestamp: number,
  maxAgeMs: number = 5 * 60 * 1000, // 5 minutes default
  secret: string = process.env.VOTE_INTEGRITY_SECRET || (
    process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('VOTE_INTEGRITY_SECRET must be set in production'); })()
      : 'dev-only-vote-secret-not-for-production'
  )
): boolean {
  // Check if timestamp is within allowed window
  const now = Date.now();
  if (Math.abs(now - timestamp) > maxAgeMs) {
    return false;
  }

  // Regenerate and compare
  const expected = generateVoteIntegrityToken(deviceKey, clipId, timestamp, secret);
  return crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(expected)
  );
}
