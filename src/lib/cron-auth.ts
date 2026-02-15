// lib/cron-auth.ts
// Timing-safe authentication for cron and internal API routes.

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * Verify the CRON_SECRET bearer token using timing-safe comparison.
 * Returns null if auth passes, or a NextResponse error if it fails.
 */
export function verifyCronAuth(authHeader: string | null): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    // Non-production without CRON_SECRET: allow for local dev
    return null;
  }

  if (!authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const expected = `Bearer ${cronSecret}`;

  // Timing-safe comparison to prevent side-channel attacks
  try {
    const authBuf = Buffer.from(authHeader, 'utf-8');
    const expectedBuf = Buffer.from(expected, 'utf-8');

    if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
