import { createMiddleware } from 'hono/factory';

/**
 * Security headers middleware.
 *
 * Adds a comprehensive set of HTTP security headers to every response.
 * These headers defend against common web vulnerabilities including
 * clickjacking, MIME-type confusion, protocol downgrade, and data leakage.
 *
 * Header rationale:
 *   - HSTS: forces HTTPS for 1 year, including subdomains, with preload
 *   - X-Content-Type-Options: prevents MIME-type sniffing
 *   - X-Frame-Options: blocks iframe embedding (clickjacking)
 *   - X-XSS-Protection: disabled (0) — the modern recommendation is to
 *     rely on CSP rather than the legacy XSS auditor, which can itself
 *     introduce vulnerabilities
 *   - CSP: restricts resource loading to same-origin by default
 *   - Referrer-Policy: limits referrer leakage to origin on cross-origin
 *   - Permissions-Policy: disables access to sensitive device APIs
 */
export const securityHeadersMiddleware = createMiddleware(async (c, next) => {
  // Run the downstream handler first so we can set headers on the response
  await next();

  // Transport security — enforce HTTPS with a 1-year max-age
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Prevent MIME-type sniffing
  c.header('X-Content-Type-Options', 'nosniff');

  // Prevent embedding in iframes (clickjacking protection)
  c.header('X-Frame-Options', 'DENY');

  // Disable legacy XSS auditor — CSP is the modern defense
  c.header('X-XSS-Protection', '0');

  // Content Security Policy — restrict resource origins comprehensively.
  // The /docs page needs Swagger UI scripts/styles from unpkg; all other
  // routes are JSON-only and get a maximally restrictive policy.
  const path = new URL(c.req.url).pathname;
  if (path === '/docs') {
    c.header('Content-Security-Policy', [
      "default-src 'none'",
      "script-src https://unpkg.com 'unsafe-inline'",
      "style-src https://unpkg.com 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "object-src 'none'",
    ].join('; '));
  } else {
    c.header('Content-Security-Policy', [
      "default-src 'none'",
      "script-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "img-src 'none'",
      "media-src 'none'",
      "font-src 'none'",
      "connect-src 'self'",
      "style-src 'none'",
    ].join('; '));
  }

  // Limit referrer information sent on cross-origin navigation
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable access to sensitive browser APIs
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Expect-CT removed — deprecated by all browsers; CT is universally enforced.
});
