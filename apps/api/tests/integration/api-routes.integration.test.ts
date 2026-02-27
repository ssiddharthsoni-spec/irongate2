/**
 * Integration Tests: Full API Route Testing
 *
 * Tests actual Hono route handlers (POST /events, GET /audit/verify, etc.)
 * against a real database using mocked auth context.
 *
 * Requires: PostgreSQL. Skips gracefully if unavailable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import {
  DB_AVAILABLE,
  getTestDb,
  seedTestData,
  cleanupTestData,
  closeTestDb,
  type TestContext,
} from './helpers';
import { sha256 } from '@iron-gate/crypto';
import type { AppEnv } from '../../src/types';

const DB = await DB_AVAILABLE;

let ctx: TestContext;
let app: Hono<AppEnv>;

describe.runIf(DB)('Integration: API Routes', () => {
  beforeAll(async () => {
    ctx = await seedTestData('api-routes');

    const { eventsRoutes } = await import('../../src/routes/events');
    const { auditRoutes } = await import('../../src/routes/audit');
    const { reportsRoutes } = await import('../../src/routes/reports');

    app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('firmId', ctx.firmId);
      c.set('userId', ctx.userId);
      c.set('userRole', 'admin');
      c.set('clerkId', 'test-clerk-id');
      await next();
    });

    app.route('/v1/events', eventsRoutes);
    app.route('/v1/audit', auditRoutes);
    app.route('/v1/reports', reportsRoutes);
  }, 15000);

  afterAll(async () => {
    if (ctx) await cleanupTestData(ctx.firmId);
    await closeTestDb();
  }, 15000);

  // ════════════════════════════════════════════════════════════════════════════
  // POST /v1/events
  // ════════════════════════════════════════════════════════════════════════════

  describe('POST /v1/events', () => {
    it('should accept a valid event and return eventId', async () => {
      const res = await app.request('/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiToolId: 'chatgpt',
          promptHash: await sha256('api route test prompt'),
          promptLength: 42,
          sensitivityScore: 35,
          sensitivityLevel: 'medium',
          entities: [],
          action: 'pass',
          captureMethod: 'fetch_intercept',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.eventId).toBeDefined();
      expect(body.actionRequired).toBe('pass');
    });

    it('should accept pre-minimized entities', async () => {
      const res = await app.request('/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiToolId: 'claude',
          promptHash: await sha256('prompt with PII'),
          promptLength: 100,
          sensitivityScore: 65,
          sensitivityLevel: 'high',
          entities: [
            { type: 'PERSON', textHash: await sha256('Jane Doe'), length: 8, start: 0, end: 8, confidence: 0.95, source: 'ner' },
            { type: 'EMAIL', textHash: await sha256('jane@example.com'), length: 16, start: 20, end: 36, confidence: 0.99, source: 'regex' },
          ],
          action: 'warn',
          captureMethod: 'dom_intercept',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.eventId).toBeDefined();
    });

    it('should reject invalid event data', async () => {
      const res = await app.request('/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiToolId: 'chatgpt' }), // Missing required fields
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Validation error');
    });

    it('should reject out-of-range sensitivity score', async () => {
      const res = await app.request('/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiToolId: 'chatgpt',
          promptHash: 'a'.repeat(64),
          promptLength: 10,
          sensitivityScore: 150,
          sensitivityLevel: 'critical',
          action: 'block',
          captureMethod: 'fetch_intercept',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // POST /v1/events/batch
  // ════════════════════════════════════════════════════════════════════════════

  describe('POST /v1/events/batch', () => {
    it('should accept a batch of events', async () => {
      const batchEvents = await Promise.all(
        Array.from({ length: 5 }, async (_, i) => ({
          aiToolId: ['chatgpt', 'claude', 'gemini', 'copilot', 'chatgpt'][i],
          promptHash: await sha256(`batch prompt ${i} ${Date.now()}`),
          promptLength: 50 + i * 10,
          sensitivityScore: 20 + i * 15,
          sensitivityLevel: (['low', 'low', 'medium', 'high', 'critical'] as const)[i],
          entities: [],
          action: 'pass' as const,
          captureMethod: 'fetch_intercept',
        })),
      );

      const res = await app.request('/v1/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: `test-batch-${Date.now()}`, events: batchEvents }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.eventIds).toHaveLength(5);
      expect(body.count).toBe(5);
    });

    it('should reject batch exceeding 100 events', async () => {
      const tooMany = Array.from({ length: 101 }, () => ({
        aiToolId: 'chatgpt',
        promptHash: 'a'.repeat(64),
        promptLength: 10,
        sensitivityScore: 10,
        sensitivityLevel: 'low',
        action: 'pass',
        captureMethod: 'fetch_intercept',
      }));

      const res = await app.request('/v1/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: 'too-large', events: tooMany }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject empty batch', async () => {
      const res = await app.request('/v1/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: 'empty', events: [] }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // GET /v1/events
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /v1/events', () => {
    it('should list events for the firm', async () => {
      const res = await app.request('/v1/events');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events.length).toBeGreaterThan(0);
      expect(body.total).toBeGreaterThan(0);
    });

    it('should support pagination', async () => {
      const res = await app.request('/v1/events?limit=2&offset=0');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toHaveLength(2);
    });

    it('should filter by minimum score', async () => {
      const res = await app.request('/v1/events?minScore=60');
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const event of body.events) {
        expect(event.sensitivityScore).toBeGreaterThanOrEqual(60);
      }
    });

    it('should filter by AI tool', async () => {
      const res = await app.request('/v1/events?aiToolId=claude');
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const event of body.events) {
        expect(event.aiToolId).toBe('claude');
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Audit Routes
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /v1/audit/verify', () => {
    it('should verify chain integrity and return signature stats', async () => {
      const res = await app.request('/v1/audit/verify');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.valid).toBe(true);
      expect(body.totalEvents).toBeGreaterThan(0);
      expect(body.signatureStats.signedEvents).toBe(body.signatureStats.totalEvents);
    });
  });

  describe('GET /v1/audit/status', () => {
    it('should return chain head information', async () => {
      const res = await app.request('/v1/audit/status');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.chainLength).toBeGreaterThan(0);
      expect(body.lastHash).toHaveLength(64);
      expect(body.isValid).toBe(true);
    });
  });

  describe('GET /v1/audit/export', () => {
    it('should export the full chain as JSON', async () => {
      const res = await app.request('/v1/audit/export');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toContain('irongate-audit-chain.json');

      const body = await res.json();
      expect(body.firmId).toBe(ctx.firmId);
      expect(body.chain.length).toBeGreaterThan(0);

      for (let i = 1; i < body.chain.length; i++) {
        expect(body.chain[i].chainPosition).toBeGreaterThan(body.chain[i - 1].chainPosition);
      }
    });
  });

  describe('GET /v1/audit/export/worm', () => {
    it('should produce a valid WORM document', async () => {
      const res = await app.request('/v1/audit/export/worm');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Disposition')).toContain('irongate-worm');
      expect(res.headers.get('Cache-Control')).toContain('immutable');

      const body = await res.json();
      expect(body._wormMetadata.version).toBe('1.0');
      expect(body._wormMetadata.chainValid).toBe(true);
      expect(body._wormMetadata.eventCount).toBeGreaterThan(0);
      expect(body._manifestSignature.signature).toHaveLength(64);
    });

    it('WORM manifest signature should verify', async () => {
      const { hmacVerify } = await import('@iron-gate/crypto');
      const { getSigningKey } = await import('../../src/services/signing-key');

      const res = await app.request('/v1/audit/export/worm');
      const body = await res.json();

      const signingKey = await getSigningKey();
      const valid = await hmacVerify(body._manifestSignature.message, body._manifestSignature.signature, signingKey);
      expect(valid).toBe(true);
    });
  });

  describe('GET /v1/audit/verify-signatures', () => {
    it('should verify all event signatures', async () => {
      const res = await app.request('/v1/audit/verify-signatures');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.allValid).toBe(true);
      expect(body.invalidSignatures).toBe(0);
    });
  });

  describe('GET /v1/audit/chain', () => {
    it('should return paginated chain entries', async () => {
      const res = await app.request('/v1/audit/chain?limit=3');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.entries).toHaveLength(3);
      for (const entry of body.entries) {
        expect(entry.eventHash).toHaveLength(64);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Reports
  // ════════════════════════════════════════════════════════════════════════════

  describe('GET /v1/reports/exposure', () => {
    it('should return a complete exposure report', async () => {
      const res = await app.request('/v1/reports/exposure?period=30d');
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.executiveSummary.totalInteractions).toBeGreaterThan(0);
      expect(body.toolBreakdown.length).toBeGreaterThan(0);
      expect(body.scoreDistribution).toBeDefined();
      expect(body.recommendations.length).toBeGreaterThan(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // End-to-End Flow
  // ════════════════════════════════════════════════════════════════════════════

  describe('End-to-End: Ingest → Verify → Export', () => {
    it('should complete the full audit lifecycle', async () => {
      // Step 1: Ingest
      const ingestRes = await app.request('/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiToolId: 'chatgpt',
          promptHash: await sha256('e2e high risk prompt'),
          promptLength: 200,
          sensitivityScore: 92,
          sensitivityLevel: 'critical',
          entities: [
            { type: 'SSN', textHash: await sha256('999-88-7777'), length: 11, start: 10, end: 21, confidence: 0.99, source: 'regex' },
          ],
          action: 'block',
          captureMethod: 'fetch_intercept',
        }),
      });
      expect(ingestRes.status).toBe(200);
      const { eventId } = await ingestRes.json();

      // Step 2: Verify chain
      const verifyRes = await app.request('/v1/audit/verify');
      expect((await verifyRes.json()).valid).toBe(true);

      // Step 3: Verify event signature
      const sigRes = await app.request(`/v1/audit/verify-signature/${eventId}`);
      expect(sigRes.status).toBe(200);
      const sigBody = await sigRes.json();
      expect(sigBody.signed).toBe(true);
      expect(sigBody.valid).toBe(true);

      // Step 4: Fetch event
      const eventRes = await app.request(`/v1/events/${eventId}`);
      expect(eventRes.status).toBe(200);
      const event = await eventRes.json();
      expect(event.sensitivityScore).toBe(92);
      expect(event.action).toBe('block');

      // Step 5: WORM export contains the event
      const wormRes = await app.request('/v1/audit/export/worm');
      const wormDoc = await wormRes.json();
      expect(wormDoc._wormMetadata.chainValid).toBe(true);
      const exportedEvent = wormDoc.chain.find((e: any) => e.id === eventId);
      expect(exportedEvent).toBeDefined();
      expect(exportedEvent.serverSignature).toHaveLength(64);
    });
  });
});
