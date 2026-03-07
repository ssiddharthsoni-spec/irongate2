/**
 * Department Policy Middleware
 *
 * Loads the authenticated user's department policies from the DB (cached
 * per department for 5 minutes) and enforces department-level restrictions:
 *
 * - allowed_sites:        JSONB array of allowed AI tool domains
 * - blocked_entity_types: JSONB array of entity types always blocked
 * - can_bypass:           boolean — whether users can override blocks
 * - max_sensitivity:      number  — maximum allowed sensitivity score
 */

import { createMiddleware } from 'hono/factory';
import { db } from '../db/client';
import { users, departments, departmentPolicies } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import type { AppEnv } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DepartmentPolicy {
  departmentId: string;
  departmentName: string;
  allowedSites: string[] | null;
  blockedEntityTypes: string[] | null;
  canBypass: boolean;
  maxSensitivity: number | null;
}

// ---------------------------------------------------------------------------
// Cache — keyed by departmentId, 5-minute TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  policy: DepartmentPolicy;
  expiresAt: number;
}

const policyCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

/** Invalidate cached policies for a department (e.g. after admin edits). */
export function invalidateDepartmentPolicyCache(departmentId: string): void {
  policyCache.delete(departmentId);
}

/** Flush the entire department policy cache. */
export function clearDepartmentPolicyCache(): void {
  policyCache.clear();
}

// ---------------------------------------------------------------------------
// Loader — exported so other routes can call it directly
// ---------------------------------------------------------------------------

/**
 * Load department policies for a given departmentId + firmId.
 * Returns null if the department doesn't exist or has no active policies.
 * Results are cached for 5 minutes per department.
 */
