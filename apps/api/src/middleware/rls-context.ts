import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { sql } from 'drizzle-orm';

/**
 * PostgreSQL Row-Level Security context middleware.
 *
 * Sets the PostgreSQL session variable `app.current_firm_id` from the
 * authenticated firm context. This enables RLS policies defined on tables
 * to enforce firm-level data isolation at the database layer, providing
 * defense-in-depth beyond application-level WHERE clauses.
 *
 * Must run AFTER auth middleware (which sets `firmId` on the Hono context).
 *
 * The `SET LOCAL` statement scopes the variable to the current transaction,
 * so it does not leak between requests sharing the same connection.
 */
export const rlsContextMiddleware = createMiddleware(async (c, next) => {
  const firmId = c.get('firmId');

  if (!firmId) {
    console.error('[Iron Gate RLS] firmId not set on context — auth middleware may not have run');
    return c.json({ error: 'Internal server error: missing firm context' }, 500);
  }

  try {
    // SET LOCAL scopes the variable to the current transaction.
    // We use a parameterized value via sql`` to prevent SQL injection.
    // The set_config function is the parameterizable equivalent of SET LOCAL.
    await db.execute(
      sql`SELECT set_config('app.current_firm_id', ${firmId}, true)`
    );
  } catch (error) {
    console.error('[Iron Gate RLS] Failed to set firm context on database session:', error);
    return c.json({ error: 'Internal server error: database context failure' }, 500);
  }

  await next();
});
