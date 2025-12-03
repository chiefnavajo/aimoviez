// lib/api-errors.ts
// ============================================================================
// SAFE API ERROR HANDLING
// Prevents exposing internal error details to clients
// ============================================================================

import { NextResponse } from 'next/server';

// ============================================================================
// TYPES
// ============================================================================

export interface ApiError {
  code: string;
  message: string;
  status: number;
}

// ============================================================================
// PREDEFINED ERROR RESPONSES
// ============================================================================

export const API_ERRORS = {
  // Authentication errors
  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    message: 'Authentication required',
    status: 401,
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    message: 'You do not have permission to access this resource',
    status: 403,
  },

  // Validation errors
  BAD_REQUEST: {
    code: 'BAD_REQUEST',
    message: 'Invalid request',
    status: 400,
  },
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid input data',
    status: 400,
  },

  // Resource errors
  NOT_FOUND: {
    code: 'NOT_FOUND',
    message: 'Resource not found',
    status: 404,
  },
  CONFLICT: {
    code: 'CONFLICT',
    message: 'Resource conflict',
    status: 409,
  },

  // Rate limiting
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please try again later.',
    status: 429,
  },

  // Server errors
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred. Please try again later.',
    status: 500,
  },
  SERVICE_UNAVAILABLE: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Service temporarily unavailable',
    status: 503,
  },

  // Voting specific
  ALREADY_VOTED: {
    code: 'ALREADY_VOTED',
    message: 'You have already voted on this clip',
    status: 409,
  },
  VOTE_LIMIT_REACHED: {
    code: 'VOTE_LIMIT_REACHED',
    message: 'Daily vote limit reached',
    status: 429,
  },
  NO_ACTIVE_VOTING: {
    code: 'NO_ACTIVE_VOTING',
    message: 'No active voting round',
    status: 400,
  },

  // Upload specific
  FILE_TOO_LARGE: {
    code: 'FILE_TOO_LARGE',
    message: 'File size exceeds the maximum allowed',
    status: 413,
  },
  INVALID_FILE_TYPE: {
    code: 'INVALID_FILE_TYPE',
    message: 'Invalid file type. Please upload a valid video file.',
    status: 400,
  },
} as const;

export type ApiErrorCode = keyof typeof API_ERRORS;

// ============================================================================
// ERROR RESPONSE HELPERS
// ============================================================================

/**
 * Create a safe error response
 * In production, hides internal error details
 */
export function errorResponse(
  error: ApiError | ApiErrorCode,
  internalError?: unknown
): NextResponse {
  const errorInfo = typeof error === 'string' ? API_ERRORS[error] : error;

  // Log the full error internally
  if (internalError) {
    console.error(`[API Error] ${errorInfo.code}:`, internalError);
  }

  return NextResponse.json(
    {
      success: false,
      error: errorInfo.code,
      message: errorInfo.message,
    },
    { status: errorInfo.status }
  );
}

/**
 * Create a custom error response with a specific message
 * Use sparingly - prefer predefined errors
 */
export function customErrorResponse(
  code: string,
  message: string,
  status: number,
  internalError?: unknown
): NextResponse {
  if (internalError) {
    console.error(`[API Error] ${code}:`, internalError);
  }

  return NextResponse.json(
    {
      success: false,
      error: code,
      message,
    },
    { status }
  );
}

/**
 * Handle unexpected errors safely
 * Always returns a generic error message to clients
 */
export function handleUnexpectedError(
  error: unknown,
  context?: string
): NextResponse {
  const errorMessage = error instanceof Error ? error.message : String(error);

  console.error(`[Unexpected Error]${context ? ` ${context}:` : ''}`, {
    message: errorMessage,
    stack: error instanceof Error ? error.stack : undefined,
  });

  return errorResponse('INTERNAL_ERROR');
}

/**
 * Wrap an async handler with error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<NextResponse>>(
  handler: T,
  context?: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (error) {
      return handleUnexpectedError(error, context);
    }
  }) as T;
}
