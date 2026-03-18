/**
 * SCIM 2.0 Endpoints for Okta / Azure AD auto-provisioning (RFC 7644)
 *
 * Authentication: Dedicated SCIM bearer token stored in firms.config.scimToken.
 * Mounted at /scim so full paths are /scim/v2/Users, /scim/v2/Groups, etc.
 */
import { Hono } from 'hono';
import { db } from '../db/client';
import { firms, users, departments } from '../db/schema';
import { eq, and, ilike, sql, inArray } from 'drizzle-orm';
import { logger } from '../lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScimEnv = {
  Variables: {
    scimFirmId: string;
  };
};

interface ScimUser {
  schemas: string[];
  id: string;
  userName: string;
  displayName: string;
  active: boolean;
  emails: { value: string; primary: boolean; type: string }[];
  groups: { value: string; display: string }[];
  meta: {
    resourceType: string;
    created: string;
    lastModified: string;
  };
}

interface ScimGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members: { value: string; display: string }[];
  meta: {
    resourceType: string;
    created: string;
    lastModified: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

function scimError(detail: string, status: number) {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    detail,
    status,
  };
}

function toScimUser(
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: string;
    departmentId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  departmentName?: string | null,
): ScimUser {
  const groups: ScimUser['groups'] = [];
  if (user.departmentId && departmentName) {
    groups.push({ value: user.departmentId, display: departmentName });
  }
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: user.id,
    userName: user.email,
    displayName: user.displayName || user.email,
    active: user.role !== 'deactivated',
    emails: [{ value: user.email, primary: true, type: 'work' }],
    groups,
    meta: {
      resourceType: 'User',
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
    },
  };
}

function toScimGroup(
  dept: {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  },
  members: { id: string; email: string; displayName: string | null }[],
): ScimGroup {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: dept.id,
    displayName: dept.name,
    members: members.map((m) => ({
      value: m.id,
      display: m.displayName || m.email,
    })),
    meta: {
      resourceType: 'Group',
      created: dept.createdAt.toISOString(),
      lastModified: dept.updatedAt.toISOString(),
    },
  };
}

function scimListResponse(
  resources: unknown[],
  totalResults: number,
  startIndex: number,
) {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    itemsPerPage: resources.length,
    startIndex,
    Resources: resources,
  };
}

/**
 * Parse a simple SCIM filter like: userName eq "user@example.com"
 * Returns { attribute, value } or null if unparseable.
 */
function parseSimpleFilter(filter: string | undefined) {
  if (!filter) return null;
  const match = filter.match(/^(\w+)\s+eq\s+"([^"]+)"$/i);
  if (!match) return null;
  return { attribute: match[1], value: match[2] };
}

// ---------------------------------------------------------------------------
// SCIM Bearer Token Middleware
// ---------------------------------------------------------------------------

async function scimAuth(c: any, next: () => Promise<void>) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(scimError('Missing or invalid Authorization header', 401), 401);
  }

  const token = authHeader.slice(7);
  if (!token) {
    return c.json(scimError('Empty bearer token', 401), 401);
  }

  // Look up the firm that owns this SCIM token.
  // The token is stored in firms.config -> scimToken.
  // We query all firms and check config.scimToken (small table, typically <100 rows).
  const allFirms = await db.select({ id: firms.id, config: firms.config }).from(firms);

  let firmId: string | null = null;
  for (const firm of allFirms) {
    const config = (firm.config ?? {}) as Record<string, any>;
    if (config.scimToken && typeof config.scimToken === 'string') {
      // Constant-time comparison to prevent timing attacks
      const expected = Buffer.from(config.scimToken, 'utf-8');
      const provided = Buffer.from(token, 'utf-8');
      if (
        expected.length === provided.length &&
        require('crypto').timingSafeEqual(expected, provided)
      ) {
        firmId = firm.id;
        break;
      }
    }
  }

  if (!firmId) {
    return c.json(scimError('Invalid SCIM bearer token', 401), 401);
  }

  c.set('scimFirmId', firmId);
  await next();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const scimRoutes = new Hono<ScimEnv>();

// Apply SCIM auth to all routes
scimRoutes.use('*', scimAuth);

