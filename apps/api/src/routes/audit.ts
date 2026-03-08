// Iron Gate — Audit Trail Routes
import { Hono } from 'hono';
import { db } from '../db/client';
import { events } from '../db/schema';
import { eq, and, asc, desc, gte, lte, sql } from 'drizzle-orm';
import { verifyChain, getChainHead } from '../services/audit-chain';
import { sha256, hmacSign, hmacVerify } from '@iron-gate/crypto';
import { getSigningKey } from '../services/signing-key';
import type { AppEnv } from '../types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(id: string): boolean { return UUID_REGEX.test(id); }

export const auditRoutes = new Hono<AppEnv>();

// GET /v1/audit/verify — Verify chain integrity + signature stats for firm
auditRoutes.get('/verify', async (c) => {
  const firmId = c.get('firmId');
  const chainResult = await verifyChain(firmId);

  const [sigStats] = await db
    .select({
      total: sql<number>`count(*)`,
      signed: sql<number>`count(server_signature)`,
    })
    .from(events)
    .where(eq(events.firmId, firmId));

  return c.json({
    ...chainResult,
    signatureStats: {
      totalEvents: Number(sigStats?.total || 0),
      signedEvents: Number(sigStats?.signed || 0),
      unsignedEvents: Number(sigStats?.total || 0) - Number(sigStats?.signed || 0),
    },
  });
});

// GET /v1/audit/verify-signature/:eventId — Verify single event signature
auditRoutes.get('/verify-signature/:eventId', async (c) => {
  const eventId = c.req.param('eventId');
  if (!isValidUuid(eventId)) return c.json({ error: 'Invalid ID format' }, 400);
  const firmId = c.get('firmId');

  const [event] = await db
    .select({
      id: events.id,
      eventHash: events.eventHash,
      serverSignature: events.serverSignature,
      signedAt: events.signedAt,
      signatureVersion: events.signatureVersion,
    })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.firmId, firmId)))
    .limit(1);

  if (!event) return c.json({ error: 'Event not found' }, 404);

  // Pre-signature event (backward compat)
  if (!event.serverSignature || !event.signedAt) {
    return c.json({
      eventId: event.id,
      signed: false,
      reason: 'Event predates server-side signing',
      chainHashPresent: !!event.eventHash,
    });
  }

  const signingKey = await getSigningKey();
  const message = `v${event.signatureVersion}:${event.eventHash}:${event.signedAt.toISOString()}`;
  const valid = await hmacVerify(message, event.serverSignature, signingKey);

  return c.json({
    eventId: event.id,
    signed: true,
    valid,
    signedAt: event.signedAt,
    signatureVersion: event.signatureVersion,
    verifiedAt: new Date().toISOString(),
  });
});

