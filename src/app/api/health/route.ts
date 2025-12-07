// app/api/health/route.ts
// ============================================================================
// HEALTH CHECK ENDPOINT
// For uptime monitoring services (UptimeRobot, Better Stack, Checkly, etc.)
// ============================================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  duration?: number;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: HealthCheck[];
}

// Track server start time
const serverStartTime = Date.now();

// ============================================================================
// HEALTH CHECKS
// ============================================================================

async function checkDatabase(): Promise<HealthCheck> {
  const start = performance.now();
  const name = 'database';

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      return { name, status: 'fail', message: 'Missing database configuration' };
    }

    // Use anon key - service role not needed for health checks
    const supabase = createClient(url, key);

    // Simple query to check connectivity
    const { error } = await supabase
      .from('seasons')
      .select('id')
      .limit(1)
      .single();

    const duration = performance.now() - start;

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned, which is fine for health check
      return { name, status: 'fail', message: error.message, duration };
    }

    // Warn if response is slow (>500ms)
    if (duration > 500) {
      return { name, status: 'warn', message: 'Slow response', duration };
    }

    return { name, status: 'pass', duration };
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      duration: performance.now() - start,
    };
  }
}

async function checkStorage(): Promise<HealthCheck> {
  const start = performance.now();
  const name = 'storage';

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      return { name, status: 'fail', message: 'Missing storage configuration' };
    }

    // Use anon key - service role not needed for health checks
    const supabase = createClient(url, key);

    // Check a public bucket exists (doesn't need service role)
    const { error } = await supabase.storage.from('clips').list('', { limit: 1 });
    const duration = performance.now() - start;

    if (error) {
      // Bucket not found or permission error is still a valid response
      if (error.message?.includes('not found')) {
        return { name, status: 'warn', message: 'Bucket not configured', duration };
      }
      return { name, status: 'fail', message: error.message, duration };
    }

    return { name, status: 'pass', duration };
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      duration: performance.now() - start,
    };
  }
}

async function checkCache(): Promise<HealthCheck> {
  const start = performance.now();
  const name = 'cache';

  try {
    // Check if Redis environment variables are configured
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!redisUrl || !redisToken) {
      return { name, status: 'warn', message: 'Cache not configured (optional)' };
    }

    // Dynamic import to avoid errors if not configured
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url: redisUrl, token: redisToken });

    // Simple ping
    await redis.ping();
    const duration = performance.now() - start;

    return { name, status: 'pass', duration };
  } catch (error) {
    return {
      name,
      status: 'warn', // Cache is optional, so just warn
      message: error instanceof Error ? error.message : 'Unknown error',
      duration: performance.now() - start,
    };
  }
}

function checkEnvironment(): HealthCheck {
  const name = 'environment';

  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXTAUTH_SECRET',
    'NEXTAUTH_URL',
  ];

  const missing = requiredEnvVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    return {
      name,
      status: 'fail',
      message: `Missing: ${missing.join(', ')}`,
    };
  }

  return { name, status: 'pass' };
}

// ============================================================================
// GET - Health Check
// ============================================================================

export async function GET() {
  const timestamp = new Date().toISOString();
  const uptime = Math.floor((Date.now() - serverStartTime) / 1000);

  // Run all checks in parallel
  const checks = await Promise.all([
    checkEnvironment(),
    checkDatabase(),
    checkStorage(),
    checkCache(),
  ]);

  // Determine overall status
  const hasFailure = checks.some((c) => c.status === 'fail');
  const hasWarning = checks.some((c) => c.status === 'warn');

  let status: 'healthy' | 'degraded' | 'unhealthy';
  let httpStatus: number;

  if (hasFailure) {
    status = 'unhealthy';
    httpStatus = 503;
  } else if (hasWarning) {
    status = 'degraded';
    httpStatus = 200;
  } else {
    status = 'healthy';
    httpStatus = 200;
  }

  const response: HealthResponse = {
    status,
    timestamp,
    version: process.env.npm_package_version || '1.0.0',
    uptime,
    checks,
  };

  return NextResponse.json(response, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

// Also support HEAD requests for simple uptime checks
export async function HEAD() {
  try {
    // Quick database check using anon key
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (url && key) {
      const supabase = createClient(url, key);
      await supabase.from('seasons').select('id').limit(1);
    }

    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
