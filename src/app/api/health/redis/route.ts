// app/api/health/redis/route.ts
// ============================================================================
// REDIS HEALTH CHECK ENDPOINT
// Dedicated monitoring endpoint for Redis/Upstash availability
// Used by uptime monitoring and the circuit breaker (Phase 1)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

// ============================================================================
// TYPES
// ============================================================================

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  duration?: number;
}

interface RedisHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: HealthCheck[];
}

// ============================================================================
// HEALTH CHECKS
// ============================================================================

async function checkConnectivity(): Promise<HealthCheck> {
  const start = performance.now();
  const name = 'connectivity';

  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      return { name, status: 'fail', message: 'Redis not configured (missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN)' };
    }

    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url, token });

    const result = await redis.ping();
    const duration = performance.now() - start;

    if (result !== 'PONG') {
      return { name, status: 'fail', message: `Unexpected PING response: ${String(result)}`, duration };
    }

    return { name, status: 'pass', duration };
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: process.env.NODE_ENV === 'production' ? 'Service unavailable' : (error instanceof Error ? error.message : 'Unknown error'),
      duration: performance.now() - start,
    };
  }
}

async function checkLatency(): Promise<HealthCheck> {
  const start = performance.now();
  const name = 'latency';

  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      return { name, status: 'warn', message: 'Cannot measure latency — Redis not configured' };
    }

    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url, token });

    const pingStart = performance.now();
    await redis.ping();
    const duration = performance.now() - pingStart;

    if (duration > 100) {
      return { name, status: 'warn', message: `High latency: ${duration.toFixed(1)}ms`, duration };
    }

    return { name, status: 'pass', message: `${duration.toFixed(1)}ms`, duration };
  } catch (error) {
    return {
      name,
      status: 'fail',
      message: process.env.NODE_ENV === 'production' ? 'Service unavailable' : (error instanceof Error ? error.message : 'Unknown error'),
      duration: performance.now() - start,
    };
  }
}

async function checkMemory(): Promise<HealthCheck> {
  const name = 'memory';

  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      return { name, status: 'warn', message: 'Cannot check memory — Redis not configured' };
    }

    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url, token });

    try {
      // Upstash REST SDK doesn't expose INFO directly — use DBSIZE as a proxy health check
      const dbSize = await redis.dbsize();
      return {
        name,
        status: 'pass',
        message: `Keys: ${dbSize}`,
      };
    } catch {
      // DBSIZE may not be available on all Upstash plans
      return { name, status: 'warn', message: 'DBSIZE command not available (Upstash limitation)' };
    }
  } catch (error) {
    return {
      name,
      status: 'warn',
      message: process.env.NODE_ENV === 'production' ? 'Service unavailable' : (error instanceof Error ? error.message : 'Unknown error'),
    };
  }
}

// ============================================================================
// GET - Redis Health Check
// ============================================================================

export async function GET(req: NextRequest) {
  const rateLimitResponse = await rateLimit(req, 'api');
  if (rateLimitResponse) return rateLimitResponse;

  const timestamp = new Date().toISOString();

  const checks = await Promise.all([
    checkConnectivity(),
    checkLatency(),
    checkMemory(),
  ]);

  const hasFailure = checks.some((c) => c.status === 'fail');
  const hasWarning = checks.some((c) => c.status === 'warn');

  let status: RedisHealthResponse['status'];
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

  const response: RedisHealthResponse = {
    status,
    timestamp,
    checks,
  };

  return NextResponse.json(response, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

// HEAD method for simple uptime checks
export async function HEAD() {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      return new NextResponse(null, { status: 503 });
    }

    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url, token });
    await redis.ping();

    return new NextResponse(null, { status: 200 });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
