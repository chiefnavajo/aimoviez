// lib/api-utils.ts
// FIXED: Standardized API utilities for consistent responses and caching

import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Standard API response format
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  meta?: {
    timestamp: string;
    version: string;
    requestId?: string;
    [key: string]: any;
  };
}

/**
 * Paginated response format
 */
export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
    has_more: boolean;
  };
}

/**
 * Custom API Error class
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const ERROR_MESSAGES = {
  INTERNAL_ERROR: 'Internal server error',
  INVALID_REQUEST: 'Invalid request',
  NOT_FOUND: 'Resource not found',
  UNAUTHORIZED: 'Authentication required',
  FORBIDDEN: 'Access denied',
  RATE_LIMITED: 'Too many requests',
  VALIDATION_ERROR: 'Validation failed',
  DATABASE_ERROR: 'Database operation failed',
  NETWORK_ERROR: 'Network request failed',
  TIMEOUT_ERROR: 'Request timeout',
} as const;

export const SUCCESS_MESSAGES = {
  CREATED: 'Resource created successfully',
  UPDATED: 'Resource updated successfully',
  DELETED: 'Resource deleted successfully',
  FETCHED: 'Resource fetched successfully',
} as const;

// ============================================================================
// RESPONSE HELPERS
// ============================================================================

/**
 * Generate request ID for tracking
 */
function generateRequestId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Create standardized success response
 */
export function successResponse<T>(
  data: T,
  message?: string,
  meta?: Record<string, any>,
  status = 200
): NextResponse {
  const response: ApiResponse<T> = {
    success: true,
    data,
    message,
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      requestId: generateRequestId(),
      ...meta,
    },
  };
  
  return NextResponse.json(response, { status });
}

/**
 * Create standardized error response
 */
export function errorResponse(
  error: string | Error | ApiError,
  status = 500,
  details?: any
): NextResponse {
  let message: string;
  let statusCode: number;
  let errorDetails = details;
  
  if (error instanceof ApiError) {
    message = error.message;
    statusCode = error.statusCode;
    errorDetails = error.details || details;
  } else if (error instanceof Error) {
    message = error.message;
    statusCode = status;
  } else {
    message = error;
    statusCode = status;
  }
  
  // Log errors in development
  if (process.env.NODE_ENV === 'development') {
    console.error(`[API Error] ${statusCode}: ${message}`, errorDetails);
  }
  
  const response: ApiResponse = {
    success: false,
    error: message,
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      requestId: generateRequestId(),
      ...(process.env.NODE_ENV === 'development' && errorDetails ? { details: errorDetails } : {}),
    },
  };
  
  return NextResponse.json(response, { status: statusCode });
}

/**
 * Create paginated response
 */
export function paginatedResponse<T>(
  data: T[],
  page: number,
  pageSize: number,
  totalCount: number,
  message?: string,
  meta?: Record<string, any>
): NextResponse {
  const totalPages = Math.ceil(totalCount / pageSize);
  const hasMore = page < totalPages;
  
  const response: PaginatedResponse<T> = {
    success: true,
    data,
    message,
    pagination: {
      page,
      page_size: pageSize,
      total_count: totalCount,
      total_pages: totalPages,
      has_more: hasMore,
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      requestId: generateRequestId(),
      ...meta,
    },
  };
  
  return NextResponse.json(response);
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Validate request body against required fields
 */
export function validateRequest<T>(
  body: any,
  requiredFields: (keyof T)[],
  optionalFields?: (keyof T)[]
): { isValid: boolean; errors: string[]; sanitized: Partial<T> } {
  const errors: string[] = [];
  const sanitized: Partial<T> = {};
  
  // Check required fields
  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null) {
      errors.push(`Missing required field: ${String(field)}`);
    } else {
      sanitized[field] = body[field];
    }
  }
  
  // Include optional fields if present
  if (optionalFields) {
    for (const field of optionalFields) {
      if (body[field] !== undefined) {
        sanitized[field] = body[field];
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    sanitized,
  };
}

/**
 * Parse and validate query parameters
 */
export function parseQueryParams(
  searchParams: URLSearchParams,
  defaults: Record<string, any> = {}
): Record<string, any> {
  const params: Record<string, any> = { ...defaults };
  
  searchParams.forEach((value, key) => {
    // Parse numbers
    if (['page', 'limit', 'page_size', 'offset'].includes(key)) {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num > 0) {
        params[key] = num;
      }
    }
    // Parse booleans
    else if (value === 'true' || value === 'false') {
      params[key] = value === 'true';
    }
    // Parse arrays (comma-separated)
    else if (value.includes(',')) {
      params[key] = value.split(',').map(v => v.trim());
    }
    // Keep as string
    else {
      params[key] = value;
    }
  });
  
  return params;
}

