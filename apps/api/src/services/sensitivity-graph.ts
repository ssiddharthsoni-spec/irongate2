// ============================================================================
// Iron Gate — Sensitivity Graph Service (★ MOAT)
// ============================================================================
// Tracks entity co-occurrence patterns per firm to boost scores for
// frequently-seen entity combinations. This is Iron Gate's core data moat.
// ============================================================================

import { db } from '../db/client';
import { entityCoOccurrences, sensitivityPatterns } from '../db/schema';
import { eq, sql, and, desc } from 'drizzle-orm';
import { sha256 } from '@iron-gate/crypto';
import type { DetectedEntity } from '@iron-gate/types';

/**
 * Record entity co-occurrences from a detection event.
 * For each unique entity pair, upsert the co-occurrence count.
 * Fire-and-forget — call after event insertion.
 */
export async function recordCoOccurrences(
  firmId: string,
  entities: DetectedEntity[],
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
      console.warn('[Sensitivity Graph] Failed to upsert co-occurrence:', error);
    }
  }

  // Also record the entity type combination as a sensitivity pattern
  await recordPattern(firmId, entities, contextScore);
}

/**
 * Get boost multiplier based on entity co-occurrence history.
 * Returns a multiplier (1.0 = no boost, up to 1.5 for very frequent patterns).
 */
export async function getBoostMultiplier(
  firmId: string,
  entities: DetectedEntity[],
): Promise<{ boost: number; reasons: string[] }> {
  if (entities.length < 2) return { boost: 0, reasons: [] };

  const pairs = await generatePairs(entities);
  let totalBoost = 0;
  const reasons: string[] = [];

  for (const [a, b] of pairs) {
    try {
      const [existing] = await db
        .select({
          coOccurrenceCount: entityCoOccurrences.coOccurrenceCount,
          avgContextScore: entityCoOccurrences.avgContextScore,
        })
        .from(entityCoOccurrences)
        .where(
          and(
            eq(entityCoOccurrences.firmId, firmId),
            eq(entityCoOccurrences.entityAHash, a.hash),
            eq(entityCoOccurrences.entityBHash, b.hash),
          ),
        )
        .limit(1);

      if (existing && existing.coOccurrenceCount >= 5 && existing.avgContextScore > 50) {
        const pairBoost = Math.min(15, existing.coOccurrenceCount * 0.5);
        totalBoost += pairBoost;
        reasons.push(
          `${a.type}+${b.type} seen ${existing.coOccurrenceCount}x in sensitive contexts`,
        );
      }
    } catch {
      // Silently continue on lookup failure
    }
  }

  return {
    boost: Math.min(25, totalBoost),
    reasons,
  };
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
  entities: DetectedEntity[],
): Promise<[HashedEntity, HashedEntity][]> {
  // Hash all entity texts
  const hashed: HashedEntity[] = await Promise.all(
    entities.map(async (e) => ({
      hash: await sha256(e.text),
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
