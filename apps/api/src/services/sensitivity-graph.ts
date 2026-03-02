// ============================================================================
// Iron Gate — Sensitivity Graph Service (★ MOAT)
// ============================================================================
// Tracks entity co-occurrence patterns per firm to boost scores for
// frequently-seen entity combinations. This is Iron Gate's core data moat.
// ============================================================================

import { db } from '../db/client';
import { entityCoOccurrences, sensitivityPatterns } from '../db/schema';
import { eq, sql, and, desc, inArray } from 'drizzle-orm';
import { sha256 } from '@iron-gate/crypto';
import type { DetectedEntity } from '@iron-gate/types';
import { logger } from '../lib/logger';

/**
 * Record entity co-occurrences from a detection event.
 * For each unique entity pair, upsert the co-occurrence count.
 * Fire-and-forget — call after event insertion.
 */
export async function recordCoOccurrences(
  firmId: string,
  entities: any[],
  contextScore: number,
): Promise<void> {
  if (entities.length < 2) return;

  const pairs = await generatePairs(entities);

  for (const [a, b] of pairs) {
    try {
      await db
        .insert(entityCoOccurrences)
        .values({
          firmId,
          entityAHash: a.hash,
          entityAType: a.type,
          entityBHash: b.hash,
          entityBType: b.type,
          coOccurrenceCount: 1,
          avgContextScore: contextScore,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [entityCoOccurrences.firmId, entityCoOccurrences.entityAHash, entityCoOccurrences.entityBHash],
          set: {
            coOccurrenceCount: sql`${entityCoOccurrences.coOccurrenceCount} + 1`,
            avgContextScore: sql`(${entityCoOccurrences.avgContextScore} * ${entityCoOccurrences.coOccurrenceCount} + ${contextScore}) / (${entityCoOccurrences.coOccurrenceCount} + 1)`,
            lastSeenAt: new Date(),
          },
        });
    } catch (error) {
      logger.warn('Failed to upsert co-occurrence', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Also record the entity type combination as a sensitivity pattern
  await recordPattern(firmId, entities, contextScore);
}

/**
 * Get boost multiplier based on entity co-occurrence history.
 * Returns a multiplier (1.0 = no boost, up to 1.5 for very frequent patterns).
 * Results are cached per firm for 30 seconds.
 */
const boostCache = new Map<string, { rows: { entityAHash: string; entityBHash: string; coOccurrenceCount: number; avgContextScore: number }[]; loadedAt: number }>();
const BOOST_CACHE_TTL = 30_000; // 30 seconds
let boostTableExists = true; // optimistic; set to false if query fails with table not found

export async function getBoostMultiplier(
  firmId: string,
  entities: any[],
): Promise<{ boost: number; reasons: string[] }> {
  if (entities.length < 2 || !boostTableExists) return { boost: 0, reasons: [] };

  const pairs = await generatePairs(entities);
  if (pairs.length === 0) return { boost: 0, reasons: [] };

  // Build a lookup map: "hashA:hashB" → [typeA, typeB]
  const pairTypes = new Map<string, [string, string]>();
  const allHashes = new Set<string>();
  for (const [a, b] of pairs) {
    pairTypes.set(`${a.hash}:${b.hash}`, [a.type, b.type]);
    allHashes.add(a.hash);
    allHashes.add(b.hash);
  }

  // Check cache (keyed by firmId — co-occurrence data changes rarely)
  const cached = boostCache.get(firmId);
  let rows: { entityAHash: string; entityBHash: string; coOccurrenceCount: number; avgContextScore: number }[];

  if (cached && Date.now() - cached.loadedAt < BOOST_CACHE_TTL) {
    rows = cached.rows;
  } else {
    // Single bulk query
    try {
      const hashArr = [...allHashes];
      rows = await db
        .select({
          entityAHash: entityCoOccurrences.entityAHash,
          entityBHash: entityCoOccurrences.entityBHash,
          coOccurrenceCount: entityCoOccurrences.coOccurrenceCount,
          avgContextScore: entityCoOccurrences.avgContextScore,
        })
        .from(entityCoOccurrences)
        .where(
          and(
            eq(entityCoOccurrences.firmId, firmId),
            inArray(entityCoOccurrences.entityAHash, hashArr),
            inArray(entityCoOccurrences.entityBHash, hashArr),
          ),
        );
      boostCache.set(firmId, { rows, loadedAt: Date.now() });
    } catch (err: any) {
      // If table doesn't exist, stop trying for this process lifetime
      if (err.message?.includes('does not exist') || err.message?.includes('relation')) {
        boostTableExists = false;
      }
      return { boost: 0, reasons: [] };
    }
  }

  let totalBoost = 0;
  const reasons: string[] = [];

  for (const row of rows) {
    if (row.coOccurrenceCount >= 5 && row.avgContextScore > 50) {
      const pairBoost = Math.min(15, row.coOccurrenceCount * 0.5);
      totalBoost += pairBoost;
      const types = pairTypes.get(`${row.entityAHash}:${row.entityBHash}`);
      if (types) {
        reasons.push(
          `${types[0]}+${types[1]} seen ${row.coOccurrenceCount}x in sensitive contexts`,
        );
      }
    }
  }

  return {
    boost: Math.min(25, totalBoost),
    reasons,
  };
}

/** Clear the in-memory boost cache (used by integration tests). */
export function clearBoostCache() {
  boostCache.clear();
}

/**
 * Get the full co-occurrence graph for a firm (for dashboard visualization).
 */
export async function getGraph(firmId: string) {
  const coOccurrences = await db
    .select()
    .from(entityCoOccurrences)
    .where(eq(entityCoOccurrences.firmId, firmId))
    .orderBy(desc(entityCoOccurrences.coOccurrenceCount))
    .limit(200);

  return coOccurrences;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface HashedEntity {
  hash: string;
  type: string;
}

async function generatePairs(
  entities: any[],
): Promise<[HashedEntity, HashedEntity][]> {
  // Hash entity texts — use pre-computed textHash if available (new clients)
  const hashed: HashedEntity[] = await Promise.all(
    entities.map(async (e) => ({
      hash: e.textHash || await sha256(e.text),
      type: e.type,
    })),
  );

  // Generate unique pairs, ordered by hash for consistency
  const pairs: [HashedEntity, HashedEntity][] = [];
  const seen = new Set<string>();

  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      const [a, b] = hashed[i].hash < hashed[j].hash
        ? [hashed[i], hashed[j]]
        : [hashed[j], hashed[i]];

      const key = `${a.hash}:${b.hash}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push([a, b]);
      }
    }
  }

  return pairs;
}

async function recordPattern(
  firmId: string,
  entities: DetectedEntity[],
  contextScore: number,
): Promise<void> {
  const entityTypes = [...new Set(entities.map((e) => e.type))].sort();
  if (entityTypes.length < 2) return;

  const patternHash = await sha256(entityTypes.join(':'));

  try {
    await db
      .insert(sensitivityPatterns)
      .values({
        firmId,
        patternHash,
        entityTypes,
        triggerCount: 1,
        avgScore: contextScore,
        discoveredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [sensitivityPatterns.firmId, sensitivityPatterns.patternHash],
        set: {
          triggerCount: sql`${sensitivityPatterns.triggerCount} + 1`,
          avgScore: sql`(${sensitivityPatterns.avgScore} * ${sensitivityPatterns.triggerCount} + ${contextScore}) / (${sensitivityPatterns.triggerCount} + 1)`,
        },
      });
  } catch {
    // Non-critical — silently continue
  }
}
