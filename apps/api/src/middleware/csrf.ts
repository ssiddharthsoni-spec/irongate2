import { createMiddleware } from 'hono/factory';
import { logger } from '../lib/logger';

/**
 * CSRF protection middleware.
 *
 * For state-changing requests (POST, PUT, DELETE, PATCH), validates that
 * the Origin header matches an allowed source. This prevents cross-site
 * form submissions from attacker-controlled domains.
 *
 * Bypasses:
 * - Safe methods (GET, HEAD, OPTIONS) — no state change
 * - API key requests (X-API-Key header) — programmatic access, not browser
 * - Chrome extension origins — trusted first-party client
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getAllowedOrigins(): string[] {
  const origins = [
    process.env.DASHBOARD_URL || 'https://irongate-dashboard.vercel.app',
  ];

  if (process.env.NODE_ENV === 'development') {
    origins.push('http://localhost:3000', 'http://localhost:3001');
  }

  return origins;
}

export const csrfProtectionMiddleware = createMiddleware(async (c, next) => {
  // Safe methods don't change state
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  // API key requests are programmatic — not vulnerable to CSRF
  if (c.req.header('X-API-Key')) {
    await next();
    return;
  }

  const origin = c.req.header('Origin');

  // Chrome extension origins are trusted
  if (origin?.startsWith('chrome-extension://')) {
    await next();
    return;
  }

  // No origin header on state-changing request from browser — suspicious
  if (!origin) {
    // Allow in development for tools like curl/Postman
    if (process.env.NODE_ENV === 'development') {
      await next();
      return;
    }

    logger.warn('CSRF: state-changing request with no Origin header', {
      method: c.req.method,
      path: c.req.path,
    });
    return c.json({ error: 'Forbidden: missing Origin header' }, 403);
  }

  // Validate origin against allowlist
  const allowed = getAllowedOrigins();
  if (!allowed.includes(origin)) {
    logger.warn('CSRF: request from disallowed origin', {
      origin,
      method: c.req.method,
      path: c.req.path,
    });
    return c.json({ error: 'Forbidden: origin not allowed' }, 403);
  }

  await next();
});
