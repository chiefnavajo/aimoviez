// Tests for sanitization utilities
// These are critical for XSS prevention

import {
  sanitizeText,
  escapeHtml,
  sanitizeUsername,
  sanitizeUrl,
  sanitizeComment,
  sanitizeSearchQuery,
  sanitizeEmail,
  sanitizeInt,
  sanitizeUuid,
  sanitizeFilename,
} from '@/lib/sanitize';

describe('sanitizeText', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText('')).toBe('');
  });

  it('removes HTML tags', () => {
    expect(sanitizeText('<script>alert("xss")</script>')).toBe('alert("xss")');
    expect(sanitizeText('<b>bold</b>')).toBe('bold');
    expect(sanitizeText('<a href="evil.com">click</a>')).toBe('click');
    expect(sanitizeText('Hello <img src=x onerror=alert(1)> World')).toBe('Hello World');
  });

  it('removes control characters', () => {
    expect(sanitizeText('hello\x00world')).toBe('helloworld');
    expect(sanitizeText('test\x07bell')).toBe('testbell');
  });

  it('normalizes whitespace', () => {
    expect(sanitizeText('hello    world')).toBe('hello world');
    expect(sanitizeText('  trimmed  ')).toBe('trimmed');
    expect(sanitizeText('line1\n\n\nline2')).toBe('line1 line2');
  });

  it('handles nested/malformed HTML', () => {
    expect(sanitizeText('<<script>script>')).toBe('script>');
    expect(sanitizeText('<div><script>evil</script></div>')).toBe('evil');
  });
});

describe('escapeHtml', () => {
  it('returns empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('escapes HTML special characters', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#x27;');
    expect(escapeHtml('/')).toBe('&#x2F;');
    expect(escapeHtml('`')).toBe('&#x60;');
    expect(escapeHtml('=')).toBe('&#x3D;');
  });

  it('escapes full HTML tags', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
    );
  });

  it('preserves safe characters', () => {
    expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
  });
});

describe('sanitizeUsername', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeUsername(null)).toBe('');
    expect(sanitizeUsername(undefined)).toBe('');
  });

  it('allows alphanumeric, underscores, and dots', () => {
    expect(sanitizeUsername('user123')).toBe('user123');
    expect(sanitizeUsername('user_name')).toBe('user_name');
    expect(sanitizeUsername('user.name')).toBe('user.name');
  });

  it('removes special characters', () => {
    expect(sanitizeUsername('user@name')).toBe('username');
    expect(sanitizeUsername('user<script>')).toBe('userscript');
    expect(sanitizeUsername('user name')).toBe('username');
  });

  it('limits length to 50 characters', () => {
    const longName = 'a'.repeat(100);
    expect(sanitizeUsername(longName).length).toBe(50);
  });
});

describe('sanitizeUrl', () => {
  it('returns null for null/undefined/empty', () => {
    expect(sanitizeUrl(null)).toBeNull();
    expect(sanitizeUrl(undefined)).toBeNull();
    expect(sanitizeUrl('')).toBeNull();
  });

  it('allows http and https URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com/');
    expect(sanitizeUrl('http://example.com/path')).toBe('http://example.com/path');
  });

  it('rejects javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBeNull();
  });

  it('rejects data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects other protocols', () => {
    expect(sanitizeUrl('ftp://example.com')).toBeNull();
    expect(sanitizeUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects invalid URLs', () => {
    expect(sanitizeUrl('not a url')).toBeNull();
    expect(sanitizeUrl('://missing-protocol')).toBeNull();
  });
});

describe('sanitizeComment', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeComment(null)).toBe('');
    expect(sanitizeComment(undefined)).toBe('');
  });

  it('removes HTML tags', () => {
    expect(sanitizeComment('<script>evil</script>')).toBe('evil');
    expect(sanitizeComment('Hello <b>world</b>!')).toBe('Hello world!');
  });

  it('preserves newlines but limits consecutive ones', () => {
    expect(sanitizeComment('line1\nline2')).toBe('line1\nline2');
    expect(sanitizeComment('line1\n\n\n\n\nline2')).toBe('line1\n\nline2');
  });

  it('limits length to 1000 characters', () => {
    const longComment = 'a'.repeat(2000);
    expect(sanitizeComment(longComment).length).toBe(1000);
  });

  it('trims whitespace', () => {
    expect(sanitizeComment('  hello  ')).toBe('hello');
  });
});

