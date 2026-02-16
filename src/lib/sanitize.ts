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
 * Handles URL-encoded attack attempts and validates URL structure
 */
export function sanitizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  try {
    // First, decode the URL to catch encoded attacks
    // Decode multiple times to handle double/triple encoding
    let decoded = input;
    let prevDecoded = '';
    let iterations = 0;
    const maxIterations = 3; // Prevent infinite loops

    while (decoded !== prevDecoded && iterations < maxIterations) {
      prevDecoded = decoded;
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        // Invalid encoding, use as-is
        break;
      }
      iterations++;
    }

    // Check decoded string for dangerous patterns before parsing
    const decodedLower = decoded.toLowerCase();
    if (decodedLower.includes('javascript:') ||
        decodedLower.includes('data:') ||
        decodedLower.includes('vbscript:') ||
        decodedLower.includes('file:')) {
      return null;
    }

    // Parse the original URL (not decoded, to preserve proper structure)
    const url = new URL(input);

    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    // Block URLs with credentials (user:pass@host)
    if (url.username || url.password) {
      return null;
    }

    // Block localhost and internal IPs for SSRF protection
    const hostname = url.hostname.toLowerCase();
    // Check RFC 1918 172.16.0.0/12 range (172.16.* through 172.31.*)
    let isPrivate172 = false;
    if (hostname.startsWith('172.')) {
      const secondOctet = parseInt(hostname.split('.')[1], 10);
      isPrivate172 = secondOctet >= 16 && secondOctet <= 31;
    }

    // FIX: Check for IPv6-mapped IPv4 addresses (SSRF bypass vector)
    // Examples: ::ffff:127.0.0.1, ::ffff:10.0.0.1, ::ffff:169.254.169.254
    const isIPv6MappedIPv4 = hostname.startsWith('::ffff:') || hostname.startsWith('[::ffff:');

    // FIX: Explicitly block cloud metadata endpoint (AWS/GCP/Azure)
    // This is the primary target for SSRF attacks
    const isCloudMetadata = hostname === '169.254.169.254' || hostname === '[169.254.169.254]';

    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '[::1]' ||              // IPv6 loopback
        hostname === '::1' ||                // IPv6 loopback (no brackets)
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        isPrivate172 ||                      // Full 172.16.0.0/12 range
        hostname.startsWith('169.254.') ||   // Link-local
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        hostname === '0.0.0.0' ||
        hostname === '[::0]' ||
        isIPv6MappedIPv4 ||                  // FIX: Block IPv6-mapped IPv4
        isCloudMetadata) {                   // FIX: Explicitly block metadata endpoint
      return null;
    }

    // Block javascript: and data: in href (redundant but defense in depth)
    const hrefLower = url.href.toLowerCase();
    if (hrefLower.includes('javascript:') ||
        hrefLower.includes('data:') ||
        hrefLower.includes('vbscript:')) {
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

  const result = input
    // Decode HTML entities that could hide malicious content
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    // Remove HTML tags (including unclosed/malformed tags)
    .replace(/<[^>]*>?/g, '');

  // Prevent double-encoding bypass: loop until stable
  let previous = '';
  let current = result;
  while (current !== previous) {
    previous = current;
    current = current.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    current = current.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
    current = current.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    current = current.replace(/<[^>]*>/g, '');
  }

  return current
    // Strip javascript: and data: protocol handlers
    .replace(/(?:javascript|data|vbscript)\s*:/gi, '')
    // Remove event handler patterns (e.g. onerror=, onclick=)
    .replace(/\bon\w+\s*=/gi, '')
    // Remove control characters (keep newlines and tabs)
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
    // Remove SQL injection patterns (including SQL comments)
    .replace(/[;'"\\]/g, '')
    .replace(/--/g, '')
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

  let result = input
    // Remove path separators first
    .replace(/[/\\]/g, '')
    // Keep only safe characters
    .replace(/[^a-zA-Z0-9._-]/g, '_');

  // Remove all double-dot sequences (loop until none remain)
  while (result.includes('..')) {
    result = result.replace(/\.\./g, '');
  }

  return result
    // Strip leading dots (prevents .htaccess, .env, hidden files)
    .replace(/^\.+/, '')
    // Limit length
    .slice(0, 255)
    .trim() || 'unnamed';
}
