// Iron Gate — Audit Trail Routes
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client';
import { events, auditLog } from '../db/schema';
import { eq, and, asc, desc, gte, lte, sql } from 'drizzle-orm';
import { verifyChain, getChainHead } from '../services/audit-chain';
import { sha256, hmacSign, hmacVerify } from '@iron-gate/crypto';
import { getSigningKey } from '../services/signing-key';
import { logger } from '../lib/logger';
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

  const format = c.req.query('format') || 'json';
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  const conditions = [eq(events.firmId, firmId)];
  if (startDate) conditions.push(gte(events.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(events.createdAt, new Date(endDate)));

  const chainEvents = await db
    .select({
      eventHash: events.eventHash,
      previousHash: events.previousHash,
      chainPosition: events.chainPosition,
      timestamp: events.createdAt,
      sessionId: events.sessionId,
      aiTool: events.aiToolId,
      sensitivityScore: events.sensitivityScore,
      sensitivityLevel: events.sensitivityLevel,
      routeDecision: events.action,
      captureMethod: events.captureMethod,
      promptHash: events.promptHash,
      promptLength: events.promptLength,
      metadata: events.metadata,
    })
    .from(events)
    .where(and(...conditions))
    .orderBy(asc(events.chainPosition));

  if (format === 'csv') {
    const csvHeaders = [
      'chainPosition', 'eventHash', 'previousHash', 'timestamp', 'sessionId',
      'aiTool', 'sensitivityScore', 'sensitivityLevel', 'routeDecision',
      'captureMethod', 'promptHash', 'promptLength',
      'intent', 'intentDirection', 'intentConfidence',
      'structureType', 'structureMultiplier', 'entityCount', 'wasPasted',
    ];
    const csvRows = chainEvents.map(e => {
      const meta = (e.metadata || {}) as Record<string, any>;
      return [
        e.chainPosition, e.eventHash, e.previousHash,
        e.timestamp ? new Date(e.timestamp as any).toISOString() : '',
        e.sessionId || '', e.aiTool, e.sensitivityScore, e.sensitivityLevel,
        e.routeDecision, e.captureMethod, e.promptHash, e.promptLength,
        meta.intent || '', meta.intentDirection || '', meta.intentConfidence || '',
        meta.structureType || '', meta.structureMultiplier || '',
        meta.entityCount || '', meta.wasPasted || '',
      ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
    });
    const csv = [csvHeaders.join(','), ...csvRows].join('\n');
    c.header('Content-Disposition', 'attachment; filename="irongate-audit-chain.csv"');
    c.header('Content-Type', 'text/csv');
    return c.text(csv);
  }

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

// ---------------------------------------------------------------------------
// POST /v1/audit/batch — ingest audit entries from the extension
// ---------------------------------------------------------------------------
// Closes the "audit logs lost on extension uninstall" gap from the
// Sr. Engineer audit (Item 13). Extension uses IronGateDashboardSink to
// POST batches here when the customer opts into `auditLogDestination =
// 'irongate-dashboard'`. Default stays `none` (sovereign mode) — this
// endpoint is opt-in, never forced.
//
// Storage: records go into the generic auditLog table as
// `action='extension.detection'` with the full entry in `newValue` JSONB.
// That table already has firmId + createdAt indexes so reports can query
// by firm and time window without a schema change.
//
// Idempotency: same pattern as /events/batch — a client-provided
// batchId dedupes retries within a 10-minute window.

const auditEntrySchema = z.object({
  id: z.string().max(64),
  timestamp: z.string().max(64),
  firmId: z.string().max(64).optional(),
  deviceHash: z.string().max(128),
  aiTool: z.string().max(50),
  zone: z.enum(['green', 'amber', 'red']),
  score: z.number().min(0).max(100),
  entityCount: z.number().int().min(0),
  entityTypes: z.array(z.string().max(50)).max(100),
  action: z.enum(['allowed', 'pseudonymized', 'blocked', 'low-risk-passthrough']),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  pseudonymsApplied: z.number().int().min(0),
  modelUsed: z.string().max(100).optional(),
  latencyMs: z.number().min(0).optional(),
  conversationId: z.string().max(64).optional(),
  turnNumber: z.number().int().min(0).optional(),
});

const auditBatchSchema = z.object({
  batchId: z.string().max(64).optional(),
  entries: z.array(auditEntrySchema).min(1).max(500),
});

// Batch-idempotency cache mirrors the /events/batch pattern.
interface AuditBatchResult { count: number; storedAt: number }
const _auditBatchCache = new Map<string, AuditBatchResult>();
const AUDIT_CACHE_TTL_MS = 10 * 60_000;
const AUDIT_CACHE_MAX = 5_000;
let _auditBatchSweepCounter = 0;

function sweepAuditCache(now: number): void {
  _auditBatchSweepCounter = 0;
  for (const [k, v] of _auditBatchCache) {
    if (now - v.storedAt > AUDIT_CACHE_TTL_MS) _auditBatchCache.delete(k);
  }
  if (_auditBatchCache.size > AUDIT_CACHE_MAX) {
    const sorted = [...(_auditBatchCache.entries())].sort((a, b) => a[1].storedAt - b[1].storedAt);
    const over = _auditBatchCache.size - AUDIT_CACHE_MAX;
    for (let i = 0; i < over; i++) _auditBatchCache.delete(sorted[i][0]);
  }
}

auditRoutes.post('/batch', async (c) => {
  const firmId = c.get('firmId');
  const userId = c.get('userId');

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const parseResult = auditBatchSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: 'Validation error', details: parseResult.error.errors }, 400);
  }
  const parsed = parseResult.data;

  // Idempotency short-circuit.
  const now = Date.now();
  _auditBatchSweepCounter++;
  if (_auditBatchSweepCounter >= 256 || _auditBatchCache.size > AUDIT_CACHE_MAX) {
    sweepAuditCache(now);
  }
  const cacheKey = parsed.batchId ? `${firmId}:${parsed.batchId}` : '';
  if (cacheKey) {
    const cached = _auditBatchCache.get(cacheKey);
    if (cached && now - cached.storedAt <= AUDIT_CACHE_TTL_MS) {
      return c.json({ accepted: cached.count, duplicate: true });
    }
  }

  // Insert all entries in one multi-row insert. Any single failure
  // (invalid FK, constraint violation) aborts the whole batch —
  // client retries idempotently via batchId.
  const rows = parsed.entries.map((e) => ({
    firmId,
    actorId: userId,
    action: 'extension.detection',
    resourceType: 'audit_entry',
    resourceId: null,
    newValue: e as any,
    ipAddress: c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || null,
    userAgent: c.req.header('user-agent') || null,
  }));

  try {
    await db.insert(auditLog).values(rows);
  } catch (err) {
    logger.error('Audit batch insert failed', {
      firmId,
      count: rows.length,
      batchId: parsed.batchId,
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json({ error: 'Failed to insert audit entries' }, 500);
  }

  if (cacheKey) {
    _auditBatchCache.set(cacheKey, { count: rows.length, storedAt: Date.now() });
  }

  return c.json({ accepted: rows.length, duplicate: false });
});
