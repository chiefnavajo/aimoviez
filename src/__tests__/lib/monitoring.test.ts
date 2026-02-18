/**
 * @jest-environment node
 */

import {
  captureError,
  captureMessage,
  trackMetric,
  startTimer,
  measureAsync,
  getRequestContext,
  performHealthCheck,
} from '@/lib/monitoring';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// captureError
// ---------------------------------------------------------------------------

describe('captureError', () => {
  it('returns an error ID string starting with err_', () => {
    const id = captureError(new Error('test error'));
    expect(id).toMatch(/^err_/);
  });

  it('logs the error via console.error with MONITORING prefix', () => {
    captureError(new Error('boom'), { component: 'vote-api' });

    expect(console.error).toHaveBeenCalledTimes(1);
    const output = (console.error as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('[MONITORING]');
    expect(output).toContain('boom');
    expect(output).toContain('vote-api');
  });

  it('handles non-Error values as message strings', () => {
    const id = captureError('string error');
    expect(id).toMatch(/^err_/);

    const output = (console.error as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('string error');
  });

  it('includes context fields in the logged data', () => {
    captureError(new Error('ctx err'), {
      component: 'auth',
      action: 'login',
      userId: 'u-123',
      requestId: 'req-456',
      extra: { attempt: 3 },
    });

    const output = (console.error as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('auth');
    expect(output).toContain('login');
    expect(output).toContain('u-123');
    expect(output).toContain('req-456');
  });
});

// ---------------------------------------------------------------------------
// captureMessage
// ---------------------------------------------------------------------------

describe('captureMessage', () => {
  it('logs info messages via console.log', () => {
    captureMessage('info event', 'info');

    expect(console.log).toHaveBeenCalledTimes(1);
    const output = (console.log as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('[MONITORING]');
    expect(output).toContain('[INFO]');
    expect(output).toContain('info event');
  });

  it('logs warn messages via console.warn', () => {
    captureMessage('warning event', 'warn');

    expect(console.warn).toHaveBeenCalledTimes(1);
    const output = (console.warn as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('[WARN]');
  });

  it('logs error messages via console.error', () => {
    captureMessage('error event', 'error');

    expect(console.error).toHaveBeenCalledTimes(1);
    const output = (console.error as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('[ERROR]');
  });

  it('logs fatal messages via console.error', () => {
    captureMessage('fatal event', 'fatal');

    expect(console.error).toHaveBeenCalledTimes(1);
    const output = (console.error as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('[FATAL]');
  });

  it('respects minimum log level (skips messages below threshold)', () => {
    const originalLevel = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'error';

    // Need fresh import to pick up the env change
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mon = require('@/lib/monitoring');
      mon.captureMessage('should be skipped', 'info');
    });

    expect(console.log).not.toHaveBeenCalled();

    process.env.LOG_LEVEL = originalLevel;
  });

  it('defaults to info level', () => {
    captureMessage('default level');

    expect(console.log).toHaveBeenCalledTimes(1);
    const output = (console.log as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('[INFO]');
  });
});

// ---------------------------------------------------------------------------
// trackMetric
// ---------------------------------------------------------------------------

describe('trackMetric', () => {
  it('logs the metric with name and duration', () => {
    trackMetric({ name: 'api.response_time', duration: 142.5 });

    expect(console.log).toHaveBeenCalledTimes(1);
    const output = (console.log as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('[MONITORING]');
    expect(output).toContain('[METRIC]');
    expect(output).toContain('api.response_time');
    expect(output).toContain('142.5');
  });

  it('includes tags when provided', () => {
    trackMetric({
      name: 'db.query',
      duration: 50,
      tags: { table: 'clips', operation: 'select' },
    });

    const output = (console.log as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('clips');
    expect(output).toContain('select');
  });
});

// ---------------------------------------------------------------------------
// startTimer / measureAsync
// ---------------------------------------------------------------------------

describe('startTimer', () => {
  it('returns an object with a stop method', () => {
    const timer = startTimer('test-op');
    expect(timer).toHaveProperty('stop');
    expect(typeof timer.stop).toBe('function');
  });

  it('stop() returns the elapsed duration and logs a metric', () => {
    const timer = startTimer('test-op');

    // Simulate some time passing (timers use performance.now)
    const duration = timer.stop();

    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(console.log).toHaveBeenCalledTimes(1);
  });
});

describe('measureAsync', () => {
  it('returns the result of the async operation', async () => {
    const result = await measureAsync('async-op', async () => {
      return 'hello';
    });

    expect(result).toBe('hello');
    expect(console.log).toHaveBeenCalledTimes(1); // metric logged
  });

  it('still logs the metric when the operation throws', async () => {
    await expect(
      measureAsync('failing-op', async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');

    // Metric should still be logged even on failure
    expect(console.log).toHaveBeenCalledTimes(1);
  });

  it('passes tags to the metric', async () => {
    await measureAsync(
      'tagged-op',
      async () => 42,
      { route: '/api/vote' }
    );

    const output = (console.log as jest.Mock).mock.calls[0].join(' ');
    expect(output).toContain('/api/vote');
  });
});

// ---------------------------------------------------------------------------
// getRequestContext
// ---------------------------------------------------------------------------

describe('getRequestContext', () => {
  it('extracts request context from a NextRequest', () => {
    const mockReq = {
      method: 'POST',
      url: 'http://localhost:3000/api/vote',
      headers: new Headers({
        'x-request-id': 'trace-abc',
        'user-agent': 'TestBot/1.0',
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
      }),
    } as unknown as import('next/server').NextRequest;

    const ctx = getRequestContext(mockReq);

    expect(ctx.requestId).toBe('trace-abc');
    expect(ctx.extra).toEqual(
      expect.objectContaining({
        method: 'POST',
        url: 'http://localhost:3000/api/vote',
        userAgent: 'TestBot/1.0',
        ip: '1.2.3.4',
      })
    );
  });

  it('generates a request ID when header is missing', () => {
    const mockReq = {
      method: 'GET',
      url: 'http://localhost:3000/api/health',
      headers: new Headers(),
    } as unknown as import('next/server').NextRequest;

    const ctx = getRequestContext(mockReq);
    expect(ctx.requestId).toMatch(/^err_/);
  });
});

// ---------------------------------------------------------------------------
// performHealthCheck
// ---------------------------------------------------------------------------

describe('performHealthCheck', () => {
  it('returns a healthy status with all checks passing', async () => {
    const result = await performHealthCheck();

    expect(result.status).toBe('healthy');
    expect(result.checks.database).toBe(true);
    expect(result.checks.storage).toBe(true);
    expect(result.checks.cache).toBe(true);
    expect(result.timestamp).toBeDefined();
    expect(typeof result.responseTime).toBe('number');
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('includes version from env or defaults to 1.0.0', async () => {
    const result = await performHealthCheck();
    expect(result.version).toBeDefined();
    // Either from process.env.npm_package_version or default '1.0.0'
    expect(typeof result.version).toBe('string');
  });
});
