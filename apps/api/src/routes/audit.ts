// Iron Gate — Audit Trail Routes
import { Hono } from 'hono';
import { db } from '../db/client';
import { events } from '../db/schema';
import { eq, desc, asc } from 'drizzle-orm';
import { verifyChain, getChainHead } from '../services/audit-chain';
import type { AppEnv } from '../types';

export const auditRoutes = new Hono<AppEnv>();

// GET /v1/audit/verify — Verify chain integrity for firm
auditRoutes.get('/verify', async (c) => {
  const firmId = c.get('firmId');
  const result = await verifyChain(firmId);
  return c.json(result);
});

// GET /v1/audit/status — Chain head status
auditRoutes.get('/status', async (c) => {
  const firmId = c.get('firmId');
  const head = await getChainHead(firmId);
  const verification = await verifyChain(firmId);

  return c.json({
    chainLength: verification.totalEvents,
    lastHash: head?.eventHash ?? null,
    lastPosition: head?.chainPosition ?? 0,
    lastEventAt: head?.createdAt ?? null,
    isValid: verification.valid,
    lastVerified: verification.verifiedAt,
  });
});

// GET /v1/audit/chain — Paginated chain entries
auditRoutes.get('/chain', async (c) => {
  const firmId = c.get('firmId');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const results = await db
    .select({
      id: events.id,
      eventHash: events.eventHash,
      previousHash: events.previousHash,
      chainPosition: events.chainPosition,
      aiToolId: events.aiToolId,
      sensitivityScore: events.sensitivityScore,
      sensitivityLevel: events.sensitivityLevel,
      action: events.action,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(eq(events.firmId, firmId))
    .orderBy(desc(events.chainPosition))
    .limit(limit)
    .offset(offset);

  return c.json({
    entries: results,
    limit,
    offset,
  });
});