// GET /v1/audit/verify-signatures — Bulk-verify all signatures for firm
auditRoutes.get('/verify-signatures', async (c) => {
  const firmId = c.get('firmId');

  const allEvents = await db
    .select({
      id: events.id,
      eventHash: events.eventHash,
      serverSignature: events.serverSignature,
      signedAt: events.signedAt,
      signatureVersion: events.signatureVersion,
      chainPosition: events.chainPosition,
    })
    .from(events)
    .where(eq(events.firmId, firmId))
    .orderBy(asc(events.chainPosition))
    .limit(1000);

  const signingKey = await getSigningKey();
  let totalEvents = 0;
  let signedEvents = 0;
  let validSignatures = 0;
  let invalidSignatures = 0;
  let unsignedEvents = 0;
  const invalidList: { eventId: string; chainPosition: number | null }[] = [];

  for (const event of allEvents) {
    totalEvents++;
    if (!event.serverSignature || !event.signedAt) {
      unsignedEvents++;
      continue;
    }
    signedEvents++;
    const message = `v${event.signatureVersion}:${event.eventHash}:${event.signedAt.toISOString()}`;
    const valid = await hmacVerify(message, event.serverSignature, signingKey);
    if (valid) {
      validSignatures++;
    } else {
      invalidSignatures++;
      invalidList.push({ eventId: event.id, chainPosition: event.chainPosition });
    }
  }

  return c.json({
    totalEvents,
    signedEvents,
    unsignedEvents,
    validSignatures,
    invalidSignatures,
    invalidEvents: invalidList,
    allValid: invalidSignatures === 0,
    verifiedAt: new Date().toISOString(),
  });
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

// GET /v1/audit/export — Export full audit chain as JSON
auditRoutes.get('/export', async (c) => {
  const firmId = c.get('firmId');

  const chainEvents = await db
    .select({
      eventHash: events.eventHash,
      previousHash: events.previousHash,
      chainPosition: events.chainPosition,
      timestamp: events.createdAt,
      aiTool: events.aiToolId,
      sensitivityScore: events.sensitivityScore,
      sensitivityLevel: events.sensitivityLevel,
      routeDecision: events.action,
    })
    .from(events)
    .where(eq(events.firmId, firmId))
    .orderBy(asc(events.chainPosition));

  c.header('Content-Disposition', 'attachment; filename="irongate-audit-chain.json"');
  c.header('Content-Type', 'application/json');
  return c.json({
    exportedAt: new Date().toISOString(),
    firmId,
    chain: chainEvents,
  });
});

// GET /v1/audit/export/worm — WORM-compatible signed export
auditRoutes.get('/export/worm', async (c) => {
  const firmId = c.get('firmId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  // Validate date formats
  if (startDate) {
    const d = new Date(startDate);
    if (isNaN(d.getTime())) return c.json({ error: 'Invalid startDate format' }, 400);
  }
  if (endDate) {
    const d = new Date(endDate);
    if (isNaN(d.getTime())) return c.json({ error: 'Invalid endDate format' }, 400);
  }

  // Build query conditions
  const conditions = [eq(events.firmId, firmId)];
  if (startDate) conditions.push(gte(events.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(events.createdAt, new Date(endDate)));

  const chainEvents = await db
    .select({
      id: events.id,
      eventHash: events.eventHash,
      previousHash: events.previousHash,
      chainPosition: events.chainPosition,
      serverSignature: events.serverSignature,
      signedAt: events.signedAt,
      signatureVersion: events.signatureVersion,
      createdAt: events.createdAt,
      aiToolId: events.aiToolId,
      sensitivityScore: events.sensitivityScore,
      sensitivityLevel: events.sensitivityLevel,
      action: events.action,
      captureMethod: events.captureMethod,
      promptHash: events.promptHash,
      promptLength: events.promptLength,
    })
    .from(events)
    .where(and(...conditions))
    .orderBy(asc(events.chainPosition));

  // Compute chain verification
  const chainVerification = await verifyChain(firmId);

  // Serialize the chain events as canonical JSON for manifest signing
  const canonicalChain = JSON.stringify(chainEvents);
  const chainDigest = await sha256(canonicalChain);

  // Sign the manifest with server HMAC key
  const signingKey = await getSigningKey();
  const exportTimestamp = new Date().toISOString();
  const manifestMessage = `worm-export:v1:${firmId}:${exportTimestamp}:${chainEvents.length}:${chainDigest}`;
  const manifestSignature = await hmacSign(manifestMessage, signingKey);

  const signedCount = chainEvents.filter((e) => e.serverSignature).length;

  const wormDocument = {
    _wormMetadata: {
      version: '1.0',
      format: 'irongate-worm-export',
      exportedAt: exportTimestamp,
      firmId,
      chainHead: chainVerification.lastHash || null,
      chainLength: chainVerification.totalEvents,
      chainValid: chainVerification.valid,
      eventCount: chainEvents.length,
      dateRange: {
        start: startDate || chainEvents[0]?.createdAt || null,
        end: endDate || chainEvents[chainEvents.length - 1]?.createdAt || null,
      },
      signedEvents: signedCount,
      unsignedEvents: chainEvents.length - signedCount,
    },
    _manifestSignature: {
      algorithm: 'HMAC-SHA256',
      version: 1,
      message: manifestMessage,
      signature: manifestSignature,
    },
    chain: chainEvents,
  };

  const filename = `irongate-worm-${firmId}-${exportTimestamp.replace(/[:.]/g, '-')}.json`;
  c.header('Content-Disposition', `attachment; filename="${filename}"`);
  c.header('Content-Type', 'application/json');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.json(wormDocument);
});

// GET /v1/audit/chain — Paginated chain entries
auditRoutes.get('/chain', async (c) => {
  const firmId = c.get('firmId');
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50') || 50, 100));
  const offset = Math.min(1_000_000, Math.max(0, parseInt(c.req.query('offset') || '0') || 0));

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
