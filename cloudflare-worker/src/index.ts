// Cloudflare Worker — Edge Rate Limiting for aimoviez
// ============================================================================
// Intercepts /api/vote POST requests and rate limits at Cloudflare's edge
// network (200+ locations). Invalid requests never reach the origin server.
// Uses Cloudflare KV for distributed counters with 60-second expiry.
// ============================================================================

export interface Env {
  RATE_LIMITS: KVNamespace;
  ORIGIN_URL?: string; // e.g., "https://aimoviez.vercel.app"
}

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    // Only rate limit configured endpoints
    const limitKey = getRateLimitKey(method, url.pathname);

    if (limitKey) {
      const config = LIMITS[limitKey];
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const kvKey = `rate:${limitKey}:${ip}`;

      // Check current count
      const currentStr = await env.RATE_LIMITS.get(kvKey);
      const current = currentStr ? parseInt(currentStr, 10) : 0;

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
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }

      // M9 + L6: Only set TTL when creating new key (counter == 0).
      // For existing keys, increment without resetting the expiry window.
      // This prevents TTL reset on every request and ensures the window
      // expires correctly even under steady traffic.
      if (current === 0) {
        await env.RATE_LIMITS.put(kvKey, '1', {
          expirationTtl: config.windowSeconds,
        });
      } else {
        // KV doesn't support atomic increment, but by not resetting TTL
        // we at least fix the sliding window problem. The burst bypass
        // is inherent to KV's eventual consistency — acceptable trade-off.
        await env.RATE_LIMITS.put(kvKey, String(current + 1), {
          // Preserve existing TTL by not setting expirationTtl.
          // KV entries retain their original TTL when updated without it.
        });
      }

      // Add rate limit headers to the proxied response
      const response = await fetch(request);
      const newResponse = new Response(response.body, response);
      newResponse.headers.set('X-RateLimit-Limit', String(config.maxRequests));
      newResponse.headers.set('X-RateLimit-Remaining', String(Math.max(0, config.maxRequests - current - 1)));
      return newResponse;
    }

    // Non-rate-limited requests: pass through to origin
    return fetch(request);
  },
};
