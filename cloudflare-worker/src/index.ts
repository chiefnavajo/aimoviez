// Cloudflare Worker — Edge Rate Limiting for aimoviez
// ============================================================================
// Intercepts /api/vote POST requests and rate limits at Cloudflare's edge
// network (200+ locations). Invalid requests never reach the origin server.
// Uses Cloudflare KV for distributed counters with TTL-based expiry.
// ============================================================================

export interface Env {
  RATE_LIMITS: KVNamespace;
}

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://aimoviez.app',
  'https://www.aimoviez.app',
];

// Rate limit configuration
const LIMITS: Record<string, { maxRequests: number; windowSeconds: number }> = {
  'POST:/api/vote': { maxRequests: 30, windowSeconds: 60 },
  'POST:/api/comments': { maxRequests: 15, windowSeconds: 60 },
  'POST:/api/upload/signed-url': { maxRequests: 5, windowSeconds: 60 },
};

function getRateLimitKey(method: string, pathname: string): string | null {
  const key = `${method}:${pathname}`;
  if (LIMITS[key]) return key;
  return null;
}

function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin') || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // Only rate limit configured endpoints
    const limitKey = getRateLimitKey(method, url.pathname);

    if (limitKey) {
      const config = LIMITS[limitKey];
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const kvKey = `rate:${limitKey}:${ip}`;
      const corsOrigin = getCorsOrigin(request);

      // Check current count
      let current = 0;
      try {
        const currentStr = await env.RATE_LIMITS.get(kvKey);
        current = currentStr ? (parseInt(currentStr, 10) || 0) : 0;
      } catch {
        // KV unavailable — fail open (allow request)
        current = 0;
      }

      if (current >= config.maxRequests) {
        return new Response(
          JSON.stringify({
            error: 'RATE_LIMITED',
            message: 'Too many requests. Please wait.',
            retryAfter: config.windowSeconds,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(config.windowSeconds),
              'X-RateLimit-Limit': String(config.maxRequests),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(config.windowSeconds),
              'Access-Control-Allow-Origin': corsOrigin,
            },
          }
        );
      }

      // Increment counter — ALWAYS pass expirationTtl to prevent permanent keys.
      // KV does NOT preserve TTL on put() — omitting it makes the key permanent.
      try {
        await env.RATE_LIMITS.put(kvKey, String(current + 1), {
          expirationTtl: config.windowSeconds,
        });
      } catch {
        // KV write failed — continue without rate limiting
      }

      // Proxy to origin with rate limit headers
      try {
        const response = await fetch(request);
        const newResponse = new Response(response.body, response);
        newResponse.headers.set('X-RateLimit-Limit', String(config.maxRequests));
        newResponse.headers.set('X-RateLimit-Remaining', String(Math.max(0, config.maxRequests - current - 1)));
        return newResponse;
      } catch {
        return new Response(
          JSON.stringify({ error: 'ORIGIN_UNREACHABLE', message: 'Service temporarily unavailable' }),
          { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin } }
        );
      }
    }

    // Non-rate-limited requests: pass through to origin
    try {
      return await fetch(request);
    } catch {
      return new Response(
        JSON.stringify({ error: 'ORIGIN_UNREACHABLE', message: 'Service temporarily unavailable' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
};
