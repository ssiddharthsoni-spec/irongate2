import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { firms, users, clientMatters, weightOverrides } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { AppEnv } from '../types';

export const adminRoutes = new Hono<AppEnv>();

// GET /v1/admin/firm — Get firm configuration
adminRoutes.get('/firm', async (c) => {
  const firmId = c.get('firmId');

  const [firm] = await db.select().from(firms).where(eq(firms.id, firmId)).limit(1);
  if (!firm) {
    return c.json({ error: 'Firm not found' }, 404);
  }

  return c.json(firm);
});

// PUT /v1/admin/firm — Update firm configuration
adminRoutes.put('/firm', async (c) => {
  const firmId = c.get('firmId');
  const body = await c.req.json();

  const updateSchema = z.object({
    name: z.string().optional(),
    mode: z.enum(['audit', 'proxy']).optional(),
    config: z.record(z.unknown()).optional(),
  });

  const parsed = updateSchema.parse(body);

  const [updated] = await db
    .update(firms)
    .set({ ...parsed, updatedAt: new Date() })
    .where(eq(firms.id, firmId))
    .returning();

  return c.json(updated);
});

// GET /v1/admin/users — List firm users
adminRoutes.get('/users', async (c) => {
  const firmId = c.get('firmId');

  const firmUsers = await db
    .select()
    .from(users)
    .where(eq(users.firmId, firmId));

  return c.json(firmUsers);
});

// POST /v1/admin/client-matters — Import client/matter data
adminRoutes.post('/client-matters', async (c) => {
  const firmId = c.get('firmId');
  const body = await c.req.json();

  const matterSchema = z.object({
    matters: z.array(z.object({
      clientName: z.string(),
      aliases: z.array(z.string()).optional().default([]),
      matterNumber: z.string().optional(),
      matterDescription: z.string().optional(),
      parties: z.array(z.string()).optional().default([]),
      sensitivityLevel: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
    })),
  });

  const parsed = matterSchema.parse(body);

  const values = parsed.matters.map((m) => ({
    firmId,
    clientName: m.clientName,
    aliases: m.aliases,
    matterNumber: m.matterNumber,
    matterDescription: m.matterDescription,
    parties: m.parties,
    sensitivityLevel: m.sensitivityLevel as any,
  }));

  const inserted = await db.insert(clientMatters).values(values).returning({ id: clientMatters.id });

  return c.json({ imported: inserted.length });
});

// GET /v1/admin/client-matters — List client/matters
adminRoutes.get('/client-matters', async (c) => {
  const firmId = c.get('firmId');

  const matters = await db
    .select()
    .from(clientMatters)
    .where(eq(clientMatters.firmId, firmId));

  return c.json(matters);
});

// GET /v1/admin/weight-overrides — Get firm weight overrides
adminRoutes.get('/weight-overrides', async (c) => {
  const firmId = c.get('firmId');

  const overrides = await db
    .select()
    .from(weightOverrides)
    .where(eq(weightOverrides.firmId, firmId));

  return c.json(overrides);
});
