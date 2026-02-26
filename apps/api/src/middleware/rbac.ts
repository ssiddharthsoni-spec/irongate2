import { createMiddleware } from 'hono/factory';
import { hasPermission, type Permission, type Role } from '@iron-gate/crypto';
import type { AppEnv } from '../types';

/**
 * RBAC middleware factory.
 * Returns a Hono middleware that checks whether the authenticated user's role
 * has the specified permission. Returns 403 if the check fails.
 *
 * Usage:
 *   app.use('/v1/admin/*', requirePerm('viewDashboard'));
 *   adminRoutes.post('/users', requirePerm('inviteUsers'), handler);
 */
export function requirePerm(permission: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const role = c.get('userRole') as Role | undefined;
    if (!role || !hasPermission(role, permission)) {
      return c.json(
        { error: `Forbidden: requires '${permission}' permission` },
        403,
      );
    }
    await next();
  });
}
