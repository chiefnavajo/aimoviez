// ============================================================================
// INPUT SANITIZATION
// Prevents XSS and other injection attacks
// ============================================================================

/**
 * Sanitize HTML content - removes all HTML tags
 * Use for plain text fields like usernames, titles, comments
 */
export function sanitizeText(input: string | null | undefined): string {
  if (!input) return '';

  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove control characters (except newlines and tabs)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escape HTML special characters for safe display
 * Use when you need to preserve the original text but display it safely
 */
export function escapeHtml(input: string | null | undefined): string {
  if (!input) return '';

  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  };

  return input.replace(/[&<>"'`=/]/g, (char) => escapeMap[char] || char);
}

/**
 * Sanitize username - alphanumeric, underscores, dots only
 */
export function sanitizeUsername(input: string | null | undefined): string {
  if (!input) return '';

  return input
    // Remove anything that's not alphanumeric, underscore, or dot
    .replace(/[^a-zA-Z0-9_.]/g, '')
    // Limit length
    .slice(0, 50)
    .trim();
}

/**
 * Sanitize URL - only allow http/https URLs
 */
export function sanitizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  try {
    const url = new URL(input);

    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    // Block javascript: and data: URLs that might have bypassed
    if (url.href.toLowerCase().includes('javascript:') ||
        url.href.toLowerCase().includes('data:')) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

/**
 * Sanitize comment text - allows newlines but removes HTML
 */
export function sanitizeComment(input: string | null | undefined): string {
  if (!input) return '';

  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove control characters (keep newlines and tabs)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Limit consecutive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Limit length
    .slice(0, 1000)
    .trim();
}

/**
 * Sanitize search query - prevents SQL injection patterns
 */
export function sanitizeSearchQuery(input: string | null | undefined): string {
  if (!input) return '';

  return input
    // Remove SQL injection patterns
    .replace(/[;'"\\]/g, '')
    // Remove special characters that could be used for injection
    .replace(/[<>(){}[\]]/g, '')
    // Limit length
    .slice(0, 100)
    .trim();
}

/**
 * Validate and sanitize email
 */
export function sanitizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmed = input.toLowerCase().trim();

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    return null;
  }

  // Additional security checks
  if (trimmed.length > 254) return null;
  if (trimmed.includes('..')) return null;

  return trimmed;
}

/**
 * Sanitize integer - ensures valid positive integer
 */
export function sanitizeInt(
  input: string | number | null | undefined,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): number | null {
  if (input === null || input === undefined) return null;

  const num = typeof input === 'string' ? parseInt(input, 10) : input;

  if (isNaN(num) || !isFinite(num)) return null;
  if (num < min) return min;
  if (num > max) return max;

  return Math.floor(num);
}

/**
 * Sanitize UUID
 */
export function sanitizeUuid(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmed = input.toLowerCase().trim();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  return uuidRegex.test(trimmed) ? trimmed : null;
}

/**
 * Sanitize filename - safe for storage
 */
export function sanitizeFilename(input: string | null | undefined): string {
  if (!input) return '';

  return input
    // Remove path traversal attempts
    .replace(/\.\./g, '')
    .replace(/[/\\]/g, '')
    // Keep only safe characters
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    // Limit length
    .slice(0, 255)
    .trim();
}
