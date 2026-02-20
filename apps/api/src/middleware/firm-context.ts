import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

/**
 * Firm context middleware.
 *
 * Validates that the authenticated user belongs to the requested firm.
 * The firm ID is now primarily resolved from the user's DB record (set by auth middleware).
 * The X-Firm-ID header is only used as a hint and must match the user's actual firm.
 */
export const firmContextMiddleware = createMiddleware(async (c, next) => {
  // Auth middleware now sets firmId from the user's DB record
  const authFirmId = c.get('firmId');
  const headerFirmId = c.req.header('X-Firm-ID');

  // In development, use auth-resolved firm ID with dev fallbacks
  if (process.env.NODE_ENV === 'development') {
    let firmId = authFirmId || headerFirmId || process.env.DEFAULT_FIRM_ID || 'dev-firm-id';

    // Map placeholder IDs to the real DEFAULT_FIRM_ID
    if (firmId === 'dev-firm-id' && process.env.DEFAULT_FIRM_ID) {
      firmId = process.env.DEFAULT_FIRM_ID;
    }

    c.set('firmId', firmId);
    await next();
    return;
  }

  // Production: firm ID comes from the authenticated user's record
  if (!authFirmId) {
    return c.json({ error: 'Forbidden: No firm associated with this user' }, 403);
  }

  // If a header was provided, it must match the user's firm (no cross-tenant access)
  if (headerFirmId && headerFirmId !== authFirmId) {
    return c.json({ error: 'Forbidden: Firm ID mismatch' }, 403);
  }

  c.set('firmId', authFirmId);
  await next();
});
