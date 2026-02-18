/**
 * @jest-environment node
 */

// =============================================================================
// INPUT SANITIZATION TESTS
// Tests src/lib/sanitize.ts and src/lib/validations.ts
// =============================================================================

import {
  sanitizeText,
  sanitizeUsername,
  sanitizeComment,
  sanitizeSearchQuery,
  sanitizeFilename,
  sanitizeUrl,
  escapeHtml,
  sanitizeUuid,
  sanitizeInt,
  sanitizeEmail,
} from '@/lib/sanitize';

import {
  VoteRequestSchema,
  RegisterClipSchema,
  CreateCommentSchema,
  AIGenerateSchema,
  parseBody,
} from '@/lib/validations';

// =============================================================================
// 1. XSS IN USERNAMES (SCRIPT TAGS STRIPPED)
// =============================================================================

describe('Sanitization: XSS in usernames', () => {
  it('strips <script> tags from username input via sanitizeText', () => {
    const malicious = '<script>alert("xss")</script>admin';
    expect(sanitizeText(malicious)).toBe('alert("xss")admin');
  });

  it('strips <img onerror> from username via sanitizeText', () => {
    const malicious = '<img src=x onerror=alert(1)>user';
    expect(sanitizeText(malicious)).toBe('user');
  });

  it('sanitizeUsername removes all non-alphanumeric except _ and .', () => {
    const malicious = '<script>alert(1)</script>';
    expect(sanitizeUsername(malicious)).toBe('scriptalert1script');
  });

  it('sanitizeUsername strips special characters entirely', () => {
    expect(sanitizeUsername('user<>name')).toBe('username');
    expect(sanitizeUsername('admin; DROP TABLE users;--')).toBe('adminDROPTABLEusers');
  });

  it('sanitizeUsername limits length to 50 characters', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeUsername(long).length).toBe(50);
  });

  it('sanitizeUsername returns empty string for null/undefined', () => {
    expect(sanitizeUsername(null)).toBe('');
    expect(sanitizeUsername(undefined)).toBe('');
  });

  it('sanitizeComment strips script tags and event handlers', () => {
    const malicious = '<script>document.cookie</script>Hello';
    const result = sanitizeComment(malicious);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
    expect(result).toContain('Hello');
  });

  it('sanitizeComment strips onerror event handlers', () => {
    const malicious = 'Hello <img onerror=alert(1)> world';
    const result = sanitizeComment(malicious);
    expect(result).not.toContain('onerror');
  });

  it('sanitizeComment strips javascript: protocol', () => {
    const malicious = 'Click javascript:alert(1) here';
    const result = sanitizeComment(malicious);
    expect(result).not.toContain('javascript:');
  });

  it('sanitizeComment handles HTML entity encoding attacks', () => {
    // Attacker uses HTML entities to hide script tags
    const malicious = '&#60;script&#62;alert(1)&#60;/script&#62;';
    const result = sanitizeComment(malicious);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('&#60;script');
  });

  it('sanitizeComment handles double-encoding bypass attempts', () => {
    // Attacker uses &amp;lt; which decodes to &lt; which decodes to <
    const malicious = '&lt;script&gt;alert(1)&lt;/script&gt;';
    const result = sanitizeComment(malicious);
    expect(result).not.toContain('<script>');
  });

  it('escapeHtml escapes all dangerous characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeHtml("it's")).toBe("it&#x27;s");
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });
});

// =============================================================================
// 2. SQL INJECTION PATTERNS IN SEARCH PARAMS
// =============================================================================

