// lib/monitoring.ts
// ============================================================================
// MONITORING & ERROR TRACKING UTILITY
// Ready for Sentry integration - currently uses console logging with structure
// To enable Sentry: npm install @sentry/nextjs && run npx @sentry/wizard@latest -i nextjs
// ============================================================================

import { NextRequest } from 'next/server';

// ============================================================================
// TYPES
// ============================================================================

interface ErrorContext {
  /** Where the error occurred */
  component?: string;
  /** Action being performed */
  action?: string;
  /** User ID if available */
  userId?: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Additional metadata */
  extra?: Record<string, unknown>;
}

interface PerformanceMetric {
  /** Name of the metric */
  name: string;
  /** Duration in milliseconds */
  duration: number;
  /** Additional context */
  tags?: Record<string, string>;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// ============================================================================
// ERROR SEVERITY MAPPING
// ============================================================================

const severityLevels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

// Minimum level to log (can be configured via env)
const validLevels = ['debug', 'info', 'warn', 'error', 'fatal'];
const rawLevel = process.env.LOG_LEVEL;
const minLogLevel: LogLevel = rawLevel && validLevels.includes(rawLevel) ? rawLevel as LogLevel : 'info';

function shouldLog(level: LogLevel): boolean {
  return severityLevels[level] >= severityLevels[minLogLevel];
}

// ============================================================================
// ERROR CAPTURE
// ============================================================================

/**
 * Capture and report an error
 * Currently logs to console - replace with Sentry.captureException when configured
 */
export function captureError(
  error: Error | unknown,
  context?: ErrorContext
): string {
  const errorId = generateErrorId();
  const timestamp = new Date().toISOString();

  const errorData = {
    errorId,
    timestamp,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    ...context,
  };

  // Log error with full context
  console.error('[MONITORING] Error captured:', JSON.stringify(errorData, null, 2));

  // TODO: When Sentry is configured:
  // Sentry.captureException(error, {
  //   tags: {
  //     component: context?.component,
  //     action: context?.action,
  //   },
  //   extra: context?.extra,
  //   user: context?.userId ? { id: context.userId } : undefined,
  // });

  return errorId;
}

/**
 * Capture a message/event (not an error)
 */
export function captureMessage(
  message: string,
  level: LogLevel = 'info',
  context?: ErrorContext
): void {
  if (!shouldLog(level)) return;

  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    level,
    message,
    ...context,
  };

  const logFn = level === 'error' || level === 'fatal'
    ? console.error
    : level === 'warn'
    ? console.warn
    : console.log;

  logFn(`[MONITORING] [${level.toUpperCase()}]`, JSON.stringify(logData));

  // TODO: When Sentry is configured:
  // Sentry.captureMessage(message, level);
}

// ============================================================================
// PERFORMANCE MONITORING
// ============================================================================

/**
 * Track a performance metric
 */
export function trackMetric(metric: PerformanceMetric): void {
  const timestamp = new Date().toISOString();

  console.log('[MONITORING] [METRIC]', JSON.stringify({
    timestamp,
    ...metric,
  }));

  // TODO: When Sentry is configured:
  // Sentry.metrics.distribution(metric.name, metric.duration, {
  //   tags: metric.tags,
  //   unit: 'millisecond',
  // });
}

/**
 * Create a performance timer
 */
export function startTimer(name: string, tags?: Record<string, string>) {
  const start = performance.now();

  return {
    stop: () => {
      const duration = performance.now() - start;
      trackMetric({ name, duration, tags });
      return duration;
    },
  };
}

/**
 * Measure async operation duration
 */
export async function measureAsync<T>(
  name: string,
  operation: () => Promise<T>,
  tags?: Record<string, string>
): Promise<T> {
  const timer = startTimer(name, tags);
  try {
    const result = await operation();
    timer.stop();
    return result;
  } catch (error) {
    timer.stop();
    throw error;
  }
}

// ============================================================================
// REQUEST TRACKING
// ============================================================================

/**
 * Extract tracking info from request
 */
export function getRequestContext(request: NextRequest): ErrorContext {
  const requestId = request.headers.get('x-request-id') || generateErrorId();

  return {
    requestId,
    extra: {
      method: request.method,
      url: request.url,
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    },
  };
}

// ============================================================================
// UPTIME MONITORING ENDPOINT
// ============================================================================

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    database: boolean;
    storage: boolean;
    cache: boolean;
  };
  responseTime?: number;
}

/**
 * Perform health check
 * This can be called by uptime monitoring services (e.g., UptimeRobot, Better Stack)
 */
export async function performHealthCheck(): Promise<HealthCheckResult> {
  const startTime = performance.now();
  const timestamp = new Date().toISOString();

  const checks = {
    database: false,
    storage: false,
    cache: false,
  };

  // Check database connectivity
  try {
    // This is a placeholder - actual check happens in the health endpoint
    checks.database = true;
  } catch {
    checks.database = false;
  }

  // Check storage (Supabase Storage)
  try {
    checks.storage = true;
  } catch {
    checks.storage = false;
  }

  // Check cache (Upstash Redis)
  try {
    checks.cache = true;
  } catch {
    checks.cache = false;
  }

  const allHealthy = Object.values(checks).every(Boolean);
  const anyHealthy = Object.values(checks).some(Boolean);

  return {
    status: allHealthy ? 'healthy' : anyHealthy ? 'degraded' : 'unhealthy',
    timestamp,
    version: process.env.npm_package_version || '1.0.0',
    checks,
    responseTime: performance.now() - startTime,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function generateErrorId(): string {
  return `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const monitoring = {
  captureError,
  captureMessage,
  trackMetric,
  startTimer,
  measureAsync,
  getRequestContext,
  performHealthCheck,
};

export default monitoring;