describe('sanitizeSearchQuery', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeSearchQuery(null)).toBe('');
    expect(sanitizeSearchQuery(undefined)).toBe('');
  });

  it('removes SQL injection patterns', () => {
    expect(sanitizeSearchQuery("'; DROP TABLE users;--")).toBe('DROP TABLE users--');
    // Note: = is not removed, but quotes and semicolons are
    expect(sanitizeSearchQuery('1 OR 1=1')).toBe('1 OR 1=1');
    expect(sanitizeSearchQuery("SELECT * FROM users WHERE id='1'")).toBe('SELECT * FROM users WHERE id=1');
  });

  it('removes special characters', () => {
    expect(sanitizeSearchQuery('hello<script>')).toBe('helloscript');
    expect(sanitizeSearchQuery('test()')).toBe('test');
    expect(sanitizeSearchQuery('test{}')).toBe('test');
  });

  it('limits length to 100 characters', () => {
    const longQuery = 'a'.repeat(200);
    expect(sanitizeSearchQuery(longQuery).length).toBe(100);
  });
});

describe('sanitizeEmail', () => {
  it('returns null for null/undefined/empty', () => {
    expect(sanitizeEmail(null)).toBeNull();
    expect(sanitizeEmail(undefined)).toBeNull();
    expect(sanitizeEmail('')).toBeNull();
  });

  it('accepts valid emails', () => {
    expect(sanitizeEmail('user@example.com')).toBe('user@example.com');
    expect(sanitizeEmail('USER@EXAMPLE.COM')).toBe('user@example.com');
    expect(sanitizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('rejects invalid emails', () => {
    expect(sanitizeEmail('not-an-email')).toBeNull();
    expect(sanitizeEmail('missing@domain')).toBeNull();
    expect(sanitizeEmail('@example.com')).toBeNull();
    expect(sanitizeEmail('user@')).toBeNull();
  });

  it('rejects emails with double dots', () => {
    expect(sanitizeEmail('user..name@example.com')).toBeNull();
  });

  it('rejects emails over 254 characters', () => {
    const longEmail = 'a'.repeat(250) + '@example.com';
    expect(sanitizeEmail(longEmail)).toBeNull();
  });
});

describe('sanitizeInt', () => {
  it('returns null for null/undefined', () => {
    expect(sanitizeInt(null)).toBeNull();
    expect(sanitizeInt(undefined)).toBeNull();
  });

  it('parses string integers', () => {
    expect(sanitizeInt('42')).toBe(42);
    expect(sanitizeInt('0')).toBe(0);
    expect(sanitizeInt('100')).toBe(100);
  });

  it('returns the number for numeric input', () => {
    expect(sanitizeInt(42)).toBe(42);
    expect(sanitizeInt(0)).toBe(0);
  });

  it('floors decimal numbers', () => {
    expect(sanitizeInt(3.7)).toBe(3);
    expect(sanitizeInt('3.9')).toBe(3);
  });

  it('returns null for NaN', () => {
    expect(sanitizeInt('not a number')).toBeNull();
    expect(sanitizeInt(NaN)).toBeNull();
  });

  it('clamps to min/max', () => {
    expect(sanitizeInt(5, 10, 100)).toBe(10);
    expect(sanitizeInt(150, 10, 100)).toBe(100);
    expect(sanitizeInt(-5, 0, 100)).toBe(0);
  });

  it('handles Infinity', () => {
    expect(sanitizeInt(Infinity)).toBeNull();
    expect(sanitizeInt(-Infinity)).toBeNull();
  });
});

describe('sanitizeUuid', () => {
  it('returns null for null/undefined/empty', () => {
    expect(sanitizeUuid(null)).toBeNull();
    expect(sanitizeUuid(undefined)).toBeNull();
    expect(sanitizeUuid('')).toBeNull();
  });

  it('accepts valid UUIDs', () => {
    expect(sanitizeUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
    expect(sanitizeUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
  });

  it('trims whitespace', () => {
    expect(sanitizeUuid('  550e8400-e29b-41d4-a716-446655440000  ')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
  });

  it('rejects invalid UUIDs', () => {
    expect(sanitizeUuid('not-a-uuid')).toBeNull();
    expect(sanitizeUuid('550e8400-e29b-41d4-a716')).toBeNull();
    expect(sanitizeUuid('550e8400-e29b-41d4-a716-44665544000g')).toBeNull();
  });
});

describe('sanitizeFilename', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeFilename(null)).toBe('');
    expect(sanitizeFilename(undefined)).toBe('');
  });

  it('allows safe characters', () => {
    expect(sanitizeFilename('file.txt')).toBe('file.txt');
    expect(sanitizeFilename('my-file_123.pdf')).toBe('my-file_123.pdf');
  });

  it('removes path traversal attempts', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeFilename('..\\..\\windows\\system32')).toBe('windowssystem32');
  });

  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeFilename('file name.txt')).toBe('file_name.txt');
    expect(sanitizeFilename('file<script>.txt')).toBe('file_script_.txt');
  });

  it('limits length to 255 characters', () => {
    const longFilename = 'a'.repeat(300) + '.txt';
    expect(sanitizeFilename(longFilename).length).toBe(255);
  });
});