/**
 * Validate pagination params
 */
export function validatePagination(params: any): {
  page: number;
  limit: number;
  offset: number;
} {
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit || params.page_size) || 20));
  const offset = (page - 1) * limit;
  
  return { page, limit, offset };
}

// ============================================================================
// DATABASE HELPERS
// ============================================================================

let supabaseInstance: SupabaseClient | null = null;

/**
 * Get or create Supabase client singleton
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      throw new ApiError(500, 'Database configuration missing');
    }
    
    supabaseInstance = createClient(supabaseUrl, supabaseKey, {
      db: {
        schema: 'public',
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  
  return supabaseInstance;
}

/**
 * Execute database query with error handling
 */
export async function executeQuery<T>(
  queryFn: () => Promise<{ data: T | null; error: any; count?: number | null }>
): Promise<{ data: T; count?: number }> {
  const { data, error, count } = await queryFn();
  
  if (error) {
    console.error('[Database Error]', error);
    throw new ApiError(500, ERROR_MESSAGES.DATABASE_ERROR, error);
  }
  
  if (!data) {
    throw new ApiError(404, ERROR_MESSAGES.NOT_FOUND);
  }
  
  return { data, count: count ?? undefined };
}

// ============================================================================
// CACHING SYSTEM
// ============================================================================

/**
 * Simple in-memory cache implementation
 */
class SimpleCache {
  private cache: Map<string, { data: any; expires: number }> = new Map();
  
  /**
   * Set cache entry
   */
  set(key: string, data: any, ttlSeconds: number): void {
    const expires = Date.now() + (ttlSeconds * 1000);
    this.cache.set(key, { data, expires });
  }
  
  /**
   * Get cache entry
   */
  get(key: string): any | null {
    const item = this.cache.get(key);
    
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }
  
  /**
   * Delete cache entry
   */
  delete(key: string): void {
    this.cache.delete(key);
  }
  
  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }
  
  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        this.cache.delete(key);
      }
    }
  }
  
  /**
   * Get cache stats
   */
  stats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Export singleton cache instance
export const apiCache = new SimpleCache();

// Note: Cache cleanup happens automatically when items are accessed after expiry

/**
 * Execute cached query
 */
export async function cachedQuery<T>(
  key: string,
  queryFn: () => Promise<T>,
  ttlSeconds = 60
): Promise<T> {
  // Check cache first
  const cached = apiCache.get(key);
  if (cached !== null) {
    return cached;
  }

  // Execute query
  const result = await queryFn();
  
  // Store in cache
  apiCache.set(key, result, ttlSeconds);
  
  return result;
}

/**
 * Invalidate cache by pattern
 */
export function invalidateCache(pattern: string): void {
  const stats = apiCache.stats();
  stats.keys.forEach(key => {
    if (key.includes(pattern)) {
      apiCache.delete(key);
    }
  });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate voter key from request
 */
export function getVoterKey(ip: string, userAgent: string): string {
  return crypto.createHash('sha256').update(ip + userAgent).digest('hex');
}

/**
 * Get start of today in UTC
 */
export function getStartOfTodayUTC(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

/**
 * Format date for database
 */
export function formatDateForDB(date: Date): string {
  return date.toISOString();
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      
      const delay = delayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  
  throw new Error('Retry failed');
}

// ============================================================================
// SAFE ERROR RESPONSES (Production-ready)
// ============================================================================

/**
 * Create a production-safe error response
 * Logs full error details server-side but returns sanitized message to client
 */
export function safeErrorResponse(
  message: string,
  status: number,
  error?: unknown,
  context?: string
): NextResponse {
  // Always log the full error server-side
  if (error) {
    console.error(`[API Error${context ? ` - ${context}` : ''}]:`, error);
  }

  // Return sanitized response - never expose internal details
  return NextResponse.json({ error: message }, { status });
}

/**
 * Create a production-safe error response with error code
 */
export function safeErrorWithCode(
  message: string,
  code: string,
  status: number,
  error?: unknown,
  context?: string
): NextResponse {
  if (error) {
    console.error(`[API Error${context ? ` - ${context}` : ''}]:`, error);
  }

  return NextResponse.json({ error: message, code }, { status });
}

/**
 * Sanitize string input for safe storage/display
 */
export function sanitizeString(input: string | undefined | null): string {
  if (!input) return '';
  // Remove control characters (except newlines and tabs)
   
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

/**
 * Validate UUID format
 */
export function validateUUID(input: string | undefined | null): string | null {
  if (!input) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(input) ? input.toLowerCase() : null;
}

// ============================================================================
// EXPORTS
// ============================================================================

export type { SupabaseClient };