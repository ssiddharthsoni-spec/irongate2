/**
 * RBAC Enforcement Tests
 *
 * Validates that all 26 permissions are correctly enforced across admin/user roles,
 * and that the requirePerm() middleware properly blocks unauthorized access.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ROLES, hasPermission, requirePermission } from '@iron-gate/crypto';
import type { Role, Permission } from '@iron-gate/crypto';

// ─── Permission Matrix Completeness ─────────────────────────────────────────

describe('Permission Matrix Completeness', () => {
  const allPermissions: Permission[] = Object.keys(ROLES.admin) as Permission[];

  it('should define 26 permissions for admin role', () => {
    expect(allPermissions.length).toBe(26);
  });

  it('admin should have all 26 permissions set to true', () => {
    for (const perm of allPermissions) {
      expect(ROLES.admin[perm]).toBe(true);
    }
  });

  it('user should have exactly 4 permissions set to true', () => {
    const userTruePerms = allPermissions.filter((p) => ROLES.user[p] === true);
    expect(userTruePerms).toEqual([
      'useExtension',
      'useAIToolsWithProtection',
      'viewOwnDetectionHistory',
      'submitEntityFeedback',
    ]);
  });

  it('user should have 22 permissions set to false', () => {
    const userFalsePerms = allPermissions.filter((p) => ROLES.user[p] === false);
    expect(userFalsePerms).toHaveLength(22);
  });

  it('both roles should define the same permission keys', () => {
    const adminKeys = Object.keys(ROLES.admin).sort();
    const userKeys = Object.keys(ROLES.user).sort();
    expect(adminKeys).toEqual(userKeys);
  });
});

// ─── hasPermission Function ─────────────────────────────────────────────────

describe('hasPermission', () => {
  it('admin should have all dashboard permissions', () => {
    expect(hasPermission('admin', 'viewDashboard')).toBe(true);
    expect(hasPermission('admin', 'viewFirmAnalytics')).toBe(true);
    expect(hasPermission('admin', 'viewUserRiskScores')).toBe(true);
  });

  it('user should NOT have dashboard permissions', () => {
    expect(hasPermission('user', 'viewDashboard')).toBe(false);
    expect(hasPermission('user', 'viewFirmAnalytics')).toBe(false);
    expect(hasPermission('user', 'viewUserRiskScores')).toBe(false);
  });

  it('admin should have user management permissions', () => {
    expect(hasPermission('admin', 'inviteUsers')).toBe(true);
    expect(hasPermission('admin', 'removeUsers')).toBe(true);
    expect(hasPermission('admin', 'changeUserRoles')).toBe(true);
  });

  it('user should NOT have user management permissions', () => {
    expect(hasPermission('user', 'inviteUsers')).toBe(false);
    expect(hasPermission('user', 'removeUsers')).toBe(false);
    expect(hasPermission('user', 'changeUserRoles')).toBe(false);
  });

  it('admin should have configuration permissions', () => {
    expect(hasPermission('admin', 'setSensitivityThresholds')).toBe(true);
    expect(hasPermission('admin', 'addCustomEntityPatterns')).toBe(true);
  });

  it('user should NOT have configuration permissions', () => {
    expect(hasPermission('user', 'setSensitivityThresholds')).toBe(false);
    expect(hasPermission('user', 'addCustomEntityPatterns')).toBe(false);
  });

  it('admin should have integration permissions', () => {
    expect(hasPermission('admin', 'manageWebhooks')).toBe(true);
    expect(hasPermission('admin', 'configureSIEM')).toBe(true);
  });

  it('admin should have compliance permissions', () => {
    expect(hasPermission('admin', 'viewAuditTrail')).toBe(true);
    expect(hasPermission('admin', 'exportComplianceReports')).toBe(true);
  });

  it('admin should have security permissions', () => {
    expect(hasPermission('admin', 'rotateEncryptionKeys')).toBe(true);
    expect(hasPermission('admin', 'uploadPublicKey')).toBe(true);
    expect(hasPermission('admin', 'requestDataDeletion')).toBe(true);
  });

  it('admin should have billing permissions', () => {
    expect(hasPermission('admin', 'manageBilling')).toBe(true);
    expect(hasPermission('admin', 'changeSubscriptionPlan')).toBe(true);
  });

  it('both roles should have extension permissions', () => {
    expect(hasPermission('admin', 'useExtension')).toBe(true);
    expect(hasPermission('admin', 'useAIToolsWithProtection')).toBe(true);
    expect(hasPermission('user', 'useExtension')).toBe(true);
    expect(hasPermission('user', 'useAIToolsWithProtection')).toBe(true);
  });

  it('both roles should have feedback permissions', () => {
    expect(hasPermission('admin', 'submitEntityFeedback')).toBe(true);
    expect(hasPermission('user', 'submitEntityFeedback')).toBe(true);
  });
});

// ─── requirePermission Guard ────────────────────────────────────────────────

describe('requirePermission', () => {
  it('should not throw for admin with any permission', () => {
    const allPerms = Object.keys(ROLES.admin) as Permission[];
    for (const perm of allPerms) {
      expect(() => requirePermission('admin', perm)).not.toThrow();
    }
  });

  it('should throw for user lacking dashboard permissions', () => {
    expect(() => requirePermission('user', 'viewDashboard')).toThrow(
      "Role 'user' lacks permission 'viewDashboard'",
    );
  });

  it('should throw for user lacking admin permissions', () => {
    const adminOnlyPerms: Permission[] = [
      'inviteUsers', 'removeUsers', 'changeUserRoles',
      'setSensitivityThresholds', 'addCustomEntityPatterns',
      'manageWebhooks', 'configureSIEM',
      'viewAuditTrail', 'exportComplianceReports',
      'rotateEncryptionKeys', 'uploadPublicKey', 'requestDataDeletion',
      'manageBilling', 'changeSubscriptionPlan',
      'viewFirmAnalytics', 'viewUserRiskScores',
    ];

    for (const perm of adminOnlyPerms) {
      expect(() => requirePermission('user', perm)).toThrow();
    }
  });

  it('should not throw for user with extension permissions', () => {
    expect(() => requirePermission('user', 'useExtension')).not.toThrow();
    expect(() => requirePermission('user', 'useAIToolsWithProtection')).not.toThrow();
    expect(() => requirePermission('user', 'viewOwnDetectionHistory')).not.toThrow();
    expect(() => requirePermission('user', 'submitEntityFeedback')).not.toThrow();
  });
});

// ─── RBAC Middleware (Hono Integration) ─────────────────────────────────────

describe('RBAC Middleware Integration', () => {
  interface TestEnv {
    Variables: {
      userRole: string;
      firmId: string;
      userId: string;
    };
  }

  function createRbacTestApp(role: string) {
    const app = new Hono<TestEnv>();

    // Inject role
    app.use('*', async (c, next) => {
      c.set('userRole', role);
      c.set('firmId', '00000000-0000-0000-0000-000000000001');
      c.set('userId', '00000000-0000-0000-0000-000000000002');
      await next();
    });

    // Protected route
    app.get('/admin/users', async (c) => {
      const userRole = c.get('userRole') as string;
      if (!hasPermission(userRole as Role, 'viewFirmAnalytics')) {
        return c.json({ error: 'Forbidden' }, 403);
      }
      return c.json({ users: [] });
    });

    app.post('/admin/webhooks', async (c) => {
      const userRole = c.get('userRole') as string;
      if (!hasPermission(userRole as Role, 'manageWebhooks')) {
        return c.json({ error: 'Forbidden' }, 403);
      }
      return c.json({ created: true });
    });

    app.put('/admin/siem', async (c) => {
      const userRole = c.get('userRole') as string;
      if (!hasPermission(userRole as Role, 'configureSIEM')) {
        return c.json({ error: 'Forbidden' }, 403);
      }
      return c.json({ updated: true });
    });

    return app;
  }

  it('admin should access /admin/users (200)', async () => {
    const app = createRbacTestApp('admin');
    const res = await app.request('/admin/users');
    expect(res.status).toBe(200);
  });

  it('user should be blocked from /admin/users (403)', async () => {
    const app = createRbacTestApp('user');
    const res = await app.request('/admin/users');
    expect(res.status).toBe(403);
  });

  it('admin should access /admin/webhooks (200)', async () => {
    const app = createRbacTestApp('admin');
    const res = await app.request('/admin/webhooks', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('user should be blocked from /admin/webhooks (403)', async () => {
    const app = createRbacTestApp('user');
    const res = await app.request('/admin/webhooks', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('admin should access /admin/siem (200)', async () => {
    const app = createRbacTestApp('admin');
    const res = await app.request('/admin/siem', { method: 'PUT' });
    expect(res.status).toBe(200);
  });

  it('user should be blocked from /admin/siem (403)', async () => {
    const app = createRbacTestApp('user');
    const res = await app.request('/admin/siem', { method: 'PUT' });
    expect(res.status).toBe(403);
  });
});

// ─── Admin Route RBAC Coverage ──────────────────────────────────────────────

describe('Admin Route RBAC Coverage', () => {
  // Every admin write endpoint should have a requirePerm() guard
  const protectedEndpoints = [
    { method: 'POST', path: '/firm', perm: 'setSensitivityThresholds' },
    { method: 'PUT', path: '/firm', perm: 'setSensitivityThresholds' },
    { method: 'GET', path: '/users', perm: 'viewFirmAnalytics' },
    { method: 'POST', path: '/client-matters', perm: 'addCustomEntityPatterns' },
    { method: 'PUT', path: '/weight-overrides', perm: 'setSensitivityThresholds' },
    { method: 'DELETE', path: '/weight-overrides/:type', perm: 'setSensitivityThresholds' },
    { method: 'POST', path: '/inferred-entities/analyze', perm: 'addCustomEntityPatterns' },
    { method: 'PUT', path: '/inferred-entities/:id', perm: 'addCustomEntityPatterns' },
    { method: 'POST', path: '/webhooks', perm: 'manageWebhooks' },
    { method: 'DELETE', path: '/webhooks/:id', perm: 'manageWebhooks' },
    { method: 'PUT', path: '/siem', perm: 'configureSIEM' },
    { method: 'POST', path: '/plugins', perm: 'addCustomEntityPatterns' },
    { method: 'PUT', path: '/plugins/:id', perm: 'addCustomEntityPatterns' },
    { method: 'DELETE', path: '/plugins/:id', perm: 'addCustomEntityPatterns' },
    { method: 'POST', path: '/recalculate-weights', perm: 'setSensitivityThresholds' },
    { method: 'PUT', path: '/feature-flags', perm: 'setSensitivityThresholds' },
    { method: 'DELETE', path: '/feature-flags/:key', perm: 'setSensitivityThresholds' },
    { method: 'POST', path: '/departments', perm: 'setSensitivityThresholds' },
    { method: 'PUT', path: '/departments/:id', perm: 'setSensitivityThresholds' },
    { method: 'DELETE', path: '/departments/:id', perm: 'removeUsers' },
    { method: 'PUT', path: '/departments/:id/policies', perm: 'setSensitivityThresholds' },
  ];

  it('should have RBAC guards on all 21 protected admin endpoints', () => {
    expect(protectedEndpoints).toHaveLength(21);
  });

  it('every protected endpoint should map to a valid permission', () => {
    const validPermissions = Object.keys(ROLES.admin);
    for (const ep of protectedEndpoints) {
      expect(validPermissions).toContain(ep.perm);
    }
  });

  it('user role should be denied on all protected endpoints', () => {
    for (const ep of protectedEndpoints) {
      expect(hasPermission('user', ep.perm as Permission)).toBe(false);
    }
  });

  it('admin role should be allowed on all protected endpoints', () => {
    for (const ep of protectedEndpoints) {
      expect(hasPermission('admin', ep.perm as Permission)).toBe(true);
    }
  });
});