// Set SCIM content type on all responses
scimRoutes.use('*', async (c, next) => {
  await next();
  c.header('Content-Type', 'application/scim+json');
});

// ==========================================================================
// USERS
// ==========================================================================

// GET /v2/Users — List users (paginated, filterable)
scimRoutes.get('/v2/Users', async (c) => {
  const firmId = c.get('scimFirmId');
  const startIndex = Math.max(1, parseInt(c.req.query('startIndex') || '1', 10));
  const count = Math.min(200, Math.max(1, parseInt(c.req.query('count') || '100', 10)));
  const filter = c.req.query('filter');

  const parsed = parseSimpleFilter(filter);

  // Build conditions
  const conditions = [eq(users.firmId, firmId)];
  if (parsed && parsed.attribute === 'userName') {
    conditions.push(eq(users.email, parsed.value));
  }

  // Total count
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .where(and(...conditions));

  // Fetch page (startIndex is 1-based in SCIM)
  const offset = startIndex - 1;
  const rows = await db
    .select()
    .from(users)
    .where(and(...conditions))
    .limit(count)
    .offset(offset);

  // Fetch department names for users that have one
  const deptIds = [...new Set(rows.map((r) => r.departmentId).filter(Boolean))] as string[];
  const deptMap = new Map<string, string>();
  if (deptIds.length > 0) {
    const depts = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(inArray(departments.id, deptIds));
    for (const d of depts) {
      deptMap.set(d.id, d.name);
    }
  }

  const resources = rows.map((u) =>
    toScimUser(u, deptMap.get(u.departmentId ?? '')),
  );

  return c.json(scimListResponse(resources, total, startIndex));
});

// GET /v2/Users/:id — Get single user
scimRoutes.get('/v2/Users/:id', async (c) => {
  const firmId = c.get('scimFirmId');
  const userId = c.req.param('id');

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.firmId, firmId)))
    .limit(1);

  if (!user) {
    return c.json(scimError('User not found', 404), 404);
  }

  let deptName: string | null = null;
  if (user.departmentId) {
    const [dept] = await db
      .select({ name: departments.name })
      .from(departments)
      .where(eq(departments.id, user.departmentId))
      .limit(1);
    deptName = dept?.name ?? null;
  }

  return c.json(toScimUser(user, deptName));
});

// POST /v2/Users — Create (provision) user
scimRoutes.post('/v2/Users', async (c) => {
  const firmId = c.get('scimFirmId');
  const body = await c.req.json();

  const email = body.userName;
  const displayName =
    body.displayName ||
    (body.name
      ? `${body.name.givenName || ''} ${body.name.familyName || ''}`.trim()
      : null) ||
    email;

  if (!email || typeof email !== 'string') {
    return c.json(scimError('userName is required', 400), 400);
  }

  // Check for existing user with same email in this firm
  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.email, email), eq(users.firmId, firmId)))
    .limit(1);

  if (existing) {
    // If user was deactivated, reactivate them
    if (existing.role === 'deactivated') {
      await db
        .update(users)
        .set({
          role: 'user',
          displayName,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));

      const [reactivated] = await db
        .select()
        .from(users)
        .where(eq(users.id, existing.id))
        .limit(1);

      return c.json(toScimUser(reactivated, null), 200);
    }

    return c.json(scimError('User already exists', 409), 409);
  }

  // Create new user
  const [created] = await db
    .insert(users)
    .values({
      firmId,
      email,
      displayName,
      role: body.active === false ? 'deactivated' : 'user',
    })
    .returning();

  logger.info('SCIM user provisioned', { firmId, userId: created.id, emailDomain: email.split('@')[1] });
  return c.json(toScimUser(created, null), 201);
});

// PUT /v2/Users/:id — Full replace
scimRoutes.put('/v2/Users/:id', async (c) => {
  const firmId = c.get('scimFirmId');
  const userId = c.req.param('id');
  const body = await c.req.json();

  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.firmId, firmId)))
    .limit(1);

  if (!existing) {
    return c.json(scimError('User not found', 404), 404);
  }

  const email = body.userName || existing.email;
  const displayName =
    body.displayName ||
    (body.name
      ? `${body.name.givenName || ''} ${body.name.familyName || ''}`.trim()
      : null) ||
    existing.displayName;

  const active = body.active !== false;

  await db
    .update(users)
    .set({
      email,
      displayName,
      role: active ? (existing.role === 'deactivated' ? 'user' : existing.role) : 'deactivated',
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const [updated] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  logger.info('SCIM user updated (PUT)', { firmId, userId, active });
  return c.json(toScimUser(updated, null));
});