describe('Sanitization: SQL injection in search queries', () => {
  it('strips single quotes from search input', () => {
    const malicious = "admin' OR '1'='1";
    const result = sanitizeSearchQuery(malicious);
    expect(result).not.toContain("'");
  });

  it('strips double quotes from search input', () => {
    const malicious = 'admin" OR "1"="1';
    const result = sanitizeSearchQuery(malicious);
    expect(result).not.toContain('"');
  });

  it('strips semicolons to prevent query chaining', () => {
    const malicious = 'test; DROP TABLE users;';
    const result = sanitizeSearchQuery(malicious);
    expect(result).not.toContain(';');
  });

  it('strips SQL comment patterns (--)', () => {
    const malicious = 'admin--';
    const result = sanitizeSearchQuery(malicious);
    expect(result).not.toContain('--');
  });

  it('strips backslashes', () => {
    const malicious = "admin\\' OR 1=1";
    const result = sanitizeSearchQuery(malicious);
    expect(result).not.toContain('\\');
  });

  it('strips angle brackets and parentheses', () => {
    const malicious = '<script>alert(1)</script>';
    const result = sanitizeSearchQuery(malicious);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
  });

  it('limits search query to 100 characters', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeSearchQuery(long).length).toBe(100);
  });

  it('returns empty string for null/undefined', () => {
    expect(sanitizeSearchQuery(null)).toBe('');
    expect(sanitizeSearchQuery(undefined)).toBe('');
  });

  it('allows normal alphanumeric search terms through', () => {
    expect(sanitizeSearchQuery('funny cat video')).toBe('funny cat video');
  });

  it('Zod UUID validation rejects SQL injection in clipId', () => {
    const result = parseBody(VoteRequestSchema, {
      clipId: "'; DROP TABLE votes;--",
    });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error).toContain('Invalid');
  });
});

// =============================================================================
// 3. PATH TRAVERSAL IN FILE UPLOAD PATHS
// =============================================================================

