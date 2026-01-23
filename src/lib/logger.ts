// lib/logger.ts
// Structured logging utility for consistent error handling and audit trails

import { NextRequest } from 'next/server';
import crypto from 'crypto';

// Log levels
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Structured log entry
interface LogEntry {
  timestamp: string;
  level: LogLevel;
  requestId: string;
  service: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  request?: {
    method: string;
    path: string;
    userAgent?: string;
    ip?: string;
  };
  duration?: number;
}

// Generate a unique request ID
export function generateRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// Extract request context
function extractRequestContext(req?: NextRequest): LogEntry['request'] | undefined {
  if (!req) return undefined;

  return {
    method: req.method,
    path: new URL(req.url).pathname,
    userAgent: req.headers.get('user-agent') || undefined,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] || undefined,
  };
}

// Sanitize error for logging (remove sensitive data)
function sanitizeError(error: unknown): LogEntry['error'] | undefined {
  if (!error) return undefined;

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      // Only include stack in development
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    };
  }

  return {
    name: 'UnknownError',
    message: String(error),
  };
}

// Main logger class
class Logger {
  private service: string;
  private requestId: string;

  constructor(service: string, requestId?: string) {
    this.service = service;
    this.requestId = requestId || generateRequestId();
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown, req?: NextRequest) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      requestId: this.requestId,
      service: this.service,
      message,
      context: context ? this.sanitizeContext(context) : undefined,
      error: sanitizeError(error),
      request: extractRequestContext(req),
    };

    // Format output based on environment
    if (process.env.NODE_ENV === 'production') {
      // JSON format for production (easier to parse by log aggregators)
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
        JSON.stringify(entry)
      );
    } else {
      // Human-readable format for development
      const prefix = `[${entry.timestamp}] [${level.toUpperCase()}] [${this.service}] [${this.requestId}]`;
      const msg = `${prefix} ${message}`;

      if (context) {
        console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
          msg,
          this.sanitizeContext(context)
        );
      } else {
        console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](msg);
      }

      if (error && error instanceof Error && error.stack) {
        console.error(error.stack);
      }
    }
  }

  // Sanitize context to remove sensitive data
  private sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization', 'cookie', 'email', 'ip', 'ip_address', 'ipaddress'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'string' && value.length > 500) {
        sanitized[key] = value.substring(0, 500) + '...[truncated]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  debug(message: string, context?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== 'production') {
      this.log('debug', message, context);
    }
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>, error?: unknown) {
    this.log('warn', message, context, error);
  }

  error(message: string, error?: unknown, context?: Record<string, unknown>, req?: NextRequest) {
    this.log('error', message, context, error, req);
  }

  // Create a child logger with the same request ID
  child(service: string): Logger {
    return new Logger(service, this.requestId);
  }

  getRequestId(): string {
    return this.requestId;
  }
}

// Factory function to create a logger for a service
export function createLogger(service: string, requestId?: string): Logger {
  return new Logger(service, requestId);
}

// Helper to create logger from request
export function createRequestLogger(service: string, req: NextRequest): Logger {
  // Try to get request ID from header (for tracing across services)
  const existingId = req.headers.get('x-request-id');
  return new Logger(service, existingId || generateRequestId());
}

// Standardized error response helper
export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  requestId?: string;
}

// Create a safe error response (never expose internal details)
export function createErrorResponse(
  userMessage: string,
  code?: string,
  requestId?: string
): ApiErrorResponse {
  return {
    success: false,
    error: userMessage,
    code,
    requestId,
  };
}

// Map internal errors to user-friendly messages
export function getUserFriendlyMessage(error: unknown, fallback: string = 'An unexpected error occurred'): string {
  if (error instanceof Error) {
    // Check for known error types
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('fetch')) {
      return 'Network error. Please check your connection and try again.';
    }
    if (message.includes('timeout')) {
      return 'Request timed out. Please try again.';
    }
    if (message.includes('unauthorized') || message.includes('authentication')) {
      return 'Authentication required. Please sign in.';
    }
    if (message.includes('forbidden') || message.includes('permission')) {
      return 'You do not have permission to perform this action.';
    }
    if (message.includes('not found')) {
      return 'The requested resource was not found.';
    }
    if (message.includes('rate limit') || message.includes('too many')) {
      return 'Too many requests. Please wait a moment and try again.';
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return 'Invalid input. Please check your data and try again.';
    }
  }

  return fallback;
}

// Audit log helper for sensitive operations
export interface AuditLogEntry {
  action: string;
  userId?: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export function logAudit(logger: Logger, entry: AuditLogEntry) {
  logger.info(`AUDIT: ${entry.action}`, {
    audit: true,
    action: entry.action,
    userId: entry.userId,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    details: entry.details,
    ip: entry.ip,
    userAgent: entry.userAgent,
  });
}
