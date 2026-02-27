/**
 * Integration Tests: Event Ingestion → Chain Verification → Export
 *
 * Tests the full cryptographic audit trail pipeline against a real database:
 *   1. Single event insertion with hash chain
 *   2. Sequential events maintain chain links
 *   3. Chain verification detects tampering
 *   4. WORM export includes valid signatures
 *   5. Concurrent writes with OCC
 *
 * Requires: PostgreSQL (local or remote). Skips gracefully if unavailable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, asc, sql } from 'drizzle-orm';
import {
  DB_AVAILABLE,
  getTestDb,
  seedTestData,
  cleanupTestData,
  closeTestDb,
  makeEventData,
  type TestContext,
} from './helpers';
import { events } from '../../src/db/schema';
import { chainHash, sha256, hmacSign, hmacVerify } from '@iron-gate/crypto';
import { getSigningKey } from '../../src/services/signing-key';

// Resolve at module top level so describe.runIf works at collect time
const DB = await DB_AVAILABLE;

let ctx: TestContext;

describe.runIf(DB)('Integration: Event Chain Pipeline', () => {
  beforeAll(async () => {
    ctx = await seedTestData('event-chain');
  }, 15000);

  afterAll(async () => {
    if (ctx) await cleanupTestData(ctx.firmId);
    await closeTestDb();
  }, 15000);

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Single Event Insertion
  // ════════════════════════════════════════════════════════════════════════════

  describe('Single Event → Audit Chain', () => {
    it('should insert an event with hash, chain position, and HMAC signature', async () => {
      const { appendEvent } = await import('../../src/services/audit-chain');

      const result = await appendEvent({
        ...makeEventData(),
        firmId: ctx.firmId,
        userId: ctx.userId,
      });

      expect(result.id).toBeDefined();
      expect(result.eventHash).toHaveLength(64);
      expect(result.chainPosition).toBe(1);
      expect(result.serverSignature).toHaveLength(64);
    });

    it('should store the event in the database with correct fields', async () => {
      const db = getTestDb();

      const [stored] = await db
        .select()
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .orderBy(asc(events.chainPosition))
        .limit(1);

      expect(stored).toBeDefined();
      expect(stored.firmId).toBe(ctx.firmId);
      expect(stored.userId).toBe(ctx.userId);
      expect(stored.aiToolId).toBe('chatgpt');
      expect(stored.eventHash).toHaveLength(64);
      expect(stored.previousHash).toBeNull(); // Genesis event
      expect(stored.chainPosition).toBe(1);
      expect(stored.serverSignature).toHaveLength(64);
      expect(stored.signedAt).toBeDefined();
      expect(stored.signatureVersion).toBe(1);
    });

    it('genesis event should have previousHash = null', async () => {
      const db = getTestDb();

      const [genesis] = await db
        .select({ previousHash: events.previousHash, chainPosition: events.chainPosition })
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .orderBy(asc(events.chainPosition))
        .limit(1);

      expect(genesis.chainPosition).toBe(1);
      expect(genesis.previousHash).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Sequential Events — Chain Link Integrity
  // ════════════════════════════════════════════════════════════════════════════

  describe('Sequential Events → Chain Integrity', () => {
    it('should chain 4 more events with correct hash links', async () => {
      const { appendEvent } = await import('../../src/services/audit-chain');

      const results = [];
      for (let i = 0; i < 4; i++) {
        const result = await appendEvent({
          ...makeEventData({
            sensitivityScore: 20 + i * 20,
            sensitivityLevel: i < 2 ? 'low' : i < 3 ? 'medium' : 'high',
            aiToolId: ['chatgpt', 'claude', 'gemini', 'copilot'][i],
          }),
          firmId: ctx.firmId,
          userId: ctx.userId,
        });
        results.push(result);
      }

      expect(results.map((r) => r.chainPosition)).toEqual([2, 3, 4, 5]);

      const hashes = results.map((r) => r.eventHash);
      expect(new Set(hashes).size).toBe(4);
    });

    it('each event should reference the previous event hash', async () => {
      const db = getTestDb();

      const allEvents = await db
        .select({
          eventHash: events.eventHash,
          previousHash: events.previousHash,
          chainPosition: events.chainPosition,
        })
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .orderBy(asc(events.chainPosition));

      expect(allEvents.length).toBe(5);
      expect(allEvents[0].previousHash).toBeNull();

      for (let i = 1; i < allEvents.length; i++) {
        expect(allEvents[i].previousHash).toBe(allEvents[i - 1].eventHash);
      }
    });

    it('hashes should be recomputable from event data', async () => {
      const db = getTestDb();

      const allEvents = await db
        .select({
          eventHash: events.eventHash,
          previousHash: events.previousHash,
          chainPosition: events.chainPosition,
          firmId: events.firmId,
          userId: events.userId,
          aiToolId: events.aiToolId,
          promptHash: events.promptHash,
          promptLength: events.promptLength,
          sensitivityScore: events.sensitivityScore,
          sensitivityLevel: events.sensitivityLevel,
          action: events.action,
          captureMethod: events.captureMethod,
        })
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .orderBy(asc(events.chainPosition));

      for (const event of allEvents) {
        const hashData: Record<string, unknown> = {
          firmId: event.firmId,
          userId: event.userId,
          aiToolId: event.aiToolId,
          promptHash: event.promptHash,
          promptLength: event.promptLength,
          sensitivityScore: event.sensitivityScore,
          sensitivityLevel: event.sensitivityLevel,
          action: event.action,
          captureMethod: event.captureMethod,
          chainPosition: event.chainPosition,
        };

        const expectedHash = await chainHash(hashData, event.previousHash);
        expect(event.eventHash).toBe(expectedHash);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Chain Verification Service
  // ════════════════════════════════════════════════════════════════════════════

  describe('Chain Verification (verifyChain)', () => {
    it('should report chain as valid after sequential inserts', async () => {
      const { verifyChain } = await import('../../src/services/audit-chain');

      const result = await verifyChain(ctx.firmId);
      expect(result.valid).toBe(true);
      expect(result.totalEvents).toBe(5);
      expect(result.lastHash).toHaveLength(64);
      expect(result.brokenAt).toBeUndefined();
    });

    it('should detect a broken chain when an event hash is tampered', async () => {
      const db = getTestDb();

      const [event3] = await db
        .select({ id: events.id, eventHash: events.eventHash })
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .orderBy(asc(events.chainPosition))
        .limit(1)
        .offset(2);

      const originalHash = event3.eventHash;

      await db.update(events).set({ eventHash: 'a'.repeat(64) }).where(eq(events.id, event3.id));

      const { verifyChain } = await import('../../src/services/audit-chain');
      const result = await verifyChain(ctx.firmId);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(3);

      // Restore
      await db.update(events).set({ eventHash: originalHash }).where(eq(events.id, event3.id));
      const restored = await verifyChain(ctx.firmId);
      expect(restored.valid).toBe(true);
    });

    it('should detect a broken previousHash link', async () => {
      const db = getTestDb();

      const [event4] = await db
        .select({ id: events.id, previousHash: events.previousHash })
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .orderBy(asc(events.chainPosition))
        .limit(1)
        .offset(3);

      const originalPrevHash = event4.previousHash;

      await db.update(events).set({ previousHash: 'b'.repeat(64) }).where(eq(events.id, event4.id));

      const { verifyChain } = await import('../../src/services/audit-chain');
      const result = await verifyChain(ctx.firmId);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(4);

      await db.update(events).set({ previousHash: originalPrevHash }).where(eq(events.id, event4.id));
      const restored = await verifyChain(ctx.firmId);
      expect(restored.valid).toBe(true);
    });

    it('should report valid for a firm with no events', async () => {
      const { verifyChain } = await import('../../src/services/audit-chain');
      const result = await verifyChain('00000000-0000-0000-0000-000000000000');
      expect(result.valid).toBe(true);
      expect(result.totalEvents).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. Chain Head Tracking
  // ════════════════════════════════════════════════════════════════════════════

  describe('Chain Head (getChainHead)', () => {
    it('should return the latest event hash and position', async () => {
      const { getChainHead } = await import('../../src/services/audit-chain');
      const head = await getChainHead(ctx.firmId);
      expect(head).not.toBeNull();
      expect(head!.chainPosition).toBe(5);
      expect(head!.eventHash).toHaveLength(64);
    });

    it('should return null for a firm with no events', async () => {
      const { getChainHead } = await import('../../src/services/audit-chain');
      const head = await getChainHead('00000000-0000-0000-0000-000000000000');
      expect(head).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. HMAC Signature Verification
  // ════════════════════════════════════════════════════════════════════════════

  describe('HMAC Signature Verification', () => {
    it('should produce valid HMAC signatures on all events', async () => {
      const db = getTestDb();
      const allEvents = await db
        .select({
          eventHash: events.eventHash,
          serverSignature: events.serverSignature,
          signedAt: events.signedAt,
          signatureVersion: events.signatureVersion,
        })
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .orderBy(asc(events.chainPosition));

      const signingKey = await getSigningKey();

      for (const event of allEvents) {
        expect(event.serverSignature).toBeDefined();
        const message = `v${event.signatureVersion}:${event.eventHash}:${event.signedAt!.toISOString()}`;
        const valid = await hmacVerify(message, event.serverSignature!, signingKey);
        expect(valid).toBe(true);
      }
    });

    it('should reject a tampered signature', async () => {
      const db = getTestDb();
      const [event] = await db
        .select({
          eventHash: events.eventHash,
          serverSignature: events.serverSignature,
          signedAt: events.signedAt,
        })
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .limit(1);

      const signingKey = await getSigningKey();
      const tamperedMessage = `v1:${'f'.repeat(64)}:${event.signedAt!.toISOString()}`;
      const valid = await hmacVerify(tamperedMessage, event.serverSignature!, signingKey);
      expect(valid).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 6. Batch Events → Chain Integrity
  // ════════════════════════════════════════════════════════════════════════════

  describe('Batch Events → Chain Integrity', () => {
    it('should insert 10 events and maintain chain', async () => {
      const { appendEvent, verifyChain } = await import('../../src/services/audit-chain');

      const batchResults = [];
      for (let i = 0; i < 10; i++) {
        const result = await appendEvent({
          ...makeEventData({
            sensitivityScore: 10 + i * 8,
            sensitivityLevel: i < 3 ? 'low' : i < 7 ? 'medium' : 'high',
            aiToolId: ['chatgpt', 'claude', 'gemini'][i % 3],
          }),
          firmId: ctx.firmId,
          userId: ctx.userId,
        });
        batchResults.push(result);
      }

      expect(batchResults[0].chainPosition).toBe(6);
      expect(batchResults[9].chainPosition).toBe(15);

      const verification = await verifyChain(ctx.firmId);
      expect(verification.valid).toBe(true);
      expect(verification.totalEvents).toBe(15);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 7. WORM Export — Signed Manifest
  // ════════════════════════════════════════════════════════════════════════════

  describe('WORM Export — Signed Manifest', () => {
    it('should produce a valid WORM document with manifest signature', async () => {
      const db = getTestDb();
      const { verifyChain } = await import('../../src/services/audit-chain');

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
        .where(eq(events.firmId, ctx.firmId))
        .orderBy(asc(events.chainPosition));

      const chainVerification = await verifyChain(ctx.firmId);
      expect(chainVerification.valid).toBe(true);

      const canonicalChain = JSON.stringify(chainEvents);
      const chainDigest = await sha256(canonicalChain);
      const signingKey = await getSigningKey();
      const exportTimestamp = new Date().toISOString();
      const manifestMessage = `worm-export:v1:${ctx.firmId}:${exportTimestamp}:${chainEvents.length}:${chainDigest}`;
      const manifestSignature = await hmacSign(manifestMessage, signingKey);

      const signedCount = chainEvents.filter((e) => e.serverSignature).length;

      expect(signedCount).toBe(15);

      // Verify manifest signature
      const verifyResult = await hmacVerify(manifestMessage, manifestSignature, signingKey);
      expect(verifyResult).toBe(true);
    });

    it('should detect if export data is altered after signing', async () => {
      const db = getTestDb();

      const chainEvents = await db
        .select({ id: events.id, eventHash: events.eventHash, chainPosition: events.chainPosition })
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .orderBy(asc(events.chainPosition));

      const canonicalChain = JSON.stringify(chainEvents);
      const chainDigest = await sha256(canonicalChain);
      const signingKey = await getSigningKey();
      const exportTimestamp = new Date().toISOString();
      const manifestMessage = `worm-export:v1:${ctx.firmId}:${exportTimestamp}:${chainEvents.length}:${chainDigest}`;
      const manifestSignature = await hmacSign(manifestMessage, signingKey);

      // Tamper with export data
      const tamperedEvents = [...chainEvents];
      tamperedEvents[5] = { ...tamperedEvents[5], eventHash: 'c'.repeat(64) };
      const tamperedDigest = await sha256(JSON.stringify(tamperedEvents));
      const tamperedMessage = `worm-export:v1:${ctx.firmId}:${exportTimestamp}:${tamperedEvents.length}:${tamperedDigest}`;

      const verifyTampered = await hmacVerify(tamperedMessage, manifestSignature, signingKey);
      expect(verifyTampered).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 8. Data Minimization
  // ════════════════════════════════════════════════════════════════════════════

  describe('Data Minimization — Entity Text Hashing', () => {
    it('should store entity hashes, not raw text', async () => {
      const { appendEvent } = await import('../../src/services/audit-chain');

      const result = await appendEvent({
        firmId: ctx.firmId,
        userId: ctx.userId,
        aiToolId: 'chatgpt',
        promptHash: 'minimization_test'.padEnd(64, '0'),
        promptLength: 200,
        sensitivityScore: 72,
        sensitivityLevel: 'high',
        entities: [
          { type: 'PERSON', textHash: await sha256('John Smith'), start: 0, end: 10, confidence: 0.95, source: 'ner', length: 10 },
          { type: 'SSN', textHash: await sha256('123-45-6789'), start: 20, end: 31, confidence: 0.99, source: 'regex', length: 11 },
        ],
        action: 'warn',
        captureMethod: 'fetch_intercept',
      });

      const db = getTestDb();
      const [stored] = await db.select({ entities: events.entities }).from(events).where(eq(events.id, result.id));

      const storedEntities = stored.entities as any[];
      expect(storedEntities.length).toBe(2);
      for (const entity of storedEntities) {
        expect(entity.textHash).toHaveLength(64);
        expect(entity.text).toBeUndefined();
      }
      expect(storedEntities[0].textHash).toBe(await sha256('John Smith'));
      expect(storedEntities[1].textHash).toBe(await sha256('123-45-6789'));
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 9. Concurrent Inserts (OCC)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Concurrent Event Insertion (Optimistic Concurrency)', () => {
    it('should handle concurrent inserts without data loss', async () => {
      const { appendEvent, verifyChain, getChainHead } = await import('../../src/services/audit-chain');

      const headBefore = await getChainHead(ctx.firmId);
      const positionBefore = headBefore?.chainPosition ?? 0;

      const promises = Array.from({ length: 5 }, (_, i) =>
        appendEvent({
          ...makeEventData({ sensitivityScore: 50 + i, aiToolId: `concurrent-tool-${i}` }),
          firmId: ctx.firmId,
          userId: ctx.userId,
        }),
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);

      const positions = results.map((r) => r.chainPosition);
      expect(new Set(positions).size).toBe(5);

      const sortedPositions = positions.sort((a, b) => a - b);
      for (let i = 0; i < 5; i++) {
        expect(sortedPositions[i]).toBe(positionBefore + 1 + i);
      }

      const verification = await verifyChain(ctx.firmId);
      expect(verification.valid).toBe(true);
    }, 30000);
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 10. Exposure Report Aggregation
  // ════════════════════════════════════════════════════════════════════════════

  describe('Exposure Report — SQL Aggregation', () => {
    it('should aggregate event data correctly', async () => {
      const db = getTestDb();

      const [stats] = await db
        .select({
          totalInteractions: sql<number>`count(*)`,
          uniqueUsers: sql<number>`count(distinct ${events.userId})`,
          avgScore: sql<number>`avg(${events.sensitivityScore})`,
          maxScore: sql<number>`max(${events.sensitivityScore})`,
        })
        .from(events)
        .where(eq(events.firmId, ctx.firmId));

      expect(Number(stats.totalInteractions)).toBeGreaterThan(15);
      expect(Number(stats.uniqueUsers)).toBe(1);
      expect(Number(stats.avgScore)).toBeGreaterThan(0);
    });

    it('should break down by AI tool', async () => {
      const db = getTestDb();

      const byTool = await db
        .select({ toolId: events.aiToolId, count: sql<number>`count(*)` })
        .from(events)
        .where(eq(events.firmId, ctx.firmId))
        .groupBy(events.aiToolId);

      expect(byTool.length).toBeGreaterThan(1);
      for (const tool of byTool) {
        expect(Number(tool.count)).toBeGreaterThan(0);
      }
    });
  });
});