// PATCH /v2/Users/:id — Partial update (SCIM PatchOp)
scimRoutes.patch('/v2/Users/:id', async (c) => {
  const firmId = c.get('scimFirmId');
  const userId = c.req.param('id');
  const body = await c.req.json();

  // Validate SCIM PatchOp schema
  const schemas: string[] = body.schemas || [];
  if (!schemas.includes(SCIM_PATCH_SCHEMA)) {
    return c.json(
      scimError(`Request must include schema ${SCIM_PATCH_SCHEMA}`, 400),
      400,
    );
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.firmId, firmId)))
    .limit(1);

  if (!existing) {
    return c.json(scimError('User not found', 404), 404);
  }

  const updates: Record<string, any> = { updatedAt: new Date() };

  const operations: { op: string; path?: string; value?: any }[] =
    body.Operations || body.operations || [];

  for (const op of operations) {
    const opType = (op.op || '').toLowerCase();
    if (opType !== 'replace') {
      // Only "replace" is required for Okta/Azure AD core flows
      continue;
    }

    if (op.path === 'active' || op.path === 'urn:ietf:params:scim:schemas:core:2.0:User:active') {
      const active = op.value === true || op.value === 'true';
      updates.role = active
        ? existing.role === 'deactivated'
          ? 'user'
          : existing.role
        : 'deactivated';
    } else if (op.path === 'displayName' || op.path === 'urn:ietf:params:scim:schemas:core:2.0:User:displayName') {
      if (typeof op.value === 'string') {
        updates.displayName = op.value;
      }
    } else if (op.path === 'userName' || op.path === 'urn:ietf:params:scim:schemas:core:2.0:User:userName') {
      if (typeof op.value === 'string') {
        updates.email = op.value;
      }
    } else if (!op.path && typeof op.value === 'object' && op.value !== null) {
      // Okta sometimes sends replace without path, with value as object
      if ('active' in op.value) {
        const active = op.value.active === true || op.value.active === 'true';
        updates.role = active
          ? existing.role === 'deactivated'
            ? 'user'
            : existing.role
          : 'deactivated';
      }
      if ('displayName' in op.value && typeof op.value.displayName === 'string') {
        updates.displayName = op.value.displayName;
      }
    }
  }

  await db.update(users).set(updates).where(eq(users.id, userId));

  const [updated] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  logger.info('SCIM user patched', { firmId, userId, operations: operations.length });
  return c.json(toScimUser(updated, null));
});

// DELETE /v2/Users/:id — Deprovision user
scimRoutes.delete('/v2/Users/:id', async (c) => {
  const firmId = c.get('scimFirmId');
  const userId = c.req.param('id');

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.firmId, firmId)))
    .limit(1);

  if (!existing) {
    return c.json(scimError('User not found', 404), 404);
  }

  // Soft-delete: set role to 'deactivated' rather than hard-deleting
  // to preserve audit trail integrity (events reference user IDs).
  await db
    .update(users)
    .set({ role: 'deactivated', updatedAt: new Date() })
    .where(eq(users.id, userId));

  logger.info('SCIM user deprovisioned', { firmId, userId });
  return c.body(null, 204);
});

// ==========================================================================
// GROUPS (mapped to departments)
// ==========================================================================

// GET /v2/Groups — List groups
scimRoutes.get('/v2/Groups', async (c) => {
  const firmId = c.get('scimFirmId');
  const startIndex = Math.max(1, parseInt(c.req.query('startIndex') || '1', 10));
  const count = Math.min(200, Math.max(1, parseInt(c.req.query('count') || '100', 10)));
  const filter = c.req.query('filter');

  const parsed = parseSimpleFilter(filter);

  const conditions = [eq(departments.firmId, firmId)];
  if (parsed && parsed.attribute === 'displayName') {
    conditions.push(eq(departments.name, parsed.value));
  }

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(departments)
    .where(and(...conditions));

  const offset = startIndex - 1;
  const depts = await db
    .select()
    .from(departments)
    .where(and(...conditions))
    .limit(count)
    .offset(offset);

  // Fetch members for each department
  const resources: ScimGroup[] = [];
  for (const dept of depts) {
    const members = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.departmentId, dept.id), eq(users.firmId, firmId)));

    resources.push(toScimGroup(dept, members));
  }

  return c.json(scimListResponse(resources, total, startIndex));
});

