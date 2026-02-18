/**
 * @jest-environment node
 */

import {
  createLogger,
  createRequestLogger,
  generateRequestId,
  createErrorResponse,
  getUserFriendlyMessage,
  logAudit,
} from '@/lib/logger';

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
// generateRequestId
// ---------------------------------------------------------------------------

describe('generateRequestId', () => {
  it('returns a 16-character hex string', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[a-f0-9]{16}$/);
  });

  it('generates unique IDs on each call', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateRequestId()));
    expect(ids.size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// createLogger
// ---------------------------------------------------------------------------

describe('createLogger', () => {
  it('creates a logger with the given service name', () => {
    const logger = createLogger('test-service');
    expect(logger).toBeDefined();
    expect(logger.getRequestId()).toMatch(/^[a-f0-9]{16}$/);
  });

  it('uses the provided requestId', () => {
    const logger = createLogger('svc', 'custom-request-id');
    expect(logger.getRequestId()).toBe('custom-request-id');
  });

  describe('log levels', () => {
    it('logs info messages via console.log', () => {
      const logger = createLogger('test-svc');
      logger.info('hello info');

      expect(console.log).toHaveBeenCalledTimes(1);
      const msg = (console.log as jest.Mock).mock.calls[0][0];
      expect(msg).toContain('[INFO]');
      expect(msg).toContain('[test-svc]');
      expect(msg).toContain('hello info');
    });

    it('logs warn messages via console.warn', () => {
      const logger = createLogger('test-svc');
      logger.warn('a warning');

      expect(console.warn).toHaveBeenCalledTimes(1);
      const msg = (console.warn as jest.Mock).mock.calls[0][0];
      expect(msg).toContain('[WARN]');
      expect(msg).toContain('a warning');
    });

    it('logs error messages via console.error', () => {
      const logger = createLogger('test-svc');
      logger.error('an error', new Error('boom'));

      expect(console.error).toHaveBeenCalled();
      const msg = (console.error as jest.Mock).mock.calls[0][0];
      expect(msg).toContain('[ERROR]');
      expect(msg).toContain('an error');
    });

    it('suppresses debug messages in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const logger = createLogger('svc');
      logger.debug('should be hidden');

      expect(console.log).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });

    it('emits debug messages in non-production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const logger = createLogger('svc');
      logger.debug('visible debug');

      expect(console.log).toHaveBeenCalledTimes(1);
      const msg = (console.log as jest.Mock).mock.calls[0][0];
      expect(msg).toContain('[DEBUG]');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('context handling', () => {
    it('includes context object in log output', () => {
      const logger = createLogger('svc');
      logger.info('with context', { count: 42, action: 'test' });

      expect(console.log).toHaveBeenCalledTimes(1);
      const args = (console.log as jest.Mock).mock.calls[0];
      // In dev mode, context is the second argument
      expect(args[1]).toEqual(expect.objectContaining({ count: 42, action: 'test' }));
    });

    it('redacts sensitive keys in context', () => {
      const logger = createLogger('svc');
      logger.info('sensitive', {
        password: 'secret123',
        token: 'abc-def',
        authorization: 'Bearer xyz',
        email: 'user@test.com',
        username: 'safe-value',
      });

      const args = (console.log as jest.Mock).mock.calls[0];
      const sanitized = args[1];
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
      expect(sanitized.authorization).toBe('[REDACTED]');
      expect(sanitized.email).toBe('[REDACTED]');
      expect(sanitized.username).toBe('safe-value');
    });

    it('truncates long string values in context', () => {
      const logger = createLogger('svc');
      const longValue = 'x'.repeat(600);
      logger.info('truncation', { bigField: longValue });

      const args = (console.log as jest.Mock).mock.calls[0];
      const sanitized = args[1];
      expect(sanitized.bigField.length).toBeLessThan(600);
      expect(sanitized.bigField).toContain('...[truncated]');
    });
  });

  describe('child logger', () => {
    it('creates a child logger with same requestId', () => {
      const parent = createLogger('parent-svc', 'shared-id');
      const child = parent.child('child-svc');

      expect(child.getRequestId()).toBe('shared-id');
    });
  });

  describe('production JSON output', () => {
    it('outputs JSON in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const logger = createLogger('prod-svc', 'req-abc');
      logger.info('json message');

      expect(console.log).toHaveBeenCalledTimes(1);
      const output = (console.log as jest.Mock).mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.level).toBe('info');
      expect(parsed.service).toBe('prod-svc');
      expect(parsed.requestId).toBe('req-abc');
      expect(parsed.message).toBe('json message');
      expect(parsed.timestamp).toBeDefined();

      process.env.NODE_ENV = originalEnv;
    });
  });
});

// ---------------------------------------------------------------------------
// createRequestLogger
// ---------------------------------------------------------------------------

describe('createRequestLogger', () => {
  it('uses x-request-id from request headers if present', () => {
    const mockReq = {
      method: 'GET',
      url: 'http://localhost:3000/api/test',
      headers: new Headers({ 'x-request-id': 'trace-123' }),
    } as unknown as import('next/server').NextRequest;

    const logger = createRequestLogger('api-svc', mockReq);
    expect(logger.getRequestId()).toBe('trace-123');
  });

  it('generates a new requestId when header is absent', () => {
    const mockReq = {
      method: 'GET',
      url: 'http://localhost:3000/api/test',
      headers: new Headers(),
    } as unknown as import('next/server').NextRequest;

    const logger = createRequestLogger('api-svc', mockReq);
    expect(logger.getRequestId()).toMatch(/^[a-f0-9]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// createErrorResponse
// ---------------------------------------------------------------------------

describe('createErrorResponse', () => {
  it('builds a structured error response', () => {
    const resp = createErrorResponse('Something went wrong', 'ERR_INTERNAL', 'req-999');

    expect(resp).toEqual({
      success: false,
      error: 'Something went wrong',
      code: 'ERR_INTERNAL',
      requestId: 'req-999',
    });
  });

  it('works without optional fields', () => {
    const resp = createErrorResponse('Oops');

    expect(resp).toEqual({
      success: false,
      error: 'Oops',
      code: undefined,
      requestId: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// getUserFriendlyMessage
// ---------------------------------------------------------------------------

describe('getUserFriendlyMessage', () => {
  it('returns network message for network errors', () => {
    expect(getUserFriendlyMessage(new Error('Network failure'))).toContain('Network error');
  });

  it('returns network message for fetch errors', () => {
    expect(getUserFriendlyMessage(new Error('fetch failed'))).toContain('Network error');
  });

  it('returns timeout message for timeout errors', () => {
    expect(getUserFriendlyMessage(new Error('Request timeout'))).toContain('timed out');
  });

  it('returns auth message for unauthorized errors', () => {
    expect(getUserFriendlyMessage(new Error('Unauthorized access'))).toContain('Authentication');
  });

  it('returns permission message for forbidden errors', () => {
    expect(getUserFriendlyMessage(new Error('Permission denied'))).toContain('permission');
  });

  it('returns not found message for not found errors', () => {
    expect(getUserFriendlyMessage(new Error('Resource not found'))).toContain('not found');
  });

  it('returns rate limit message for too many requests', () => {
    expect(getUserFriendlyMessage(new Error('Too many requests'))).toContain('Too many requests');
  });

  it('returns validation message for invalid input', () => {
    expect(getUserFriendlyMessage(new Error('Invalid data'))).toContain('Invalid input');
  });

  it('returns fallback message for unknown errors', () => {
    expect(getUserFriendlyMessage(new Error('Something obscure'))).toBe('An unexpected error occurred');
  });

  it('returns custom fallback when provided', () => {
    expect(getUserFriendlyMessage('string error', 'Custom fallback')).toBe('Custom fallback');
  });

  it('returns fallback for non-Error values', () => {
    expect(getUserFriendlyMessage(42)).toBe('An unexpected error occurred');
    expect(getUserFriendlyMessage(null)).toBe('An unexpected error occurred');
  });
});

// ---------------------------------------------------------------------------
// logAudit
// ---------------------------------------------------------------------------

describe('logAudit', () => {
  it('logs an audit entry via logger.info with AUDIT prefix', () => {
    const logger = createLogger('audit-svc');
    logAudit(logger, {
      action: 'delete_user',
      userId: 'user-123',
      resourceType: 'user',
      resourceId: 'user-123',
      details: { reason: 'requested' },
    });

    expect(console.log).toHaveBeenCalledTimes(1);
    const msg = (console.log as jest.Mock).mock.calls[0][0];
    expect(msg).toContain('AUDIT: delete_user');
  });
});
