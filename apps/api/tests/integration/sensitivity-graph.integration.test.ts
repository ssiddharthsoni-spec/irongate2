/**
 * Integration Tests: Sensitivity Graph & Co-occurrence Tracking
 *
 * Tests the entity co-occurrence system (Iron Gate's data moat):
 *   1. Recording co-occurrences from detection events
 *   2. Boost multiplier calculation
 *   3. Sensitivity pattern recording
 *   4. Graph retrieval for dashboard
 *   5. Multi-tenant isolation
 *
 * Requires: PostgreSQL. Skips gracefully if unavailable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  DB_AVAILABLE,
  getTestDb,
  seedTestData,
  cleanupTestData,
  closeTestDb,
  type TestContext,
} from './helpers';
import { entityCoOccurrences, sensitivityPatterns } from '../../src/db/schema';
import { sha256 } from '@iron-gate/crypto';

const DB = await DB_AVAILABLE;

let ctx: TestContext;

describe.runIf(DB)('Integration: Sensitivity Graph', () => {
  beforeAll(async () => {
    ctx = await seedTestData('sensitivity-graph');
  }, 15000);

  afterAll(async () => {
    if (ctx) await cleanupTestData(ctx.firmId);
    await closeTestDb();
  }, 15000);

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Recording Co-occurrences
  // ════════════════════════════════════════════════════════════════════════════

  describe('recordCoOccurrences', () => {
    it('should insert co-occurrence pairs for entity combinations', async () => {
      const { recordCoOccurrences } = await import('../../src/services/sensitivity-graph');

      const entities = [
        { type: 'PERSON', textHash: await sha256('John Smith'), start: 0, end: 10, confidence: 0.95, source: 'ner' },
        { type: 'SSN', textHash: await sha256('123-45-6789'), start: 20, end: 31, confidence: 0.99, source: 'regex' },
        { type: 'EMAIL', textHash: await sha256('john@example.com'), start: 40, end: 56, confidence: 0.97, source: 'regex' },
      ];

      await recordCoOccurrences(ctx.firmId, entities, 72);

      const db = getTestDb();
      const coOccurrences = await db
        .select()
        .from(entityCoOccurrences)
        .where(eq(entityCoOccurrences.firmId, ctx.firmId));

      // 3 entities → 3 unique pairs
      expect(coOccurrences.length).toBe(3);

      for (const co of coOccurrences) {
        expect(co.coOccurrenceCount).toBe(1);
        expect(co.avgContextScore).toBeCloseTo(72, 0);
        expect(co.entityAHash).toHaveLength(64);
        expect(co.entityBHash).toHaveLength(64);
      }
    });

    it('should increment count on repeated co-occurrences', async () => {
      const { recordCoOccurrences } = await import('../../src/services/sensitivity-graph');

      const entities = [
        { type: 'PERSON', textHash: await sha256('John Smith'), start: 0, end: 10, confidence: 0.95, source: 'ner' },
        { type: 'SSN', textHash: await sha256('123-45-6789'), start: 20, end: 31, confidence: 0.99, source: 'regex' },
      ];

      await recordCoOccurrences(ctx.firmId, entities, 80);

      const db = getTestDb();
      const coOccurrences = await db
        .select()
        .from(entityCoOccurrences)
        .where(eq(entityCoOccurrences.firmId, ctx.firmId));

      const personSsnPair = coOccurrences.find(
        (co) =>
          (co.entityAType === 'PERSON' && co.entityBType === 'SSN') ||
          (co.entityAType === 'SSN' && co.entityBType === 'PERSON'),
      );

      expect(personSsnPair).toBeDefined();
      expect(personSsnPair!.coOccurrenceCount).toBe(2);
      // Weighted average: (72*1 + 80) / 2 = ~76
      expect(personSsnPair!.avgContextScore).toBeCloseTo(76, 0);
    });

    it('should not record co-occurrences for single entities', async () => {
      const { recordCoOccurrences } = await import('../../src/services/sensitivity-graph');

      const db = getTestDb();
      const [before] = await db
        .select({ count: sql<number>`count(*)` })
        .from(entityCoOccurrences)
        .where(eq(entityCoOccurrences.firmId, ctx.firmId));

      await recordCoOccurrences(ctx.firmId, [
        { type: 'PHONE', textHash: await sha256('555-0100'), start: 0, end: 8, confidence: 0.9, source: 'regex' },
      ], 50);

      const [after] = await db
        .select({ count: sql<number>`count(*)` })
        .from(entityCoOccurrences)
        .where(eq(entityCoOccurrences.firmId, ctx.firmId));

      expect(Number(after.count)).toBe(Number(before.count));
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Boost Multiplier
  // ════════════════════════════════════════════════════════════════════════════

  describe('getBoostMultiplier', () => {
    it('should return no boost for new entity pairs (count < 5)', async () => {
      const { getBoostMultiplier } = await import('../../src/services/sensitivity-graph');

      const result = await getBoostMultiplier(ctx.firmId, [
        { type: 'PERSON', textHash: await sha256('John Smith'), start: 0, end: 10, confidence: 0.95, source: 'ner' },
        { type: 'SSN', textHash: await sha256('123-45-6789'), start: 20, end: 31, confidence: 0.99, source: 'regex' },
      ]);

      expect(result.boost).toBe(0);
      expect(result.reasons).toHaveLength(0);
    });

    it('should return a boost after sufficient co-occurrences', async () => {
      const { recordCoOccurrences, getBoostMultiplier } = await import('../../src/services/sensitivity-graph');

      const entities = [
        { type: 'PERSON', textHash: await sha256('John Smith'), start: 0, end: 10, confidence: 0.95, source: 'ner' },
        { type: 'SSN', textHash: await sha256('123-45-6789'), start: 20, end: 31, confidence: 0.99, source: 'regex' },
      ];

      // Record 4 more (total = 2 + 4 = 6, above threshold of 5)
      for (let i = 0; i < 4; i++) {
        await recordCoOccurrences(ctx.firmId, entities, 75);
      }

      const result = await getBoostMultiplier(ctx.firmId, entities);
      expect(result.boost).toBeGreaterThan(0);
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Sensitivity Patterns
  // ════════════════════════════════════════════════════════════════════════════

  describe('Sensitivity Pattern Recording', () => {
    it('should record entity type combinations as patterns', async () => {
      const db = getTestDb();
      const patterns = await db
        .select()
        .from(sensitivityPatterns)
        .where(eq(sensitivityPatterns.firmId, ctx.firmId));

      expect(patterns.length).toBeGreaterThan(0);
      for (const pattern of patterns) {
        expect(pattern.patternHash).toHaveLength(64);
        expect(pattern.triggerCount).toBeGreaterThan(0);
        expect(Array.isArray(pattern.entityTypes)).toBe(true);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. Graph Retrieval
  // ════════════════════════════════════════════════════════════════════════════

  describe('getGraph', () => {
    it('should return co-occurrence graph data', async () => {
      const { getGraph } = await import('../../src/services/sensitivity-graph');
      const graph = await getGraph(ctx.firmId);

      expect(graph.length).toBeGreaterThan(0);
      for (const entry of graph) {
        expect(entry.firmId).toBe(ctx.firmId);
        expect(entry.entityAHash).toHaveLength(64);
        expect(entry.coOccurrenceCount).toBeGreaterThan(0);
      }

      // Ordered by count descending
      for (let i = 1; i < graph.length; i++) {
        expect(graph[i - 1].coOccurrenceCount).toBeGreaterThanOrEqual(graph[i].coOccurrenceCount);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. Multi-Tenant Isolation
  // ════════════════════════════════════════════════════════════════════════════

  describe('Multi-Tenant Isolation', () => {
    let ctx2: TestContext;

    beforeAll(async () => {
      ctx2 = await seedTestData('sensitivity-graph-2');
    });

    afterAll(async () => {
      if (ctx2) await cleanupTestData(ctx2.firmId);
    });

    it('should not leak co-occurrences between firms', async () => {
      const { getGraph, recordCoOccurrences } = await import('../../src/services/sensitivity-graph');

      await recordCoOccurrences(ctx2.firmId, [
        { type: 'CREDIT_CARD', textHash: await sha256('4111-1111-1111-1111'), start: 0, end: 19, confidence: 0.99, source: 'regex' },
        { type: 'PERSON', textHash: await sha256('Firm 2 Person'), start: 30, end: 43, confidence: 0.9, source: 'ner' },
      ], 90);

      const graph1 = await getGraph(ctx.firmId);
      for (const entry of graph1) {
        expect(entry.firmId).toBe(ctx.firmId);
      }

      const graph2 = await getGraph(ctx2.firmId);
      for (const entry of graph2) {
        expect(entry.firmId).toBe(ctx2.firmId);
      }
      expect(graph2.length).toBe(1);
    });
  });
});