describe('Sanitization: path traversal in filenames', () => {
  it('rejects ../../../etc/passwd', () => {
    const result = sanitizeFilename('../../../etc/passwd');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
    expect(result).not.toContain('\\');
  });

  it('removes forward slashes from filenames', () => {
    const result = sanitizeFilename('/etc/passwd');
    expect(result).not.toContain('/');
  });

  it('removes backslashes from filenames', () => {
    const result = sanitizeFilename('..\\..\\windows\\system32\\config');
    expect(result).not.toContain('\\');
    expect(result).not.toContain('..');
  });

  it('strips leading dots to prevent hidden files (.env, .htaccess)', () => {
    expect(sanitizeFilename('.env')).not.toMatch(/^\./);
    expect(sanitizeFilename('.htaccess')).not.toMatch(/^\./);
    expect(sanitizeFilename('..hidden')).not.toMatch(/^\./);
  });

  it('replaces unsafe characters with underscores', () => {
    const result = sanitizeFilename('file name with spaces & special!chars.mp4');
    // Only a-zA-Z0-9._- are kept
    expect(result).not.toContain(' ');
    expect(result).not.toContain('&');
    expect(result).not.toContain('!');
  });

  it('limits filename to 255 characters', () => {
    const long = 'a'.repeat(300) + '.mp4';
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(255);
  });

  it('returns empty string for null/undefined and "unnamed" when content is fully stripped', () => {
    // null/undefined/empty string return '' due to the early return guard
    expect(sanitizeFilename(null)).toBe('');
    expect(sanitizeFilename(undefined)).toBe('');
    expect(sanitizeFilename('')).toBe('');
    // Input that has content but is fully stripped results in 'unnamed'
    expect(sanitizeFilename('...')).toBe('unnamed');
    expect(sanitizeFilename('///\\\\')).toBe('unnamed');
  });

  it('handles encoded path traversal attempts', () => {
    // Double-dot after removing slashes
    const result = sanitizeFilename('....//....//etc/passwd');
    expect(result).not.toContain('..');
  });

  it('sanitizeUrl rejects file:// protocol', () => {
    expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
  });

  it('sanitizeUrl rejects javascript: protocol', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('sanitizeUrl rejects data: URI', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('sanitizeUrl blocks localhost (SSRF)', () => {
    expect(sanitizeUrl('http://localhost/admin')).toBeNull();
    expect(sanitizeUrl('http://127.0.0.1/admin')).toBeNull();
  });

  it('sanitizeUrl blocks private IP ranges (SSRF)', () => {
    expect(sanitizeUrl('http://192.168.1.1/admin')).toBeNull();
    expect(sanitizeUrl('http://10.0.0.1/admin')).toBeNull();
    expect(sanitizeUrl('http://172.16.0.1/admin')).toBeNull();
  });

  it('sanitizeUrl blocks cloud metadata endpoint', () => {
    expect(sanitizeUrl('http://169.254.169.254/latest/meta-data/')).toBeNull();
  });

  it('sanitizeUrl blocks IPv6-mapped IPv4 addresses', () => {
    expect(sanitizeUrl('http://[::ffff:127.0.0.1]/')).toBeNull();
  });

  it('sanitizeUrl allows valid HTTPS URLs', () => {
    const result = sanitizeUrl('https://example.com/path?q=1');
    expect(result).toBe('https://example.com/path?q=1');
  });

  it('sanitizeUrl blocks URLs with embedded credentials', () => {
    expect(sanitizeUrl('https://user:pass@example.com')).toBeNull();
  });
});

// =============================================================================
// 4. OVERSIZED PAYLOADS (VALIDATION LENGTH CHECKS)
// =============================================================================

describe('Sanitization: oversized payloads and length validation', () => {
  it('Zod rejects comment text exceeding 500 characters', () => {
    const result = parseBody(CreateCommentSchema, {
      clipId: '550e8400-e29b-41d4-a716-446655440000',
      comment_text: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('Zod accepts comment text within 500 characters', () => {
    const result = parseBody(CreateCommentSchema, {
      clipId: '550e8400-e29b-41d4-a716-446655440000',
      comment_text: 'Hello world',
    });
    expect(result.success).toBe(true);
  });

  it('Zod rejects AI prompt exceeding 500 characters', () => {
    const result = parseBody(AIGenerateSchema, {
      prompt: 'x'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('Zod rejects AI prompt shorter than 10 characters', () => {
    const result = parseBody(AIGenerateSchema, {
      prompt: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('sanitizeComment truncates at 1000 characters', () => {
    const long = 'a'.repeat(2000);
    const result = sanitizeComment(long);
    expect(result.length).toBeLessThanOrEqual(1000);
  });

  it('sanitizeSearchQuery truncates at 100 characters', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeSearchQuery(long).length).toBeLessThanOrEqual(100);
  });

  it('RegisterClipSchema rejects title over 100 chars', () => {
    const result = parseBody(RegisterClipSchema, {
      videoUrl: 'https://cdn.aimoviez.app/clip.mp4',
      genre: 'comedy',
      title: 'x'.repeat(101),
      duration: 5,
    });
    expect(result.success).toBe(false);
  });

  it('RegisterClipSchema rejects invalid video URL domain', () => {
    const result = parseBody(RegisterClipSchema, {
      videoUrl: 'https://evil.com/malware.mp4',
      genre: 'comedy',
      title: 'My clip',
      duration: 5,
    });
    expect(result.success).toBe(false);
  });

  it('RegisterClipSchema rejects video duration over 8.5s', () => {
    const result = parseBody(RegisterClipSchema, {
      videoUrl: 'https://cdn.aimoviez.app/clip.mp4',
      genre: 'comedy',
      title: 'My clip',
      duration: 60,
    });
    expect(result.success).toBe(false);
  });

  it('sanitizeUuid rejects non-UUID strings', () => {
    expect(sanitizeUuid('not-a-uuid')).toBeNull();
    expect(sanitizeUuid("'; DROP TABLE users;--")).toBeNull();
    expect(sanitizeUuid('')).toBeNull();
  });

  it('sanitizeUuid accepts valid UUIDs', () => {
    expect(sanitizeUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
  });

  it('sanitizeInt clamps values to min/max range', () => {
    expect(sanitizeInt('999', 0, 100)).toBe(100);
    expect(sanitizeInt('-5', 0, 100)).toBe(0);
    expect(sanitizeInt('50', 0, 100)).toBe(50);
  });

  it('sanitizeInt rejects NaN input', () => {
    expect(sanitizeInt('abc')).toBeNull();
    expect(sanitizeInt('NaN')).toBeNull();
  });

  it('sanitizeEmail rejects oversized email (>254 chars)', () => {
    const long = 'a'.repeat(250) + '@example.com';
    expect(sanitizeEmail(long)).toBeNull();
  });

  it('sanitizeEmail rejects double-dot in email', () => {
    expect(sanitizeEmail('user..name@example.com')).toBeNull();
  });

  it('sanitizeEmail accepts valid email addresses', () => {
    expect(sanitizeEmail('user@example.com')).toBe('user@example.com');
    expect(sanitizeEmail('Admin@EXAMPLE.COM')).toBe('admin@example.com');
  });
});