// GET /v2/Groups/:id — Get single group
scimRoutes.get('/v2/Groups/:id', async (c) => {
  const firmId = c.get('scimFirmId');
  const groupId = c.req.param('id');

  const [dept] = await db
    .select()
    .from(departments)
    .where(and(eq(departments.id, groupId), eq(departments.firmId, firmId)))
    .limit(1);

  if (!dept) {
    return c.json(scimError('Group not found', 404), 404);
  }

  const members = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.departmentId, dept.id), eq(users.firmId, firmId)));

  return c.json(toScimGroup(dept, members));
});

// POST /v2/Groups — Create group (department)
scimRoutes.post('/v2/Groups', async (c) => {
  const firmId = c.get('scimFirmId');
  const body = await c.req.json();

  const displayName = body.displayName;
  if (!displayName || typeof displayName !== 'string') {
    return c.json(scimError('displayName is required', 400), 400);
  }

  // Check for existing department with same name
  const [existing] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.name, displayName), eq(departments.firmId, firmId)))
    .limit(1);

  if (existing) {
    return c.json(scimError('Group already exists', 409), 409);
  }

  const [created] = await db
    .insert(departments)
    .values({
      firmId,
      name: displayName,
      description: body.externalId || null,
    })
    .returning();

  // If members are included in the creation request, assign them
  const memberOps: { value: string }[] = body.members || [];
  if (memberOps.length > 0) {
    const memberIds = memberOps.map((m) => m.value);
    for (const memberId of memberIds) {
      await db
        .update(users)
        .set({ departmentId: created.id, updatedAt: new Date() })
        .where(and(eq(users.id, memberId), eq(users.firmId, firmId)));
    }
  }

  // Re-fetch members
  const members = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.departmentId, created.id), eq(users.firmId, firmId)));

  logger.info('SCIM group created', { firmId, groupId: created.id, displayName });
  return c.json(toScimGroup(created, members), 201);
});

// PUT /v2/Groups/:id — Replace group (update members)
scimRoutes.put('/v2/Groups/:id', async (c) => {
  const firmId = c.get('scimFirmId');
  const groupId = c.req.param('id');
  const body = await c.req.json();

  const [dept] = await db
    .select()
    .from(departments)
    .where(and(eq(departments.id, groupId), eq(departments.firmId, firmId)))
    .limit(1);

  if (!dept) {
    return c.json(scimError('Group not found', 404), 404);
  }

  // Update group name if provided
  const displayName = body.displayName || dept.name;
  await db
    .update(departments)
    .set({ name: displayName, updatedAt: new Date() })
    .where(eq(departments.id, groupId));

  // Replace membership: remove all current members, then assign new ones
  // 1. Clear current members
  await db
    .update(users)
    .set({ departmentId: null, updatedAt: new Date() })
    .where(and(eq(users.departmentId, groupId), eq(users.firmId, firmId)));

  // 2. Assign new members
  const memberOps: { value: string }[] = body.members || [];
  for (const member of memberOps) {
    await db
      .update(users)
      .set({ departmentId: groupId, updatedAt: new Date() })
      .where(and(eq(users.id, member.value), eq(users.firmId, firmId)));
  }

  // Re-fetch members
  const members = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.departmentId, groupId), eq(users.firmId, firmId)));

  logger.info('SCIM group updated (PUT)', { firmId, groupId, memberCount: members.length });

  const [updatedDept] = await db
    .select()
    .from(departments)
    .where(eq(departments.id, groupId))
    .limit(1);

  return c.json(toScimGroup(updatedDept, members));
});

