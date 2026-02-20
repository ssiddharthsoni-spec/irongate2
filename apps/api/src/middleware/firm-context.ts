import { createMiddleware } from 'hono/factory';

/**
 * Extracts firm context from the request.
 * Sets firmId on the context for use in route handlers.
 */
export const firmContextMiddleware = createMiddleware(async (c, next) => {
  // Firm ID can come from:
  // 1. X-Firm-ID header (extension)
  // 2. JWT claims (dashboard)
  // 3. Query parameter (admin)
  let firmId =
    c.req.header('X-Firm-ID') ||
    c.req.query('firmId') ||
    process.env.DEFAULT_FIRM_ID ||
    'dev-firm-id';

  // In development, map placeholder IDs to the real DEFAULT_FIRM_ID
  if (firmId === 'dev-firm-id' && process.env.DEFAULT_FIRM_ID) {
    firmId = process.env.DEFAULT_FIRM_ID;
  }

  c.set('firmId', firmId);
  await next();
});
