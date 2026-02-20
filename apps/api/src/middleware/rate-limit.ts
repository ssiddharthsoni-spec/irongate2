import { createMiddleware } from 'hono/factory';

/**
 * Simple in-memory rate limiter.
 * In production, use Redis for distributed rate limiting.
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 300; // 300 requests per minute

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
  const key = c.get('userId') || c.req.header('x-forwarded-for') || 'anonymous';
  const now = Date.now();

  let entry = requestCounts.get(key);

  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + WINDOW_MS };
    requestCounts.set(key, entry);
  }

  entry.count++;

  // Set rate limit headers
  c.header('X-RateLimit-Limit', String(MAX_REQUESTS));
  c.header('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - entry.count)));
  c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetTime / 1000)));

  if (entry.count > MAX_REQUESTS) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  await next();
});