export async function loadDepartmentPolicy(
  departmentId: string,
  firmId: string,
): Promise<DepartmentPolicy | null> {
  // Check cache
  const cached = policyCache.get(departmentId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.policy;
  }

  try {
    // 1. Verify department exists and belongs to the firm
    const [dept] = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.firmId, firmId)))
      .limit(1);

    if (!dept) return null;

    // 2. Load all active policies for this department
    const rows = await db
      .select({
        policyType: departmentPolicies.policyType,
        policyValue: departmentPolicies.policyValue,
      })
      .from(departmentPolicies)
      .where(
        and(
          eq(departmentPolicies.departmentId, departmentId),
          eq(departmentPolicies.firmId, firmId),
          eq(departmentPolicies.isActive, true),
        ),
      );

    // 3. Merge policies into a single DepartmentPolicy object
    const policy: DepartmentPolicy = {
      departmentId,
      departmentName: dept.name,
      allowedSites: null,
      blockedEntityTypes: null,
      canBypass: true, // default: allow bypass unless policy says otherwise
      maxSensitivity: null,
    };

    for (const row of rows) {
      const val = row.policyValue as Record<string, unknown>;

      switch (row.policyType) {
        case 'allowed_sites':
          if (Array.isArray(val.sites)) {
            policy.allowedSites = val.sites as string[];
          }
          break;

        case 'blocked_entity_types':
          if (Array.isArray(val.entityTypes)) {
            policy.blockedEntityTypes = val.entityTypes as string[];
          }
          break;

        case 'can_bypass':
          if (typeof val.enabled === 'boolean') {
            policy.canBypass = val.enabled;
          }
          break;

        case 'max_sensitivity':
          if (typeof val.maxScore === 'number') {
            policy.maxSensitivity = val.maxScore;
          }
          break;
      }
    }

    // 4. Cache the result
    policyCache.set(departmentId, { policy, expiresAt: Date.now() + CACHE_TTL_MS });

    return policy;
  } catch {
    // DB errors should not block the request — fail open (no policy)
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolve departmentId — reads c.get('departmentId') or falls back to DB
// ---------------------------------------------------------------------------

async function resolveDepartmentId(
  c: { get: (key: string) => string | undefined },
  userId: string,
): Promise<string | null> {
  // Prefer context value (set by upstream middleware / JWT)
  const fromCtx = c.get('departmentId') as string | undefined;
  if (fromCtx) return fromCtx;

  // Fall back to the users table
  try {
    const [user] = await db
      .select({ departmentId: users.departmentId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user?.departmentId ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export interface DepartmentPolicyMiddlewareOptions {
  /** If true, requests from users without a department are rejected (default: false). */
  requireDepartment?: boolean;
}

/**
 * Factory that returns a Hono middleware.
 *
 * Usage:
 * ```ts
 * app.use('/v1/proxy/*', departmentPolicyMiddleware());
 * app.use('/v1/proxy/*', departmentPolicyMiddleware({ requireDepartment: true }));
 * ```
 *
 * The middleware loads the user's department policies and stores them on
 * the context at `c.get('departmentPolicy')`. Downstream handlers can
 * then read `c.get('departmentPolicy')` to access allowed_sites,
 * blocked_entity_types, can_bypass, and max_sensitivity.
 */
export function departmentPolicyMiddleware(opts: DepartmentPolicyMiddlewareOptions = {}) {
  const { requireDepartment = false } = opts;

  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.get('userId');
    const firmId = c.get('firmId');

    if (!userId || !firmId) {
      // Auth middleware hasn't run yet — skip policy loading
      await next();
      return;
    }

    const departmentId = await resolveDepartmentId(c, userId);

    if (!departmentId) {
      if (requireDepartment) {
        return c.json(
          { error: 'Department required', message: 'You must be assigned to a department to use this resource.' },
          403,
        );
      }
      // No department — proceed without policy restrictions
      await next();
      return;
    }

    const policy = await loadDepartmentPolicy(departmentId, firmId);

    if (policy) {
      c.set('departmentPolicy', policy);
    } else if (requireDepartment) {
      return c.json(
        { error: 'Department policy missing', message: 'Your department has no active policies configured.' },
        403,
      );
    }

    await next();
  });
}

// ---------------------------------------------------------------------------
// Enforcement helpers (can be used as standalone middleware or inline)
// ---------------------------------------------------------------------------

/**
 * Middleware that enforces the allowed_sites policy.
 * Expects the AI tool domain to be in the request body as `aiToolId` or
 * as a query parameter `tool`.
 */
export const enforceSitePolicy = createMiddleware<AppEnv>(async (c, next) => {
  const policy = c.get('departmentPolicy');

  if (policy?.allowedSites && policy.allowedSites.length > 0) {
    let toolId: string | undefined;

    // Try query param first
    toolId = c.req.query('tool');

    // Fall back to request body
    if (!toolId) {
      try {
        const body = await c.req.json();
        toolId = body?.aiToolId as string | undefined;
      } catch {
        // ignore parse errors
      }
    }

    if (toolId && !policy.allowedSites.some((site) => toolId!.includes(site))) {
      return c.json(
        {
          error: 'Department policy violation',
          message: `Your department (${policy.departmentName}) is not permitted to use this AI tool.`,
          allowedSites: policy.allowedSites,
        },
        403,
      );
    }
  }

  await next();
});

/**
 * Middleware that enforces blocked_entity_types and max_sensitivity.
 * Reads `entities` (array of { type }) and `sensitivityScore` from the
 * request body.
 */
export const enforceContentPolicy = createMiddleware<AppEnv>(async (c, next) => {
  const policy = c.get('departmentPolicy');
  if (!policy) {
    await next();
    return;
  }

  try {
    const body = await c.req.json();

    // Enforce blocked entity types
    if (policy.blockedEntityTypes && policy.blockedEntityTypes.length > 0 && Array.isArray(body?.entities)) {
      const detected = body.entities as Array<{ type: string }>;
      const blocked = detected.filter((e) => policy.blockedEntityTypes!.includes(e.type));
      if (blocked.length > 0) {
        const canBypass = policy.canBypass;
        return c.json(
          {
            error: 'Blocked entity types detected',
            message: `Your department (${policy.departmentName}) blocks the following entity types: ${blocked.map((b) => b.type).join(', ')}`,
            blockedEntities: blocked.map((b) => b.type),
            canBypass,
          },
          403,
        );
      }
    }

    // Enforce max sensitivity score
    if (policy.maxSensitivity !== null && typeof body?.sensitivityScore === 'number') {
      if (body.sensitivityScore > policy.maxSensitivity) {
        return c.json(
          {
            error: 'Sensitivity score exceeds department limit',
            message: `Your department (${policy.departmentName}) allows a maximum sensitivity score of ${policy.maxSensitivity}. This content scored ${body.sensitivityScore}.`,
            maxAllowed: policy.maxSensitivity,
            actual: body.sensitivityScore,
            canBypass: policy.canBypass,
          },
          403,
        );
      }
    }
  } catch {
    // Body parse failure — let downstream handle it
  }

  await next();
});