// PATCH /v2/Groups/:id — Partial update (member add/remove)
scimRoutes.patch('/v2/Groups/:id', async (c) => {
  const firmId = c.get('scimFirmId');
  const groupId = c.req.param('id');
  const body = await c.req.json();

  const [dept] = await db
    .select()
    .from(departments)
    .where(and(eq(departments.id, groupId), eq(departments.firmId, firmId)))
    .limit(1);

  if (!dept) {
    return c.json(scimError('Group not found', 404), 404);
  }

  const operations: { op: string; path?: string; value?: any }[] =
    body.Operations || body.operations || [];

  for (const op of operations) {
    const opType = (op.op || '').toLowerCase();

    if (opType === 'replace' && op.path === 'displayName') {
      await db
        .update(departments)
        .set({ name: op.value, updatedAt: new Date() })
        .where(eq(departments.id, groupId));
    } else if (opType === 'add' && op.path === 'members') {
      const newMembers: { value: string }[] = Array.isArray(op.value) ? op.value : [op.value];
      for (const member of newMembers) {
        await db
          .update(users)
          .set({ departmentId: groupId, updatedAt: new Date() })
          .where(and(eq(users.id, member.value), eq(users.firmId, firmId)));
      }
    } else if (opType === 'remove' && op.path?.startsWith('members')) {
      // SCIM sends: path = 'members[value eq "userId"]'
      const memberMatch = op.path.match(/members\[value eq "([^"]+)"\]/);
      if (memberMatch) {
        await db
          .update(users)
          .set({ departmentId: null, updatedAt: new Date() })
          .where(and(eq(users.id, memberMatch[1]), eq(users.firmId, firmId)));
      }
    }
  }

  // Re-fetch
  const [updatedDept] = await db
    .select()
    .from(departments)
    .where(eq(departments.id, groupId))
    .limit(1);

  const members = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.departmentId, groupId), eq(users.firmId, firmId)));

  logger.info('SCIM group patched', { firmId, groupId, operations: operations.length });
  return c.json(toScimGroup(updatedDept, members));
});

// DELETE /v2/Groups/:id — Delete group (department)
scimRoutes.delete('/v2/Groups/:id', async (c) => {
  const firmId = c.get('scimFirmId');
  const groupId = c.req.param('id');

  const [dept] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, groupId), eq(departments.firmId, firmId)))
    .limit(1);

  if (!dept) {
    return c.json(scimError('Group not found', 404), 404);
  }

  // Unassign all users from this department first
  await db
    .update(users)
    .set({ departmentId: null, updatedAt: new Date() })
    .where(and(eq(users.departmentId, groupId), eq(users.firmId, firmId)));

  // Delete the department
  await db.delete(departments).where(eq(departments.id, groupId));

  logger.info('SCIM group deleted', { firmId, groupId });
  return c.body(null, 204);
});

// ==========================================================================
// ServiceProviderConfig / Schemas / ResourceTypes (discovery endpoints)
// ==========================================================================

scimRoutes.get('/v2/ServiceProviderConfig', async (c) => {
  return c.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://docs.irongate.dev/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication scheme using the OAuth Bearer Token standard',
        specUri: 'https://www.rfc-editor.org/info/rfc6750',
        primary: true,
      },
    ],
  });
});

scimRoutes.get('/v2/ResourceTypes', async (c) => {
  return c.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 2,
    itemsPerPage: 2,
    startIndex: 1,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/scim/v2/Users',
        schema: SCIM_USER_SCHEMA,
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'Group',
        name: 'Group',
        endpoint: '/scim/v2/Groups',
        schema: SCIM_GROUP_SCHEMA,
      },
    ],
  });
});

scimRoutes.get('/v2/Schemas', async (c) => {
  return c.json({
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: 2,
    itemsPerPage: 2,
    startIndex: 1,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
        id: SCIM_USER_SCHEMA,
        name: 'User',
        description: 'User Account',
        attributes: [
          { name: 'userName', type: 'string', required: true, uniqueness: 'server' },
          { name: 'displayName', type: 'string', required: false },
          { name: 'active', type: 'boolean', required: false },
          { name: 'emails', type: 'complex', multiValued: true, required: false },
        ],
      },
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
        id: SCIM_GROUP_SCHEMA,
        name: 'Group',
        description: 'Group (Department)',
        attributes: [
          { name: 'displayName', type: 'string', required: true },
          { name: 'members', type: 'complex', multiValued: true, required: false },
        ],
      },
    ],
  });
});
